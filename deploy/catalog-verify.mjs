#!/usr/bin/env node
/**
 * 商城商品「只读验收」——不写生产、不改 DB，仅发 GET；可选地只读本地资产文件。
 * 供 CI 发布后调用，也可人工执行；对应 deploy/CATALOG-DEPLOY.md 的「逐项验收」。
 *
 * 用法：
 *   node deploy/catalog-verify.mjs https://www.mixm.top                    # HTTP 全项（CI runner / 本机）
 *   LOCAL_ONLY=1 CATALOG_FILE=/opt/mixmapp/prod-catalog/catalog.json \
 *     STORAGE_DIR=/var/lib/mixmapp/storage node deploy/catalog-verify.mjs  # 生产机本地资产硬验收
 *   CATALOG_FILE=... STORAGE_DIR=... node deploy/catalog-verify.mjs https://www.mixm.top  # 全项
 *   双跑期可显式传 https://cloud.mixm.top 做新旧对照。
 *
 * 环境变量：
 *   API_BASE              显式指定 API 根；缺省自动探测 /mixmapp/api/v1 与 /api/v1
 *   MIN_PRODUCTS          各类目 count 之和下限，默认 10000
 *   EXPECT_VERSION        healthz.version 精确期望值；缺省要求「非 preview」
 *   EXPECT_CATALOG_SOURCE 期望目录源，默认 catalog；source=db 且商品数达标也算通过（auto 让位给已导库）
 *   MEDIA_SAMPLE          固定抽检图片 key；缺省从商品响应里提取
 *   CATALOG_FILE          可选：生产机本地 catalog.json 绝对路径，启用「数据文件可解析」硬验收
 *   STORAGE_DIR           可选：生产机本地存储根，启用「products 图片数 ≥ MIN_IMAGES」硬验收
 *   MIN_IMAGES            图片数下限，默认 871
 *   LOCAL_ONLY            设为 1 时只跑本地资产硬验收（不发 HTTP），需同时设置 CATALOG_FILE 与 STORAGE_DIR
 *
 * 退出码：0 全通过 / 1 有失败项 / 2 脚本自身出错。
 *
 * 依据：
 * - /healthz 返回 checks.catalogSource 与顶层 catalogSource{mode,source,active,productCount,file,reason}
 *   （services/api/src/routes/meta.ts:33-56）；source==='catalog' 即 catalog.json 已加载且可解析。
 * - /mall/categories 返回 [{code,name,count}]，各类目 count 由全量 group by 得出，
 *   Σcount 即商品总数（services/api/src/modules/mall.ts:126）。
 * - 生产 admin 面未配 ADMIN_TOKEN 时不能远程灌库，故以「数据文件随包发布 + 内嵌只读目录源」为准。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SITE = (process.argv[2] ?? 'https://www.mixm.top').replace(/\/+$/, '');
const MIN_PRODUCTS = Number(process.env.MIN_PRODUCTS ?? 10000);
const EXPECT_VERSION = (process.env.EXPECT_VERSION ?? '').trim();
const EXPECT_SOURCE = (process.env.EXPECT_CATALOG_SOURCE ?? 'catalog').trim();
const MEDIA_SAMPLE = (process.env.MEDIA_SAMPLE ?? '').trim();
const CATALOG_FILE = (process.env.CATALOG_FILE ?? '').trim();
const STORAGE_DIR = (process.env.STORAGE_DIR ?? '').trim();
const MIN_IMAGES = Number(process.env.MIN_IMAGES ?? 871);
const LOCAL_ONLY = process.env.LOCAL_ONLY === '1';
const DEMO_TITLES = ['MixmAPP 首发限定礼盒', '石墨黑轻量冲锋衣', '桌面理线收纳坞'];
const DEMO_CATS = new Set(['featured', 'life', 'digital', 'wear']);
const HAS_HAN = /[\u4e00-\u9fa5]/;

const results = [];
function rec(name, ok, detail) {
  results.push({ name, ok });
  console.info(`${ok ? '✓ PASS' : '✗ FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`);
}

async function getJson(url, timeoutMs = 15000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON，保留 text 供正则提取 */
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function pickApiBase() {
  if (process.env.API_BASE) return process.env.API_BASE.replace(/\/+$/, '');
  for (const p of ['/mixmapp/api/v1', '/api/v1']) {
    try {
      const r = await getJson(`${SITE}${p}/healthz`);
      if (r.status === 200 && r.json && r.json.status) return `${SITE}${p}`;
    } catch {
      /* 试下一个前缀 */
    }
  }
  return `${SITE}/mixmapp/api/v1`;
}

