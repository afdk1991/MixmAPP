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
      await client.query('delete from sms_codes where phone = $1', [phone]);
    } finally {
      await client.end();
    }
    await app?.close();
    await store?.close();
  });

  it('注册后用户落库，三套 ID 与 MIX 号码同时写入', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/email',
      payload: { email, password, nickname: '持久化测试' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json().data as {
      user: { id: string; accountNo: string; snowflake: string; ulid: string; uuidV7: string };
      tokens: { accessToken: string; refreshToken: string };
    };
    expect(body.user.accountNo).toMatch(/^MIX-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]$/);
    expect(body.user.uuidV7).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(body.user.ulid).toHaveLength(26);
    expect(body.user.snowflake).toMatch(/^\d+$/);

    const row = await store.users.findByEmail(email);
    expect(row?.id).toBe(body.user.id);
    expect(row?.accountNo).toBe(body.user.accountNo);
    expect(row?.passwordHash).not.toBeNull();
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
    expect(me.json().data.email).toContain('***');
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
});
