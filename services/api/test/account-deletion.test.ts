import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sha256Hex } from '../src/lib/crypto.js';
import type {
  AddressRecord,
  CartItemRecord,
  FavoriteFolderRecord,
  FavoriteItemRecord,
  OrderItemRecord,
  OrderRecord,
  PaymentRecord,
  PushTokenRecord,
  Store,
  UserRecord,
} from '../src/db/types.js';
import { makeApp } from './helpers.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const now = () => new Date();

async function registerEmailUser(
  instance: FastifyInstance,
  email: string,
  password: string,
  nickname = '注销测试',
) {
  const res = await instance.inject({
    method: 'POST',
    url: '/api/v1/auth/register/email',
    payload: { email, password, nickname },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as {
    user: { id: string };
    tokens: { accessToken: string; refreshToken: string };
  };
}

async function registerPhoneUser(instance: FastifyInstance, phone: string) {
  const code = await instance.auth.requestSmsCode(phone, 'register');
  const res = await instance.inject({
    method: 'POST',
    url: '/api/v1/auth/register/phone',
    payload: { phone, code: code.devCode as string },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as {
    user: { id: string };
    tokens: { accessToken: string; refreshToken: string };
  };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function seedPersonalData(store: Store, userId: string) {
  const at = now();
  await store.bindings.insert({
    id: 'bind-1',
    userId,
    provider: 'wechat',
    openId: 'open-id-1',
    unionId: null,
    nickname: null,
    avatarUrl: null,
    createdAt: at,
  });
  await store.userDevices.upsert({
    userId,
    deviceId: 'dev-1',
    deviceModel: 'Pixel 8',
    osName: 'Android',
    osVersion: '14',
    networkType: 'wifi',
    carrier: '',
    clientIp: '127.0.0.1',
    updatedAt: at,
  });
  const address: AddressRecord = {
    id: 'addr-1',
    userId,
    receiverName: '张三',
    receiverPhone: '13800001111',
    province: '浙江省',
    city: '宁波市',
    district: '鄞州区',
    detail: '测试路 1 号',
    isDefault: true,
    createdAt: at,
    updatedAt: at,
  };
  await store.mall.addresses.insert(address);
  const cart: CartItemRecord = {
    id: 'cart-1',
    userId,
    productId: 'p1',
    quantity: 2,
    packUnit: null,
    packQty: null,
    createdAt: at,
    updatedAt: at,
  };
  await store.mall.carts.upsert(cart);
  const folder: FavoriteFolderRecord = {
    id: 'fav-folder-1',
    userId,
    name: '默认收藏',
    isDefault: true,
    createdAt: at,
    updatedAt: at,
  };
  await store.mall.favorites.insertFolder(folder);
  const item: FavoriteItemRecord = {
    id: 'fav-item-1',
    folderId: folder.id,
    userId,
    productId: 'p1',
    createdAt: at,
  };
  await store.mall.favorites.insertItem(item);
  const push: PushTokenRecord = {
    id: 'push-1',
    userId,
    provider: 'fcm',
    platform: 'android',
    token: 'push-token-secret',
    createdAt: at,
  };
  await store.pushTokens.upsert(push);

  const order: OrderRecord = {
    id: 'order-1',
    orderNo: 'NO-1',
    userId,
    status: 'completed',
    totalFen: 100,
    receiverName: '张三',
    receiverPhone: '13800001111',
    address: '浙江省宁波市鄞州区测试路 1 号',
    addressId: null,
    deliveryMethod: 'express',
    deliverySlot: 'morning',
    remark: '放门口',
    createdAt: at,
    paidAt: at,
    completedAt: at,
  };
  const orderItem: OrderItemRecord = {
    id: 'order-item-1',
    orderId: order.id,
    productId: 'p1',
    title: '测试商品',
    priceFen: 100,
    quantity: 1,
    subtotalFen: 100,
  };
  await store.mall.orders.insert(order, [orderItem]);
  const payment: PaymentRecord = {
    id: 'pay-1',
    outTradeNo: 'OTN-1',
    userId,
    channel: 'wechat',
    amountFen: 100,
    subject: '测试商品',
    status: 'paid',
    prepay: null,
    transactionId: 'TXN-1',
    paidAt: at,
    createdAt: at,
  };
  await store.payments.insert(payment);
  await store.mall.orderRequests.claim(userId, 'demo-key');
}

describe('账号注销：密码方式级联删除与脱敏', () => {
  it('注销成功后各表无残留、全部会话失效、订单/支付留行脱敏，重复调用返回已注销', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const store = ctx.store;
    const account = await registerEmailUser(app, 'delete-pwd@mixm.app', 'Passw0rd!x');
    const userId = account.user.id;
    await seedPersonalData(store, userId);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account/delete',
      headers: authHeader(account.tokens.accessToken),
      payload: { method: 'password', password: 'Passw0rd!x', confirm: '注销' },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.deleted).toBe(true);
    expect(data.revokedSessions).toBeGreaterThanOrEqual(1);
    expect(data.ordersAnonymized).toBe(1);
    expect(data.purged.binds).toBe(1);
    expect(data.purged.devices).toBe(1);
    expect(data.purged.addresses).toBe(1);
    expect(data.purged.favorites).toBe(1);
    expect(data.purged.carts).toBe(1);
    expect(data.purged.pushTokens).toBe(1);

    // 账号行与个人数据全部清除
    expect(await store.users.findById(userId)).toBeNull();
    expect(await store.bindings.listByUser(userId)).toHaveLength(0);
    expect(await store.refreshTokens.listActiveByUser(userId)).toHaveLength(0);
    expect(await store.userDevices.listByUser(userId)).toHaveLength(0);
    expect(await store.mall.addresses.listByUser(userId)).toHaveLength(0);
    expect(await store.mall.carts.listByUser(userId)).toHaveLength(0);
    expect(await store.mall.favorites.listFolders(userId)).toHaveLength(0);
    expect(await store.pushTokens.listByUser(userId)).toHaveLength(0);
    const requestAgain = await store.mall.orderRequests.claim(userId, 'demo-key');
    expect(requestAgain.claimed).toBe(true);

    // 旧刷新令牌立即失效
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: account.tokens.refreshToken },
    });
    expect(refreshRes.statusCode).toBe(401);
    expect(await store.refreshTokens.findByHash(sha256Hex(account.tokens.refreshToken))).toBeNull();

    // 订单留行：可识别字段清空，金额/商品/状态/时间保留
    const order = await store.mall.orders.findByOrderNo('NO-1');
    expect(order).not.toBeNull();
    expect(order?.userId).toBeNull();
    expect(order?.receiverName).toBe('');
    expect(order?.receiverPhone).toBe('');
    expect(order?.address).toBe('');
    expect(order?.remark).toBeNull();
    expect(order?.totalFen).toBe(100);
    expect(order?.status).toBe('completed');
    expect(order?.completedAt).toBeInstanceOf(Date);
    const items = await store.mall.orders.itemsByOrder(order!.id);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('测试商品');

    // 支付留行：user_id 置空，流水号与金额保留
    const payment = await store.payments.findByOutTradeNo('OTN-1');
    expect(payment).not.toBeNull();
    expect(payment?.userId).toBeNull();
    expect(payment?.transactionId).toBe('TXN-1');
    expect(payment?.amountFen).toBe(100);

    // 重复调用：账号已注销
    const repeat = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account/delete',
      headers: authHeader(account.tokens.accessToken),
      payload: { method: 'password', password: 'Passw0rd!x', confirm: '注销' },
    });
    expect(repeat.statusCode).toBe(404);
    expect(repeat.json().error.code).toBe('ACCOUNT_ALREADY_DELETED');
  });

  it('密码错误 / 确认文案错误 / 方式不被允许时不删除任何数据', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const store = ctx.store;
    const account = await registerEmailUser(app, 'delete-fail@mixm.app', 'Passw0rd!x');
    const userId = account.user.id;
    await seedPersonalData(store, userId);

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account/delete',
      headers: authHeader(account.tokens.accessToken),
      payload: { method: 'password', password: 'wrongpass1', confirm: '注销' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongPassword.json().error.code).toBe('DELETE_VERIFY_FAILED');

    const badConfirm = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account/delete',
      headers: authHeader(account.tokens.accessToken),
      payload: { method: 'password', password: 'Passw0rd!x', confirm: '确认删除' },
    });
    expect(badConfirm.statusCode).toBe(422);
    expect(badConfirm.json().error.code).toBe('DELETE_CONFIRM_REQUIRED');

    // 邮箱账号没有绑定手机，短信方式不被允许
    const smsNotAllowed = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account/delete',
      headers: authHeader(account.tokens.accessToken),
      payload: { method: 'sms', code: '123456', confirm: '注销' },
    });
    expect(smsNotAllowed.statusCode).toBe(403);
    expect(smsNotAllowed.json().error.code).toBe('DELETE_METHOD_NOT_ALLOWED');

    // 失败后数据原样保留
    expect(await store.users.findById(userId)).not.toBeNull();
    expect(await store.bindings.listByUser(userId)).toHaveLength(1);
    expect(await store.mall.addresses.listByUser(userId)).toHaveLength(1);
    expect(await store.mall.carts.listByUser(userId)).toHaveLength(1);
    expect(await store.pushTokens.listByUser(userId)).toHaveLength(1);
    expect(await store.mall.orders.findByOrderNo('NO-1')).not.toBeNull();
  });
});

