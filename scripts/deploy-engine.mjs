#!/usr/bin/env node
/**
 * 自动部署引擎：把「构建 → 校验 → 打包 → 上传 → 原子发布 → 线上断言 → 回滚」串成一条命令。
 *
 * 为什么要有它：此前上线靠散落的 pnpm build / scp / ssh 手敲，谁在什么时候发了什么版本、
 * 发失败怎么退回，全靠人记。引擎把每一步变成有退出码、有产物哈希、有台账的阶段，
 * 任何一步失败即停；线上断言不通过自动回滚到上一版。
 *
 * 八个阶段（顺序执行，失败即停）：
 *   1 preflight  分支 / 工作树 / 版本号 / 门禁 / 私钥 / 生产连通性
 *   2 build      build:api + build:h5（注入正式 API 与媒体基址）
 *   3 verify     产物抽检（deploy/check-h5-artifacts.mjs）+ 基址 / 预览残留 / 版本断言
 *   4 package    pnpm deploy --prod + 打 api/h5 包 + 记 sha256
 *   5 ship       scp 到生产机 /tmp（仅 --apply）
 *   6 release    远端 deploy/atomic-release.sh（flock 互斥 + 健康检查 + 自身回滚）
 *   7 assert     线上 meta.version / env / demoMode、healthz、站点可达
 *   8 ledger     release/deploy-ledger.jsonl 追加一条，release/deploy-last.json 覆盖最新
 *
 * 用法：
 *   node scripts/deploy-engine.mjs                 演练：真构建、真打包、真校验，不上传（默认）
 *   node scripts/deploy-engine.mjs --apply         正式发布（工作树必须干净）
 *   node scripts/deploy-engine.mjs --apply --from-head
 *                                                  用 HEAD 的干净副本构建后发布（工作树有别人改动时）
 *   node scripts/deploy-engine.mjs --verify-only   只做线上断言（CI 发布后校验用）
 *   node scripts/deploy-engine.mjs --skip-build    复用已有产物与包（仍会校验与上传）
 *
 * 常用参数：
 *   --host=115.159.159.11   --user=root   --key=<私钥路径>   --service=mixmapp-api
 *   --api-base=https://api.mixm.top/mixmapp/api/v1   --media-base=https://img.mixm.top
 *   --base=https://cloud.mixm.top（线上断言目标）    --expect-version=0.0.2
 *   --no-rollback          断言失败时不自动回滚（排查用）
 *
 * 退出码：0 成功 / 1 阶段失败 / 2 配置或预检不通过 / 4 本机已有部署在跑
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const PNPM = IS_WIN ? 'pnpm.CMD' : 'pnpm';

function parseArgs(argv) {
  const out = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const body = raw.slice(2);
    const idx = body.indexOf('=');
    if (idx === -1) out[body] = true;
    else out[body.slice(0, idx)] = body.slice(idx + 1);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const cfg = {
  apply: Boolean(args.apply),
  fromHead: Boolean(args['from-head']),
  verifyOnly: Boolean(args['verify-only']),
  skipBuild: Boolean(args['skip-build']),
  noRollback: Boolean(args['no-rollback']),
  host: String(args.host ?? process.env.DEPLOY_HOST ?? '115.159.159.11'),
  user: String(args.user ?? process.env.DEPLOY_USER ?? 'root'),
  key: resolve(String(args.key ?? process.env.DEPLOY_KEY ?? join(homedir(), '.ssh', 'mixmapp_deploy'))),
  service: String(args.service ?? process.env.DEPLOY_SERVICE ?? 'mixmapp-api'),
  apiBase: String(args['api-base'] ?? process.env.MIXMAPP_API_BASE ?? 'https://api.mixm.top/mixmapp/api/v1'),
  mediaBase: String(args['media-base'] ?? process.env.MIXMAPP_MEDIA_BASE ?? 'https://img.mixm.top'),
  base: String(args.base ?? process.env.VERIFY_BASE ?? 'https://cloud.mixm.top').replace(/\/+$/, ''),
  expectVersion: String(args['expect-version'] ?? process.env.EXPECT_VERSION ?? '').trim(),
  stepTimeoutMs: Number(process.env.DEPLOY_STEP_TIMEOUT_MS ?? 15 * 60 * 1000),
};

if (args.help || args.h) {
  const header = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n/, '');
  console.info(
    header
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, '').replace(/^\s*\/\*\*\s?/, ''))
      .join('\n'),
  );
  process.exit(0);
}

const ARTIFACT_DIR = join(ROOT, 'out', 'deploy-artifacts');
const LEDGER_FILE = join(ROOT, 'release', 'deploy-ledger.jsonl');
const LAST_FILE = join(ROOT, 'release', 'deploy-last.json');
const LOCK_FILE = join(ROOT, 'release', '.deploy.lock');
const STAMP = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\..*/, '')
  .replace('T', '');

