/**
 * 生成 uni-app tabBar 图标：4 组语义（房子 / 购物袋 / 购物车 / 人）× 2 态（常态灰 / 选中品牌青）。
 * 纯 Node 内置能力（zlib + 手写 PNG 编码 + 超采样抗锯齿），不引入任何第三方依赖。
 *
 * 运行：node scripts/gen-tab-icons.mjs
 * 产物：apps/app/src/static/tab/{home,mall,cart,me}[-active].png，81×81 透明底。
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'app',
  'src',
  'static',
  'tab',
);

const N = 81; // 逻辑像素（uni-app 建议 81×81）
const SS = 3; // 每个逻辑像素的超采样倍数，用于抗锯齿

const IDLE = [0x8a, 0x93, 0x8f]; // #8A938F 未选中灰
const ACTIVE = [0x0f, 0x9d, 0x8f]; // #0f9d8f 选中品牌青

/* ---------- 形状原语：返回 inside(px, py) 判定 ---------- */
function distToSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x0) * dx + (py - y0) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** 胶囊线段（圆头粗线） */
function capsule(x0, y0, x1, y1, w) {
  return (px, py) => distToSeg(px, py, x0, y0, x1, y1) <= w / 2;
}
/** 圆环（描边圆） */
function ring(cx, cy, r, w) {
  return (px, py) => Math.abs(Math.hypot(px - cx, py - cy) - r) <= w / 2;
}
/** 实心圆 */
function disc(cx, cy, r) {
  return (px, py) => Math.hypot(px - cx, py - cy) <= r;
}
/** 上半圆弧（数学坐标 y 向上，像素里 y 更小=更高），用若干胶囊线段近似 */
function arc(cx, cy, r, a0, a1, w, steps = 18) {
  const segs = [];
  for (let i = 0; i < steps; i += 1) {
    const t0 = a0 + ((a1 - a0) * i) / steps;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / steps;
    segs.push(
      capsule(
        cx + r * Math.cos(t0),
        cy - r * Math.sin(t0),
        cx + r * Math.cos(t1),
        cy - r * Math.sin(t1),
        w,
      ),
    );
  }
  return (px, py) => segs.some((f) => f(px, py));
}
function combine(...fns) {
  return (px, py) => fns.some((f) => f(px, py));
}

/* ---------- 4 个语义图形：坐标都在 81×81 内，两两形状明显不同 ---------- */
const SHAPES = {
  // 首页：屋顶三角 + 墙体 + 门
  home: combine(
    capsule(14, 40, 40, 18, 6),
    capsule(40, 18, 66, 40, 6),
    capsule(12, 40, 68, 40, 5),
    capsule(22, 42, 22, 66, 5),
    capsule(58, 42, 58, 66, 5),
    capsule(22, 66, 58, 66, 5),
    capsule(34, 66, 34, 52, 4.5),
    capsule(46, 66, 46, 52, 4.5),
    capsule(34, 52, 46, 52, 4.5),
  ),
  // 商城：购物袋（袋身 + 袋口 + 提手拱）
  mall: combine(
    capsule(20, 32, 20, 66, 5),
    capsule(60, 32, 60, 66, 5),
    capsule(20, 66, 60, 66, 5),
    capsule(20, 32, 60, 32, 4.5),
    arc(40, 32, 13, 0, Math.PI, 4.5),
  ),
  // 购物车：把手 + 拉杆 + 梯形车斗 + 两个轮子
  cart: combine(
    capsule(10, 16, 20, 20, 5),
    capsule(20, 20, 28, 54, 5),
    capsule(24, 28, 66, 28, 5),
    capsule(24, 28, 32, 50, 5),
    capsule(32, 50, 58, 50, 5),
    capsule(66, 28, 58, 50, 5),
    disc(36, 62, 5),
    disc(56, 62, 5),
  ),
  // 我的：头（圆环）+ 肩（上拱弧）+ 肩线
  me: combine(
    ring(40, 26, 12, 5.5),
    arc(40, 64, 22, 0, Math.PI, 5.5),
    capsule(18, 64, 62, 64, 5.5),
  ),
};

/* ---------- 最小 PNG 编码器（RGBA / 8bit / 无隔行） ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(inside, color) {
  // 逐逻辑像素做 SS×SS 超采样，coverage 作为 alpha，实现边缘抗锯齿
  const raw = Buffer.alloc(N * (1 + N * 4));
  for (let y = 0; y < N; y += 1) {
    const rowStart = y * (1 + N * 4);
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < N; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (inside(px, py)) hits += 1;
        }
      }
      const a = Math.round((hits / (SS * SS)) * 255);
      const o = rowStart + 1 + x * 4;
      raw[o] = color[0];
      raw[o + 1] = color[1];
      raw[o + 2] = color[2];
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0);
  ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 生成 + 自检 ---------- */
mkdirSync(OUT_DIR, { recursive: true });
const results = [];
for (const [name, inside] of Object.entries(SHAPES)) {
  for (const [suffix, color] of [
    ['', IDLE],
    ['-active', ACTIVE],
  ]) {
    const file = join(OUT_DIR, `${name}${suffix}.png`);
    const buf = encodePng(inside, color);
    writeFileSync(file, buf);
    // 回读校验：PNG 签名、IHDR 宽高、非空、sha1
    const back = readFileSync(file);
    const valid =
      back.length === buf.length &&
      back.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
      back.readUInt32BE(16) === N &&
      back.readUInt32BE(20) === N;
    results.push({
      file: `${name}${suffix}.png`,
      bytes: back.length,
      sha1: createHash('sha1').update(back).digest('hex').slice(0, 12),
      valid,
    });
  }
}
for (const r of results) {
  console.log(`${r.valid ? 'OK ' : 'BAD'} ${r.file.padEnd(18)} ${String(r.bytes).padStart(6)} B  sha1:${r.sha1}`);
}
if (results.some((r) => !r.valid)) {
  console.error('图标校验未通过');
  process.exit(1);
}
const hashes = new Set(results.map((r) => r.sha1));
if (hashes.size !== results.length) {
  console.error('存在完全相同的图标文件，形状/配色需区分');
  process.exit(1);
}
console.log(`完成：${results.length} 张图标，${hashes.size} 个不同 sha1，全部 81×81 有效 PNG`);
