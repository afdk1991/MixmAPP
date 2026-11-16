#!/usr/bin/env node
/**
 * 只补图片：按三级类目（c3）重新拉取画廊高清图，仅更新 products 的
 * images / cover / spec_image，不动价格、标题等任何商品字段。
 *
 * 背景：旧版采集器把画廊第 2-4 张取成 80×80 的 `_s`，详情页放大后必然糊。
 * site.mjs 已改为取 1000×1000 的 `_l`，本脚本负责把存量商品的自愈补齐，
 * 避免为了几张图重跑整站 1.5 万条商品的采集与比对。
 *
 *   node scripts/catalog/reimage.mjs [--dry-run] [--c3 001,003] [--limit 20]
 *
 * 安全约定：
 *   - 某个 c3 一张图都没拉到（源站异常/网络失败）时跳过该 c3，绝不把 images 写空；
 *   - 只更新与目标值不同的行，可重复执行；
 *   - spec_image 拉不到时保留库内原值。
 */
import fs from 'node:fs';
import path from 'node:path';

import { loadConfig } from './config.mjs';
import { createClient } from './site.mjs';
import { connectionString, openPool } from './store.mjs';

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const opt = (name, fallback = '') => {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : fallback;
};

if (has('--help') || has('-h')) {
  console.log(
    [
      '图片回填（只更新 images / cover / spec_image）',
      '',
      '  node scripts/catalog/reimage.mjs [选项]',
      '',
      '  --dry-run          只统计将变更的行，不写库',
      '  --c3 001,003      只处理指定三级类目（逗号分隔）',
      '  --limit <n>       最多处理 n 个类目',
      '  --storage-dir <dir>  图片落盘根目录（同采集器，默认读 STORAGE_DIR）',
    ].join('\n')
  );
  process.exit(0);
}

const cfg = loadConfig(process.argv);
const dryRun = has('--dry-run') || cfg.dryRun;
const onlyC3 = new Set(
  opt('--c3', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
const limit = Number(opt('--limit', '0')) || 0;

if (!cfg.downloadImages) {
  console.error('图片回填必须允许下载：不要传 --no-images / CATALOG_DOWNLOAD_IMAGES=0');
  process.exit(64);
}
if (!connectionString()) {
  console.error('未找到 DATABASE_URL_LOCAL / DATABASE_URL，无法读取商品（dry-run 也需要读库）');
  process.exit(64);
}
fs.mkdirSync(cfg.imageDir, { recursive: true });

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

function snapshotDir(dir) {
  try {
    return new Set(fs.readdirSync(dir));
  } catch {
    return new Set();
  }
}

/** 画廊条目 → 库字段（与 mapping.buildCatalogItem 的口径一致） */
function desiredFields(entries) {
  const images = [];
  for (const e of entries) {
    if (e.url && !images.includes(e.url)) images.push(e.url);
  }
  const spec = entries.find((e) => e.role === 'spec' && e.url);
  return { images, cover: images[0] || null, specImage: spec ? spec.url : null };
}

async function main() {
  const pool = await openPool();
  const client = createClient(cfg, log);
  const stats = { categories: 0, skipped: 0, scanned: 0, changed: 0, unchanged: 0, newFiles: 0, newBytes: 0, failed: [] };

  try {
    const res = await pool.query(
      `select c3_id, count(*)::int as products
         from products
        where id like 'egl-%' and coalesce(c3_id, '') <> ''
        group by c3_id
        order by c3_id`
    );
    let targets = res.rows.map((r) => ({ c3: String(r.c3_id), products: r.products }));
    if (onlyC3.size > 0) targets = targets.filter((t) => onlyC3.has(t.c3));
    if (limit > 0) targets = targets.slice(0, limit);

    log(`[reimage] ${dryRun ? 'dry-run ' : ''}待处理 c3 ${targets.length} 个`);

    for (const target of targets) {
      const c3 = target.c3;
      const before = snapshotDir(cfg.imageDir);
      let entries = [];
      try {
        entries = await client.galleryForC3(c3);
      } catch (e) {
        stats.failed.push({ c3, error: e instanceof Error ? e.message : String(e) });
        stats.skipped += 1;
        log(`[reimage] c3=${c3} 画廊失败，跳过：${e instanceof Error ? e.message : e}`);
        continue;
      }
      const want = desiredFields(entries);
      if (want.images.length === 0) {
        stats.skipped += 1;
        log(`[reimage] c3=${c3} 未取到任何图片，跳过（不覆盖库内已有图片）`);
        continue;
      }

      let bytes = 0;
      let added = 0;
      for (const e of entries) {
        const file = e.url ? path.basename(e.url) : '';
        if (!file) continue;
        try {
          bytes += fs.statSync(path.join(cfg.imageDir, file)).size;
          if (!before.has(file)) added += 1;
        } catch {
          /* 文件不存在只影响统计 */
        }
      }
      stats.categories += 1;
      stats.newFiles += added;
      stats.newBytes += bytes;

      const rows = await pool.query(
        `select id, images, cover, spec_image
           from products
          where id like 'egl-%' and c3_id = $1`,
        [c3]
      );
      const stale = rows.rows.filter((r) => {
        const imagesSame = JSON.stringify(r.images || []) === JSON.stringify(want.images);
        const coverSame = (r.cover || '') === want.cover;
        const specSame = !want.specImage || (r.spec_image || '') === want.specImage;
        return !(imagesSame && coverSame && specSame);
      });
      stats.scanned += rows.rowCount;
      stats.changed += stale.length;
      stats.unchanged += rows.rowCount - stale.length;

      if (stale.length === 0) {
        log(`[reimage] c3=${c3} 已是最新（${rows.rowCount} 件，${Math.round(bytes / 1024)}KB）`);
        continue;
      }
      if (dryRun) {
        log(`[reimage] c3=${c3} 将更新 ${stale.length}/${rows.rowCount} 件（${Math.round(bytes / 1024)}KB）`);
        continue;
      }

      const updated = await pool.query(
        `update products
            set images = $1::jsonb,
                cover = coalesce($2, cover),
                spec_image = coalesce($3, spec_image)
          where id like 'egl-%'
            and c3_id = $4
            and (images is distinct from $1::jsonb
                 or ($2 is not null and cover is distinct from $2)
                 or ($3 is not null and spec_image is distinct from $3))`,
        [JSON.stringify(want.images), want.cover, want.specImage, c3]
      );
      log(`[reimage] c3=${c3} 更新 ${updated.rowCount} 件（新增图片 ${added} 个，${Math.round(bytes / 1024)}KB）`);
    }

    log(
      `[reimage] 完成：类目 ${stats.categories}，跳过 ${stats.skipped}，扫描商品 ${stats.scanned}，` +
        `变更 ${stats.changed}，未变 ${stats.unchanged}，新增图片 ${stats.newFiles} 个 ${Math.round(stats.newBytes / 1024)}KB`
    );
    if (stats.failed.length > 0) log(`[reimage] 失败类目 ${stats.failed.length} 个：${JSON.stringify(stats.failed)}`);
    console.log(JSON.stringify({ dryRun, ...stats }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('[reimage] 未捕获异常：', e && e.stack ? e.stack : e);
  process.exit(1);
});
