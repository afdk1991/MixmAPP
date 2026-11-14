/**
 * 落库：按 source_key 幂等 upsert、字段级流水、下架只标不可售。
 *
 * 只在这里碰数据库；采集与字段规则分别在 collect.mjs / mapping.mjs。
 */
import path from 'node:path';
import { createRequire } from 'node:module';

import { IMPORT_BATCH, MAX_ORDER_QTY, PRICE_FIELDS, buildDetail, deriveStock, diffProduct } from './mapping.mjs';

const CHUNK = 400;
const JSON_COLUMNS = new Set(['attributes', 'promotions', 'unit_options', 'unit_conversions', 'specs', 'images']);

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
 * 阶段三：比对与落库。
 * @param {{cfg: object, state: object, items: Array, details: {items: object}, gallery: object}} input
 */
export async function applyChanges({ cfg, state, items, details, gallery }) {
  const startedAt = Date.now();
  const dryRun = cfg.dryRun;
  const specImageByC3 = specImageMap(gallery);
  const runId = state.runId;

  const stats = {
    added: 0,
    delisted: 0,
    offSale: 0,
    relisted: 0,
    priceChanged: 0,
    otherChanged: 0,
    unchanged: 0,
    detailErrors: 0,
    insertSkipped: 0,
    changeRows: 0,
  };

  const byKey = new Map();
  for (const item of items) byKey.set(item.sourceKey, item);
  const changeLog = [];
  const seenKeys = [];

  const pool = dryRun ? null : await openPool();
  const client = pool ? await pool.connect() : null;
  try {
    if (client) await client.query('begin');

    // dry-run 也要读库比对，只读连接单独开
    const reader = client || (await openPool());
    let dbRows;
    try {
      const res = await reader.query(
        `select id, source_key, source_item_no, title, subtitle, price_fen, price_li, discount_pct,
                sale_price_li, brand, category, category_path, category_name, specs, attributes, unit,
                pack_qty, packaging_desc, unit_options, unit_conversions, spec_image, promotions,
                images, cover, listed, source_status, source_on_sale, source_inv_status, price_source,
                max_order_qty
           from products
          where source_key like 'sku:%' or source_key like 'url:%'`
      );
      dbRows = res.rows;
    } finally {
      if (!client && reader.end) await reader.end();
    }
    const dbByKey = new Map(dbRows.map((row) => [row.source_key, row]));

    for (const [key, item] of byKey) {
      const detail = details.items[item.itemNo];
      if (!detail) {
        stats.detailErrors += 1;
        continue;
      }
      const next = {
        ...buildDetail(detail, specImageByC3[item.c3] || null),
        title: item.name,
        subtitle: item.subtitle,
        brand: item.brand,
        categoryCode: item.categoryCode,
        categoryPath: item.categoryPath,
        packQty: item.packQty,
        images: item.images,
        cover: item.cover,
      };
      const db = dbByKey.get(key);
      seenKeys.push(key);

      if (!db) {
        stats.added += 1;
        if (dryRun) continue;
        const priced = next.priceLi != null;
        const stockPlan = deriveStock(next.unitConversions, priced);
        const categoryName = next.categoryPath[next.categoryPath.length - 1] || next.categoryCode;
        const inserted = await client.query(
          `insert into products (
             id, title, subtitle, price_fen, original_price_fen, stock, category, cover,
             images, tags, description, sort_no, source_key, source_url, source_id, brand,
             category_path, category_name, specs, unit, pack_qty, price_source, price_captured_at,
             stock_source, import_batch, attributes, price_li, discount_pct, sale_price_li,
             promotions, packaging_desc, unit_options, unit_conversions, spec_image, source_item_no,
             min_order_qty, qty_step, max_order_qty, listed, source_status, source_status_at,
             source_on_sale, source_inv_status, synced_at
           ) values (
             $1,$2,$3,$4,0,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,
             $18::jsonb,$19,$20,$21,$22,$23,$24,$25::jsonb,$26,$27,$28,$29::jsonb,$30,$31::jsonb,
             $32::jsonb,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,now()
           )
           on conflict (source_key) do nothing`,
          [
            `egl-${item.sourceId || item.itemNo}`,
            item.name,
            item.subtitle,
            priced ? next.priceFen : 0,
            stockPlan.stock,
            item.categoryCode,
            item.cover,
            JSON.stringify(item.images),
            JSON.stringify([item.brand, categoryName].filter(Boolean)),
            item.description,
            dbByKey.size + stats.added,
            key,
            item.sourceUrl,
            item.sourceId,
            item.brand || null,
            item.categoryPath.join('/'),
            categoryName,
            JSON.stringify(next.specs),
            next.unit,
            priced ? null : item.packQty,
            priced ? 'anonymous' : 'inquiry',
            item.priceCapturedAt,
            stockPlan.stockSource,
            IMPORT_BATCH,
            JSON.stringify(next.attributes),
            next.priceLi,
            next.discountPct,
            next.salePriceLi,
            JSON.stringify(next.promotions),
            next.packagingDesc,
            JSON.stringify(next.unitOptions),
            JSON.stringify(next.unitConversions),
            next.specImage,
            item.itemNo,
            1,
            1,
            MAX_ORDER_QTY,
            next.sourceOnSale,
            next.sourceOnSale ? 'active' : 'off-sale',
            new Date().toISOString(),
            next.sourceOnSale,
            next.sourceInvStatus,
          ]
        );
        if (inserted.rowCount === 0) {
          stats.insertSkipped += 1;
          stats.added -= 1;
        } else {
          changeLog.push({ id: `egl-${item.sourceId || item.itemNo}`, key, field: 'created', old: null, new: { sourceKey: key } });
        }
        continue;
      }

      if (!db.source_item_no && !dryRun) {
        await client.query('update products set source_item_no = $2 where id = $1', [db.id, item.itemNo]);
      }

      const changes = diffProduct(db, next);

      // 详情 onSale=false 视为源站下架（只标不可售，不物理删除）
      const wantListed = next.sourceOnSale;
      if (db.listed !== wantListed) {
        changes.push({ field: 'listed', old: db.listed, new: wantListed });
        changes.push({ field: 'source_status', old: db.source_status, new: wantListed ? 'active' : 'off-sale' });
        if (wantListed) stats.relisted += 1;
        else stats.offSale += 1;
      } else if (db.source_status == null) {
        changes.push({ field: 'source_status', old: null, new: wantListed ? 'active' : 'off-sale', silent: true });
      }

      const visible = changes.filter((c) => !c.silent);
      if (visible.length === 0) {
        stats.unchanged += 1;
        if (changes.length === 0) continue;
      }

      const hasPrice = visible.some((c) => PRICE_FIELDS.has(c.field));
      if (hasPrice) stats.priceChanged += 1;
      if (visible.some((c) => !PRICE_FIELDS.has(c.field) && c.field !== 'listed' && c.field !== 'source_status')) {
        stats.otherChanged += 1;
      }
      for (const c of visible) changeLog.push({ id: db.id, key, field: c.field, old: c.old, new: c.new });

      if (dryRun) continue;
      const sets = [];
      const params = [db.id];
      let idx = 2;
      for (const c of changes) {
        if (c.field === 'listed') {
          sets.push(`listed = $${idx}`);
          params.push(c.new);
          idx += 1;
        } else if (c.field === 'source_status') {
          sets.push(`source_status = $${idx}`, `source_status_at = now()`);
          params.push(c.new);
          idx += 1;
        } else {
          sets.push(`${c.field} = $${idx}${JSON_COLUMNS.has(c.field) ? '::jsonb' : ''}`);
          params.push(JSON_COLUMNS.has(c.field) ? JSON.stringify(c.new) : c.new);
          idx += 1;
        }
      }
      if (hasPrice) sets.push('price_changed_at = now()');
      sets.push('synced_at = now()');
      await client.query(`update products set ${sets.join(', ')} where id = $1`, params);
    }

    // 源站已不存在，且本次目录抓取无失败 → 标记不可售（保留历史订单）
    if (state.delistSafe) {
      for (const [key, db] of dbByKey) {
        if (byKey.has(key)) continue;
        if (db.listed === false && db.source_status === 'delisted') continue;
        if (!dryRun) {
          await client.query(
            `update products set listed = false, source_status = 'delisted',
                    source_status_at = now(), synced_at = now()
              where id = $1`,
            [db.id]
          );
        }
        stats.delisted += 1;
        if (db.listed !== false) changeLog.push({ id: db.id, key, field: 'listed', old: db.listed, new: false });
        changeLog.push({ id: db.id, key, field: 'source_status', old: db.source_status, new: 'delisted' });
      }
    }

    if (!dryRun && seenKeys.length) {
      for (let i = 0; i < seenKeys.length; i += 1000) {
        await client.query('update products set synced_at = now() where source_key = any($1::text[])', [
          seenKeys.slice(i, i + 1000),
        ]);
      }
    }

    if (!dryRun && changeLog.length) {
      for (let i = 0; i < changeLog.length; i += CHUNK) {
        const chunk = changeLog.slice(i, i + CHUNK);
        const values = [];
        const params = [];
        chunk.forEach((c, n) => {
          // 每行 6 个参数（changed_at 用 now()）；写成 7 会让占位符悬空报错
          const b = n * 6;
          values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5}::jsonb,$${b + 6}::jsonb,now())`);
          params.push(runId, c.id, c.key, c.field, JSON.stringify(c.old), JSON.stringify(c.new));
        });
        await client.query(
          `insert into product_change_log (run_id, product_id, source_key, field, old_value, new_value, changed_at)
           values ${values.join(',')}`,
          params
        );
      }
    }

    stats.changeRows = changeLog.length;
    if (client) await client.query('commit');
    return { stats, changeLog, durationSec: Math.round((Date.now() - startedAt) / 1000) };
  } catch (e) {
    if (client) await client.query('rollback');
    throw e;
  } finally {
    if (client) client.release();
    if (pool) await pool.end();
  }
}
