#!/usr/bin/env node
/**
 * H5 构建后 SEO 产出器：给单页壳补全站点级 meta，并生成可被直接抓取的静态快照。
 *
 * 产出内容：
 *  1) index.html：title / description / keywords / robots / canonical / OG / Twitter / JSON-LD
 *     / preconnect，以及 API 与媒体基址的运行期全局变量；
 *  2) /mall/index.html、/mall/category/<code>/index.html、/mall/detail/<id>/index.html：
 *     在 #app 内预置品牌一致的静态正文，并带上各自的 title / canonical / OG / Product JSON-LD。
 *     JS 启动后 Vue 会接管 #app（uni 是客户端挂载，不做 hydration），视觉与现网完全一致；
 *     搜索引擎与不执行 JS 的抓取端则能直接读到正文和结构化数据。
 *  3) robots.txt、sitemap.xml。
 *
 * 数据来源：生产公开只读接口（/mall/categories、/mall/products），
 * 接口不可达时降级为「只输出站点级 SEO + 静态路由 sitemap」，构建不失败。
 *
 * 用法（由 apps/app/scripts/build.mjs 在 h5 构建后自动调用）：
 *   node scripts/generate-seo.mjs
 *   node scripts/generate-seo.mjs --dist apps/app/dist/build/h5 --products 300 --sitemap-products 3000
 *   node scripts/generate-seo.mjs --offline           # 完全不联网，只做静态部分
 *
 * 安全约束：只发 GET；不写业务数据；不依赖第三方包（纯 Node 内置模块）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── 路径与运行参数 ────────────────────────────────────────────────────────
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

/** 读取 `--key value` 形式的参数；缺省时回退到环境变量或默认值。 */
function option(name, envKey, fallback) {
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1];
  const fromEnv = (process.env[envKey] ?? '').trim();
  return fromEnv || fallback;
}

const OFFLINE = argv.includes('--offline');
const DIST = resolve(root, option('dist', 'MIXMAPP_H5_DIST', 'apps/app/dist/build/h5'));
const SITE_BASE = option('site', 'MIXMAPP_SITE_URL', 'https://www.mixm.top').replace(/\/+$/, '');
const API_BASE = option('api', 'MIXMAPP_SEO_API', 'https://api.mixm.top/mixmapp/api/v1').replace(/\/+$/, '');
const MEDIA_BASE = (process.env.MIXMAPP_MEDIA_BASE ?? 'https://img.mixm.top').trim().replace(/\/+$/, '');
const RUNTIME_API_BASE = (process.env.MIXMAPP_API_BASE ?? `${API_BASE}`).trim();
/** 生成静态详情快照的商品数：只覆盖头部商品，避免产物无限膨胀。 */
const SNAPSHOT_PRODUCTS = Math.max(0, Number(option('products', 'MIXMAPP_SEO_PRODUCTS', '300')) || 0);
/** sitemap 收录的商品数上限：分页每页 100 条，控制在接口预算内。 */
const SITEMAP_PRODUCTS = Math.max(0, Number(option('sitemap-products', 'MIXMAPP_SEO_SITEMAP_PRODUCTS', '3000')) || 0);
/** 联网预算：接口慢或不可达时及时收手，绝不拖死构建。 */
const FETCH_BUDGET_MS = Math.max(2000, Number(option('fetch-budget', 'MIXMAPP_SEO_FETCH_BUDGET', '45000')) || 45000);

const SITE_NAME = 'MixmAPP 五金商城';
const HOME_DESCRIPTION =
  'MixmAPP 五金商城提供螺丝、刀刃具、手工具、膨胀件等工业标准件在线采购，按分类、规格、品牌筛选，一个账号贯通 H5、小程序与 App。';
const TODAY = new Date().toISOString().slice(0, 10);

