// 后台运营台端到端测试：
// 覆盖门禁（未配置/错误口令/匿名一律 404）、会话 Cookie、商品批量上下架、订单状态推进与取消、
// 用户详情、收藏夹/满减/运营位只读、以及每次写操作是否落审计。
// 测试走 MemoryStore，与生产 PgStore 共用同一套 Store.admin 契约。

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStore } from '../src/db/memory.js';
import type { OrderRecord, ProductRecord, UserRecord } from '../src/db/types.js';
import { testConfig } from './helpers.js';

const ADMIN_TOKEN = 'ops-test-token';
const BASE = '/api/v1/admin/console';

let app: FastifyInstance | undefined;
let store: MemoryStore;

/** 构造一个最小可用商品（仅字段齐全，不追求业务真实度）。 */
function makeProduct(id: string, overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id,
    title: `测试商品 ${id}`,
    subtitle: '',
    priceFen: 1000,
    originalPriceFen: 1200,
    stock: 10,
    category: 'c1',
    cover: '',
    images: [],
    tags: [],
    description: '',
    sortNo: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    listed: true,
    ...overrides,
  };
}

/** 构造一个订单；items 传空数组即可满足 insert 契约。 */
function makeOrder(id: string, status: OrderRecord['status'], overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id,
    orderNo: `NO-${id}`,
    userId: 'u1',
    status,
    totalFen: 1000,
    receiverName: '张三',
    receiverPhone: '13800000000',
    address: '测试地址',
    addressId: null,
    deliveryMethod: 'express',
    deliverySlot: null,
    remark: null,
    createdAt: new Date('2026-01-02T00:00:00Z'),
    paidAt: null,
    pickingAt: null,
    shippedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    cancelledBy: null,
    ...overrides,
  };
}

