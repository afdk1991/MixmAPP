import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ProductRecord } from '../src/db/types.js';
import { MallService } from '../src/modules/mall.js';
import { makeApp, testConfig } from './helpers.js';

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

  it('每页条数只接受 20/50/100，默认 20', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    for (let i = 1; i <= 3; i += 1) {
      await ctx.store.mall.products.insert(product({ id: `ps-${i}`, title: `分页商品 ${i}`, sortNo: i }));
    }

    // 默认 20：3 条全部返回
    const def = await app.inject({ method: 'GET', url: '/api/v1/mall/products' });
    expect(def.statusCode).toBe(200);
    expect(def.json().data).toHaveLength(3);

    // 100 档合法，且一次取回全部
    const max = await app.inject({ method: 'GET', url: '/api/v1/mall/products?pageSize=100' });
    expect(max.statusCode).toBe(200);
    expect(max.json().data).toHaveLength(3);

    // 白名单之外的档位直接 422（30 / 101 / 0）；校验错误沿用全局约定的 422
    for (const bad of ['30', '101', '0']) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/mall/products?pageSize=${bad}` });
      expect(res.statusCode).toBe(422);
    }
  });

  it('9 维筛选：ctgs 多选 OR，trts（牙别）多选 OR 且与其它维度 AND', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(
      product({ id: 'dim-1', title: '全牙螺丝', category: 'featured', specs: { 牙别: '全牙', 表面处理: '发黑' } }),
    );
    await ctx.store.mall.products.insert(
      product({ id: 'dim-2', title: '半牙螺丝', category: 'featured', specs: { 牙别: '半牙', 表面处理: '发黑' } }),
    );
    await ctx.store.mall.products.insert(
      product({ id: 'dim-3', title: '全牙丝锥', category: 'digital', specs: { 牙别: '全牙', 表面处理: '镀锌' } }),
    );

    const ids = async (qs: string) => {
      const res = await app!.inject({ method: 'GET', url: `/api/v1/mall/products?${qs}` });
      expect(res.statusCode).toBe(200);
      return (res.json().data as Array<{ id: string }>).map((p) => p.id).sort();
    };

    // ctgs：分类树节点多选，多值 OR（c1:featured / c1:digital）
    expect(await ids('ctgs=c1:featured')).toEqual(['dim-1', 'dim-2']);
    expect(await ids('ctgs=c1:featured,c1:digital')).toEqual(['dim-1', 'dim-2', 'dim-3']);
    // trts：牙别多选，多值 OR
    expect(await ids(`trts=${encodeURIComponent('半牙')}`)).toEqual(['dim-2']);
    expect(await ids(`trts=${encodeURIComponent('全牙,半牙')}`)).toEqual(['dim-1', 'dim-2', 'dim-3']);
    // 维度之间 AND：全牙 + 镀锌只命中丝锥；分类 + 牙别叠加同样收敛
    expect(await ids(`trts=${encodeURIComponent('全牙')}&ttt=${encodeURIComponent('镀锌')}`)).toEqual(['dim-3']);
    expect(await ids(`ctgs=c1:featured&trts=${encodeURIComponent('全牙')}`)).toEqual(['dim-1']);
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

  it('分类聚合按全量统计，不被分页 list 上限截断', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(product({ id: 'mix-cat-1', title: '螺丝甲', category: 'eg-screw' }));
    await ctx.store.mall.products.insert(product({ id: 'mix-cat-2', title: '螺丝乙', category: 'eg-screw' }));
    await ctx.store.mall.products.insert(product({ id: 'mix-cat-3', title: '刃具丙', category: 'cutting-tool' }));

    const res = await app.inject({ method: 'GET', url: '/api/v1/mall/categories' });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ code: string; count: number }>;
    const eg = data.find((x) => x.code === 'eg-screw');
    const ct = data.find((x) => x.code === 'cutting-tool');
    expect(eg?.count).toBe(2);
    expect(ct?.count).toBe(1);
    expect(data.reduce((sum, x) => sum + x.count, 0)).toBe(3);
  });

  it('同分类同名商品去歧义加后缀，重复导入不叠加第二层后缀', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const mk = (sourceKey: string, sourceId: string) => ({
      sourceKey,
      sourceId,
      sourceUrl: `https://eg.egluosi.com/${sourceId}`,
      name: '铰刀 X 1.5',
      subtitle: '',
      brand: '',
      categoryPath: ['铰刀类', '手用铰刀'],
      categoryCode: 'egm-screw',
      specs: { 包装: '1箱=1支' },
      unit: '支',
      packQty: null,
      priceFen: 1000,
      priceSource: 'anonymous' as const,
      priceCapturedAt: '2026-11-14T04:00:00.000Z',
      stock: 0,
      stockSource: 'anonymous' as const,
      images: [],
      description: '',
      rawName: '',
    });
    const p1 = mk('sku:DUP-1', '190601015000');
    const p2 = mk('sku:DUP-2', '190601015001');

    const mall = new MallService(testConfig, ctx.store);
    const first = await mall.importCatalog({ products: [p1, p2] });
    expect(first.inserted).toBe(2);

    const rows1 = await ctx.store.mall.products.list({ limit: 1000, offset: 0 });
    const byKey1 = new Map(rows1.map((r) => [r.sourceKey, r.title]));
    const t1 = byKey1.get('sku:DUP-1')!;
    const t2 = byKey1.get('sku:DUP-2')!;
    expect(t1).not.toBe(t2);
    // 包装在组内相同，退化到货号末 6 位
    expect(t1).toBe('铰刀 X 1.5 · 货号015000');
    expect(t2).toBe('铰刀 X 1.5 · 货号015001');

    // 同批复跑：基于原始名重新判重，title 不变，不叠加第二层后缀
    const second = await mall.importCatalog({ products: [p1, p2] });
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(2);
    const rows2 = await ctx.store.mall.products.list({ limit: 1000, offset: 0 });
    const byKey2 = new Map(rows2.map((r) => [r.sourceKey, r.title]));
    expect(byKey2.get('sku:DUP-1')).toBe(t1);
    expect(byKey2.get('sku:DUP-2')).toBe(t2);
  });

  it('询价商品与 0 元商品被服务端拦截，不能加购或下单', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(
      product({ id: 'mix-inq-1', title: '询价螺丝', stock: 10, priceFen: 0, priceSource: 'inquiry' }),
    );
    await ctx.store.mall.products.insert(
      product({ id: 'mix-zero-2', title: '缺价商品', stock: 10, priceFen: 0, priceSource: 'anonymous' }),
    );
    const token = await register(app, '13800002109');

    const cartInq = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/cart',
      headers: auth(token),
      payload: { productId: 'mix-inq-1', quantity: 1 },
    });
    expect(cartInq.statusCode).toBe(409);

    const cartZero = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/cart',
      headers: auth(token),
      payload: { productId: 'mix-zero-2', quantity: 1 },
    });
    expect(cartZero.statusCode).toBe(409);

    const orderInq = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/orders',
      headers: auth(token),
      payload: {
        receiverName: '测试',
        receiverPhone: '13800002109',
        address: '浙江省宁波市测试路 9 号',
        items: [{ productId: 'mix-inq-1', quantity: 1 }],
      },
    });
    expect(orderInq.statusCode).toBe(409);

    const orderZero = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/orders',
      headers: auth(token),
      payload: {
        receiverName: '测试',
        receiverPhone: '13800002109',
        address: '浙江省宁波市测试路 9 号',
        items: [{ productId: 'mix-zero-2', quantity: 1 }],
      },
    });
    expect(orderZero.statusCode).toBe(409);

    const orders = await app.inject({ method: 'GET', url: '/api/v1/mall/orders', headers: auth(token) });
    expect(orders.json().data).toHaveLength(0);
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

