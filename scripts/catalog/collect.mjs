/**
 * 采集：目录树 → 叶子类目 → 商品列表（分页）→ 规格筛选项 → 详情。
 *
 * 只负责取数与拼装，不碰数据库；所有字段落地规则在 mapping.mjs。
 */
import fs from 'node:fs';
import path from 'node:path';

import { C1_CODE, DETAIL_KEYS, buildCatalogItem } from './mapping.mjs';
import { writeAtomic, readJson } from './util.mjs';
import { mapPool } from './site.mjs';

const PAGE_SIZE = 200;
const DETAIL_PERSIST_EVERY = 200;
const HANDSHAKE_EVERY = 2000;

/** 目录树 → 叶子类目（带一级元信息与完整路径） */
export function flattenLeaves(roots) {
  const leaves = [];
  const walk = (nodes, trail, c1, out) => {
    for (const node of nodes || []) {
      const ctg = node.ctg || {};
      const nextTrail = [...trail, ctg.name].filter(Boolean);
      if (Array.isArray(node.subs) && node.subs.length > 0) walk(node.subs, nextTrail, c1, out);
      else out.push({ code: c1.code, c1, leafValue: ctg.value, path: nextTrail });
    }
  };
  for (const root of roots || []) {
    const ctg = root.ctg || {};
    const c1 = {
      code: C1_CODE[ctg.value] || `c1-${ctg.value}`,
      name: ctg.name,
      siteValue: ctg.value,
      path: [ctg.name],
    };
    walk(root.subs || [], [ctg.name], c1, leaves);
  }
  return leaves;
}

export async function fetchTree(client) {
  const tree = await client.getJson(`${client.SVR}/api/ctg/ccc`, `${client.origin}/b2b/`);
  return Array.isArray(tree) ? tree : tree.main || [];
}

/** 规格筛选项（每个三级类目一组） */
export async function fetchFilters(client, c3) {
  return client.getJson(
    `${client.SVR}/api/mall/ccc_filter?c3=${encodeURIComponent(c3)}`,
    `${client.origin}/b2b/mall/ctg_items?c3=${encodeURIComponent(c3)}`
  );
}

/** 某三级类目的全部商品行（自动翻页；任一页失败直接抛出，由调用方记失败类目） */
export async function fetchCategoryRows(client, c3, { dims, lens } = {}) {
  const rows = [];
  let offset = 0;
  let total = 0;
  const referer = `${client.origin}/b2b/mall/ctg_items?c3=${encodeURIComponent(c3)}`;
  const extra = `${dims ? `&dims=${encodeURIComponent(dims)}` : ''}${lens ? `&lens=${encodeURIComponent(lens)}` : ''}`;
  while (true) {
    const page = await client.getJson(
      `${client.SVR}/api/mall/ccc_items?c3=${encodeURIComponent(c3)}&offset=${offset}&limit=${PAGE_SIZE}${extra}`,
      referer
    );
    const pageRows = Array.isArray(page.rows) ? page.rows : [];
    total = Number(page.total) || pageRows.length;
    rows.push(...pageRows);
    offset += pageRows.length;
    if (pageRows.length === 0 || rows.length >= total) break;
  }
  return { rows, total };
}

