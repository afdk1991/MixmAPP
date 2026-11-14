#!/usr/bin/env node
/**
 * 版本号单一事实源：version.json
 *
 * 规约（详见 docs/19-versioning.md）：
 * - 三段式版本：X.Y.Z，基线 = 0.0.0（2026-11-14 全平台 / 全渠道强制重置）
 * - release 递增第三段：0.0.0 → 0.0.1
 * - preview 用 0.0.0-preview.N、dev 用 0.0.0-dev.N，后缀计数各自独立
 *   计数为 0 时展示裸后缀（0.0.0-preview / 0.0.0-dev），即当前强制重置态
 * - 发布前不得占用正式版本号：没有真正对外发布，就不能把该号写进 released，也不能打 tag
 * - 正式发布态下展示层取「最新已发布正式号」，version 仅表示下一个待发布工作号
 * - npm 包版本就是三段号本身；Android versionCode = 1 + major*10000 + minor*100 + patch
 * - 任何一处版本必须与 README 同步，不一致即门禁失败
 *
 * 命令：
 *   node scripts/version.mjs show            打印当前版本（含展示形式 / versionCode）
 *   node scripts/version.mjs check           校验全部版本位是否一致（CI 门禁用）
 *   node scripts/version.mjs sync            把 version.json 同步到各处
 *   node scripts/version.mjs bump [channel]  递增：release 升第三段；preview/dev 升各自后缀计数
 *   node scripts/version.mjs release         正式发布：把当前号登记进 released，并提示打 tag
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_FILE = join(root, 'version.json');
/** 三段式版本 X.Y.Z（每段非负整数、无前导零） */
const SEMVER3 = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CHANNELS = ['release', 'preview', 'dev'];

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
  if (state.next !== undefined && state.build !== undefined) {
    fail('version.json 仍是四段式结构（next/build）；三段式请写成 version / channel / released / counters');
  }
  if (!SEMVER3.test(state.version ?? '')) {
    fail(`version.json version 不是合法三段式 X.Y.Z：${state.version}`);
  }
  if (!CHANNELS.includes(state.channel)) {
    fail(`version.json channel 只能是 release / preview / dev：${state.channel}`);
  }
  if (!Array.isArray(state.released)) fail('version.json released 必须是数组');
  for (const version of state.released) {
    if (!SEMVER3.test(version)) fail(`version.json released 含非法三段号：${version}`);
  }
  const counters = state.counters ?? {};
  const normalized = { preview: 0, dev: 0 };
  for (const channel of ['preview', 'dev']) {
    const value = counters[channel] ?? 0;
    if (!Number.isInteger(value) || value < 0) {
      fail(`version.json counters.${channel} 必须是 >= 0 的整数：${value}`);
    }
    normalized[channel] = value;
  }
  return { ...state, counters: normalized };
}

