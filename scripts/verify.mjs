#!/usr/bin/env node
/**
 * 一键门禁：规则检查 → 类型检查 → 单元/契约测试 → API 构建 → H5 构建。
 * 任何一步失败立即退出，CI 与本地共用同一入口。
 */
import { spawnSync } from 'node:child_process';

const isWin = process.platform === 'win32';
const steps = [
  { name: '规则检查', cmd: 'pnpm run lint' },
  { name: '类型检查', cmd: 'pnpm run typecheck' },
  { name: '自动化测试', cmd: 'pnpm run test' },
  { name: 'API 构建', cmd: 'pnpm run build:api' },
  { name: 'H5 构建', cmd: 'pnpm run build:h5' },
];

const started = Date.now();
const results = [];

for (const step of steps) {
  const t0 = Date.now();
  process.stdout.write(`\n▶ ${step.name} … `);
  const res = spawnSync(step.cmd, {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, CI: process.env.CI ?? '1' },
  });
  const cost = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.status !== 0) {
    process.stdout.write(`✗ (${cost}s)\n`);
    results.push({ ...step, ok: false, cost });
    report(results, false);
    process.exit(res.status ?? 1);
  }
  process.stdout.write(`✓ (${cost}s)\n`);
  results.push({ ...step, ok: true, cost });
}

report(results, true);
console.info(`\n总耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);

function report(list, ok) {
  console.info('\n===== 门禁结果 =====');
  for (const item of list) {
    console.info(`${item.ok ? '✓' : '✗'} ${item.name}  ${item.cost}s`);
  }
  console.info(ok ? '全部通过' : '存在失败项');
  if (isWin && !ok) console.info('提示：Windows 下若 pnpm 未在 PATH，请先执行 corepack enable pnpm');
}