const stages = [];
const startedAt = Date.now();

class EngineError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

function log(line = '') {
  console.info(line);
}

function quote(arg) {
  return /[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}

/** 同步执行；失败抛 EngineError，stdout 可回传用于断言。 */
function run(cmd, cmdArgs, opts = {}) {
  const useShell = opts.shell ?? true;
  const argv = useShell ? cmdArgs.map(quote) : cmdArgs;
  const res = spawnSync(cmd, argv, {
    cwd: opts.cwd ?? ROOT,
    stdio: opts.quiet ? 'pipe' : 'inherit',
    shell: useShell,
    env: { ...process.env, ...(opts.env ?? {}) },
    encoding: 'utf8',
    timeout: opts.timeout ?? cfg.stepTimeoutMs,
  });
  if (res.error) throw new EngineError(`无法执行 ${cmd}：${res.error.message}`);
  if (res.status !== 0) {
    const tail = opts.quiet ? String(res.stderr || res.stdout || '').trim().split(/\r?\n/).slice(-3).join(' / ') : '';
    throw new EngineError(`${cmd} ${cmdArgs.join(' ')} 退出码 ${res.status}${tail ? `：${tail}` : ''}`);
  }
  return { stdout: String(res.stdout ?? ''), stderr: String(res.stderr ?? '') };
}

/** 取 stdout 结果（失败直接抛），用于 git/ssh 这类查询命令。 */
function read(cmd, cmdArgs, opts = {}) {
  return run(cmd, cmdArgs, { ...opts, quiet: true }).stdout.trim();
}

function beginStage(index, total, name) {
  log('');
  log(`▶ [${index}/${total}] ${name}`);
  return { name, index, startedAt: Date.now() };
}

function endStage(stage, detail) {
  stages.push({ name: stage.name, status: 'ok', detail: detail ?? '', ms: Date.now() - stage.startedAt });
  log(detail ? `✓ ${stage.name} — ${detail}` : `✓ ${stage.name}`);
}

/** 目录复制：不用 fs.cpSync（本机 Node 22 在含非 ASCII 路径下会原生崩溃），逐文件复制。 */
function copyDir(from, to, skip = new Set()) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest, skip);
    else writeFileSync(dest, readFileSync(src));
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase();
}

function bytes(file) {
  return statSync(file).size;
}

function readVersion(file = join(ROOT, 'version.json')) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function displayVersion(v) {
  const channel = String(v.channel ?? 'release');
  if (channel === 'release') return String(v.version);
  const n = Number((v.counters ?? {})[channel] ?? 0);
  return `${v.version}-${channel}${n > 0 ? '.' + n : ''}`;
}

function versionCode(v) {
  const [major = 0, minor = 0, patch = 0] = String(v.version).split('.').map(Number);
  return 1 + major * 10000 + minor * 100 + patch;
}