function saveState(state) {
  const payload = {
    version: state.version,
    channel: state.channel,
    released: state.released,
    counters: state.counters,
  };
  writeFileSync(VERSION_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/** 当前工作号：所有通道都取 version，released 只用于记录已发布与打 tag 校验 */
function baseVersion(state) {
  return state.version;
}

/** 非正式通道的后缀：计数 0 → -preview / -dev，计数 N → -preview.N / -dev.N */
function channelTag(state) {
  if (state.channel === 'release') return '';
  const n = state.counters[state.channel] ?? 0;
  return `-${state.channel}${n > 0 ? `.${n}` : ''}`;
}

/** 展示号（README / 前端常量 / env / 安装向导）：可能带渠道后缀 */
function displayVersion(state) {
  if (state.channel === 'release') return baseVersion(state);
  return `${state.version}${channelTag(state)}`;
}

/** 构建元数据（package.json / manifest）：恒为裸三段号，不带渠道后缀 */
function buildVersion(state) {
  return baseVersion(state);
}

/** Android versionCode：0.0.0 → 1，0.0.1 → 2，0.1.0 → 101，1.0.0 → 10001 */
function versionCodeOf(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  return 1 + major * 10000 + minor * 100 + patch;
}

function bumpPatch(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function replaceOnce(text, pattern, replacement, label) {
  if (!pattern.test(text)) fail(`找不到 ${label} 的版本位，无法同步`);
  return text.replace(pattern, replacement);
}

function replaceBlock(text, nextBlock, label) {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start < 0 || end < 0 || end < start) fail(`找不到 ${label} 的版本块标记`);
  const after = end + END.length;
  return `${text.slice(0, start)}${nextBlock}${text.slice(after)}`;
}

function renderReadmeBlock(state) {
  const display = displayVersion(state);
  const released = state.released.length
    ? state.released.map((v) => `\`V${v}\``).join('、')
    : '无';
  return [
    BEGIN,
    `当前构建版本：**V${display}**（${state.channel === 'release' ? '正式发布版本' : `${state.channel} 通道`}）`,
    `已发布版本：${released}`,
    '版本规约：三段式，基线 `0.0.0`；release 递增第三段（`0.0.0 → 0.0.1`）；preview / dev 为 `0.0.0-preview.N` / `0.0.0-dev.N`，后缀计数各自独立；与 README 同步，细则见 [docs/19-versioning.md](docs/19-versioning.md)',
    END,
  ].join('\n');
}

/** 把 version.json 同步到所有落字面量的位置；gradle 直接读 version.json，只校验接线 */
function sync(state = loadState()) {
  const display = displayVersion(state);
  const built = buildVersion(state);
  const code = String(versionCodeOf(built));

  for (const file of PKG_FILES) {
    const text = readText(file);
    const next = replaceOnce(
      text,
      /("version"\s*:\s*")[^"]*(")/,
      `$1${built}$2`,
      file,
    );
    if (lf(next) !== lf(text)) writeText(file, next);
  }

  {
    const text = readText(ENV_FILE);
    const next = replaceOnce(text, /^APP_VERSION=.*$/m, `APP_VERSION=${display}`, ENV_FILE);
    if (lf(next) !== lf(text)) writeText(ENV_FILE, next);
  }

  {
    const text = readText(CONFIG_FILE);
    const next = replaceOnce(
      text,
      /(str\('APP_VERSION',\s*')[^']*(')/,
      `$1${display}$2`,
      CONFIG_FILE,
    );
    if (lf(next) !== lf(text)) writeText(CONFIG_FILE, next);
  }

  {
    const text = readText(INSTALL_FILE);
    const next = replaceOnce(
      text,
      /'APP_VERSION=[^']*'/,
      `'APP_VERSION=${display}'`,
      INSTALL_FILE,
    );
    if (lf(next) !== lf(text)) writeText(INSTALL_FILE, next);
  }

  {
    const text = readText(APP_VERSION_FILE);
    const next = replaceOnce(
      text,
      /(export const APP_VERSION = ')[^']*(';)/,
      `$1${display}$2`,
      APP_VERSION_FILE,
    );
    if (lf(next) !== lf(text)) writeText(APP_VERSION_FILE, next);
  }

  {
    const text = readText(MANIFEST_FILE);
    let next = replaceOnce(
      text,
      /("versionName"\s*:\s*")[^"]*(")/,
      `$1${built}$2`,
      `${MANIFEST_FILE} versionName`,
    );
    next = replaceOnce(
      next,
      /("versionCode"\s*:\s*)"?[^",]*"?/,
      `$1"${code}"`,
      `${MANIFEST_FILE} versionCode`,
    );
    if (lf(next) !== lf(text)) writeText(MANIFEST_FILE, next);
  }

  {
    const text = readText(README_FILE);
    const next = replaceBlock(text, renderReadmeBlock(state), README_FILE);
    if (lf(next) !== lf(text)) writeText(README_FILE, next);
  }

  return { display, built, code };
}

function gradleChecks(state) {
  const display = displayVersion(state);
  const built = buildVersion(state);
  const code = String(versionCodeOf(built));
  const gradle = readText(GRADLE_FILE);
  const problems = [];

  if (!/rootProject\.file\('\.\.\/\.\.\/\.\.\/version\.json'\)/.test(gradle)) {
    problems.push('gradle 未指向仓库根 version.json');
  }
  if (!/new\s+groovy\.json\.JsonSlurper\(\)\.parseText/.test(gradle)) {
    problems.push('gradle 未解析 version.json');
  }
  if (!/mixmVersion\.version/.test(gradle)) {
    problems.push('gradle 未读取 version 字段');
  }
  if (!/versionCode\s+mixmVersionCode/.test(gradle) || !/mixmVersionCode\s*=\s*1\s*\+/.test(gradle)) {
    problems.push(`gradle versionCode 未接线到三段号推导（期望 ${code}）`);
  }
  if (!/versionName\s+mixmVersionName/.test(gradle) || !/mixmVersionName\s*=\s*mixmBaseVersion/.test(gradle)) {
    problems.push(`gradle versionName 未接线（期望 ${built}/${display}）`);
  }
  return problems;
}

function gitTagExists(tag) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/** 校验全部版本位 */
function check() {
  const state = loadState();
  const { display, built, code } = syncReadOnly(state);
  const problems = [];

  if (state.released.includes(state.version)) {
    problems.push(`version.json 的 version ${state.version} 已登记为 released，工作号必须前进`);
  }

  for (const file of PKG_FILES) {
    const text = readText(file);
    const match = /"version"\s*:\s*"([^"]*)"/.exec(text);
    const actual = match ? match[1] : '(缺失)';
    if (actual !== built) problems.push(`${file} version=${actual}，期望 ${built}`);
  }

  {
    const match = /^APP_VERSION=(.*)$/m.exec(readText(ENV_FILE));
    const actual = match ? match[1].trim() : '(缺失)';
    if (actual !== display) problems.push(`${ENV_FILE} APP_VERSION=${actual}，期望 ${display}`);
  }

  {
    const match = /str\('APP_VERSION',\s*'([^']*)'\)/.exec(readText(CONFIG_FILE));
    const actual = match ? match[1] : '(缺失)';
    if (actual !== display) problems.push(`${CONFIG_FILE} APP_VERSION=${actual}，期望 ${display}`);
  }

  {
    const match = /'APP_VERSION=([^']*)'/.exec(readText(INSTALL_FILE));
    const actual = match ? match[1] : '(缺失)';
    if (actual !== display) problems.push(`${INSTALL_FILE} APP_VERSION=${actual}，期望 ${display}`);
  }

  {
    const match = /export const APP_VERSION = '([^']*)';/.exec(readText(APP_VERSION_FILE));
    const actual = match ? match[1] : '(缺失)';
    if (actual !== display) problems.push(`${APP_VERSION_FILE} APP_VERSION=${actual}，期望 ${display}`);
  }

  {
    const text = readText(MANIFEST_FILE);
    const nameMatch = /"versionName"\s*:\s*"([^"]*)"/.exec(text);
    const codeMatch = /"versionCode"\s*:\s*"?([^",]*)"?/.exec(text);
    const name = nameMatch ? nameMatch[1] : '(缺失)';
    const actualCode = codeMatch ? codeMatch[1].trim() : '(缺失)';
    if (name !== built) problems.push(`${MANIFEST_FILE} versionName=${name}，期望 ${built}`);
    if (actualCode !== code) problems.push(`${MANIFEST_FILE} versionCode=${actualCode}，期望 ${code}`);
  }

  {
    const text = readText(README_FILE);
    if (!text.includes(BEGIN) || !text.includes(END)) {
      problems.push(`${README_FILE} 缺少版本块标记`);
    } else {
      const start = text.indexOf(BEGIN);
      const end = text.indexOf(END) + END.length;
      const block = text.slice(start, end);
      if (!block.includes(`V${display}`)) {
        problems.push(`${README_FILE} 版本块未同步到 V${display}`);
      }
    }
  }

  problems.push(...gradleChecks(state));

  if (state.channel !== 'release') {
    const tag = `v${state.version}`;
    if (state.released.includes(state.version)) {
      // 已在上面报过
    } else if (gitTagExists(tag)) {
      problems.push(`tag ${tag} 已存在但 ${state.version} 未登记发布：${state.channel} 通道不得占用未发布版本号`);
    }
  }

  if (problems.length) {
    console.error('✗ 版本一致性校验未通过：');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.info(`✓ 版本一致性校验通过：构建 ${built}（versionCode ${code}）/ 展示 ${display}（channel=${state.channel}）`);
}

