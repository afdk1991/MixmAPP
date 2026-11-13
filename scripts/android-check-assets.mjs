#!/usr/bin/env node
/**
 * 壳产物体检：cap sync 之后、gradle 打包之前，确认 WebView 里的 H5 真的知道 API 地址。
 *
 * 为什么需要：Capacitor 壳加载的是 `https://localhost` 下的本地静态资源，
 * H5 若没被注入 __MIXMAPP_API_BASE__，就会退回同源 `/api/v1`，
 * 也就是 `https://localhost/api/v1` —— 所有请求 404，装出来的 APP 永远离线。
 * 这个坑在 2026-11-13 的 APK 里已经出现过一次，这里用脚本钉死。
 *
 * 用法：node scripts/android-check-assets.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(root, 'apps', 'mobile', 'android', 'app', 'src', 'main', 'assets', 'public');
const indexPath = join(assetsDir, 'index.html');

const problems = [];

if (!existsSync(indexPath)) {
  problems.push(`找不到壳内产物入口：${indexPath}（先跑 build:h5 与 cap sync android）`);
} else {
  const html = readFileSync(indexPath, 'utf8');
  const match = /window\.__MIXMAPP_API_BASE__\s*=\s*("(?:[^"\\]|\\.)*")/.exec(html);
  if (!html.includes('__MIXMAPP_API_BASE__')) {
    problems.push('壳内 index.html 没有注入 __MIXMAPP_API_BASE__，APP 会退回 https://localhost/api/v1（全站离线）');
  } else if (!match) {
    problems.push('壳内 index.html 有 __MIXMAPP_API_BASE__ 但取值解析不出来');
  } else {
    const value = JSON.parse(match[1]);
    if (!value || !/^https?:\/\//.test(value)) {
      problems.push(`__MIXMAPP_API_BASE__ 取值不是绝对地址：${JSON.stringify(value)}`);
    } else if (!/\/api\/v1$/.test(value)) {
      problems.push(`__MIXMAPP_API_BASE__ 缺少 /api/v1 后缀：${value}（客户端只在纯域名时自动补，带路径不会补）`);
    } else {
      console.info(`[android] 壳内 API 源：${value}`);
    }
  }
}

if (problems.length) {
  console.error('✗ 壳产物体检失败：');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.info('✓ 壳产物体检通过');
