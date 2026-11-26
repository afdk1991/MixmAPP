import type { SuiteActionResultDto, SuiteDomainId, SuiteDomainItemDto } from '@mixmapp/contracts';
import type { SuiteBoardRecord, SuiteProgressStatus } from '../../db/types.js';
import {
  createBoardDomain,
  toDomainItem,
  type SuiteDomainActionContext,
  type SuiteDomainModule,
  type SuiteDomainReadContext,
} from '../suite/domain.js';

/**
 * 效率工具领域模块（待办清单、专注计时与习惯打卡）。
 *
 * 基线用看板 + 阶段状态机实现（待办 → 进行中 → 已完成），
 * 效率工具的专属语义在下面四处扩展：
 * - list：补齐「预估时长 / 关联习惯 / 今日专注次数」三行领域 meta；
 * - act：focus（专注一次）、complete（收口并落专注会话台账）、
 *   habit_check（习惯打卡）、plan（安排计划时段）四个领域动作，
 *   未命中时回落到基线的 create / advance / setStage / remove；
 * - stats：今日待办数、累计专注次数、连续打卡天数三项领域指标。
 *
 * 两条硬规矩（与 docs/49 §4.4 一致）：
 * - 幂等：同一 action + 同一份入参重复提交，第二次必须 changed=false；
 * - 不抛异常：业务上不成立时返回 { ok:false, changed:false, message, item:null }。
 *
 * 数据口径全部落在 store.suite.* 四张通用台账里，领域差异放进 payload：
 * focusCount / focusMinutes / focusLog / checkins / checkinDates / habit / slot / estimate。
 */
const DOMAIN_ID = 'productivity' as SuiteDomainId;

/** 一次专注计入的分钟数（固定节拍，保证不同日期的记录可横向对比）。 */
const FOCUS_MINUTES = 25;
/** 一次专注折算成多少进度点；四段封顶一百。 */
const FOCUS_VALUE = 25;
/** 台账事件类型：一次专注会话（complete 时落一条，供「我的」页聚合与复盘）。 */
const FOCUS_EVENT_KIND = 'focus-session';
/** 台账事件类型：一次习惯打卡（用于同用户同一天同一习惯去重与连续天数回算）。 */
const HABIT_EVENT_KIND = 'habit-checkin';
/** 专注记录保留条数上限：够算「今日次数」，又不让 payload 无限膨胀。 */
const FOCUS_LOG_LIMIT = 60;
/** 打卡日期保留条数上限。 */
const CHECKIN_DATE_LIMIT = 120;

/** 阶段中文名。 */
const STAGE_LABEL: Record<string, string> = {
  todo: '待办',
  doing: '进行中',
  done: '已完成',
};

/* ---------- 通用小工具 ---------- */

/** 取字符串（去空白）；非字符串一律当空串。 */
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 取数字；拿不到或不是有限数返回 0。 */
function num(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** 业务不成立时的统一返回：不抛异常，只给用户看的话。 */
function fail(message: string): SuiteActionResultDto {
  return { ok: false, changed: false, message, item: null };
}

/** 阶段中文名。 */
function labelOf(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
}

/** 进度点 → 进度状态：满一百为 done，其余按有无进度分 doing / todo。 */
function statusOf(value: number): SuiteProgressStatus {
  if (value >= 100) return 'done';
  if (value > 0) return 'doing';
  return 'todo';
}

/** 本地时区的 YYYY-MM-DD。台账里的「今天」一律按服务端本地日切分。 */
function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 是否同一天（可空日期按「不是同一天」处理）。 */
function isSameDay(date: Date | null, base: Date): boolean {
  return date != null && dayKey(date) === dayKey(base);
}

/** 打卡日期必须是真实存在的 YYYY-MM-DD（2026-02-30 这类会被判为非法）。 */
function isValidDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  return dayKey(parsed) === value;
}

/** 一次专注的留痕行：时刻（用于今日次数）与幂等键（用于去重）。 */
type FocusLogRow = { at: string; key: string };

