#!/usr/bin/env node
/**
 * 系列真图填充：把 catalog.json 里 staged 空/缺的图片引用（源站已删图、无本地文件），
 * 用「同品牌同品类系列」的真实高清图填充，使详情页/列表页不再空白/占位。
 *
 * 背景：源站 eg.egluosi.com 删除了 110 个 c3 类目的全部图片（img1_l/spec/imgN_s 全 404），
 * 详情页 API 也 404，无法找回原图；但项目已有 1243 张真实商品图，且同一系列
 * （categoryPath 前两级，如「成品刀刃具类/UTOOL铣刀类」）的商品外观高度相似。
 * 本脚本从「有真图的兄弟商品」构建系列图源池，按 role 匹配填充空位。
 *
 * 与 reimage-offline.mjs 的区别：
 *   - reimage 只处理「有本地 80×80 图」的 _s，升级为 _l（已在上轮完成）；
 *   - 本脚本处理「staged 空/缺」的引用（连封面都没图），用系列真图填充。
 *
 *   node scripts/catalog/fill-series-images.mjs --dry-run   # 只统计不写
 *   node scripts/catalog/fill-series-images.mjs             # 执行填充
 *
 * 安全约定：
 *   - 只填 staged 空/缺的引用；已有真图的引用字节不动；
 *   - 不删除任何图片引用（remote/staged/role 结构保持，只补 staged + remote）；
 *   - remote 改写为图源的真实 URL，staged 指向图源的真实文件；
 *   - 原文件备份为 *.pre-fillseries.bak；可重复执行（已填的不再动）；
 *   - cover 位只用系列里 role=cover 的真图；gallery 位用系列任意真图。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const TARGETS = [
  { catalog: path.join(REPO_ROOT, 'tools/egluosi-importer/source/catalog.json'),
    images: path.join(REPO_ROOT, 'tools/egluosi-importer/source/images') },
  { catalog: path.join(REPO_ROOT, 'release/prod-catalog/catalog.json'),
    images: path.join(REPO_ROOT, 'tools/egluosi-importer/source/images') },
  { catalog: path.join(REPO_ROOT, '2026-11-14/catalog-import/outputs/catalog.json'),
    images: path.join(REPO_ROOT, '2026-11-14/catalog-import/outputs/images') },
];

function keysOf(p) {
  const cp = p.categoryPath || [];
  return { L3: cp.join('/'), L2: cp.slice(0, 2).join('/'), L1: cp.slice(0, 1).join('/'), leaf: cp[cp.length - 1] || '' };
}
function fileOf(st) { return String(st || '').split('/').pop() || ''; }

// 品类关键词桶：避免「用铣刀图填钻头」这类跨品类错配。
// 顺序敏感：先判更具体的词。车刀/刀板归到铣刀桶（同为旋转切削刀具，近似填充）。
const KW_RULES = [
  ['丝锥', ['丝锥', '牙板', '板牙', '攻牙']],
  ['铰刀', ['铰刀']],
  ['铣刀', ['铣刀', '车刀', '刀板', '波刃']],
  ['钻头', ['钻']],
];
function kwOf(leaf) {
  for (const [k, words] of KW_RULES) if (words.some((w) => leaf.includes(w))) return k;
  return null;
}

async function main() {
  const src = JSON.parse(fs.readFileSync(TARGETS[0].catalog, 'utf8'));
  const imageDir = TARGETS[0].images;
  const exists = (st) => { const f = fileOf(st); return !!f && fs.existsSync(path.join(imageDir, f)); };

  // 1) 构建分级图源池：只收真实可用图（有 staged 且文件存在）
  //    每个池条目 {remote, staged, role}，cover/gallery 分开放
  const mkPool = () => ({ cover: [], gallery: [], all: [], kw: new Map() });
  const pools = { L3: new Map(), L2: new Map(), L1: new Map() };
  let poolTotal = 0;
  const addEntry = (pool, entry) => {
    if (!pool.all.find((x) => x.staged === entry.staged)) {
      pool.all.push(entry);
      if (entry.role === 'cover') pool.cover.push(entry); else pool.gallery.push(entry);
      const kw = kwOf(entry.leaf || '');
      if (kw) {
        let bucket = pool.kw.get(kw);
        if (!bucket) { bucket = { cover: [], all: [] }; pool.kw.set(kw, bucket); }
        bucket.all.push(entry);
        if (entry.role === 'cover') bucket.cover.push(entry);
      }
    }
  };
  for (const p of src.products) {
    const k = keysOf(p);
    for (const im of (p.images || [])) {
      if (!exists(im.staged)) continue;
      const entry = { remote: String(im.remote || ''), staged: im.staged, role: im.role || 'gallery', leaf: k.leaf };
      for (const lv of ['L3', 'L2', 'L1']) {
        const key = k[lv]; if (!key) continue;
        let pool = pools[lv].get(key);
        if (!pool) { pool = mkPool(); pools[lv].set(key, pool); }
        addEntry(pool, entry);
      }
      poolTotal += 1;
    }
  }
  console.log(`[fill-series] 图源池：L3=${pools.L3.size}组 L2=${pools.L2.size}组 L1=${pools.L1.size}组，真实图引用=${poolTotal}`);

  // 2) 遍历商品，对每个空引用按 role 从分级池取图填充（L3→L2→L1）
  //    每个商品维护取图游标，轮转避免整页同一张图
  let filled = 0, unfilled = 0, coverFilled = 0, galleryFilled = 0;
  const levelUse = { sameProduct: 0, L3: 0, L2: 0, L1: 0 };
  const byProduct = [];

  for (const p of src.products) {
    const k = keysOf(p);
    const imgs = p.images || [];
    // 商品自身的真图（B 类自愈优先用自身封面/规格图）
    const ownCover = imgs.filter((im) => exists(im.staged) && im.role === 'cover');
    const ownAny = imgs.filter((im) => exists(im.staged));
    const poolL3 = pools.L3.get(k.L3), poolL2 = pools.L2.get(k.L2), poolL1 = pools.L1.get(k.L1);

    const myKw = kwOf(k.leaf);
    const pick = (role, cursor) => {
      // 候选序列：商品自身同级真图 → L3 → L2 → L1(按品类关键词过滤，避免跨品类错配)
      const candidates = [];
      if (role === 'cover' && ownCover.length) candidates.push({ list: ownCover, lv: 'sameProduct' });
      if (ownAny.length) candidates.push({ list: ownAny, lv: 'sameProduct' });
      if (poolL3) candidates.push({ list: role === 'cover' && poolL3.cover.length ? poolL3.cover : poolL3.all, lv: 'L3' });
      if (poolL2) candidates.push({ list: role === 'cover' && poolL2.cover.length ? poolL2.cover : poolL2.all, lv: 'L2' });
      if (poolL1) {
        const bucket = poolL1.kw.get(myKw);
        const l1list = bucket ? (role === 'cover' && bucket.cover.length ? bucket.cover : bucket.all) : null;
        if (l1list && l1list.length) candidates.push({ list: l1list, lv: 'L1' });
      }
      for (const c of candidates) {
        if (!c.list.length) continue;
        const srcIm = c.list[cursor % c.list.length];
        return { srcIm, lv: c.lv };
      }
      return null;
    };

    let cursor = crypto.createHash('md5').update(String(p.sourceId || p.name || '')).digest().readInt32BE(0) >>> 0 % 97;
    let productFilled = 0;
    for (const im of imgs) {
      if (exists(im.staged)) continue; // 已有真图，不动
      const role = im.role === 'cover' ? 'cover' : 'gallery';
      const got = pick(role, cursor);
      if (!got) { unfilled += 1; continue; }
      im.remote = got.srcIm.remote;
      im.staged = got.srcIm.staged;
      cursor += 1;
      filled += 1; productFilled += 1;
      levelUse[got.lv] += 1;
      if (role === 'cover') coverFilled += 1; else galleryFilled += 1;
    }
    if (productFilled) byProduct.push({ id: p.sourceId, name: p.name, filled: productFilled });
  }
  console.log(`[fill-series] 填充 ${filled} 处（cover=${coverFilled} gallery=${galleryFilled}），未填充 ${unfilled} 处`);
  console.log(`[fill-series] 图源层级：商品自身=${levelUse.sameProduct} L3=${levelUse.L3} L2=${levelUse.L2} L1=${levelUse.L1}`);
  console.log(`[fill-series] 涉及商品 ${byProduct.length} 个`);
  if (filled === 0) { console.error('[fill-series] 无可填充项，终止'); process.exit(1); }

  if (dryRun) { console.log('[fill-series] dry-run 结束，未写入'); return; }

  // 3) 用同样的映射逻辑改写三份 catalog（基于 remote+staged 配对，保证幂等一致）
  //    直接在各份上重跑填充算法（结构相同），确保三份一致
  for (const t of TARGETS) {
    const raw = fs.readFileSync(t.catalog, 'utf8');
    const data = JSON.parse(raw);
    const ex = (st) => { const f = fileOf(st); return !!f && fs.existsSync(path.join(t.images, f)); };
    // 该份的图源池
    const P = { L3: new Map(), L2: new Map(), L1: new Map() };
    const addP = (pool, entry) => {
      if (pool.all.find((x) => x.staged === entry.staged)) return;
      pool.all.push(entry);
      (entry.role === 'cover' ? pool.cover : pool.gallery).push(entry);
      const kw = kwOf(entry.leaf || '');
      if (kw) {
        let bucket = pool.kw.get(kw);
        if (!bucket) { bucket = { cover: [], all: [] }; pool.kw.set(kw, bucket); }
        bucket.all.push(entry);
        if (entry.role === 'cover') bucket.cover.push(entry);
      }
    };
    for (const p of data.products) {
      const kk = keysOf(p);
      for (const im of (p.images || [])) {
        if (!ex(im.staged)) continue;
        const entry = { remote: String(im.remote || ''), staged: im.staged, role: im.role || 'gallery', leaf: kk.leaf };
        for (const lv of ['L3', 'L2', 'L1']) {
          const key = kk[lv]; if (!key) continue;
          let pool = P[lv].get(key);
          if (!pool) { pool = { cover: [], gallery: [], all: [], kw: new Map() }; P[lv].set(key, pool); }
          addP(pool, entry);
        }
      }
    }
    let changed = 0;
    for (const p of data.products) {
      const kk = keysOf(p);
      const imgs = p.images || [];
      const ownCover = imgs.filter((im) => ex(im.staged) && im.role === 'cover');
      const ownAny = imgs.filter((im) => ex(im.staged));
      const pL3 = P.L3.get(kk.L3), pL2 = P.L2.get(kk.L2), pL1 = P.L1.get(kk.L1);
      const myKw = kwOf(kk.leaf);
      const get = (role, cursor) => {
        const cands = [];
        if (role === 'cover' && ownCover.length) cands.push(ownCover);
        if (ownAny.length) cands.push(ownAny);
        if (pL3) cands.push(role === 'cover' && pL3.cover.length ? pL3.cover : pL3.all);
        if (pL2) cands.push(role === 'cover' && pL2.cover.length ? pL2.cover : pL2.all);
        if (pL1) {
          const bucket = pL1.kw.get(myKw);
          const l1list = bucket ? (role === 'cover' && bucket.cover.length ? bucket.cover : bucket.all) : null;
          if (l1list && l1list.length) cands.push(l1list);
        }
        for (const list of cands) if (list.length) return list[cursor % list.length];
        return null;
      };
      let cursor = crypto.createHash('md5').update(String(p.sourceId || p.name || '')).digest().readInt32BE(0) >>> 0 % 97;
      for (const im of imgs) {
        if (ex(im.staged)) continue;
        const role = im.role === 'cover' ? 'cover' : 'gallery';
        const s = get(role, cursor);
        if (!s) continue;
        im.remote = s.remote; im.staged = s.staged; cursor += 1; changed += 1;
      }
    }
    const bak = `${t.catalog}.pre-fillseries.bak`;
    if (!fs.existsSync(bak)) fs.copyFileSync(t.catalog, bak);
    fs.writeFileSync(t.catalog, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    console.log(`[fill-series] ${path.relative(REPO_ROOT, t.catalog)}: 填充 ${changed} 处，备份 ${path.basename(bak)}`);
  }
  console.log('[fill-series] 完成。');
}

main().catch((e) => { console.error('[fill-series] 异常:', e && e.stack ? e.stack : e); process.exit(1); });
