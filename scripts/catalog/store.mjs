/**
 * 落库：按 source_key 幂等 upsert、字段级流水、下架只标不可售。
 *
 * 只在这里碰数据库；采集与字段规则分别在 collect.mjs / mapping.mjs。
 * 站点无关的入库机制在 ingest.mjs；本文件只保留「本站连接 + egluosi 字段映射」。
 */
import path from 'node:path';
import { createRequire } from 'node:module';

import { IMPORT_BATCH, MAX_ORDER_QTY, buildDetail, deriveStock } from './mapping.mjs';
import { applySiteChanges } from './ingest.mjs';

/** 复用发布目录的 node_modules（生产 release 里 pg 在 APP_ROOT/node_modules）。 */
function loadPg() {
  const roots = [process.env.APP_ROOT, process.cwd()].filter(Boolean);
  for (const root of roots) {
    try {
      return createRequire(path.join(root, 'package.json'))('pg');
    } catch {
      /* 换下一个候选 */
    }
  }
  return createRequire(import.meta.url)('pg');
}

export function connectionString() {
  return process.env.DATABASE_URL_LOCAL || process.env.DATABASE_URL || '';
}

export function requireConnection() {
  const cs = connectionString();
  if (!cs) throw new Error('未找到 DATABASE_URL_LOCAL / DATABASE_URL，无法写库（只对账请用 --dry-run）');
  return cs;
}

export async function openPool() {
  const { Pool } = loadPg();
  return new Pool({ connectionString: requireConnection() });
}

export async function markRunStarted(runId, startedAt) {
  const pool = await openPool();
  try {
    await pool.query(
      `insert into catalog_sync_runs (run_id, started_at, status) values ($1, $2, 'running')
       on conflict (run_id) do update set status = 'running', error = null`,
      [runId, startedAt]
    );
  } finally {
    await pool.end();
  }
}

export async function markRunFinished(runId, status, stats, reportPath, error) {
  // 失败摘要落库给 healthz 用：压成单行并截断，避免整段堆栈占满响应
  const summary = error
    ? String(error).replace(/\s+/g, ' ').trim().slice(0, 500)
    : null;
  const pool = await openPool();
  try {
    await pool.query(
      `update catalog_sync_runs
          set finished_at = now(), status = $2, stats = $3::jsonb, report_path = $4, error = $5
        where run_id = $1`,
      [runId, status, JSON.stringify(stats), reportPath, summary]
    );
  } finally {
    await pool.end();
  }
}

/** 只读：按 source_key 取一件商品，供 inspect 对比。 */
export async function readProductByKey(sourceKey) {
  const pool = await openPool();
  try {
    const res = await pool.query('select * from products where source_key = $1 limit 1', [sourceKey]);
    return res.rows[0] || null;
  } finally {
    await pool.end();
  }
}

/** 画廊里的规格图：c3 → 图片 URL */
function specImageMap(gallery) {
  const out = {};
  for (const [c3, entries] of Object.entries(gallery || {})) {
    const spec = entries.find((e) => e.role === 'spec' && e.url);
    if (spec) out[c3] = spec.url;
  }
  return out;
}

/**
 * egluosi 站点适配器：scope / id 前缀 / 字段映射保持既有口径，不随新站点改动。
 * 该适配器同时被 ingest.mjs 的通用入库流程使用。
 */
export const egluosiAdapter = {
  idPrefix: 'egl-',
  importBatch: IMPORT_BATCH,
  scope: { sql: `source_key like 'sku:%' or source_key like 'url:%'`, params: [] },
  idOf: (item) => `egl-${item.sourceId || item.itemNo}`,
  buildNext(item, detail, specImage) {
    return {
      ...buildDetail(detail, specImage),
      title: item.name,
      subtitle: item.subtitle,
      brand: item.brand,
      categoryCode: item.categoryCode,
      categoryPath: item.categoryPath,
      packQty: item.packQty,
      images: item.images,
      cover: item.cover,
    };
  },
  columns(item, next, ctx) {
    const priced = next.priceLi != null;
    const stockPlan = deriveStock(next.unitConversions, priced);
    const categoryName = next.categoryPath[next.categoryPath.length - 1] || next.categoryCode;
    return {
      id: ctx.id,
      title: item.name,
      subtitle: item.subtitle,
      price_fen: priced ? next.priceFen : 0,
      original_price_fen: 0,
      stock: stockPlan.stock,
      category: item.categoryCode,
      cover: item.cover,
      images: item.images,
      tags: [item.brand, categoryName].filter(Boolean),
      description: item.description,
      sort_no: ctx.dbCount + ctx.added,
      source_key: item.sourceKey,
      source_url: item.sourceUrl,
      source_id: item.sourceId,
      brand: item.brand || null,
      category_path: item.categoryPath.join('/'),
      category_name: categoryName,
      specs: next.specs,
      unit: next.unit,
      pack_qty: priced ? null : item.packQty,
      price_source: priced ? 'anonymous' : 'inquiry',
      price_captured_at: item.priceCapturedAt,
      stock_source: stockPlan.stockSource,
      import_batch: IMPORT_BATCH,
      attributes: next.attributes,
      price_li: next.priceLi,
      discount_pct: next.discountPct,
      sale_price_li: next.salePriceLi,
      promotions: next.promotions,
      packaging_desc: next.packagingDesc,
      unit_options: next.unitOptions,
      unit_conversions: next.unitConversions,
      spec_image: next.specImage,
      source_item_no: item.itemNo,
      min_order_qty: 1,
      qty_step: 1,
      max_order_qty: MAX_ORDER_QTY,
      listed: next.sourceOnSale,
      source_status: next.sourceOnSale ? 'active' : 'off-sale',
      source_status_at: new Date().toISOString(),
      source_on_sale: next.sourceOnSale,
      source_inv_status: next.sourceInvStatus,
      // 特价折扣：只透传落库，不参与价格派生
      tejia_discount_pct: next.tejiaDiscountPct,
    };
  },
};

/**
 * 阶段三：比对与落库（egluosi）。
 * @param {{cfg: object, state: object, items: Array, details: {items: object}, gallery: object}} input
 */
export async function applyChanges({ cfg, state, items, details, gallery }) {
  return applySiteChanges({
    cfg,
    state,
    items,
    details,
    adapter: egluosiAdapter,
    specImageByC3: specImageMap(gallery),
    openPool,
  });
}
