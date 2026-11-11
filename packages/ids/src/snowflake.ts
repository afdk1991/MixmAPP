/**
 * Snowflake：41 位毫秒时间 + 10 位机器号 + 12 位序列 = 63 位正整数。
 * 特点：全局唯一、与时间同序、无需中心发号，适合自托管多实例。
 */
export const SNOWFLAKE_EPOCH_MS = Date.UTC(2026, 0, 1); // 2026-01-01T00:00:00Z
const WORKER_BITS = 10n;
const SEQ_BITS = 12n;
const MAX_WORKER = (1n << WORKER_BITS) - 1n;
const MAX_SEQ = (1n << SEQ_BITS) - 1n;

export type SnowflakeOptions = {
  workerId: number;
  epochMs?: number;
  /** 便于测试注入时钟 */
  now?: () => number;
};

export class Snowflake {
  private readonly workerId: bigint;
  private readonly epochMs: number;
  private readonly now: () => number;
  private lastMs = -1;
  private seq = 0n;

  constructor(options: SnowflakeOptions) {
    const worker = BigInt(options.workerId);
    if (worker < 0n || worker > MAX_WORKER) {
      throw new RangeError(`workerId 必须在 0..${MAX_WORKER} 之间`);
    }
    this.workerId = worker;
    this.epochMs = options.epochMs ?? SNOWFLAKE_EPOCH_MS;
    this.now = options.now ?? Date.now;
  }

  /** 生成下一个 63 位 ID。时钟回拨时沿用上次时间戳，保证单调递增。 */
  next(): bigint {
    let ms = this.now();
    if (ms < this.lastMs) ms = this.lastMs;
    if (ms === this.lastMs) {
      this.seq = (this.seq + 1n) & MAX_SEQ;
      if (this.seq === 0n) {
        // 同一毫秒序列用尽，等到下一毫秒
        while (ms <= this.lastMs) ms = this.now();
      }
    } else {
      this.seq = 0n;
    }
    this.lastMs = ms;
    const ts = BigInt(ms - this.epochMs);
    if (ts < 0n) throw new RangeError('系统时钟早于 Snowflake 纪元');
    if (ts >= 1n << 41n) throw new RangeError('Snowflake 时间位已用尽（约 69 年后）');
    return (ts << (WORKER_BITS + SEQ_BITS)) | (this.workerId << SEQ_BITS) | this.seq;
  }

  nextString(): string {
    return this.next().toString();
  }

  /** 从 ID 反解生成时间，便于排查与分片。 */
  parse(id: bigint | string): { timestamp: number; workerId: number; sequence: number } {
    const n = typeof id === 'string' ? BigInt(id) : id;
    const sequence = Number(n & MAX_SEQ);
    const workerId = Number((n >> SEQ_BITS) & MAX_WORKER);
    const timestamp = Number(n >> (WORKER_BITS + SEQ_BITS)) + this.epochMs;
    return { timestamp, workerId, sequence };
  }
}
