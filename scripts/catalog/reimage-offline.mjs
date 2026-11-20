#!/usr/bin/env node
/**
 * 离线图片回填（不依赖数据库）：把 catalog.json 里 80×80 的 `_s` 缩略图
 * 替换为源站 1000×1000 的 `_l` 高清图，只改 images[].remote / images[].staged，
 * 其余字段（cover / 标题 / 价格 / 规格 / 描述）一律字节不动。
 *
 * 背景：旧采集器 crawl.mjs 把画廊第 2-4 张取成 `_s`（80×80），详情页放大必糊；
 * 新版 site.mjs 已改取 `_l`，但存量 catalog 仍是旧号。reimage.mjs 依赖本地 PG，
 * 无库环境用本脚本直接修数据文件 + 图片落盘。
 *
 *   node scripts/catalog/reimage-offline.mjs --dry-run      # 只统计不写
 *   node scripts/catalog/reimage-offline.mjs                # 执行修复
 *   node scripts/catalog/reimage-offline.mjs --limit-c3 1   # 只处理 1 个类目（调试）
 *
 * 安全约定：
 *   - 先下载高清图落盘、校验非占位，再改 catalog；任何 URL 拉不到就跳过该类目映射；
 *   - 原文件备份为 *.pre-reimage.bak；
 *   - 只替换 remote 结尾 `_s` 的项，`_l` / `_m` / `spec` 保持原样；
 *   - 可重复执行：已是 `_l` 的项不会再动。
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const has = (n) => args.includes(n);
const opt = (n, fallback = '') => {
  const i = args.indexOf(n);
  if (i < 0) return fallback;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : fallback;
};
const dryRun = has('--dry-run');
const limitC3 = Number(opt('--limit-c3', '0')) || 0;

const HOST = 'eg.egluosi.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
const DELAY_MS = 350; // 遵守源站 >=400ms 量级的礼貌限速（这里 350ms + 处理耗时）

// catalog 数据文件 + 对应图片落盘目录（逐份修复）
const TARGETS = [
  { catalog: path.join(REPO_ROOT, 'tools/egluosi-importer/source/catalog.json'),
    images: path.join(REPO_ROOT, 'tools/egluosi-importer/source/images') },
  { catalog: path.join(REPO_ROOT, 'release/prod-catalog/catalog.json'),
    images: path.join(REPO_ROOT, 'tools/egluosi-importer/source/images') },
  { catalog: path.join(REPO_ROOT, '2026-11-14/catalog-import/outputs/catalog.json'),
    images: path.join(REPO_ROOT, '2026-11-14/catalog-import/outputs/images') },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastAt = 0;
async function paced() {
  const wait = Math.max(0, DELAY_MS - (Date.now() - lastAt));
  if (wait > 0) await sleep(wait);
  lastAt = Date.now();
}

function magicExt(b) {
  if (b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'webp';
  return null;
}
function isPlaceholder(b) {
  if (b.length < 200) return true;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return b.readUInt32BE(16) <= 1 && b.readUInt32BE(20) <= 1;
  }
  return false;
}
function jpegDim(b) {
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const m = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(m)) return `${b.readUInt16BE(i + 7)}x${b.readUInt16BE(i + 5)}`;
    i += 2 + len;
  }
  return '?';
}
function fetchBuffer(remote) {
  return new Promise((resolve) => {
    const req = https.request(
      { host: HOST, port: 443, path: new URL(remote).pathname, method: 'GET',
        headers: { 'User-Agent': UA, Referer: `https://${HOST}/b2b/` } },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', () => resolve({ status: 0, body: Buffer.alloc(0) }));
    req.end();
  });
}

async function main() {
  const src = JSON.parse(fs.readFileSync(TARGETS[0].catalog, 'utf8'));

  // 1) 收集所有 `_s` 唯一 URL，推导高清候选链 `_l → _m`（与 site.mjs 的 fallbacks 一致）
  const sToCandidates = new Map();
  const c3Set = new Set();
  for (const p of src.products) {
    for (const im of (p.images || [])) {
      const r = String(im.remote || '');
      if (/_s$/.test(r)) {
        sToCandidates.set(r, [r.replace(/_s$/, '_l'), r.replace(/_s$/, '_m')]);
        const m = r.match(/\/c3\/([^/]+)\//);
        if (m) c3Set.add(m[1]);
      }
    }
  }
  let urlPairs = [...sToCandidates.entries()].sort();
  if (limitC3 > 0) {
    const keep = new Set([...c3Set].slice(0, limitC3));
    urlPairs = urlPairs.filter(([s]) => { const m = s.match(/\/c3\/([^/]+)\//); return m && keep.has(m[1]); });
  }
  console.log(`[reimage-offline] ${dryRun ? 'dry-run ' : ''}_s→_l 映射 ${urlPairs.length} 条，类目 ${new Set(urlPairs.map(([s]) => (s.match(/\/c3\/([^/]+)\//) || [])[1])).size} 个`);

  // 2) 逐个尝试高清候选（_l→_m），下载成功即落盘，建立 旧URL -> {file, bytes, dim, variant}
  const imageDir = TARGETS[0].images;
  fs.mkdirSync(imageDir, { recursive: true });
  const urlToFile = new Map();
  let ok = 0, fail = 0, bytesSaved = 0, newFiles = 0;
  const dimCount = {};
  for (let i = 0; i < urlPairs.length; i += 1) {
    const [sUrl, candidates] = urlPairs[i];
    let got = null;
    for (const cand of candidates) {
      await paced();
      const { status, body } = await fetchBuffer(cand);
      const ext = magicExt(body);
      // 404 页面可能自带 PNG 头，必须先看 status；占位图/无魔数一并丢弃
      if (status !== 200 || !ext || isPlaceholder(body)) {
        console.warn(`[reimage-offline] · 降级 ${cand.split('/').pop()}（status=${status} ext=${ext} bytes=${body.length}）`);
        continue;
      }
      got = { body, ext, variant: cand.split('/').pop() };
      break;
    }
    if (!got) {
      fail += 1;
      console.warn(`[reimage-offline] ✗ 所有高清档都失败，保留原 _s：${sUrl}`);
      continue;
    }
    const file = `${crypto.createHash('sha1').update(got.body).digest('hex')}.${got.ext}`;
    const dest = path.join(imageDir, file);
    if (!fs.existsSync(dest)) { if (!dryRun) fs.writeFileSync(dest, got.body); newFiles += 1; }
    const dim = jpegDim(got.body);
    dimCount[dim] = (dimCount[dim] || 0) + 1;
    urlToFile.set(sUrl, { file, bytes: got.body.length, dim, variant: got.variant });
    bytesSaved += got.body.length;
    ok += 1;
    if ((i + 1) % 100 === 0) console.log(`[reimage-offline] 下载进度 ${i + 1}/${urlPairs.length}`);
  }
  console.log('[reimage-offline] 分辨率分布:', JSON.stringify(dimCount));
  console.log(`[reimage-offline] 高清图 OK=${ok} FAIL=${fail} 新文件=${newFiles} 体积=${(bytesSaved / 1024 / 1024).toFixed(1)}MB`);
  if (fail > 0 && ok === 0) { console.error('[reimage-offline] 一张高清图都没拉到，终止（不写任何文件）'); process.exit(1); }

  if (dryRun) { console.log('[reimage-offline] dry-run 结束，未写入'); return; }

  // 3) 遍历三份 catalog，替换 remote/staged，其余字段不动
  for (const t of TARGETS) {
    const raw = fs.readFileSync(t.catalog, 'utf8');
    const data = JSON.parse(raw);
    let changedImgs = 0, missingMap = 0;
    for (const p of data.products) {
      for (const im of (p.images || [])) {
        const r = String(im.remote || '');
        const hit = urlToFile.get(r);
        if (hit) {
          im.remote = r.replace(/_s$/, hit.variant);
          im.staged = `images/${hit.file}`;
          changedImgs += 1;
        } else if (/_s$/.test(r)) {
          missingMap += 1; // 该 _s 没拉到高清，保留原样
        }
      }
    }
    const out = `${JSON.stringify(data, null, 2)}\n`;
    const bak = `${t.catalog}.pre-reimage.bak`;
    if (!fs.existsSync(bak)) fs.copyFileSync(t.catalog, bak);
    fs.writeFileSync(t.catalog, out, 'utf8');
    console.log(`[reimage-offline] ${path.relative(REPO_ROOT, t.catalog)}: 替换 ${changedImgs} 处，未映射保留 ${missingMap} 处，备份 ${path.basename(bak)}`);
  }

  // 4) 把新高清图镜像到其它 images 目录（outputs 等）
  const mirrorDirs = [...new Set(TARGETS.map((t) => t.images))];
  for (const d of mirrorDirs) {
    if (d === imageDir) continue;
    fs.mkdirSync(d, { recursive: true });
    for (const { file } of urlToFile.values()) {
      const s = path.join(imageDir, file);
      const dst = path.join(d, file);
      if (fs.existsSync(s) && !fs.existsSync(dst)) fs.copyFileSync(s, dst);
    }
    console.log(`[reimage-offline] 镜像高清图 -> ${path.relative(REPO_ROOT, d)}`);
  }

  console.log('[reimage-offline] 完成。');
}

main().catch((e) => { console.error('[reimage-offline] 异常:', e && e.stack ? e.stack : e); process.exit(1); });