// ─── 通用工具 ──────────────────────────────────────────────────────────────
/** HTML 文本转义：快照正文全部走这里，避免商品标题里的尖括号破坏结构。 */
function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON-LD 序列化：转义 `<` 防止提前闭合 script 标签。 */
function jsonLd(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** 保证目录存在后写文件。 */
function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

/** 在预算内发起一次只读 GET；超时 / 非 2xx / 解析失败都返回 null，由调用方降级。 */
async function getJson(path, deadline) {
  if (OFFLINE || Date.now() > deadline) return null;
  const timeout = Math.min(6000, Math.max(800, deadline - Date.now()));
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body && typeof body === 'object' && 'data' in body ? body.data : null;
  } catch {
    return null;
  }
}

/** 商品图 → 站内相对 /media 地址；非站内图（外链、色值）返回空串。 */
function mediaPath(product) {
  const list = Array.isArray(product?.images) ? product.images : [];
  const first = list.find((item) => typeof item === 'string' && item.startsWith('/media/'));
  const raw = first || (typeof product?.cover === 'string' && product.cover.startsWith('/media/') ? product.cover : '');
  return raw || '';
}

/**
 * 站内媒体地址 → 可公开访问的绝对地址。
 * 传 size 时在扩展名前插入 `-480` / `-960`，命中服务端预生成的缩略图；
 * 缩略图缺失时 nginx 会回退原图，不会出现破图。
 */
function absoluteMedia(path, size) {
  if (!path) return '';
  const versioned = size ? path.replace(/\.([a-z0-9]+)$/i, `-${size}.$1`) : path;
  if (/^https?:\/\//i.test(versioned)) return versioned;
  return `${MEDIA_BASE}${versioned}`;
}

/** 截断描述，避免 meta / 快照正文过长。 */
function clip(text, max = 160) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// ─── HTML 头注入 ──────────────────────────────────────────────────────────
/** API 源的 origin：相对路径（同域反代部署）时取站点自身，避免 new URL 抛错。 */
const apiOrigin = (() => {
  try {
    return new URL(API_BASE).origin;
  } catch {
    return SITE_BASE;
  }
})();

/** 站点级 head 片段：构建期写入，保证不发 JS 也能拿到完整摘要。 */
function headTags({ title, description, canonical, ogType = 'website', ogImage = '', jsonLdBlocks = [] }) {
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<meta name="keywords" content="五金,标准件,螺丝,刀刃具,手工具,膨胀件,B2B采购,MixmAPP" />`,
    `<meta name="robots" content="index,follow,max-image-preview:large" />`,
    `<link rel="canonical" href="${esc(canonical)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(canonical)}" />`,
    `<meta property="og:type" content="${esc(ogType)}" />`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}" />`,
    `<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<link rel="preconnect" href="${esc(apiOrigin)}" crossorigin />`,
    `<link rel="dns-prefetch" href="${esc(apiOrigin)}" />`,
  ];
  if (MEDIA_BASE) {
    tags.push(`<link rel="preconnect" href="${esc(MEDIA_BASE)}" crossorigin />`);
    tags.push(`<link rel="dns-prefetch" href="${esc(MEDIA_BASE)}" />`);
  }
  if (ogImage) {
    tags.push(`<meta property="og:image" content="${esc(ogImage)}" />`);
    tags.push(`<meta name="twitter:image" content="${esc(ogImage)}" />`);
  }
  for (const block of jsonLdBlocks) {
    // 带 id 的静态结构化数据会在运行期被同 id 的 DOM 版本替换掉，
    // 避免同一页面出现两份 Product / Organization。
    const idAttr = block.id ? ` id="${esc(block.id)}"` : '';
    tags.push(`<script type="application/ld+json"${idAttr}>${jsonLd(block.data)}</script>`);
  }
  // 运行期基址：静态快照不走 root build-h5.mjs，必须自带，否则详情页会退回同源 /api/v1。
  tags.push(
    `<script>window.__MIXMAPP_API_BASE__=${JSON.stringify(RUNTIME_API_BASE)};</script>`,
  );
  if (MEDIA_BASE) {
    tags.push(`<script>window.__MIXMAPP_MEDIA_BASE__=${JSON.stringify(MEDIA_BASE)};</script>`);
  }
  return tags.join('\n    ');
}

