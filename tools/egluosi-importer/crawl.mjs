#!/usr/bin/env node
/**
 * egluosi B2B 目录站抓取脚本（抓取端，产物只写入 source/）。
 *
 * 用法：
 *   node crawl.mjs              # 全量抓取
 *   node crawl.mjs --limit 20  # 小样本：最多导入 20 条商品
 *   node crawl.mjs --c3 001     # 仅抓某个三级分类（调试用）
 *
 * 口径见 ./CONTRACT.md，接口事实见 ./source/api-notes.md。
 * 仅抓取匿名可见的目录与面价；不绕过登录、不读取登录凭据；请求间隔 >=400ms，并发 <=2。
 */
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = path.join(__dirname, "source");
const IMAGES_DIR = path.join(SOURCE_DIR, "images");

const HOST = "eg.egluosi.com";
const PAGE_ORIGIN = `https://${HOST}`;
const SVR_PREFIX = "/b2b-svr";
const UPLOAD_PREFIX = "/b2b/static/uploads";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DELAY_MS = 400;
const PAGE_SIZE = 200;
const MAX_RETRIES = 3;

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
const LIMIT = Number(argValue("--limit") || 0);
const ONLY_C3 = argValue("--c3");

// 一级分类稳定短码（与 categories[].code 对应）
const C1_CODE = {
  "001": "egm-screw",
  "002": "eg-screw",
  "003": "auto-screw",
  "004": "hand-tool",
  "005": "expansion",
  "006": "cutting-tool",
};

// 分类级画廊变体：第一张为封面，其余画廊
const IMAGE_VARIANTS = [
  { variant: "img1_l", role: "cover" },
  { variant: "img1_m", role: "gallery" },
  { variant: "img2_s", role: "gallery" },
  { variant: "img3_s", role: "gallery" },
  { variant: "img4_s", role: "gallery" },
  { variant: "spec", role: "gallery" },
];

let csrfToken = null;
let csrfCookie = null;
let lastRequestAt = 0;

const errors = [];
const skipped = [];
const failed = [];
const imageCache = new Map(); // remote -> { staged, role }
const galleryCache = new Map(); // c3 -> IMAGE_VARIANTS mapped entries

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function recordError(url, reason) {
  errors.push({ url, reason });
}