/** 本地资产硬验收：在生产机本地执行、设置了 CATALOG_FILE / STORAGE_DIR 时启用。 */
function checkLocalAssets() {
  if (CATALOG_FILE) {
    let ok = false;
    let detail = '';
    try {
      const raw = JSON.parse(readFileSync(CATALOG_FILE, 'utf8'));
      const n = Array.isArray(raw.products) ? raw.products.length : 0;
      ok = n > MIN_PRODUCTS;
      detail = `products=${n} 路径=${CATALOG_FILE}`;
    } catch (e) {
      detail = `解析失败：${e instanceof Error ? e.message : String(e)}`;
    }
    rec('catalog.json 存在且可解析', ok, detail);
  } else {
    console.info('  … 跳过本地 catalog.json 检查（未设置 CATALOG_FILE；生产机执行时应设置）');
  }
  if (STORAGE_DIR) {
    let ok = false;
    let detail = '';
    try {
      const dir = join(STORAGE_DIR, 'products');
      const n = existsSync(dir)
        ? readdirSync(dir).filter((f) => /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(f)).length
        : 0;
      ok = n >= MIN_IMAGES;
      detail = `图片数=${n} 下限=${MIN_IMAGES} 目录=${dir}`;
    } catch (e) {
      detail = `读取失败：${e instanceof Error ? e.message : String(e)}`;
    }
    rec(`商品图片目录文件数 ≥ ${MIN_IMAGES}`, ok, detail);
  } else {
    console.info('  … 跳过本地图片目录检查（未设置 STORAGE_DIR；生产机执行时应设置）');
  }
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.info(`\n合计：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) {
    console.info(`失败项：${failed.map((f) => f.name).join('、')}`);
    process.exit(1);
  }
}

async function main() {
  if (LOCAL_ONLY) {
    if (!CATALOG_FILE || !STORAGE_DIR) {
      console.error('✗ LOCAL_ONLY=1 需要同时设置 CATALOG_FILE 与 STORAGE_DIR');
      process.exit(2);
    }
    console.info('\n▶ 本地资产硬验收（不发起 HTTP）');
    checkLocalAssets();
    finish();
    return;
  }

  const API = await pickApiBase();
  console.info(`\n▶ 站点：${SITE}\n▶ API ：${API}\n▶ 商品数下限：${MIN_PRODUCTS}  图片下限：${MIN_IMAGES}\n`);

  // 1. healthz 可达 + 真库
  let health;
  try {
    health = await getJson(`${API}/healthz`);
  } catch (e) {
    rec('healthz 可达', false, String(e));
    health = { status: 0, json: null };
  }
  const hj = health.json ?? {};
  const db = hj.checks?.db ?? '-';
  rec(
    'healthz 状态与真库',
    health.status === 200 && hj.status === 'ok' && ['ok', 'postgres', 'memory'].includes(db),
    `HTTP ${health.status} status=${hj.status} db=${db} dbTarget=${hj.checks?.dbTarget ?? '-'}`,
  );

  // 2. 正式版本号
  const version = String(hj.version ?? '');
  const versionOk = EXPECT_VERSION
    ? version === EXPECT_VERSION
    : Boolean(version) && !/preview/i.test(version) && version !== '0.0.0-preview';
  rec(
    '版本号为正式号',
    versionOk,
    `version=${version || '-'}${EXPECT_VERSION ? ` 期望=${EXPECT_VERSION}` : '（要求非 preview）'}`,
  );

  // 3. 类目：6 个真实中文类目 + 商品总数
  let cats = [];
  try {
    const r = await getJson(`${API}/mall/categories`);
    cats = Array.isArray(r.json?.data) ? r.json.data : [];
  } catch (e) {
    console.info(`  (categories 请求异常：${e})`);
  }
  const sum = cats.reduce((n, c) => n + (Number(c.count) || 0), 0);
  const realCats = cats.filter((c) => !DEMO_CATS.has(String(c.code ?? '').toLowerCase()));
  const hanCats = cats.filter((c) => HAS_HAN.test(String(c.name ?? '')));
  rec(
    '6 个真实中文类目',
    cats.length >= 6 && realCats.length >= 6 && hanCats.length >= 6,
    `类目数=${cats.length} 真实=${realCats.length} 中文名=${hanCats.length} 演示码残留=${cats.length - realCats.length}`,
  );
  rec(
    `商品总数 > ${MIN_PRODUCTS}`,
    sum > MIN_PRODUCTS,
    `Σcount=${sum} 明细=${cats.slice(0, 8).map((c) => `${c.code}:${c.name}:${c.count}`).join(', ') || '-'}`,
  );

  // 4. catalog.json 目录源硬验收：source==='catalog' 证明数据文件已加载且可解析
  const cs = hj.catalogSource ?? {};
  const source = String(cs.source ?? hj.checks?.catalogSource ?? '-');
  const sourceOk = source === EXPECT_SOURCE || (source === 'db' && sum > MIN_PRODUCTS);
  rec(
    'catalog 数据文件已加载（目录源接管）',
    sourceOk,
    `source=${source} mode=${cs.mode ?? '-'} productCount=${cs.productCount ?? '-'} ` +
      `file=${cs.file ?? '-'} reason=${cs.reason ?? '-'}` +
      (source === 'db' && sum > MIN_PRODUCTS ? '（auto 让位给已导库，商品数达标）' : ''),
  );

  // 5. 首页 3 条为真实五金商品
  let productsText = '';
  let products = [];
  try {
    const r = await getJson(`${API}/mall/products?page=1&pageSize=3`);
    productsText = r.text ?? '';
    products = Array.isArray(r.json?.data) ? r.json.data : [];
  } catch (e) {
    console.info(`  (products 请求异常：${e})`);
  }
  const titles = products.map((p) => String(p.title ?? p.name ?? ''));
  const demoHit = titles.filter((t) => DEMO_TITLES.some((d) => t.includes(d)));
  rec(
    '首页 3 条为真实商品',
    products.length === 3 && demoHit.length === 0,
    `返回=${products.length} 演示品命中=${demoHit.length} 样例=${titles.slice(0, 3).join(' / ') || '-'}`,
  );

  // 6. /media 抽检：200 + image/* content-type
  let key = MEDIA_SAMPLE;
  if (!key) {
    const m = productsText.match(/\/media\/products\/[A-Za-z0-9._-]+\.(?:jpg|jpeg|png|webp|gif|avif)/i);
    if (m) key = m[0].replace(/^\/media\//, '');
  }
  if (!key) key = 'products/000518191826ddfe69815af4ffe2513f1ca0de08.jpg';
  const mediaUrl = `${SITE}/media/${key.replace(/^\/+/, '')}`;
  try {
    const r = await fetch(mediaUrl, { signal: AbortSignal.timeout(15000), method: 'GET' });
    const ct = r.headers.get('content-type') ?? '';
    rec('/media 抽检返回 200 图片', r.status === 200 && /^image\//i.test(ct),
      `HTTP ${r.status} content-type=${ct} url=${mediaUrl}`);
  } catch (e) {
    rec('/media 抽检返回 200 图片', false, `${mediaUrl} → ${e}`);
  }

  // 7. 本地资产硬验收（设置了 CATALOG_FILE / STORAGE_DIR 时启用）
  checkLocalAssets();
  finish();
}

main().catch((e) => {
  console.error('验收脚本自身出错：', e);
  process.exit(2);
});