/**
 * 把 head 片段写进 HTML 壳：
 * - 去掉壳里已有的 title / description / canonical / OG，避免出现两套互相矛盾的声明；
 * - 其余（theme-color、viewport、PWA 接线脚本）原样保留。
 */
function injectHead(html, tags) {
  const cleaned = html
    .replace(/<title>[\s\S]*?<\/title>\s*/gi, '')
    .replace(/<meta\s+name="description"[^>]*>\s*/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '')
    .replace(/<meta\s+property="og:[^"]*"[^>]*>\s*/gi, '')
    .replace(/<meta\s+name="twitter:[^"]*"[^>]*>\s*/gi, '');
  return cleaned.replace('</head>', `    ${tags}\n  </head>`);
}

/** 把静态正文塞进 #app；Vue 客户端挂载时会整体替换，不做 hydration，不会产生不匹配警告。 */
function injectSnapshot(html, snapshot) {
  if (!snapshot) return html;
  return html.replace('<div id="app"><!--app-html--></div>', `<div id="app">${snapshot}</div>`);
}

/** 静态快照的极简样式：只用品牌中性与现有页面同色，JS 接管前不出现突兀视觉。 */
const SNAPSHOT_CSS = `
.mx-seo-snap{max-width:960px;margin:0 auto;padding:20px 16px 32px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#15201d;background:#f7f8f7;line-height:1.6}
.mx-seo-snap a{color:#0f9d8f;text-decoration:none}
.mx-seo-snap h1{font-size:20px;line-height:1.35;margin:8px 0 12px}
.mx-seo-snap .mx-seo-crumb{font-size:12px;color:#6b7773;margin-bottom:8px}
.mx-seo-snap .mx-seo-hero{display:flex;gap:16px;align-items:flex-start}
.mx-seo-snap .mx-seo-hero img{width:160px;height:160px;object-fit:cover;border-radius:12px;background:#eef1ef}
.mx-seo-snap .mx-seo-sub{font-size:13px;color:#4a5652;margin:0 0 8px}
.mx-seo-snap table{border-collapse:collapse;font-size:13px;margin-top:12px;width:100%}
.mx-seo-snap td{border:1px solid #e3e8e6;padding:6px 10px}
.mx-seo-snap td:first-child{width:110px;color:#6b7773;background:#fafbfa}
.mx-seo-snap .mx-seo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:12px}
.mx-seo-snap .mx-seo-card{border:1px solid #e3e8e6;border-radius:12px;overflow:hidden;background:#fff}
.mx-seo-snap .mx-seo-card img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:#eef1ef}
.mx-seo-snap .mx-seo-card span{display:block;padding:8px;font-size:12px}
.mx-seo-snap .mx-seo-note{font-size:12px;color:#6b7773;margin-top:16px}
@media(max-width:600px){.mx-seo-snap .mx-seo-hero{flex-direction:column}.mx-seo-snap .mx-seo-hero img{width:100%;height:auto;aspect-ratio:1/1}}
`.trim();

// ─── 快照渲染 ──────────────────────────────────────────────────────────────
/** 商品卡片（列表类快照共用）：只给图与标题，不静态化价格（价格随登录态与实时价变化）。 */
function card(product) {
  const image = absoluteMedia(mediaPath(product), 480);
  return `<a class="mx-seo-card" href="/mall/detail/${esc(product.id)}">${
    image ? `<img src="${esc(image)}" alt="${esc(product.title || product.name || '')}" loading="lazy" decoding="async" />` : ''
  }<span>${esc(product.title || product.name || '')}</span></a>`;
}

