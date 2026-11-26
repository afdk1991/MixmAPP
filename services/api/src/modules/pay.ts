import { randomDigits } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import type { Config } from '../config.js';
import type { Store } from '../db/types.js';
import { IdFactory } from '@mixmapp/ids';
import {
  createWechatAppOrder,
  isWechatNotifyReady,
  isWechatPayEnabled,
  parseWechatNotify,
  type WechatPayConfig,
} from '../adapters/pay/wechat.js';
import {
  buildAlipayAppOrder,
  isAlipayEnabled,
  isAlipayNotifyReady,
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
  /** dev = 未接真实支付，仅走通下单链路（非生产环境专用） */
  mode: 'live' | 'dev';
};

export type PayNotifyOutcome = {
  outTradeNo: string;
  status: 'paid' | 'pending' | 'failed';
  /** 是否向渠道确认「已收到」：true → 微信 SUCCESS / 支付宝 success */
  ack: boolean;
};

/** 商户订单号允许字符集：与微信/支付宝 out_trade_no 规则取交集，避免超长或特殊字符被上游拒绝。 */
const OUT_TRADE_NO_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

const CHANNEL_NAME: Record<'wechat' | 'alipay', string> = {
  wechat: '微信支付',
  alipay: '支付宝',
};

export class PayService {
  private readonly ids: IdFactory;

