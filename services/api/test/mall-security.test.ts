import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStore } from '../src/db/memory.js';
import type { Store } from '../src/db/types.js';
import { makeApp, testConfig } from './helpers.js';

/**
 * 商城 / 账号线的安全与边界用例：
 * 1. 未登录与无权限分开（401 / 403），他人资源一律 404；
 * 2. 支付单归属隔离与幂等重放；
 * 3. 上传路径 / 类型白名单；
 * 4. 限流不可被 X-Forwarded-For 伪造绕过，私有读不再豁免；
 * 5. 错误响应不泄漏框架原文与请求片段。
 */

let app: FastifyInstance | undefined;
const tempDirs: string[] = [];

afterEach(async () => {
  await app?.close();
  app = undefined;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function register(instance: FastifyInstance, phone: string, nickname: string): Promise<string> {
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
    payload: { phone, code, nickname },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.tokens.accessToken as string;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

/** 直接落一条订单：验证「读/取消他人订单」不需要走完整下单链路。 */
async function seedOrder(store: Store, userId: string, orderNo: string): Promise<void> {
  await store.mall.orders.insert(
    {
      id: `order-${orderNo}`,
      orderNo,
      userId,
      status: 'pending',
      totalFen: 1000,
      subtotalFen: 1000,
      receiverName: '张三',
      receiverPhone: '13800000001',
      address: '上海市浦东新区测试路 1 号',
      addressId: null,
      deliveryMethod: 'express',
      deliverySlot: 'am',
      remark: null,
      createdAt: new Date(),
      paidAt: null,
    },
    [],
  );
}

describe('鉴权：未登录 401 与越权 404 分开处理', () => {
  it('账号私有接口未带令牌统一 401，不返回 403/404', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    for (const url of [
      '/api/v1/mall/cart',
      '/api/v1/mall/orders',
      '/api/v1/mall/addresses',
      '/api/v1/mall/favorites/folders',
      '/api/v1/mall/favorites/summary',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    }
  });

  it('他人订单 / 地址 / 收藏夹一律 404，本人可正常读取', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const alice = await register(app, '13900000001', 'Alice');
    const bob = await register(app, '13900000002', 'Bob');

    // 地址：Bob 不能改 / 删 Alice 的地址
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/addresses',
      headers: auth(alice),
      payload: {
        receiverName: '张三',
        receiverPhone: '13800000001',
        province: '上海',
        city: '上海市',
        district: '浦东新区',
        detail: '测试路 1 号',
      },
    });
    expect(created.statusCode).toBe(201);
    const addressId = created.json().data.id as string;

    const bobPatch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/mall/addresses/${addressId}`,
      headers: auth(bob),
      payload: { receiverName: '李四' },
    });
    expect(bobPatch.statusCode).toBe(404);
    const bobDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/mall/addresses/${addressId}`,
      headers: auth(bob),
    });
    expect(bobDelete.statusCode).toBe(404);
    const bobList = await app.inject({ method: 'GET', url: '/api/v1/mall/addresses', headers: auth(bob) });
    expect(bobList.json().data).toHaveLength(0);

    // 收藏夹：Bob 读 / 改 / 清空 Alice 的收藏夹都是 404
    const folder = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/favorites/folders',
      headers: auth(alice),
      payload: { name: 'Alice 的夹子' },
    });
    expect(folder.statusCode).toBe(201);
    const folderId = folder.json().data.id as string;

    const bobItems = await app.inject({
      method: 'GET',
      url: `/api/v1/mall/favorites/items?folderId=${encodeURIComponent(folderId)}`,
      headers: auth(bob),
    });
    expect(bobItems.statusCode).toBe(404);
    const bobRename = await app.inject({
      method: 'PATCH',
      url: `/api/v1/mall/favorites/folders/${folderId}`,
      headers: auth(bob),
      payload: { name: '抢过来' },
    });
    expect(bobRename.statusCode).toBe(404);
    const bobClear = await app.inject({
      method: 'DELETE',
      url: `/api/v1/mall/favorites/folders/${folderId}/items`,
      headers: auth(bob),
    });
    expect(bobClear.statusCode).toBe(404);

    // 订单：Bob 读 / 取消 Alice 的订单都是 404
    const aliceUserId = (await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(alice) })).json().data
      .id as string;
    await seedOrder(ctx.store, aliceUserId, 'MO-SEC-0001');

    const bobOrder = await app.inject({
      method: 'GET',
      url: '/api/v1/mall/orders/MO-SEC-0001',
      headers: auth(bob),
    });
    expect(bobOrder.statusCode).toBe(404);
    const bobCancel = await app.inject({
      method: 'POST',
      url: '/api/v1/mall/orders/MO-SEC-0001/cancel',
      headers: auth(bob),
      payload: {},
    });
    expect(bobCancel.statusCode).toBe(404);

    const ownOrder = await app.inject({
      method: 'GET',
      url: '/api/v1/mall/orders/MO-SEC-0001',
      headers: auth(alice),
    });
    expect(ownOrder.statusCode).toBe(200);
    expect(ownOrder.json().data.orderNo).toBe('MO-SEC-0001');
  });
});