/** 构造一个用户。 */
function makeUser(id: string, overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id,
    accountNo: `A-${id}`,
    snowflake: `s-${id}`,
    ulid: `ulid-${id}`,
    uuidV7: `uuid-${id}`,
    nickname: `用户${id}`,
    avatarUrl: null,
    bio: null,
    username: null,
    guest: false,
    phone: null,
    email: null,
    passwordHash: 'hash',
    status: 'active',
    privacyConsent: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** 登录并返回 Cookie 头（只取 name=value 段）。 */
async function login(token = ADMIN_TOKEN): Promise<{ statusCode: number; cookie: string; setCookie: string }> {
  const res = await app!.inject({
    method: 'POST',
    url: `${BASE}/session`,
    payload: { token },
  });
  const raw = res.headers['set-cookie'];
  // set-cookie 可能是数组（多条 Cookie）或单条；统一取第一条，缺失时退回空串
  const first = (Array.isArray(raw) ? raw[0] : raw) ?? '';
  return {
    statusCode: res.statusCode,
    cookie: first.split(';')[0] ?? '',
    setCookie: first,
  };
}

beforeEach(async () => {
  store = new MemoryStore();
  app = await buildApp({
    config: { ...testConfig, adminToken: ADMIN_TOKEN },
    store,
    logger: false,
  });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('后台运营台：门禁与会话', () => {
  it('未配置 ADMIN_TOKEN 时登录也 404，不暴露后台存在', async () => {
    await app?.close();
    app = await buildApp({
      config: { ...testConfig, adminToken: '' },
      store: new MemoryStore(),
      logger: false,
    });
    const res = await app.inject({ method: 'POST', url: `${BASE}/session`, payload: { token: 'x' } });
    expect(res.statusCode).toBe(404);
  });

  it('口令错误返回 404', async () => {
    const { statusCode } = await login('wrong-token');
    expect(statusCode).toBe(404);
  });

  it('正确口令下发 HttpOnly/SameSite=Strict 会话 Cookie，前端拿不到明文令牌', async () => {
    const { statusCode, setCookie } = await login();
    expect(statusCode).toBe(200);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/');
  });

  it('匿名访问后台数据一律 404', async () => {
    for (const url of [`${BASE}/overview`, `${BASE}/products`, `${BASE}/orders`, `${BASE}/users`, `${BASE}/audit`]) {
      const res = await app!.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
    }
  });

  it('携带会话后可自检并登出，登出后立即失效', async () => {
    const { cookie } = await login();
    const check = await app!.inject({ method: 'GET', url: `${BASE}/session`, headers: { cookie } });
    expect(check.statusCode).toBe(200);
    const out = await app!.inject({
      method: 'POST',
      url: `${BASE}/session/logout`,
      headers: { cookie, 'x-mixm-console': '1' },
    });
    expect(out.statusCode).toBe(200);
    const after = await app!.inject({ method: 'GET', url: `${BASE}/session`, headers: { cookie } });
    expect(after.statusCode).toBe(404);
  });
});

describe('后台运营台：商品', () => {
  it('批量上下架需要二次确认与自定义头，并写审计', async () => {
    await store.mall.products.insert(makeProduct('p1'));
    const { cookie } = await login();

    // 缺少 CSRF 头：按不存在处理
    const noHeader = await app!.inject({
      method: 'POST',
      url: `${BASE}/products/listing`,
      headers: { cookie },
      payload: { ids: ['p1'], listed: false, confirm: true },
    });
    expect(noHeader.statusCode).toBe(404);

    // 缺少二次确认
    const noConfirm = await app!.inject({
      method: 'POST',
      url: `${BASE}/products/listing`,
      headers: { cookie, 'x-mixm-console': '1' },
      payload: { ids: ['p1'], listed: false, confirm: false },
    });
    expect(noConfirm.statusCode).toBe(422);

    // 正常下架
    const ok = await app!.inject({
      method: 'POST',
      url: `${BASE}/products/listing`,
      headers: { cookie, 'x-mixm-console': '1' },
      payload: { ids: ['p1'], listed: false, confirm: true },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.changed).toBe(1);

    // 后台列表能看到下架商品
    const list = await app!.inject({ method: 'GET', url: `${BASE}/products?listed=false`, headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.total).toBe(1);
    expect(list.json().data.rows[0].id).toBe('p1');

    // 审计记录：谁、对什么、改前改后
    const audit = await app!.inject({ method: 'GET', url: `${BASE}/audit`, headers: { cookie } });
    const rows = audit.json().data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe('product.unlist');
    expect(row.targetId).toBe('p1');
    expect(row.actor).toBe('admin');
    expect(row.before).toEqual({ listed: true });
    expect(row.after).toEqual({ listed: false });
  });

  it('搜索与分页可用', async () => {
    await store.mall.products.insert(makeProduct('p1', { title: '氧化锆全瓷冠' }));
    await store.mall.products.insert(makeProduct('p2', { title: '树脂填充' }));
    const { cookie } = await login();
    const res = await app!.inject({
      method: 'GET',
      url: `${BASE}/products?keyword=${encodeURIComponent('氧化锆')}&limit=1&offset=0`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.total).toBe(1);
    expect(res.json().data.rows[0].id).toBe('p1');
  });
});

describe('后台运营台：订单', () => {
  it('只允许按六态顺序推进，跨态返回 409', async () => {
    await store.mall.orders.insert(makeOrder('o1', 'pending'), []);
    await store.mall.orders.insert(makeOrder('o2', 'paid'), []);
    const { cookie } = await login();

    const illegal = await app!.inject({
      method: 'POST',
      url: `${BASE}/orders/o1/transition`,
      headers: { cookie, 'x-mixm-console': '1' },
      payload: { to: 'shipped' },
    });
    expect(illegal.statusCode).toBe(409);

    const ok = await app!.inject({
      method: 'POST',
      url: `${BASE}/orders/o2/transition`,
      headers: { cookie, 'x-mixm-console': '1' },
      payload: { to: 'picking' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.status).toBe('picking');
    expect(ok.json().data.pickingAt).toBeTruthy();
  });

  it('取消订单必须带原因与二次确认，并记录发起方为 admin', async () => {
    await store.mall.orders.insert(makeOrder('o3', 'pending'), []);
    const { cookie } = await login();

    const noConfirm = await app!.inject({
      method: 'POST',
      url: `${BASE}/orders/o3/cancel`,
      headers: { cookie, 'x-mixm-console': '1' },
      payload: { reason: '库存不足', confirm: false },
    });
    expect(noConfirm.statusCode).toBe(422);

    const ok = await app!.inject({
      method: 'POST',
      url: `${BASE}/orders/o3/cancel`,
      headers: { cookie, 'x-mixm-console': '1' },
      payload: { reason: '库存不足', confirm: true },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.status).toBe('cancelled');
    expect(ok.json().data.cancelReason).toBe('库存不足');
    expect(ok.json().data.cancelledBy).toBe('admin');

    const audit = await app!.inject({ method: 'GET', url: `${BASE}/audit`, headers: { cookie } });
    const rows = audit.json().data as Array<Record<string, unknown>>;
    expect(rows.some((row) => row.action === 'order.cancel' && row.targetId === 'o3')).toBe(true);
  });

  it('订单详情返回明细与下单用户', async () => {
    await store.users.insert(makeUser('u1', { nickname: '下单人' }));
    await store.mall.orders.insert(makeOrder('o4', 'paid'), []);
    const { cookie } = await login();
    const res = await app!.inject({ method: 'GET', url: `${BASE}/orders/o4`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.order.id).toBe('o4');
    expect(res.json().data.user.nickname).toBe('下单人');
    expect(Array.isArray(res.json().data.items)).toBe(true);
  });
});

describe('后台运营台：用户与只读数据', () => {
  it('用户列表/详情包含绑定汇总且不下发密码哈希', async () => {
    await store.users.insert(makeUser('u1', { nickname: '小明' }));
    await store.bindings.insert({
      id: 'b1',
      userId: 'u1',
      provider: 'wechat',
      openId: 'open-1',
      unionId: null,
      nickname: '微信昵称',
      avatarUrl: null,
      createdAt: new Date(),
    });
    const { cookie } = await login();

    const list = await app!.inject({ method: 'GET', url: `${BASE}/users?keyword=小明`, headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.total).toBe(1);
    expect(list.json().data.rows[0].passwordHash).toBeNull();

    const detail = await app!.inject({ method: 'GET', url: `${BASE}/users/u1`, headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.user.passwordHash).toBeNull();
    expect(detail.json().data.summary.bindings).toHaveLength(1);
    expect(detail.json().data.bindings[0].provider).toBe('wechat');
  });

  it('概览/收藏夹/满减/运营位均可读，运营位标注不可编辑', async () => {
    const { cookie } = await login();

    const overview = await app!.inject({ method: 'GET', url: `${BASE}/overview`, headers: { cookie } });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().data.health.db).toBe(true);
    expect(overview.json().data.counts.orders.byStatus.pending).toBe(0);

    const favorites = await app!.inject({ method: 'GET', url: `${BASE}/favorites`, headers: { cookie } });
    expect(favorites.statusCode).toBe(200);
    expect(favorites.json().data.total).toBe(0);

    const manjian = await app!.inject({ method: 'GET', url: `${BASE}/manjian`, headers: { cookie } });
    expect(manjian.statusCode).toBe(200);
    expect(manjian.json().data).toHaveLength(3);

    const content = await app!.inject({ method: 'GET', url: `${BASE}/content`, headers: { cookie } });
    expect(content.statusCode).toBe(200);
    expect(content.json().data.editable).toBe(false);
    expect(Array.isArray(content.json().data.homeAds)).toBe(true);
  });
});
