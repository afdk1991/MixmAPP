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
const version = (() => {
  const v = JSON.parse(fs.readFileSync(path.join(repo, 'version.json'), 'utf8'));
  // 与 scripts/version.mjs 的 displayVersion() 同口径：三段式，release 取当前号（无后缀），
  // preview / test / gray 追加 -<channel>，计数 > 0 时再加 .N。
  const base = String(v.version ?? '0.0.0');
  if (v.channel && v.channel !== 'release') {
    const n = Number((v.counters ?? {})[v.channel] ?? 0);
    return `${base}-${v.channel}${n > 0 ? `.${n}` : ''}`;
  }
  return base;
})();
const outDir = path.join(repo, 'release');
// Windows + pnpm 9 已知坑：deploy 目标若是绝对路径（如 C:\Users\...\Temp\...），
// hoisted 符号链接阶段会把绝对路径字符串当相对路径拼到 workspace 根，
// 产出 `F:\repo\C:\Users\...` 这类非法路径并 ENOENT（2026-11-14 实测）。
// 规避：stage 放仓库内（release/ 已被 .gitignore 排除），deploy 目标用相对路径。
const stageRoot = path.join(outDir, '.pkg-stage');
fs.mkdirSync(stageRoot, { recursive: true });
const stage = fs.mkdtempSync(path.join(stageRoot, 'pkg-'));
const outFile = path.join(outDir, `mixmapp-install-${version}.tar.gz`);

const isWin = process.platform === 'win32';
const pnpm = isWin ? 'pnpm.CMD' : 'pnpm';
const run = (cmd, args, cwd = repo, env = {}) =>
  // Windows 上 pnpm 是 .CMD 垫片，node 直接 spawn 会 ENOENT，必须走 shell
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: isWin && cmd === pnpm, env: { ...process.env, ...env } });
const copy = (from, to) => fs.cpSync(path.join(repo, from), path.join(stage, to), { recursive: true });

fs.mkdirSync(outDir, { recursive: true });

if (!skipBuild) {
  console.log('[pkg] build api + h5');
  run(pnpm, ['--filter', '@mixmapp/api', 'build']);
  // 单文件 H5 必须把 API 源钉死，否则回落到相对 /api/v1，装到 /mixmapp/api/v1 的站点会显示离线
  run('node', ['scripts/build-h5-single.mjs'], repo, {
    MIXMAPP_API_BASE: process.env.MIXMAPP_API_BASE ?? '/mixmapp/api/v1',
  });
}

console.log('[pkg] 收集 API 生产依赖（pnpm deploy --prod）');
// deploy 目标用「相对 repo 根」的路径，避免 pnpm 9 在 Windows 把绝对路径拼到
// workspace 子包目录（services/api/release/...）；deployDir 同时作为最终打包根。
const deployDir = path.join(stage, 'pkg-api');
const deployArg = path.relative(repo, deployDir).split(path.sep).join('/');
run(pnpm, ['--filter', '@mixmapp/api', 'deploy', '--prod', deployArg]);

// 直接把 deployDir 当作发布根，其余文件往里放，最后 tar deployDir。
// 关键：绝不 fs.cpSync(deployDir/node_modules) —— pnpm deploy 产出的 node_modules
// 含大量符号链接，Windows 上 recursive cpSync 跟随链接会让 Node 进程原生崩溃
// （无 JS 异常、exit 127，2026-11-19 实测）。以 deployDir 为根打包即可零复制。
// 另外本环境 Node 22 的 fs.cpSync(recursive) 连普通目录复制都会原生崩溃（127），
// 因此目录复制统一走 shell `cp -r`（已实测正常），文件复制仍用 fs.copyFileSync。
console.log('[pkg] 组装发布包（以 deploy 产物为根）');
const cpDir = (src, dst) => execFileSync('cp', ['-r', src, dst], { cwd: repo, stdio: 'inherit', shell: true });
cpDir('infra', path.join(deployDir, 'infra'));
cpDir('install', path.join(deployDir, 'install'));
fs.mkdirSync(path.join(deployDir, 'scripts'), { recursive: true });
fs.copyFileSync(path.join(repo, 'scripts/install.sh'), path.join(deployDir, 'scripts/install.sh'));

const h5 = path.join(repo, 'release/mixmapp-h5-single.html');
if (!fs.existsSync(h5)) throw new Error('缺少 release/mixmapp-h5-single.html，先跑 build:h5:single');
fs.copyFileSync(h5, path.join(deployDir, 'index.html'));

// tar（Windows 10+ 自带 bsdtar，Linux 自带 GNU tar，两条路径都能压出同一份包）
// --force-local：GNU tar 在 Windows 上会把 `F:\...` 绝对路径当成「远程主机:路径」
// 去调 rsh，报 "Cannot connect to F: resolve failed" 并以 127/128 退出（2026-11-19 实测）。
// 强制本地文件后绝对路径可正常使用；bsdtar 忽略该选项，不影响跨平台。
if (fs.existsSync(outFile)) fs.rmSync(outFile);
console.log('[pkg] 打包 tar（--force-local）');
run('tar', ['--force-local', '-czf', outFile, '-C', deployDir, '.']);
fs.rmSync(stage, { recursive: true, force: true });

const size = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
console.log(`[pkg] 完成 ${outFile} (${size} MB)`);
console.log('[pkg] 服务器上：bash install.sh <path>/mixmapp-install-' + version + '.tar.gz');
