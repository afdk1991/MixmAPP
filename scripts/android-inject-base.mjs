#!/usr/bin/env node
/**
 * 壳产物体检 + API 源注入：Capacitor 壳的可执行闸门。
 *
 * 背景：壳的 WebView 从 `https://localhost` 加载 `assets/public` 里的本地 H5。
 * H5 若没拿到 API 绝对地址，客户端会按「生产态同源」退回 `/api/v1`，
 * 实际请求打到 `https://localhost/api/v1` —— 装出来的 APP 全站离线。
 *
 * 只靠「构建命令记得带 MIXMAPP_API_BASE」不可靠：任何人跑一次裸的
 * `pnpm --filter @mixmapp/app build:h5` + `cap sync` 就会把注入覆盖掉
 * （2026-11-14 真机上就这样复现过一次）。所以把注入挪到 sync 之后，由脚本兜住。
 *
 * 用法：
 *   node scripts/android-inject-base.mjs           # 注入并校验（sync 之后跑）
 *   node scripts/android-inject-base.mjs --check   # 只校验不写，输出完整体检清单
 *
 * API 源取值优先级：环境变量 MIXMAPP_API_BASE > apps/mobile/api-base.json
 *
 * 体检分两级：
 *   - error（致命）：API 源缺失 / 不可解析 / 非绝对地址 / 非 HTTPS / 缺 /api/v1 后缀 /
 *     index.html 为空；以及 --check 专有的「壳内前端版本常量与 version.json 展示号一致」。
 *     任一项失败即 exit 1。
 *   - warn（告警）：<meta viewport> 缺 viewport-fit=cover、缺 JS 产物等。只提示不拦截，
 *     因为 H5 入口由前端定稿，硬失败会卡住多人并行构建；告警项请前端在 H5 入口补齐。
 *
 * 「壳内版本常量」闸门只在 --check 生效：注入模式由 sync:android 内部调用，不新增失败条件，
 * 保持既有注入行为不变。CI 中 --check 正好位于 sync:android 之后、gradlew 之前，能拦住
 * 旧渠道产物（assets/public/assets/version.*.js 仍是 -preview / -dev 后缀号）随 cap sync 打进 APK。
 *
 * 边界：本脚本只探测壳内产物本身。壳内 origin 是 https://localhost（androidScheme: https），
 * 旧版 Capacitor 还可能是 capacitor://localhost；这两个源是否被服务端 CORS 白名单放行，
 * 属于服务端配置，本脚本探测不到。体检通过 ≠ 跨域放行；跨域是否放行要另用带 Origin 的请求验响应头。
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(root, 'apps', 'mobile', 'android', 'app', 'src', 'main', 'assets', 'public');
const indexPath = join(assetsDir, 'index.html');
const configPath = join(root, 'apps', 'mobile', 'api-base.json');

const CHECK_ONLY = process.argv.includes('--check');

function resolveApiBase() {
  const fromEnv = (process.env['MIXMAPP_API_BASE'] ?? '').trim();
  if (fromEnv) return { base: fromEnv, from: 'MIXMAPP_API_BASE' };
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    const base = String(raw.apiBase ?? '').trim();
    if (base) return { base, from: 'apps/mobile/api-base.json' };
  }
  return { base: '', from: '(未配置)' };
}

/**
 * 与 scripts/version.mjs 的 displayVersion() 保持一致（前端 version.ts / version.*.js
 * 由该函数生成，裸号、不带 V 前缀）：
 *   release            → `${version}`（三段号）
 *   preview / dev      → `${version}-${channel}`，计数 > 0 时追加 `.N`
 */
function displayVersionOf(state) {
  const base = String(state.version ?? '0.0.0');
  const channel = String(state.channel ?? 'release');
  if (channel === 'release') return base;
  const counter = Number((state.counters ?? {})[channel] ?? 0);
  return `${base}-${channel}${counter > 0 ? `.${counter}` : ''}`;
}

/**
 * --check 专项闸门：壳内 assets/public/assets/version.*.js 必须与 version.json 展示号一致。
 *
 * 背景：apps/app/src/version.ts 的 APP_VERSION 由 version.json 生成并打进 H5 chunk。
 * src/main 源码树里的 assets/public 是上一次 sync 的产物，不受 dist/build 的 .gitignore
 * 覆盖，会随 cap sync 直接打进新 APK。只改 gradle 接线而不重跑 build:h5 + sync:android，
 * 就会出现「APK versionName 与前端展示版本不一致」的问题。
 */
