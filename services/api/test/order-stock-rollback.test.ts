import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ProductRecord } from '../src/db/types.js';
import { makeApp } from './helpers.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function product(overrides: Partial<ProductRecord> & Pick<ProductRecord, 'id' | 'title'>): ProductRecord {
  return {
    subtitle: '',
    priceFen: 1000,
    originalPriceFen: 0,
    stock: 10,
    category: 'featured',
    cover: '#0f9d8f',
    images: [],
    tags: [],
    description: '回滚测试商品',
    sortNo: 1,
    createdAt: new Date('2026-11-12T00:00:00.000Z'),
    ...overrides,
  };
}

async function register(phone: string): Promise<string> {
  const codeRes = await app!.inject({
    method: 'POST',
    url: '/api/v1/auth/sms/code',
    payload: { phone, purpose: 'register' },
  });
  expect(codeRes.statusCode).toBe(200);
  const code = codeRes.json().data.devCode as string;
  const res = await app!.inject({
    method: 'POST',
    url: '/api/v1/auth/register/phone',
    payload: { phone, code, nickname: '回滚测试' },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.tokens.accessToken as string;
}

describe('下单：订单落库失败时已扣库存必须归还', () => {
  it('orders.insert 抛错后库存恢复到下单前，不发生库存泄漏', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(product({ id: 'rollback-p-1', title: '回滚商品', stock: 10, priceFen: 3900 }));
    const token = await register('13800003101');

    const cart = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/cart',
      headers: { authorization: `Bearer ${token}` },
      payload: { productId: 'rollback-p-1', quantity: 2 },
    });
    expect(cart.statusCode).toBe(200);

    // 模拟订单持久化阶段数据库故障：库存已扣，订单写入失败。
    (ctx.store.mall.orders as unknown as { insert: unknown }).insert = async () => {
      throw new Error('db down: order insert failed');
    };

    const order = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/orders',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        fromCart: true,
        receiverName: '回滚测试',
        receiverPhone: '13800003101',
        address: '浙江省宁波市测试地址',
      },
    });
    expect(order.statusCode).toBeGreaterThanOrEqual(500);

    const after = await ctx.store.mall.products.findById('rollback-p-1');
    expect(after?.stock).toBe(10);
  });
});
