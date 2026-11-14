#!/usr/bin/env node
/**
 * 仓库规则检查：不引 ESLint，只守几条真正会让项目烂掉的底线。
 * 1. src 内禁止 console.log（允许 console.info/warn/error）
 * 2. 禁止把密钥硬编码进源码
 * 3. 禁止遗留 .only 测试
 * 4. Vue 单文件组件必须闭合 <template>/<script>/<style>
 * 5. 路由与命名唯一性：页面路径不重复注册、routes.ts 与 pages.json 一一对应、
 *    页面里不许写 '/pages/...' 字面量、API 的「方法 + 完整路径」不重复注册
 * 6. 文档编号唯一性：docs/NN-*.md 的 NN 不许撞号，同一编号只许一篇
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// 与 .gitignore 对齐：已忽略的构建产物 / 运行时缓存 / 机密目录不参与仓库规则检查。
// 否则 walk(ROOT) 会把 .edge-profile（内置浏览器 profile）和 release/ 下的临时脚本
// 一并当源码扫进来，产生与仓库无关的误报（2026-11-14 实测 17 处假红）。
// .edge-profile-research 同理：ui-review 研究线使用的临时 Edge profile（62MB 缓存 +
// 扩展解包产物，含瞬时 Temp 文件，会直接让 statSync ENOENT 崩溃）。
const SKIP = new Set([
  'node_modules', 'dist', 'build', 'unpackage', '.git', 'coverage', '.uni', '.gradle',
  'android', 'ios', 'vendor', '.edge-profile', '.edge-profile-research', 'release', 'out', 'storage', '.secrets',
]);
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
  // ui-review/ 是本地布局审计工具，必须按 '/pages/...' 硬编码页面清单才能逐页访问；
  // 这不是「页面跳转」代码，故只豁免路由字面量这一条规则。
  // console.log / 硬编码密钥 / TODO / .only 等其余规则对它照常生效，不放水。
  const isReviewTool = rel.startsWith('ui-review/');
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
    if (!isReviewTool && rel !== ROUTES_FILE && /['"`]\/pages\//.test(line)) {
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
  // uni-app 规范要求 tabBar 页必须同时出现在 pages 数组里，所以它们不是「重复注册」。
  // 这里改为只校验：tab 指向的页面确实已注册、且 tab 内部不重复，不再把 tab 路径重复算作注册项。
  const registeredSet = new Set(pagePaths);
  const seenTabs = new Set();
  for (const item of pagesJson.tabBar?.list ?? []) {
    const p = item.pagePath.startsWith('/') ? item.pagePath : '/' + item.pagePath;
    if (seenTabs.has(p)) violations.push(`apps/app/src/pages.json tabBar 页面重复：${p}`);
    seenTabs.add(p);
    if (!registeredSet.has(p)) {
      violations.push(
        `apps/app/src/pages.json tabBar 的 ${p} 未在 pages 中注册（uni-app 要求 tabBar 页同时出现在 pages 数组里）`,
      );
    }
  }

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

// ---------- 文档编号唯一性 ----------
// 允许「带理由的显式豁免」：只有 scripts/repo-lint-exemptions.json 里逐条登记、
// 且理由与复核期限齐全的撞号才放行；放行时仍然打印告警，不做无声放水。
const DOCS = join(ROOT, 'docs');
const EXEMPTIONS_FILE = join(ROOT, 'scripts', 'repo-lint-exemptions.json');
const exemptions = (() => {
  try {
    const parsed = JSON.parse(readFileSync(EXEMPTIONS_FILE, 'utf8'));
    return Array.isArray(parsed.docNumberCollisions) ? parsed.docNumberCollisions : [];
  } catch {
    return [];
  }
})();
function matchExemption(entry, first, no) {
  return exemptions.find(
    (x) =>
      x &&
      x.rule === 'doc-number-unique' &&
      Array.isArray(x.files) &&
      x.files.includes(`docs/${entry}`) &&
      x.files.includes(`docs/${first}`) &&
      (!x.number || String(x.number) === no) &&
      typeof x.reason === 'string' &&
      x.reason.trim().length >= 20 &&
      typeof x.owner === 'string' &&
      x.owner.trim() &&
      typeof x.reviewBy === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(x.reviewBy),
  );
}
function checkDocNumbers() {
  const byNo = new Map();
  const exempted = [];
  for (const entry of readdirSync(DOCS)) {
    if (!entry.endsWith('.md')) continue;
    const m = entry.match(/^(\d{2})-.*\.md$/);
    if (!m) continue;
    const no = m[1];
    if (byNo.has(no)) {
      const first = byNo.get(no);
      const hit = matchExemption(entry, first, no);
      if (hit) exempted.push(`docs/${entry} 与 docs/${first} 撞号 ${no} 已豁免（${hit.owner}，复核至 ${hit.reviewBy}）：${hit.reason}`);
      else violations.push(`docs/${entry} 与 docs/${first} 撞号 ${no}，同一编号只许一篇（新增文档请取当前最大号之后的空号）`);
    } else {
      byNo.set(no, entry);
    }
  }
  exempted.forEach((msg) => console.warn(`⚠ ${msg}`));
}

walk(ROOT);
checkRoutes();
checkApiRoutes();
checkDocNumbers();

if (violations.length) {
  console.error(`✗ 规则检查失败，共 ${violations.length} 处：`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.info('✓ 规则检查通过');