/** check 不能写文件：按 sync 的同一口径推导期望值 */
function syncReadOnly(state) {
  const built = buildVersion(state);
  return {
    display: displayVersion(state),
    built,
    code: String(versionCodeOf(built)),
  };
}

function show() {
  const state = loadState();
  const { display, built, code } = syncReadOnly(state);
  console.info(`version.json      : ${state.version}`);
  console.info(`channel           : ${state.channel}`);
  console.info(`released          : ${state.released.length ? state.released.join(', ') : '(无)'}`);
  console.info(`counters          : preview=${state.counters.preview} dev=${state.counters.dev}`);
  console.info(`displayVersion    : ${display}`);
  console.info(`buildVersion      : ${built}`);
  console.info(`versionCode       : ${code}`);
}

/** 递增：release 升第三段；preview / dev 升各自后缀计数 */
function bump(requested) {
  const state = loadState();
  const channel = requested ?? 'release';
  if (!CHANNELS.includes(channel)) {
    fail(`bump 只接受 release / preview / dev：${channel}`);
  }

  if (channel === 'release') {
    const previous = state.version;
    state.version = bumpPatch(previous);
    state.channel = 'release';
    state.counters = { preview: 0, dev: 0 };
    saveState(state);
    const { display, code } = sync(state);
    console.info(`✓ release 递增第三段：${previous} → ${state.version}（展示 ${display}，versionCode ${code}）`);
    return;
  }

  state.counters[channel] += 1;
  state.channel = channel;
  saveState(state);
  const { display } = sync(state);
  console.info(`✓ ${channel} 后缀计数递增：${display}`);
}

