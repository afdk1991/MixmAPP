import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { MemoryStore } from '../src/db/memory.js';
import { PayService } from '../src/modules/pay.js';
import { generateRsaKeyPair } from '../src/lib/crypto.js';

function makeConfig(patch: Partial<Config>): Config {
  return { ...loadConfig(), ...patch };
}

const emptyPay: Config['pay'] = {
  wechat: {
    appId: '',
    mchId: '',
    serialNo: '',
    privateKey: '',
    apiV3Key: '',
    platformPublicKey: '',
    notifyUrl: '',
  },
  alipay: { appId: '', privateKey: '', alipayPublicKey: '', notifyUrl: '' },
};

describe('支付下单：无凭据时不留扣款入口', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('生产环境未配置商户凭据：直接 503，且不落任何支付单', async () => {
    const store = new MemoryStore();
    const pay = new PayService(makeConfig({ env: 'production', pay: emptyPay }), store);
    await expect(
      pay.createOrder('u1', { channel: 'wechat', amountFen: 100, subject: '测试' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_DISABLED' });
    expect(await store.payments.listByUser('u1')).toHaveLength(0);
  });

  it('非生产环境：返回 dev mock 并标明不会真实扣款', async () => {
    const store = new MemoryStore();
    const pay = new PayService(makeConfig({ env: 'test', pay: emptyPay }), store);
    const result = await pay.createOrder('u1', { channel: 'alipay', amountFen: 100, subject: '测试' });
    expect(result.mode).toBe('dev');
    expect((result.payload as { mock?: boolean }).mock).toBe(true);
    expect(await store.payments.listByUser('u1')).toHaveLength(1);
  });

  it('非法商户订单号在调用上游前就被拒绝', async () => {
    const store = new MemoryStore();
    const pay = new PayService(makeConfig({ env: 'test', pay: emptyPay }), store);
    await expect(
      pay.createOrder('u1', { channel: 'wechat', amountFen: 100, subject: '测试', outTradeNo: 'a b' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('重复商户订单号返回冲突', async () => {
    const store = new MemoryStore();
    const pay = new PayService(makeConfig({ env: 'test', pay: emptyPay }), store);
    await pay.createOrder('u1', { channel: 'wechat', amountFen: 100, subject: '测试', outTradeNo: 'MX-DUP-1' });
    await expect(
      pay.createOrder('u1', { channel: 'wechat', amountFen: 100, subject: '测试', outTradeNo: 'MX-DUP-1' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('微信凭据齐全时走真实下单并回传调起参数（上游用桩代替）', async () => {
    const keys = generateRsaKeyPair();
    const fetchStub = vi.fn(async () => {
      return new Response(JSON.stringify({ prepay_id: 'wx-prepay-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchStub);
    const store = new MemoryStore();
    const pay = new PayService(
      makeConfig({
        env: 'test',
        pay: {
          ...emptyPay,
          wechat: {
            appId: 'wx-app',
            mchId: 'mch-1',
            serialNo: 'SN',
            privateKey: keys.privateKey,
            apiV3Key: 'a'.repeat(32),
            platformPublicKey: keys.publicKey,
            notifyUrl: 'https://example.com/notify/wechat',
          },
        },
      }),
      store,
    );
    const result = await pay.createOrder('u1', {
      channel: 'wechat',
      amountFen: 1999,
      subject: '测试商品',
      outTradeNo: 'MX-LIVE-1',
    });
    expect(result.mode).toBe('live');
    expect(result.payload).toMatchObject({ prepayid: 'wx-prepay-1', appid: 'wx-app', partnerid: 'mch-1' });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/v3/pay/transactions/app');
    const body = JSON.parse(String(init.body)) as { amount: { total: number }; out_trade_no: string };
    expect(body.amount.total).toBe(1999);
    expect(body.out_trade_no).toBe('MX-LIVE-1');
    const authorization = String((init.headers as Record<string, string>)['authorization']);
    expect(authorization.startsWith('WECHATPAY2-SHA256-RSA2048 ')).toBe(true);
    expect(await store.payments.listByUser('u1')).toHaveLength(1);
  });

  it('上游下单失败时不留下待支付孤儿订单', async () => {
    const keys = generateRsaKeyPair();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: '签名错误' }), { status: 401 })));
    const store = new MemoryStore();
    const pay = new PayService(
      makeConfig({
        env: 'test',
        pay: {
          ...emptyPay,
          wechat: {
            appId: 'wx-app',
            mchId: 'mch-1',
            serialNo: 'SN',
            privateKey: keys.privateKey,
            apiV3Key: 'a'.repeat(32),
            platformPublicKey: keys.publicKey,
            notifyUrl: 'https://example.com/notify/wechat',
          },
        },
      }),
      store,
    );
    await expect(
      pay.createOrder('u1', { channel: 'wechat', amountFen: 100, subject: '测试' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(await store.payments.listByUser('u1')).toHaveLength(0);
  });
});
