import { encodeBase32, groupDisplay } from './crockford.js';
import { Snowflake } from './snowflake.js';
import { ulid } from './ulid.js';
import { uuidv7 } from './uuidv7.js';

export type IdStrategy = 'snowflake' | 'ulid' | 'uuidv7';

export const ID_STRATEGIES: readonly IdStrategy[] = ['snowflake', 'ulid', 'uuidv7'];

export function parseIdStrategy(raw: string | undefined, fallback: IdStrategy = 'snowflake'): IdStrategy {
  const v = (raw ?? '').trim().toLowerCase();
  if ((ID_STRATEGIES as readonly string[]).includes(v)) return v as IdStrategy;
  return fallback;
}

export const MIXMAPP_ID_PREFIX = 'MixmAPP';

export type GeneratedIds = {
  /** 主键，按策略生成 */
  id: string;
  /** 雪花数值，永远生成，用于分片/排查 */
  snowflake: string;
  /** 对外展示的账号号段，如 MixmAPP-7K2Q-4X9M-3P5V */
  accountNo: string;
  ulid: string;
  uuidV7: string;
};

export type IdFactoryOptions = {
  strategy?: IdStrategy;
  workerId?: number;
  epochMs?: number;
  now?: () => number;
};

/**
 * 统一发号器：一次调用同时产出 主键 + 雪花 + 短码 + ULID + UUIDv7，
 * 主键的具体形态由 ID_STRATEGY 决定（默认 snowflake）。
 */
export class IdFactory {
  readonly strategy: IdStrategy;
  private readonly snowflake: Snowflake;
  private readonly now: () => number;

  constructor(options: IdFactoryOptions = {}) {
    this.strategy = options.strategy ?? 'snowflake';
    this.snowflake = new Snowflake({
      workerId: options.workerId ?? 0,
      ...(options.epochMs ? { epochMs: options.epochMs } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
    this.now = options.now ?? Date.now;
  }

  next(): GeneratedIds {
    const snowflake = this.snowflake.next();
    const accountRaw = encodeBase32(snowflake, 13);
    const accountNo = `${MIXMAPP_ID_PREFIX}-${groupDisplay(accountRaw, 4)}`;
    const primary =
      this.strategy === 'snowflake'
        ? snowflake.toString()
        : this.strategy === 'ulid'
          ? ulid(this.now)
          : uuidv7(this.now);
    return {
      id: primary,
      snowflake: snowflake.toString(),
      accountNo,
      ulid: ulid(this.now),
      uuidV7: uuidv7(this.now),
    };
  }
}

export { encodeBase32, decodeBase32, groupDisplay } from './crockford.js';
export { Snowflake, SNOWFLAKE_EPOCH_MS } from './snowflake.js';
export { ulid, isUlid, ulidTime } from './ulid.js';
export { uuidv7, isUuidV7 } from './uuidv7.js';
