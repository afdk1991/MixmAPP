import { IdFactory } from '@mixmapp/ids';
import type { Config } from '../config.js';
import type { PushTokenRecord, Store } from '../db/types.js';
import type { PushProvider } from '../adapters/push.js';
import { AppError } from '../lib/errors.js';

/** 单个账号最多保留的推送 token 数：防止换机/重装无限堆积。 */
export const MAX_PUSH_TOKENS_PER_USER = 20;

export type PushTokenInput = {
  token: string;
  platform: PushTokenRecord['platform'];
  provider: PushTokenRecord['provider'];
};

export type PushSendSummary = {
  total: number;
  accepted: number;
  failed: number;
  /** 本次因上游判定失效而清理掉的 token 数 */
  removed: number;
};

/**
 * 推送服务：token 注册/清理 + 发送失败处理。
 *
 * 设计口径：
 * - 注册按 (userId, token) 去重，重复上报只刷新记录，不产生第二行；
 * - 单账号 token 超上限时按创建时间淘汰最旧的一条；
 * - 发送后把上游判定失效的 token 直接从库里删掉，下次不再重复撞失效设备；
 * - 发送失败只影响统计，不把整批结果伪装成成功。
 */
export class PushService {
  private readonly ids: IdFactory;

  constructor(
    private readonly config: Config,
    private readonly store: Store,
    private readonly provider: PushProvider,
  ) {
    this.ids = new IdFactory({ strategy: config.ids.strategy, workerId: config.ids.workerId });
  }

  /**
   * 注册 token。
   * 生产环境要求上报的 provider 与当前启用通道一致：用极光发的消息不该收进 FCM 的 token，
   * 否则推送时会把另一套体系的 token 当成无效数据清理掉。
   */
  async register(userId: string, input: PushTokenInput): Promise<{ ok: true; registered: number }> {
    if (this.config.env === 'production' && this.provider.name === 'disabled') {
      throw new AppError('PROVIDER_DISABLED', '推送服务未配置，暂不能注册推送 token');
    }
    if (
      this.config.env === 'production' &&
      this.config.push.provider !== 'dev' &&
      input.provider !== this.config.push.provider
    ) {
      throw new AppError(
        'BAD_REQUEST',
        `当前推送通道为 ${this.config.push.provider}，请使用对应 provider 上报 token`,
      );
    }

    const existing = await this.store.pushTokens.listByUser(userId);
    const duplicate = existing.find((item) => item.token === input.token);
    // 超过上限时淘汰最旧的若干条（同 token 已在列表里则不占用新名额）。
    if (!duplicate && existing.length >= MAX_PUSH_TOKENS_PER_USER) {
      const overflow = existing
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, existing.length - MAX_PUSH_TOKENS_PER_USER + 1)
        .map((item) => item.id);
      if (overflow.length) await this.store.pushTokens.remove(overflow);
    }

    await this.store.pushTokens.upsert({
      id: duplicate?.id ?? this.ids.next().id,
      userId,
      provider: input.provider,
      platform: input.platform,
      token: input.token,
      createdAt: new Date(),
    });
    return {
      ok: true,
      registered: Math.min(existing.length + (duplicate ? 0 : 1), MAX_PUSH_TOKENS_PER_USER),
    };
  }

  /** 退出登录/换机时主动注销某个 token；不存在时保持幂等成功。 */
  async unregister(userId: string, token: string): Promise<{ ok: true; removed: number }> {
    const existing = await this.store.pushTokens.listByUser(userId);
    const targets = existing.filter((item) => item.token === token);
    if (targets.length) await this.store.pushTokens.remove(targets.map((item) => item.id));
    return { ok: true, removed: targets.length };
  }

  /** 向该用户全部设备推送，并清理上游判定失效的 token。 */
  async sendToUser(
    userId: string,
    message: { title: string; body: string; data?: Record<string, string> },
  ): Promise<PushSendSummary> {
    const tokens = await this.store.pushTokens.listByUser(userId);
    if (!tokens.length) return { total: 0, accepted: 0, failed: 0, removed: 0 };
    const result = await this.provider.push({ tokens: tokens.map((item) => item.token), ...message });
    let removed = 0;
    if (result.invalidTokens.length) {
      const invalid = new Set(result.invalidTokens);
      const ids = tokens.filter((item) => invalid.has(item.token)).map((item) => item.id);
      if (ids.length) {
        await this.store.pushTokens.remove(ids);
        removed = ids.length;
      }
    }
    return {
      total: tokens.length,
      accepted: result.accepted,
      failed: result.failed + removed,
      removed,
    };
  }
}