describe('支付：单号归属与幂等重放', () => {
  it('他人单号按不存在处理；同参重试回放同一张单；改金额仍冲突', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const alice = await register(app, '13900000011', 'Alice');
    const bob = await register(app, '13900000012', 'Bob');
    const outTradeNo = 'PAY-SEC-0001';

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/pay/orders',
      headers: auth(alice),
      payload: { channel: 'wechat', amountFen: 100, subject: '测试支付', outTradeNo },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().data.replayed).toBeUndefined();

    // 他人拿同一单号：404，不能借 409 探测单号是否存在
    const bobSame = await app.inject({
      method: 'POST',
      url: '/api/v1/pay/orders',
      headers: auth(bob),
      payload: { channel: 'wechat', amountFen: 100, subject: '测试支付', outTradeNo },
    });
    expect(bobSame.statusCode).toBe(404);
    expect(bobSame.json().error.code).toBe('NOT_FOUND');

    // 本人同参重试（重复点击）：回放原单，不新增行
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/pay/orders',
      headers: auth(alice),
      payload: { channel: 'wechat', amountFen: 100, subject: '测试支付', outTradeNo },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().data.replayed).toBe(true);
    expect(replay.json().data.outTradeNo).toBe(outTradeNo);
    const rows = await ctx.store.payments.findByOutTradeNo(outTradeNo);
    expect(rows?.amountFen).toBe(100);

    // 同单号换金额：冲突，不能被重放掩盖
    const changed = await app.inject({
      method: 'POST',
      url: '/api/v1/pay/orders',
      headers: auth(alice),
      payload: { channel: 'wechat', amountFen: 999, subject: '测试支付', outTradeNo },
    });
    expect(changed.statusCode).toBe(409);
  });

  it('Idempotency-Key 复用不产生第二张支付单，改金额则冲突', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const alice = await register(app, '13900000013', 'Alice');
    const headers = { ...auth(alice), 'idempotency-key': 'checkout-key-1' };
    const payload = { channel: 'alipay', amountFen: 500, subject: '幂等支付' };

    const first = await app.inject({ method: 'POST', url: '/api/v1/pay/orders', headers, payload });
    const second = await app.inject({ method: 'POST', url: '/api/v1/pay/orders', headers, payload });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().data.replayed).toBe(true);
    expect(second.json().data.outTradeNo).toBe(first.json().data.outTradeNo);

    const changed = await app.inject({
      method: 'POST',
      url: '/api/v1/pay/orders',
      headers,
      payload: { ...payload, amountFen: 501 },
    });
    expect(changed.statusCode).toBe(409);
  });
});

