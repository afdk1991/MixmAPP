#!/usr/bin/env node
/**
 * catalog 采集器入口。
 *
 *   pnpm catalog:sync     [--dry-run] [--resume] [--limit n] ...
 *   pnpm catalog:inspect  --item-no <货号>
 *   pnpm catalog:inspect  --brand EGM --spec M6-1.0x8 [--dims 6 --lens 8]
 *
 * sync  = 抓目录/筛选/详情 → 按 source_key 幂等入库（下架只标不可售）
 * inspect = 只读对账：抓源站 + 读库对比，绝不写库
 */
import fs from 'node:fs';
import path from 'node:path';

import { loadConfig, usage } from './config.mjs';
import { createClient } from './site.mjs';
import { collectCatalog, collectDetails, ensureDirs, fetchItem, fetchTree, flattenLeaves, fetchCategoryRows } from './collect.mjs';
import {
  buildCatalogItem,
  buildDetail,
  diffProduct,
  mappingTable,
  normalizeBrand,
} from './mapping.mjs';
import { applyChanges, markRunFinished, markRunStarted, readProductByKey } from './store.mjs';
import { acquireLock, createBudget, createLogger, newRunId, pruneRunLogs, readJson, rotateLog, writeAtomic } from './util.mjs';
import { runSite as runHznzcnSync } from './sites/hznzcn.mjs';

const cfg = loadConfig(process.argv);

if (cfg.help) {
  console.log(usage());
  process.exit(0);
}

ensureDirs(cfg);
rotateLog(cfg.logFile, cfg.logMaxBytes);

const stateFile = path.join(cfg.stateDir, 'state.json');

// ------------------------------------------------------------------ sync
/** 断点续跑有效期：定时任务逐日累积，隔几天没跑也应能接着续，不能一超时就清零重抓 */
const RESUME_WINDOW_MS = 14 * 24 * 3600 * 1000;

