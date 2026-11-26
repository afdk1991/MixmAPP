import { createCipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { MemoryStore } from '../src/db/memory.js';
import { PayService } from '../src/modules/pay.js';
import { generateRsaKeyPair, rsaSign } from '../src/lib/crypto.js';
import { buildAlipaySignContent } from '../src/adapters/pay/alipay.js';

const payKeys = generateRsaKeyPair();
const platformKeys = generateRsaKeyPair();
const API_V3_KEY = 'k'.repeat(32);
const APP_ID = 'wx-app-1';
const MCH_ID = 'mch-1';
const WECHAT_NOTIFY = 'https://example.com/pay/notify/wechat';

function makeConfig(patch: Partial<Config>): Config {
  return { ...loadConfig(), ...patch };
}

function buildService() {
  const store = new MemoryStore();
  const config = makeConfig({
    env: 'test',
    pay: {
      wechat: {
        appId: APP_ID,
        mchId: MCH_ID,
        serialNo: 'SN-1',
        privateKey: payKeys.privateKey,
        apiV3Key: API_V3_KEY,
        platformPublicKey: platformKeys.publicKey,
        notifyUrl: WECHAT_NOTIFY,
      },
      alipay: {
        appId: '2021000000000001',
        privateKey: payKeys.privateKey,
        alipayPublicKey: platformKeys.publicKey,
        notifyUrl: 'https://example.com/pay/notify/alipay',
      },
    },
  });
  return { store, pay: new PayService(config, store), config };
}

async function seedPayment(
  store: MemoryStore,
  input: { outTradeNo: string; amountFen: number; channel: 'wechat' | 'alipay' },
) {
  await store.payments.insert({
    id: `pay-${input.outTradeNo}`,
    outTradeNo: input.outTradeNo,
    userId: 'u1',
    channel: input.channel,
    amountFen: input.amountFen,
    subject: '取证商品',
    status: 'pending',
    prepay: null,
    transactionId: null,
    paidAt: null,
    createdAt: new Date(),
  });
}

/** 按微信 v3 回调格式加密 resource 并签好请求头。 */
function wechatNotify(input: {
  outTradeNo: string;
  amountFen: number;
  transactionId?: string;
  tradeState?: string;
  appId?: string;
  mchId?: string;
  currency?: string;
  eventType?: string;
}): { headers: Record<string, string>; body: string } {
  const nonce = 'n'.repeat(12);
  const aad = 'transaction';
  const plain = JSON.stringify({
    appid: input.appId ?? APP_ID,
    mchid: input.mchId ?? MCH_ID,
    out_trade_no: input.outTradeNo,
    transaction_id: input.transactionId ?? 'wx-tx-1',
    trade_state: input.tradeState ?? 'SUCCESS',
    success_time: '2026-11-26T10:00:00+08:00',
    amount: { total: input.amountFen, currency: input.currency ?? 'CNY' },
  });
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(API_V3_KEY), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const body = JSON.stringify({
    event_type: input.eventType ?? 'TRANSACTION.SUCCESS',
    resource: { ciphertext: ciphertext.toString('base64'), nonce, associated_data: aad },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headerNonce = 'header-nonce';
  const signature = rsaSign(`${timestamp}\n${headerNonce}\n${body}\n`, platformKeys.privateKey);
  return {
    headers: {
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': headerNonce,
      'wechatpay-signature': signature,
    },
    body,
  };
}

function alipayForm(input: {
  outTradeNo: string;
  amount: string;
  tradeStatus?: string;
  appId?: string;
  tradeNo?: string;
}): Record<string, string> {
  const form: Record<string, string> = {
    app_id: input.appId ?? '2021000000000001',
    out_trade_no: input.outTradeNo,
    trade_no: input.tradeNo ?? `trade-${input.outTradeNo}`,
    trade_status: input.tradeStatus ?? 'TRADE_SUCCESS',
    total_amount: input.amount,
    gmt_payment: '2026-11-26 10:00:00',
  };
  form['sign'] = rsaSign(buildAlipaySignContent(form), platformKeys.privateKey);
  form['sign_type'] = 'RSA2';
  return form;
}

describe('微信支付回调加固', () => {
  it('合法回调落已支付，重复回调幂等不重复入账', async () => {
    const { store, pay } = buildService();
    await seedPayment(store, { outTradeNo: 'WX-1', amountFen: 1999, channel: 'wechat' });
    const notify = wechatNotify({ outTradeNo: 'WX-1', amountFen: 1999 });
    const first = await pay.handleWechatNotify(notify.headers, notify.body);
    expect(first).toMatchObject({ status: 'paid', ack: true });
    expect((await store.payments.findByOutTradeNo('WX-1'))?.transactionId).toBe('wx-tx-1');

    const replay = await pay.handleWechatNotify(notify.headers, notify.body);
    expect(replay).toMatchObject({ status: 'paid', ack: true });
  });

  it('同一订单被另一笔交易支付时拒绝覆盖（409）', async () => {
    const { store, pay } = buildService();
    await seedPayment(store, { outTradeNo: 'WX-2', amountFen: 1999, channel: 'wechat' });
    const first = wechatNotify({ outTradeNo: 'WX-2', amountFen: 1999 });
    await pay.handleWechatNotify(first.headers, first.body);
    const other = wechatNotify({ outTradeNo: 'WX-2', amountFen: 1999, transactionId: 'wx-tx-2' });
    await expect(pay.handleWechatNotify(other.headers, other.body)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('appid / mchid / 金额 / 币种 / 渠道 任一不一致都拒绝', async () => {
    const { store, pay } = buildService();
    await seedPayment(store, { outTradeNo: 'WX-3', amountFen: 1999, channel: 'wechat' });

    const wrongApp = wechatNotify({ outTradeNo: 'WX-3', amountFen: 1999, appId: 'wx-other' });
    await expect(pay.handleWechatNotify(wrongApp.headers, wrongApp.body)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const wrongMch = wechatNotify({ outTradeNo: 'WX-3', amountFen: 1999, mchId: 'mch-other' });
    await expect(pay.handleWechatNotify(wrongMch.headers, wrongMch.body)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const wrongAmount = wechatNotify({ outTradeNo: 'WX-3', amountFen: 1 });
    await expect(pay.handleWechatNotify(wrongAmount.headers, wrongAmount.body)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const wrongCurrency = wechatNotify({ outTradeNo: 'WX-3', amountFen: 1999, currency: 'USD' });
    await expect(
      pay.handleWechatNotify(wrongCurrency.headers, wrongCurrency.body),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // 渠道不一致：把订单改成 alipay 后再喂微信回调
    const alipayOrder = await store.payments.findByOutTradeNo('WX-3');
    await store.payments.update(alipayOrder!.id, { channel: 'alipay' });
    const ok = wechatNotify({ outTradeNo: 'WX-3', amountFen: 1999 });
    await expect(pay.handleWechatNotify(ok.headers, ok.body)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('验签失败 / 非成功事件 / 失败状态分别处理', async () => {
    const { store, pay } = buildService();
    await seedPayment(store, { outTradeNo: 'WX-4', amountFen: 1999, channel: 'wechat' });

    const notify = wechatNotify({ outTradeNo: 'WX-4', amountFen: 1999 });
    await expect(
      pay.handleWechatNotify({ ...notify.headers, 'wechatpay-signature': 'bad' }, notify.body),
    ).rejects.toMatchObject({ code: 'PAYMENT_INVALID' });

    const refund = wechatNotify({ outTradeNo: 'WX-4', amountFen: 1999, eventType: 'REFUND.SUCCESS' });
    expect(await pay.handleWechatNotify(refund.headers, refund.body)).toMatchObject({
      status: 'pending',
      ack: true,
    });

    const failed = wechatNotify({ outTradeNo: 'WX-4', amountFen: 1999, tradeState: 'PAYERROR' });
    expect(await pay.handleWechatNotify(failed.headers, failed.body)).toMatchObject({
      status: 'failed',
      ack: true,
    });
    expect((await store.payments.findByOutTradeNo('WX-4'))?.status).toBe('failed');
  });

  it('缺少商户凭据时回调明确失败，不假装收到', async () => {
    const store = new MemoryStore();
    const pay = new PayService(
      makeConfig({
        env: 'production',
        pay: {
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
        },
      }),
      store,
    );
    const notify = wechatNotify({ outTradeNo: 'WX-5', amountFen: 100 });
    await expect(pay.handleWechatNotify(notify.headers, notify.body)).rejects.toMatchObject({
      code: 'PROVIDER_DISABLED',
    });
  });
});

describe('支付宝回调加固', () => {
  it('app_id 不一致拒绝；重复回调幂等', async () => {
    const { store, pay } = buildService();
    await seedPayment(store, { outTradeNo: 'AL-1', amountFen: 1999, channel: 'alipay' });
    const wrongApp = alipayForm({ outTradeNo: 'AL-1', amount: '19.99', appId: '2021-other' });
    await expect(pay.handleAlipayNotify(wrongApp)).rejects.toMatchObject({ code: 'CONFLICT' });

    const ok = alipayForm({ outTradeNo: 'AL-1', amount: '19.99' });
    expect(await pay.handleAlipayNotify(ok)).toMatchObject({ status: 'paid', ack: true });
    expect(await pay.handleAlipayNotify(ok)).toMatchObject({ status: 'paid', ack: true });

    const otherTrade = alipayForm({ outTradeNo: 'AL-1', amount: '19.99', tradeNo: 'trade-other' });
    await expect(pay.handleAlipayNotify(otherTrade)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('TRADE_CLOSED 落失败并确认；WAIT_BUYER_PAY 保持待支付；未知状态不确认', async () => {
    const { store, pay } = buildService();
    await seedPayment(store, { outTradeNo: 'AL-2', amountFen: 100, channel: 'alipay' });

    const waiting = alipayForm({ outTradeNo: 'AL-2', amount: '1.00', tradeStatus: 'WAIT_BUYER_PAY' });
    expect(await pay.handleAlipayNotify(waiting)).toMatchObject({ status: 'pending', ack: true });

    const unknown = alipayForm({ outTradeNo: 'AL-2', amount: '1.00', tradeStatus: 'TRADE_UNKNOWN' });
    expect(await pay.handleAlipayNotify(unknown)).toMatchObject({ status: 'pending', ack: false });

    const closed = alipayForm({ outTradeNo: 'AL-2', amount: '1.00', tradeStatus: 'TRADE_CLOSED' });
    expect(await pay.handleAlipayNotify(closed)).toMatchObject({ status: 'failed', ack: true });
    expect((await store.payments.findByOutTradeNo('AL-2'))?.status).toBe('failed');
  });
});