/** 正式发布：占用当前工作号，推进到下一个工作号 */
function release() {
  const state = loadState();
  const version = state.version;

  if (state.released.includes(version)) {
    fail(`${version} 已登记为 released，不能重复发布；先 bump 到新号`);
  }

  const tag = `v${version}`;
  if (gitTagExists(tag)) {
    fail(`tag ${tag} 已存在，${version} 不能再次作为新版本发布`);
  }

  const lastReleased = state.released[state.released.length - 1];
  if (lastReleased && !gitTagExists(`v${lastReleased}`)) {
    fail(`上一版 V${lastReleased} 还没有 tag v${lastReleased}：请先打 tag 再发布新版本`);
  }

  state.released.push(version);
  state.counters = { preview: 0, dev: 0 };
  state.channel = 'release';
  saveState(state);
  const { display, code } = sync(state);

  console.info(`✓ 已发布 V${version}（versionCode ${code}）；当前展示号 ${display}`);
  console.info(`  下一步：git tag v${version} && git push origin v${version}`);
  console.info('  下一个正式版：先 pnpm version:bump（第三段 +1）再构建发布');
}

const [command, arg] = process.argv.slice(2);

switch (command) {
  case 'show':
    show();
    break;
  case 'check':
    check();
    break;
  case 'sync': {
    const { display } = sync();
    console.info(`✓ 已同步版本到各处：展示 ${display}`);
    break;
  }
  case 'bump':
    bump(arg);
    break;
  case 'release':
    release();
    break;
  default:
    console.error('用法：node scripts/version.mjs <show|check|sync|bump [release|preview|dev]|release>');
    process.exit(1);
}
