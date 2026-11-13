import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FILE = process.argv[2] || path.join(__dirname, '..', 'release', 'mixmapp-h5-single.html');
const PORT = Number(process.argv[3] || 8124);
const html = fs.readFileSync(FILE);

http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, bytes: html.length }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${FILE} on ${PORT}`));
