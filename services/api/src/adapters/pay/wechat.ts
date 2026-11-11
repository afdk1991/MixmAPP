import { createDecipheriv, randomBytes } from 'node:crypto';
import type { Config } from '../../config.js';
import { AppError } from '../../lib/errors.js';
import { rsaSign, rsaVerify } from '../../lib/crypto.js';

export type WechatPayConfig = Config['pay']['wechat'];

export type WechatPrepay = {
  prepayId: string;
  /** 客户端调起 APP 支付所需参数 */
  params: Record<string, string>;
};

const WECHAT_API = 'https://api.mch.weixin.qq.com';

/** 微信支付 v3 请求签名：METHOD\nURL\nTIMESTAMP\nNONCE\nBODY\n */
export function buildWechatAuthorization(input: {
  method: 'GET' | 'POST';
  urlPath: string;
  body: string;
  mchId: string;
  serialNo: string;
  privateKey: string;
  timestamp?: number;
  nonce?: string;
}): string {
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = input.nonce ?? randomBytes(16).toString('hex');
  const message = `${input.method}\n${input.urlPath}\n${timestamp}\n${nonce}\n${input.body}\n`;
  const signature = rsaSign(message, input.privateKey);
  return (
    'WECHATPAY2-SHA256-RSA2048 ' +
    `mchid="${input.mchId}",nonce_str="${nonce}",signature="${signature}",` +
    `timestamp="${timestamp}",serial_no="${input.serialNo}"`
  );
}

/** 回调验签：timestamp\nnonce\nbody\n */
export function verifyWechatSignature(input: {
  timestamp: string;
  nonce: string;
  body: string;
  signature: string;
  platformPublicKey: string;
}): boolean {
  if (!input.platformPublicKey) return false;
  const message = `${input.timestamp}\n${input.nonce}\n${input.body}\n`;
  return rsaVerify(message, input.signature, input.platformPublicKey);
}

/** 解密回调 resource（AEAD_AES_256_GCM，密钥为 APIv3 Key）。 */
export function decryptWechatResource(
  apiV3Key: string,
  resource: { ciphertext: string; nonce: string; associated_data?: string },
): string {
  if (!apiV3Key) throw new AppError('PAYMENT_INVALID', '缺少 APIv3 密钥');
  const key = Buffer.from(apiV3Key, 'utf8');
  if (key.length !== 32) throw new AppError('PAYMENT_INVALID', 'APIv3 密钥必须 32 字节');
  const data = Buffer.from(resource.ciphertext, 'base64');
  const tag = data.subarray(data.length - 16);
  const payload = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce, 'utf8'));
  decipher.setAuthTag(tag);
  decipher.setAAD(Buffer.from(resource.associated_data ?? '', 'utf8'));
  const plain = Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
  return plain;
}

export function isWechatPayEnabled(config: WechatPayConfig): boolean {
  return Boolean(config.appId && config.mchId && config.serialNo && config.privateKey);
}

/** APP 下单：返回 prepay_id 与客户端调起参数。 */
export async function createWechatAppOrder(
  config: WechatPayConfig,
  input: { outTradeNo: string; amountFen: number; subject: string; notifyUrl: string },
): Promise<WechatPrepay> {
  if (!isWechatPayEnabled(config)) {
    throw new AppError('PROVIDER_DISABLED', '微信支付未配置');
  }
  if (!input.notifyUrl) throw new AppError('PROVIDER_DISABLED', '缺少微信支付回调地址');
  const urlPath = '/v3/pay/transactions/app';
  const body = JSON.stringify({
    appid: config.appId,
    mchid: config.mchId,
    description: input.subject,
    out_trade_no: input.outTradeNo,
    notify_url: input.notifyUrl,
    amount: { total: input.amountFen, currency: 'CNY' },
  });
  const authorization = buildWechatAuthorization({
    method: 'POST',
    urlPath,
    body,
    mchId: config.mchId,
    serialNo: config.serialNo,
    privateKey: config.privateKey,
  });
  const res = await fetch(`${WECHAT_API}${urlPath}`, {
    method: 'POST',
    headers: {
      authorization,
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'MixmAPP/0.1',
    },
    body,
  });
  const payload = (await res.json()) as { prepay_id?: string; message?: string };
  if (!res.ok || !payload.prepay_id) {
    throw new AppError('PROVIDER_ERROR', payload.message ?? `微信下单失败 HTTP ${res.status}`);
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = randomBytes(16).toString('hex').slice(0, 32);
  const pkg = 'Sign=WXPay';
  const signMessage = `${config.appId}\n${timestamp}\n${nonceStr}\n${payload.prepay_id}\n`;
  const paySign = rsaSign(signMessage, config.privateKey);

  return {
    prepayId: payload.prepay_id,
    params: {
      appid: config.appId,
      partnerid: config.mchId,
      prepayid: payload.prepay_id,
      package: pkg,
      noncestr: nonceStr,
      timestamp,
      sign: paySign,
    },
  };
}

export type WechatNotifyResult = {
  outTradeNo: string;
  transactionId: string;
  tradeState: string;
  amountFen: number;
  successTime: string | null;
};

/** 解析并验签微信支付回调，返回归一化结果。 */
export function parseWechatNotify(
  config: WechatPayConfig,
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
): WechatNotifyResult {
  const timestamp = String(headers['wechatpay-timestamp'] ?? '');
  const nonce = String(headers['wechatpay-nonce'] ?? '');
  const signature = String(headers['wechatpay-signature'] ?? '');
  if (!verifyWechatSignature({ timestamp, nonce, body: rawBody, signature, platformPublicKey: config.platformPublicKey })) {
    throw new AppError('PAYMENT_INVALID', '微信支付回调验签失败');
  }
  const body = JSON.parse(rawBody) as {
    event_type?: string;
    resource?: { ciphertext: string; nonce: string; associated_data?: string };
  };
  if (!body.resource) throw new AppError('PAYMENT_INVALID', '回调缺少 resource');
  const plain = JSON.parse(decryptWechatResource(config.apiV3Key, body.resource)) as {
    out_trade_no: string;
    transaction_id: string;
    trade_state: string;
    success_time?: string;
    amount?: { total?: number };
  };
  return {
    outTradeNo: plain.out_trade_no,
    transactionId: plain.transaction_id,
    tradeState: plain.trade_state,
    amountFen: Number(plain.amount?.total ?? 0),
    successTime: plain.success_time ?? null,
  };
}
