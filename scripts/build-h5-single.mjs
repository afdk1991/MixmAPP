#!/usr/bin/env node
/**
 * 把 H5 产物压成单文件 HTML，交给只支持单文件托管的免费平台（如 EdgeOne Pages）。
 *
 * 为什么需要：多文件 H5（index.html + assets/*.js|css + static/*）在常规静态托管里没问题，
 * 但 EdgeOne Makers 只暴露 deploy-html（单 HTML 内容 → 公网 URL），多文件传不上去。
 * 这里做的是「构建产物打包」，不是改业务代码：JS/CSS 内联，图片转 data URI。
 *
 * 用法：node scripts/build-h5-single.mjs
 * 可选：MIXMAPP_H5_BASE=/mixmapp-h5/ 适配「托管在子路径」的平台（如 GitHub Pages 的项目页）
 * 产物：release/mixmapp-h5-single.html
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const h5Dir = join(root, 'apps', 'app', 'dist', 'build', 'h5');
const outDir = join(root, 'release');
const outFile = join(outDir, 'mixmapp-h5-single.html');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function dataUri(file) {
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime) return null;
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
}

const BASE = process.env.MIXMAPP_H5_BASE ?? '/';
/**
 * 静态托管没有 /api/v1 路由，部署时把 API 源写进单文件，避免所有请求 404。
 * 单文件产物只能落在纯静态平台：没有 dev proxy，也没有同域后端，因此必须是
 * http(s) 绝对地址；缺省或相对路径都会产出「装上去就全站离线」的包，直接失败。
 */
const API_BASE = (process.env.MIXMAPP_API_BASE ?? '').trim();
if (!API_BASE) {
  console.error('✗ 构建中止：单文件 H5 只能托管在静态平台，必须设置 MIXMAPP_API_BASE 为绝对地址（如 https://api.mixm.top/mixmapp/api/v1）');
  process.exit(1);
}
if (!/^https?:\/\//.test(API_BASE)) {
  console.error(`✗ 单文件静态端不支持同域相对路径：${JSON.stringify(API_BASE)}，请给 http(s) 绝对地址`);
  process.exit(1);
}
if (!/\/api\/v1$/.test(API_BASE)) {
  console.error(`✗ API 源缺少 /api/v1 后缀：${API_BASE}`);
  process.exit(1);
}
const manifestFile = join(root, 'apps', 'app', 'src', 'manifest.json');

console.info('[single] 构建单文件版 H5…');
if (BASE !== '/') console.info(`[single] 路由 base = ${BASE}`);

// 子路径托管（例如 GitHub Pages 项目页）必须让 uni 的 router.base 与该路径一致，
// 否则页面能加载但路由匹配失败、整页空白。这里临时改写 manifest，构建完即还原。
const originalManifest = existsSync(manifestFile) ? readFileSync(manifestFile, 'utf8') : null;
if (originalManifest && BASE !== '/') {
  const patched = originalManifest.replace(/("base"\s*:\s*)"[^"]*"/, `$1${JSON.stringify(BASE)}`);
  writeFileSync(manifestFile, patched, 'utf8');
}

try {
  execSync('pnpm --filter @mixmapp/app build:h5', {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, MIXMAPP_SINGLE_FILE: '1' },
  });
} finally {
  if (originalManifest) writeFileSync(manifestFile, originalManifest, 'utf8');
}

if (!existsSync(h5Dir)) {
  console.error(`[single] 找不到构建产物：${h5Dir}`);
  process.exit(1);
}

// 1. 收集产物里的静态资源，建立「URL 路径 → data URI」映射
const assets = new Map();
for (const file of walk(h5Dir)) {
  const rel = '/' + file.slice(h5Dir.length + 1).replace(/\\/g, '/');
  if (!rel.startsWith('/assets/') && !rel.startsWith('/static/')) continue;
  const uri = dataUri(file);
  if (uri) assets.set(rel, uri);
}

