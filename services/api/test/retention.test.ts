import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  CartItemRecord,
  OrderItemRecord,
  OrderRecord,
  RefreshTokenRecord,
  SmsCodeRecord,
  Store,
  UserDeviceRecord,
} from '../src/db/types.js';
import { makeApp } from './helpers.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const DAY_MS = 24 * 3600 * 1000;
const ago = (days: number): Date => new Date(Date.now() - days * DAY_MS);
const ahead = (ms: number): Date => new Date(Date.now() + ms);

async function seed(store: Store, userId: string) {
  // 刷新令牌：一条过期 10 天，一条活跃
  const staleToken: RefreshTokenRecord = {
    tokenHash: 'hash-stale-refresh',
    userId,
    expiresAt: ago(10),
    revokedAt: null,
    replacedBy: null,
    createdAt: ago(10),
    deviceId: 'dev-stale',
    deviceModel: null,
    osName: null,
    osVersion: null,
    networkType: null,
    carrier: null,
    clientIp: null,
  };
  const activeToken: RefreshTokenRecord = {
    tokenHash: 'hash-active-refresh',
    userId,
    expiresAt: ahead(DAY_MS),
    revokedAt: null,
    replacedBy: null,
    createdAt: ago(1),
    deviceId: 'dev-active',
    deviceModel: null,
    osName: null,
    osVersion: null,
    networkType: null,
    carrier: null,
    clientIp: null,
  };
  await store.refreshTokens.insert(staleToken);
  await store.refreshTokens.insert(activeToken);

  // OAuth state：一条已消费 2 天，一条新鲜
  await store.oauthStates.insert({
    state: 'state-stale',
    provider: 'wechat',
    redirect: '',
    redirectUri: '',
    createdAt: ago(2),
    expiresAt: ago(2),
    consumedAt: ago(2),
  });
  await store.oauthStates.insert({
    state: 'state-fresh',
    provider: 'wechat',
    redirect: '',
    redirectUri: '',
    createdAt: new Date(),
    expiresAt: ahead(3600_000),
    consumedAt: null,
  });

  // 短信验证码：一条已消费 10 天，一条新鲜
  const staleSms: SmsCodeRecord = {
    id: 'sms-stale',
    phone: '13800004444',
    purpose: 'delete',
    codeHash: 'hash-sms-stale',
    attempts: 0,
    consumedAt: ago(10),
    expiresAt: ago(10),
    createdAt: ago(10),
  };
  const freshSms: SmsCodeRecord = {
    id: 'sms-fresh',
    phone: '13800004444',
    purpose: 'delete',
    codeHash: 'hash-sms-fresh',
    attempts: 0,
    consumedAt: null,
    expiresAt: ahead(3600_000),
    createdAt: new Date(),
  };
  await store.smsCodes.insert(staleSms);
  await store.smsCodes.insert(freshSms);

  // 注销挑战票据：一条已消费 2 天，一条新鲜
  await store.accountChallenges.insert({
    challenge: 'challenge-stale',
    userId,
    deviceId: 'dev-stale',
    expiresAt: ago(2),
    consumedAt: ago(2),
  });
  await store.accountChallenges.insert({
    challenge: 'challenge-fresh',
    userId,
    deviceId: 'dev-active',
    expiresAt: ahead(3600_000),
    consumedAt: null,
  });

  // 设备快照：一条 200 天无活跃会话，一条绑定活跃令牌
  const staleDevice: UserDeviceRecord = {
    userId,
    deviceId: 'dev-stale',
    deviceModel: '',
    osName: '',
    osVersion: '',
    networkType: 'none',
    carrier: '',
    clientIp: '127.0.0.1',
    updatedAt: ago(200),
  };
  const activeDevice: UserDeviceRecord = {
    userId,
    deviceId: 'dev-active',
    deviceModel: '',
    osName: '',
    osVersion: '',
    networkType: 'none',
    carrier: '',
    clientIp: '127.0.0.1',
    updatedAt: ago(1),
  };
  await store.userDevices.upsert(staleDevice);
  await store.userDevices.upsert(activeDevice);

  // 购物车：一条 100 天未动，一条新鲜
  const staleCart: CartItemRecord = {
    id: 'cart-stale',
    userId,
    productId: 'p1',
    quantity: 1,
    packUnit: null,
    packQty: null,
    createdAt: ago(100),
    updatedAt: ago(100),
  };
  const freshCart: CartItemRecord = {
    id: 'cart-fresh',
    userId,
    productId: 'p2',
    quantity: 1,
    packUnit: null,
    packQty: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await store.mall.carts.upsert(staleCart);
  await store.mall.carts.upsert(freshCart);

  // 订单：200 天前完结（应脱敏）、10 天前完结（保留 PII）、待支付（保留 PII）
  const completedStale: OrderRecord = {
    id: 'order-stale',
    orderNo: 'NO-STALE',
    userId,
    status: 'completed',
    totalFen: 200,
    receiverName: '李四',
    receiverPhone: '13800005555',
    address: '过期地址 1 号',
    addressId: null,
    deliveryMethod: 'express',
    deliverySlot: null,
    remark: '老备注',
    createdAt: ago(200),
    paidAt: ago(200),
    completedAt: ago(200),
  };
  const completedRecent: OrderRecord = {
    id: 'order-recent',
    orderNo: 'NO-RECENT',
    userId,
    status: 'completed',
    totalFen: 150,
    receiverName: '王五',
    receiverPhone: '13800006666',
    address: '近期地址 2 号',
    addressId: null,
    deliveryMethod: 'pickup',
    deliverySlot: null,
    remark: null,
    createdAt: ago(10),
    paidAt: ago(10),
    completedAt: ago(10),
  };
  const pending: OrderRecord = {
    id: 'order-pending',
    orderNo: 'NO-PENDING',
    userId,
    status: 'pending',
    totalFen: 80,
    receiverName: '赵六',
    receiverPhone: '13800007777',
    address: '待支付地址 3 号',
    addressId: null,
    deliveryMethod: 'express',
    deliverySlot: null,
    remark: null,
    createdAt: new Date(),
    paidAt: null,
  };
  const item: OrderItemRecord = {
    id: 'item-stale',
    orderId: 'order-stale',
    productId: 'p1',
    title: '过期商品',
    priceFen: 200,
    quantity: 1,
    subtotalFen: 200,
  };
  await store.mall.orders.insert(completedStale, [item]);
  await store.mall.orders.insert(completedRecent, []);
  await store.mall.orders.insert(pending, []);
}

describe('个人数据留存清理任务', () => {
  it('首轮清理到期数据并保留活跃/近期数据；第二轮全部为 0（幂等）', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const store = ctx.store;
    const userId = 'retention-user-1';
    await seed(store, userId);

    const first = await app.retention.sweep();
    expect(first.refreshTokens).toBe(1);
    expect(first.oauthStates).toBe(1);
    expect(first.smsCodes).toBe(1);
    expect(first.userDevices).toBe(1);
    expect(first.carts).toBe(1);
    expect(first.ordersPii).toBe(1);
    expect(first.deletionChallenges).toBe(1);

    // 活跃/近期数据保留
    const activeTokens = await store.refreshTokens.listByUser(userId, 10);
    expect(activeTokens.map((t) => t.tokenHash)).toEqual(['hash-active-refresh']);
    const devices = await store.userDevices.listByUser(userId);
    expect(devices.map((d) => d.deviceId)).toEqual(['dev-active']);
    const carts = await store.mall.carts.listByUser(userId);
    expect(carts.map((c) => c.id)).toEqual(['cart-fresh']);

    // 到期订单 PII 被清空，金额/商品/状态/时间保留；user_id 保留归属，历史订单仍可在「我的订单」查看
    const staleOrder = await store.mall.orders.findByOrderNo('NO-STALE');
    expect(staleOrder).not.toBeNull();
    expect(staleOrder?.userId).toBe(userId);
    expect(staleOrder?.receiverName).toBe('');
    expect(staleOrder?.receiverPhone).toBe('');
    expect(staleOrder?.address).toBe('');
    expect(staleOrder?.remark).toBeNull();
    expect(staleOrder?.totalFen).toBe(200);
    expect(staleOrder?.status).toBe('completed');
    expect(staleOrder?.completedAt).toBeInstanceOf(Date);
    const staleItems = await store.mall.orders.itemsByOrder('order-stale');
    expect(staleItems[0]!.title).toBe('过期商品');

    // 近期完结与待支付订单的 PII 原样保留
    const recentOrder = await store.mall.orders.findByOrderNo('NO-RECENT');
    expect(recentOrder?.receiverName).toBe('王五');
    expect(recentOrder?.receiverPhone).toBe('13800006666');
    const pendingOrder = await store.mall.orders.findByOrderNo('NO-PENDING');
    expect(pendingOrder?.receiverName).toBe('赵六');

    // 第二轮：全部任务影响行数为 0
    const second = await app.retention.sweep();
    expect(second.refreshTokens).toBe(0);
    expect(second.oauthStates).toBe(0);
    expect(second.smsCodes).toBe(0);
    expect(second.userDevices).toBe(0);
    expect(second.carts).toBe(0);
    expect(second.ordersPii).toBe(0);
    expect(second.deletionChallenges).toBe(0);
  });
});
