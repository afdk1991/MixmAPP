#!/usr/bin/env node
/**
 * 正式产物构建入口：调用 uni build 前后把「仅内部使用」的页面从 pages.json 临时摘除。
 *
 * 为什么在构建期做：管理面（pages/admin/index）的源码要留在仓库里供内部使用，
 * 但正式产物不应注册该路由 —— 只要 pages.json 里没有这条记录，uni 就不会把
 * 对应页面打进包里，线上直接访问该路径也不会渲染管理界面。
 *
 * 行为：
 *   - 默认（正式构建）：构建前摘除 internal 页面，构建结束（成功或失败）后原样还原源码；
 *   - 内部构建：MIXMAPP_INTERNAL_BUILD=1 时保留全部页面；开发态（pnpm dev:h5）不经过本脚本，同样保留。
 *
 * 用法：
 *   node scripts/build.mjs h5
 *   node scripts/build.mjs app
 *   node scripts/build.mjs mp-weixin
 *   node scripts/build.mjs app-harmony
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pagesPath = resolve(appRoot, 'src', 'pages.json');

/** 只进内部构建的页面：源码保留，正式产物不注册、不打包。 */
const INTERNAL_PAGES = new Set(['pages/admin/index']);

const platform = (process.argv[2] ?? '').trim();
if (!['h5', 'app', 'mp-weixin', 'app-harmony'].includes(platform)) {
  console.error('用法：node scripts/build.mjs <h5|app|mp-weixin|app-harmony>');
  process.exit(2);
}

const keepInternal = process.env.MIXMAPP_INTERNAL_BUILD === '1';
const original = readFileSync(pagesPath, 'utf8');

if (!keepInternal) {
  const parsed = JSON.parse(original);
  const before = parsed.pages.length;
  parsed.pages = parsed.pages.filter((page) => !INTERNAL_PAGES.has(page.path));
  if (parsed.pages.length === before) {
    console.error(`✗ pages.json 中未找到内部页面（${[...INTERNAL_PAGES].join(', ')}），剥离规则已失效`);
    process.exit(1);
  }
  writeFileSync(pagesPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  console.info(`[build] 正式产物已剥离内部页面：${[...INTERNAL_PAGES].join(', ')}`);
}

try {
  const args = platform === 'h5' ? 'uni build' : `uni build -p ${platform}`;
  execSync(`pnpm exec ${args}`, { cwd: appRoot, stdio: 'inherit' });
} finally {
  if (!keepInternal) writeFileSync(pagesPath, original, 'utf8');
}