describe('订单六态流转与用户取消（0018）', () => {
  /** 下单夹具：单行、直接购买（不经过购物车）。 */
  async function placeOrder(
    instance: FastifyInstance,
    token: string,
    productId: string,
    phone: string,
  ): Promise<{ id: string; orderNo: string }> {
    const res = await instance.inject({
      method: 'POST',
      url: '/api/v1/mall/orders',
      headers: auth(token),
      payload: {
        receiverName: '周九',
        receiverPhone: phone,
        address: '浙江省宁波市镇海区六条路 9 号',
        items: [{ productId, quantity: 1 }],
      },
    });
    expect(res.statusCode).toBe(201);
    return { id: res.json().data.id as string, orderNo: res.json().data.orderNo as string };
  }

  it('待支付订单可取消：落取消留痕并归还库存，重复取消幂等不重复归还', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(product({ id: 'mix-cx-1', title: '六态帆布袋', stock: 1, priceFen: 3900 }));
    const token = await register(app, '13800002201');
    const order = await placeOrder(app, token, 'mix-cx-1', '13800002201');

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v1/mall/orders/${order.orderNo}/cancel`,
      headers: auth(token),
      payload: {},
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().data.status).toBe('cancelled');
    // 未填原因时服务端补默认文案，并标记取消方为 user
    expect(cancel.json().data.cancelReason).toBe('用户主动取消');
    expect(cancel.json().data.cancelledBy).toBe('user');
    expect(cancel.json().data.cancelledAt).toBeTruthy();

    const stock = await app.inject({ method: 'GET', url: '/api/v1/mall/products/mix-cx-1' });
    expect(stock.json().data.stock).toBe(1);

    // 重复取消：幂等返回当前订单，库存不会被二次归还
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/mall/orders/${order.orderNo}/cancel`,
      headers: auth(token),
      payload: { reason: '再点一次' },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.status).toBe('cancelled');
    expect(again.json().data.cancelReason).toBe('用户主动取消');
    const stock2 = await app.inject({ method: 'GET', url: '/api/v1/mall/products/mix-cx-1' });
    expect(stock2.json().data.stock).toBe(1);
  });

  it('已分配拣货（picking_at 非空）不可取消；已发货、已完成同样拒绝并说明原因', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(product({ id: 'mix-cx-2', title: '六态保温杯', stock: 5, priceFen: 6900 }));
    const token = await register(app, '13800002202');
    const order = await placeOrder(app, token, 'mix-cx-2', '13800002202');

    // 模拟后台已分配拣货
    expect(await ctx.store.mall.orders.markStatusAt(order.id, 'pending', 'picking', new Date())).toBe(true);
    const denied = await app.inject({
      method: 'POST',
      url: `/api/v1/mall/orders/${order.orderNo}/cancel`,
      headers: auth(token),
      payload: {},
    });
    expect(denied.statusCode).toBe(409);
    expect(denied.json().error.message).toContain('拣货');

    // 拣货 → 已发货：仍不可取消
    expect(await ctx.store.mall.orders.markStatusAt(order.id, 'picking', 'shipped', new Date())).toBe(true);
    const shipped = await app.inject({
      method: 'POST',
      url: `/api/v1/mall/orders/${order.orderNo}/cancel`,
      headers: auth(token),
      payload: {},
    });
    expect(shipped.statusCode).toBe(409);
    expect(shipped.json().error.message).toContain('已发货');

    // 已发货 → 已完成：终态同样拒绝
    expect(await ctx.store.mall.orders.markStatusAt(order.id, 'shipped', 'completed', new Date())).toBe(true);
    const done = await app.inject({
      method: 'POST',
      url: `/api/v1/mall/orders/${order.orderNo}/cancel`,
      headers: auth(token),
      payload: {},
    });
    expect(done.statusCode).toBe(409);
    expect(done.json().error.message).toContain('已完成');

    // 库存自始至终没有被归还（订单没有取消）
    const stock = await app.inject({ method: 'GET', url: '/api/v1/mall/products/mix-cx-2' });
    expect(stock.json().data.stock).toBe(4);
  });
});

