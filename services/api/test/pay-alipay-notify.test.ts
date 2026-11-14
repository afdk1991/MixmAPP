import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStore } from '../src/db/memory.js';
import { testConfig } from './helpers.js';
import { generateRsaKeyPair, rsaSign } from '../src/lib/crypto.js';
import { buildAlipaySignContent } from '../src/adapters/pay/alipay.js';

/**
 * 支付宝异步通知走 application/x-www-form-urlencoded。
 * 全局 `*` content parser 原本把所有 body 收成 Buffer，回调处理器直接把 Buffer 当参数表读，
 * 导致 sign / out_trade_no 全部取不到，验签必然失败——线上一旦开通支付宝，回调永远 400 fail。
 * 本用例用本地 RSA 密钥对签出一份合法表单，证明参数被正确解析、验签通过、金额核对后落已支付。
 */
describe('支付宝回调（form-urlencoded 解析与幂等）', () => {
  const keys = generateRsaKeyPair();
  const notifyUrl = 'http://localhost:8080/api/v1/pay/notify/alipay';
  const store = new MemoryStore();
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const payConfig = {
    ...testConfig.pay,
    alipay: {
      appId: '2021000000000000',
      privateKey: keys.privateKey,
      alipayPublicKey: keys.publicKey,
      notifyUrl,
    },
  };

  async function boot() {
    app = await buildApp({
      config: { ...testConfig, pay: payConfig },
      store,
      logger: false,
    });
  }

  function signedForm(outTradeNo: string, totalAmount: string) {
    const form: Record<string, string> = {
      app_id: payConfig.alipay.appId,
      out_trade_no: outTradeNo,
      trade_no: `20261114${outTradeNo}`,
      trade_status: 'TRADE_SUCCESS',
      total_amount: totalAmount,
      gmt_payment: '2026-11-14 10:00:00',
    };
    form['sign'] = rsaSign(buildAlipaySignContent(form), keys.privateKey);
    form['sign_type'] = 'RSA2';
    return new URLSearchParams(form).toString();
  }

  it('合法签名的表单回调被解析并落已支付，重复回放不重复入账', async () => {
    await boot();
    const outTradeNo = 'AL-PROBE-1';
    await store.payments.insert({
      id: 'pay-al-1',
      outTradeNo,
      userId: 'u-al-1',
      channel: 'alipay',
      amountFen: 1999,
      subject: '回调取证商品',
      status: 'pending',
      prepay: null,
      transactionId: null,
      paidAt: null,
      createdAt: new Date(),
    });

    const first = await app!.inject({
      method: 'POST',
      url: '/api/v1/pay/notify/alipay',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: signedForm(outTradeNo, '19.99'),
    });
    expect(first.statusCode).toBe(200);
    expect(first.body).toBe('success');

    const paid = await store.payments.findByOutTradeNo(outTradeNo);
    expect(paid?.status).toBe('paid');
    expect(paid?.transactionId).toBeTruthy();

    // 重放：仍回 success，状态不二次翻转
    const replay = await app!.inject({
      method: 'POST',
      url: '/api/v1/pay/notify/alipay',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: signedForm(outTradeNo, '19.99'),
    });
    expect(replay.statusCode).toBe(200);
    expect((await store.payments.findByOutTradeNo(outTradeNo))?.status).toBe('paid');
  });

  it('金额不符的回调被拒绝（409），不改变订单状态', async () => {
    await boot();
    const outTradeNo = 'AL-PROBE-2';
    await store.payments.insert({
      id: 'pay-al-2',
      outTradeNo,
      userId: 'u-al-2',
      channel: 'alipay',
      amountFen: 1999,
      subject: '金额核对商品',
      status: 'pending',
      prepay: null,
      transactionId: null,
      paidAt: null,
      createdAt: new Date(),
    });

    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/pay/notify/alipay',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: signedForm(outTradeNo, '29.99'),
    });
    expect(res.statusCode).toBe(409);
    expect((await store.payments.findByOutTradeNo(outTradeNo))?.status).toBe('pending');
  });
});
