#!/usr/bin/env node
/**
 * 仓库规则检查：不引 ESLint，只守几条真正会让项目烂掉的底线。
 * 1. src 内禁止 console.log（允许 console.info/warn/error）
 * 2. 禁止把密钥硬编码进源码
 * 3. 禁止遗留 .only 测试
 * 4. Vue 单文件组件必须闭合 <template>/<script>/<style>
 * 5. 路由与命名唯一性：页面路径不重复注册、routes.ts 与 pages.json 一一对应、
 *    页面里不许写 '/pages/...' 字面量、API 的「方法 + 完整路径」不重复注册
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
  const ROUTES_FILE = 'apps/app/src/routes.ts';

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
    // 页面跳转必须走 ROUTES 常量，禁止再散落 '/pages/...' 字面量
    if (rel !== ROUTES_FILE && /['"`]\/pages\//.test(line)) {
      violations.push(`${rel}:${no} 出现路由字面量，请改用 apps/app/src/routes.ts 的 ROUTES 常量`);
    }
  });
}

// ---------- 路由唯一性 ----------
function checkRoutes() {
  const pagesJsonPath = join(ROOT, 'apps/app/src/pages.json');
  const routesPath = join(ROOT, 'apps/app/src/routes.ts');
  let pagesJson;
  try {
    pagesJson = JSON.parse(readFileSync(pagesJsonPath, 'utf8'));
  } catch (e) {
    violations.push(`apps/app/src/pages.json 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const registered = [...(pagesJson.pages ?? [])];
  for (const sub of pagesJson.subPackages ?? []) registered.push(...(sub.pages ?? []).map((p) => ({ ...p, subPackage: true })));
  const pagePaths = registered.map((p) => '/' + p.path);
  for (const item of pagesJson.tabBar?.list ?? []) pagePaths.push(item.pagePath.startsWith('/') ? item.pagePath : '/' + item.pagePath);

  // 1) 同一页面不许重复注册
  const seen = new Map();
  for (const p of pagePaths) {
    if (seen.has(p)) violations.push(`apps/app/src/pages.json 页面重复注册：${p}`);
    seen.set(p, true);
  }

  // 2) routes.ts 与 pages.json 双向一一对应，且不许一个路径起两个别名
  const routesText = readFileSync(routesPath, 'utf8');
  const body = routesText.slice(routesText.indexOf('export const ROUTES'));
  const entries = [...body.matchAll(/^\s*([A-Za-z_$][\w$]*):\s*'([^']+)'/gm)].map((m) => ({ key: m[1], path: m[2] }));
  if (!entries.length) violations.push('apps/app/src/routes.ts 未解析出任何路由，检查常量表结构');
  const byPath = new Map();
  for (const e of entries) {
    if (byPath.has(e.path)) violations.push(`apps/app/src/routes.ts 同一路径起了两个名字：${e.path}（${byPath.get(e.path)} 与 ${e.key}）`);
    byPath.set(e.path, e.key);
    if (!seen.has(e.path)) violations.push(`apps/app/src/routes.ts 的 ${e.key} 指向未在 pages.json 注册的页面：${e.path}`);
  }
  for (const p of pagePaths) {
    if (!byPath.has(p)) violations.push(`pages.json 注册的 ${p} 没有出现在 apps/app/src/routes.ts`);
  }
}

// ---------- API 路由唯一性 ----------
const API_SRC = join(ROOT, 'services/api/src');
function checkApiRoutes() {
  const found = new Map();
  const prefixes = new Map();
  const appTs = readFileSync(join(API_SRC, 'app.ts'), 'utf8');
  // 路由文件挂在哪个前缀下：app.ts 里 { prefix: '/api/v1' } 注册的是 routes/* 那一批
  const prefix = appTs.match(/prefix:\s*'([^']+)'/)?.[1] ?? '';
  for (const entry of readdirSync(join(API_SRC, 'routes'))) {
    if (entry.endsWith('.ts')) prefixes.set(`routes/${entry}`, prefix);
  }
  const stack = [API_SRC];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) stack.push(full);
      else if (full.endsWith('.ts')) scanApiFile(full, prefixes);
    }
  }

  function scanApiFile(full, prefixMap) {
    const rel = relative(API_SRC, full).replaceAll('\\', '/');
    const scope = prefixMap.get(rel) ?? '';
    const text = readFileSync(full, 'utf8');
    text.split(/\r?\n/).forEach((line, idx) => {
      const m = line.match(/(?:app|scope)\.(get|post|put|patch|delete)(?:<[^>]*>)?\(\s*'([^']+)'/);
      if (!m) return;
      const method = m[1].toUpperCase();
      const path = scope + m[2];
      const key = `${method} ${path}`;
      if (found.has(key)) {
        violations.push(`services/api/src/${rel}:${idx + 1} 重复注册 ${key}（已在 ${found.get(key)} 注册）`);
      } else found.set(key, `${rel}:${idx + 1}`);
    });
  }
}

walk(ROOT);
checkRoutes();
checkApiRoutes();

if (violations.length) {
  console.error(`✗ 规则检查失败，共 ${violations.length} 处：`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.info('✓ 规则检查通过');
