/**
 * 货源站适配器：杭州女装网（www.hznzcn.com）。
 *
 * 与 egluosi 共用 ingest.mjs 的入库/幂等/下架机制，但采集、字段映射、限速各自独立：
 *   - id：hzn-<源站商品id>，source_key：hzn:<源站商品id>，绝不与 egl-* 撞号
 *   - 价格：源站详情页写「登录查看进货价」，匿名拿不到 → price_li/sale/discount 全部 null，
 *           price_fen 落 0（NOT NULL 列），price_source='inquiry'
 *   - 库存/起订量：源站不公开 → stock=0 + stock_source='unknown'，min_order_qty 取库表默认 1
 *   - 单位：页面数量单位是「件」
 *   - 图片：去掉 alicdn 的 `_300x300` 尺寸后缀取原图，带 Referer 下载，按 SHA1 落本地，
 *           对外仍走 /media/products/<sha1>.<ext>（img.mixm.top）
 *
 * 源站有 WAF：≥2.5s/请求、串行、指数退避；被封时明确报错，不要伪造数据。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';

import { magicExt, isPlaceholder } from '../site.mjs';
import { MAX_ORDER_QTY } from '../mapping.mjs';
import { applySiteChanges } from '../ingest.mjs';
import { markRunFinished, markRunStarted, openPool } from '../store.mjs';
import {
  acquireLock,
  createLogger,
  newRunId,
  pruneRunLogs,
  readJson,
  rotateLog,
  writeAtomic,
} from '../util.mjs';

export const SITE = {
  key: 'hznzcn',
  origin: 'https://www.hznzcn.com',
  idPrefix: 'hzn-',
  sourceKeyPrefix: 'hzn:',
  catIdPrefix: 'hz',
  importBatch: 'hznzcn-sync',
  unit: '件',
  /** 源站 WAF 经验值：请求间隔低于 2.5s 连续 6 次左右即触发连接重置 */
  minGapMs: 2500,
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ HTTP
function request(url, headers) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (e) {
      reject(e);
      return;
    }
    const mod = target.protocol === 'http:' ? http : https;
    const req = mod.request(
      {
        host: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.setTimeout(25000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/** WAF 拦截页特征：验证码/防火墙提示，正常商品页不会出现。 */
function looksBlocked(text) {
  if (!text) return true;
  return /安全验证|滑动验证|访问验证|人机验证|请开启JavaScript|captcha|aliyun_waf|Sorry,\s*your request/i.test(
    text.slice(0, 4000)
  );
}

function createHttp(cfg, log) {
  const gap = Math.max(SITE.minGapMs, cfg.listDelayMs || 0);
  let lastAt = 0;
  let chain = Promise.resolve();

  /** 全局串行限流：所有请求排队，保证任意两次请求间隔 ≥ gap。 */
  function pace() {
    const run = chain.then(async () => {
      const wait = Math.max(0, gap - (Date.now() - lastAt));
      if (wait > 0) await sleep(wait);
      lastAt = Date.now();
    });
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function get(
    url,
    { binary = false, referer = `${SITE.origin}/`, retries = cfg.maxRetries, pace: usePace = true } = {}
  ) {
    let lastErr = '';
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      // 图片走 alicdn，不受源站 WAF 限速约束；商品页/列表页必须串行限速
      if (usePace) await pace();
      try {
        const res = await request(url, {
          'User-Agent': UA,
          Accept: binary
            ? 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
            : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Referer: referer,
        });
        if (res.status === 200) {
          if (binary) return res.body;
          const text = res.body.toString('utf8');
          if (looksBlocked(text)) throw new Error('源站返回验证/拦截页');
          return text;
        }
        lastErr = `HTTP ${res.status}`;
        if (res.status === 404) throw new Error(lastErr);
        // 403/429/444/5xx：多半是 WAF，退避后重试
        if ([403, 429, 444].includes(res.status) || res.status >= 500) {
          const backoff = Math.min(10 * 60 * 1000, 3000 * 2 ** attempt);
          log(`[hznzcn] ${lastErr} → ${Math.round(backoff / 1000)}s 后重试（${attempt + 1}/${retries + 1}）`);
          await sleep(backoff);
          continue;
        }
        throw new Error(lastErr);
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        if (attempt >= retries) break;
        const backoff = Math.min(10 * 60 * 1000, 4000 * 2 ** attempt);
        log(`[hznzcn] 请求失败 ${lastErr} → ${Math.round(backoff / 1000)}s 后重试（${attempt + 1}/${retries + 1}）`);
        await sleep(backoff);
      }
    }
    throw new Error(`${url} 请求失败：${lastErr}`);
  }

  return { get };
}

// -------------------------------------------------------------- HTML 工具
export function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripTags(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : '';
}

/** 分类链接里的数字 id：/hz/gallery-151-grid.html 或 /gallery-17---4-1-1-grid.html */
function galleryId(href) {
  const m = String(href || '').match(/gallery-(\d+)/i);
  return m ? m[1] : '';
}

// ---------------------------------------------------------- 分类树解析
/**
 * 解析站内「全部商品类目」导航。
 *
 * 实测结构（2026-11）：一级是导航分组（女装/男装/童装…），
 * 每个分组下平铺二级品类（棉衣/棉服、连衣裙…），没有第三级；
 * 商品列表页按二级品类的 gallery-<id> 访问。
 * 因此 levels[3] 恒为 0，报告中明确标注「源站无三级」。
 */
export function parseCategoryTree(html) {
  const nodes = [];
  const seen = new Set();
  const add = (n) => {
    const key = `${n.level}:${n.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    nodes.push(n);
    return true;
  };

  const labelRe =
    /<div class=["']labelh3["'][\s\S]{0,500}?<a[^>]*href=["']([^"']*gallery-(\d+)[^"']*)["'][^>]*>([^<]{1,40})<\/a>/gi;
  const labels = [...html.matchAll(labelRe)];
  const leaves = [];
  const leafSeen = new Set();
  const pushLeaf = (n) => {
    if (leafSeen.has(n.code)) return;
    leafSeen.add(n.code);
    leaves.push(n);
  };

  if (labels.length > 0) {
    labels.forEach((lm, idx) => {
      const blockEnd = idx + 1 < labels.length ? labels[idx + 1].index : html.length;
      const block = html.slice(lm.index, blockEnd);
      const parent = { code: lm[2], name: stripTags(lm[3]), level: 1, parent: null };
      parent.path = [parent.name];
      add(parent);

      const childRe = /<a[^>]*href=["']([^"']*gallery-(\d+)[^"']*)["'][^>]*>([^<]{1,40})<\/a>/gi;
      const kids = [];
      let cm;
      while ((cm = childRe.exec(block))) {
        if (cm[2] === lm[2]) continue;
        const name = stripTags(cm[3]);
        if (!name) continue;
        if (kids.some((k) => k.code === cm[2])) continue;
        kids.push({ code: cm[2], name, level: 2, parent, path: [parent.name, name] });
      }
      for (const k of kids) add(k);
      if (kids.length === 0) pushLeaf(parent);
      else for (const k of kids) pushLeaf(k);
    });
  } else {
    // 兜底：没有导航分组结构时，把页面上的 gallery 链接当一级（complete=false）
    const flatRe = /<a[^>]*href=["']([^"']*gallery-(\d+)[^"']*)["'][^>]*>([^<]{1,40})<\/a>/gi;
    let fm;
    while ((fm = flatRe.exec(html))) {
      const name = stripTags(fm[3]);
      if (!name) continue;
      const n = { code: fm[2], name, level: 1, parent: null, path: [name] };
      if (add(n)) pushLeaf(n);
    }
  }

  const levels = { 1: 0, 2: 0, 3: 0 };
  for (const n of nodes) levels[n.level] += 1;
  const complete = levels[1] > 0 && levels[2] > 0;

  return {
    nodes,
    levels,
    leaves,
    complete,
    // 实测源站为「一级导航 + 二级品类」，无三级
    depth: levels[3] > 0 ? 3 : levels[2] > 0 ? 2 : 1,
    method: labels.length > 0 ? 'nav-labelh3' : 'gallery-links',
  };
}

/** 叶子节点往上找到一级分类（缺一级时退回最高可见祖先）。 */
function topAncestor(node) {
  let n = node;
  while (n.parent) n = n.parent;
  return n;
}

// ------------------------------------------------------------ 列表解析
export function parseList(html, origin = SITE.origin) {
  const totalMatch =
    html.match(/id=["']showProCount["'][^>]*>\s*([\d,]+)/) || html.match(/总共找到\s*([\d,]+)\s*个/);
  const pageCount = Number((html.match(/id="spanPageCount"[^>]*>\s*(\d+)/) || [])[1] || 0);

  // 只认真正的列表条目 <li class=" product_item_li " productid="...">。
  // 整页有约 450 个 /product-<id>.html 链接，其中侧栏「热卖商品」推荐会混入，
  // 按链接遍历会导入不属于本分类的商品，所以必须先按条目容器切块。
  const items = [];
  const seen = new Set();
  const marks = [];
  const blockRe = /<li[^>]*class=["'][^"']*product_item_li[^"']*["'][^>]*>/gi;
  let bm;
  while ((bm = blockRe.exec(html))) {
    marks.push({ index: bm.index, end: bm.index + bm[0].length, open: bm[0] });
  }

  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i];
    const nextIdx = i + 1 < marks.length ? marks[i + 1].index : Math.min(html.length, mark.end + 6000);
    const block = html.slice(mark.end, nextIdx);

    const id = attr(mark.open, 'productid') || (block.match(/\/product-(\d+)\.html/) || [])[1] || '';
    if (!id || seen.has(id)) continue;
    seen.add(id);

    // 条目内还有勾选框图标等 <img>，只取真正的商品图（alicdn 域）
    const imgs = [...block.matchAll(/<img[^>]*>/gi)].map((im) => im[0]);
    const imgTag = imgs.find((t) => /alicdn\.com/i.test(t)) || imgs[0] || '';
    const rawImage = attr(imgTag, 'data-original') || attr(imgTag, 'src');
    const brand = (block.match(/brandname=["']([^"']{1,60})["']/) || [])[1] || '';

    // rowTitle 里的 title 是纯商品名；img 的 title 形如「NAME,档口名 货号」需剥掉尾部
    const rowTitle = stripTags(
      (block.match(/class=["'][^"']*rowTitle[^"']*["'][\s\S]{0,500}?<a[^>]*title=["']([^"']+)["']/i) || [])[1] || ''
    );
    let name = rowTitle;
    if (!name) {
      name = stripTags(attr(imgTag, 'title'));
      if (brand) {
        const suffix = new RegExp(`[,，]\\s*${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\S+\\s*$`);
        name = name.replace(suffix, '');
      }
    }
    if (!name) continue;

    const priceText = ((block.match(/登录(?:查看|后查看)进货价|¥\s*[\d.]+|￥\s*[\d.]+/) || [])[0] || '').trim();

    items.push({
      sourceId: id,
      name,
      brand,
      image: rawImage ? normalizeImageUrl(rawImage) : null,
      priceText,
      url: `${origin}/product-${id}.html`,
    });
  }

  return {
    items,
    total: totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : null,
    pageCount,
  };
}

// ------------------------------------------------------------ 详情解析
export function parseDetail(html, id) {
  const title =
    stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '') ||
    stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/[-_|].*$/, '');

  const hidden = (field) => {
    const m = html.match(new RegExp(`id=["']${field}["'][^>]*value=["']([^"']*)["']`, 'i'));
    return m ? decodeEntities(m[1]) : '';
  };

  // 隐藏域：prodNo=货号，Product_CID=二级品类，topCid=一级分组，SpecPrice=规格串
  const itemNo = hidden('prodNo') || stripTags((html.match(/id=["']productCoodsNo["'][^>]*>([^<]{1,40})</i) || [])[1] || '');
  const categoryId = hidden('Product_CID');
  const topCategoryId = hidden('topCid');
  const specPrice = hidden('SpecPrice');

  // SpecPrice 形如：图片色,S;6156-1;登录查看进货价;1;1000|...
  // 只取颜色/尺码/货号与价格原文；最后两段含义源站未公开，不解释、不入库。
  const colors = [];
  const sizes = [];
  const skus = [];
  if (specPrice) {
    for (const part of specPrice.split('|')) {
      const seg = part.split(';');
      if (seg.length < 3) continue;
      const [color, size] = String(seg[0] || '').split(',');
      if (color && !colors.includes(color)) colors.push(color);
      if (size && !sizes.includes(size)) sizes.push(size);
      skus.push({ color: color || '', size: size || '', code: seg[1] || '', priceText: seg[2] || '', tail: seg.slice(3).join(';') });
    }
  }

  const afterLabel = (label) => {
    const m = html.match(new RegExp(`${label}[：:]\\s*(?:<[^>]*>\\s*)*([^<]{1,60})`, 'i'));
    return m ? decodeEntities(m[1]).trim() : '';
  };

  const sales = numOrNull(afterLabel('总销量'));
  const views = numOrNull(afterLabel('浏览量'));
  const weight = afterLabel('重量');
  const createdAt = afterLabel('创建时间');
  const updatedAt = afterLabel('更新时间');
  const stallInMeta = (html.match(/档口位置在([^，。<"]{1,60})/) || [])[1] || '';
  const stall = stallInMeta.trim();

  // 主图：midimg 的 jqimg 是原图；颜色规格图取 originaladdress（原图，不带尺寸后缀）
  const images = [];
  const pushImg = (raw) => {
    const url = normalizeImageUrl(raw);
    if (!url || images.includes(url)) return;
    images.push(url);
  };
  pushImg((html.match(/id=["']midimg["'][^>]*jqimg=["']([^"']+)["']/i) || [])[1] || '');
  const origRe = /originaladdress=['"]([^'"]*alicdn[^'"]*)['"]/gi;
  let om;
  while ((om = origRe.exec(html)) && images.length < 20) pushImg(om[1]);
  if (images.length === 0) {
    const anyRe = /((?:https?:)?\/\/[^"'\s]*alicdn\.com[^"'\s]*\.(?:jpg|jpeg|png|webp)(?:_[^"'\s]*)?)/gi;
    while ((om = anyRe.exec(html)) && images.length < 20) pushImg(om[1]);
  }

  return {
    id: String(id),
    title: title || '',
    itemNo,
    categoryId,
    topCategoryId,
    sales,
    views,
    weight,
    stall,
    createdAt,
    updatedAt,
    colors,
    sizes,
    skus,
    material: afterLabel('面料'),
    style: afterLabel('风格'),
    images,
    description: '',
  };
}

function numOrNull(v) {
  const n = Number(String(v || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && String(v || '').trim() !== '' ? n : null;
}

function splitValues(v) {
  return String(v || '')
    .split(/[\/,，、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);
}

/** img.alicdn.com/.../x.jpg_300x300.jpg → 原图；保留原尺寸，不压缩。 */
export function normalizeImageUrl(raw) {
  if (!raw) return null;
  let url = String(raw).trim();
  if (url.startsWith('//')) url = `https:${url}`;
  if (!/^https?:/i.test(url)) return null;
  return url.replace(/(_\d+x\d+[^./]*)+\.[a-z]+$/i, '');
}

// ---------------------------------------------------------------- 采集
/**
 * 列表页 URL：/hz/gallery-<catId>-grid.html（第 1 页）
 *             /hz/gallery-<catId>-<page>-grid.html（第 n 页）
 * 实测分页上限 100 页 × 150 条/页。
 */
function listUrl(cat, page) {
  const suffix = page > 1 ? `-${page}` : '';
  return `${SITE.origin}/hz/gallery-${cat.code}${suffix}-grid.html`;
}

async function collectCatalog({ http, cfg, log }) {
  const startedAt = Date.now();
  const home = await http.get(`${SITE.origin}/`, { referer: `${SITE.origin}/` });
  const tree = parseCategoryTree(home);
  log(`[hznzcn] 分类树：一级 ${tree.levels[1]} / 二级 ${tree.levels[2]} / 三级 ${tree.levels[3]}（complete=${tree.complete}）`);
  if (!tree.nodes.length) throw new Error('分类树解析为空（首页结构可能改版或被 WAF 拦截），停止导入');
  const leaves = tree.leaves;
  if (!leaves.length) throw new Error('未解析到叶子品类，停止导入（不做无依据的猜测）');

  const pages = cfg.pages > 0 ? cfg.pages : 1;
  const scope = cfg.limit > 0 ? leaves.slice(0, cfg.limit) : leaves;
  const items = [];
  const seen = new Set();
  const perCategory = [];
  const errors = [];
  let listFailed = 0;
  let totalReported = null;
  let truncated = false;

  for (let i = 0; i < scope.length; i += 1) {
    const leaf = scope[i];
    let count = 0;
    if (!truncated) {
      for (let page = 1; page <= pages; page += 1) {
        try {
          const html = await http.get(listUrl(leaf, page), {
            referer: `${SITE.origin}/hz/`,
          });
          const parsed = parseList(html);
          if (totalReported === null && parsed.total) totalReported = parsed.total;
          for (const row of parsed.items) {
            if (seen.has(row.sourceId)) continue;
            seen.add(row.sourceId);
            items.push(catalogItem(row, leaf));
            count += 1;
            if (cfg.maxItems > 0 && items.length >= cfg.maxItems) break;
          }
          if (!parsed.items.length) break;
          if (cfg.maxItems > 0 && items.length >= cfg.maxItems) break;
        } catch (e) {
          listFailed += 1;
          errors.push({ cat: leaf.code, page, error: e instanceof Error ? e.message : String(e) });
          log(`[hznzcn] 列表失败 ${leaf.code} p${page}：${errors[errors.length - 1].error}`);
          break;
        }
      }
      if (cfg.maxItems > 0 && items.length >= cfg.maxItems) truncated = true;
    }
    // 达到 --max-items 后不再请求，但类别仍以 0 计入，保证分类表完整、对账行不缺项
    perCategory.push({ code: leaf.code, name: leaf.name, level: leaf.level, path: leaf.path, items: count });
    if (i % 10 === 0 || i === scope.length - 1) {
      log(`[hznzcn] 目录进度 ${i + 1}/${scope.length} 类，累计 ${items.length} 件${truncated ? '（已达上限）' : ''}`);
    }
  }

  if (items.length === 0) throw new Error('列表解析到 0 件商品（结构改版或被拦截），停止导入');

  return {
    items,
    tree,
    perCategory,
    errors,
    listFailed,
    totalReported,
    scanned: scope.length,
    durationSec: Math.round((Date.now() - startedAt) / 1000),
  };
}

async function downloadImage({ http, cfg, log }, remote) {
  if (!cfg.downloadImages) return null;
  const original = normalizeImageUrl(remote);
  if (!original) return null;
  try {
    const buf = await http.get(original, { binary: true, referer: `${SITE.origin}/`, pace: false, retries: 2 });
    if (!buf || buf.length === 0) return null;
    if (isPlaceholder(buf)) {
      log(`[hznzcn] 占位图丢弃 ${original}`);
      return null;
    }
    const ext = magicExt(buf);
    if (!ext) {
      log(`[hznzcn] 图片魔数不可识别 ${original}`);
      return null;
    }
    const file = `${crypto.createHash('sha1').update(buf).digest('hex')}.${ext}`;
    const dest = path.join(cfg.imageDir, file);
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);
    return `/media/products/${file}`;
  } catch (e) {
    log(`[hznzcn] 图片下载失败 ${original}：${e instanceof Error ? e.message : e}`);
    return null;
  }
}

async function collectDetails({ http, cfg, log, items }) {
  const startedAt = Date.now();
  const store = { items: {}, errors: [] };
  const images = { ok: 0, failed: 0, products: 0 };
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    try {
      const html = await http.get(`${SITE.origin}/product-${item.sourceId}.html`);
      const parsed = parseDetail(html, item.sourceId);
      const local = [];
      for (const remote of parsed.images.slice(0, 6)) {
        const url = await downloadImage({ http, cfg, log }, remote);
        if (url) {
          local.push(url);
          images.ok += 1;
        } else {
          images.failed += 1;
        }
      }
      if (local.length === 0 && item.image) {
        const url = await downloadImage({ http, cfg, log }, item.image);
        if (url) local.push(url);
      }
      if (local.length) images.products += 1;
      store.items[item.sourceId] = { ...parsed, images: local };
    } catch (e) {
      store.errors.push({ id: item.sourceId, error: e instanceof Error ? e.message : String(e) });
      log(`[hznzcn] 详情失败 ${item.sourceId}：${store.errors[store.errors.length - 1].error}`);
    }
    if (i % 25 === 0 || i === items.length - 1) {
      log(`[hznzcn] 详情进度 ${i + 1}/${items.length}，失败 ${store.errors.length}`);
    }
    if (store.errors.length >= 50 && store.errors.length > i / 2) {
      throw new Error('详情失败率过高（源站可能再次封禁），已中止；修复网络后可用 --resume 续跑');
    }
  }
  return { store, stats: { ...images, errors: store.errors.length, durationSec: Math.round((Date.now() - startedAt) / 1000) } };
}

// ------------------------------------------------------------- 字段映射
/** 列表行 → 采集态 item：补齐分类/来源键，图片与描述等详情阶段再填。 */
export function catalogItem(row, leaf) {
  return {
    sourceKey: `${SITE.sourceKeyPrefix}${row.sourceId}`,
    sourceId: String(row.sourceId),
    sourceUrl: row.url || `${SITE.origin}/product-${row.sourceId}.html`,
    itemNo: String(row.sourceId),
    name: row.name || '',
    brand: row.brand || '',
    image: row.image || null,
    categoryCode: leaf.code,
    categoryName: leaf.name,
    categoryPath: leaf.path,
    c1Id: `${SITE.catIdPrefix}1:${topAncestor(leaf).code}`,
  };
}

export function buildNext(item, detail) {
  const colors = detail.colors || [];
  const sizes = detail.sizes || [];
  const images = detail.images || [];
  const subtitle = [
    colors.length ? `颜色 ${colors.slice(0, 3).join('/')}` : '',
    sizes.length ? `尺码 ${sizes.slice(0, 4).join('/')}` : '',
    detail.stall ? `档口 ${detail.stall}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const description =
    detail.description ||
    [
      detail.itemNo ? `货号：${detail.itemNo}` : '',
      detail.stall ? `档口：${detail.stall}` : '',
      colors.length ? `颜色：${colors.join(' / ')}` : '',
      sizes.length ? `尺码：${sizes.join(' / ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

  const specs = {};
  if (detail.itemNo) specs['货号'] = detail.itemNo;
  if (colors.length) specs['颜色'] = colors.join(' / ');
  if (sizes.length) specs['尺码'] = sizes.join(' / ');
  if (detail.weight) specs['重量'] = detail.weight;
  if (detail.material) specs['面料'] = detail.material;
  if (detail.style) specs['风格'] = detail.style;

  const attributes = {};
  if (detail.itemNo) attributes['货号'] = detail.itemNo;
  if (detail.stall) attributes['档口'] = detail.stall;
  if (item.categoryPath?.length) attributes['分类'] = item.categoryPath.join(' / ');
  if (detail.sales != null) attributes['总销量'] = String(detail.sales);
  if (detail.views != null) attributes['浏览量'] = String(detail.views);
  if (detail.weight) attributes['重量'] = detail.weight;
  if (detail.material) attributes['面料'] = detail.material;
  if (detail.style) attributes['风格'] = detail.style;
  if (detail.createdAt) attributes['创建时间'] = detail.createdAt;
  if (detail.updatedAt) attributes['更新时间'] = detail.updatedAt;

  return {
    title: detail.title || item.name,
    subtitle,
    // brand 取源站列表的 brandname（真正的品牌/档口名字段）；详情里的 stall 是档口位置，
    // 放进 subtitle / attributes，避免把「某某服装城X楼」当成品牌。
    brand: item.brand || detail.stall || null,
    categoryCode: item.categoryCode,
    categoryPath: item.categoryPath,
    categoryName: item.categoryName,
    c1Id: item.c1Id,
    // 详情隐藏域 prodNo 才是真正的货号（列表里只有商品 id 与标题尾码）
    itemNo: detail.itemNo || item.itemNo || null,
    description,
    packQty: null,
    images,
    cover: images[0] || null,
    // 价格：匿名不可见 → 全部留空，不猜
    priceLi: null,
    priceFen: 0,
    discountPct: null,
    salePriceLi: null,
    tejiaDiscountPct: null,
    priceSource: 'inquiry',
    // 库存/起订：源站不公开
    stock: 0,
    stockSource: 'unknown',
    maxOrderQty: MAX_ORDER_QTY,
    specs,
    attributes,
    promotions: [],
    packagingDesc: null,
    unitOptions: [],
    unitConversions: {},
    specImage: null,
    unit: SITE.unit,
    sourceOnSale: true,
    sourceInvStatus: null,
  };
}

export const hznzcnAdapter = {
  idPrefix: SITE.idPrefix,
  importBatch: SITE.importBatch,
  scope: { sql: `source_key like '${SITE.sourceKeyPrefix}%'`, params: [] },
  idOf: (item) => `${SITE.idPrefix}${item.sourceId}`,
  buildNext,
  columns(item, next, ctx) {
    const categoryName =
      next.categoryName || item.categoryName || item.categoryPath[item.categoryPath.length - 1] || item.categoryCode;
    return {
      id: ctx.id,
      title: next.title,
      subtitle: next.subtitle,
      price_fen: 0,
      original_price_fen: 0,
      stock: 0,
      category: item.categoryCode,
      cover: next.cover,
      images: next.images,
      tags: [categoryName].filter(Boolean),
      description: next.description,
      sort_no: ctx.dbCount + ctx.added,
      source_key: item.sourceKey,
      source_url: item.sourceUrl,
      source_id: item.sourceId,
      brand: next.brand,
      category_path: item.categoryPath.join('/'),
      category_name: categoryName,
      specs: next.specs,
      unit: SITE.unit,
      pack_qty: null,
      price_source: 'inquiry',
      price_captured_at: new Date().toISOString(),
      stock_source: 'unknown',
      import_batch: SITE.importBatch,
      attributes: next.attributes,
      price_li: null,
      discount_pct: null,
      sale_price_li: null,
      promotions: [],
      packaging_desc: null,
      unit_options: [],
      unit_conversions: {},
      spec_image: null,
      source_item_no: next.itemNo || item.itemNo,
      // 源站不公开起订量/步进：库表 NOT NULL，落最小值 1，并在报告里列为缺失
      min_order_qty: 1,
      qty_step: 1,
      max_order_qty: MAX_ORDER_QTY,
      listed: true,
      source_status: 'active',
      source_status_at: new Date().toISOString(),
      source_on_sale: true,
      source_inv_status: null,
      tejia_discount_pct: null,
      // 源站只有两级：商品挂二级叶子节点 id（hz2:*）。
      // 商城查询按 `c3_id in (id / parent_id / 孙节点)` 递归收敛，一级/二级选择都能命中。
      c3_id: `${SITE.catIdPrefix}2:${item.categoryCode}`,
      c1_id: item.c1Id,
    };
  },
};

// ------------------------------------------------------------- 分类落库
async function persistCategories(pool, tree, perCategory) {
  const countByCode = new Map(perCategory.map((c) => [c.code, c.items]));
  // 源站实测两级（无三级）：商品挂在最深层叶子节点上，回填/清零都以该层为准。
  const leafLevel = tree.depth || 2;
  const leafPrefix = `${SITE.catIdPrefix}${leafLevel}:`;
  for (const node of tree.nodes) {
    const id = `${SITE.catIdPrefix}${node.level}:${node.code}`;
    const parentId = node.parent ? `${SITE.catIdPrefix}${node.parent.level}:${node.parent.code}` : null;
    await pool.query(
      `insert into catalog_categories (id, source, level, code, name, parent_id, path_names, sort_no, product_count, is_active, synced_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, now())
       on conflict (source, level, code) do update
          set name = excluded.name, parent_id = excluded.parent_id, path_names = excluded.path_names,
              sort_no = excluded.sort_no, is_active = true, synced_at = now()`,
      [
        id,
        SITE.key,
        node.level,
        node.code,
        node.name,
        parentId,
        node.path,
        tree.nodes.indexOf(node),
        countByCode.get(node.code) || 0,
      ]
    );
  }

  // 商品数按库内真实在售统计回填（列表解析数只作对账参考）
  await pool.query(
    `update catalog_categories cc
        set product_count = coalesce(p.cnt, 0), synced_at = now()
       from (
         select c3_id, count(*)::int as cnt
           from products
          where listed and c3_id like $1
          group by c3_id
       ) p
      where cc.id = p.c3_id and cc.source = $2`,
    [`${leafPrefix}%`, SITE.key]
  );
  await pool.query(
    `update catalog_categories set product_count = 0, synced_at = now()
      where source = $1 and level = $3 and id not in (
        select distinct c3_id from products where listed and c3_id like $2
      )`,
    [SITE.key, `${leafPrefix}%`, leafLevel]
  );
  // 上级节点 = 子节点求和，保证分类树每层数量一致
  await pool.query(
    `update catalog_categories p
        set product_count = coalesce((
              select sum(c.product_count) from catalog_categories c
               where c.parent_id = p.id and c.source = p.source
            ), 0),
            synced_at = now()
      where p.source = $1 and p.level < $2`,
    [SITE.key, leafLevel]
  );
}

async function reconcile({ cfg, tree, perCategory, catalogStats, applyStats, detailStats, pool }) {
  const leafLevel = tree.depth || 2;
  const leafPrefix = `${SITE.catIdPrefix}${leafLevel}:`;
  const dbCounts = await pool.query(
    `select c3_id, count(*)::int as cnt from products
      where listed and c3_id like $1 group by c3_id`,
    [`${leafPrefix}%`]
  );
  const dbByC3 = new Map(dbCounts.rows.map((r) => [r.c3_id, r.cnt]));

  const rows = perCategory.map((c) => {
    const db = dbByC3.get(`${leafPrefix}${c.code}`) || 0;
    return {
      level: leafLevel,
      code: c.code,
      name: c.name,
      path: c.path.join(' / '),
      sourceItems: c.items,
      dbProducts: db,
      match: c.items === db,
    };
  });

  // 分类节点对账：按层输出源站解析节点数与库内节点数、名称是否逐一对上
  const dbNodes = await pool.query(
    `select id, level, code, name, parent_id, product_count
       from catalog_categories where source = $1 order by level asc, code asc`,
    [SITE.key]
  );
  const dbNodeKey = new Set(dbNodes.rows.map((r) => `${r['level']}:${r['code']}`));
  const srcNodeKey = new Set(tree.nodes.map((n) => `${n.level}:${n.code}`));
  const nodeLevels = { 1: 0, 2: 0, 3: 0 };
  for (const r of dbNodes.rows) nodeLevels[r['level']] += 1;
  const nameMismatch = tree.nodes
    .map((n) => {
      const row = dbNodes.rows.find((r) => r['level'] === n.level && r['code'] === n.code);
      return row && row['name'] !== n.name ? { level: n.level, code: n.code, source: n.name, db: row['name'] } : null;
    })
    .filter(Boolean);
  const nodeReconcile = {
    sourceLevels: tree.levels,
    dbLevels: nodeLevels,
    onlyInSource: tree.nodes.filter((n) => !dbNodeKey.has(`${n.level}:${n.code}`)).map((n) => `${n.level}:${n.code}`),
    onlyInDb: dbNodes.rows.filter((r) => !srcNodeKey.has(`${r['level']}:${r['code']}`)).map((r) => `${r['level']}:${r['code']}`),
    nameMismatch,
  };

  const samples = await pool.query(
    `select id, source_key, title, price_fen, price_li, listed, category_name, c3_id, images
       from products where source_key like $1 order by random() limit 5`,
    [`${SITE.sourceKeyPrefix}%`]
  );

  const missing = {
    price: '源站详情页「登录查看进货价」，匿名无价格 → price_li / discount_pct / sale_price_li 均为 null',
    stock: '源站不公开库存 → stock=0、stock_source=unknown',
    minOrderQty: '源站不公开起订量 → 落库表 NOT NULL 默认值 1（非源站真实值）',
    qtyStep: '源站不公开购买步进 → 落库表 NOT NULL 默认值 1（非源站真实值）',
    onSale: '源站不公开上下架状态，仅能确认「出现在列表页」→ listed=true',
    unitConversions: '源站无盒/箱换算 → unit_conversions={}',
    specDims: '无规格筛选项 → spec_dims/spec_lens 未写',
  };

  return {
    levels: tree.levels,
    treeComplete: tree.complete,
    nodeNames: tree.nodes.map((n) => ({ level: n.level, code: n.code, name: n.name, path: n.path.join(' / ') })),
    nodeReconcile,
    perCategory: rows,
    mismatched: rows.filter((r) => !r.match),
    samples: samples.rows,
    sampleCount: samples.rowCount,
    missingFields: missing,
    scope: {
      siteReportedTotal: catalogStats.totalReported,
      imported: applyStats.added,
      pagesPerLeaf: cfg.pages > 0 ? cfg.pages : 1,
      note: '源站单大类公开分页上限 100 页 × 150 条；本次按叶子分类抓取，非全量',
    },
    images: { downloaded: detailStats.ok, failed: detailStats.failed, productsWithImage: detailStats.products },
  };
}

// ---------------------------------------------------------------- 主流程
export async function runSite(cfg) {
  fs.mkdirSync(cfg.stateDir, { recursive: true });
  fs.mkdirSync(cfg.reportDir, { recursive: true });
  fs.mkdirSync(cfg.imageDir, { recursive: true });
  rotateLog(cfg.logFile, cfg.logMaxBytes);

  let release;
  try {
    release = acquireLock(cfg.stateDir);
  } catch (e) {
    console.error(`[hznzcn] ${e instanceof Error ? e.message : e}`);
    return 0;
  }

  const stateFile = path.join(cfg.stateDir, 'hznzcn-state.json');
  let state = cfg.resume ? readJson(stateFile, null) : null;
  const resumable = state && state.phase !== 'done' && Date.now() - Date.parse(state.startedAt) < 48 * 3600 * 1000;
  if (!resumable) {
    for (const f of ['hznzcn-state.json', 'hznzcn-catalog.json', 'hznzcn-details.json']) {
      const p = path.join(cfg.stateDir, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    state = {
      runId: `hznzcn-${newRunId()}`,
      startedAt: new Date().toISOString(),
      site: SITE.key,
      phase: 'catalog',
      catalogDone: false,
      detailDone: false,
    };
    writeAtomic(stateFile, state);
  }

  const logger = createLogger(cfg.reportDir, state.runId);
  const log = logger.log;
  pruneRunLogs(cfg.reportDir);
  log(`===== hznzcn sync ${cfg.dryRun ? '(dry-run)' : ''} run=${state.runId} =====`);
  if (resumable) log(`[hznzcn] 断点续跑 ${state.runId}（phase=${state.phase}）`);

  const http = createHttp(cfg, log);
  let exitCode = 0;
  try {
    if (!cfg.dryRun) await markRunStarted(state.runId, state.startedAt);
    const t0 = Date.now();

    if (!state.catalogDone) {
      const catalog = await collectCatalog({ http, cfg, log });
      state.catalogDone = true;
      state.delistSafe = catalog.listFailed === 0 && cfg.limit === 0 && cfg.maxItems === 0;
      state.catalogStats = {
        leaves: catalog.tree.leaves.length,
        scanned: catalog.scanned,
        items: catalog.items.length,
        listFailed: catalog.listFailed,
        totalReported: catalog.totalReported,
        levels: catalog.tree.levels,
        durationSec: catalog.durationSec,
      };
      state.catalogErrors = catalog.errors;
      writeAtomic(path.join(cfg.stateDir, 'hznzcn-catalog.json'), {
        items: catalog.items,
        tree: catalog.tree,
        perCategory: catalog.perCategory,
        totalReported: catalog.totalReported,
      });
      writeAtomic(stateFile, state);
      log(`[hznzcn] 目录完成：${catalog.items.length} 件 / ${catalog.scanned} 个叶子分类`);
    }

    const catalog = readJson(path.join(cfg.stateDir, 'hznzcn-catalog.json'), null);
    if (!catalog) throw new Error('缺少 hznzcn-catalog.json，无法继续（请去掉 --resume 重跑）');

    let details;
    if (!state.detailDone) {
      const result = await collectDetails({ http, cfg, log, items: catalog.items });
      details = result.store;
      state.detailDone = true;
      state.detailStats = result.stats;
      writeAtomic(path.join(cfg.stateDir, 'hznzcn-details.json'), details);
      writeAtomic(stateFile, state);
    } else {
      details = readJson(path.join(cfg.stateDir, 'hznzcn-details.json'), { items: {}, errors: [] });
    }

    state.phase = 'apply';
    writeAtomic(stateFile, state);
    const { stats, changeLog, durationSec } = await applySiteChanges({
      cfg,
      state,
      items: catalog.items,
      details,
      adapter: hznzcnAdapter,
      openPool,
    });
    state.applyStats = { ...stats, durationSec, delistSafe: state.delistSafe };
    state.changeSamples = changeLog.slice(0, 50);

    let recon = null;
    if (!cfg.dryRun) {
      const pool = await openPool();
      try {
        await persistCategories(pool, catalog.tree, catalog.perCategory);
        recon = await reconcile({
          cfg,
          tree: catalog.tree,
          perCategory: catalog.perCategory,
          catalogStats: { totalReported: catalog.totalReported },
          applyStats: stats,
          detailStats: state.detailStats || {},
          pool,
        });
      } finally {
        await pool.end();
      }
    }

    const summary = `新增 ${stats.added} / 下架 ${stats.delisted} / 改价 ${stats.priceChanged} / 未变 ${stats.unchanged}`;
    const report = {
      runId: state.runId,
      site: SITE.key,
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
      reconcile: recon,
    };
    const reportPath = path.join(cfg.reportDir, `${state.runId}.json`);
    writeAtomic(reportPath, report);

    if (!cfg.dryRun) {
      const status = report.detailErrors > 0 || (report.catalogErrors || []).length > 0 ? 'partial' : 'success';
      await markRunFinished(state.runId, status, { ...report, changeSamples: undefined }, reportPath, null);
    }

    state.phase = 'done';
    writeAtomic(stateFile, state);
    log(`[hznzcn] ${summary}${cfg.dryRun ? '（dry-run 未落库）' : ''}`);
    log(`[hznzcn] 耗时 ${report.durationSec}s，报告 ${reportPath}`);
  } catch (e) {
    exitCode = 1;
    const message = e instanceof Error ? (e.stack || e.message) : String(e);
    log(`[hznzcn] 失败：${message}`);
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
