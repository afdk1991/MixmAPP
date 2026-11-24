import type { Store } from '../db/types.js';

/** 留存清理配置（来自 config.ts 的 retention 段，环境变量名见规格 §2）。 */
export type RetentionConfig = {
  sweepMinutes: number;
  refreshTokenDays: number;
  oauthStateDays: number;
  smsCodeDays: number;
  deviceSnapshotDays: number;
  cartDays: number;
  orderPiiDays: number;
  deletionChallengeDays: number;
};

export type RetentionReport = Record<string, number>;

const DAY_MS = 24 * 3600 * 1000;

/**
 * 个人数据留存清理：与订单超时扫描完全独立，各自一条定时器。
 * 各任务幂等：已过期/已脱敏的数据不会被重复处理，连跑两轮第二轮影响行数为 0。
 * 日志只记录任务名与影响行数，绝不输出手机号、地址、令牌、用户 id 等标识。
 */
export class RetentionService {
  private readonly store: Store;
  private readonly cfg: RetentionConfig;

  constructor(store: Store, cfg: RetentionConfig) {
    this.store = store;
    this.cfg = cfg;
  }

  /** sweepMinutes=0 时任务关闭，index.ts 不注册定时器。 */
  get enabled(): boolean {
    return this.cfg.sweepMinutes > 0;
  }

  async sweep(): Promise<RetentionReport> {
    const now = Date.now();
    const cutoff = (days: number): Date => new Date(now - days * DAY_MS);
    const tasks: Array<[string, () => Promise<number>]> = [
      ['refreshTokens', () => this.store.refreshTokens.purgeExpired(cutoff(this.cfg.refreshTokenDays))],
      ['oauthStates', () => this.store.oauthStates.purgeStale(cutoff(this.cfg.oauthStateDays))],
      ['smsCodes', () => this.store.smsCodes.purgeStale(cutoff(this.cfg.smsCodeDays))],
      ['userDevices', () => this.store.userDevices.purgeStale(cutoff(this.cfg.deviceSnapshotDays))],
      ['carts', () => this.store.mall.carts.purgeStale(cutoff(this.cfg.cartDays))],
      ['ordersPii', () => this.store.mall.orders.anonymizeStaleCompleted(cutoff(this.cfg.orderPiiDays))],
      [
        'deletionChallenges',
        () => this.store.accountChallenges.purgeStale(cutoff(this.cfg.deletionChallengeDays)),
      ],
    ];

    const report: RetentionReport = {};
    for (const [name, run] of tasks) {
      try {
        report[name] = await run();
        console.info({ task: name, rows: report[name] }, 'retention sweep');
      } catch (error) {
        report[name] = -1;
        // 只带任务名与错误概要；不打印任何个人标识。
        console.error(
          { task: name, err: error instanceof Error ? error.message : String(error) },
          'retention task failed',
        );
      }
    }
    return report;
  }
}
