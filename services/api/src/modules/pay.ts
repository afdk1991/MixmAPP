import { randomDigits } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import type { Config } from '../config.js';
import type { Store } from '../db/types.js';
import { IdFactory } from '@mixmapp/ids';
import {
  createWechatAppOrder,
  isWechatPayEnabled,
  parseWechatNotify,
  type WechatPayConfig,
} from '../adapters/pay/wechat.js';
import {
  buildAlipayAppOrder,
  isAlipayEnabled,
  parseAlipayNotify,
  type AlipayConfig,
} from '../adapters/pay/alipay.js';

export type CreateOrderInput = {
  channel: 'wechat' | 'alipay';
  amountFen: number;
  subject: string;
  outTradeNo?: string;
};

export type CreateOrderResult = {
  outTradeNo: string;
  channel: 'wechat' | 'alipay';
  amountFen: number;
  status: 'pending';
  /** 传给客户端 SDK 的调起参数 */
  payload: Record<string, unknown>;
  /** dev = 未接真实支付，仅走通下单链路 */
  mode: 'live' | 'dev';
};

export class PayService {
  private readonly ids: IdFactory;

  constructor(
    private readonly config: Config,
    private readonly store: Store,
  ) {
    this.ids = new IdFactory({ strategy: 'snowflake', workerId: config.ids.workerId });
  }

  private orderNo(): string {
    return `MX${Date.now()}${randomDigits(4)}`;
  }

  configOf(channel: 'wechat' | 'alipay'): WechatPayConfig | AlipayConfig {
    return channel === 'wechat' ? this.config.pay.wechat : this.config.pay.alipay;
  }

  enabled(channel: 'wechat' | 'alipay'): boolean {
    return channel === 'wechat'
      ? isWechatPayEnabled(this.config.pay.wechat)
      : isAlipayEnabled(this.config.pay.alipay);
  }

  async createOrder(userId: string, input: CreateOrderInput): Promise<CreateOrderResult> {
    const outTradeNo = input.outTradeNo ?? this.orderNo();
    const existing = await this.store.payments.findByOutTradeNo(outTradeNo);
    if (existing) throw AppError.conflict('商户订单号重复');

    const payment = await this.store.payments.insert({
      id: this.ids.next().id,
      outTradeNo,
      userId,
      channel: input.channel,
      amountFen: input.amountFen,
      subject: input.subject,
      status: 'pending',
      prepay: null,
      transactionId: null,
      paidAt: null,
      createdAt: new Date(),
    });

    let payload: Record<string, unknown>;
    let mode: 'live' | 'dev' = 'dev';

    if (input.channel === 'wechat' && isWechatPayEnabled(this.config.pay.wechat)) {
      const prepay = await createWechatAppOrder(this.config.pay.wechat, {
        outTradeNo,
        amountFen: input.amountFen,
        subject: input.subject,
        notifyUrl: this.config.pay.wechat.notifyUrl,
      });
      payload = prepay.params;
      mode = 'live';
    } else if (input.channel === 'alipay' && isAlipayEnabled(this.config.pay.alipay)) {
      const order = buildAlipayAppOrder(this.config.pay.alipay, {
        outTradeNo,
        amountFen: input.amountFen,
        subject: input.subject,
        notifyUrl: this.config.pay.alipay.notifyUrl,
      });
      payload = { orderString: order.orderString };
      mode = 'live';
    } else {
      payload = {
        mock: true,
        note: `开发态：${input.channel} 未配置商户参数，订单已落库但不会真实扣款`,
      };
    }

    await this.store.payments.update(payment.id, { prepay: payload });
    return {
      outTradeNo,
      channel: input.channel,
      amountFen: input.amountFen,
      status: 'pending',
      payload,
      mode,
    };
  }

  async handleWechatNotify(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): Promise<{ outTradeNo: string; status: 'paid' } | { outTradeNo: string; status: 'pending' }> {
    const notify = parseWechatNotify(this.config.pay.wechat, headers, rawBody);
    const payment = await this.store.payments.findByOutTradeNo(notify.outTradeNo);
    if (!payment) throw AppError.notFound('订单不存在');
    if (payment.amountFen !== notify.amountFen) {
      throw AppError.conflict('回调金额与订单金额不一致');
    }
    if (notify.tradeState !== 'SUCCESS') {
      await this.store.payments.update(payment.id, {
        status: 'failed',
        transactionId: notify.transactionId,
      });
      return { outTradeNo: notify.outTradeNo, status: 'pending' };
    }
    if (payment.status === 'paid') return { outTradeNo: notify.outTradeNo, status: 'paid' };
    await this.store.payments.update(payment.id, {
      status: 'paid',
      transactionId: notify.transactionId,
      paidAt: new Date(),
    });
    return { outTradeNo: notify.outTradeNo, status: 'paid' };
  }

  async handleAlipayNotify(
    form: Record<string, string>,
  ): Promise<{ outTradeNo: string; status: 'paid' }> {
    const notify = parseAlipayNotify(this.config.pay.alipay, form);
    const payment = await this.store.payments.findByOutTradeNo(notify.outTradeNo);
    if (!payment) throw AppError.notFound('订单不存在');
    if (payment.amountFen !== notify.amountFen) {
      throw AppError.conflict('回调金额与订单金额不一致');
    }
    const ok = notify.tradeStatus === 'TRADE_SUCCESS' || notify.tradeStatus === 'TRADE_FINISHED';
    if (!ok) throw new AppError('PAYMENT_INVALID', `支付宝交易状态异常: ${notify.tradeStatus}`);
    if (payment.status !== 'paid') {
      await this.store.payments.update(payment.id, {
        status: 'paid',
        transactionId: notify.tradeNo,
        paidAt: new Date(),
      });
    }
    return { outTradeNo: notify.outTradeNo, status: 'paid' };
  }

  async getOrder(userId: string, outTradeNo: string) {
    const payment = await this.store.payments.findByOutTradeNo(outTradeNo);
    if (!payment || payment.userId !== userId) throw AppError.notFound('订单不存在');
    return payment;
  }
}
