import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { PgStore, createStore } from '../src/db/postgres.js';

/**
 * 真实 PostgreSQL 集成测试。
 *
 * 这是唯一能证明持久化链路可用的测试：内存实现只覆盖业务逻辑，覆盖不到 SQL、
 * 唯一约束、外键级联与事务语义。因此：
 * - 本地没有 DATABASE_URL 时跳过（不假装通过）；
 * - CI 设 REQUIRE_DATABASE_URL=1，此时缺失连接串会直接失败，而不是静默跳过。
 */
const connectionString = (process.env['DATABASE_URL'] ?? '').trim();
const requireDb = process.env['REQUIRE_DATABASE_URL'] === '1';

if (!connectionString && requireDb) {
  throw new Error(
    'REQUIRE_DATABASE_URL=1 要求真实 PostgreSQL：DATABASE_URL 缺失。请检查 CI 的 postgres service 或本地 docker。',
  );
}

process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['DEV_ECHO_SMS_CODE'] = '1';
process.env['RATE_LIMIT_PER_MINUTE'] = '1000';

const suite = connectionString ? describe : describe.skip;
const stamp = Date.now().toString().slice(-9);
const phone = `139${stamp}`.slice(0, 11);
const email = `pg-${stamp}@mixmapp.test`;
const password = 'PgTest!2026';
const concurrentUsername = `pg_conc_${stamp.slice(-6)}`;

