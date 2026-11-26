import type { Config } from '../../config.js';
import { AppError } from '../../lib/errors.js';
import { rsaSign, rsaVerify } from '../../lib/crypto.js';

export type AlipayConfig = Config['pay']['alipay'];

/** 支付宝开放平台签名串：按 key 升序拼 k=v，值不做 URL 编码。 */
export function buildAlipaySignContent(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

export function isAlipayEnabled(config: AlipayConfig): boolean {
  return Boolean(config.appId && config.privateKey);
}

/** 生成 APP 支付订单串（客户端直接传给支付宝 SDK）。 */
export function buildAlipayAppOrder(
  config: AlipayConfig,
  input: { outTradeNo: string; amountFen: number; subject: string; notifyUrl: string },
): { orderString: string; params: Record<string, string> } {
  if (!isAlipayEnabled(config)) throw new AppError('PROVIDER_DISABLED', '支付宝未配置');
  const bizContent = JSON.stringify({
    out_trade_no: input.outTradeNo,
    total_amount: (input.amountFen / 100).toFixed(2),
    subject: input.subject,
    product_code: 'QUICK_MSECURITY_PAY',
    timeout_express: '30m',
  });
  const params: Record<string, string> = {
    app_id: config.appId,
    method: 'alipay.trade.app.pay',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    version: '1.0',
    notify_url: input.notifyUrl,
    biz_content: bizContent,
  };
  const content = buildAlipaySignContent(params);
  const sign = rsaSign(content, config.privateKey);
  const signed: Record<string, string> = { ...params, sign };
  const orderString = Object.keys(signed)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(signed[k] as string)}`)
    .join('&');
  return { orderString, params: signed };
}

/** 校验异步通知签名（form-urlencoded 解析后的对象）。 */
export function verifyAlipayNotify(config: AlipayConfig, form: Record<string, string>): boolean {
  if (!config.alipayPublicKey) return false;
  const sign = form['sign'];
  if (!sign) return false;
  const content = buildAlipaySignContent(form);
  return rsaVerify(content, sign, config.alipayPublicKey);
}

export type AlipayNotifyResult = {
  outTradeNo: string;
  tradeNo: string;
  tradeStatus: string;
  amountFen: number;
  /** 回调中的应用 ID：必须与本地配置一致，防止别的应用的回调串进来 */
  appId: string;
  gmtPayment: string | null;
};

export function parseAlipayNotify(
  config: AlipayConfig,
  form: Record<string, string>,
): AlipayNotifyResult {
  if (!verifyAlipayNotify(config, form)) {
    throw new AppError('PAYMENT_INVALID', '支付宝回调验签失败');
  }
  const total = Number(form['total_amount'] ?? '0');
  if (!Number.isFinite(total)) throw new AppError('PAYMENT_INVALID', '回调金额非法');
  const outTradeNo = form['out_trade_no'] ?? '';
  if (!outTradeNo) throw new AppError('PAYMENT_INVALID', '回调缺少商户订单号');
  return {
    outTradeNo,
    tradeNo: form['trade_no'] ?? '',
    tradeStatus: form['trade_status'] ?? '',
    amountFen: Math.round(total * 100),
    appId: form['app_id'] ?? '',
    gmtPayment: form['gmt_payment'] ?? null,
  };
}

/** 支付宝回调处理是否具备全部前置条件（下单 + 验签）。 */
export function isAlipayNotifyReady(config: AlipayConfig): boolean {
  return isAlipayEnabled(config) && Boolean(config.alipayPublicKey) && Boolean(config.notifyUrl);
}
