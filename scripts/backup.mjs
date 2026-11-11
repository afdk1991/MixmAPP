#!/usr/bin/env node
/**
 * PostgreSQL 备份：pg_dump 自定义格式 → gzip，按保留天数清理旧包。
 * 环境变量：DATABASE_URL（必需）、BACKUP_DIR（默认 ./backups）、BACKUP_KEEP_DAYS（默认 14）
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const databaseUrl = process.env.DATABASE_URL;
const backupDir = resolve(process.env.BACKUP_DIR ?? 'backups');
const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 14);

if (!databaseUrl) {
  console.info('SKIP 未配置 DATABASE_URL，本次不备份');
  process.exit(0);
}

mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const file = join(backupDir, `mixmapp-${stamp}.sql.gz`);

const dump = spawn('pg_dump', ['--clean', '--if-exists', '--no-owner', '--format=plain', databaseUrl], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stderr = '';
dump.stderr.on('data', (chunk) => {
  stderr += String(chunk);
});

try {
  await pipeline(dump.stdout, createGzip({ level: 9 }), createWriteStream(file));
} catch (error) {
  console.error(`✗ 备份失败：${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const code = await new Promise((res) => dump.on('close', res));
if (code !== 0) {
  console.error(`✗ pg_dump 退出码 ${code}: ${stderr.slice(0, 500)}`);
  process.exit(1);
}

const size = statSync(file).size;
if (size < 1024) {
  console.error(`✗ 备份文件过小（${size} 字节），疑似失败`);
  process.exit(1);
}
console.info(`✓ 备份完成 ${file} (${(size / 1024).toFixed(1)} KB)`);

// 清理过期备份
const cutoff = Date.now() - keepDays * 24 * 3600 * 1000;
let removed = 0;
for (const name of readdirSync(backupDir)) {
  if (!name.endsWith('.sql.gz')) continue;
  const full = join(backupDir, name);
  if (!existsSync(full)) continue;
  if (statSync(full).mtimeMs < cutoff) {
    unlinkSync(full);
    removed += 1;
  }
}
console.info(`✓ 已清理 ${removed} 个超过 ${keepDays} 天的备份`);
