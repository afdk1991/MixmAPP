#!/usr/bin/env node
/**
 * H5 构建包装：先出 uni H5 产物，再按需把 API 源注入 index.html。
 *
 * 为什么需要：静态托管平台没有 `/api/v1` 路由，前端必须知道 API 的绝对地址；
 * 但 uni 的 `import.meta.env` 在部分构建模式下不会带入 VITE_ 变量，因此改由
 * 运行期全局变量兜底，构建时把值写死到 HTML 里即可。
 *
 * API 源取值优先级：环境变量 MIXMAPP_API_BASE > apps/mobile/api-base.json。
 * 允许两种形态：
 *   - 绝对地址 `https?://host[/path]/api/v1`：静态托管 / 原生壳（跨域，需服务端 CORS 放行）
 *   - 以 `/` 开头的同域相对路径：同域自托管（nginx 反代 `/mixmapp/api/v1`，不跨域）
 *
 * 两种都给不出时直接失败：静默回退到 `/api/v1` 会在静态平台 / 壳内把请求打到
 * 托管域或 `https://localhost` 上，产出「装上去就全站离线」的包（2026-11-14 旧包根因之一）。
 *
 * 用法：
 *   pnpm build:h5
 *   MIXMAPP_API_BASE=https://api.mixm.top/mixmapp/api/v1 pnpm build:h5
 *   MIXMAPP_API_BASE=/mixmapp/api/v1 pnpm build:h5   # 同域自托管
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'apps', 'app', 'dist', 'build', 'h5');
const indexPath = resolve(outDir, 'index.html');
const publicDir = resolve(root, 'apps', 'app', 'public');
const configPath = resolve(root, 'apps', 'mobile', 'api-base.json');

/** 递归复制目录。不用 fs.cpSync：Windows + 非 ASCII 路径下它会以 0xC0000409 直接崩进程。 */
function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else copyFileSync(src, dest);
  }
}

function resolveApiBase() {
  const fromEnv = (process.env.MIXMAPP_API_BASE ?? '').trim();
  if (fromEnv) return { base: fromEnv, from: 'MIXMAPP_API_BASE' };
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    const base = String(raw.apiBase ?? '').trim();
    if (base) return { base, from: 'apps/mobile/api-base.json' };
  }
  return { base: '', from: '(未配置)' };
}

function validateApiBase(base) {
  if (!base) return '未配置 API 源';
  const absolute = /^https?:\/\//.test(base);
  if (!absolute && !base.startsWith('/')) {
    return `既不是 http(s) 绝对地址，也不是以 / 开头的同域相对路径：${base}`;
  }
  if (absolute && !/\/api\/v1$/.test(base)) {
    return `绝对地址缺少 /api/v1 后缀：${base}`;
  }
  return '';
}

const { base: apiBase, from: baseSource } = resolveApiBase();
const invalid = validateApiBase(apiBase);
if (invalid) {
  console.error(`✗ 构建中止：${invalid}`);
  console.error('  静态托管 / 壳内没有后端路由，必须给出 API 源：');
  console.error('    - 跨域静态端 / 原生壳：MIXMAPP_API_BASE=https://api.mixm.top/mixmapp/api/v1');
  console.error('    - 同域自托管：        MIXMAPP_API_BASE=/mixmapp/api/v1');
  process.exit(1);
}

execSync('pnpm --filter @mixmapp/app build:h5', { cwd: root, stdio: 'inherit' });

if (!existsSync(indexPath)) {
  console.error(`[h5] 找不到产物入口：${indexPath}`);
  process.exit(1);
}

// 公开静态页：uni 的 H5 构建只复制 src/static，项目根的 public/ 不会进产物。
// 隐私政策这类需要「浏览器直接打开、稳定 URL、无 hash」的页面放 apps/app/public 下，
// 构建后原样落到 dist/build/h5 根目录（如 /privacy/index.html），
// 由 nginx 的 try_files $uri $uri/ 直接命中，不经过 SPA 路由。
if (existsSync(publicDir)) {
  copyDir(publicDir, outDir);
  console.info(`[h5] 已复制公开静态页：${publicDir} → ${outDir}`);
}

const html = readFileSync(indexPath, 'utf8');
const mediaBase = (process.env.MIXMAPP_MEDIA_BASE ?? '').trim();
if (!html.includes('__MIXMAPP_API_BASE__')) {
  const tags = [`<script>window.__MIXMAPP_API_BASE__=${JSON.stringify(apiBase)};</script>`];
  if (mediaBase) {
    tags.push(`<script>window.__MIXMAPP_MEDIA_BASE__=${JSON.stringify(mediaBase)};</script>`);
  }
  writeFileSync(indexPath, html.replace('<head>', `<head>\n    ${tags.join('\n    ')}`), 'utf8');
}

const mode = /^https?:\/\//.test(apiBase) ? '跨域绝对源' : '同域相对路径';
console.info(`[h5] 已注入 API 源（${mode}，来源 ${baseSource}）：${apiBase}`);
if (mediaBase) console.info(`[h5] 已注入媒体源：${mediaBase}`);
if (/^https?:\/\//.test(apiBase)) {
  console.info('[h5] 提示：跨域端要求服务端 CORS 白名单包含当前页面 origin（壳 https://localhost、各托管域名等），否则浏览器层直接拒收。');
}