describe('账号注销：短信方式', () => {
  it('验证码正确后注销成功；错误验证码不删数据', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const store = ctx.store;
    const phone = '13800002222';
    const account = await registerPhoneUser(app, phone);
    const userId = account.user.id;
    await seedPersonalData(store, userId);

    const wrongCode = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account/delete',
      headers: authHeader(account.tokens.accessToken),
      payload: { method: 'sms', code: '000000', confirm: '注销' },
    });
    expect(wrongCode.statusCode).toBe(401);
    expect(wrongCode.json().error.code).toBe('DELETE_VERIFY_FAILED');
    expect(await store.users.findById(userId)).not.toBeNull();

    const code = await app.auth.requestSmsCode(phone, 'delete');
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account/delete',
      headers: authHeader(account.tokens.accessToken),
      payload: { method: 'sms', code: code.devCode as string, confirm: '注销' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.deleted).toBe(true);
    expect(await store.users.findById(userId)).toBeNull();
    expect(await store.mall.addresses.listByUser(userId)).toHaveLength(0);
  });
});

describe('账号注销：设备强确认方式', () => {
  it('deviceId 与最近快照一致 + 一次性票据通过后注销；票据/设备不符失败且不删数据', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const store = ctx.store;
    const account = await registerEmailUser(app, 'delete-dev@mixm.app', 'Passw0rd!x');
    const userId = account.user.id;
    await seedPersonalData(store, userId);

    // 设备不符：挑战票据直接拒绝
    const mismatch = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account/delete-challenge',
      headers: authHeader(account.tokens.accessToken),
      payload: { deviceId: 'dev-other' },
    });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json().error.code).toBe('DELETE_DEVICE_MISMATCH');

    const challengeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account/delete-challenge',
      headers: authHeader(account.tokens.accessToken),
      payload: { deviceId: 'dev-1' },
    });
    expect(challengeRes.statusCode).toBe(200);
    const challenge = challengeRes.json().data.challenge as string;

    // 错误票据
    const badChallenge = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account/delete',
      headers: authHeader(account.tokens.accessToken),
      payload: { method: 'device', deviceId: 'dev-1', challenge: 'not-a-challenge', confirm: '注销' },
    });
    expect(badChallenge.statusCode).toBe(410);
    expect(badChallenge.json().error.code).toBe('DELETE_CHALLENGE_INVALID');
    expect(await store.users.findById(userId)).not.toBeNull();

    // 设备不符的删除请求
    const deviceMismatch = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account/delete',
      headers: authHeader(account.tokens.accessToken),
      payload: { method: 'device', deviceId: 'dev-other', challenge, confirm: '注销' },
    });
    expect(deviceMismatch.statusCode).toBe(422);
    expect(deviceMismatch.json().error.code).toBe('DELETE_DEVICE_MISMATCH');

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account/delete',
      headers: authHeader(account.tokens.accessToken),
      payload: { method: 'device', deviceId: 'dev-1', challenge, confirm: '注销' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.deleted).toBe(true);
    expect(await store.users.findById(userId)).toBeNull();
    expect(await store.userDevices.listByUser(userId)).toHaveLength(0);
  });
});