/** 读条目上的专注留痕；结构不对的行直接忽略，不让脏数据打断整条记录。 */
function readFocusLog(payload: Record<string, unknown>): FocusLogRow[] {
  const raw = payload['focusLog'];
  if (!Array.isArray(raw)) return [];
  const rows: FocusLogRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const at = str(record['at']);
    const key = str(record['key']);
    if (!at || !key) continue;
    rows.push({ at, key });
  }
  return rows;
}

/** 读条目上的打卡日期列表。 */
function readCheckinDates(payload: Record<string, unknown>): string[] {
  const raw = payload['checkinDates'];
  if (!Array.isArray(raw)) return [];
  return raw.map((value) => str(value)).filter((value) => value !== '');
}

/** 该条目今天（服务端本地日）的专注次数。 */
function todayFocusCount(payload: Record<string, unknown>): number {
  const today = dayKey(new Date());
  return readFocusLog(payload).filter((row) => {
    const at = new Date(row.at);
    return !Number.isNaN(at.getTime()) && dayKey(at) === today;
  }).length;
}

/**
 * 连续打卡天数：从最近一次打卡日往前逐日回算，遇到中断即停。
 *
 * 所有习惯的日期合在一起算（习惯名不同但同一天都算打过卡），
 * 不做补签美化：断了就是断了，累计次数另行保留。
 */
function longestStreak(dates: string[]): number {
  const sorted = [...new Set(dates.filter((d) => d !== ''))].sort().reverse();
  if (sorted.length === 0) return 0;
  let streak = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = new Date(`${sorted[i - 1]}T00:00:00`);
    const cur = new Date(`${sorted[i]}T00:00:00`);
    if (Number.isNaN(prev.getTime()) || Number.isNaN(cur.getTime())) break;
    const gapDays = Math.round((prev.getTime() - cur.getTime()) / 86_400_000);
    if (gapDays !== 1) break;
    streak += 1;
  }
  return streak;
}

/**
 * 领域 meta：预估时长 / 关联习惯 / 今日专注次数三行必给，
 * 计划时段只在排过时段时补一行（没排就不占位）。
 */
function productivityMeta(payload: Record<string, unknown>): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: '预估时长', value: str(payload['estimate']) || '未设置' },
    { label: '关联习惯', value: str(payload['habit']) || '未设置' },
    { label: '今日专注次数', value: `${todayFocusCount(payload)} 次` },
  ];
  const slot = str(payload['slot']);
  if (slot) rows.push({ label: '计划时段', value: slot });
  return rows;
}

/** 看板记录 → 领域条目（摘要与 meta 按效率工具口径产出）。 */
function toItem(board: SuiteBoardRecord): SuiteDomainItemDto {
  const payload = board.payload ?? {};
  return toDomainItem({
    id: board.id,
    title: board.title,
    summary: str(payload['summary']) || board.title,
    stage: board.stage,
    stageLabel: labelOf(board.stage),
    priority: board.priority,
    amountFen: board.amountFen,
    meta: productivityMeta(payload),
    payload,
    updatedAt: board.updatedAt,
  });
}

/** 取当前用户的条目；不属于本人一律当作不存在。 */
async function findBoard(ctx: SuiteDomainActionContext): Promise<SuiteBoardRecord | null> {
  const entryId = ctx.input.entryId?.trim() ?? '';
  if (!entryId) return null;
  const found = await ctx.store.suite.boards.find(entryId);
  if (!found || found.userId !== ctx.userId) return null;
  return found;
}

/**
 * 写进度行：同一 (用户, 领域, 条目) 只保留一行，重复写即覆盖。
 */
