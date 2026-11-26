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

/**
 * 旧版本画廊缓存的第 2-4 张是 80×80 的 `_s`、后来是压缩过的 `_l`，复用会让详情页继续模糊；
 * 现在一律取无后缀原图（1000×1000 原图质量）。判定规则：
 *   - 旧缓存没有 `variant` 字段 → 需要重采一次完成升级；
 *   - 命中 `_m` / `_s` → 明显小图，重采；
 *   - 只有 `_l`（原图 404 时的降级）带 variant='l' → 视为最终可用档，不再反复重采。
 */
function isStaleGallery(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return true;
  return entries.some((e) => !e?.variant || e.variant === 'm' || e.variant === 's');
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
 *
 * 断点续跑：每抓完一个三级类目就写一次快照（partial=true），下一轮 --resume
 * 直接跳过已完成的类目；这样即使单轮被时长预算截断，也不会从零重抓。
 *
 * @returns {{items: Array, perCategory: Array, filters: Object, errors: Array,
 *            listFailed: number, scanned: number, stopped?: boolean}}
 */
export async function collectCatalog(client, cfg, log, budget) {
  const startedAt = Date.now();
  const galleryCache = readJson(path.join(cfg.stateDir, 'gallery.json'), {});
  const filtersFile = path.join(cfg.stateDir, 'filters.json');
  const filters = cfg.withFilters ? readJson(filtersFile, {}) : {};
  const catalogFile = path.join(cfg.stateDir, 'catalog.json');

  await client.handshake();
  const leaves = flattenLeaves(await fetchTree(client));
  const targets = cfg.limit > 0 ? leaves.slice(0, cfg.limit) : leaves;
  log(`[catalog] 三级类目 ${targets.length} 个`);

  // 断点快照：只有「本轮未完成」的快照才复用，完整快照会在 cli 阶段被 catalogDone 拦下
  const prior = cfg.resume ? readJson(catalogFile, null) : null;
  const priorPartial = prior && prior.partial === true ? prior : null;
  const doneLeaves = new Set((priorPartial?.perCategory || []).filter((c) => !c.failed).map((c) => String(c.c3)));
  const itemsByC3 = {};
  for (const [c3, arr] of Object.entries(priorPartial?.itemsByC3 || {})) itemsByC3[c3] = Array.isArray(arr) ? arr : [];
  const items = Object.values(itemsByC3).flat();
  const perCategory = [...(priorPartial?.perCategory || [])];
  let scanned = perCategory.reduce((n, c) => n + (Number(c.siteCount) || 0), 0);
  let listFailed = perCategory.filter((c) => c.failed).length;
  if (priorPartial) log(`[catalog] 断点续跑：已完成 ${doneLeaves.size} 个类目 / 快照内商品 ${items.length} 件`);

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
    return { items: [], perCategory: [], filters, errors: [], listFailed: 0, scanned: 0 };
  }

  const errors = [...(priorPartial?.errors || [])];
  let stopped = false;

  for (const leaf of targets) {
    const c3 = String(leaf.leafValue);
    // 时长预算：本轮到点就收尾，未抓的类目留给下一轮（快照已落盘）
    if (budget?.exceeded()) {
      stopped = true;
      log(`[catalog] 达到单轮时长预算（${budget.minutes} 分钟），本轮收尾，剩余类目下一轮续抓`);
      break;
    }
    if (doneLeaves.has(c3)) {
      log(`[catalog] 断点复用 ${leaf.path.join(' / ')}（已抓 ${(itemsByC3[c3] || []).length} 件）`);
      continue;
    }

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

    const c3Items = [];
    for (const row of rows) {
      const item = buildCatalogItem(row, leaf, gallery, client.origin);
      if (item) c3Items.push(item);
    }
    itemsByC3[c3] = c3Items;
    items.push(...c3Items);
    const entry = { path: leaf.path.join('/'), c3, siteCount, crawled: rows.length, added: c3Items.length, failed };
    const idx = perCategory.findIndex((c) => String(c.c3) === c3);
    if (idx >= 0) perCategory[idx] = entry;
    else perCategory.push(entry);
    if (!failed) doneLeaves.add(c3);

    // 每个类目抓完立刻落盘，保证「可中断可恢复」
    writeAtomic(catalogFile, {
      generatedAt: new Date().toISOString(),
      partial: true,
      perCategory,
      itemsByC3,
    });
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
  // 完整快照不再保留 itemsByC3（它只用于中断后续跑，避免文件体积翻倍）
  writeAtomic(catalogFile, {
    generatedAt: new Date().toISOString(),
    partial: stopped,
    perCategory,
    ...(stopped ? { itemsByC3 } : {}),
    items: unique,
  });
  log(`[catalog] ${stopped ? '本轮未完成' : '完成'}：${unique.length} 条，耗时 ${durationSec}s，图片 ${Object.values(galleryCache).reduce((n, l) => n + l.length, 0)} 张`);

  return { items: unique, perCategory, filters, errors, listFailed, scanned, durationSec, stopped };
}

/**
 * 阶段二：详情（断点续跑：details.json 里已有的货号跳过）。
 * @param {Set<string>} only  只抓这些货号（inspect 用），空表示全部
 * @param {{exceeded: () => boolean, minutes: number}} [budget] 单轮时长预算
 */
export async function collectDetails(client, cfg, items, log, only, budget) {
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
  let stopped = false;

  await mapPool(pending, cfg.concurrency, async (no) => {
    // 时长预算：到点后不再发起新请求，已抓到的全部落盘，下一轮续跑
    if (budget?.exceeded()) {
      stopped = true;
      return;
    }
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
  log(`[detail] ${stopped ? '本轮达预算收尾' : '完成'}：${stats.fetched}/${targets.length}，失败 ${stats.errors}`);
  return { store, stats, stopped };
}

/** 规格筛选项落盘路径（inspect/审计复用） */
export function filtersPath(cfg) {
  return path.join(cfg.stateDir, 'filters.json');
}

export function ensureDirs(cfg) {
  for (const dir of [cfg.stateDir, cfg.reportDir, cfg.imageDir]) fs.mkdirSync(dir, { recursive: true });
}
