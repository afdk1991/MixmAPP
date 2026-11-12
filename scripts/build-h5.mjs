#!/usr/bin/env node
/**
 * H5 构建包装：先出 uni H5 产物，再按需把 API 源注入 index.html。
 *
 * 为什么需要：静态托管平台没有 `/api/v1` 路由，前端必须知道 API 的绝对地址；
 * 但 uni 的 `import.meta.env` 在部分构建模式下不会带入 VITE_ 变量，因此改由
 * 运行期全局变量兜底，构建时把值写死到 HTML 里即可。
 *
 * 用法：
 *   pnpm build:h5
 *   MIXMAPP_API_BASE=https://api.mixm.app pnpm build:h5
 * 不设 MIXMAPP_API_BASE 时行为与直接跑 `uni build` 完全一致。
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = resolve(root, 'apps', 'app', 'dist', 'build', 'h5', 'index.html');
const apiBase = (process.env.MIXMAPP_API_BASE ?? '').trim();

execSync('pnpm --filter @mixmapp/app build:h5', { cwd: root, stdio: 'inherit' });

if (!apiBase) {
  console.info('[h5] 未设置 MIXMAPP_API_BASE，保持同源 /api/v1');
} else if (!existsSync(indexPath)) {
  console.error(`[h5] 找不到产物入口：${indexPath}`);
  process.exit(1);
} else {
  const html = readFileSync(indexPath, 'utf8');
  if (!html.includes('__MIXMAPP_API_BASE__')) {
    const tag = `<script>window.__MIXMAPP_API_BASE__=${JSON.stringify(apiBase)};</script>`;
    writeFileSync(indexPath, html.replace('<head>', `<head>\n    ${tag}`), 'utf8');
  }
  console.info(`[h5] 已注入 API 源：${apiBase}`);
}
