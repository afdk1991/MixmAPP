import { describe, expect, it } from 'vitest';
import { IdFactory } from '@mixmapp/ids';
import { FakeOAuth, makeApp, testConfig } from './helpers.js';
import { AccountMergeService } from '../src/modules/account-merge.js';
import type { CartItemRecord, OrderRecord, Store, UserRecord } from '../src/db/types.js';

const PHONE = '13800002222';

function newIds() {
  return new IdFactory({ strategy: testConfig.ids.strategy, workerId: testConfig.ids.workerId });
}

function cart(id: string, userId: string, productId: string, quantity: number): CartItemRecord {
  const now = new Date();
  return {
    id,
    userId,
    productId,
    quantity,
    packUnit: null,
    packQty: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function addOrder(store: Store, id: string, userId: string): Promise<OrderRecord> {
  const order: OrderRecord = {
    id,
    orderNo: `NO-${id}`,
    userId,
    status: 'pending',
    totalFen: 100,
    receiverName: '测试',
    receiverPhone: '13800000000',
    address: '测试地址',
    remark: null,
    createdAt: new Date(),
    paidAt: null,
  };
  return store.mall.orders.insert(order, [
    {
      id: `${id}-item`,
      orderId: id,
      productId: 'p1',
      title: '测试商品',
      priceFen: 100,
      quantity: 1,
      subtotalFen: 100,
    },
  ]);
}

/** 公众号渠道未被配置时不会启用，测试里注入口径相同的 FakeOAuth。 */
async function makeAppWithMp() {
  return makeApp({
    oauth: {
      wechat_mp: new FakeOAuth('wechat_mp', {
        openId: 'wx-mp-open-1',
        unionId: 'un-1',
        nickname: '公众号测试',
        avatarUrl: null,
      }),
    },
  });
}

describe('账号合并：同一手机号的微信 + QQ + GitHub', () => {
  it('绑定手机号时合并到手机号账号，三个渠道与双方数据都保留', async () => {
    const { app, store } = await makeApp();
    const sms = await app.auth.requestSmsCode(PHONE, 'register');
    const registered = await app.auth.registerByPhone({ phone: PHONE, code: sms.devCode as string });
    const primary = (await store.users.findById(registered.user.id)) as UserRecord;

    // 微信先落地一个独立账号（没有手机号），再手动绑定 QQ / GitHub。
    const wechat = await app.auth.loginByOAuth({ provider: 'wechat', code: 'any' });
    const secondary = (await store.users.findById(wechat.user.id)) as UserRecord;
    expect(secondary.id).not.toBe(primary.id);

    await app.auth.linkOAuth(secondary.id, 'qq', 'any');
    await app.auth.linkOAuth(secondary.id, 'github', 'any');

    // 两个账号各自有订单与购物车；同一商品 p1 数量需要相加。
    await addOrder(store, 'order-p', primary.id);
    await addOrder(store, 'order-s', secondary.id);
    await store.mall.carts.upsert(cart('cart-p', primary.id, 'p1', 2));
    await store.mall.carts.upsert(cart('cart-s', secondary.id, 'p1', 3));
    await store.mall.carts.upsert(cart('cart-s2', secondary.id, 'p2', 1));

    const bindCode = await app.auth.requestSmsCode(PHONE, 'bind');
    const result = await app.auth.bindPhone(secondary.id, PHONE, bindCode.devCode as string);

    expect(result.user.id).toBe(primary.id);
    expect(result.merged).not.toBeNull();
    expect(result.tokens.accessToken).toBeTruthy();

    // 次账号已删除，旧标识失效。
    expect(await store.users.findById(secondary.id)).toBeNull();

    // 三种第三方登录现在都落到同一个账号。
    const owners = await Promise.all(
      (['wechat', 'qq', 'github'] as const).map(async (provider) => {
        const login = await app.auth.loginByOAuth({ provider, code: 'any' });
        return login.user.id;
      }),
    );
    expect(new Set(owners)).toEqual(new Set([primary.id]));

    // 数据不丢：订单都在，购物车同商品数量相加。
    const orders = await store.mall.orders.listByUser(primary.id);
    expect(orders.map((o) => o.id).sort()).toEqual(['order-p', 'order-s']);
    const carts = await store.mall.carts.listByUser(primary.id);
    const byProduct = new Map(carts.map((c) => [c.productId, c.quantity]));
    expect(byProduct.get('p1')).toBe(5);
    expect(byProduct.get('p2')).toBe(1);

    // 审计：completed + 快照 + 冲突策略可查。
    const [record] = await store.merges.list(5);
    expect(record?.status).toBe('completed');
    expect(record?.snapshot.secondary.id).toBe(secondary.id);
    expect(record?.moved?.cartConflicts[0]).toMatchObject({
      productId: 'p1',
      primaryQty: 2,
      secondaryQty: 3,
      resultQty: 5,
    });
    expect(record?.conflictStrategy.orders).toContain('保留');
  });

  it('同一 mergeKey 重放不会二次迁移', async () => {
    const { app, store } = await makeApp();
    const sms = await app.auth.requestSmsCode(PHONE, 'register');
    const registered = await app.auth.registerByPhone({ phone: PHONE, code: sms.devCode as string });
    const primary = (await store.users.findById(registered.user.id)) as UserRecord;
    const wechat = await app.auth.loginByOAuth({ provider: 'wechat', code: 'any' });
    const secondary = (await store.users.findById(wechat.user.id)) as UserRecord;
    await store.mall.carts.upsert(cart('cart-p', primary.id, 'p1', 2));
    await store.mall.carts.upsert(cart('cart-s', secondary.id, 'p1', 3));

    const service = new AccountMergeService(store, newIds());
    const first = await service.merge({
      primaryUserId: primary.id,
      secondaryUserId: secondary.id,
      reason: 'bind_phone',
      mergeKey: `bind_phone:${primary.id}:${secondary.id}`,
      requirePrimaryPhone: PHONE,
    });
    expect(first.replayed).toBe(false);

    const replay = await service.merge({
      primaryUserId: primary.id,
      secondaryUserId: secondary.id,
      reason: 'bind_phone',
      mergeKey: `bind_phone:${primary.id}:${secondary.id}`,
      requirePrimaryPhone: PHONE,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.merge.id).toBe(first.merge.id);
    const carts = await store.mall.carts.listByUser(primary.id);
    expect(carts.find((c) => c.productId === 'p1')?.quantity).toBe(5);
    void app;
  });

  it('迁移失败时按快照回滚，不会留下半合并状态', async () => {
    const { app, store } = await makeApp();
    const sms = await app.auth.requestSmsCode(PHONE, 'register');
    const registered = await app.auth.registerByPhone({ phone: PHONE, code: sms.devCode as string });
    const primary = (await store.users.findById(registered.user.id)) as UserRecord;
    const wechat = await app.auth.loginByOAuth({ provider: 'wechat', code: 'any' });
    const secondary = (await store.users.findById(wechat.user.id)) as UserRecord;
    await addOrder(store, 'order-p', primary.id);
    await addOrder(store, 'order-s', secondary.id);
    await store.mall.carts.upsert(cart('cart-p', primary.id, 'p1', 2));
    await store.mall.carts.upsert(cart('cart-s', secondary.id, 'p1', 3));

    const originalDelete = store.users.delete.bind(store.users);
    store.users.delete = async () => {
      throw new Error('模拟数据库故障');
    };
    const bindCode = await app.auth.requestSmsCode(PHONE, 'bind');
    await expect(
      app.auth.bindPhone(secondary.id, PHONE, bindCode.devCode as string),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    store.users.delete = originalDelete;

    // 两个账号都还在，数据各自回到原处。
    expect(await store.users.findById(primary.id)).not.toBeNull();
    expect(await store.users.findById(secondary.id)).not.toBeNull();
    expect((await store.mall.orders.listByUser(primary.id)).map((o) => o.id)).toEqual(['order-p']);
    expect((await store.mall.orders.listByUser(secondary.id)).map((o) => o.id)).toEqual(['order-s']);
    expect((await store.mall.carts.listByUser(primary.id))[0]?.quantity).toBe(2);
    expect((await store.mall.carts.listByUser(secondary.id))[0]?.quantity).toBe(3);

    const [record] = await store.merges.list(1);
    expect(record?.status).toBe('failed');
    expect(record?.error).toContain('模拟数据库故障');
  });

  it('管理员回滚按快照还原两个账号', async () => {
    const { app, store } = await makeApp();
    const sms = await app.auth.requestSmsCode(PHONE, 'register');
    const registered = await app.auth.registerByPhone({ phone: PHONE, code: sms.devCode as string });
    const primary = (await store.users.findById(registered.user.id)) as UserRecord;
    const wechat = await app.auth.loginByOAuth({ provider: 'wechat', code: 'any' });
    const secondary = (await store.users.findById(wechat.user.id)) as UserRecord;
    await addOrder(store, 'order-p', primary.id);
    await addOrder(store, 'order-s', secondary.id);
    await store.mall.carts.upsert(cart('cart-p', primary.id, 'p1', 2));
    await store.mall.carts.upsert(cart('cart-s', secondary.id, 'p1', 3));

    const service = new AccountMergeService(store, newIds());
    const merged = await service.merge({
      primaryUserId: primary.id,
      secondaryUserId: secondary.id,
      reason: 'bind_phone',
      mergeKey: `bind_phone:${primary.id}:${secondary.id}`,
      requirePrimaryPhone: PHONE,
    });
    await service.rollback(merged.merge.id);

    expect((await store.users.findById(secondary.id))?.accountNo).toBe(secondary.accountNo);
    expect((await store.mall.orders.listByUser(primary.id)).map((o) => o.id)).toEqual(['order-p']);
    expect((await store.mall.orders.listByUser(secondary.id)).map((o) => o.id)).toEqual(['order-s']);
    expect((await store.merges.findById(merged.merge.id))?.status).toBe('rolled_back');
    void app;
  });
});

describe('第三方登录归并顺序', () => {
  it('union_id 相同则挂到同一账号，不新建账号', async () => {
    const { app, store } = await makeAppWithMp();
    const first = await app.auth.loginByOAuth({ provider: 'wechat', code: 'any' });
    expect(first.isNewUser).toBe(true);
    expect(await store.users.findById(first.user.id)).not.toBeNull();

    // wechat 的 union_id 与 wechat_mp 共享，后者首次登录应归到同一账号。
    const mp = await app.auth.loginByOAuth({ provider: 'wechat_mp', code: 'any' });
    expect(mp.user.id).toBe(first.user.id);
    expect(mp.isNewUser).toBe(false);
    const bindings = await store.bindings.listByUser(first.user.id);
    expect(bindings.map((b) => b.provider).sort()).toEqual(['wechat', 'wechat_mp']);
  });

  it('union_id 命中多个账号时报 MERGE_REQUIRED，不静默合并', async () => {
    const { app, store } = await makeAppWithMp();
    const first = await app.auth.loginByOAuth({ provider: 'wechat', code: 'any' });
    // 另一个账号（QQ 登录）手工挂上同一 union_id，模拟历史重复数据。
    const other = await app.auth.loginByOAuth({ provider: 'qq', code: 'any' });
    const bindingId = newIds().next().id;
    await store.bindings.insert({
      id: bindingId,
      userId: other.user.id,
      provider: 'github',
      openId: 'gh-dup',
      unionId: 'un-1',
      nickname: null,
      avatarUrl: null,
      createdAt: new Date(),
    });

    await expect(
      app.auth.loginByOAuth({ provider: 'wechat_mp', code: 'any' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { mergeRequired: true } });

    const candidates = await app.auth.mergeCandidates();
    expect(candidates.count).toBe(1);
    expect(candidates.candidates[0]?.userIds.sort()).toEqual([first.user.id, other.user.id].sort());
  });
});
