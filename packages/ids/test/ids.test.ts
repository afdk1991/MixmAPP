import { describe, expect, it } from 'vitest';
import {
  IdFactory,
  Snowflake,
  decodeBase32,
  encodeBase32,
  isUlid,
  isUuidV7,
  ulid,
  ulidTime,
  uuidv7,
} from '../src/index.js';

describe('Crockford Base32', () => {
  it('编码后再解码应还原', () => {
    const values = [0n, 1n, 31n, 32n, 1234567890123456789n];
    for (const v of values) {
      expect(decodeBase32(encodeBase32(v))).toBe(v);
    }
  });

  it('容忍易混字符 I/L/O 与大小写', () => {
    expect(decodeBase32('O1I')).toBe(decodeBase32('011'));
    expect(decodeBase32('abc')).toBe(decodeBase32('ABC'));
  });
});

describe('Snowflake', () => {
  it('单调递增且不重复', () => {
    const sf = new Snowflake({ workerId: 7 });
    let prev = -1n;
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = sf.next();
      expect(id > prev).toBe(true);
      prev = id;
      const key = id.toString();
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('可反解出机器号与时间', () => {
    const now = Date.UTC(2026, 10, 12, 10, 0, 0);
    const sf = new Snowflake({ workerId: 42, now: () => now });
    const parsed = sf.parse(sf.next());
    expect(parsed.workerId).toBe(42);
    expect(parsed.timestamp).toBe(now);
  });

  it('时钟回拨仍保持单调', () => {
    let t = Date.UTC(2026, 10, 12, 10, 0, 0);
    const sf = new Snowflake({ workerId: 1, now: () => t });
    const a = sf.next();
    t -= 5000;
    const b = sf.next();
    expect(b > a).toBe(true);
  });

  it('workerId 越界应报错', () => {
    expect(() => new Snowflake({ workerId: 1024 })).toThrow(RangeError);
  });
});

describe('ULID / UUIDv7', () => {
  it('ULID 长度 26 且字典序随时间递增', () => {
    const a = ulid(() => 1_700_000_000_000);
    const b = ulid(() => 1_700_000_001_000);
    expect(a).toHaveLength(26);
    expect(isUlid(a)).toBe(true);
    expect(a < b).toBe(true);
    expect(ulidTime(a)).toBe(1_700_000_000_000);
  });

  it('UUIDv7 符合 v7 规范且时间前缀单调', () => {
    const a = uuidv7(() => 1_700_000_000_000);
    const b = uuidv7(() => 1_700_000_001_000);
    expect(isUuidV7(a)).toBe(true);
    expect(a < b).toBe(true);
  });
});

describe('IdFactory', () => {
  it('一次产出主键/雪花/账号号段/ULID/UUIDv7', () => {
    const f = new IdFactory({ strategy: 'snowflake', workerId: 3 });
    const ids = f.next();
    expect(ids.id).toBe(ids.snowflake);
    expect(ids.accountNo).toMatch(/^MIX-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]$/);
    expect(isUlid(ids.ulid)).toBe(true);
    expect(isUuidV7(ids.uuidV7)).toBe(true);
  });

  it('accountNo 在 10 万次发号内唯一', () => {
    const f = new IdFactory({ workerId: 5 });
    const set = new Set<string>();
    for (let i = 0; i < 100_000; i += 1) set.add(f.next().accountNo);
    expect(set.size).toBe(100_000);
  });

  it('按策略切换主键形态', () => {
    const ulidFactory = new IdFactory({ strategy: 'ulid' });
    expect(isUlid(ulidFactory.next().id)).toBe(true);
    const uuidFactory = new IdFactory({ strategy: 'uuidv7' });
    expect(isUuidV7(uuidFactory.next().id)).toBe(true);
  });
});
