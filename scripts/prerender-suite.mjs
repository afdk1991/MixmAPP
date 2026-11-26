#!/usr/bin/env node
/**
 * 业务套件静态页预渲染 + sitemap / robots 生成。
 *
 * 为什么需要它：
 * 这套内容更新频率低（季度级），但要求「极致速度 + SEO」。单页应用对搜索引擎并不友好：
 * 抓到的只是一个空壳，正文要等 JS 执行完才有。为了同时拿到「首屏零等待」和「可被完整索引」，
 * 这里在构建期把内容包渲染成一份**独立静态 HTML**：
 *
 *   - 不依赖任何 JS，双击即可读，内容在 <main> 里是完整语义化标签；
 *   - 带 title / description / canonical / OG / JSON-LD（WebPage + FAQPage + BreadcrumbList）；
 *   - 静态托管、CDN 边缘缓存直接命中，速度等同纯静态站；
 *   - 末尾给一个「打开互动版」入口，动态台账仍在 SPA 路由里。
 *
 * 内容只有一份真源：apps/app/src/content/suite/*.json。渲染脚本不引入第二套文案。
 *
 * 用法：
 *   node scripts/prerender-suite.mjs [--out <distDir>] [--origin https://example.com]
 * 默认输出到 apps/app/dist/build/h5，站点主域取 MIXMAPP_SITE_ORIGIN（默认 https://www.mixm.top）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------- 参数 ---------------- */

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const outDir = resolve(root, argValue('--out', join('apps', 'app', 'dist', 'build', 'h5')));
const origin = (process.env.MIXMAPP_SITE_ORIGIN || argValue('--origin', 'https://www.mixm.top')).replace(
  /\/+$/,
  '',
);
const contentDir = resolve(root, 'apps', 'app', 'src', 'content', 'suite');

/* ---------------- 内容读取 ---------------- */

/** 领域展示顺序与前端 routes.ts 保持一致。 */
const DOMAIN_ORDER = [
  'office',
  'productivity',
  'product',
  'engineering',
  'finance',
  'taxpay',
  'growth',
  'ecommerce',
  'content',
  'edu',
  'health',
  'legal',
  'lifestyle',
];

const packs = [];
for (const id of DOMAIN_ORDER) {
  const file = join(contentDir, `${id}.json`);
  if (!existsSync(file)) {
    console.error(`✗ 缺少内容包：${file}`);
    process.exit(1);
  }
  packs.push(JSON.parse(readFileSync(file, 'utf8')));
}

/* ---------------- HTML 工具 ---------------- */

/** HTML 转义：所有插入内容都要过这一层，内容包里可能含 & < > "。 */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 段落里的换行转 <br>，其余内容仍走 esc。 */
function escMultiline(value) {
  return esc(value).replace(/\n/g, '<br>');
}

