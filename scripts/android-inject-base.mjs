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
 *   node scripts/android-inject-base.mjs --check   # 只校验不写
 *
 * API 源取值优先级：环境变量 MIXMAPP_API_BASE > apps/mobile/api-base.json
 *
 * 边界：本脚本只校验「注入了没有 / 是不是绝对地址 / 后缀对不对」。壳内页面的
 * origin 是 https://localhost（androidScheme: https），旧版 Capacitor 还可能是
 * capacitor://localhost；这两个源是否被服务端 CORS 白名单放行，属于服务端配置，
 * 本脚本探测不到。体检通过 ≠ 跨域放行；跨域是否放行要另用带 Origin 的请求验响应头。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

function problemsFor(html) {
  const problems = [];
  const match = /window\.__MIXMAPP_API_BASE__\s*=\s*("(?:[^"\\]|\\.)*")/.exec(html);
  if (!html.includes('__MIXMAPP_API_BASE__')) {
    problems.push('壳内 index.html 没有注入 __MIXMAPP_API_BASE__，APP 会退回 https://localhost/api/v1（全站离线）');
    return problems;
  }
  if (!match) {
    problems.push('壳内 index.html 有 __MIXMAPP_API_BASE__ 但取值解析不出来');
    return problems;
  }
  const value = JSON.parse(match[1]);
  if (!value || !/^https?:\/\//.test(value)) {
    problems.push(`__MIXMAPP_API_BASE__ 取值不是绝对地址：${JSON.stringify(value)}`);
  } else if (!/\/api\/v1$/.test(value)) {
    problems.push(`__MIXMAPP_API_BASE__ 缺少 /api/v1 后缀：${value}（客户端只在纯域名时自动补，带路径不会补）`);
  }
  return problems;
}

if (!existsSync(indexPath)) {
  console.error(`✗ 找不到壳内产物入口：${indexPath}（先跑 build:h5 与 cap sync android）`);
  process.exit(1);
}

let html = readFileSync(indexPath, 'utf8');

if (!CHECK_ONLY) {
  const { base, from } = resolveApiBase();
  if (!base || !/^https?:\/\//.test(base) || !/\/api\/v1$/.test(base)) {
    console.error(`✗ API 源不合法：${JSON.stringify(base)}（来源 ${from}），需要形如 https://host[/path]/api/v1`);
    process.exit(1);
  }
  const tag = `<script>window.__MIXMAPP_API_BASE__=${JSON.stringify(base)};</script>`;
  if (/window\.__MIXMAPP_API_BASE__\s*=/.test(html)) {
    html = html.replace(/window\.__MIXMAPP_API_BASE__\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/, `window.__MIXMAPP_API_BASE__=${JSON.stringify(base)}`);
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

const problems = problemsFor(readFileSync(indexPath, 'utf8'));
if (problems.length) {
  console.error('✗ 壳产物体检失败：');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
const m = /window\.__MIXMAPP_API_BASE__\s*=\s*("(?:[^"\\]|\\.)*")/.exec(readFileSync(indexPath, 'utf8'));
console.info(`✓ 壳产物体检通过：${JSON.parse(m[1])}`);
console.info('[android] 提醒：壳内 origin 为 https://localhost（旧版可能为 capacitor://localhost），需在服务端 CORS 白名单内；本脚本不探测服务端放行状态，跨域是否通请查响应头 access-control-allow-origin。');
