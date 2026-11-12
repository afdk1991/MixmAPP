// 本地预览：静态托管 H5 构建产物，并把 /api/* 反向代理到本地 API。
// 用法：node scripts/serve-h5.mjs   （H5_PORT=4173，API_ORIGIN=http://127.0.0.1:8080）
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.env.H5_DIR ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', 'apps/app/dist/build/h5'));
const PORT = Number(process.env.H5_PORT ?? 4173);
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:8080';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

/** 代理 /api 请求到后端，保留方法、请求头与原始 body。 */
function proxy(req, res) {
  // API_ORIGIN 可能带路径前缀（线上是 https://cloud.mixm.top/mixmapp），必须拼回去再转发
  const base = API_ORIGIN.replace(/\/+$/, '');
  const target = new URL(base + req.url);
  const upstream = request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: 'PROXY_FAILED', message: error.message } }));
  });
  req.pipe(upstream);
}

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  if (url.startsWith('/api/')) return proxy(req, res);

  const pathname = decodeURIComponent(url.split('?')[0]);
  let filePath = normalize(join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    // SPA 回退：hash 路由下未知路径统一回到 index.html
    filePath = join(ROOT, 'index.html');
  }
  if (!existsSync(filePath)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`H5 预览：http://127.0.0.1:${PORT}（API 代理 → ${API_ORIGIN}）`);
});
