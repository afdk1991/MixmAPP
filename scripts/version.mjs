#!/usr/bin/env node
/**
 * 版本号单一事实源：version.json
 *
 * 规约（详见 docs/19-versioning.md）：
 * - 四段式版本：X.Y.Z.B，基线 = V0.0.0.0（2026-11-14 全平台 / 全渠道强制重置）
 * - 之后每次功能/模块更新只递增第 4 段：V0.0.0.1、V0.0.0.2 ……
 * - 发布前不得占用正式版本号：没有真正对外发布，就不能把该号写进 released，也不能打 tag
 * - 渠道：release（正式）/ preview（预览）/ dev（开发）；非 release 一律显示 <next>-<channel>
 * - 正式发布态下，展示层 / 构建元数据统一取「最新已发布正式号」，next 仅表示下一个待发布工作号
 * - npm 包版本必须是三段式 semver，映射规则 = 取四段号的前三段（0.0.0.0 → 0.0.0）
 * - 任何一处版本必须与 README 同步，不一致即门禁失败
 *
 * 命令：
 *   node scripts/version.mjs show      打印当前版本（含展示形式）
 *   node scripts/version.mjs check     校验全部版本位是否一致（CI 门禁用）
 *   node scripts/version.mjs sync      把 version.json 同步到各处（包、env、config、manifest、前端常量、README；Android gradle 直接读 version.json，不落字面量）
 *   node scripts/version.mjs bump      递增工作补丁号（只允许在上一版已发布之后）
 *   node scripts/version.mjs release   正式发布：占用当前号、打 tag 提示、推进到下一个工作号，进入 release 正式态
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_FILE = join(root, 'version.json');
/** 四段式版本 X.Y.Z.B（每段非负整数、无前导零） */
const SEMVER4 = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const PKG_FILES = [
  'package.json',
  'apps/app/package.json',
  'apps/mobile/package.json',
  'services/api/package.json',
  'packages/contracts/package.json',
  'packages/ids/package.json',
  // CloudBase 云函数独立部署包（不在 pnpm workspace 内，但版本号同样纳管）
  'cloudbase/functions/mixmapp-api-proxy/package.json',
];