describe('收藏夹（0019）', () => {
  it('默认收藏夹懒创建；同夹重复收藏幂等，条目带商品快照', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(product({ id: 'mix-fav-1', title: '收藏马克杯', stock: 3, priceFen: 4900 }));
    const token = await register(app, '13800002301');

    const empty = await app.inject({
      method: 'GET',
      url: '/api/v1/mall/favorites/folders',
      headers: auth(token),
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().data).toHaveLength(1);
    const folder = empty.json().data[0] as { id: string; isDefault: boolean; itemCount: number };
    expect(folder.isDefault).toBe(true);
    expect(folder.itemCount).toBe(0);

    // 连续收藏两次：幂等，条目数仍然只有 1
    for (let i = 0; i < 2; i += 1) {
      const added = await app.inject({
        method: 'POST',
        url: '/api/v1/mall/favorites/items',
        headers: auth(token),
        payload: { productId: 'mix-fav-1' },
      });
      expect(added.statusCode).toBe(201);
      expect(added.json().data.productId).toBe('mix-fav-1');
      expect(added.json().data.title).toBe('收藏马克杯');
      expect(added.json().data.available).toBe(true);
    }

    const folders = await app.inject({
      method: 'GET',
      url: '/api/v1/mall/favorites/folders',
      headers: auth(token),
    });
    expect(folders.json().data[0].itemCount).toBe(1);
    const items = await app.inject({
      method: 'GET',
      url: '/api/v1/mall/favorites/items',
      headers: auth(token),
    });
    expect(items.json().data).toHaveLength(1);
    expect(items.json().data[0].priceFen).toBe(4900);
  });

  it('复制收藏夹、设默认、移除条目与清空；他人收藏夹按不存在处理', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(product({ id: 'mix-fav-2', title: '收藏帆布袋', stock: 5, priceFen: 1900 }));
    const token = await register(app, '13800002302');

    const folders0 = await app.inject({
      method: 'GET',
      url: '/api/v1/mall/favorites/folders',
      headers: auth(token),
    });
    const defaultId = folders0.json().data[0].id as string;
    await app.inject({
      method: 'POST',
      url: '/api/v1/mall/favorites/items',
      headers: auth(token),
      payload: { productId: 'mix-fav-2' },
    });

    // 复制：条目一并带过去，副本不抢默认位
    const copied = await app.inject({
      method: 'POST',
      url: `/api/v1/mall/favorites/folders/${defaultId}/copy`,
      headers: auth(token),
      payload: { name: '礼盒收藏' },
    });
    expect(copied.statusCode).toBe(201);
    expect(copied.json().data.name).toBe('礼盒收藏');
    expect(copied.json().data.isDefault).toBe(false);
    expect(copied.json().data.itemCount).toBe(1);
    const copyId = copied.json().data.id as string;

    // 设默认：默认位从原夹转到副本，且全用户只有一个默认
    const setDefault = await app.inject({
      method: 'POST',
      url: `/api/v1/mall/favorites/folders/${copyId}/default`,
      headers: auth(token),
    });
    expect(setDefault.statusCode).toBe(200);
    expect(setDefault.json().data.isDefault).toBe(true);
    const folders1 = await app.inject({
      method: 'GET',
      url: '/api/v1/mall/favorites/folders',
      headers: auth(token),
    });
    const flags = (folders1.json().data as Array<{ id: string; isDefault: boolean }>).filter((f) => f.isDefault);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.id).toBe(copyId);

    // 移除副本里的条目：幂等，再删一次仍返回成功
    for (let i = 0; i < 2; i += 1) {
      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/v1/mall/favorites/items/mix-fav-2?folderId=${copyId}`,
        headers: auth(token),
      });
      expect(removed.statusCode).toBe(200);
    }
    const copyItems = await app.inject({
      method: 'GET',
      url: `/api/v1/mall/favorites/folders/${copyId}/items`,
      headers: auth(token),
    });
    expect(copyItems.json().data).toHaveLength(0);

    // 清空原夹：收藏夹本身保留
    const cleared = await app.inject({
      method: 'DELETE',
      url: `/api/v1/mall/favorites/folders/${defaultId}/items`,
      headers: auth(token),
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().data.removed).toBe(1);
    const folders2 = await app.inject({
      method: 'GET',
      url: '/api/v1/mall/favorites/folders',
      headers: auth(token),
    });
    expect(folders2.json().data).toHaveLength(2);

    // 越权：另一个用户操作他人收藏夹一律 404
    const otherToken = await register(app, '13800002303');
    const forbidden = await app.inject({
      method: 'DELETE',
      url: `/api/v1/mall/favorites/folders/${defaultId}/items`,
      headers: auth(otherToken),
    });
    expect(forbidden.statusCode).toBe(404);
  });
});

describe('购物车行状态四态与三层优惠（0017）', () => {
  /** 直接写购物车行：L/X 行无法通过加购接口进入（会被 assertOrderable 拦住），用于构造四态夹具。 */
  async function seedCart(
    store: Awaited<ReturnType<typeof makeApp>>['store'],
    userId: string,
    rows: Array<{ productId: string; quantity: number }>,
  ): Promise<void> {
    const now = new Date();
    for (const row of rows) {
      await store.mall.carts.upsert({
        id: `cart-${userId}-${row.productId}`,
        userId,
        productId: row.productId,
        quantity: row.quantity,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  /** 按 productId 取出购物车行；noUncheckedIndexedAccess 下用 ?? {} 兜底，避免断言处报 undefined。 */
  function lineOf(lines: Array<Record<string, unknown>>, productId: string): Record<string, unknown> {
    return lines.find((line) => line.productId === productId) ?? {};
  }

  it('四态判定：A 到货 / L 缺货 / R 需求 / X 下架，只有 A 可勾选结算', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(
      product({ id: 'mix-state-a', title: '正常货', priceFen: 10000, stock: 50 }),
    );
    await ctx.store.mall.products.insert(
      product({ id: 'mix-state-l', title: '无货品', priceFen: 10000, stock: 50, sourceInvStatus: '无货' }),
    );
    await ctx.store.mall.products.insert(
      product({ id: 'mix-state-r', title: '询价品', priceFen: 0, stock: 50, priceSource: 'inquiry' }),
    );
    await ctx.store.mall.products.insert(
      product({ id: 'mix-state-x', title: '下架品', priceFen: 10000, stock: 50, listed: false }),
    );
    const token = await register(app, '13800002201');
    const user = await ctx.store.users.findByPhone('13800002201');
    expect(user).toBeTruthy();
    await seedCart(ctx.store, user!.id, [
      { productId: 'mix-state-a', quantity: 2 },
      { productId: 'mix-state-l', quantity: 2 },
      { productId: 'mix-state-r', quantity: 2 },
      { productId: 'mix-state-x', quantity: 2 },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/v1/mall/cart', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    const lines = data.items as Array<Record<string, unknown>>;

    expect(lineOf(lines, 'mix-state-a').lineStatus).toBe('A');
    expect(lineOf(lines, 'mix-state-a').selectable).toBe(true);
    expect(lineOf(lines, 'mix-state-l').lineStatus).toBe('L');
    expect(lineOf(lines, 'mix-state-l').selectable).toBe(false);
    expect(lineOf(lines, 'mix-state-r').lineStatus).toBe('R');
    expect(lineOf(lines, 'mix-state-r').selectable).toBe(false);
    expect(lineOf(lines, 'mix-state-x').lineStatus).toBe('X');
    expect(lineOf(lines, 'mix-state-x').selectable).toBe(false);
    expect(lineOf(lines, 'mix-state-x').lineStatusText).toBe('下架');
    // 只有 A 行参与三层优惠汇总
    expect(data.pricing.subtotalFen).toBe(20000);
    expect(data.pricing.payableFen).toBe(20000);
  });

  it('商城 / 特价取优不叠加，厘→分只在小计与减免处取整一次', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    // 1005 厘/支 × 3 支 = 3015 厘 → 302 分（四舍五入）
    await ctx.store.mall.products.insert(
      product({ id: 'mix-disc-mall', title: '商城折扣品', priceFen: 101, priceLi: 1005, stock: 50, discountPct: 85 }),
    );
    // 特价折扣 80%（折后价百分比），减免额 = 面价 × 20%
    await ctx.store.mall.products.insert(
      product({ id: 'mix-disc-tejia', title: '特价品', priceFen: 1000, stock: 50, tejiaDiscountPct: 80 }),
    );
    const token = await register(app, '13800002202');
    const user = await ctx.store.users.findByPhone('13800002202');
    await seedCart(ctx.store, user!.id, [
      { productId: 'mix-disc-mall', quantity: 3 },
      { productId: 'mix-disc-tejia', quantity: 1 },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/v1/mall/cart', headers: auth(token) });
    const data = res.json().data;
    const lines = data.items as Array<Record<string, unknown>>;

    expect(lineOf(lines, 'mix-disc-mall').faceFen).toBe(302);
    expect(lineOf(lines, 'mix-disc-mall').mallDiscountFen).toBe(45);
    expect(lineOf(lines, 'mix-disc-mall').tejiaDiscountFen).toBe(0);
    expect(lineOf(lines, 'mix-disc-mall').netFen).toBe(257);
    expect(lineOf(lines, 'mix-disc-tejia').tejiaDiscountFen).toBe(200);
    expect(lineOf(lines, 'mix-disc-tejia').mallDiscountFen).toBe(0);
    expect(data.pricing.subtotalFen).toBe(1302);
    expect(data.pricing.mallDiscountFen).toBe(45);
    expect(data.pricing.tejiaDiscountFen).toBe(200);
    expect(data.pricing.manjianDiscountFen).toBe(0);
    expect(data.pricing.discountTotalFen).toBe(245);
    expect(data.pricing.payableFen).toBe(1057);
  });

  it('满减档位默认停用：不命中满减，应付 = 面价 - 商城/特价取优', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    // 面价 101 分/支（1005 厘）商城 85 折；特价商品 80 折（减 20%）
    await ctx.store.mall.products.insert(
      product({ id: 'mix-mj-off-mall', title: '商城折扣品', priceFen: 101, priceLi: 1005, stock: 50, discountPct: 85 }),
    );
    await ctx.store.mall.products.insert(
      product({ id: 'mix-mj-off-tejia', title: '特价品', priceFen: 100000, stock: 50, tejiaDiscountPct: 80 }),
    );
    const token = await register(app, '13800002205');
    const user = await ctx.store.users.findByPhone('13800002205');
    await seedCart(ctx.store, user!.id, [
      { productId: 'mix-mj-off-mall', quantity: 3 },
      { productId: 'mix-mj-off-tejia', quantity: 1 },
    ]);

    // 0017 种子三档 enabled = false：只下发启用档位 → tiers 为空，满减命中数为 0
    const res = await app.inject({ method: 'GET', url: '/api/v1/mall/cart', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    const pricing = res.json().data.pricing;
    expect(pricing.tiers).toEqual([]);
    expect(pricing.manjianDiscountFen).toBe(0);
    expect(pricing.manjianTier).toBeNull();
    expect(pricing.manjianTip).toBe('');
    // 302（面价）+ 100000 = 100302；商城 45、特价 20000
    expect(pricing.subtotalFen).toBe(100302);
    expect(pricing.mallDiscountFen).toBe(45);
    expect(pricing.tejiaDiscountFen).toBe(20000);
    expect(pricing.discountTotalFen).toBe(pricing.mallDiscountFen + pricing.tejiaDiscountFen);
    // 面价 - 商城/特价取优：100302 - 45 - 20000 = 80257
    expect(pricing.payableFen).toBe(pricing.subtotalFen - pricing.mallDiscountFen - pricing.tejiaDiscountFen);
    expect(pricing.payableFen).toBe(80257);

    // 下单同口径：订单 totalFen 不含满减
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/orders',
      headers: auth(token),
      payload: {
        receiverName: '赵六',
        receiverPhone: '13800002205',
        address: '浙江省宁波市江北区满减路 5 号',
      },
    });
    expect(created.statusCode).toBe(201);
    const order = created.json().data;
    expect(order.totalFen).toBe(80257);
    expect(order.manjianDiscountFen).toBe(0);
    expect(order.discountTotalFen).toBe(20045);
  });

  it('满减按档位匹配，命中最高档时给出「已享受最高折扣」，订单落三层优惠快照', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    /*
     * 0017 种子里三档是本地占位值、默认停用；本用例模拟「源站真实档位到位、改表启用」后的行为，
     * 在内存 Store 上临时启用三档，不改动停用默认值本身。
     */
    ctx.store.mall.manjianTiers.listEnabled = async () => [
      { id: 'mj_tier_1', minFen: 50000, maxFen: 100000, percent: 1, label: '满 500 元减免 1%', enabled: true, sortNo: 1 },
      { id: 'mj_tier_2', minFen: 100000, maxFen: 300000, percent: 2, label: '满 1000 元减免 2%', enabled: true, sortNo: 2 },
      { id: 'mj_tier_3', minFen: 300000, maxFen: null, percent: 3, label: '满 3000 元减免 3%', enabled: true, sortNo: 3 },
    ];
    await ctx.store.mall.products.insert(
      product({ id: 'mix-mj-1', title: '满减品', priceFen: 10000, stock: 100 }),
    );
    const token = await register(app, '13800002203');
    const user = await ctx.store.users.findByPhone('13800002203');
    await seedCart(ctx.store, user!.id, [{ productId: 'mix-mj-1', quantity: 30 }]);

    // 300000 分 = 3000 元，命中 300000 以上 3% 档；Math.floor(300000 × 3%) = 9000
    const res = await app.inject({ method: 'GET', url: '/api/v1/mall/cart', headers: auth(token) });
    const pricing = res.json().data.pricing;
    expect(pricing.subtotalFen).toBe(300000);
    expect(pricing.manjianDiscountFen).toBe(9000);
    expect(pricing.manjianTier.percent).toBe(3);
    expect(pricing.manjianTip).toContain('已享受最高折扣');
    expect(pricing.payableFen).toBe(291000);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/orders',
      headers: auth(token),
      payload: {
        receiverName: '李四',
        receiverPhone: '13800002203',
        address: '浙江省宁波市鄞州区优惠路 8 号',
      },
    });
    expect(created.statusCode).toBe(201);
    const order = created.json().data;
    expect(order.totalFen).toBe(291000);
    expect(order.subtotalFen).toBe(300000);
    expect(order.mallDiscountFen).toBe(0);
    expect(order.tejiaDiscountFen).toBe(0);
    expect(order.manjianDiscountFen).toBe(9000);
    expect(order.discountTotalFen).toBe(9000);
    expect(order.items[0].lineStatus).toBe('A');
  });

  it('下单拆有效行：失效行不进单、留在购物车并随响应说明', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(
      product({ id: 'mix-split-a', title: '可售品', priceFen: 10000, stock: 50 }),
    );
    await ctx.store.mall.products.insert(
      product({ id: 'mix-split-l', title: '缺货品', priceFen: 10000, stock: 50, sourceInvStatus: '无货' }),
    );
    const token = await register(app, '13800002204');
    const user = await ctx.store.users.findByPhone('13800002204');
    await seedCart(ctx.store, user!.id, [
      { productId: 'mix-split-a', quantity: 2 },
      { productId: 'mix-split-l', quantity: 2 },
    ]);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/orders',
      headers: auth(token),
      payload: {
        receiverName: '王五',
        receiverPhone: '13800002204',
        address: '浙江省宁波市海曙区拆分路 9 号',
      },
    });
    expect(created.statusCode).toBe(201);
    const order = created.json().data;
    expect(order.items).toHaveLength(1);
    expect(order.items[0].productId).toBe('mix-split-a');
    expect(order.skippedLines).toHaveLength(1);
    expect(order.skippedLines[0].productId).toBe('mix-split-l');
    expect(order.skippedLines[0].lineStatus).toBe('L');
    expect(order.skippedLines[0].reason).toContain('缺货');
    expect(order.totalFen).toBe(20000);

    // 失效行留在购物车，A 行已被移除
    const cartAfter = await app.inject({ method: 'GET', url: '/api/v1/mall/cart', headers: auth(token) });
    const itemsAfter = cartAfter.json().data.items as Array<{ productId: string; lineStatus: string }>;
    expect(itemsAfter).toHaveLength(1);
    expect(itemsAfter[0]!.productId).toBe('mix-split-l');
    expect(itemsAfter[0]!.lineStatus).toBe('L');
    // 库存只扣有效行
    expect((await ctx.store.mall.products.findById('mix-split-a'))?.stock).toBe(48);
    expect((await ctx.store.mall.products.findById('mix-split-l'))?.stock).toBe(50);
  });

  it('从购物车勾选结算：只清已结算行，未勾选行与失效行保留', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(product({ id: 'mix-settle-a', title: '已结算品', priceFen: 10000, stock: 50 }));
    await ctx.store.mall.products.insert(product({ id: 'mix-settle-b', title: '未勾选品', priceFen: 10000, stock: 50 }));
    await ctx.store.mall.products.insert(
      product({ id: 'mix-settle-l', title: '缺货品', priceFen: 10000, stock: 50, sourceInvStatus: '无货' }),
    );
    const token = await register(app, '13800002206');
    const user = await ctx.store.users.findByPhone('13800002206');
    await seedCart(ctx.store, user!.id, [
      { productId: 'mix-settle-a', quantity: 2 },
      { productId: 'mix-settle-b', quantity: 2 },
      { productId: 'mix-settle-l', quantity: 2 },
    ]);

    // 前端勾选结算：显式带 fromCart + 只传勾选的 A 行（旧口径会被误判成「立即购买」而不清行）
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/orders',
      headers: auth(token),
      payload: {
        receiverName: '周九',
        receiverPhone: '13800002206',
        address: '浙江省宁波市鄞州区清行路 6 号',
        fromCart: true,
        items: [{ productId: 'mix-settle-a', quantity: 2 }],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.items).toHaveLength(1);

    const cartAfter = await app.inject({ method: 'GET', url: '/api/v1/mall/cart', headers: auth(token) });
    const itemsAfter = cartAfter.json().data.items as Array<{
      productId: string;
      quantity: number;
      lineStatus: string;
    }>;
    // 已结算行被清掉
    expect(itemsAfter.some((line) => line.productId === 'mix-settle-a')).toBe(false);
    // 未勾选行原样保留
    expect(itemsAfter.find((line) => line.productId === 'mix-settle-b')?.quantity).toBe(2);
    // 四态不可售行（L 缺货）保留
    expect(itemsAfter.find((line) => line.productId === 'mix-settle-l')?.lineStatus).toBe('L');
  });

  it('同一商品结算后又被加购：只扣已结算数量，新加购数量保留', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(
      product({ id: 'mix-readd-1', title: '重复加购品', priceFen: 10000, stock: 100 }),
    );
    const token = await register(app, '13800002207');
    const user = await ctx.store.users.findByPhone('13800002207');
    // 前端加载时行内 5 支，提交前另一处又加购 3 支 → 行内已变成 8；提交的仍是快照里的 5 支
    await seedCart(ctx.store, user!.id, [{ productId: 'mix-readd-1', quantity: 8 }]);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/orders',
      headers: auth(token),
      payload: {
        receiverName: '吴十',
        receiverPhone: '13800002207',
        address: '浙江省宁波市鄞州区加购路 7 号',
        fromCart: true,
        items: [{ productId: 'mix-readd-1', quantity: 5 }],
      },
    });
    expect(created.statusCode).toBe(201);

    const cartAfter = await app.inject({ method: 'GET', url: '/api/v1/mall/cart', headers: auth(token) });
    const itemsAfter = cartAfter.json().data.items as Array<{ productId: string; quantity: number }>;
    // 只扣已结算的 5 支，新加购的 3 支必须保留，不能被整行删除
    expect(itemsAfter).toHaveLength(1);
    expect(itemsAfter[0]!.productId).toBe('mix-readd-1');
    expect(itemsAfter[0]!.quantity).toBe(3);
  });

  it('不带 fromCart 的立即购买不动购物车', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await ctx.store.mall.products.insert(product({ id: 'mix-buy-1', title: '立即购买品', priceFen: 10000, stock: 50 }));
    const token = await register(app, '13800002208');
    const user = await ctx.store.users.findByPhone('13800002208');
    await seedCart(ctx.store, user!.id, [{ productId: 'mix-buy-1', quantity: 2 }]);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/orders',
      headers: auth(token),
      payload: {
        receiverName: '郑十一',
        receiverPhone: '13800002208',
        address: '浙江省宁波市鄞州区直购路 8 号',
        items: [{ productId: 'mix-buy-1', quantity: 1 }],
      },
    });
    expect(created.statusCode).toBe(201);

    const cartAfter = await app.inject({ method: 'GET', url: '/api/v1/mall/cart', headers: auth(token) });
    const itemsAfter = cartAfter.json().data.items as Array<{ productId: string; quantity: number }>;
    // 不是从购物车结算，购物车原样保留
    expect(itemsAfter).toHaveLength(1);
    expect(itemsAfter[0]!.quantity).toBe(2);
  });
});

describe('首页运营位（home/ggs、home/rcs）', () => {
  it('广告位按 sortNo 升序下发；推荐分类只取真实类目并按商品数排序', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    // 造两个非演示类目：cat-a 2 件、cat-b 1 件；演示类目 featured 必须被推荐位过滤掉
    await ctx.store.mall.products.insert(product({ id: 'home-a1', title: '首页A1', category: 'cat-a' }));
    await ctx.store.mall.products.insert(product({ id: 'home-a2', title: '首页A2', category: 'cat-a' }));
    await ctx.store.mall.products.insert(product({ id: 'home-b1', title: '首页B1', category: 'cat-b' }));

    const ads = await app.inject({ method: 'GET', url: '/api/v1/home/ggs' });
    expect(ads.statusCode).toBe(200);
    const adList = ads.json().data as Array<{ id: string; sortNo: number; target: string }>;
    expect(adList.length).toBeGreaterThan(0);
    const sortNos = adList.map((ad) => ad.sortNo);
    expect(sortNos).toEqual([...sortNos].sort((a, b) => a - b));

    // limit=1：只回商品数最多的 cat-a，且带代表色（前端直接当背景色用，不能是空串）
    const rec = await app.inject({ method: 'GET', url: '/api/v1/home/rcs?limit=1' });
    expect(rec.statusCode).toBe(200);
    const categories = rec.json().data as Array<{ code: string; count: number; cover: string }>;
    expect(categories).toHaveLength(1);
    expect(categories[0]?.code).toBe('cat-a');
    expect(categories[0]?.count).toBe(2);
    expect(categories[0]?.cover).toMatch(/^#/);

    // 非法/越界 limit 一律按默认值收口，不报 422（首页运营位不值得为参数挡住整个首页）
    const relaxed = await app.inject({ method: 'GET', url: '/api/v1/home/rcs?limit=999' });
    expect(relaxed.statusCode).toBe(200);
    expect((relaxed.json().data as unknown[]).length).toBeLessThanOrEqual(6);
  });
});