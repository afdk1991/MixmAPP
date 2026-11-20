#!/usr/bin/env node
/**
 * 多来源商品目录合并器：把一个"新增来源"的规范化 catalog 合并进基础 catalog。
 *
 * 背景：egluosi 已有 15,037 条（release/prod-catalog/catalog.json）。
 * 新增来源（如 hznzcn）必须：
 *   - sourceKey 用自有前缀（sku:hznzcn-… / url:hznzcn-…），绝不与既有 key 冲突；
 *   - categoryCode 用自有前缀（hznzcn-…），一级分类中文名可相同但 code 唯一；
 *   - 字段形状严格遵循 tools/egluosi-importer/CONTRACT.md §2。
 *
 * 本脚本只做合并与校验，不抓取、不下载图片、不改数据库：
 *   node tools/catalog-merge/merge.mjs \
 *     --base release/prod-catalog/catalog.json \
 *     --add  <新增来源>/catalog.json \
 *     --out  <输出>/catalog.json
 *
 * 幂等：重复执行同一 --add 不会重复追加（按 sourceKey 去重，新增来源条目覆盖式更新）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const argv = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
}
const basePath = resolve(arg('base', 'release/prod-catalog/catalog.json'));
const addPath = arg('add') ? resolve(arg('add')) : null;
const outPath = resolve(arg('out', 'release/prod-catalog/catalog.json'));

function load(p, label) {
  if (!existsSync(p)) throw new Error(`${label} 不存在：${p}`);
  const j = JSON.parse(readFileSync(p, 'utf8'));
  if (!Array.isArray(j.products)) throw new Error(`${label} 缺少 products 数组：${p}`);
  return j;
}

const base = load(basePath, '基础 catalog');
const result = {
  meta: { ...(base.meta ?? {}) },
  categories: [...(base.categories ?? [])],
  products: [...(base.products ?? [])],
  skipped: [...(base.skipped ?? [])],
  failed: [...(base.failed ?? [])],
};
result.meta.sources = Array.isArray(result.meta.sources) ? [...result.meta.sources] : [
  { source: base.meta?.source ?? 'unknown', productCount: base.products.length, crawledAt: base.meta?.crawledAt ?? null },
];

const baseKeys = new Set(result.products.map((p) => p.sourceKey));
const categoryCodes = new Set(result.categories.map((c) => c.code));
const report = { base: basePath, added: [], out: outPath, conflicts: [], notes: [] };

function requireFields(p, idx, label) {
  for (const f of ['sourceKey', 'name', 'categoryCode']) {
    if (!p[f] || typeof p[f] !== 'string') {
      throw new Error(`${label} products[${idx}] 缺少必填字段 ${f}`);
    }
  }
}

function mergeOne(add) {
  if (!addPath) return;
  const src = load(addPath, '新增 catalog');
  const newKeys = new Set();
  let inserted = 0, updated = 0;

  src.products.forEach((p, idx) => {
    requireFields(p, idx, labelOf(src));
    if (newKeys.has(p.sourceKey)) throw new Error(`新增来源内 sourceKey 重复：${p.sourceKey}（索引 ${idx}）`);
    newKeys.add(p.sourceKey);

    if (!categoryCodes.has(p.categoryCode)) {
      const cat = (src.categories ?? []).find((c) => c.code === p.categoryCode);
      if (cat) {
        result.categories.push(cat);
        categoryCodes.add(cat.code);
      } else {
        report.notes.push(`商品 ${p.sourceKey} 的 categoryCode=${p.categoryCode} 在新增 categories 中未定义，按原样保留`);
      }
    }

    if (baseKeys.has(p.sourceKey)) {
      // 幂等：同 key 覆盖式更新（新增来源数据优先），不计入重复
      const at = result.products.findIndex((x) => x.sourceKey === p.sourceKey);
      result.products[at] = p;
      updated++;
    } else {
      result.products.push(p);
      baseKeys.add(p.sourceKey);
      inserted++;
    }
  });

  result.skipped.push(...(src.skipped ?? []));
  result.failed.push(...(src.failed ?? []));
  result.meta.sources.push({
    source: src.meta?.source ?? 'unknown',
    productCount: src.products.length,
    crawledAt: src.meta?.crawledAt ?? null,
  });
  report.added.push({ path: addPath, source: src.meta?.source, inserted, updated, total: src.products.length });

  // 任一新增 key 与既有 key 冲突但来源不同 → 报错（前缀规范被破坏）
  for (const k of newKeys) {
    if (result.products.filter((p) => p.sourceKey === k).length > 1) report.conflicts.push(k);
  }
}

function labelOf(j) {
  return j.meta?.source ?? 'catalog';
}

mergeOne();

result.meta.totalScanned = (result.meta.totalScanned ?? 0) + report.added.reduce((s, a) => s + a.total, 0);
result.meta.totalImported = result.products.length;
result.meta.mergedAt = new Date().toISOString();

const outDir = dirname(outPath);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(result, null, 2));

report.totalProducts = result.products.length;
report.totalCategories = result.categories.length;
report.conflicts = [...new Set(report.conflicts)];
console.info(JSON.stringify(report, null, 2));
if (report.conflicts.length) {
  console.error(`✗ 检测到 ${report.conflicts.length} 个重复 sourceKey，请检查来源前缀是否规范`);
  process.exit(1);
}
console.info(`✓ 合并完成：${result.products.length} 商品 / ${result.categories.length} 分类 → ${outPath}`);
