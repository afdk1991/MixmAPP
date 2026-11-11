import { randomBytes } from 'node:crypto';
import { CROCKFORD, encodeBase32 } from './crockford.js';

/**
 * ULID：26 位 Crockford Base32，前 10 位毫秒时间（可排序），后 16 位随机数。
 * 无中心依赖，适合多端并发注册；比 UUID 短且字典序即时间序。
 */
const TIME_CHARS = 10;

export function ulid(now: () => number = Date.now): string {
  const ts = BigInt(now());
  if (ts >= 1n << 48n) throw new RangeError('ULID 时间戳超出 48 位');
  const time = encodeBase32(ts, TIME_CHARS);
  const rand = randomBytes(16); // 128 bit 随机，取 80 bit 编码
  let randBig = 0n;
  for (const byte of rand) randBig = (randBig << 8n) | BigInt(byte);
  randBig &= (1n << 80n) - 1n;
  return time + encodeBase32(randBig, 16);
}

export function isUlid(value: string): boolean {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)) return false;
  return true;
}

/** 取前 10 位还原时间，用于排序/排查。 */
export function ulidTime(value: string): number {
  if (!isUlid(value)) throw new TypeError('不是合法 ULID');
  let acc = 0n;
  for (const ch of value.slice(0, TIME_CHARS)) {
    const idx = CROCKFORD.indexOf(ch);
    if (idx < 0) throw new TypeError('ULID 含非法字符');
    acc = (acc << 5n) | BigInt(idx);
  }
  return Number(acc);
}