/** 单件详情；缺失字段统一补 null，保证 buildDetail 见到稳定结构。 */
export async function fetchItem(client, no, delayMs) {
  try {
    const json = await client.getJson(
      `${client.SVR}/api/mall/item?itemNo=${encodeURIComponent(no)}`,
      `${client.origin}/b2b/mall/item?itemNo=${no}`,
      delayMs
    );
    return { ok: true, item: Object.fromEntries(DETAIL_KEYS.map((k) => [k, json[k] === undefined ? null : json[k]])) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 旧版本画廊缓存的第 2-4 张是 80×80 的 `_s`，复用会让详情页继续模糊，命中就重采。 */
function isStaleGallery(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return true;
  return entries.some((e) => String(e?.remote || '').endsWith('_s'));
}

/** 类目画廊（按 c3 缓存到 gallery.json，跨运行复用） */
export async function collectGallery(client, cfg, c3, cache) {
  if (cache[c3] && !isStaleGallery(cache[c3])) return cache[c3];
  const entries = await client.galleryForC3(c3);
  cache[c3] = entries;
  writeAtomic(path.join(cfg.stateDir, 'gallery.json'), cache);
  return entries;
}

/**
 * 阶段一：目录 + 筛选项。
 * @returns {{items: Array, perCategory: Array, filters: Object, errors: Array, listFailed: number}}
 */
export async function collectCatalog(client, cfg, log) {
  const startedAt = Date.now();
  const galleryCache = readJson(path.join(cfg.stateDir, 'gallery.json'), {});
  const filtersFile = path.join(cfg.stateDir, 'filters.json');
  const filters = cfg.withFilters ? readJson(filtersFile, {}) : {};

  await client.handshake();
  const leaves = flattenLeaves(await fetchTree(client));
  const targets = cfg.limit > 0 ? leaves.slice(0, cfg.limit) : leaves;
  log(`[catalog] 三级类目 ${targets.length} 个`);

  if (cfg.withFilters) {
    for (const leaf of targets) {
      try {
        filters[leaf.leafValue] = await fetchFilters(client, leaf.leafValue);
      } catch (e) {
        log(`[filters] c3=${leaf.leafValue} 失败：${e instanceof Error ? e.message : e}`);
      }
    }
    writeAtomic(filtersFile, filters);
  }
  if (cfg.filtersOnly) {
    return { items: [], perCategory: [], filters, errors: [], listFailed: 0 };
  }

  const items = [];
  const perCategory = [];
  const errors = [];
  let listFailed = 0;
  let scanned = 0;

  for (const leaf of targets) {
    const c3 = leaf.leafValue;
    let rows = [];
    let siteCount = 0;
    let failed = false;
    try {
      const page = await fetchCategoryRows(client, c3);
      rows = page.rows;
      siteCount = page.total;
    } catch (e) {
      failed = true;
      listFailed += 1;
      errors.push({ c3, error: e instanceof Error ? e.message : String(e) });
    }
    scanned += siteCount;

    // 画廊按 c3 复用缓存；只有开启下载且缓存缺失/过期时才出网，避免 --no-images 把已有图片清空
    let gallery = galleryCache[c3] && !isStaleGallery(galleryCache[c3]) ? galleryCache[c3] : [];
    if (rows.length > 0 && cfg.downloadImages && isStaleGallery(galleryCache[c3])) {
      try {
        gallery = await collectGallery(client, cfg, c3, galleryCache);
      } catch (e) {
        errors.push({ c3, error: `画廊：${e instanceof Error ? e.message : String(e)}` });
      }
    }

    let added = 0;
    for (const row of rows) {
      const item = buildCatalogItem(row, leaf, gallery, client.origin);
      if (item) {
        items.push(item);
        added += 1;
      }
    }
    perCategory.push({ path: leaf.path.join('/'), c3, siteCount, crawled: rows.length, added, failed });
    log(`[catalog] ${leaf.path.join(' / ')}：站点 ${siteCount} / 实抓 ${rows.length}，累计 ${items.length}`);
  }

  // 同一 sourceKey 只保留首条
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    if (seen.has(item.sourceKey)) continue;
    seen.add(item.sourceKey);
    unique.push(item);
  }

  const durationSec = Math.round((Date.now() - startedAt) / 1000);
  writeAtomic(path.join(cfg.stateDir, 'catalog.json'), {
    generatedAt: new Date().toISOString(),
    perCategory,
    items: unique,
  });
  log(`[catalog] 完成：${unique.length} 条，耗时 ${durationSec}s，图片 ${Object.values(galleryCache).reduce((n, l) => n + l.length, 0)} 张`);

  return { items: unique, perCategory, filters, errors, listFailed, scanned, durationSec };
}

/**
 * 阶段二：详情（断点续跑：details.json 里已有的货号跳过）。
 * @param {Set<string>} only  只抓这些货号（inspect 用），空表示全部
 */
export async function collectDetails(client, cfg, items, log, only) {
  const startedAt = Date.now();
  const file = path.join(cfg.stateDir, 'details.json');
  const store = readJson(file, { items: {}, errors: [] });
  store.items = store.items || {};
  store.errors = Array.isArray(store.errors) ? store.errors : [];

  const targets = items
    .map((i) => i.itemNo)
    .filter(Boolean)
    .filter((no) => !only || only.has(no));
  const pending = targets.filter((no) => !store.items[no]);
  log(`[detail] 待抓 ${pending.length}，已有 ${targets.length - pending.length}`);

  let tried = 0;
  let failed = 0;
  let sinceHandshake = 0;

  await mapPool(pending, cfg.concurrency, async (no) => {
    const r = await fetchItem(client, no, cfg.delayMs);
    tried += 1;
    sinceHandshake += 1;
    if (r.ok) store.items[no] = r.item;
    else {
      failed += 1;
      store.errors.push({ no, error: r.error, at: new Date().toISOString() });
      if (store.errors.length > 20000) store.errors.splice(0, 5000);
    }
    if (tried % DETAIL_PERSIST_EVERY === 0) {
      writeAtomic(file, store);
      const rate = tried / Math.max(1, (Date.now() - startedAt) / 1000);
      log(`[detail] 进度 ${tried}/${pending.length} 失败 ${failed} 速率 ${rate.toFixed(2)}/s`);
    }
    if (sinceHandshake >= HANDSHAKE_EVERY) {
      sinceHandshake = 0;
      try {
        await client.handshake();
      } catch {
        /* 下一轮请求会再试 */
      }
    }
  });

  writeAtomic(file, store);
  const stats = {
    targets: targets.length,
    fetched: targets.filter((no) => store.items[no]).length,
    errors: store.errors.length,
    durationSec: Math.round((Date.now() - startedAt) / 1000),
  };
  log(`[detail] 完成：${stats.fetched}/${targets.length}，失败 ${stats.errors}`);
  return { store, stats };
}

/** 规格筛选项落盘路径（inspect/审计复用） */
export function filtersPath(cfg) {
  return path.join(cfg.stateDir, 'filters.json');
}

export function ensureDirs(cfg) {
  for (const dir of [cfg.stateDir, cfg.reportDir, cfg.imageDir]) fs.mkdirSync(dir, { recursive: true });
}
