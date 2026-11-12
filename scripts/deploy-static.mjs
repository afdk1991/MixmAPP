#!/usr/bin/env node
/**
 * 静态端发布：把 uni-app H5 产物推到 Cloudflare Pages。
 * 凭据缺失时输出 SKIP 并干净退出（CI 里不会因此变红）。
 * 需要：CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID、CF_PAGES_PROJECT（默认 mixmapp）
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const dist = resolve('apps/app/dist/build/h5');
if (!existsSync(dist)) {
  console.error(`✗ 未找到 H5 产物目录 ${dist}，请先执行 pnpm run build:h5`);
  process.exit(1);
}

// 静态端没有 /api/v1 路由：若本次构建未注入，就在这里补上 API 源，避免线上全量 404
const apiBase = (process.env.MIXMAPP_API_BASE ?? '').trim();
if (apiBase) {
  const indexPath = resolve(dist, 'index.html');
  if (!existsSync(indexPath)) {
    console.error(`✗ 找不到 ${indexPath}`);
    process.exit(1);
  }
  const html = readFileSync(indexPath, 'utf8');
  if (!html.includes('__MIXMAPP_API_BASE__')) {
    const tag = `<script>window.__MIXMAPP_API_BASE__=${JSON.stringify(apiBase)};</script>`;
    writeFileSync(indexPath, html.replace('<head>', `<head>\n    ${tag}`), 'utf8');
    console.info(`[static] 已注入 API 源 ${apiBase}`);
  }
}

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) {
  console.info('SKIP 缺少 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID，跳过静态端发布');
  process.exit(0);
}

const project = process.env.CF_PAGES_PROJECT ?? 'mixmapp';
const args = [
  'wrangler',
  'pages',
  'deploy',
  dist,
  `--project-name=${project}`,
  '--commit-dirty=true',
];
const res = spawnSync('npx', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account },
});
if (res.status !== 0) {
  console.error(`✗ Cloudflare Pages 发布失败（exit ${res.status}）`);
  process.exit(res.status ?? 1);
}
console.info(`✓ 已发布到 Cloudflare Pages 项目 ${project}`);
