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
    description: '测试商品',
    sortNo: 1,
    createdAt: new Date('2026-11-12T00:00:00.000Z'),
    ...overrides,
  };
}

async function register(instance: FastifyInstance, phone: string): Promise<string> {
  const codeRes = await instance.inject({
    method: 'POST',
    url: '/api/v1/auth/sms/code',
    payload: { phone, purpose: 'register' },
  });
  expect(codeRes.statusCode).toBe(200);
  const code = codeRes.json().data.devCode as string;
  const res = await instance.inject({
    method: 'POST',
    url: '/api/v1/auth/register/phone',
    payload: { phone, code, nickname: '商城测试' },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.tokens.accessToken as string;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe('商城：商品 / 购物车 / 订单', () => {
  it('商品列表与详情公开可读，分类筛选生效', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(product({ id: 'mix-test-1', title: '限定礼盒', category: 'featured', sortNo: 1 }));
    await ctx.store.mall.products.insert(product({ id: 'mix-test-2', title: '氮化镓充电器', category: 'digital', sortNo: 2 }));

    const list = await app.inject({ method: 'GET', url: '/api/v1/mall/products' });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(2);

    const filtered = await app.inject({ method: 'GET', url: '/api/v1/mall/products?category=digital' });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().data.map((p: { id: string }) => p.id)).toEqual(['mix-test-2']);

    const detail = await app.inject({ method: 'GET', url: '/api/v1/mall/products/mix-test-1' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.title).toBe('限定礼盒');

    const missing = await app.inject({ method: 'GET', url: '/api/v1/mall/products/nope' });
    expect(missing.statusCode).toBe(404);
  });

  it('加购、改量、删除与库存上限校验', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(product({ id: 'mix-test-3', title: '金属徽章', stock: 3, priceFen: 3900 }));
    const token = await register(app, '13800002101');

    const unauthorized = await app.inject({ method: 'GET', url: '/api/v1/mall/cart' });
    expect(unauthorized.statusCode).toBe(401);

    const added = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/cart',
      headers: auth(token),
      payload: { productId: 'mix-test-3', quantity: 2 },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json().data.totalQuantity).toBe(2);
    expect(added.json().data.totalFen).toBe(7800);

    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/v1/mall/cart/mix-test-3',
      headers: auth(token),
      payload: { quantity: 3 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.totalFen).toBe(11700);

    const overStock = await app.inject({
      method: 'PATCH',
      url: '/api/v1/mall/cart/mix-test-3',
      headers: auth(token),
      payload: { quantity: 4 },
    });
    expect(overStock.statusCode).toBe(409);

    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/v1/mall/cart/mix-test-3',
      headers: auth(token),
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().data.items).toHaveLength(0);
  });

  it('用购物车下单会扣库存、清空购物车并生成可查订单', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(product({ id: 'mix-test-4', title: '托特包', stock: 5, priceFen: 9900 }));
    const token = await register(app, '13800002102');

    await app.inject({
      method: 'POST',
      url: '/api/v1/mall/cart',
      headers: auth(token),
      payload: { productId: 'mix-test-4', quantity: 2 },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/orders',
      headers: auth(token),
      payload: {
        receiverName: '张三',
        receiverPhone: '13800002102',
        address: '浙江省宁波市鄞州区测试路 1 号',
        remark: '工作日送',
      },
    });
    expect(created.statusCode).toBe(201);
    const order = created.json().data;
    expect(order.totalFen).toBe(19800);
    expect(order.status).toBe('pending');
    expect(order.items).toHaveLength(1);
    expect(order.orderNo).toMatch(/^MO/);

    const cartAfter = await app.inject({ method: 'GET', url: '/api/v1/mall/cart', headers: auth(token) });
    expect(cartAfter.json().data.items).toHaveLength(0);

    const stockLeft = await ctx.store.mall.products.findById('mix-test-4');
    expect(stockLeft?.stock).toBe(3);

    const orders = await app.inject({ method: 'GET', url: '/api/v1/mall/orders', headers: auth(token) });
    expect(orders.statusCode).toBe(200);
    expect(orders.json().data).toHaveLength(1);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/mall/orders/${order.orderNo}`,
      headers: auth(token),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.orderNo).toBe(order.orderNo);

    const otherUser = await app.inject({
      method: 'GET',
      url: `/api/v1/mall/orders/${order.orderNo}`,
      headers: auth(await register(app, '13800002103')),
    });
    expect(otherUser.statusCode).toBe(404);
  });

  it('库存不足时下单失败，且不产生订单', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(product({ id: 'mix-test-5', title: '冲锋衣', stock: 1, priceFen: 45900 }));
    const token = await register(app, '13800002104');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/orders',
      headers: auth(token),
      payload: {
        receiverName: '李四',
        receiverPhone: '13800002104',
        address: '浙江省宁波市海曙区另一条路 2 号',
        items: [{ productId: 'mix-test-5', quantity: 2 }],
      },
    });
    expect(res.statusCode).toBe(409);

    const orders = await app.inject({ method: 'GET', url: '/api/v1/mall/orders', headers: auth(token) });
    expect(orders.json().data).toHaveLength(0);
  });

  it('多行下单中途失败时，已扣的库存必须归还', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(product({ id: 'mix-rollback-a', title: '胸包', stock: 5, priceFen: 8900 }));
    await ctx.store.mall.products.insert(product({ id: 'mix-rollback-b', title: '水壶', stock: 1, priceFen: 3900 }));
    const token = await register(app, '13800002105');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/orders',
      headers: auth(token),
      payload: {
        receiverName: '王五',
        receiverPhone: '13800002105',
        address: '浙江省宁波市鄞州区某条路 3 号',
        // 第一行够扣、第二行不够 → 整单失败，第一行必须回滚
        items: [
          { productId: 'mix-rollback-a', quantity: 2 },
          { productId: 'mix-rollback-b', quantity: 2 },
        ],
      },
    });
    expect(res.statusCode).toBe(409);

    const a = await app.inject({ method: 'GET', url: '/api/v1/mall/products/mix-rollback-a' });
    const b = await app.inject({ method: 'GET', url: '/api/v1/mall/products/mix-rollback-b' });
    expect(a.json().data.stock).toBe(5);
    expect(b.json().data.stock).toBe(1);
  });
});

describe('下单幂等与超时取消', () => {
  it('同一 Idempotency-Key 重试只落一张订单，库存只扣一次', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(product({ id: 'mix-idem-1', title: '徽章', stock: 3, priceFen: 2900 }));
    const token = await register(app, '13800002106');
    const body = {
      receiverName: '赵六',
      receiverPhone: '13800002106',
      address: '浙江省宁波市江北区一条路 4 号',
      items: [{ productId: 'mix-idem-1', quantity: 1 }],
    };
    const headers = { ...auth(token), 'idempotency-key': 'req-abc-123' };

    const first = await app.inject({ method: 'POST', url: '/api/v1/mall/orders', headers, payload: body });
    const second = await app.inject({ method: 'POST', url: '/api/v1/mall/orders', headers, payload: body });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().data.orderNo).toBe(first.json().data.orderNo);

    const after = await app.inject({ method: 'GET', url: '/api/v1/mall/products/mix-idem-1' });
    expect(after.json().data.stock).toBe(2);

    const orders = await app.inject({ method: 'GET', url: '/api/v1/mall/orders', headers: auth(token) });
    expect(orders.json().data).toHaveLength(1);
  });

  it('不同 Idempotency-Key 是两笔独立订单', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(product({ id: 'mix-idem-2', title: '贴纸', stock: 5, priceFen: 1900 }));
    const token = await register(app, '13800002107');
    const body = {
      receiverName: '钱七',
      receiverPhone: '13800002107',
      address: '浙江省宁波市北仑区一条路 5 号',
      items: [{ productId: 'mix-idem-2', quantity: 1 }],
    };
    const a = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/orders',
      headers: { ...auth(token), 'idempotency-key': 'k1' },
      payload: body,
    });
    const b = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/orders',
      headers: { ...auth(token), 'idempotency-key': 'k2' },
      payload: body,
    });
    expect(a.json().data.orderNo).not.toBe(b.json().data.orderNo);
    const after = await app.inject({ method: 'GET', url: '/api/v1/mall/products/mix-idem-2' });
    expect(after.json().data.stock).toBe(3);
  });

  it('超时未支付订单被取消并把库存还回去', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(product({ id: 'mix-ttl-1', title: '帆布袋', stock: 2, priceFen: 5900 }));
    const token = await register(app, '13800002108');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/orders',
      headers: auth(token),
      payload: {
        receiverName: '孙八',
        receiverPhone: '13800002108',
        address: '浙江省宁波市镇海区一条路 6 号',
        items: [{ productId: 'mix-ttl-1', quantity: 2 }],
      },
    });
    expect(res.statusCode).toBe(201);
    const orderNo = res.json().data.orderNo as string;

    const stockAfterOrder = await app.inject({ method: 'GET', url: '/api/v1/mall/products/mix-ttl-1' });
    expect(stockAfterOrder.json().data.stock).toBe(0);

    const later = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const cancelled = await ctx.app.mall.sweepExpiredOrders(30, later);
    expect(cancelled).toContain(orderNo);

    const order = await app.inject({ method: 'GET', url: `/api/v1/mall/orders/${orderNo}`, headers: auth(token) });
    expect(order.json().data.status).toBe('cancelled');
    const stockRestored = await app.inject({ method: 'GET', url: '/api/v1/mall/products/mix-ttl-1' });
    expect(stockRestored.json().data.stock).toBe(2);
  });
});