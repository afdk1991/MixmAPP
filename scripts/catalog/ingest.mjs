/**
 * 站点无关的入库层：读取本站在库商品、插入、字段级更新、下架、同步时间戳、变更流水。
 *
 * 两个货源站共用这一层，差异全部由适配器提供：
 *   - scope：本站商品在 products 里的行范围（绝不能跨站，否则会把别站商品误判下架）
 *   - idPrefix：本站商品 id 前缀（egl- / hzn-）
 *   - importBatch：本站首次导入批次名
 *   - buildNext(item, detail, specImage)：本站字段映射
 *   - columns(item, next, ctx)：本站插入时的列值
 */
import { PRICE_FIELDS, diffProduct } from './mapping.mjs';

export const CHUNK = 400;

export const JSON_COLUMNS = new Set([
  'attributes',
  'promotions',
  'unit_options',
  'unit_conversions',
  'specs',
  'images',
  'tags',
]);

/** 比对需要的列；两站同一张表，列集合一致。 */
export const COMPARE_COLUMNS = [
  'id', 'source_key', 'source_item_no', 'title', 'subtitle', 'price_fen', 'price_li', 'discount_pct',
  'sale_price_li', 'brand', 'category', 'category_path', 'category_name', 'specs', 'attributes', 'unit',
  'pack_qty', 'packaging_desc', 'unit_options', 'unit_conversions', 'spec_image', 'promotions',
  'images', 'cover', 'listed', 'source_status', 'source_on_sale', 'source_inv_status', 'price_source',
  'max_order_qty', 'tejia_discount_pct',
];

/** 只读：按站点 scope 取在库商品。 */
export async function loadScopeRows(reader, scope) {
  const res = await reader.query(
    `select ${COMPARE_COLUMNS.join(', ')} from products where ${scope.sql}`,
    scope.params || []
  );
  return res.rows;
}

/** 插入一行商品；source_key 冲突时不覆盖（幂等，重跑不产生重复行）。 */
export async function insertProduct(client, columns) {
  const cols = Object.keys(columns);
  const placeholders = cols.map((c, i) => (JSON_COLUMNS.has(c) ? `$${i + 1}::jsonb` : `$${i + 1}`));
  const params = cols.map((c) => (JSON_COLUMNS.has(c) ? JSON.stringify(columns[c]) : columns[c]));
  const res = await client.query(
    `insert into products (${cols.join(', ')}, synced_at) values (${placeholders.join(', ')}, now())
     on conflict (source_key) do nothing`,
    params
  );
  return res.rowCount;
}

/** 按字段更新；changed 为 diffProduct 的变更项。 */
export async function updateProduct(client, id, changes, hasPrice) {
  const sets = [];
  const params = [id];
  let idx = 2;
  for (const c of changes) {
    if (c.field === 'listed') {
      sets.push(`listed = $${idx}`);
      params.push(c.new);
      idx += 1;
    } else if (c.field === 'source_status') {
      sets.push(`source_status = $${idx}`, 'source_status_at = now()');
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

/** 本次目录里不存在的在库商品 → 只标不可售，不物理删除（保留历史订单）。 */
export async function delistMissing({ client, rows, seen, stats, changeLog, dryRun }) {
  for (const db of rows) {
    if (seen.has(db.source_key)) continue;
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
    if (db.listed !== false) changeLog.push({ id: db.id, key: db.source_key, field: 'listed', old: db.listed, new: false });
    changeLog.push({ id: db.id, key: db.source_key, field: 'source_status', old: db.source_status, new: 'delisted' });
  }
}

/** 刷新本次见到的商品 synced_at（分批，避免超长参数）。 */
export async function touchSynced(client, keys) {
  for (let i = 0; i < keys.length; i += 1000) {
    await client.query('update products set synced_at = now() where source_key = any($1::text[])', [
      keys.slice(i, i + 1000),
    ]);
  }
}

/** 批量写变更流水。 */
export async function writeChangeLog(client, runId, changeLog) {
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

export function emptyStats() {
  return {
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
}

/**
 * 阶段三（站点无关版）：比对与落库。
 *
 * @param {{cfg: object, state: object, items: Array, details: {items: object},
 *          adapter: {idOf, buildNext, columns, scope, dryRunSafe?: boolean},
 *          specImageByC3?: object, openPool: () => Promise<any>}} input
 */
export async function applySiteChanges({ cfg, state, items, details, adapter, specImageByC3, openPool }) {
  const startedAt = Date.now();
  const dryRun = cfg.dryRun;
  const runId = state.runId;
  const stats = emptyStats();

  const byKey = new Map();
  for (const item of items) byKey.set(item.sourceKey, item);
  const changeLog = [];
  const seenKeys = [];

  const pool = dryRun ? null : await openPool();
  const client = pool ? await pool.connect() : null;
  try {
    if (client) await client.query('begin');

    const reader = client || (dryRun ? null : await openPool());
    let dbRows;
    try {
      dbRows = dryRun ? [] : await loadScopeRows(reader, adapter.scope);
    } finally {
      if (!client && reader && reader.end) await reader.end();
    }
    const dbByKey = new Map(dbRows.map((row) => [row.source_key, row]));

    for (const [key, item] of byKey) {
      const detail = details.items[item.itemNo];
      if (!detail) {
        stats.detailErrors += 1;
        continue;
      }
      const next = adapter.buildNext(item, detail, specImageByC3?.[item.c3] || null);
      const db = dbByKey.get(key);
      seenKeys.push(key);

      if (!db) {
        stats.added += 1;
        if (dryRun) continue;
        const id = adapter.idOf(item);
        const inserted = await insertProduct(
          client,
          adapter.columns(item, next, { id, dbCount: dbByKey.size, added: stats.added })
        );
        if (inserted === 0) {
          stats.insertSkipped += 1;
          stats.added -= 1;
        } else {
          changeLog.push({ id, key, field: 'created', old: null, new: { sourceKey: key } });
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
      await updateProduct(client, db.id, changes, hasPrice);
    }

    if (state.delistSafe) {
      await delistMissing({ client, rows: dbRows, seen: new Set(byKey.keys()), stats, changeLog, dryRun });
    }

    if (!dryRun && seenKeys.length) await touchSynced(client, seenKeys);
    if (!dryRun && changeLog.length) await writeChangeLog(client, runId, changeLog);

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