async function writeProgress(
  ctx: SuiteDomainActionContext,
  entryId: string,
  status: SuiteProgressStatus,
  value: number,
  notes: string,
): Promise<void> {
  const userId = ctx.userId as string;
  const existing = await ctx.store.suite.progress.find(userId, DOMAIN_ID, entryId);
  const now = new Date();
  await ctx.store.suite.progress.upsert({
    id: existing?.id ?? ctx.ids.next().id,
    userId,
    domainId: DOMAIN_ID,
    entryId,
    status,
    value,
    notes: notes || existing?.notes || '',
    dueAt: existing?.dueAt ?? null,
    completedAt: status === 'done' ? (existing?.completedAt ?? now) : null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

/* ---------- 基线看板领域 ---------- */

const base = createBoardDomain({
  id: DOMAIN_ID,
  stages: [
    { key: 'todo', label: '待办' },
    { key: 'doing', label: '进行中' },
    { key: 'done', label: '已完成' },
  ],
  transitions: {
    todo: ['doing'],
    doing: ['done', 'todo'],
    done: [],
  },
  initialStage: 'todo',
  eventKind: 'todo',
  describe: (board) => ({
    summary: str(board.payload['summary']) || board.title,
    meta: productivityMeta(board.payload ?? {}),
  }),
});

/* ---------- 领域动作 ---------- */

/**
 * focus：专注一次。
 *
 * 条目上的 focusCount +1、focusMinutes +25，并同步写进度行：
 * value = min(100, focusCount × 25)，状态按 value 取 todo / doing / done。
 *
 * 幂等键是 payload.focusAt（这次专注的时刻）：同一个时刻重复提交不再累加，
 * 只回报当前累计值。网络抖动或重复点击都不会把时长记多。
 */
async function focusAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const rawFocusAt = str(ctx.input.payload?.['focusAt']);
  if (!rawFocusAt) return fail('请提供专注时刻（focusAt），用于避免重复计时');
  const parsedFocusAt = new Date(rawFocusAt);
  if (Number.isNaN(parsedFocusAt.getTime())) {
    return fail('专注时刻无法识别，请用完整的日期时间格式');
  }
  const focusAt = parsedFocusAt.toISOString();

  const payload = board.payload ?? {};
  const log = readFocusLog(payload);
  const count = num(payload['focusCount']);
  const minutes = num(payload['focusMinutes']);
  const value = Math.min(100, count * FOCUS_VALUE);
  const status = statusOf(value);

  // 幂等：同一个专注时刻已经记过，就不再累加。
  if (log.some((row) => row.key === focusAt)) {
    return {
      ok: true,
      changed: false,
      message: `这次专注已经记过了（累计 ${count} 次 · ${minutes} 分钟）`,
      item: toItem(board),
      data: { focusCount: count, focusMinutes: minutes, value, status },
    };
  }

  const nextCount = count + 1;
  const nextMinutes = minutes + FOCUS_MINUTES;
  const nextValue = Math.min(100, nextCount * FOCUS_VALUE);
  const nextStatus = statusOf(nextValue);
  const nextLog = [...log, { at: focusAt, key: focusAt }].slice(-FOCUS_LOG_LIMIT);

  const updated = await ctx.store.suite.boards.update(board.id, {
    // 待办上的第一次专注即视为开工：阶段从待办推进到进行中（transitions 已声明）。
    stage: board.stage === 'todo' ? 'doing' : board.stage,
    payload: {
      ...payload,
      focusCount: nextCount,
      focusMinutes: nextMinutes,
      focusLog: nextLog,
    },
  });
  if (!updated) return fail('专注记录失败，请稍后再试');

  await writeProgress(
    ctx,
    board.id,
    nextStatus,
    nextValue,
    `专注 ${nextCount} 次 · ${nextMinutes} 分钟`,
  );

  return {
    ok: true,
    changed: true,
    message: `已记一次专注（累计 ${nextCount} 次 · ${nextMinutes} 分钟，进度 ${nextValue}%）`,
    item: toItem(updated),
    data: {
      focusCount: nextCount,
      focusMinutes: nextMinutes,
      value: nextValue,
      status: nextStatus,
    },
  };
}

/**
 * complete：把待办收口成已完成。
 *
 * 收口时写进度（done / 100），并落一条 suite_events（kind = focus-session）
 * 把这次专注会话的次数与分钟数留痕，供「我的」页聚合与事后复盘。
 *
 * 幂等：已经完成的条目再次点完成 → changed=false，且不再重复落事件。
 */
async function completeAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const payload = board.payload ?? {};
  if (board.stage === 'done') {
    return {
      ok: true,
      changed: false,
      message: '这条待办已经完成了',
      item: toItem(board),
      data: { value: 100, status: 'done' },
    };
  }

  const now = new Date();
  const updated = await ctx.store.suite.boards.update(board.id, {
    stage: 'done',
    payload: { ...payload, completedAt: now.toISOString() },
  });
  if (!updated) return fail('完成失败，请稍后再试');

  await writeProgress(ctx, board.id, 'done', 100, '已完成');

  await ctx.store.suite.events.insert({
    id: ctx.ids.next().id,
    domainId: DOMAIN_ID,
    userId: ctx.userId as string,
    kind: FOCUS_EVENT_KIND,
    subject: board.title,
    amountFen: 0,
    status: 'done',
    outTradeNo: null,
    payload: {
      boardId: board.id,
      focusCount: num(payload['focusCount']),
      focusMinutes: num(payload['focusMinutes']),
      completedAt: now.toISOString(),
    },
    createdAt: now,
    updatedAt: now,
  });

  return {
    ok: true,
    changed: true,
    message: `已完成「${board.title}」`,
    item: toItem(updated),
    data: { value: 100, status: 'done' },
  };
}

/**
 * habit_check：习惯打卡。
 *
 * 入参 payload.habit（习惯名）与 payload.checkinDate（YYYY-MM-DD）。
 * 同一用户、同一天、同一习惯只记一次：重复打卡返回 changed=false，不重复累加。
 * 打卡成功后条目上的 checkins 累加、checkinDates 追加当天日期。
 */
async function habitCheckAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const habit = str(ctx.input.payload?.['habit']);
  if (!habit) return fail('请填写习惯名称，例如「早起 30 分钟」');
  const checkinDate = str(ctx.input.payload?.['checkinDate']);
  if (!checkinDate) return fail('请提供打卡日期（YYYY-MM-DD）');
  if (!isValidDayKey(checkinDate)) return fail('打卡日期需要是 YYYY-MM-DD 这样的有效日期');

  const payload = board.payload ?? {};
  const checkins = num(payload['checkins']);

  // 幂等：同一用户同一天同一习惯只记一次。
  const events = await ctx.store.suite.events.listByUser(ctx.userId as string, {
    domainId: DOMAIN_ID,
    kind: HABIT_EVENT_KIND,
  });
  const duplicated = events.find(
    (event) =>
      str(event.payload?.['habit']) === habit &&
      str(event.payload?.['checkinDate']) === checkinDate,
  );
  if (duplicated) {
    return {
      ok: true,
      changed: false,
      message: `「${habit}」今天已经打过卡了（累计 ${checkins} 次）`,
      item: toItem(board),
      data: { habit, checkinDate, checkins },
    };
  }

  const nextCheckins = checkins + 1;
  const nextDates = [...readCheckinDates(payload), checkinDate].slice(-CHECKIN_DATE_LIMIT);
  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: {
      ...payload,
      habit,
      checkins: nextCheckins,
      checkinDates: nextDates,
      lastCheckinDate: checkinDate,
    },
  });
  if (!updated) return fail('打卡失败，请稍后再试');

  const now = new Date();
  await ctx.store.suite.events.insert({
    id: ctx.ids.next().id,
    domainId: DOMAIN_ID,
    userId: ctx.userId as string,
    kind: HABIT_EVENT_KIND,
    subject: habit,
    amountFen: 0,
    status: 'done',
    outTradeNo: null,
    payload: { boardId: board.id, habit, checkinDate, checkins: nextCheckins },
    createdAt: now,
    updatedAt: now,
  });

  return {
    ok: true,
    changed: true,
    message: `已为「${habit}」打卡（累计 ${nextCheckins} 次）`,
    item: toItem(updated),
    data: { habit, checkinDate, checkins: nextCheckins },
  };
}

