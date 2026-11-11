import { randomBytes } from 'node:crypto';

/**
 * UUIDv7：48 位毫秒时间 + 版本位 7 + 12 位 rand_a + 变体位 + 62 位 rand_b。
 * 时间有序、标准格式，适合对外 API 互操作。
 */
export function uuidv7(now: () => number = Date.now): string {
  const ts = BigInt(now());
  if (ts >= 1n << 48n) throw new RangeError('UUIDv7 时间戳超出 48 位');

  const buf = randomBytes(8);
  let random = 0n;
  for (const byte of buf) random = (random << 8n) | BigInt(byte);
  random &= (1n << 62n) - 1n;

  const randA = random >> 50n; // 12 bit
  const variantBits = (random >> 48n) & 0x3n; // 2 bit，变体位固定前缀 10
  const randB = random & ((1n << 48n) - 1n); // 48 bit
  const g4low = (random >> 36n) & 0xfffn; // 12 bit

  const timeHex = ts.toString(16).padStart(12, '0');
  const g1 = timeHex.slice(0, 8);
  const g2 = timeHex.slice(8, 12);
  const g3 = `7${randA.toString(16).padStart(3, '0')}`;
  const variant = (0x8n | variantBits).toString(16);
  const g4 = `${variant}${g4low.toString(16).padStart(3, '0')}`;
  const g5 = randB.toString(16).padStart(12, '0');
  return `${g1}-${g2}-${g3}-${g4}-${g5}`;
}

export function isUuidV7(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