describe('账号注销：无设备快照的游客账号兜底注销', () => {
  it('无快照账号可凭一次性票据 + 逐字确认完成注销，旧会话立即失效', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const store = ctx.store;

    const guestRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/guest',
      payload: { deviceId: 'guest-device-01' },
    });
    expect(guestRes.statusCode).toBeGreaterThanOrEqual(200);
    expect(guestRes.statusCode).toBeLessThan(300);
    const guest = guestRes.json().data as {
      user: { id: string };
      tokens: { accessToken: string; refreshToken: string };
    };
    const userId = guest.user.id;

    // 游客注册未带设备上下文：没有可比对的设备快照，也没有密码/手机
    expect(await store.userDevices.latest(userId)).toBeNull();

    const options = await app.inject({
      method: 'GET',
      url: '/api/v1/me/account/deletion-options',
      headers: authHeader(guest.tokens.accessToken),
    });
    expect(options.statusCode).toBe(200);
    const methods = options.json().data.methods as string[];
    expect(methods).toEqual(expect.arrayContaining(['device']));
    expect(methods).not.toContain('password');
    expect(methods).not.toContain('sms');

    const challengeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account/delete-challenge',
      headers: authHeader(guest.tokens.accessToken),
      payload: { deviceId: 'guest-device-01' },
    });
    expect(challengeRes.statusCode).toBe(200);
    const challenge = challengeRes.json().data.challenge as string;

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/me/account/delete',
      headers: authHeader(guest.tokens.accessToken),
      payload: { method: 'device', deviceId: 'guest-device-01', challenge, confirm: '注销' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.deleted).toBe(true);
    expect(await store.users.findById(userId)).toBeNull();

    // 旧刷新令牌立即失效
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: guest.tokens.refreshToken },
    });
    expect(refreshRes.statusCode).toBe(401);
  });
});

describe('注销方式可选性查询', () => {
  it('返回当前账号可用方式：密码账号有 password，手机账号有 sms，始终带 device', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const emailAccount = await registerEmailUser(app, 'options-email@mixm.app', 'Passw0rd!x');
    const emailOptions = await app.inject({
      method: 'GET',
      url: '/api/v1/me/account/deletion-options',
      headers: authHeader(emailAccount.tokens.accessToken),
    });
    expect(emailOptions.statusCode).toBe(200);
    expect(emailOptions.json().data.methods).toEqual(expect.arrayContaining(['password', 'device']));
    expect(emailOptions.json().data.methods).not.toContain('sms');

    const phone = '13800003333';
    const phoneAccount = await registerPhoneUser(app, phone);
    const phoneOptions = await app.inject({
      method: 'GET',
      url: '/api/v1/me/account/deletion-options',
      headers: authHeader(phoneAccount.tokens.accessToken),
    });
    expect(phoneOptions.json().data.methods).toEqual(expect.arrayContaining(['sms', 'device']));
    expect(phoneOptions.json().data.phone).toBe('138****3333');
  });
});