/**
 * plan：安排计划时段。
 *
 * payload.slot 写计划时段；到期时间严格取输入 at：给了就设，没给就清空，
 * 免得条目留着上一个时段的到期日。同一时段 + 同一到期时间重复提交 → changed=false。
 */
async function planAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const slot = str(ctx.input.payload?.['slot']);
  if (!slot) return fail('请填写计划时段，例如 09:30-11:00');

  const rawAt = str(ctx.input.at);
  let dueAt: Date | null = null;
  if (rawAt) {
    const parsed = new Date(rawAt);
    if (Number.isNaN(parsed.getTime())) {
      return fail('计划时间无法识别，请用完整的日期时间格式');
    }
    dueAt = parsed;
  }

  const payload = board.payload ?? {};
  const prevSlot = str(payload['slot']);
  const prevDue = board.dueAt ? board.dueAt.getTime() : 0;
  const sameSlot = prevSlot === slot;
  const sameDue = (dueAt ? dueAt.getTime() : 0) === prevDue;
  if (sameSlot && sameDue) {
    return {
      ok: true,
      changed: false,
      message: `已经安排在「${slot}」`,
      item: toItem(board),
      data: { slot, dueAt: dueAt ? dueAt.toISOString() : null },
    };
  }

  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: { ...payload, slot, ...(rawAt ? { plannedAt: rawAt } : {}) },
    dueAt,
  });
  if (!updated) return fail('安排时段失败，请稍后再试');

  return {
    ok: true,
    changed: true,
    message: dueAt ? `已安排在「${slot}」，到期时间 ${dayKey(dueAt)}` : `已安排在「${slot}」`,
    item: toItem(updated),
    data: { slot, dueAt: dueAt ? dueAt.toISOString() : null },
  };
}