suite('PostgreSQL 驱动（真实库）', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let store: PgStore;

  beforeAll(async () => {
    const applied = await runMigrations(connectionString);
    expect(Array.isArray(applied)).toBe(true);
    store = createStore(connectionString) as PgStore;
    expect(store.driver).toBe('postgres');
    expect(await store.ping()).toBe(true);
    app = await buildApp({ config: loadConfig(), store, logger: false });
  });

  afterAll(async () => {
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      await client.query('delete from users where email = $1 or phone = $1', [email]);
      await client.query('delete from users where username = $1', [concurrentUsername]);
      await client.query('delete from sms_codes where phone = $1', [phone]);
      await client.query("delete from products where id like 'pg-p-%' or id like 'pg-kw-%'");
    } finally {
      await client.end();
    }
    await app?.close();
    await store?.close();
  });

  it('注册后用户落库，三套 ID 与 MixmAPP 号码同时写入', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/email',
      payload: { email, password, nickname: '持久化测试' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json().data as {
      user: { id: string; accountNo: string };
      tokens: { accessToken: string; refreshToken: string };
    };
    expect(body.user.accountNo).toMatch(/^MixmAPP-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]$/);

    const row = await store.users.findByEmail(email);
    expect(row?.id).toBe(body.user.id);
    expect(row?.accountNo).toBe(body.user.accountNo);
    // DTO 只暴露 id 与 accountNo，三套原始 ID 直接查库校验
    expect(row?.uuidV7).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(row?.ulid).toHaveLength(26);
    expect(row?.snowflake).toMatch(/^\d+$/);
    expect(row?.passwordHash).not.toBeNull();
  });

  it('并发同名注册：只成功一个，其余收到 409 而不是 500', async () => {
    const calls = await Promise.all(
      Array.from({ length: 6 }, () =>
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/register/username',
          payload: { username: concurrentUsername, password },
        }),
      ),
    );
    const created = calls.filter((r) => r.statusCode === 201);
    const conflicts = calls.filter((r) => r.statusCode === 409);
    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(5);
    // 唯一约束兜底：库里只能有一行
    const rows = await store.users.findByUsername(concurrentUsername);
    expect(rows?.username).toBe(concurrentUsername);
  });

  it('账号密码登录可以在新连接上读到刚写入的用户', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/password',
      payload: { account: email, password },
    });
    expect(res.statusCode).toBe(200);
    const tokens = res.json().data.tokens as { accessToken: string; refreshToken: string };
    expect(tokens.accessToken).toBeTruthy();

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.email).toBe(email);
  });

  it('刷新令牌轮换会撤销旧哈希', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/password',
      payload: { account: email, password },
    });
    const oldRefresh = login.json().data.tokens.refreshToken as string;
    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: oldRefresh },
    });
    expect(refresh.statusCode).toBe(200);
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: oldRefresh },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('下单写入 payments 表，唯一约束拒绝重复商户单号', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/password',
      payload: { account: email, password },
    });
    const token = login.json().data.tokens.accessToken as string;
    const outTradeNo = `P${stamp}${Date.now().toString().slice(-6)}`;

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pay/orders',
      headers: { authorization: `Bearer ${token}` },
      payload: { channel: 'wechat', amountFen: 100, subject: '持久化下单', outTradeNo },
    });
    expect(created.statusCode).toBe(201);

    const row = await store.payments.findByOutTradeNo(outTradeNo);
    expect(row?.amountFen).toBe(100);
    expect(row?.status).toBe('pending');

    const duplicated = await app.inject({
      method: 'POST',
      url: '/api/v1/pay/orders',
      headers: { authorization: `Bearer ${token}` },
      payload: { channel: 'wechat', amountFen: 100, subject: '重复单号', outTradeNo },
    });
    expect(duplicated.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('商城四表可写：商品落库、条件扣库存、订单事务与明细', async () => {
    const user = await store.users.findByEmail(email);
    expect(user).not.toBeNull();
    const userId = user?.id as string;
    const productId = `pg-p-${stamp}`;

    const inserted = await store.mall.products.insert({
      id: productId,
      title: '集成测试商品',
      subtitle: 'PG 写入',
      priceFen: 12900,
      originalPriceFen: 15900,
      stock: 5,
      category: 'featured',
      cover: '#0f9d8f',
      images: [],
      tags: ['pg'],
      description: '验证 0002_mall.sql 建表与写入',
      sortNo: 999,
      createdAt: new Date(),
    });
    expect(inserted.stock).toBe(5);

    const listed = await store.mall.products.list({ limit: 100, offset: 0 });
    expect(listed.some((p) => p.id === productId)).toBe(true);

    // 条件更新：库存不足时不允许扣减
    expect(await store.mall.products.decrementStock(productId, 2)).toBe(true);
    expect(await store.mall.products.decrementStock(productId, 99)).toBe(false);
    expect((await store.mall.products.findById(productId))?.stock).toBe(3);

    const cart = await store.mall.carts.upsert({
      id: `pg-c-${stamp}`,
      userId,
      productId,
      quantity: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(cart.quantity).toBe(2);
    const cartAgain = await store.mall.carts.upsert({ ...cart, quantity: 3, updatedAt: new Date() });
    expect(cartAgain.quantity).toBe(3);
    await store.mall.carts.remove(userId, productId);
    expect(await store.mall.carts.find(userId, productId)).toBeNull();

    const orderId = `pg-o-${stamp}`;
    const orderNo = `PGO${stamp}`;
    await store.mall.orders.insert(
      {
        id: orderId,
        orderNo,
        userId,
        status: 'pending',
        totalFen: 25800,
        receiverName: '集成测试',
        receiverPhone: '13900000000',
        address: '浙江省宁波市集成测试地址',
        addressId: null,
        deliveryMethod: null,
        deliverySlot: null,
        remark: null,
        createdAt: new Date(),
        paidAt: null,
      },
      [
        {
          id: `pg-oi-${stamp}`,
          orderId,
          productId,
          title: '集成测试商品',
          priceFen: 12900,
          quantity: 2,
          subtotalFen: 25800,
        },
      ],
    );

    const found = await store.mall.orders.findByOrderNo(orderNo);
    expect(found?.totalFen).toBe(25800);
    expect(await store.mall.orders.itemsByOrder(orderId)).toHaveLength(1);
  });

  it('下单幂等键：claim 唯一约束，attach 后重试返回同一单号，release 后可重新占用', async () => {
    const user = await store.users.findByEmail(email);
    const userId = user?.id as string;
    const key = `pg-idem-${stamp}`;
    const orderNo = `PGO${stamp}-1`;

    const first = await store.mall.orderRequests.claim(userId, key);
    expect(first.claimed).toBe(true);
    expect(first.orderNo).toBeNull();

    // 未附着前重复占用：唯一约束拦截，返回未附着
    const dup = await store.mall.orderRequests.claim(userId, key);
    expect(dup.claimed).toBe(false);
    expect(dup.orderNo).toBeNull();

    await store.mall.orderRequests.attach(userId, key, orderNo);
    const attached = await store.mall.orderRequests.claim(userId, key);
    expect(attached.claimed).toBe(false);
    expect(attached.orderNo).toBe(orderNo);

    await store.mall.orderRequests.release(userId, key);
    const afterRelease = await store.mall.orderRequests.claim(userId, key);
    expect(afterRelease.claimed).toBe(true);
    await store.mall.orderRequests.release(userId, key);
  });

  /**
   * 回归守卫：PgStore 的关键词搜索是拼 SQL 字符串实现的（translate 译表做全半角归一）。
   * 译表的半角一侧含单引号，一旦漏转义，整条 SQL 语法错误 → 线上任意文本关键词 500；
   * 内存实现不走 SQL，单测和本地 catalog 模式都发现不了，只能靠真实库兜住。
   * 这里覆盖三条分支：普通文本、规格等价、6 位段码，并顺带验证全角输入。
   */
  it('关键词搜索走真实 SQL：文本、规格等价、段码都能命中且不报错', async () => {
    const productId = `pg-kw-${stamp}`;
    await store.mall.products.insert({
      id: productId,
      title: '内六角圆柱头螺钉',
      subtitle: '304 不锈钢',
      priceFen: 100,
      originalPriceFen: 120,
      stock: 10,
      category: 'featured',
      cover: '#0f9d8f',
      images: [],
      tags: [],
      description: '',
      sortNo: 9999,
      createdAt: new Date(),
    });
    // insert 只写基础列；specs / source_id 属于目录导入增补字段，直接补库以覆盖 SQL 分支。
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      await client.query('update products set specs = $1::jsonb, source_id = $2 where id = $3', [
        JSON.stringify({ 规格: 'M6-1.0x8' }),
        '110001030004',
        productId,
      ]);
    } finally {
      await client.end();
    }

    const byText = await store.mall.products.list({ keyword: '内六角', limit: 20, offset: 0 });
    expect(byText.some((p) => p.id === productId)).toBe(true);

    // 规格等价：M6-1.0x8 / M6x8 / 6x8 / 全角 ６Ｘ８ 都应命中同一条
    for (const keyword of ['M6-1.0x8', '6x8', '６Ｘ８']) {
      const rows = await store.mall.products.list({ keyword, limit: 20, offset: 0 });
      expect(rows.some((p) => p.id === productId), `规格关键词 ${keyword} 未命中`).toBe(true);
    }

    const byCode = await store.mall.products.list({ keyword: '110001', limit: 20, offset: 0 });
    expect(byCode.some((p) => p.id === productId)).toBe(true);
  });
});