function jsonLd(data) {
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

/* ---------------- 页面骨架 ---------------- */

/**
 * 静态页样式：直接用站点令牌值，不引外部 CSS（离线可读、单文件可缓存）。
 * 颜色与 apps/app/src/styles/theme.scss 的浅色档一致，深色由 prefers-color-scheme 处理。
 */
const CSS = `
:root{--paper:#f4f4f1;--paper2:#ebece7;--paper3:#dedfd8;--shell:#fff;--ink:#111413;--ink2:#333a37;--ink3:#6b736e;--ink4:#7d8681;--deep:#0b0f0e;--deep3:#1d2a26;--brand:#0a6e66;--brandsoft:#e2f1ee;--signal:#b3372a;--radius:16px}
@media (prefers-color-scheme:dark){:root{--paper:#121716;--paper2:#1b211f;--paper3:#2b3330;--shell:#171d1b;--ink:#eceee9;--ink2:#c9cfca;--ink3:#a2aaa5;--ink4:#868e89;--deep:#080b0a;--deep3:#16201d;--brand:#6fe3d4;--brandsoft:#12312c}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','HarmonyOS Sans SC','Microsoft YaHei',sans-serif;line-height:1.7;-webkit-text-size-adjust:100%}
.wrap{max-width:820px;margin:0 auto;padding:0 20px 64px}
a{color:var(--brand)}
.hero{padding:40px 20px 44px;background:linear-gradient(160deg,var(--deep) 0%,var(--deep3) 100%);color:#f4f4f1}
.hero .wrap{padding-bottom:0}
.eyebrow{font-family:'SF Mono',Consolas,monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8fe9dd}
h1{margin:10px 0 12px;font-size:34px;line-height:1.2;font-weight:800;letter-spacing:-.02em}
.lead{margin:16px 0 0;font-size:17px;color:rgba(244,244,241,.78)}
.points{margin:24px 0 0;padding:0;list-style:none;display:grid;gap:8px}
.points li{padding:12px 16px;border-radius:12px;background:rgba(244,244,241,.08);font-size:15px}
section{padding:32px 0 0}
h2{margin:0 0 12px;font-size:24px;font-weight:800;letter-spacing:-.01em}
h3{margin:0 0 6px;font-size:19px;font-weight:800}
p{margin:0 0 12px;color:var(--ink2);font-size:16px}
ul.bullets{margin:0 0 12px;padding:0;list-style:none;display:grid;gap:8px}
ul.bullets li{position:relative;padding-left:18px;color:var(--ink2);font-size:15px}
ul.bullets li::before{content:'';position:absolute;left:0;top:11px;width:6px;height:6px;background:var(--brand)}
.hl{display:grid;gap:12px;margin-top:28px}
.hl div{padding:18px 20px;border:1px solid var(--paper3);border-radius:var(--radius);background:var(--shell)}
.hl b{display:block;font-size:17px;margin-bottom:4px}
.hl span{color:var(--ink3);font-size:15px}
.entry{margin-top:16px;padding:20px;border:1px solid var(--paper3);border-radius:var(--radius);background:var(--shell)}
.entry .tags{margin-bottom:8px;display:flex;flex-wrap:wrap;gap:6px}
.entry .tags span{padding:3px 10px;border-radius:8px;background:var(--brandsoft);color:var(--brand);font-size:12px;font-family:'SF Mono',Consolas,monospace}
.meta{margin:12px 0 0;padding:12px 16px;border-radius:12px;background:var(--paper2);display:grid;gap:4px}
.meta div{display:flex;justify-content:space-between;gap:16px;font-size:13px}
.meta b{font-weight:400;color:var(--ink4);font-family:'SF Mono',Consolas,monospace}
.meta span{color:var(--ink2);text-align:right}
.check{margin:12px 0 0;padding:0;list-style:none;display:grid;gap:8px}
.check li{position:relative;padding-left:24px;color:var(--ink2);font-size:15px}
.check li::before{content:'';position:absolute;left:0;top:6px;width:14px;height:14px;border:2px solid var(--paper3);border-radius:4px}
.note{margin:12px 0 0;padding:10px 14px;border-radius:12px;background:rgba(138,90,16,.12);color:var(--ink2);font-size:14px}
.faq{margin-top:28px;border-top:1px solid var(--paper3)}
.faq details{border-bottom:1px solid var(--paper3);padding:14px 0}
.faq summary{cursor:pointer;font-size:16px;font-weight:600;list-style:none}
.faq summary::-webkit-details-marker{display:none}
.faq summary::before{content:'＋ ';color:var(--brand)}
.faq details[open] summary::before{content:'－ '}
.faq p{margin:8px 0 0;font-size:15px}
.cta{margin-top:40px;padding:24px;border-radius:var(--radius);background:var(--shell);border:1px solid var(--paper3);text-align:center}
.cta a{display:inline-block;padding:12px 22px;border-radius:12px;background:var(--brand);color:#fff;text-decoration:none;font-weight:600}
.foot{margin-top:36px;padding-top:16px;border-top:1px solid var(--paper3);color:var(--ink4);font-size:12px;text-align:center}
nav.crumbs{padding:16px 0 0;font-size:13px;color:var(--ink4)}
nav.crumbs a{color:var(--ink3)}
`.trim();

/**
 * 渲染一个领域的静态页。
 * @param pack 内容包
 * @param interactivePath 互动版 SPA 路由
 */
function renderDomain(pack, interactivePath) {
  const title = `${pack.title} · MixmAPP 业务套件`;
  const description = pack.tagline;
  const canonical = `${origin}/suite/${pack.id}/`;

  const highlights = pack.highlights
    .map((h) => `<div><b>${esc(h.title)}</b><span>${esc(h.detail)}</span></div>`)
    .join('');

  const sections = pack.sections
    .map(
      (s) => `<section id="${esc(s.id)}">
      <h2>${esc(s.title)}</h2>
      <p>${escMultiline(s.body)}</p>
      ${
        s.bullets && s.bullets.length
          ? `<ul class="bullets">${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
          : ''
      }
    </section>`,
    )
    .join('\n');

  const entries = pack.entries
    .map(
      (e) => `<article class="entry">
      ${e.tags && e.tags.length ? `<div class="tags">${e.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      <h3>${esc(e.title)}</h3>
      <p>${escMultiline(e.summary)}</p>
      ${
        e.meta && e.meta.length
          ? `<div class="meta">${e.meta
              .map((m) => `<div><b>${esc(m.label)}</b><span>${esc(m.value)}</span></div>`)
              .join('')}</div>`
          : ''
      }
      ${
        e.checklist && e.checklist.length
          ? `<ul class="check">${e.checklist.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
          : ''
      }
      ${e.note ? `<p class="note">${esc(e.note)}</p>` : ''}
    </article>`,
    )
    .join('\n');

  const faq = pack.faq
    .map(
      (f) =>
        `<details><summary>${esc(f.q)}</summary><p>${escMultiline(f.a)}</p></details>`,
    )
    .join('');

  const faqLd =
    pack.faq.length > 0
      ? jsonLd({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: pack.faq.map((f) => ({
            '@type': 'Question',
            name: f.q,
            acceptedAnswer: { '@type': 'Answer', text: f.a },
          })),
        })
      : '';

  const pageLd = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url: canonical,
    inLanguage: 'zh-CN',
    dateModified: pack.updatedAt,
    isPartOf: { '@type': 'WebSite', name: 'MixmAPP', url: origin },
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: '首页', item: `${origin}/` },
        { '@type': 'ListItem', position: 2, name: '业务套件', item: `${origin}/suite/` },
        { '@type': 'ListItem', position: 3, name: pack.title, item: canonical },
      ],
    },
  });

  const itemListLd =
    pack.entries.length > 0
      ? jsonLd({
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: `${pack.title}条目`,
            itemListElement: pack.entries.map((e, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: e.title,
            description: e.summary,
          })),
        })
      : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="keywords" content="MixmAPP,${esc(pack.title)},${esc(pack.category)},业务套件">
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MixmAPP">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:locale" content="zh_CN">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<link rel="icon" href="/static/favicon.png">
<style>${CSS}</style>
${pageLd}
${faqLd}
${itemListLd}
</head>
<body>
<header class="hero">
  <div class="wrap">
    <p class="eyebrow">${esc(pack.category)}</p>
    <h1>${esc(pack.title)}</h1>
    <p class="lead">${esc(pack.tagline)}</p>
    <ul class="points">${pack.hero.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
  </div>
</header>
<main class="wrap">
  <nav class="crumbs"><a href="/">首页</a> / <a href="/suite/">业务套件</a> / ${esc(pack.title)}</nav>
  <p style="margin-top:20px;font-size:16px;color:var(--ink2)">${esc(pack.hero.lead)}</p>
  <div class="hl">${highlights}</div>
  ${sections}
  ${entries ? `<section id="entries"><h2>条目与清单</h2>${entries}</section>` : ''}
  ${faq ? `<section class="faq" id="faq"><h2>常见问题</h2>${faq}</section>` : ''}
  <div class="cta">
    <p>以上是静态说明。需要记录进度、留存台账或与他人协作，请使用互动版。</p>
    <a href="${esc(interactivePath)}">打开${esc(pack.title)}互动版 →</a>
  </div>
  <p class="foot">内容更新于 ${esc(pack.updatedAt)} · MixmAPP 业务套件</p>
</main>
</body>
</html>
`;
}

/** 渲染套件中心静态页。 */
function renderHub(list) {
  const title = '业务套件 · MixmAPP 13 个领域';
  const description =
    'MixmAPP 业务套件：办公管理、效率工具、产品研发、工程、金融、财税支付、营销增长、电商、内容创作、教育科研、医疗医药、法律政务、生活休闲，每个领域都是静态说明加动态台账。';
  const canonical = `${origin}/suite/`;

  const groups = new Map();
  for (const pack of list) {
    const bucket = groups.get(pack.category) ?? [];
    bucket.push(pack);
    groups.set(pack.category, bucket);
  }

  const body = Array.from(groups, ([category, items]) => {
    const cards = items
      .map(
        (p) => `<article class="entry">
        <h3><a href="/suite/${esc(p.id)}/">${esc(p.title)}</a></h3>
        <p>${esc(p.tagline)}</p>
        <p class="note">${p.entries.length} 个条目 · ${p.sections.length} 个章节 · 更新于 ${esc(p.updatedAt)}</p>
      </article>`,
      )
      .join('\n');
    return `<section><h2>${esc(category)}</h2>${cards}</section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="keywords" content="MixmAPP,业务套件,办公管理,金融,电商,内容创作,教育科研,医疗医药,法律政务">
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="index,follow">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:locale" content="zh_CN">
<link rel="icon" href="/static/favicon.png">
<style>${CSS}</style>
${jsonLd({
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: title,
  description,
  url: canonical,
  inLanguage: 'zh-CN',
  isPartOf: { '@type': 'WebSite', name: 'MixmAPP', url: origin },
  mainEntity: {
    '@type': 'ItemList',
    itemListElement: list.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: p.title,
      description: p.tagline,
      url: `${origin}/suite/${p.id}/`,
    })),
  },
})}
</head>
<body>
<header class="hero">
  <div class="wrap">
    <p class="eyebrow">MIXMAPP · ${list.length} 个领域</p>
    <h1>一个账号，一套业务能力</h1>
    <p class="lead">${esc(description)}</p>
    <ul class="points">
      <li>每个领域的说明页是独立静态 HTML：零等待、可被完整索引</li>
      <li>互动版在同一路由下提供进度、台账与协作</li>
      <li>数据按账号隔离，注销即清除</li>
    </ul>
  </div>
</header>
<main class="wrap">
  <nav class="crumbs"><a href="/">首页</a> / 业务套件</nav>
  ${body}
  <div class="cta">
    <p>需要记录进度、留存台账或与他人协作？</p>
    <a href="/pages/suite/index">打开业务套件互动版 →</a>
  </div>
  <p class="foot">MixmAPP 业务套件</p>
</main>
</body>
</html>
`;
}

/* ---------------- sitemap / robots ---------------- */

function buildSitemap() {
  const urls = [
    { loc: `${origin}/`, priority: '1.0', changefreq: 'weekly' },
    { loc: `${origin}/suite/`, priority: '0.9', changefreq: 'monthly' },
    ...packs.map((p) => ({
      loc: `${origin}/suite/${p.id}/`,
      priority: '0.8',
      changefreq: 'monthly',
      lastmod: p.updatedAt,
    })),
  ];
  const body = urls
    .map(
      (u) => `  <url>
    <loc>${esc(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${esc(u.lastmod)}</lastmod>` : ''}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

function buildRobots() {
  return `User-agent: *
Allow: /

# 后台与接口不需要被索引
Disallow: /pages/admin/
Disallow: /api/

Sitemap: ${origin}/sitemap.xml
`;
}

/* ---------------- 写出 ---------------- */

if (!existsSync(outDir)) {
  console.error(`✗ 找不到 H5 产物目录：${outDir}`);
  console.error('  请先执行 pnpm build:h5，再跑本脚本。');
  process.exit(1);
}

let written = 0;
for (const pack of packs) {
  const dir = join(outDir, 'suite', pack.id);
  mkdirSync(dir, { recursive: true });
  const html = renderDomain(pack, `/pages/suite/${pack.id}`);
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  written += 1;
}

const hubDir = join(outDir, 'suite');
mkdirSync(hubDir, { recursive: true });
writeFileSync(join(hubDir, 'index.html'), renderHub(packs), 'utf8');

writeFileSync(join(outDir, 'sitemap.xml'), buildSitemap(), 'utf8');
writeFileSync(join(outDir, 'robots.txt'), buildRobots(), 'utf8');

console.info(`[seo] 已预渲染 ${written} 个领域静态页 + 套件中心页`);
console.info(`[seo] 已写出 sitemap.xml / robots.txt → ${outDir}`);
console.info(`[seo] 站点主域：${origin}`);