/* ---------- 对外导出 ---------- */

export const productivityModule: SuiteDomainModule = {
  id: 'productivity',

  /** 读：条目 + 领域 meta（预估时长 / 关联习惯 / 今日专注次数）。 */
  async list(ctx: SuiteDomainReadContext): Promise<SuiteDomainItemDto[]> {
    const boards = await ctx.store.suite.boards.listByUser(ctx.userId as string, {
      domainId: DOMAIN_ID,
    });
    return boards.map((board) => toItem(board));
  },

  /** 写：领域动作优先，未命中再回落到基线的 create / advance / setStage / remove。 */
  async act(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
    switch (ctx.input.action) {
      case 'focus':
        return focusAction(ctx);
      case 'complete':
        return completeAction(ctx);
      case 'habit_check':
        return habitCheckAction(ctx);
      case 'plan':
        return planAction(ctx);
      default:
        return base.act(ctx);
    }
  },

  /**
   * 统计：今日待办数、累计专注次数、连续打卡天数。
   * 某一项没有对应数据时整项不出现，不用零值或估算值占位。
   */
  async stats(ctx: SuiteDomainReadContext) {
    const userId = ctx.userId as string;
    const boards = await ctx.store.suite.boards.listByUser(userId, { domainId: DOMAIN_ID });
    const now = new Date();
    const metrics: Array<{ label: string; value: string; hint?: string }> = [];

    // 今日待办数：今天新建或今天到期的条目里，还没做完的那几条。
    // 今天有条目但全部做完时给 0（数据在，只是没有未完成的）；
    // 今天根本没有条目时整项不出现，不用零值占位。
    const todayBoards = boards.filter(
      (board) => isSameDay(board.createdAt, now) || isSameDay(board.dueAt, now),
    );
    if (todayBoards.length > 0) {
      const pending = todayBoards.filter((board) => board.stage !== 'done').length;
      metrics.push({
        label: '今日待办数',
        value: `${pending} 条`,
        hint: '今天新建或今天到期的条目里尚未完成的部分',
      });
    }

    // 累计专注次数：全部条目的 focusCount 之和。
    const focusTotal = boards.reduce((sum, board) => sum + num(board.payload?.['focusCount']), 0);
    if (focusTotal > 0) {
      metrics.push({
        label: '累计专注次数',
        value: `${focusTotal} 次`,
        hint: '全部条目累计的专注次数，每次按二十五分钟计',
      });
    }

    // 连续打卡天数：按打卡日期从最近一次往前逐日回算，中断即归零。
    const events = await ctx.store.suite.events.listByUser(userId, {
      domainId: DOMAIN_ID,
      kind: HABIT_EVENT_KIND,
    });
    const checkinDates = events.map((event) => str(event.payload?.['checkinDate']));
    const streak = longestStreak(checkinDates);
    if (streak > 0) {
      metrics.push({
        label: '连续打卡天数',
        value: `${streak} 天`,
        hint: '按打卡日期从最近一次往前逐日回算，中断即归零，不做补签',
      });
    }

    const baseStats = await base.stats(ctx);
    return [...metrics, ...baseStats];
  },
};
