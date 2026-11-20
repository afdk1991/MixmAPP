#!/usr/bin/env node
/**
 * 正式产物构建入口：调用 uni build 出 H5 / App / 小程序 / Harmony 产物。
 *
 * 管理面（pages/admin/index）已纳入正式包：前端只做深藏入口（关于页版本号连点 5 次、
 * 通行证页在已配置后台令牌时露出一行），数据面仍由后端 x-admin-token 守卫——
 * 未带令牌时所有 /admin/* 端点整体 404，前端页面只是空壳，读不到任何后台数据。
 *
 * 用法：
 *   node scripts/build.mjs h5
 *   node scripts/build.mjs app
 *   node scripts/build.mjs mp-weixin
 *   node scripts/build.mjs app-harmony
 */
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const platform = (process.argv[2] ?? '').trim();
if (!['h5', 'app', 'mp-weixin', 'app-harmony'].includes(platform)) {
  console.error('用法：node scripts/build.mjs <h5|app|mp-weixin|app-harmony>');
  process.exit(2);
}

const args = platform === 'h5' ? 'uni build' : `uni build -p ${platform}`;
execSync(`pnpm exec ${args}`, { cwd: appRoot, stdio: 'inherit' });