const sshBase = ['-i', cfg.key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15'];
const target = `${cfg.user}@${cfg.host}`;

function ssh(remoteCmd, opts = {}) {
  return run('ssh', [...sshBase, target, remoteCmd], opts);
}

function scp(localPath, remotePath) {
  run('scp', ['-i', cfg.key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-r', localPath, `${target}:${remotePath}`]);
}

/** GET + JSON；网络错/非 JSON 都返回结构而不是抛，交给断言判。 */
async function getJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { ok: true, status: res.status, json, text, contentType: res.headers.get('content-type') ?? '' };
  } catch (error) {
    return { ok: false, status: 0, json: null, text: String(error?.message ?? error), contentType: '' };
  }
}

/** 线上断言：返回逐条结果，任意一条 false 即视为发布未生效。 */
async function assertOnline(expectedVersion) {
  const checks = [];
  const push = (name, pass, detail) => {
    checks.push({ name, pass, detail });
    log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const meta = await getJson(`${cfg.base}/api/v1/meta`);
  const payload = meta.json?.data ?? meta.json ?? {};
  push('meta 可达', meta.ok && meta.status === 200, meta.ok ? `HTTP ${meta.status}` : meta.text);
  const version = String(payload.version ?? '');
  if (expectedVersion === 'any') {
    // 回滚场景不知道目标号，只要求是正式号（无 -preview/-test/-gray 后缀）
    push('线上版本为正式号', /^\d+\.\d+\.\d+$/.test(version), version || '(空)');
  } else {
    push('线上版本 == 期望', version === expectedVersion, `${version || '(空)'} vs ${expectedVersion}`);
  }
  const env = String(payload.env ?? '');
  push('环境标记 production', env === 'production', env || '(空)');
  const demo = payload.mall?.demoMode;
  if (typeof demo === 'boolean') push('演示沙箱关闭', demo === false, demo ? 'demoMode=true' : 'demoMode=false');
  else push('演示沙箱关闭', false, 'meta 未返回 mall.demoMode，无法确认正式链路');

  const health = await getJson(`${cfg.base}/api/v1/healthz`);
  const status = String(health.json?.status ?? '');
  push('healthz ok', health.ok && health.status === 200 && status === 'ok', health.ok ? `status=${status || '(空)'}` : health.text);

  const site = await getJson(`${cfg.base}/`);
  const looksHtml = /text\/html/.test(site.contentType) || /<html/i.test(site.text.slice(0, 500));
  push('站点首页可达', site.ok && site.status === 200 && looksHtml, site.ok ? `HTTP ${site.status}` : site.text);

  return checks;
}

function writeLedger(record) {
  try {
    mkdirSync(dirname(LEDGER_FILE), { recursive: true });
    appendFileSync(LEDGER_FILE, `${JSON.stringify(record)}\n`, 'utf8');
    writeFileSync(LAST_FILE, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  } catch (error) {
    log(`⚠ 台账写入失败（不影响发布结果）：${error?.message ?? error}`);
  }
}

function acquireLock() {
  try {
    mkdirSync(dirname(LOCK_FILE), { recursive: true });
  } catch {
    /* release/ 建不出来就让下面的写文件报错 */
  }
  if (existsSync(LOCK_FILE)) {
    const ageMin = (Date.now() - statSync(LOCK_FILE).mtimeMs) / 60000;
    if (ageMin < 30) {
      throw new EngineError(
        `release/.deploy.lock 存在 ${ageMin.toFixed(1)} 分钟，另一个部署进程可能正在跑；确认无进程后删除该文件重试`,
        4,
      );
    }
    log(`⚠ 清理过期锁（${ageMin.toFixed(0)} 分钟前）`);
  }
  writeFileSync(LOCK_FILE, `${process.pid} ${new Date().toISOString()}\n`, 'utf8');
}

function releaseLock() {
  try {
    rmSync(LOCK_FILE, { force: true });
  } catch {
    /* 忽略 */
  }
}

function prepareSource() {
  if (!cfg.fromHead) return { workRoot: ROOT, note: '使用当前工作树' };
  const srcRoot = join(ROOT, 'out', 'deploy-src');
  rmSync(srcRoot, { recursive: true, force: true });
  mkdirSync(srcRoot, { recursive: true });
  const tarPath = join(ROOT, 'out', 'head-snapshot.tar');
  run('git', ['archive', '--format=tar', '-o', tarPath, 'HEAD']);
  run('tar', ['-xf', tarPath, '-C', srcRoot]);
  rmSync(tarPath, { force: true });
  run(PNPM, ['install', '--frozen-lockfile'], { cwd: srcRoot });
  return { workRoot: srcRoot, note: '使用 HEAD 干净副本' };
}

async function main() {
  const v = readVersion();
  const expectedVersion = cfg.expectVersion || displayVersion(v);

  if (cfg.verifyOnly) {
    log(`▶ 只做线上断言：${cfg.base}（期望版本 ${expectedVersion}）`);
    const checks = await assertOnline(expectedVersion);
    const bad = checks.filter((c) => !c.pass);
    const record = {
      ts: new Date().toISOString(),
      mode: 'verify-only',
      host: cfg.host,
      base: cfg.base,
      expectVersion: expectedVersion,
      result: bad.length ? 'failed' : 'success',
      checks,
      durationMs: Date.now() - startedAt,
    };
    writeLedger(record);
    if (bad.length) {
      log(`✗ 线上断言未通过 ${bad.length} 条`);
      return 1;
    }
    log(`✓ 线上断言全部通过（${checks.length} 条）`);
    return 0;
  }

  log(`MixmAPP 自动部署引擎 ${cfg.apply ? '（正式发布）' : '（演练模式，不上传）'}`);
  log(`版本 ${expectedVersion}（versionCode ${versionCode(v)}）  目标 ${target}  断言 ${cfg.base}`);
  acquireLock();

  // 1 preflight
  const branch = read('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = read('git', ['rev-parse', '--short', 'HEAD']);
  const dirty = read('git', ['status', '--porcelain']);
  const stage1 = beginStage(1, 8, '预检');
  if (cfg.apply && branch !== 'main') throw new EngineError(`当前分支 ${branch}，正式发布只允许 main`, 2);
  if (cfg.apply && dirty && !cfg.fromHead) {
    throw new EngineError(`工作树有未提交改动，拒绝把未定稿内容发上生产：\n${dirty}\n  用 --from-head 只发布已提交的 HEAD，或先提交`, 2);
  }
  if (dirty && !cfg.apply) log(`⚠ 工作树不干净（演练不拦截，正式发布会拦）：\n${dirty}`);
  if (cfg.apply && !existsSync(cfg.key)) throw new EngineError(`缺少部署私钥 ${cfg.key}`, 2);
  const probe = cfg.apply
    ? read('ssh', [...sshBase, target, `hostname; systemctl is-active ${cfg.service}; readlink -f /opt/mixmapp/current`])
    : '';
  if (cfg.apply) log(`生产连通：${probe.replaceAll('\n', ' / ')}`);
  run(PNPM, ['run', 'version:check']);
  run(PNPM, ['run', 'lint']);
  endStage(stage1, `分支 ${branch} @ ${head}${dirty ? '（工作树有改动）' : '（工作树干净）'}`);

  // 2 build
  const stage2 = beginStage(2, 8, '构建');
  const prepared = prepareSource();
  if (prepared.note !== '使用当前工作树') log(`源码来源：${prepared.note}（${prepared.workRoot}）`);
  if (cfg.skipBuild) {
    log('跳过构建（--skip-build）：复用已有 apps/app/dist/build/h5 与 API 产物');
  } else {
    run(PNPM, ['run', 'build:api'], { cwd: prepared.workRoot });
    run(PNPM, ['run', 'build:h5'], {
      cwd: prepared.workRoot,
      env: { MIXMAPP_API_BASE: cfg.apiBase, MIXMAPP_MEDIA_BASE: cfg.mediaBase },
    });
  }
  endStage(stage2, cfg.skipBuild ? '复用已有产物' : `API + H5 构建完成，基址 ${cfg.apiBase}`);

  // 3 verify
  const stage3 = beginStage(3, 8, '产物校验');
  const h5Dir = join(prepared.workRoot, 'apps', 'app', 'dist', 'build', 'h5');
  const apiEntry = join(prepared.workRoot, 'services', 'api', 'dist', 'index.js');
  if (!existsSync(join(h5Dir, 'index.html'))) throw new EngineError(`缺少 H5 入口 ${join(h5Dir, 'index.html')}，先构建`);
  if (!existsSync(apiEntry)) throw new EngineError(`缺少 API 产物 ${apiEntry}，先构建`);
  run('node', ['deploy/check-h5-artifacts.mjs', h5Dir], { cwd: prepared.workRoot });
  const indexHtml = readFileSync(join(h5Dir, 'index.html'), 'utf8');
  if (!indexHtml.includes(cfg.apiBase)) throw new EngineError(`H5 未注入 API 基址 ${cfg.apiBase}`);
  if (cfg.mediaBase && !indexHtml.includes(cfg.mediaBase)) throw new EngineError(`H5 未注入媒体基址 ${cfg.mediaBase}`);
  if (/预览版|预览态|preview build/i.test(indexHtml)) throw new EngineError('H5 入口仍含「预览」字样');
  const versionTs = readFileSync(join(prepared.workRoot, 'apps', 'app', 'src', 'version.ts'), 'utf8');
  if (!versionTs.includes(`'${expectedVersion}'`)) throw new EngineError(`apps/app/src/version.ts 不是 ${expectedVersion}，先跑 pnpm version:sync`);
  endStage(stage3, '抽检通过：无预览残留、基址与版本一致');

  // 4 package
  const stage4 = beginStage(4, 8, '打包');
  const stageRoot = join(prepared.workRoot, 'out', 'deploy-stage');
  const pkgDir = join(stageRoot, 'pkg-api');
  rmSync(stageRoot, { recursive: true, force: true });
  mkdirSync(pkgDir, { recursive: true });
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  // 目标目录必须给绝对路径：pnpm deploy 对相对路径的解析基准是「被 deploy 的包目录」而不是
  // 当前工作目录，给相对路径会在 services/api/out/ 下另建一份空目录并让 .bin 链接指错（实测）。
  run(PNPM, ['--filter', '@mixmapp/api', 'deploy', '--prod', pkgDir], { cwd: prepared.workRoot });
  // 兜底清理：即便 pnpm 仍按包目录解析，也不把空壳目录留在 services/api/out。
  rmSync(join(prepared.workRoot, 'services', 'api', 'out', 'deploy-stage'), { recursive: true, force: true });
  // 与 CI 的发布包保持一致：version.json（远端据此回退解析版本）+ infra + scripts。
  writeFileSync(join(pkgDir, 'version.json'), readFileSync(join(prepared.workRoot, 'version.json')));
  copyDir(join(prepared.workRoot, 'infra'), join(pkgDir, 'infra'));
  copyDir(join(prepared.workRoot, 'scripts'), join(pkgDir, 'scripts'));

  const apiTar = join(ARTIFACT_DIR, `api-${STAMP}.tar.gz`);
  const h5Tar = join(ARTIFACT_DIR, `h5-${STAMP}.tar.gz`);
  rmSync(apiTar, { force: true });
  rmSync(h5Tar, { force: true });
  // Windows 自带 bsdtar 不认 --force-local（GNU tar 才需要），按平台区分。
  run('tar', [...(IS_WIN ? [] : ['--force-local']), '-czf', apiTar, '-C', pkgDir, '.']);
  run('tar', [...(IS_WIN ? [] : ['--force-local']), '-czf', h5Tar, '-C', h5Dir, '.']);
  const artifacts = [
    { file: apiTar, bytes: bytes(apiTar), sha256: sha256(apiTar) },
    { file: h5Tar, bytes: bytes(h5Tar), sha256: sha256(h5Tar) },
  ];
  rmSync(stageRoot, { recursive: true, force: true });
  for (const a of artifacts) log(`  ${a.file}  ${(a.bytes / 1024).toFixed(0)} KB  sha256 ${a.sha256.slice(0, 16)}…`);
  endStage(stage4, `${artifacts.length} 个包，共 ${(artifacts.reduce((s, a) => s + a.bytes, 0) / 1024 / 1024).toFixed(1)} MB`);

  if (!cfg.apply) {
    const record = {
      ts: new Date().toISOString(),
      mode: 'plan',
      version: expectedVersion,
      versionCode: versionCode(v),
      commit: head,
      branch,
      host: cfg.host,
      base: cfg.base,
      artifacts,
      stages,
      result: 'prepared',
      durationMs: Date.now() - startedAt,
      note: '演练：已构建并打包校验，未上传生产',
    };
    writeLedger(record);
    log('');
    log('✓ 演练完成：产物与校验全部通过，未触达生产。正式发布用 --apply（推荐加 --from-head）。');
    log(`  台账 ${LEDGER_FILE}`);
    return 0;
  }

  // 5 ship
  const stage5 = beginStage(5, 8, '上传生产机');
  ssh('rm -rf /tmp/mixmapp-deploy && mkdir -p /tmp/mixmapp-deploy');
  scp(apiTar, '/tmp/api.tar.gz');
  scp(h5Tar, '/tmp/web.tar.gz');
  scp(join(ROOT, 'deploy'), '/tmp/mixmapp-deploy/');
  const remoteSizes = read('ssh', [...sshBase, target, 'stat -c "%n %s" /tmp/api.tar.gz /tmp/web.tar.gz']);
  log(remoteSizes.replaceAll('\n', ' | '));
  const remoteApiSize = Number(remoteSizes.split('\n').find((l) => l.includes('api.tar.gz'))?.split(' ').pop() ?? 0);
  if (remoteApiSize !== artifacts[0].bytes) throw new EngineError(`上传不完整：远端 ${remoteApiSize} B != 本地 ${artifacts[0].bytes} B`);
  endStage(stage5, '两个包与 deploy 目录已就位');

  // 6 release
  const stage6 = beginStage(6, 8, '远端原子发布');
  const releaseCmd = [
    'mkdir -p /opt/mixmapp/deploy',
    'cp -rf /tmp/mixmapp-deploy/deploy/. /opt/mixmapp/deploy/',
    `APP_VERSION=${expectedVersion} ARTIFACT=/tmp/api.tar.gz WEB_ARTIFACT=/tmp/web.tar.gz bash /opt/mixmapp/deploy/atomic-release.sh`,
  ].join(' && ');
  ssh(releaseCmd);
  const remoteRelease = read('ssh', [...sshBase, target, 'readlink -f /opt/mixmapp/current']);
  endStage(stage6, `release ${remoteRelease.split('/').pop()}`);

  // 7 assert
  const stage7 = beginStage(7, 8, '线上断言');
  const checks = await assertOnline(expectedVersion);
  const bad = checks.filter((c) => !c.pass);
  let result = bad.length ? 'failed' : 'success';
  if (bad.length) {
    log(`✗ 断言未通过 ${bad.length} 条：${bad.map((c) => c.name).join('、')}`);
    if (cfg.noRollback) {
      log('⚠ 指定了 --no-rollback，保持当前版本供排查');
    } else {
      log('▶ 自动回滚到上一版');
      ssh('bash /opt/mixmapp/deploy/rollback.sh 1');
      const after = await assertOnline(expectedVersion);
      const stillBad = after.filter((c) => !c.pass);
      result = stillBad.length ? 'rollback-failed' : 'rolled-back';
      log(stillBad.length ? '✗ 回滚后仍不健康，需人工介入' : '✓ 已回滚到上一版且健康');
    }
  }
  endStage(
    stage7,
    bad.length
      ? `失败 ${bad.length} 条（${bad.map((c) => c.name).join('、')}）→ ${result}`
      : `全部 ${checks.length} 条通过`,
  );

  const record = {
    ts: new Date().toISOString(),
    mode: 'apply',
    version: expectedVersion,
    versionCode: versionCode(v),
    commit: head,
    branch,
    host: cfg.host,
    base: cfg.base,
    source: prepared.note,
    artifacts,
    remoteRelease,
    checks,
    stages,
    result,
    durationMs: Date.now() - startedAt,
  };

  // 8 ledger
  const stage8 = beginStage(8, 8, '台账');
  writeLedger(record);
  endStage(stage8, LEDGER_FILE.replaceAll(ROOT + sep, ''));

  log('');
  if (result !== 'success') {
    log(`✗ 发布未完成（${result}），台账 ${LEDGER_FILE}`);
    return 1;
  }
  log(`✓ 发布完成：${expectedVersion} → ${remoteRelease}`);
  log(`  用时 ${((Date.now() - startedAt) / 1000).toFixed(0)}s，台账 ${LEDGER_FILE}`);
  return 0;
}

main()
  .then((code) => {
    releaseLock();
    process.exit(code);
  })
  .catch((error) => {
    const code = error instanceof EngineError ? error.code : 1;
    log('');
    log(`✗ ${error instanceof EngineError ? error.message : String(error?.stack ?? error)}`);
    const record = {
      ts: new Date().toISOString(),
      mode: cfg.apply ? 'apply' : cfg.verifyOnly ? 'verify-only' : 'plan',
      result: 'error',
      stages,
      error: String(error?.message ?? error),
      durationMs: Date.now() - startedAt,
    };
    if (!cfg.verifyOnly) writeLedger(record);
    releaseLock();
    process.exit(code);
  });