function lookupAsset(urlPath) {
  const clean = urlPath.split('?')[0].split('#')[0];
  if (assets.has(clean)) return assets.get(clean);
  if (BASE !== '/') {
    const prefix = BASE.replace(/^\//, '');
    if (clean.replace(/^\//, '').startsWith(prefix)) {
      return assets.get('/' + clean.replace(/^\//, '').slice(prefix.length));
    }
  }
  return null;
}

function toFsPath(urlPath) {
  const clean = urlPath.split('?')[0];
  let rel = clean.replace(/^\//, '');
  if (BASE !== '/') {
    const prefix = BASE.replace(/^\//, '');
    if (rel.startsWith(prefix)) rel = rel.slice(prefix.length);
  }
  return join(h5Dir, rel);
}

let html = readFileSync(join(h5Dir, 'index.html'), 'utf8');

// 2. 内联样式表
html = html.replace(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_m, href) => {
  const file = toFsPath(href);
  if (!existsSync(file)) return '';
  let css = readFileSync(file, 'utf8');
  css = css.replace(/url\((["']?)(\/[^)"']+)\1\)/g, (m, _q, p) => {
    const uri = lookupAsset(p);
    return uri ? `url("${uri}")` : m;
  });
  return `<style>${css}</style>`;
});

// 3. 内联脚本（单文件模式下只有一个入口 chunk）
html = html.replace(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g, (_m, src) => {
  const file = toFsPath(src);
  if (!existsSync(file)) return '';
  let js = readFileSync(file, 'utf8');
  // 兜底：把运行时路由 base 对齐到托管子路径（manifest 改写万一没生效也不至于整页空白）
  if (BASE !== '/') js = js.replace(/base:"\/"/g, `base:"${BASE}"`);
  // 运行时会拼 "/static/logo.png" 这类路径，换成 data URI
  for (const [p, uri] of assets) {
    const prefixed = BASE === '/' ? p : BASE.replace(/\/$/, '') + p;
    js = js.split(JSON.stringify(prefixed)).join(JSON.stringify(uri));
    js = js.split(`'${prefixed}'`).join(`'${uri}'`).split(`"${prefixed}"`).join(`"${uri}"`);
  }
  return `<script type="module">${js}</script>`;
});

// 4. 图标也内联
html = html.replace(/<link[^>]+rel="icon"[^>]*href="([^"]+)"[^>]*>/g, (_m, href) => {
  const uri = lookupAsset(href);
  return uri ? `<link rel="icon" href="${uri}" />` : '';
});

// 5. 兜底：任何残留的绝对资源路径都换成 data URI
for (const [p, uri] of assets) {
  const prefixed = BASE === '/' ? p : BASE.replace(/\/$/, '') + p;
  html = html.split(`"${prefixed}"`).join(`"${uri}"`);
}

// 6. 静态平台没有后端路由：把 API 基址注入运行期全局，前端优先读取它
if (API_BASE) {
  const tag = `<script>window.__MIXMAPP_API_BASE__=${JSON.stringify(API_BASE)};</script>`;
  html = html.includes('<head>') ? html.replace('<head>', `<head>\n    ${tag}`) : `${tag}\n${html}`;
  console.info(`[single] API 源 = ${API_BASE}`);
}

// 7. 图片 / 媒体走独立域名（img.mixm.top），与 API 源解耦，便于 CDN 与缓存策略分开
const MEDIA_BASE = (process.env.MIXMAPP_MEDIA_BASE ?? '').trim();
if (MEDIA_BASE) {
  const tag = `<script>window.__MIXMAPP_MEDIA_BASE__=${JSON.stringify(MEDIA_BASE)};</script>`;
  html = html.includes('<head>') ? html.replace('<head>', `<head>\n    ${tag}`) : `${tag}\n${html}`;
  console.info(`[single] 媒体源 = ${MEDIA_BASE}`);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, html, 'utf8');
const kb = (statSync(outFile).size / 1024).toFixed(1);
console.info(`[single] 产物：${outFile}（${kb} KB）`);
