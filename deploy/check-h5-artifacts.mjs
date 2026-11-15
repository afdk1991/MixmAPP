#!/usr/bin/env node
/**
 * H5 产物抽检（CI 与本地共用）。
 *
 * 背景：旧实现用 `grep -rE '([0-9]+\.){3}[0-9]+'` 一把扫四段数字，
 * 把兜底逻辑里合法的 127.0.0.1 / 192.168.x 也判成泄漏，导致发布被误拦。
 * 现在按地址语义判定，只拦真正可疑的东西：
 *
 * 允许出现在产物里的（兜底逻辑本来就需要）：
 *   回环 127.0.0.0/8、私有 10/8、172.16/12、192.168/16、
 *   链路本地 169.254/16、CGNAT 100.64/10、0.0.0.0、255.255.255.255、::1
 *
 * 仍然拦截：
 *   1) 其余四段数字（真实公网 IP 硬编码）
 *   2) URL 里的内部服务域名（.internal/.local/.lan/.corp/.intranet/.home.arpa、svc.cluster.local）
 *   3) 私钥块、常见平台 token 前缀
 *   4) 形如 password/token/secret = 'xxxx' 的疑似硬编码口令
 *   5) 预览残留字样（0.0.0-preview / 0.0.0-dev / 单码多端预览版）
 *   6) API 基址指向已失效域名 cloud.mix.top
 *
 * 必需项：产物内置绝对基址 https://api.mixm.top/mixmapp/api/v1 与 https://img.mixm.top
 *
 * 用法：node deploy/check-h5-artifacts.mjs apps/app/dist/build/h5
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2] ?? 'apps/app/dist/build/h5';

const OCTET = '(\\d{1,3})';
const IPV4 = new RegExp(`\\b${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}\\b`, 'g');

/** 兜底逻辑里合法的本机 / 内网地址：不算泄漏。 */
const isLocalAddress = (a, b, c, d) => {
  if ([a, b, c, d].some((n) => n > 255)) return true; // 不是合法 IPv4（如版本号 1.2.3.400），交给预览残留规则
  if (a === 127) return true; // 回环
  if (a === 10) return true; // 私有 A
  if (a === 172 && b >= 16 && b <= 31) return true; // 私有 B
  if (a === 192 && b === 168) return true; // 私有 C
  if (a === 169 && b === 254) return true; // 链路本地
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 0 && b === 0 && c === 0 && d === 0) return true; // 未指定
  if (a === 255 && b === 255 && c === 255 && d === 255) return true; // 广播
  if (a === 0) return true; // 0.0.0.0/8 本网络
  return false;
};

/** 每条规则：命中即失败。 */
const FORBIDDEN = [
  {
    id: 'public-ip',
    label: '公网 IP 硬编码',
    test: (text) => {
      const hits = [];
      for (const m of text.matchAll(IPV4)) {
        const [a, b, c, d] = m.slice(1).map(Number);
        if (!isLocalAddress(a, b, c, d)) hits.push(m[0]);
      }
      return hits;
    },
  },
  {
    id: 'internal-host',
    label: '内部服务域名',
    test: (text) => [
      ...text.matchAll(/:\/\/[^\s"'`/\\]*\.(?:internal|local|lan|corp|intranet|home\.arpa)\b/gi),
      ...text.matchAll(/\bsvc\.cluster\.local\b/gi),
    ].map((m) => m[0]),
  },
  {
    id: 'private-key',
    label: '私钥块',
    test: (text) => [...text.matchAll(/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g)].map((m) => m[0]),
  },
  {
    id: 'token-prefix',
    label: '平台 token 前缀',
    test: (text) =>
      [
        ...text.matchAll(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g),
        ...text.matchAll(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g),
        ...text.matchAll(/\bAKIA[0-9A-Z]{16}\b/g),
        ...text.matchAll(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g),
        ...text.matchAll(/\bsk-[A-Za-z0-9_-]{20,}\b/g),
      ].map((m) => m[0]),
  },
  {
    id: 'hardcoded-secret',
    label: '疑似硬编码口令',
    test: (text) =>
      [
        ...text.matchAll(
          /\b(?:password|passwd|secret|api[_-]?key|access[_-]?key|admin[_-]?token|auth[_-]?token|client[_-]?secret)\b["'`]?\s*[:=]\s*["'`]([A-Za-z0-9+/=_-]{12,})["'`]/gi,
        ),
      ].map((m) => m[0]),
  },
  {
    id: 'preview-residue',
    label: '预览残留',
    test: (text) => [
      ...text.matchAll(/0\.0\.0-(?:preview|dev)/g),
      ...text.matchAll(/单码多端预览版/g),
    ].map((m) => m[0]),
  },
  {
    id: 'dead-domain',
    label: '已失效域名',
    test: (text) => [...text.matchAll(/cloud\.mix\.top\/mixmapp/g)].map((m) => m[0]),
  },
];

/** 必须内置的绝对基址 / 媒体源。 */
const REQUIRED = [
  { id: 'api-base', label: 'API 基址', needle: 'https://api.mixm.top/mixmapp/api/v1' },
  { id: 'media-base', label: '媒体源', needle: 'https://img.mixm.top' },
];

const walk = (dir, acc = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
};

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

let files;
try {
  files = walk(root);
} catch {
  console.error(`✗ 缺少 H5 产物目录 ${root}`);
  process.exit(1);
}

const violations = [];
const seenRequired = new Set();
let scanned = 0;

for (const file of files) {
  const buf = readFileSync(file);
  // 二进制（图片 / 字体）跳过：里面不会有可读的地址与凭据。
  if (buf.includes(0)) continue;
  const text = buf.toString('utf8');
  scanned += 1;

  for (const rule of FORBIDDEN) {
    for (const hit of rule.test(text)) {
      violations.push({ rule, file, line: 0, hit });
    }
  }
  for (const req of REQUIRED) {
    if (text.includes(req.needle)) seenRequired.add(req.id);
  }
}

// 逐条输出前先重算行号，避免规则实现里重复扫描大文件。
const detail = violations.map((v) => {
  const text = readFileSync(v.file).toString('utf8');
  const idx = text.indexOf(v.hit);
  return { ...v, line: idx >= 0 ? lineOf(text, idx) : 0 };
});

if (detail.length > 0) {
  console.error(`✗ H5 产物抽检发现 ${detail.length} 处可疑内容：`);
  for (const v of detail.slice(0, 40)) {
    const rel = relative(process.cwd(), v.file).replace(/\\/g, '/');
    const snippet = v.hit.length > 120 ? `${v.hit.slice(0, 117)}...` : v.hit;
    console.error(`  - [${v.rule.label}] ${rel}:${v.line}  ${snippet}`);
  }
  if (detail.length > 40) console.error(`  ... 其余 ${detail.length - 40} 处省略`);
  process.exit(1);
}

for (const req of REQUIRED) {
  if (!seenRequired.has(req.id)) {
    console.error(`✗ H5 产物未内置${req.label} ${req.needle}`);
    process.exit(1);
  }
}

console.info(
  `✓ H5 产物抽检通过（${scanned} 个文本文件：无公网 IP / 无内部服务域名 / 无凭据 / 无预览残留 / 基址 api.mixm.top / 媒体 img.mixm.top）`,
);
