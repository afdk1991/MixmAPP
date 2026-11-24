import { describe, expect, it } from 'vitest';
import { parseDeletionCascadeCounts } from '../src/db/postgres.js';

/**
 * 网关 jsonb 计数兼容层（不进生产库）：
 * 直连 PG 返回对象形态，CloudBase PG 网关可能把 jsonb 以 JSON 字符串回传。
 * 这里直接喂两种形态给适配层，断言计数解析正确；字段缺失 / 非法时回退 0 而不抛。
 */
describe('注销级联计数：网关 jsonb 字符串形态解析', () => {
  it('JSON 字符串形态：各计数字段正确解析', () => {
    const raw = JSON.stringify({
      binds: 2,
      devices: 1,
      addresses: 3,
      favorites: 0,
      carts: 4,
      pushTokens: 5,
      ordersAnonymized: 6,
      paymentsAnonymized: 7,
      revokedSessions: 8,
      mergeRecordsRedacted: 2,
    });
    const counts = parseDeletionCascadeCounts(raw);
    expect(counts).toEqual({
      binds: 2,
      devices: 1,
      addresses: 3,
      favorites: 0,
      carts: 4,
      pushTokens: 5,
      ordersAnonymized: 6,
      paymentsAnonymized: 7,
      revokedSessions: 8,
      mergeRecordsRedacted: 2,
    });
  });

  it('对象形态（直连 PG）同样解析正确', () => {
    const counts = parseDeletionCascadeCounts({
      binds: 9,
      devices: 2,
      addresses: 1,
      favorites: 4,
      carts: 3,
      pushTokens: 2,
      ordersAnonymized: 5,
      paymentsAnonymized: 4,
      revokedSessions: 6,
      mergeRecordsRedacted: 1,
    });
    expect(counts.binds).toBe(9);
    expect(counts.mergeRecordsRedacted).toBe(1);
  });

  it('数值字段缺失时回退 0，不抛错', () => {
    const counts = parseDeletionCascadeCounts({ binds: 3 });
    expect(counts).toEqual({
      binds: 3,
      devices: 0,
      addresses: 0,
      favorites: 0,
      carts: 0,
      pushTokens: 0,
      ordersAnonymized: 0,
      paymentsAnonymized: 0,
      revokedSessions: 0,
      mergeRecordsRedacted: 0,
    });
  });

  it('空对象 / null / undefined 全部回退 0', () => {
    for (const empty of [{}, null, undefined]) {
      const counts = parseDeletionCascadeCounts(empty);
      expect(Object.values(counts).every((v) => v === 0)).toBe(true);
    }
  });

  it('非法 JSON 字符串不抛错，计为全 0', () => {
    expect(() => parseDeletionCascadeCounts('not-a-json')).not.toThrow();
    const counts = parseDeletionCascadeCounts('not-a-json');
    expect(Object.values(counts).every((v) => v === 0)).toBe(true);
  });
});
