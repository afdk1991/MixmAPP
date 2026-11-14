/**
 * 源站 HTTP 客户端：CSRF 握手、限频、重试、图片下载。
 *
 * 所有出网请求都从这里走，采集逻辑不得自己发请求——限频与重试只有一处。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 图片变体 → 角色。第一张是封面，spec 是规格图。 */
export const IMAGE_VARIANTS = [
  { variant: 'img1_l', role: 'cover' },
  { variant: 'img1_m', role: 'gallery' },
  { variant: 'img2_s', role: 'gallery' },
  { variant: 'img3_s', role: 'gallery' },
  { variant: 'img4_s', role: 'gallery' },
  { variant: 'spec', role: 'spec' },
];

function magicExt(buffer) {
  if (buffer.length < 4) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'webp';
  return null;
}

/** 1×1 占位图（PNG 头里宽高都是 1）直接丢弃，不落盘也不入库。 */
function isPlaceholder(buffer) {
  if (buffer.length < 200) return true;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return buffer.readUInt32BE(16) <= 1 && buffer.readUInt32BE(20) <= 1;
  }
  return false;
}

/**
 * @param {ReturnType<import('./config.mjs').loadConfig>} cfg
 * @param {(msg: string) => void} log
 */
export function createClient(cfg, log) {
  const origin = new URL(cfg.baseUrl);
  const transport = origin.protocol === 'http:' ? http : https;
  const SVR = '/b2b-svr';
  const UPLOAD = '/b2b/static/uploads';

  let token = null;
  let cookie = null;
  let lastAt = 0;

  /** 串行的最小间隔限流：并发调用也会排队，不会突破 delay。 */
  async function paced(delayMs) {
    if (delayMs <= 0) return;
    const now = Date.now();
    const wait = Math.max(0, delayMs - (now - lastAt));
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
  }

  function request(method, requestPath, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = transport.request(
        {
          host: origin.hostname,
          port: origin.port || (origin.protocol === 'http:' ? 80 : 443),
          path: requestPath,
          method,
          headers,
        },
        (res) => {
          const chunks = [];
          res.on('data', (d) => chunks.push(d));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        }
      );
      req.setTimeout(cfg.timeoutMs, () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end();
    });
  }

  function mergeCookie(res) {
    const list = res.headers['set-cookie'];
    if (!list) return;
    const jar = new Map(
      (cookie || '')
        .split('; ')
        .filter(Boolean)
        .map((c) => [c.split('=')[0], c])
    );
    for (const c of list) {
      const kv = c.split(';')[0];
      jar.set(kv.split('=')[0], kv);
    }
    cookie = [...jar.values()].join('; ');
  }

  async function handshake() {
    await paced(cfg.listDelayMs);
    const res = await request('GET', `${SVR}/csrf`, {
      'User-Agent': UA,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Referer: `${origin.origin}/b2b/`,
    });
    token = res.headers['el-result-code'] || null;
    mergeCookie(res);
    if (!token) throw new Error('csrf 握手未返回 el-result-code');
  }

  function headers(referer) {
    const h = {
      'User-Agent': UA,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: referer || `${origin.origin}/b2b/`,
    };
    if (token) h['el-xsrf'] = token;
    if (cookie) h.Cookie = cookie;
    return h;
  }

  /** 单次 GET JSON；401/403/404 视为 token 过期，自动重新握手后重试。 */
  async function getJson(requestPath, referer, delayMs = cfg.listDelayMs) {
    let lastErr = '';
    for (let attempt = 0; attempt <= cfg.maxRetries; attempt += 1) {
      await paced(delayMs);
      try {
        const res = await request('GET', requestPath, headers(referer));
        if (res.status === 200) {
          const text = res.body.toString('utf8');
          return text ? JSON.parse(text) : {};
        }
        lastErr = `HTTP ${res.status}`;
        if (res.status === 401 || res.status === 403 || res.status === 404) await handshake();
        else if (res.status === 429 || res.status >= 500) await sleep(1500 * (attempt + 1));
        else break;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        await sleep(800 * (attempt + 1));
      }
    }
    throw new Error(`GET ${requestPath} 失败：${lastErr}`);
  }

  /** 下载图片，按内容 SHA1 命名落盘（同图天然去重）。不可达/占位图返回 null。 */
  async function downloadImage(remotePath, role) {
    if (!cfg.downloadImages) return null;
    for (let attempt = 0; attempt <= cfg.maxRetries; attempt += 1) {
      await paced(cfg.listDelayMs);
      try {
        const res = await request('GET', remotePath, headers(`${origin.origin}/b2b/`));
        if (res.status === 200 && res.body.length > 0) {
          if (isPlaceholder(res.body)) {
            log(`[image] 占位图丢弃 ${remotePath}`);
            return null;
          }
          const ext = magicExt(res.body);
          if (!ext) {
            log(`[image] 魔数无法识别 ${remotePath}`);
            return null;
          }
          const file = `${crypto.createHash('sha1').update(res.body).digest('hex')}.${ext}`;
          const dest = path.join(cfg.imageDir, file);
          if (!fs.existsSync(dest)) fs.writeFileSync(dest, res.body);
          return { file, url: `/media/products/${file}`, role, remote: remotePath };
        }
        if (res.status === 404) return null;
        await sleep(1000 * (attempt + 1));
      } catch {
        await sleep(800 * (attempt + 1));
      }
    }
    return null;
  }

  /** 类目画廊：6 个固定变体，失败不影响主流程。 */
  async function galleryForC3(c3) {
    if (!cfg.downloadImages) return [];
    const entries = [];
    for (const item of IMAGE_VARIANTS) {
      const got = await downloadImage(`${UPLOAD}/item/c3/${c3}/${item.variant}`, item.role);
      if (got) entries.push(got);
    }
    return entries;
  }

  return {
    origin: origin.origin,
    SVR,
    getJson,
    handshake,
    downloadImage,
    galleryForC3,
    imageVariants: IMAGE_VARIANTS,
  };
}

/** 极简并发池：每个 worker 顺序消费队列，配合 paced 形成全局限流。 */
export async function mapPool(list, concurrency, fn) {
  const width = Math.max(1, Math.min(concurrency, list.length || 1));
  let cursor = 0;
  const workers = Array.from({ length: width }, async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= list.length) return;
      await fn(list[idx], idx);
    }
  });
  await Promise.all(workers);
}
