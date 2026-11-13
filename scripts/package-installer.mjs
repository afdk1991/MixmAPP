#!/usr/bin/env node
/**
 * 打包“装完即用”的安装包（对应 WordPress 的 zip 包）：
 *   release/mixmapp-install-<version>.tar.gz
 *
 * 内容：
 *   dist/                   后端产物（tsup 打好的 index.js 等）
 *   node_modules/           API 的生产依赖（pnpm deploy --prod）
 *   infra/sql               迁移脚本（migrate 按 cwd/infra/sql 查找）
 *   install/                安装向导（server.mjs + ui.html）
 *   scripts/install.sh      引导脚本
 *   index.html              单文件 H5（前端整站，含内嵌 JS/CSS）
 *
 * 用法：node scripts/package-installer.mjs [--skip-build]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skipBuild = process.argv.includes('--skip-build');
const version = JSON.parse(fs.readFileSync(path.join(repo, 'version.json'), 'utf8')).version ?? '0.0.0';
const outDir = path.join(repo, 'release');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'mixmapp-pkg-'));
const outFile = path.join(outDir, `mixmapp-install-${version}.tar.gz`);

const run = (cmd, args, cwd = repo) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const copy = (from, to) => fs.cpSync(path.join(repo, from), path.join(stage, to), { recursive: true });

fs.mkdirSync(outDir, { recursive: true });

if (!skipBuild) {
  console.log('[pkg] build api + h5');
  run('pnpm', ['--filter', '@mixmapp/api', 'build']);
  run('node', ['scripts/build-h5-single.mjs']);
}

console.log('[pkg] 收集 API 生产依赖（pnpm deploy --prod）');
const deployDir = path.join(stage, 'pkg-api');
run('pnpm', ['--filter', '@mixmapp/api', 'deploy', '--prod', deployDir]);

console.log('[pkg] 组装 stage');
copy('infra', 'infra');
copy('install', 'install');
fs.mkdirSync(path.join(stage, 'scripts'), { recursive: true });
fs.copyFileSync(path.join(repo, 'scripts/install.sh'), path.join(stage, 'scripts/install.sh'));
fs.copySync(path.join(deployDir, 'dist'), path.join(stage, 'dist'), { recursive: true });
fs.copySync(path.join(deployDir, 'node_modules'), path.join(stage, 'node_modules'), { recursive: true });

const h5 = path.join(repo, 'release/mixmapp-h5-single.html');
if (!fs.existsSync(h5)) throw new Error('缺少 release/mixmapp-h5-single.html，先跑 build:h5:single');
fs.copyFileSync(h5, path.join(stage, 'index.html'));

// tar（Windows 10+ 自带 bsdtar，Linux 自带 GNU tar，两条路径都能压出同一份包）
if (fs.existsSync(outFile)) fs.rmSync(outFile);
run('tar', ['-czf', outFile, '-C', stage, '.']);
fs.rmSync(stage, { recursive: true, force: true });

const size = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
console.log(`[pkg] 完成 ${outFile} (${size} MB)`);
console.log('[pkg] 服务器上：bash install.sh <path>/mixmapp-install-' + version + '.tar.gz');