async function runSync() {
  const release = acquireLock(cfg.stateDir);
  const budget = createBudget(cfg.maxRuntimeMin);
  let state = cfg.resume ? readJson(stateFile, null) : null;
  const resumable =
    state && state.phase !== 'done' && Date.now() - Date.parse(state.startedAt) < RESUME_WINDOW_MS;

  if (!resumable) {
    for (const f of ['state.json', 'catalog.json', 'gallery.json', 'details.json']) {
      const p = path.join(cfg.stateDir, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    state = { runId: newRunId(), startedAt: new Date().toISOString(), phase: 'catalog', catalogDone: false, detailDone: false };
    writeAtomic(stateFile, state);
  }

  const logger = createLogger(cfg.reportDir, state.runId);
  const log = logger.log;
  pruneRunLogs(cfg.reportDir);
  log(`===== catalog sync ${cfg.dryRun ? '(dry-run)' : ''} run=${state.runId} =====`);
  if (resumable) log(`[sync] 断点续跑 ${state.runId}（phase=${state.phase}）`);
  if (budget.limited) log(`[sync] 单轮时长预算 ${budget.minutes} 分钟`);

  const client = createClient(cfg, log);
  let exitCode = 0;
  try {
    if (!cfg.dryRun && !cfg.filtersOnly) await markRunStarted(state.runId, state.startedAt);

    const t0 = Date.now();

    if (!state.catalogDone) {
      const catalog = await collectCatalog(client, cfg, log, budget);
      state.catalogStats = {
        leaves: catalog.perCategory.length,
        siteCount: catalog.scanned,
        items: catalog.items.length,
        listFailed: catalog.listFailed,
        filters: Object.keys(catalog.filters || {}).length,
        durationSec: catalog.durationSec || 0,
      };
      state.catalogErrors = catalog.errors;
      if (catalog.stopped) {
        // 目录阶段被预算截断：保持 catalogDone=false，快照 partial=true，下一轮从未抓类目继续
        state.phase = 'catalog';
        writeAtomic(stateFile, state);
        const paused = { runId: state.runId, paused: true, reason: 'catalog-budget', ...state.catalogStats };
        if (!cfg.dryRun) {
          try {
            await markRunFinished(state.runId, 'paused', paused, null, `目录阶段达到单轮时长预算 ${budget.minutes} 分钟，下一轮续抓`);
          } catch {
            /* 记账失败不影响收尾 */
          }
        }
        log('[sync] 目录阶段达预算收尾，下一轮 --resume 从未抓类目继续');
        console.log(JSON.stringify(paused, null, 2));
        return 0;
      }
      state.catalogDone = true;
      // 局部抓取（--limit）只覆盖前 n 个类目，未抓到的商品不代表源站消失，禁止下架判定
      // --no-delist 为「已有商品不下架」总开关：定时任务默认带上，避免误判
      state.delistSafe = !cfg.noDelist && catalog.listFailed === 0 && cfg.limit === 0;
      if (cfg.limit > 0) log('[catalog] --limit 局部抓取：本次跳过下架判定');
      if (cfg.noDelist) log('[catalog] --no-delist：本次不做下架判定，已有商品全部保留在售');
      writeAtomic(stateFile, state);
    }
    if (cfg.filtersOnly) {
      log('[sync] --filters-only：仅抓取目录树与筛选项，结束');
      state.phase = 'done';
      writeAtomic(stateFile, state);
      logger.close();
      return 0;
    }

    const items = readJson(path.join(cfg.stateDir, 'catalog.json'), { items: [] }).items || [];
    state.phase = 'detail';
    writeAtomic(stateFile, state);

    let details;
    if (!state.detailDone) {
      const result = await collectDetails(client, cfg, items, log, undefined, budget);
      details = result.store;
      state.detailStats = result.stats;
      if (result.stopped) {
        // 详情阶段被预算截断：保持 detailDone=false，details.json 已逐批落盘，下一轮续抓
        state.phase = 'detail';
        writeAtomic(stateFile, state);
        const paused = { runId: state.runId, paused: true, reason: 'detail-budget', ...state.detailStats };
        if (!cfg.dryRun) {
          try {
            await markRunFinished(state.runId, 'paused', paused, null, `详情阶段达到单轮时长预算 ${budget.minutes} 分钟，下一轮续抓`);
          } catch {
            /* 记账失败不影响收尾 */
          }
        }
        log('[sync] 详情阶段达预算收尾，下一轮 --resume 从已有货号之后继续');
        console.log(JSON.stringify(paused, null, 2));
        return 0;
      }
      state.detailDone = true;
      writeAtomic(stateFile, state);
    } else {
      details = readJson(path.join(cfg.stateDir, 'details.json'), { items: {}, errors: [] });
    }

    state.phase = 'apply';
    writeAtomic(stateFile, state);
    const gallery = readJson(path.join(cfg.stateDir, 'gallery.json'), {});
    const { stats, changeLog, durationSec } = await applyChanges({ cfg, state, items, details, gallery });
    state.applyStats = { ...stats, durationSec, delistSafe: state.delistSafe };
    state.changeSamples = changeLog.slice(0, 50);

    const summary = `新增 ${stats.added} / 下架 ${stats.delisted} / 下架在售 ${stats.offSale} / 改价 ${stats.priceChanged} / 其他 ${stats.otherChanged} / 未变 ${stats.unchanged}`;
    const report = {
      runId: state.runId,
      startedAt: state.startedAt,
      finishedAt: new Date().toISOString(),
      durationSec: Math.round((Date.now() - t0) / 1000),
      dryRun: cfg.dryRun,
      summary,
      stats,
      catalog: state.catalogStats || null,
      detail: state.detailStats || null,
      delistSafe: state.delistSafe !== false,
      catalogErrors: state.catalogErrors || [],
      detailErrors: (details.errors || []).length,
      changeSamples: state.changeSamples,
    };
    const reportPath = path.join(cfg.reportDir, `${state.runId}.json`);
    writeAtomic(reportPath, report);

    if (!cfg.dryRun) {
      const status = report.detailErrors > 0 ? 'partial' : 'success';
      await markRunFinished(state.runId, status, { ...report, changeSamples: undefined }, reportPath, null);
    }

    state.phase = 'done';
    writeAtomic(stateFile, state);
    log(`[sync] ${summary}${cfg.dryRun ? '（dry-run 未落库）' : ''}`);
    log(`[sync] 耗时 ${report.durationSec}s，报告 ${reportPath}`);
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    exitCode = 1;
    const message = e instanceof Error ? (e.stack || e.message) : String(e);
    log(`[sync] 失败：${message}`);
    if (!cfg.dryRun) {
      try {
        await markRunFinished(state.runId, 'failed', {}, null, e instanceof Error ? e.message : String(e));
      } catch {
        /* 记账失败不覆盖原始错误 */
      }
    }
  } finally {
    logger.close();
    release();
  }
  return exitCode;
}

// --------------------------------------------------------------- inspect
const pad = (s, width) => {
  const str = String(s ?? '');
  let w = 0;
  for (const ch of str) w += /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1;
  return str + ' '.repeat(Math.max(0, width - w));
};

function printRows(title, rows) {
  console.log(`\n${title}`);
  const w1 = 22;
  const w2 = 34;
  for (const [a, b, c] of rows) {
    console.log(`  ${pad(a, w1)}${pad(b, w2)}${c || ''}`);
  }
}

function specMatches(sourceSpec, target) {
  const norm = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
  const a = norm(sourceSpec);
  const b = norm(target);
  if (!a || !b) return false;
  if (a === b) return { matched: true, exact: true };
  const nums = (s) => (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  const na = nums(a);
  const nb = nums(b);
  if (na.length >= 2 && nb.length >= 2 && na[0] === nb[0] && na[1] === nb[1]) return { matched: true, exact: false };
  return { matched: false, exact: false };
}

function mappedRows(record) {
  return [
    ['price_li（厘/支）', record.priceLi, 'basePrcD3N2'],
    ['price_fen（分/支）', record.priceFen, 'basePrcD3N2/10'],
    ['discount_pct', record.discountPct, 'disD2N2'],
    ['sale_price_li', record.salePriceLi, 'disD2N2 × basePrcD3N2'],
    ['source_inv_status', record.sourceInvStatus, 'invStatusDesc'],
    ['source_on_sale', record.sourceOnSale, 'onSale'],
    ['packaging_desc', record.packagingDesc, 'convsDesc'],
    ['unit', record.unit, '固定「支」'],
    ['unit_options', JSON.stringify(record.unitOptions), 'units'],
    ['unit_conversions', JSON.stringify(record.unitConversions), 'convs'],
    ['specs', JSON.stringify(record.specs), 'ATTRIBUTE_MAP 7 键'],
    ['attributes', JSON.stringify(record.attributes), 'ATTRIBUTE_MAP'],
    ['promotions', JSON.stringify(record.promotions), 'activitys/manjianTipTexts/tipText'],
    ['spec_image', record.specImage || '(无)', '画廊 spec 变体'],
    ['max_order_qty', record.maxOrderQty, 'MAX_ORDER_QTY'],
  ];
}

async function findTargets(client, log) {
  if (cfg.itemNo) return [{ itemNo: cfg.itemNo, row: null, leaf: null }];

  const leaves = flattenLeaves(await fetchTree(client));
  const brandCode = { EGM: 'egm-screw', EG: 'eg-screw' }[cfg.brand.toUpperCase()];
  const scope = brandCode ? leaves.filter((l) => l.code === brandCode) : leaves;
  log(`[inspect] 扫描 ${scope.length} 个三级类目，找 品牌=${cfg.brand || '*'} 规格=${cfg.spec || '*'}`);

  const found = [];
  for (const leaf of scope) {
    let rows;
    try {
      ({ rows } = await fetchCategoryRows(client, leaf.leafValue, { dims: cfg.dims, lens: cfg.lens }));
    } catch (e) {
      log(`[inspect] c3=${leaf.leafValue} 列表失败：${e instanceof Error ? e.message : e}`);
      continue;
    }
    for (const row of rows) {
      const brand = normalizeBrand(row.brand, row.name);
      if (cfg.brand && brand.toUpperCase() !== cfg.brand.toUpperCase()) continue;
      if (cfg.spec && !specMatches(row.spec, cfg.spec).matched) continue;
      found.push({ itemNo: String(row.no), row, leaf });
      if (found.length >= Math.max(1, cfg.limit || 5)) return found;
    }
  }
  return found;
}

async function runInspect() {
  const runId = `inspect-${newRunId()}`;
  const logger = createLogger(cfg.reportDir, runId);
  const log = logger.log;
  const client = createClient(cfg, log);
  let exitCode = 0;
  try {
    await client.handshake();
    const targets = await findTargets(client, log);
    if (targets.length === 0) {
      log('[inspect] 源站未找到匹配商品');
      logger.close();
      return 2;
    }

    const gallery = readJson(path.join(cfg.stateDir, 'gallery.json'), {});
    const results = [];
    for (const target of targets) {
      const fetched = await fetchItem(client, target.itemNo, cfg.delayMs);
      if (!fetched.ok) {
        log(`[inspect] ${target.itemNo} 详情失败：${fetched.error}`);
        continue;
      }
      const specImage = (gallery[String(target.leaf?.leafValue || fetched.item.c3)] || []).find((e) => e.role === 'spec');
      const record = buildDetail(fetched.item, specImage ? specImage.url : null);
      const item = target.row && target.leaf
        ? buildCatalogItem(target.row, target.leaf, [], client.origin)
        : null;
      const sourceKey = item ? item.sourceKey : fetched.item.code ? `sku:${fetched.item.code}` : `url:${client.origin}/b2b/mall/item?itemNo=${target.itemNo}`;

      printRows(`\n=== ${target.itemNo} ${fetched.item.name || ''} ===`, [
        ['source_key', sourceKey, 'code → sku:<code>'],
        ['category', target.leaf ? `${target.leaf.code} / ${target.leaf.path.join(' / ')}` : '(未知)'],
        ['brand（归一化）', normalizeBrand(fetched.item.brand, fetched.item.name), `源站 brand=${fetched.item.brand || '空'}`],
        ['spec', fetched.item.spec || '', '源站 spec'],
      ]);
      printRows('字段映射（源站 → 库）', mappedRows(record));

      const result = {
        itemNo: target.itemNo,
        sourceKey,
        brand: normalizeBrand(fetched.item.brand, fetched.item.name),
        spec: fetched.item.spec,
        raw: {
          basePrcD3N2: fetched.item.basePrcD3N2,
          disD2N2: fetched.item.disD2N2,
          invStatusDesc: fetched.item.invStatusDesc,
          onSale: fetched.item.onSale,
          convsDesc: fetched.item.convsDesc,
          convs: fetched.item.convs,
        },
        mapped: record,
        db: null,
        diff: null,
      };

      if (!cfg.raw.includes('--no-db')) {
        try {
          const dbRow = await readProductByKey(sourceKey);
          if (dbRow) {
            const next = {
              ...record,
              title: item ? item.name : dbRow.title,
              subtitle: item ? item.subtitle : dbRow.subtitle,
              brand: item ? item.brand : dbRow.brand,
              categoryPath: item ? item.categoryPath : (dbRow.category_path || '').split('/'),
              packQty: item ? item.packQty : dbRow.pack_qty,
              images: item ? item.images : dbRow.images || [],
              cover: item ? item.cover : dbRow.cover,
            };
            const diff = diffProduct(dbRow, next).filter((c) => !c.silent);
            result.db = {
              title: dbRow.title,
              price_li: dbRow.price_li,
              discount_pct: dbRow.discount_pct,
              sale_price_li: dbRow.sale_price_li,
              listed: dbRow.listed,
              source_inv_status: dbRow.source_inv_status,
              source_on_sale: dbRow.source_on_sale,
              category_path: dbRow.category_path,
            };
            result.diff = diff;
            printRows('库内现值（只读）', [
              ['title', dbRow.title],
              ['price_li', dbRow.price_li],
              ['discount_pct', dbRow.discount_pct],
              ['sale_price_li', dbRow.sale_price_li],
              ['listed', dbRow.listed],
              ['source_inv_status', dbRow.source_inv_status],
              ['source_on_sale', dbRow.source_on_sale],
              ['category_path', dbRow.category_path],
            ]);
            printRows(
              diff.length ? `若入库将变更 ${diff.length} 个字段` : '与库内一致（0 变更）',
              diff.map((c) => [c.field, JSON.stringify(c.old), `→ ${JSON.stringify(c.new)}`])
            );
          } else {
            printRows('库内现值（只读）', [['source_key', sourceKey, '库内不存在（将新增）']]);
          }
        } catch (e) {
          log(`[inspect] 读库失败（跳过对比）：${e instanceof Error ? e.message : e}`);
        }
      }

      results.push(result);
    }

    if (cfg.raw.includes('--show-mapping')) {
      printRows('\n字段映射表（mapping.mjs）', mappingTable().map((r) => [r.源站字段, r.库字段, `${r.类型} ${r.口径}`]));
    }

    const out = path.join(cfg.reportDir, `${runId}.json`);
    writeAtomic(out, { runId, at: new Date().toISOString(), filters: { dims: cfg.dims, lens: cfg.lens }, results });
    log(`[inspect] 完成 ${results.length} 件，结果 ${out}`);
  } catch (e) {
    exitCode = 1;
    log(`[inspect] 失败：${e instanceof Error ? (e.stack || e.message) : e}`);
  } finally {
    logger.close();
  }
  return exitCode;
}

// ------------------------------------------------------------------ main
const command = cfg.command;

// 站点适配层：egluosi 走既有 sync；hznzcn 走自己的采集/映射，共用 ingest 入库。
// hznzcn 只做「手动按需同步」——生产机 IP 被源站 WAF 封，定时必然失败，因此不进 crontab。
const runSyncForSite = cfg.site === 'hznzcn' ? () => runHznzcnSync(cfg) : runSync;
const runner = command === 'inspect' ? runInspect : command === 'sync' ? runSyncForSite : null;

if (!runner) {
  console.error(`未知命令：${command}\n\n${usage()}`);
  process.exit(64);
}

runner()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[catalog] 未捕获异常：', e && e.stack ? e.stack : e);
    process.exit(1);
  });