async function paced() {
  const now = Date.now();
  const wait = Math.max(0, DELAY_MS - (now - lastRequestAt));
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function handshake() {
  await paced();
  const res = await rawRequest("GET", `${SVR_PREFIX}/csrf`, { referer: `${PAGE_ORIGIN}/b2b/` });
  csrfToken = res.headers["el-result-code"] || null;
  const setCookie = res.headers["set-cookie"] || [];
  csrfCookie = setCookie.map((c) => c.split(";")[0]).join("; ") || null;
  if (!csrfToken) throw new Error("csrf 握手未返回 el-result-code");
}

function rawRequest(method, requestPath, { referer, retries = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": UA,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    };
    if (referer) headers.Referer = referer;
    if (csrfToken) headers["el-xsrf"] = csrfToken;
    if (csrfCookie) headers.Cookie = csrfCookie;

    const req = https.request(
      { host: HOST, port: 443, path: requestPath, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function getJSON(requestPath, referer) {
  let attempt = 0;
  let lastErr = null;
  while (attempt <= MAX_RETRIES) {
    await paced();
    const res = await rawRequest("GET", requestPath, { referer });
    if (res.status === 200) {
      const text = res.body.toString("utf8");
      if (!text) return {};
      return JSON.parse(text);
    }
    lastErr = `HTTP ${res.status}`;
    if (res.status === 404 && attempt === 0 && csrfToken) {
      // token 可能过期，刷新握手后重试一次
      await handshake();
      attempt += 1;
      continue;
    }
    if (res.status === 429 || res.status === 403) {
      await sleep(2000 * (attempt + 1));
      attempt += 1;
      continue;
    }
    break;
  }
  recordError(`${PAGE_ORIGIN}${requestPath}`, lastErr || "请求失败");
  throw new Error(`GET ${requestPath} 失败：${lastErr}`);
}

function magicExt(buffer) {
  if (buffer.length < 4) return null;
  const b = buffer;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return "webp";
  return null;
}

function isPlaceholder(buffer) {
  if (buffer.length < 200) return true;
  // PNG IHDR: width/height at bytes 16..23
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    const w = buffer.readUInt32BE(16);
    const h = buffer.readUInt32BE(20);
    return w <= 1 && h <= 1;
  }
  return false;
}

async function downloadImage(remoteUrl, role) {
  const cached = imageCache.get(remoteUrl);
  if (cached) return cached;

  let staged = null;
  let attempt = 0;
  let ok = false;
  while (attempt <= MAX_RETRIES && !ok) {
    await paced();
    try {
      const res = await rawRequest("GET", new URL(remoteUrl).pathname, {
        referer: `${PAGE_ORIGIN}/b2b/`,
      });
      if (res.status === 200 && res.body.length > 0) {
        if (isPlaceholder(res.body)) {
          recordError(remoteUrl, "返回 1×1 占位图或空图，未落盘");
          break;
        }
        const ext = magicExt(res.body);
        if (ext) {
          const sha1 = crypto.createHash("sha1").update(res.body).digest("hex");
          const fileName = `${sha1}.${ext}`;
          const filePath = path.join(IMAGES_DIR, fileName);
          if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, res.body);
          staged = `images/${fileName}`;
          ok = true;
        } else {
          recordError(remoteUrl, "图片魔数无法识别扩展名");
          break;
        }
      } else if (res.status === 404) {
        recordError(remoteUrl, "图片 404 或变体不存在");
        break;
      } else {
        attempt += 1;
        await sleep(1000 * attempt);
      }
    } catch (e) {
      recordError(remoteUrl, e instanceof Error ? e.message : String(e));
      attempt += 1;
    }
  }

  const entry = { remote: remoteUrl, staged, role };
  imageCache.set(remoteUrl, entry);
  return entry;
}

async function galleryForC3(c3) {
  if (galleryCache.has(c3)) return galleryCache.get(c3);
  const entries = [];
  for (const item of IMAGE_VARIANTS) {
    const remote = `${PAGE_ORIGIN}${UPLOAD_PREFIX}/item/c3/${c3}/${item.variant}`;
    const entry = await downloadImage(remote, item.role);
    entries.push(entry);
  }
  galleryCache.set(c3, entries);
  return entries;
}

function normalizeBrand(rawBrand, name) {
  const cleaned = (rawBrand || "").replace(/牌\s*$/, "").trim();
  const gradeLike = /^(DIN|GB|ANSI|ISO|JIS|BS|AS|UN|UNF|UNC|S2|CR-V|ASP|ML|SCM|40Cr|35#|45#)/i;
  if (cleaned && !gradeLike.test(cleaned)) {
    const upper = cleaned.toUpperCase();
    if (upper === "EGM") return "EGM";
    if (upper === "EG") return "EG";
    return cleaned;
  }
  const prefixes = ["OSG", "UTOOL", "U-POWER", "ET", "MH", "SKC", "PCC", "EGM", "EG"];
  for (const p of prefixes) {
    if (name && name.toUpperCase().startsWith(p)) return p;
  }
  return "其他";
}

function nonEmpty(...values) {
  return values.map((v) => (v === null || v === undefined ? "" : String(v).trim())).filter(Boolean);
}

function buildProduct(row, category) {
  const no = row.no;
  const code = row.code ? String(row.code) : null;
  const detailUrl = `${PAGE_ORIGIN}/b2b/mall/item?itemNo=${encodeURIComponent(no)}`;
  const rawName = String(row.name || "");
  const spec = row.spec ? String(row.spec) : "";
  const brand = normalizeBrand(row.brand, rawName);

  if (!rawName) {
    skipped.push({ sourceUrl: detailUrl, reason: "商品名为空，按兜底规则仍无法拼装" });
    return null;
  }
  if (!no) {
    failed.push({ sourceUrl: detailUrl, reason: "缺少 itemNo，无法构造详情链接" });
    return null;
  }

  const skipBrandPrefix =
    brand === "其他" || rawName.toUpperCase().startsWith(brand.toUpperCase());
  const nameParts = skipBrandPrefix ? nonEmpty(rawName, spec) : nonEmpty(brand, rawName, spec);
  const name = nameParts.join(" ");
  const subtitle = nonEmpty(spec, row.grade, row.material, row.treat, row.teeth, row.std).join(" · ");

  const specs = {};
  const specMap = [
    ["规格", spec],
    ["标准", row.std && row.std !== "无" ? row.std : ""],
    ["等级", row.grade],
    ["材质", row.material],
    ["牙别", row.teeth],
    ["表面处理", row.treat],
    ["包装", row.convsDesc],
    ["库存状态", row.invStatusDesc],
  ];
  for (const [k, v] of specMap) {
    const val = v === null || v === undefined ? "" : String(v).trim();
    if (val) specs[k] = val;
  }
  const listPrice = Number(row.basePrcD3N2);
  if (Number.isFinite(listPrice) && listPrice > 0) {
    specs["千支面价(元/千支)"] = String(listPrice);
  }
  if (Number.isFinite(Number(row.disD2N2)) && Number(row.disD2N2) > 0) {
    specs["折扣(%)"] = String(row.disD2N2);
  }

  const units = Array.isArray(row.units) ? row.units : [];
  const eaUnit = units.find((u) => u.code === "EA");
  const primaryUnit = eaUnit || units[0];
  const unit = primaryUnit ? primaryUnit.name : "";
  let packQty = null;
  if (primaryUnit && primaryUnit.code !== "EA") {
    const conv = Number(row.convs?.[primaryUnit.code]);
    if (Number.isFinite(conv)) packQty = conv;
  }

  let priceFen = null;
  let priceSource = "inquiry";
  if (Number.isFinite(listPrice) && listPrice > 0) {
    priceFen = Math.round(listPrice / 10); // 元/千支 -> 分/支
    priceSource = "anonymous";
  }

  const descriptionLines = nonEmpty(
    `品名：${rawName}`,
    row.std ? `标准：${row.std}` : "",
    row.material ? `材质：${row.material}` : "",
    row.grade ? `等级：${row.grade}` : "",
    row.teeth ? `牙别：${row.teeth}` : "",
    row.treat ? `表面处理：${row.treat}` : "",
    row.convsDesc ? `包装：${row.convsDesc}` : "",
    code ? `项目号：${code}` : "",
    row.invStatusDesc ? `库存状态：${row.invStatusDesc}` : ""
  );

  return {
    sourceKey: code ? `sku:${code}` : `url:${detailUrl}`,
    sourceId: code,
    sourceUrl: detailUrl,
    name,
    subtitle: subtitle || `${brand} ${category.path[category.path.length - 1]}`.trim(),
    brand,
    categoryPath: category.path,
    categoryCode: category.code,
    specs,
    unit,
    packQty,
    priceFen,
    priceSource,
    priceCapturedAt: new Date().toISOString(),
    stock: 0,
    stockSource: "unknown",
    images: [],
    description: descriptionLines.join("\n"),
    rawName,
  };
}

function flattenTree(nodes, trail, c1Meta, leaves) {
  for (const node of nodes || []) {
    const ctg = node.ctg || {};
    const nextTrail = [...trail, ctg.name].filter(Boolean);
    if (Array.isArray(node.subs) && node.subs.length > 0) {
      flattenTree(node.subs, nextTrail, c1Meta, leaves);
    } else {
      leaves.push({
        code: c1Meta.code,
        c1: c1Meta,
        leafValue: ctg.value,
        path: nextTrail,
      });
    }
  }
}

async function main() {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  await handshake();
  console.info("[egluosi] 握手完成，拉取分类树");

  const tree = await getJSON(`${SVR_PREFIX}/api/ctg/ccc`, `${PAGE_ORIGIN}/b2b/`);
  const roots = Array.isArray(tree) ? tree : tree.main || [];

  const categories = [];
  const leaves = [];
  for (const root of roots) {
    const c1Ctg = root.ctg || {};
    const c1Meta = {
      code: C1_CODE[c1Ctg.value] || `c1-${c1Ctg.value}`,
      name: c1Ctg.name,
      siteValue: c1Ctg.value,
      path: [c1Ctg.name],
    };
    categories.push(c1Meta);
    flattenTree(root.subs || [], [c1Ctg.name], c1Meta, leaves);
  }

  const targetLeaves = ONLY_C3 ? leaves.filter((l) => l.leafValue === ONLY_C3) : leaves;
  console.info(`[egluosi] 一级 ${categories.length} 个，三级叶子 ${targetLeaves.length} 个`);

  const products = [];
  const perCategory = [];
  let scanned = 0;
  let imagesOk = 0;
  let imagesFailed = 0;

  for (const leaf of targetLeaves) {
    if (LIMIT > 0 && products.length >= LIMIT) break;

    const c3 = leaf.leafValue;
    const referer = `${PAGE_ORIGIN}/b2b/mall/ctg_items?c3=${encodeURIComponent(c3)}`;
    const rows = [];
    let siteCount = 0;
    let offset = 0;
    let pageFailed = false;

    while (true) {
      let page;
      try {
        page = await getJSON(
          `${SVR_PREFIX}/api/mall/ccc_items?c3=${encodeURIComponent(c3)}&offset=${offset}&limit=${PAGE_SIZE}`,
          referer
        );
      } catch (e) {
        pageFailed = true;
        recordError(referer, e instanceof Error ? e.message : String(e));
        break;
      }
      const pageRows = Array.isArray(page.rows) ? page.rows : [];
      siteCount = Number(page.total) || pageRows.length;
      rows.push(...pageRows);
      offset += pageRows.length;
      if (pageRows.length === 0 || rows.length >= siteCount) break;
    }

    scanned += siteCount;
    const diff = siteCount - rows.length;
    perCategory.push({
      path: leaf.path,
      siteCount,
      crawled: rows.length,
      diff,
    });
    if (pageFailed) {
      failed.push({ sourceUrl: referer, reason: "列表分页请求失败，见 errors" });
    } else if (diff > 0) {
      skipped.push({ sourceUrl: referer, reason: `分类差额 ${diff} 条（站点 ${siteCount} / 实抓 ${rows.length}）` });
    }

    let gallery = [];
    if (rows.length > 0) {
      try {
        gallery = await galleryForC3(c3);
        for (const img of gallery) {
          if (img.staged) imagesOk += 1;
          else imagesFailed += 1;
        }
      } catch (e) {
        recordError(referer, `分类画廊失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }

    for (const row of rows) {
      if (LIMIT > 0 && products.length >= LIMIT) break;
      const product = buildProduct(row, leaf);
      if (!product) continue;
      product.images = gallery.map((g) => ({ remote: g.remote, staged: g.staged, role: g.role }));
      products.push(product);
    }
    console.info(`[egluosi] ${leaf.path.join(" / ")}：站点 ${siteCount}，实抓 ${rows.length}`);
  }

  // 去重保护：同一 sourceKey 只保留一条
  const seenKeys = new Set();
  const uniqueProducts = [];
  for (const p of products) {
    if (seenKeys.has(p.sourceKey)) {
      skipped.push({ sourceUrl: p.sourceUrl, reason: `sourceKey 重复：${p.sourceKey}` });
      continue;
    }
    seenKeys.add(p.sourceKey);
    uniqueProducts.push(p);
  }

  const loginGatedCount = uniqueProducts.filter((p) => p.priceSource === "inquiry").length;
  const pricePolicy = uniqueProducts.some((p) => p.priceSource === "anonymous") ? "anonymous" : "inquiry";

  // 清理未被任何商品引用的残留图片（空分类画廊、历史样本遗留）
  const referencedImages = new Set();
  for (const p of uniqueProducts) {
    for (const img of p.images) if (img.staged) referencedImages.add(path.basename(img.staged));
  }
  if (fs.existsSync(IMAGES_DIR)) {
    for (const file of fs.readdirSync(IMAGES_DIR)) {
      if (!referencedImages.has(file)) fs.rmSync(path.join(IMAGES_DIR, file), { force: true });
    }
  }

  const catalog = {
    meta: {
      source: `${PAGE_ORIGIN}/b2b/`,
      crawledAt: new Date().toISOString(),
      pricePolicy,
      totalScanned: scanned,
      totalImported: uniqueProducts.length,
    },
    categories,
    products: uniqueProducts,
    skipped,
    failed,
  };

  const report = {
    meta: {
      source: `${PAGE_ORIGIN}/b2b/`,
      crawledAt: catalog.meta.crawledAt,
      pricePolicy,
      compliance: "商品图与文案版权归原站，本批数据仅作内部选品/报价底稿；对外展示必须带来源与抓取时间戳；未绕过登录、未做高频请求。",
    },
    counts: {
      scanned,
      imported: uniqueProducts.length,
      skipped: skipped.length,
      failed: failed.length,
      imagesOk: referencedImages.size,
      imagesFailed: errors.filter((e) => /图片/.test(e.reason)).length,
    },
    perCategory: perCategory.map((c) => ({ path: c.path, count: c.crawled, siteCount: c.siteCount, diff: c.diff })),
    pricePolicy: {
      overall: pricePolicy,
      anonymousVisible: "千支面价（元/千支）与折扣率匿名可见；priceFen 为按面价换算的分/支",
      loginGated: "折后千支价、需求支数、真实库存数量需登录后可见，本批未抓取",
      loginGatedCount,
    },
    loginGatedCount,
    errors,
  };

  fs.writeFileSync(path.join(SOURCE_DIR, "catalog.json"), JSON.stringify(catalog, null, 2), "utf8");
  fs.writeFileSync(path.join(SOURCE_DIR, "crawl-report.json"), JSON.stringify(report, null, 2), "utf8");

  const imageErrorCount = errors.filter((e) => /图片/.test(e.reason)).length;
  console.info(
    `[egluosi] 完成：扫描 ${scanned}，导入 ${uniqueProducts.length}，跳过 ${skipped.length}，失败 ${failed.length}，图片落盘 ${referencedImages.size}，缺失变体 ${imageErrorCount}`
  );
}

main().catch((e) => {
  console.error("[egluosi] 抓取终止：", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
