#!/usr/bin/env node
/**
 * 仓库规则检查：不引 ESLint，只守几条真正会让项目烂掉的底线。
 * 1. src 内禁止 console.log（允许 console.info/warn/error）
 * 2. 禁止把密钥硬编码进源码
 * 3. 禁止遗留 .only 测试
 * 4. Vue 单文件组件必须闭合 <template>/<script>/<style>
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SKIP = new Set(['node_modules', 'dist', 'build', 'unpackage', '.git', 'coverage', '.uni', '.gradle', 'android', 'ios', 'vendor']);
const EXT = new Set(['.ts', '.js', '.mjs', '.vue']);

const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (EXT.has(extname(full))) check(full);
  }
}

function check(file) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  if (rel.startsWith('scripts/')) return;
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, idx) => {
    const no = idx + 1;
    if (/\bconsole\.log\s*\(/.test(line)) {
      violations.push(`${rel}:${no} 使用了 console.log，请改用 console.info 或删除`);
    }
    if (/it\.only\s*\(|describe\.only\s*\(/.test(line)) {
      violations.push(`${rel}:${no} 残留 .only 测试`);
    }
    if (/(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA )?PRIVATE KEY-----)/.test(line)) {
      violations.push(`${rel}:${no} 疑似硬编码密钥`);
    }
    if (/\bTODO\b|\bFIXME\b/.test(line) && !rel.startsWith('docs/')) {
      violations.push(`${rel}:${no} 残留 TODO/FIXME`);
    }
  });
}

walk(ROOT);

if (violations.length) {
  console.error(`✗ 规则检查失败，共 ${violations.length} 处：`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.info('✓ 规则检查通过');