const ENV_FILE = '.env.example';
const CONFIG_FILE = join('services', 'api', 'src', 'config.ts');
const README_FILE = 'README.md';
/** 前端构建元数据：uni-app 应用清单 */
const MANIFEST_FILE = join('apps', 'app', 'src', 'manifest.json');
/** 原生端构建元数据：Capacitor Android 工程 */
const GRADLE_FILE = join('apps', 'mobile', 'android', 'app', 'build.gradle');
/** 前端展示兜底常量（由本脚本生成，禁止手改） */
const APP_VERSION_FILE = join('apps', 'app', 'src', 'version.ts');
/** 一键安装向导生成的 api.env 模板（APP_VERSION 由本脚本同步，防止发版后漏改） */
const INSTALL_FILE = join('install', 'server.mjs');
const BEGIN = '<!-- version:begin -->';
const END = '<!-- version:end -->';

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function readText(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

function writeText(relativePath, content) {
  writeFileSync(join(root, relativePath), content, 'utf8');
}

/** 统一成 LF 再比较：Windows 检出是 CRLF、Linux CI 是 LF，不能因此误判不一致 */
function lf(text) {
  return text.replace(/\r\n/g, '\n');
}

function eolOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** 把按 LF 拼出来的内容换成目标文件既有的换行风格 */
function applyEol(text, eol) {
  return eol === '\n' ? text : text.split('\n').join(eol);
}

function loadState() {
  if (!existsSync(VERSION_FILE)) fail('缺少 version.json');
  const state = JSON.parse(readFileSync(VERSION_FILE, 'utf8'));
  if (!SEMVER4.test(state.next ?? '')) fail(`version.json next 不是合法四段式 X.Y.Z.B：${state.next}`);
  if (!Number.isInteger(state.build) || state.build < 1) {
    fail(`version.json build 必须是 >= 1 的整数：${state.build}`);
  }
  if (!['preview', 'release', 'dev'].includes(state.channel)) {
    fail(`version.json channel 只能是 preview / release / dev：${state.channel}`);
  }
  if (!Array.isArray(state.released)) fail('version.json released 必须是数组');
  for (const version of state.released) {
    if (!SEMVER4.test(version)) fail(`version.json released 含非法四段式版本号：${version}`);
  }
  return state;
}

function saveState(state) {
  writeFileSync(VERSION_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** 最新已发布的正式版本号（裸 X.Y.Z.B）；非 release 渠道还没有正式号，返回 null */
function releasedVersion(state) {
  if (state.channel !== 'release') return null;
  return state.released[state.released.length - 1] ?? state.next;
}

/** 展示用版本：release 显示最新已发布正式号（裸号）；preview / dev 带 -<channel> 后缀 */
function displayVersion(state) {
  if (state.channel === 'release') return releasedVersion(state) ?? state.next;
  return `${state.next}-${state.channel}`;
}

/** 构建元数据用四段式裸版本号：release 态取已发布正式号，其余态取 next */
function buildVersion(state) {
  return releasedVersion(state) ?? state.next;
}

/** npm / semver 只接受三段式：四段号截取前三段（0.0.0.0 → 0.0.0） */
function npmVersion(version) {
  return version.split('.').slice(0, 3).join('.');
}

/** 对外展示（带 V 前缀） */
function publicVersion(state) {
  return `V${displayVersion(state)}`;
}

function bumpFourth(version) {
  const [major, minor, patch, build] = version.split('.').map(Number);
  return `${major}.${minor}.${patch}.${build + 1}`;
}

/** 查询某个 tag 是否存在；返回 null 表示当前环境没有可用的 git 仓库 */
function gitTag(tag) {
  try {
    return execFileSync('git', ['tag', '--list', tag], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function readmeBlock(state) {
  const current = publicVersion(state);
  const currentNote =
    state.channel === 'release'
      ? '正式发布版本'
      : state.channel === 'preview'
        ? '内部预览构建，未对外发布'
        : '开发构建，未对外发布';
  const released =
    state.released.length === 0
      ? '无'
      : state.released.map((v) => `\`V${v}\``).join('、');
  const first = state.released[0] ?? state.next;
  return [
    BEGIN,
    `当前构建版本：**${current}**（${currentNote}）`,
    `已发布版本：${released}`,
    `版本规约：四段式，首发 \`V${first}\`，之后按第 4 位递增；npm 包版本取前三段；正式发布态以已发布版本为准；与 README 同步，细则见 [docs/19-versioning.md](docs/19-versioning.md)`,
    END,
  ].join('\n');
}

function expectedConfigLine(state) {
  return `str('APP_VERSION', '${displayVersion(state)}')`;
}

function expectedEnvLine(state) {
  return `APP_VERSION=${displayVersion(state)}`;
}

/** 前端兜底常量：页面在 API 不可达时展示的版本 */
function appVersionFile(state) {
  return [
    '// 由 scripts/version.mjs 生成，禁止手工修改。',
    '// 单一事实源：version.json —— 改版本请跑 pnpm version:sync / version:release。',
    `export const APP_VERSION = '${displayVersion(state)}';`,
    '',
  ].join('\n');
}


/** 用正则只改目标字段，保留 manifest / gradle 原有格式与注释 */
function replaceField(text, pattern, value) {
  return text.replace(pattern, (_all, prefix, _old, suffix) => `${prefix}${value}${suffix}`);
}

function sync() {
  const state = loadState();
  const built = buildVersion(state);

  for (const file of PKG_FILES) {
    const pkg = JSON.parse(readText(file));
    // npm / pnpm 只接受三段式 semver：四段号的第 4 段不写入 package.json
    const pkgVersion = npmVersion(built);
    if (pkg.version !== pkgVersion) {
      pkg.version = pkgVersion;
      writeText(file, `${JSON.stringify(pkg, null, 2)}\n`);
      console.log(`  · ${file} → ${pkgVersion}`);
    }
  }

  const env = readText(ENV_FILE);
  const envNext = env.replace(/^APP_VERSION=.*$/m, expectedEnvLine(state));
  if (envNext !== env) {
    writeText(ENV_FILE, envNext);
    console.log(`  · ${ENV_FILE} → ${displayVersion(state)}`);
  }

  const config = readText(CONFIG_FILE);
  const configNext = config.replace(/str\('APP_VERSION',\s*'[^']*'\)/, expectedConfigLine(state));
  if (configNext !== config) {
    if (!/str\('APP_VERSION'/.test(configNext)) fail(`${CONFIG_FILE} 里找不到 APP_VERSION 默认值`);
    writeText(CONFIG_FILE, configNext);
    console.log(`  · ${CONFIG_FILE} → ${displayVersion(state)}`);
  }

  const versionModule = appVersionFile(state);
  const versionModuleNow = existsSync(join(root, APP_VERSION_FILE)) ? readText(APP_VERSION_FILE) : '';
  if (lf(versionModuleNow) !== lf(versionModule)) {
    writeText(APP_VERSION_FILE, applyEol(versionModule, eolOf(versionModuleNow)));
    console.log(`  · ${APP_VERSION_FILE} → ${displayVersion(state)}`);
  }

  const install = readText(INSTALL_FILE);
  const installNext = install.replace(/'APP_VERSION=[^']*'/, `'APP_VERSION=${displayVersion(state)}'`);
  if (installNext !== install) {
    if (!/'APP_VERSION=[^']*'/.test(install)) fail(`${INSTALL_FILE} 里找不到 APP_VERSION 模板`);
    writeText(INSTALL_FILE, installNext);
    console.log(`  · ${INSTALL_FILE} → ${displayVersion(state)}`);
  }

  const manifest = readText(MANIFEST_FILE);
  const manifestNext = replaceField(
    manifest,
    /("versionName"\s*:\s*")([^"]*)(")/,
    built,
  ).replace(/"versionCode"\s*:\s*"([^"]*)"/, `"versionCode": "${state.build}"`);
  if (manifestNext !== manifest) {
    writeText(MANIFEST_FILE, manifestNext);
    console.log(`  · ${MANIFEST_FILE} → ${built} / build ${state.build}`);
  }

  // Android 壳从仓库根 version.json 动态读取 versionCode/versionName，
  // 这里绝不回写字面量——写死会把动态读取改坏，造成两处各说一套。
  const gradle = readText(GRADLE_FILE);
  if (!/rootProject\.file\(['"]\.\.\/\.\.\/\.\.\/version\.json['"]\)/.test(gradle)) {
    fail(`${GRADLE_FILE} 未指向仓库根 version.json，无法保持单一事实源`);
  }

  const readme = readText(README_FILE);
  const block = applyEol(readmeBlock(state), eolOf(readme));
  if (readme.includes(BEGIN) && readme.includes(END)) {
    const replaced = readme.replace(
      new RegExp(`${BEGIN}[\\s\\S]*?${END}`, 'm'),
      block,
    );
    if (replaced !== readme) {
      writeText(README_FILE, replaced);
      console.log(`  · ${README_FILE} → ${publicVersion(state)}`);
    }
  } else {
    fail(`${README_FILE} 缺少版本标记 ${BEGIN} / ${END}，无法同步`);
  }

  console.log(`✓ 同步完成：${publicVersion(state)}`);
}

function check() {
  const state = loadState();
  const built = buildVersion(state);
  const problems = [];

  // 任何通道下 next 都不得与已发布号重复：预览期防提前占号，正式态防把工作号误当已发布
  if (state.released.includes(state.next)) {
    problems.push(`版本 ${state.next} 已在 released 列表里，属于「已占用」，不能再作为待发布工作号`);
  }

  for (const file of PKG_FILES) {
    const version = JSON.parse(readText(file)).version;
    // package.json 只承载三段式映射号，四段号的第 4 段由 version.json / 构建元数据承载
    const expected = npmVersion(built);
    if (version !== expected) problems.push(`${file} 的 version=${version}，应为 ${expected}`);
  }

  if (!readText(ENV_FILE).includes(expectedEnvLine(state))) {
    problems.push(`${ENV_FILE} 的 APP_VERSION 与 ${displayVersion(state)} 不一致`);
  }
  if (!readText(CONFIG_FILE).includes(expectedConfigLine(state))) {
    problems.push(`${CONFIG_FILE} 的 APP_VERSION 默认值不是 ${displayVersion(state)}`);
  }
  if (!readText(INSTALL_FILE).includes(`'APP_VERSION=${displayVersion(state)}'`)) {
    problems.push(`${INSTALL_FILE} 的 APP_VERSION 模板不是 ${displayVersion(state)}`);
  }

  const versionNow = existsSync(join(root, APP_VERSION_FILE)) ? readText(APP_VERSION_FILE) : '';
  if (lf(versionNow) !== lf(appVersionFile(state))) {
    problems.push(`${APP_VERSION_FILE} 的 APP_VERSION 不是 ${displayVersion(state)}（该文件由脚本生成，勿手改）`);
  }

  const manifest = readText(MANIFEST_FILE);
  const manifestName = /"versionName"\s*:\s*"([^"]*)"/.exec(manifest)?.[1];
  if (manifestName !== built) {
    problems.push(`${MANIFEST_FILE} 的 versionName=${manifestName}，应为 ${built}（构建元数据用裸正式版本号）`);
  }
  const manifestBuild = /"versionCode"\s*:\s*"([^"]*)"/.exec(manifest)?.[1];
  if (manifestBuild !== String(state.build)) {
    problems.push(`${MANIFEST_FILE} 的 versionCode=${manifestBuild}，应为 ${state.build}`);
  }

  // Android 壳动态读取根 version.json：门禁只校验接线（指向文件、解析 JSON、
  // versionCode 取自 build、versionName 取自 next），不再匹配
  // 已不存在的 versionName/versionCode 字面量。
  const gradle = readText(GRADLE_FILE);
  if (!/rootProject\.file\(['"]\.\.\/\.\.\/\.\.\/version\.json['"]\)/.test(gradle)) {
    problems.push(`${GRADLE_FILE} 未指向仓库根 version.json（缺少 rootProject.file('../../../version.json')）`);
  }
  if (!/new\s+groovy\.json\.JsonSlurper\(\)\.parseText/.test(gradle)) {
    problems.push(`${GRADLE_FILE} 未用 JsonSlurper 解析 version.json`);
  }
  if (!/versionCode\s+mixmVersionCode/.test(gradle) || !/mixmVersionCode\s*=.*mixmVersion\.build/.test(gradle)) {
    problems.push(`${GRADLE_FILE} 的 versionCode 未取自 version.json 的 build`);
  }
  if (!/versionName\s+mixmVersionName/.test(gradle) || !/mixmVersionName\s*=.*mixmVersion\.next/.test(gradle)) {
    problems.push(`${GRADLE_FILE} 的 versionName 未取自 version.json 的 next`);
  }

  const readme = readText(README_FILE);
  if (!lf(readme).includes(lf(readmeBlock(state)))) {
    problems.push(`${README_FILE} 的版本块与 version.json 不同步（当前应为 ${publicVersion(state)}）`);
  }

  // 发布前不得占用正式版本号：未发布的号不允许存在同名 tag
  if (state.channel === 'preview') {
    const tags = gitTag(`v${state.next}`) ?? '';
    if (tags) problems.push(`tag ${tags} 已存在，但 ${state.next} 尚未发布（不得提前占用）`);
  }

  if (problems.length > 0) {
    problems.forEach((p) => console.error(`✗ ${p}`));
    process.exit(1);
  }
  console.log(`✓ 版本一致：${publicVersion(state)}（包 ${PKG_FILES.length} 个、env、config、install、manifest、gradle、前端常量、README、tag 均已核对）`);
}

function bump() {
  const state = loadState();
  if (!state.released.includes(state.next)) {
    fail(`当前 ${state.next} 还没正式发布，不能先占用下一个号（规约：发布前不得占用）`);
  }
  const prev = state.next;
  state.next = bumpFourth(prev);
  state.channel = 'preview';
  saveState(state);
  console.log(`✓ ${prev} 已发布，工作版本推进到 ${publicVersion(state)}`);
  sync();
}

function release() {
  const state = loadState();
  if (state.released.includes(state.next)) {
    fail(`${state.next} 已登记发布，无需重复发布`);
  }
  const tag = `v${state.next}`;
  const existing = gitTag(tag);
  if (existing) fail(`tag ${tag} 已存在，不能重复发布`);

  // 上一个已登记的号必须真的打上 tag（即真的发布过），否则不允许继续占用下一个号
  const lastReleased = state.released[state.released.length - 1];
  if (lastReleased) {
    const lastTag = `v${lastReleased}`;
    const lastTagExists = gitTag(lastTag);
    if (lastTagExists === null) {
      fail('当前环境没有可用的 git 仓库，无法确认上一版是否真的发布，拒绝占用新版本号');
    }
    if (!lastTagExists) {
      fail(`上一版 V${lastReleased} 还没打 tag ${lastTag}（说明并未真正发布），不能先占用 ${state.next}`);
    }
  }

  const releasedVer = state.next;
  state.released.push(releasedVer);
  state.build += 1;
  state.channel = 'release';
  state.next = bumpFourth(releasedVer);
  saveState(state);
  sync();

  console.log('');
  console.log(`✓ 已登记正式发布：V${releasedVer}（tag ${tag}）`);
  console.log(`  当前对外版本：${publicVersion(state)}（channel=release，展示与构建元数据统一取已发布正式号）`);
  console.log(`  下一个待发布工作号：${state.next} / build ${state.build}`);
  console.log(`  下一步（由发布流程执行，脚本不自动打 tag，避免误触发上线）：`);
  console.log(`    git add -A && git commit -m "release: V${releasedVer}"`);
  console.log(`    git tag -a ${tag} -m "MixmAPP ${releasedVer}" && git push origin main ${tag}`);
}

const command = process.argv[2];
switch (command) {
  case 'show':
    console.log(JSON.stringify({ ...loadState(), display: publicVersion(loadState()) }, null, 2));
    break;
  case 'check':
    check();
    break;
  case 'sync':
    sync();
    break;
  case 'bump':
    bump();
    break;
  case 'release':
    release();
    break;
  default:
    console.error('用法：node scripts/version.mjs <show|check|sync|bump|release>');
    process.exit(1);
}