describe('上传：路径与文件类型白名单', () => {
  it('拒绝 svg/html/越界 key 与不匹配类型，正常图片可签发并可落盘', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mixmapp-upload-'));
    tempDirs.push(dir);
    app = await buildApp({
      config: { ...testConfig, storage: { ...testConfig.storage, localDir: dir } },
      store: new MemoryStore(),
      logger: false,
    });
    const token = await register(app, '13900000021', 'Uploader');

    const reject = async (key: string, contentType: string) => {
      const res = await app!.inject({
        method: 'POST',
        url: '/api/v1/storage/presign',
        headers: auth(token),
        payload: { key, contentType },
      });
      expect(res.statusCode, `${key} ${contentType}`).toBe(400);
    };
    await reject('evil.html', 'text/html');
    await reject('evil.svg', 'image/svg+xml');
    await reject('a.png', 'text/html');
    await reject('../outside.png', 'image/png');

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/storage/presign',
      headers: auth(token),
      payload: { key: 'a.png', contentType: 'image/png' },
    });
    expect(ok.statusCode).toBe(200);
    const signed = ok.json().data as { url: string; headers: Record<string, string> };
    const query = new URL(signed.url, 'http://localhost').search;

    // 预签名地址被改成其它类型上传：落盘前再次拒绝
    const wrongType = await app.inject({
      method: 'PUT',
      url: `/api/v1/storage/upload${query}`,
      headers: { 'content-type': 'text/html' },
      payload: '<script>alert(1)</script>',
    });
    expect(wrongType.statusCode).toBe(400);

    const uploaded = await app.inject({
      method: 'PUT',
      url: `/api/v1/storage/upload${query}`,
      headers: { 'content-type': 'image/png' },
      payload: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    expect(uploaded.statusCode).toBe(204);

    // 签名不对：403（无权限），与 401（未登录）区分
    const badSig = await app.inject({
      method: 'PUT',
      url: '/api/v1/storage/upload?key=a.png&exp=9999999999&sig=0123456789abcdef',
      headers: { 'content-type': 'image/png' },
      payload: Buffer.from([0x89]),
    });
    expect(badSig.statusCode).toBe(403);
  });
});

describe('限流：XFF 伪造不能重置桶，私有读不再豁免', () => {
  async function bootLimited(): Promise<void> {
    app = await buildApp({
      config: { ...testConfig, rateLimit: { perMinute: 2 } },
      store: new MemoryStore(),
      logger: false,
    });
  }

  it('伪造前置 XFF 段仍共用同一桶，第三次被 429', async () => {
    await bootLimited();
    const statuses: number[] = [];
    for (const [i, spoof] of ['1.1.1.1', '2.2.2.2', '3.3.3.3'].entries()) {
      const res = await app!.inject({
        method: 'POST',
        url: '/api/v1/auth/sms/code',
        headers: { 'x-forwarded-for': `${spoof}, 9.9.9.9` },
        payload: { phone: `1390000030${i}`, purpose: 'register' },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(200);
    expect(statuses[2]).toBe(429);
  });

  it('公开商品读不计入限流，订单私有读会计入', async () => {
    await bootLimited();
    for (let i = 0; i < 5; i += 1) {
      const res = await app!.inject({
        method: 'GET',
        url: '/api/v1/mall/products?pageSize=20',
        headers: { 'x-forwarded-for': '9.9.9.7' },
      });
      expect(res.statusCode).toBe(200);
    }

    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await app!.inject({
        method: 'GET',
        url: '/api/v1/mall/orders',
        headers: { 'x-forwarded-for': '9.9.9.8' },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses).toEqual([401, 401, 429]);
  });
});

describe('错误响应脱敏', () => {
  it('404 不回显请求路径，非法 JSON 不回显解析器原文', async () => {
    const ctx = await makeApp();
    app = ctx.app;

    const notFound = await app.inject({ method: 'GET', url: '/api/v1/%3Cscript%3Ealert(1)' });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json().error.message).toBe('未找到请求的资源');
    expect(notFound.body).not.toContain('script');

    const badJson = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/password',
      headers: { 'content-type': 'application/json' },
      payload: '{"account": "x", ',
    });
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json().error.message).toBe('请求不合法，请检查后重试');
    expect(badJson.body.toLowerCase()).not.toContain('json');
  });
});