/** 商品详情快照正文：标题、图、类目、规格与描述；价格区明确写「以下单时为准」。 */
function productSnapshot(product) {
  const title = product.title || product.name || '商品详情';
  const image = absoluteMedia(mediaPath(product), 960);
  const path = Array.isArray(product.categoryPath) ? product.categoryPath.filter(Boolean) : [];
  const specs = product.specs && typeof product.specs === 'object' ? Object.entries(product.specs) : [];
  const rows = specs
    .filter(([key, value]) => key && value && !/价格|price/i.test(key))
    .slice(0, 12)
    .map(([key, value]) => `<tr><td>${esc(key)}</td><td>${esc(value)}</td></tr>`)
    .join('');
  const desc = clip(product.description || product.subtitle || '', 400);
  return `<div class="mx-seo-snap">
  <div class="mx-seo-crumb"><a href="/">首页</a> / ${esc(path.join(' / ') || '商城')}</div>
  <div class="mx-seo-hero">
    ${image ? `<img src="${esc(image)}" alt="${esc(title)}" width="160" height="160" />` : ''}
    <div>
      <h1>${esc(title)}</h1>
      ${product.subtitle ? `<p class="mx-seo-sub">${esc(product.subtitle)}</p>` : ''}
      ${product.brand ? `<p class="mx-seo-sub">品牌：${esc(product.brand)}</p>` : ''}
      ${desc ? `<p class="mx-seo-sub">${esc(desc)}</p>` : ''}
      <p class="mx-seo-sub">价格与库存以下单时实时查询为准，支持询价与批量采购。</p>
    </div>
  </div>
  ${rows ? `<table>${rows}</table>` : ''}
  <p class="mx-seo-note"><a href="${esc(`${SITE_BASE}/mall`)}">进入商城查看全部商品</a></p>
</div>`;
}

/** 分类快照正文：分类名 + 前 20 件商品卡片。 */
function categorySnapshot(name, products) {
  return `<div class="mx-seo-snap">
  <div class="mx-seo-crumb"><a href="/">首页</a> / <a href="/mall">商城</a></div>
  <h1>${esc(name)}</h1>
  <p class="mx-seo-sub">该分类共 ${products.total ?? products.items.length} 件商品，以下为部分在售商品，价格与库存以页面实时数据为准。</p>
  <div class="mx-seo-grid">${products.items.map(card).join('')}</div>
  <p class="mx-seo-note"><a href="/mall">查看全部分类</a></p>
</div>`;
}

/** 商城首页快照正文：分类入口 + 前 20 件商品。 */
function mallSnapshot(categories, products) {
  return `<div class="mx-seo-snap">
  <div class="mx-seo-crumb"><a href="/">首页</a> / 商城</div>
  <h1>${esc(SITE_NAME)}</h1>
  <p class="mx-seo-sub">${esc(HOME_DESCRIPTION)}</p>
  <div class="mx-seo-grid">${categories
    .slice(0, 12)
    .map(
      (item) =>
        `<a class="mx-seo-card" href="/mall/category/${esc(item.code)}"><span>${esc(item.name)} · ${Number(
          item.count ?? 0,
        )} 件</span></a>`,
    )
    .join('')}</div>
  <h2>在售商品</h2>
  <div class="mx-seo-grid">${products.map(card).join('')}</div>
</div>`;
}