function shellVersionChecks() {
  const checks = [];
  const add = (level, name, ok, detail = '') =>
    checks.push({ level, name, ok: Boolean(ok), detail: String(detail) });

  const name = '壳内前端版本常量与 version.json 一致';
  const versionJsonPath = join(root, 'version.json');
  let state = null;
  try {
    state = JSON.parse(readFileSync(versionJsonPath, 'utf8'));
  } catch (e) {
    add('error', name, false, `无法读取 ${versionJsonPath}：${e.message}`);
    return checks;
  }
  const expected = displayVersionOf(state);
  add('info', 'version.json 展示号', true,
    `displayVersion=${expected}（channel=${String(state.channel ?? '?')}）`);

  const versionAssetsDir = join(assetsDir, 'assets');
  let found = [];
  if (existsSync(versionAssetsDir)) {
    found = readdirSync(versionAssetsDir)
      .filter((file) => /^version.*\.js$/i.test(file))
      .map((file) => {
        const src = readFileSync(join(versionAssetsDir, file), 'utf8');
        const m = /["'](\d+\.\d+\.\d+(?:-(?:preview|dev)(?:\.\d+)?)?)["']/.exec(src);
        return { file, value: m ? m[1] : '(未解析出版本号)' };
      });
  }

  if (found.length === 0) {
    add('error', name, false,
      `未找到壳内 assets/version.*.js（H5 产物未构建），期望 "${expected}"；需先跑 build:h5 → sync:android 全链重建`);
    return checks;
  }

  const mismatched = found.filter((f) => f.value !== expected);
  if (mismatched.length === 0) {
    add('error', name, true, `${found.map((f) => `${f.file}=${f.value}`).join('、')} == ${expected}`);
    return checks;
  }

  const desc = mismatched.map((f) => `${f.file} 为 "${f.value}"`).join('、');
  const stale = mismatched.some((f) => /preview|dev/i.test(f.value));
  const hint = stale
    ? '壳内仍是旧通道产物（preview / dev），需先跑 build:h5 → sync:android 全链重建'
    : '壳内 H5 产物与 version.json 不同步，需先跑 build:h5 → sync:android 全链重建';
  add('error', name, false, `${desc}，期望 "${expected}"；${hint}`);
  return checks;
}

/** 返回体检项数组：{ level: 'error'|'warn'|'info', name, ok, detail } */
function healthChecks(html) {
  const checks = [];
  const add = (level, name, ok, detail = '') =>
    checks.push({ level, name, ok: Boolean(ok), detail: String(detail) });

  const configured = resolveApiBase();
  add('info', 'API 源配置来源', true,
    `${configured.from} → ${configured.base || '(未配置)'}`);

  // ── API 源（致命）──────────────────────────────────────────────────────
  const injected = html.includes('__MIXMAPP_API_BASE__');
  add('error', 'API 源已注入', injected,
    injected ? '已找到注入标记' : '未注入 __MIXMAPP_API_BASE__，APP 会退回 https://localhost/api/v1（全站离线）');

  const match = /window\.__MIXMAPP_API_BASE__\s*=\s*("(?:[^"\\]|\\.)*")/.exec(html);
  let value = '';
  if (match) {
    try { value = JSON.parse(match[1]); } catch { value = ''; }
    add('error', 'API 源取值可解析', Boolean(value), value || '取值解析失败');
  } else {
    add('error', 'API 源取值可解析', false,
      injected ? '有 __MIXMAPP_API_BASE__ 但取值解析不出来' : '无注入标记');
  }
  if (value) {
    add('error', 'API 源为绝对地址', /^https?:\/\//.test(value), value);
    // 正式版强制 HTTPS：壳内 origin 已是 https，混合 http 会被 MIXED_CONTENT_NEVER_ALLOW 拦掉
    add('error', 'API 源强制 HTTPS', /^https:\/\//.test(value), value);
    add('error', 'API 源 /api/v1 后缀', /\/api\/v1$/.test(value), value);
  }

  // ── viewport（告警：H5 入口由前端定稿，不硬失败以免卡住并行构建）────────
  const viewportTag =
    /<meta\s+[^>]*name=["']viewport["'][^>]*>/i.exec(html) ??
    /<meta\s+[^>]*content=["'][^"']*viewport-fit=cover[^"']*["'][^>]*>/i.exec(html);
  const vpContent = viewportTag
    ? (/\bcontent=["']([^"']*)["']/i.exec(viewportTag[0])?.[1] ?? '')
    : '';
  add('warn', 'viewport meta 存在', Boolean(viewportTag),
    viewportTag ? viewportTag[0].slice(0, 180) : '未找到 <meta name="viewport">');
  add('warn', 'viewport-fit=cover', /viewport-fit\s*=\s*cover/i.test(vpContent),
    viewportTag ? (vpContent || '(content 为空)') : '无 viewport meta，安全区可能不生效');

  // ── 产物完整性 ─────────────────────────────────────────────────────────
  let bytes = 0;
  try { bytes = statSync(indexPath).size; } catch { /* noop */ }
  add('error', 'index.html 非空', bytes > 0, bytes ? `${bytes} B` : '空文件');

  let jsCount = 0;
  if (existsSync(assetsDir)) {
    for (const name of readdirSync(assetsDir)) {
      if (name.endsWith('.js')) jsCount += 1;
    }
  }
  add('warn', '存在 JS 产物', jsCount > 0, `${jsCount} 个 .js`);

  return checks;
}

function printChecks(checks) {
  console.info('=== 壳产物体检 ===');
  for (const c of checks) {
    const mark = c.ok ? '✓' : (c.level === 'warn' ? '!' : '✗');
    console.info(`[${mark}] ${c.name}${c.detail ? `  → ${c.detail}` : ''}`);
  }
  const fatal = checks.filter((c) => c.level === 'error' && !c.ok);
  const warn = checks.filter((c) => c.level === 'warn' && !c.ok);
  return { fatal, warn };
}

if (!existsSync(indexPath)) {
  console.error(`✗ 找不到壳内产物入口：${indexPath}（先跑 build:h5 与 cap sync android）`);
  process.exit(1);
}

if (!CHECK_ONLY) {
  const { base, from } = resolveApiBase();
  // 正式版口径：API 基址必须是 https 且以 /api/v1 结尾
  if (!base || !/^https:\/\//.test(base) || !/\/api\/v1$/.test(base)) {
    console.error(`✗ API 源不合法：${JSON.stringify(base)}（来源 ${from}），需形如 https://host[/path]/api/v1（强制 https）`);
    process.exit(1);
  }
  let html = readFileSync(indexPath, 'utf8');
  const tag = `<script>window.__MIXMAPP_API_BASE__=${JSON.stringify(base)};</script>`;
  if (/window\.__MIXMAPP_API_BASE__\s*=/.test(html)) {
    html = html.replace(
      /window\.__MIXMAPP_API_BASE__\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/,
      `window.__MIXMAPP_API_BASE__=${JSON.stringify(base)}`);
    writeFileSync(indexPath, html, 'utf8');
  } else if (html.includes('<head>')) {
    html = html.replace('<head>', `<head>\n    ${tag}`);
    writeFileSync(indexPath, html, 'utf8');
  } else {
    console.error('✗ 壳内 index.html 没有 <head>，无法插入注入标签');
    process.exit(1);
  }
  console.info(`[android] 已同步 API 源（${from}）：${base}`);
}

const checks = healthChecks(readFileSync(indexPath, 'utf8'));
if (CHECK_ONLY) {
  // 只在 --check 生效：注入模式（sync:android 内部调用）不新增失败条件，保持既有注入行为；
  // CI 里 --check 位于 sync:android 之后、gradlew 之前，正好能拦住旧产物打进 APK。
  checks.push(...shellVersionChecks());
}
const { fatal, warn } = printChecks(checks);
if (fatal.length) {
  console.error('✗ 壳产物体检失败（致命项）：');
  for (const c of fatal) console.error(`  - ${c.name}：${c.detail}`);
  process.exit(1);
}
for (const c of warn) console.warn(`[android] 告警：${c.name} → ${c.detail}`);
console.info(`✓ 壳产物体检通过${warn.length ? `（${warn.length} 项告警）` : ''}`);
console.info('[android] 提醒：壳内 origin 为 https://localhost（旧版可能为 capacitor://localhost），需在服务端 CORS 白名单内；本脚本不探测服务端放行状态，跨域是否通请查响应头 access-control-allow-origin。');
