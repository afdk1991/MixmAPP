'use strict';

/**
 * MixmAPP API 中转云函数（HTTP 云函数 / WEB_SCF）
 *
 * 背景：cloud.mix.top 当前挂在 AWS Global Accelerator 上，国内网络 TLS 握手被拒
 * （unrecognized_name / alert 112），前端拿不到 /meta 就显示 OFFLINE。
 * 源站 nginx 与 API 本身健康（生产机内部 HTTPS 直连 /mixmapp/api/v1/meta 返回 200）。
 *
 * 本函数把请求原样转发到源站 IP，SNI 固定为 cloud.mix.top，Host 头固定为 cloud.mix.top，
 * 因此不依赖坏掉的加速节点与 DNS；对外通过 CloudBase 网关域名（国内可直连、证书有效）暴露。
 */

const https = require('https');

const ORIGIN_HOST = process.env.MIXMAPP_ORIGIN_HOST || '115.159.159.11';
const ORIGIN_PORT = Number(process.env.MIXMAPP_ORIGIN_PORT || 443);
const ORIGIN_SNI = process.env.MIXMAPP_ORIGIN_SNI || 'cloud.mix.top';
const ORIGIN_HOST_HEADER = process.env.MIXMAPP_ORIGIN_HOST_HEADER || 'cloud.mix.top';
const TIMEOUT_MS = Number(process.env.MIXMAPP_ORIGIN_TIMEOUT_MS || 15000);

const PASS_HEADERS = [
  'content-type',
  'accept',
  'authorization',
  'idempotency-key',
  'x-request-id',
  'x-mixmapp-client',
  'accept-language',
];

function corsHeaders(extra) {
  const base = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
    'access-control-allow-headers':
      'authorization,content-type,idempotency-key,x-request-id,x-mixmapp-client,accept,accept-language',
    'access-control-max-age': '86400',
    'cache-control': 'no-store',
  };
  return Object.assign(base, extra || {});
}

function buildQuery(event) {
  const raw =
    event.rawQueryString ||
    event.queryString ||
    (event.queryStringParameters
      ? Object.entries(event.queryStringParameters)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '');
  return raw ? `?${raw}` : '';
}

function forward(method, path, headers, body) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: ORIGIN_HOST,
        port: ORIGIN_PORT,
        servername: ORIGIN_SNI,
        rejectUnauthorized: false,
        method,
        path,
        headers,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 502,
            headers: corsHeaders({
              'content-type': res.headers['content-type'] || 'application/json; charset=utf-8',
            }),
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('upstream timeout')));
    req.on('error', (err) => {
      resolve({
        statusCode: 502,
        headers: corsHeaders({ 'content-type': 'application/json; charset=utf-8' }),
        body: JSON.stringify({
          error: { code: 'UPSTREAM_UNREACHABLE', message: err.message },
        }),
      });
    });
    if (body) req.write(body);
    req.end();
  });
}

exports.main = async (event) => {
  const method = (event.httpMethod || event.requestContext?.httpMethod || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  const path = event.path || event.rawPath || '/';
  if (!path.startsWith('/mixmapp')) {
    return {
      statusCode: 404,
      headers: corsHeaders({ 'content-type': 'application/json; charset=utf-8' }),
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'only /mixmapp is proxied' } }),
    };
  }

  const incoming = Object.assign({}, event.headers || {});
  const outHeaders = { host: ORIGIN_HOST_HEADER };
  for (const name of PASS_HEADERS) {
    const value = incoming[name] || incoming[name.toLowerCase()];
    if (value) outHeaders[name] = value;
  }

  const body = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';

  return forward(method, path + buildQuery(event), outHeaders, body);
};