// ─── sitemap / robots ─────────────────────────────────────────────────────
/** 生成 sitemap：静态入口 + 分类 + 头部商品；URL 与运行期 canonical 完全同一口径。 */
function sitemapXml(categories, productIds) {
  const urls = [
    { loc: `${SITE_BASE}/`, changefreq: 'daily', priority: '1.0' },
    { loc: `${SITE_BASE}/mall`, changefreq: 'daily', priority: '0.9' },
    { loc: `${SITE_BASE}/privacy`, changefreq: 'monthly', priority: '0.3' },
  ];
  for (const item of categories) {
    urls.push({ loc: `${SITE_BASE}/mall/category/${esc(item.code)}`, changefreq: 'weekly', priority: '0.8' });
  }
  for (const id of productIds) {
    urls.push({ loc: `${SITE_BASE}/mall/detail/${esc(id)}`, changefreq: 'weekly', priority: '0.7' });
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (item) => `  <url>
    <loc>${item.loc}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>${item.changefreq}</changefreq>
    <priority>${item.priority}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>
`;
}

/** robots：放行内容页与图片，屏蔽接口、后台与交易类页面。 */
function robotsTxt() {
  return `User-agent: *
Allow: /
Disallow: /api/
Disallow: /mixmapp/api/
Disallow: /pages/admin/
Disallow: /pages/auth/
Disallow: /pages/cart/
Disallow: /pages/orders/
Disallow: /pages/me/

Sitemap: ${SITE_BASE}/sitemap.xml
`;
}

// ─── 主流程 ───────────────────────────────────────────────────────────────
const indexPath = join(DIST, 'index.html');
if (!existsSync(indexPath)) {
  console.error(`[seo] ✗ 找不到 H5 入口：${indexPath}（先跑 uni build h5）`);
  process.exit(1);
}

const shell = readFileSync(indexPath, 'utf8');
const deadline = Date.now() + FETCH_BUDGET_MS;

// 1) 单页壳：站点级 head
const siteHead = headTags({
  title: `${SITE_NAME} · 工业标准件 B2B 在线采购`,
  description: HOME_DESCRIPTION,
  canonical: `${SITE_BASE}/`,
  ogImage: '',
  jsonLdBlocks: [
    {
      id: 'mx-jsonld-static-org',
      data: {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: SITE_NAME,
        url: `${SITE_BASE}/`,
        description: HOME_DESCRIPTION,
      },
    },
    {
      id: 'mx-jsonld-static-website',
      data: {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SITE_NAME,
        url: `${SITE_BASE}/`,
        potentialAction: {
          '@type': 'SearchAction',
          target: `${SITE_BASE}/mall?keyword={query}`,
          'query-input': 'required name=query',
        },
      },
    },
  ],
});
const shellWithHead = injectHead(shell, `${siteHead}\n    <style>${SNAPSHOT_CSS}</style>`);
writeFile(indexPath, shellWithHead);

// 2) 联网采集公开目录数据（失败即降级，不阻断构建）
let categories = [];
let products = [];
if (!OFFLINE) {
  const cats = await getJson('/mall/categories', deadline);
  if (Array.isArray(cats)) {
    categories = cats
      .filter((item) => item && typeof item.code === 'string' && item.code)
      .map((item) => ({ code: item.code, name: String(item.name ?? item.code), count: Number(item.count ?? 0) }));
  }
  // 商品按创建时间倒序翻页；每页 100 条是服务端允许的上限。
  const pageSize = 100;
  const maxPages = Math.ceil(Math.max(SNAPSHOT_PRODUCTS, SITEMAP_PRODUCTS) / pageSize);
  for (let page = 1; page <= maxPages; page += 1) {
    if (Date.now() > deadline) break;
    const chunk = await getJson(`/mall/products?page=${page}&pageSize=${pageSize}&sort=createdDesc`, deadline);
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    products.push(...chunk);
    if (chunk.length < pageSize) break;
  }
}

// 3) 详情 / 分类 / 商城静态快照
let snapshotCount = 0;
const productSeoBlocks = new Map();
for (const product of products.slice(0, SNAPSHOT_PRODUCTS)) {
  const id = typeof product?.id === 'string' ? product.id : '';
  if (!id) continue;
  const title = product.title || product.name || '商品详情';
  const description = clip(product.description || product.subtitle || `查看 ${title} 的规格与采购信息。`);
  const image = absoluteMedia(mediaPath(product), 960);
  const canonical = `${SITE_BASE}/mall/detail/${encodeURIComponent(id)}`;
  const tags = headTags({
    title: `${title} · ${SITE_NAME}`,
    description,
    canonical,
    ogType: 'product',
    ogImage: image,
    jsonLdBlocks: [
      {
        id: 'mx-jsonld-static-product',
        data: {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: title,
          sku: id,
          description,
          ...(image ? { image: [image] } : {}),
          ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
          offers: {
            '@type': 'Offer',
            priceCurrency: 'CNY',
            availability: 'https://schema.org/InStock',
            url: canonical,
          },
        },
      },
    ],
  });
  writeFile(
    join(DIST, 'mall', 'detail', id, 'index.html'),
    injectSnapshot(injectHead(shell, `${tags}\n    <style>${SNAPSHOT_CSS}</style>`), productSnapshot(product)),
  );
  productSeoBlocks.set(id, true);
  snapshotCount += 1;
}

// 分类快照：每个一级分类取 20 件商品，接口失败就跳过该分类。
if (categories.length && !OFFLINE) {
  for (const item of categories.slice(0, 24)) {
    if (Date.now() > deadline) break;
    const list = await getJson(
      `/mall/products?category=${encodeURIComponent(item.code)}&page=1&pageSize=20&sort=createdDesc`,
      deadline,
    );
    if (!Array.isArray(list) || list.length === 0) continue;
    const canonical = `${SITE_BASE}/mall/category/${encodeURIComponent(item.code)}`;
    const tags = headTags({
      title: `${item.name} · ${SITE_NAME}`,
      description: `${item.name}分类共 ${item.count} 件五金商品，支持按规格、品牌筛选，价格与库存实时更新。`,
      canonical,
      jsonLdBlocks: [
        {
          id: 'mx-jsonld-static-collection',
          data: {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: `${item.name} · ${SITE_NAME}`,
            url: canonical,
          },
        },
      ],
    });
    writeFile(
      join(DIST, 'mall', 'category', item.code, 'index.html'),
      injectSnapshot(
        injectHead(shell, `${tags}\n    <style>${SNAPSHOT_CSS}</style>`),
        categorySnapshot(item.name, { items: list, total: item.count }),
      ),
    );
    snapshotCount += 1;
  }
}

// 商城首页快照：分类入口 + 头部在售商品。
if (products.length) {
  const tags = headTags({
    title: `商城 · 五金标准件在线采购 · ${SITE_NAME}`,
    description: HOME_DESCRIPTION,
    canonical: `${SITE_BASE}/mall`,
  });
  writeFile(
    join(DIST, 'mall', 'index.html'),
    injectSnapshot(
      injectHead(shell, `${tags}\n    <style>${SNAPSHOT_CSS}</style>`),
      mallSnapshot(categories, products.slice(0, 20)),
    ),
  );
  snapshotCount += 1;
}

// 4) robots 与 sitemap（商品 URL 取 sitemap 上限内的全部已采集商品）
const sitemapProductIds = products.slice(0, SITEMAP_PRODUCTS).map((item) => item?.id).filter(Boolean);
writeFile(join(DIST, 'robots.txt'), robotsTxt());
writeFile(join(DIST, 'sitemap.xml'), sitemapXml(categories, sitemapProductIds));

// 5) 汇总输出，供 CI 日志留存
const distBytes = (() => {
  let total = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += statSync(full).size;
    }
  };
  walk(DIST);
  return total;
})();

console.info('[seo] ✓ 构建期 SEO 完成');
console.info(`      站点：${SITE_BASE}`);
console.info(`      静态快照：${snapshotCount} 个（详情 ${productSeoBlocks.size} / 分类 ${Math.min(categories.length, 24)} / 商城 1）`);
console.info(`      sitemap：${sitemapProductIds.length} 个商品 URL + ${categories.length} 个分类 URL`);
console.info(`      H5 产物总大小：${(distBytes / 1024).toFixed(1)} KB`);
if (OFFLINE) console.info('      模式：--offline（未联网，仅输出站点级 SEO 与静态路由）');
