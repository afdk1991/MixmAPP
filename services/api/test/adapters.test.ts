import { createCipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildWechatAuthorization,
  decryptWechatResource,
  verifyWechatSignature,
} from '../src/adapters/pay/wechat.js';
import {
  buildAlipayAppOrder,
  buildAlipaySignContent,
  parseAlipayNotify,
  verifyAlipayNotify,
} from '../src/adapters/pay/alipay.js';
import { S3Storage } from '../src/adapters/storage.js';
import { generateRsaKeyPair, rsaSign, rsaVerify } from '../src/lib/crypto.js';
import { MemoryStore } from '../src/db/memory.js';
import { DevOneKeyProvider } from '../src/adapters/onekey.js';

const keys = generateRsaKeyPair();

describe('微信支付 v3', () => {
  it('请求签名可被公钥验证', () => {
    const body = JSON.stringify({ appid: 'wx1', mchid: 'm1', amount: { total: 100 } });
    const authorization = buildWechatAuthorization({
      method: 'POST',
      urlPath: '/v3/pay/transactions/app',
      body,
      mchId: 'm1',
      serialNo: 'SN123',
      privateKey: keys.privateKey,
      timestamp: 1_700_000_000,
      nonce: 'abc123',
    });
    const signature = /signature="([^"]+)"/.exec(authorization)?.[1] as string;
    const message = `POST\n/v3/pay/transactions/app\n1700000000\nabc123\n${body}\n`;
    expect(rsaVerify(message, signature, keys.publicKey)).toBe(true);
    expect(authorization.startsWith('WECHATPAY2-SHA256-RSA2048 ')).toBe(true);
  });

  it('回调签名校验能识别篡改', () => {
    const body = '{"id":"evt"}';
    const message = `1700000000\nnonce\n${body}\n`;
    const signature = rsaSign(message, keys.privateKey);
    expect(
      verifyWechatSignature({
        timestamp: '1700000000',
        nonce: 'nonce',
        body,
        signature,
        platformPublicKey: keys.publicKey,
      }),
    ).toBe(true);
    expect(
      verifyWechatSignature({
        timestamp: '1700000000',
        nonce: 'nonce',
        body: '{"id":"tampered"}',
        signature,
        platformPublicKey: keys.publicKey,
      }),
    ).toBe(false);
  });

  it('AEAD_AES_256_GCM 回调解密往返正确', () => {
    const apiV3Key = 'a'.repeat(32);
    const nonce = 'b'.repeat(12);
    const aad = 'transaction';
    const plain = JSON.stringify({ out_trade_no: 'MX1', trade_state: 'SUCCESS' });
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(nonce));
    cipher.setAAD(Buffer.from(aad));
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    const decrypted = decryptWechatResource(apiV3Key, {
      ciphertext: encrypted.toString('base64'),
      nonce,
      associated_data: aad,
    });
    expect(decrypted).toBe(plain);
  });
});

describe('支付宝 RSA2', () => {
  const config = {
    appId: '2021000000000000',
    privateKey: keys.privateKey,
    alipayPublicKey: keys.publicKey,
    notifyUrl: 'https://api.mixm.app/api/v1/pay/notify/alipay',
  };

  it('APP 下单串签名可被验签', () => {
    const { params, orderString } = buildAlipayAppOrder(config, {
      outTradeNo: 'MX20260101',
      amountFen: 1999,
      subject: 'MixmAPP 会员',
      notifyUrl: config.notifyUrl,
    });
    expect(orderString).toContain('sign_type=RSA2');
    expect(verifyAlipayNotify(config, params as Record<string, string>)).toBe(true);
    const content = buildAlipaySignContent(params as Record<string, string>);
    expect(content).toContain('app_id=2021000000000000');
  });

  it('异步通知验签通过后金额换算正确', () => {
    const form: Record<string, string> = {
      app_id: config.appId,
      out_trade_no: 'MX20260101',
      trade_no: '2026010122001',
      trade_status: 'TRADE_SUCCESS',
      total_amount: '19.99',
      gmt_payment: '2026-01-01 10:00:00',
    };
    const content = buildAlipaySignContent(form);
    form['sign'] = rsaSign(content, keys.privateKey);
    form['sign_type'] = 'RSA2';
    const notify = parseAlipayNotify(config, form);
    expect(notify.amountFen).toBe(1999);
    expect(notify.tradeStatus).toBe('TRADE_SUCCESS');
  });

  it('验签失败应抛出', () => {
    expect(() =>
      parseAlipayNotify(config, {
        out_trade_no: 'MX1',
        trade_status: 'TRADE_SUCCESS',
        total_amount: '1.00',
        sign: 'invalid',
        sign_type: 'RSA2',
      }),
    ).toThrow();
  });
});

describe('S3 预签名', () => {
  const config = {
    provider: 's3' as const,
    endpoint: 'https://acc.r2.cloudflarestorage.com',
    region: 'auto',
    bucket: 'mixmapp',
    accessKeyId: 'AKIA',
    secretAccessKey: 'SECRET',
    publicBaseUrl: 'https://cdn.mixm.app',
  };

  it('生成带签名的 PUT 地址', async () => {
    const storage = new S3Storage(config);
    const upload = await storage.presignUpload('u/1/a.png', 'image/png', 600);
    expect(upload.method).toBe('PUT');
    expect(upload.url).toContain('X-Amz-Signature=');
    expect(upload.url).toContain('X-Amz-Credential=');
    expect(upload.url).toContain('/mixmapp/u/1/a.png');
    expect(storage.publicUrl('u/1/a.png')).toBe('https://cdn.mixm.app/u/1/a.png');
  });

  it('未配置密钥应拒绝', async () => {
    const storage = new S3Storage({ ...config, accessKeyId: '', secretAccessKey: '' });
    await expect(storage.presignUpload('a.png')).rejects.toThrow();
  });
});

describe('一键登录适配器', () => {
  it('开发态把 dev: 前缀 token 解析为手机号', async () => {
    const provider = new DevOneKeyProvider('test');
    expect(provider.enabled).toBe(true);
    await expect(provider.resolvePhone('dev:13800001234')).resolves.toBe('13800001234');
  });

  it('凭证格式错误应拒绝', async () => {
    const provider = new DevOneKeyProvider('test');
    await expect(provider.resolvePhone('whatever')).rejects.toThrow();
    await expect(provider.resolvePhone('dev:123456')).rejects.toThrow();
  });

  it('生产环境禁用开发态实现', async () => {
    const provider = new DevOneKeyProvider('production');
    expect(provider.enabled).toBe(false);
    await expect(provider.resolvePhone('dev:13800001234')).rejects.toThrow();
  });
});

describe('回调幂等与支付下单（内存存储）', () => {
  it('同一订单重复回调只落一次已支付状态', async () => {
    const store = new MemoryStore();
    const pay = await store.payments.insert({
      id: 'p1',
      outTradeNo: 'MX1',
      userId: 'u1',
      channel: 'wechat',
      amountFen: 100,
      subject: 'test',
      status: 'pending',
      prepay: null,
      transactionId: null,
      paidAt: null,
      createdAt: new Date(),
    });
    await store.payments.update(pay.id, { status: 'paid', paidAt: new Date() });
    const again = await store.payments.findByOutTradeNo('MX1');
    expect(again?.status).toBe('paid');
    expect(again?.paidAt).toBeInstanceOf(Date);
  });
});