  constructor(
    private readonly config: Config,
    private readonly store: Store,
  ) {
    this.ids = new IdFactory({ strategy: config.ids.strategy, workerId: config.ids.workerId });
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

  /** 该渠道是否具备完整回调处理能力（下单 + 验签 + 解密所需配置）。 */
  notifyReady(channel: 'wechat' | 'alipay'): boolean {
    return channel === 'wechat'
      ? isWechatNotifyReady(this.config.pay.wechat)
      : isAlipayNotifyReady(this.config.pay.alipay);
  }

  async createOrder(userId: string, input: CreateOrderInput): Promise<CreateOrderResult> {
    const outTradeNo = input.outTradeNo?.trim() || this.orderNo();
    if (!OUT_TRADE_NO_PATTERN.test(outTradeNo)) {
      throw new AppError(
        'BAD_REQUEST',
        '商户订单号需为 6-64 位字母、数字、下划线或短横线',
      );
    }
    const existing = await this.store.payments.findByOutTradeNo(outTradeNo);
    if (existing) throw AppError.conflict('商户订单号重复');

    const channelName = CHANNEL_NAME[input.channel];
    const enabled = this.enabled(input.channel);

    // 生产环境：未配置商户凭据时直接拒绝，既不落单也不返回 mock 调起参数，
    // 从源头保证「没有真实商户凭据 = 没有任何扣款路径」。
    if (!enabled && this.config.env === 'production') {
      throw new AppError(
        'PROVIDER_DISABLED',
        `${channelName}未开通：缺少商户凭据，当前无法发起支付`,
      );
    }

    let payload: Record<string, unknown>;
    let mode: 'live' | 'dev' = 'dev';

    if (enabled) {
      // 真实下单必须同时具备回调地址，否则支付成功也没有入口把订单置为已支付。
      if (input.channel === 'wechat') {
        if (!this.config.pay.wechat.notifyUrl) {
          throw new AppError('PROVIDER_DISABLED', '缺少微信支付回调地址（PAY_WECHAT_NOTIFY_URL）');
        }
        const prepay = await createWechatAppOrder(this.config.pay.wechat, {
          outTradeNo,
          amountFen: input.amountFen,
          subject: input.subject,
          notifyUrl: this.config.pay.wechat.notifyUrl,
        });
        payload = prepay.params;
      } else {
        if (!this.config.pay.alipay.notifyUrl) {
          throw new AppError('PROVIDER_DISABLED', '缺少支付宝回调地址（PAY_ALIPAY_NOTIFY_URL）');
        }
        const order = buildAlipayAppOrder(this.config.pay.alipay, {
          outTradeNo,
          amountFen: input.amountFen,
          subject: input.subject,
          notifyUrl: this.config.pay.alipay.notifyUrl,
        });
        payload = { orderString: order.orderString };
      }
      mode = 'live';
    } else {
      // 仅非生产环境会走到这里：标记 mock，客户端据 mode 判断不可真实支付。
      payload = {
        mock: true,
        note: `开发态：${channelName}未配置商户参数，订单仅落库用于联调，不会真实扣款`,
      };
    }

    // 先调用上游、成功后再落库：避免上游失败时留下一条永远 pending 的孤儿订单。
    await this.store.payments.insert({
      id: this.ids.next().id,
      outTradeNo,
      userId,
      channel: input.channel,
      amountFen: input.amountFen,
      subject: input.subject,
      status: 'pending',
      prepay: payload,
      transactionId: null,
      paidAt: null,
      createdAt: new Date(),
    });

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
  ): Promise<PayNotifyOutcome> {
    const cfg = this.config.pay.wechat;
    // 生产环境缺凭据时回调也必须明确失败，不能因为「配置缺失」而静默确认收到。
    if (!isWechatNotifyReady(cfg)) {
      throw new AppError('PROVIDER_DISABLED', '微信支付回调未配置完整（商户/APIv3/平台公钥/回调地址）');
    }
    const notify = parseWechatNotify(cfg, headers, rawBody);

    // 回调里的 appid / mchid 必须与本地配置一致，避免别的商户号的通知串进来。
    if (!notify.appId || notify.appId !== cfg.appId) {
      throw AppError.conflict('微信回调 appid 与商户配置不一致');
    }
    if (!notify.mchId || notify.mchId !== cfg.mchId) {
      throw AppError.conflict('微信回调 mchid 与商户配置不一致');
    }
    if (notify.currency && notify.currency !== 'CNY') {
      throw AppError.conflict(`微信回调币种异常：${notify.currency}`);
    }

    const payment = await this.store.payments.findByOutTradeNo(notify.outTradeNo);
    if (!payment) throw AppError.notFound('订单不存在');
    if (payment.channel !== 'wechat') {
      throw AppError.conflict('微信回调与订单支付渠道不一致');
    }
    if (payment.amountFen !== notify.amountFen) {
      throw AppError.conflict('回调金额与订单金额不一致');
    }

    // 幂等：已支付订单重复回调只确认收到。
    if (payment.status === 'paid') {
      if (
        payment.transactionId &&
        notify.transactionId &&
        payment.transactionId !== notify.transactionId
      ) {
        // 同一商户单号被两笔微信交易支付：属于异常，必须人工核对，不能覆盖已入账交易。
        throw AppError.conflict('订单已由另一笔微信交易支付，请人工核对');
      }
      return { outTradeNo: notify.outTradeNo, status: 'paid', ack: true };
    }

    // 非支付成功事件（退款、关闭等）：确认收到，但不改动支付状态。
    if (notify.eventType && notify.eventType !== 'TRANSACTION.SUCCESS') {
      return { outTradeNo: notify.outTradeNo, status: 'pending', ack: true };
    }
    if (notify.tradeState !== 'SUCCESS') {
      await this.store.payments.update(payment.id, {
        status: 'failed',
        transactionId: notify.transactionId || payment.transactionId,
      });
      return { outTradeNo: notify.outTradeNo, status: 'failed', ack: true };
    }
    if (!notify.transactionId) {
      throw AppError.conflict('微信回调缺少交易号');
    }
    await this.store.payments.update(payment.id, {
      status: 'paid',
      transactionId: notify.transactionId,
      paidAt: new Date(),
    });
    return { outTradeNo: notify.outTradeNo, status: 'paid', ack: true };
  }

  async handleAlipayNotify(form: Record<string, string>): Promise<PayNotifyOutcome> {
    const cfg = this.config.pay.alipay;
    if (!isAlipayNotifyReady(cfg)) {
      throw new AppError('PROVIDER_DISABLED', '支付宝回调未配置完整（应用/公钥/回调地址）');
    }
    const notify = parseAlipayNotify(cfg, form);

    if (!notify.appId || notify.appId !== cfg.appId) {
      throw AppError.conflict('支付宝回调 app_id 与商户配置不一致');
    }

    const payment = await this.store.payments.findByOutTradeNo(notify.outTradeNo);
    if (!payment) throw AppError.notFound('订单不存在');
    if (payment.channel !== 'alipay') {
      throw AppError.conflict('支付宝回调与订单支付渠道不一致');
    }
    if (payment.amountFen !== notify.amountFen) {
      throw AppError.conflict('回调金额与订单金额不一致');
    }

    if (payment.status === 'paid') {
      if (payment.transactionId && notify.tradeNo && payment.transactionId !== notify.tradeNo) {
        throw AppError.conflict('订单已由另一笔支付宝交易支付，请人工核对');
      }
      return { outTradeNo: notify.outTradeNo, status: 'paid', ack: true };
    }

    switch (notify.tradeStatus) {
      case 'TRADE_SUCCESS':
      case 'TRADE_FINISHED': {
        if (!notify.tradeNo) throw AppError.conflict('支付宝回调缺少交易号');
        await this.store.payments.update(payment.id, {
          status: 'paid',
          transactionId: notify.tradeNo,
          paidAt: new Date(),
        });
        return { outTradeNo: notify.outTradeNo, status: 'paid', ack: true };
      }
      case 'TRADE_CLOSED':
        // 交易关闭：落 failed 并确认收到，避免支付宝按失败无限重试。
        await this.store.payments.update(payment.id, { status: 'failed' });
        return { outTradeNo: notify.outTradeNo, status: 'failed', ack: true };
      case 'WAIT_BUYER_PAY':
        // 等待付款不是终态：确认收到但保持 pending，真正的终态回调会再来一次。
        return { outTradeNo: notify.outTradeNo, status: 'pending', ack: true };
      default:
        // 未知状态不确认，让支付宝按重试策略再来，避免丢单。
        return { outTradeNo: notify.outTradeNo, status: 'pending', ack: false };
    }
  }

  async getOrder(userId: string, outTradeNo: string) {
    const payment = await this.store.payments.findByOutTradeNo(outTradeNo);
    if (!payment || payment.userId !== userId) throw AppError.notFound('订单不存在');
    return payment;
  }
}
