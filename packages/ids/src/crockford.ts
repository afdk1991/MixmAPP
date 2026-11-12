/**
 * Crockford Base32 —— 用于对外可读 ID 的编码。
 * 字母表刻意去掉 I / L / O / U，避免手抄、口播时混淆。
 */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const LOOKUP = new Map<string, number>();
for (let i = 0; i < CROCKFORD.length; i += 1) LOOKUP.set(CROCKFORD[i] as string, i);
// 常见误读归一：I/L -> 1, O -> 0
LOOKUP.set('I', 1);
LOOKUP.set('L', 1);
LOOKUP.set('O', 0);

/** 把非负整数编码成 Crockford Base32；pad 指定最小长度。 */
export function encodeBase32(value: bigint, pad = 0): string {
  if (value < 0n) throw new RangeError('encodeBase32 只接受非负整数');
  if (value === 0n) return '0'.padStart(pad || 1, '0');
  let n = value;
  let out = '';
  while (n > 0n) {
    const idx = Number(n & 31n);
    out = (CROCKFORD[idx] as string) + out;
    n >>= 5n;
  }
  return out.padStart(pad, '0');
}

/** Crockford Base32 解码，自动归一大小写与易混字符。 */
export function decodeBase32(input: string): bigint {
  const clean = input.replace(/[-\s]/g, '').toUpperCase();
  if (!clean) throw new RangeError('decodeBase32 收到空字符串');
  let result = 0n;
  for (const ch of clean) {
    const v = LOOKUP.get(ch);
    if (v === undefined) throw new RangeError(`非法 Base32 字符: ${ch}`);
    result = (result << 5n) | BigInt(v);
  }
  return result;
}

/** 8 位分组，方便 UI 展示成 MixmAPP-7K2Q-4X9M。 */
export function groupDisplay(raw: string, size = 4, sep = '-'): string {
  const parts: string[] = [];
  for (let i = 0; i < raw.length; i += size) parts.push(raw.slice(i, i + size));
  return parts.join(sep);
}
