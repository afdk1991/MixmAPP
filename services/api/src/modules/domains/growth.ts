import type { SuiteActionResultDto, SuiteDomainId, SuiteDomainItemDto } from '@mixmapp/contracts';
import type { SuiteBoardRecord } from '../../db/types.js';
import {
  canTransit,
  createBoardDomain,
  toDomainItem,
  type SuiteDomainActionContext,
  type SuiteDomainModule,
  type SuiteDomainReadContext,
  type SuiteMetaEntry,
} from '../suite/domain.js';

/**
 * 营销增长领域模块（活动策划、渠道归因、投产比与复购）。
 *
 * 基线是「条目 + 阶段状态机」：策划中 → 进行中 → 已结算。
 * 营销增长的专属语义在下面四处扩展：
 * - list：补齐投放渠道 / 预算 / 投产比 / 触点数，并按「阶段优先级 + 更新时间」排序；
 * - act：launch（启动活动）、funnel（漏斗）、roi（投产比）、attribute（归因）、
 *   settle（结算）五个领域动作，未命中时回落到基线的 create / advance / setStage / remove；
 * - stats：进行中活动数、已结算活动数、总预算、平均投产比。
 *
 * 三条硬规矩（与 docs/49 §4.4 一致）：
 * - 幂等：同一 action + 同一份入参重复提交，第二次必须 changed=false；
 * - 不抛异常：业务上不成立时返回 { ok:false, changed:false, message, item:null }；
 * - 金额一律用整数分，展示给用户的文案自己换算成元。
 *
 * 口径说明（三条容易被误读，先写在这里）：
 * - 「预算」是启动活动时登记的计划额度（payload.budgetFen），与结算时按实际发生
 *   写入的花费（条目 amountFen / payload.spendFen）是两个数，不能互相顶替；
 * - 漏斗的各级转化率与总体转化率一律按**百分比**给（0 到 100，两位小数），
 *   分母为 0 时按 0 计，不返回无穷大；
 * - 投产比 = 收入 ÷ 花费，两位小数；「回收倍数」是同一个数的口语说法，
 *   数据里两个字段都给，前端按不同场景取用。
 */
const DOMAIN_ID = 'growth' as SuiteDomainId;

/** 阶段中文名。与基线 stages 的 label 保持一致。 */
const STAGE_LABEL: Record<string, string> = {
  draft: '策划中',
  running: '进行中',
  settled: '已结算',
};

/** 阶段排序权重：策划中 → 进行中 → 已结算，已结算沉底。 */
const STAGE_ORDER: Record<string, number> = {
  draft: 0,
  running: 1,
  settled: 2,
};

/**
 * 允许的阶段迁移。
 *
 * 策划中只能启动，进行中可结算也可退回策划中，已结算为终态。
 * 所有迁移边都在这里声明，不做隐式跳转。
 */
const TRANSITIONS: Record<string, readonly string[]> = {
  draft: ['running'],
  running: ['settled', 'draft'],
  settled: [],
};

/** 台账事件类型：活动条目（沿用基线）。 */
const ITEM_EVENT_KIND = 'campaign';
/** 台账事件类型：漏斗快照。 */
const FUNNEL_EVENT_KIND = 'funnel';
/** 台账事件类型：活动结算留痕。 */
const SETTLEMENT_EVENT_KIND = 'campaign-settlement';

const base = createBoardDomain({
  id: DOMAIN_ID,
  stages: [
    { key: 'draft', label: '策划中' },
    { key: 'running', label: '进行中' },
    { key: 'settled', label: '已结算' },
  ],
  transitions: TRANSITIONS,
  initialStage: 'draft',
  eventKind: ITEM_EVENT_KIND,
  describe: (board) => ({
    summary: text(board.payload['summary']) || board.title,
    meta: growthMeta(board.payload ?? {}),
  }),
});

/* ---------- 通用小工具 ---------- */

/** 取字符串（去首尾空白）；非字符串一律视为空串。 */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 取数字；拿不到或不是有限数返回 null。 */
function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 从任意对象里取一个数字字段；取不到返回 null。 */
function numOf(source: unknown, key: string): number | null {
  if (!source || typeof source !== 'object') return null;
  return num((source as Record<string, unknown>)[key]);
}

/** 分 → 元文案（固定两位小数，合计时不丢角分）。 */
function yuan(fen: number): string {
  return (fen / 100).toFixed(2);
}

/** 业务不成立时的统一返回：不抛异常，只给用户看的话。 */
function fail(message: string): SuiteActionResultDto {
  return { ok: false, changed: false, message, item: null };
}

/** 阶段中文名。 */
function labelOf(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
}

/** 领域 meta：投放渠道 / 预算 / 投产比 / 触点数。没有的项直接不出现。 */
function growthMeta(payload: Record<string, unknown>): SuiteMetaEntry[] {
  const channel = text(payload['channel']);
  const budgetFen = numOf(payload, 'budgetFen');
  const roi = numOf(payload, 'roi');
  const touchCount = numOf(payload, 'touchCount');
  const meta: SuiteMetaEntry[] = [];
  if (channel) meta.push({ label: '投放渠道', value: channel });
  if (budgetFen !== null && budgetFen > 0) meta.push({ label: '预算', value: `${yuan(budgetFen)} 元` });
  if (roi !== null) meta.push({ label: '投产比', value: roi.toFixed(2) });
  if (touchCount !== null && touchCount > 0) meta.push({ label: '触点数', value: String(touchCount) });
  return meta;
}

/** 看板记录 → 领域条目。 */
function toItem(board: SuiteBoardRecord): SuiteDomainItemDto {
  const payload = board.payload ?? {};
  return toDomainItem({
    id: board.id,
    title: board.title,
    summary: text(payload['summary']) || board.title,
    stage: board.stage,
    stageLabel: labelOf(board.stage),
    priority: board.priority,
    amountFen: board.amountFen,
    meta: growthMeta(payload),
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

/** 当前用户在营销增长领域的全部条目。 */
async function listBoards(ctx: SuiteDomainReadContext): Promise<SuiteBoardRecord[]> {
  return ctx.store.suite.boards.listByUser(ctx.userId as string, { domainId: DOMAIN_ID });
}

/* ---------- 漏斗口径 ---------- */

/** 漏斗四级：点击 → 访问 → 线索 → 订单。 */
type FunnelNumbers = {
  clicks: number;
  visits: number;
  leads: number;
  orders: number;
};

/** 各级转化率（百分比，两位小数）。 */
type FunnelRates = {
  clickToVisit: number;
  visitToLead: number;
  leadToOrder: number;
};

/** 百分比（四舍五入两位）；分母为 0 或非法时按 0 计，不返回无穷大。 */
function percent(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

/** 解析漏斗入参：缺级或出现负数都不成立。 */
function parseFunnel(raw: unknown): { ok: true; value: FunnelNumbers } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: '漏斗需要完整的四级数据：点击、访问、线索、订单' };
  }
  const source = raw as Record<string, unknown>;
  const values: FunnelNumbers = { clicks: 0, visits: 0, leads: 0, orders: 0 };
  const keys: Array<keyof FunnelNumbers> = ['clicks', 'visits', 'leads', 'orders'];
  for (const key of keys) {
    const value = num(source[key]);
    if (value === null) {
      return { ok: false, message: `漏斗缺少「${key}」这一级，请补齐点击、访问、线索、订单` };
    }
    if (value < 0) {
      return { ok: false, message: `漏斗的「${key}」不能是负数` };
    }
    values[key] = Math.round(value);
  }
  return { ok: true, value: values };
}

/** 两次漏斗入参是否完全一致（幂等判定用）。 */
function sameFunnel(prev: unknown, next: FunnelNumbers): boolean {
  if (!prev || typeof prev !== 'object') return false;
  const source = prev as Record<string, unknown>;
  const keys: Array<keyof FunnelNumbers> = ['clicks', 'visits', 'leads', 'orders'];
  return keys.every((key) => num(source[key]) === next[key]);
}

/* ---------- 归因口径 ---------- */

/** 是否转化：接受布尔、数字与常见文案写法。 */
function toConverted(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value === 'string') {
    const cleaned = value.trim().toLowerCase();
    if (cleaned === '') return false;
    if (['true', '1', 'yes', 'y', '是', '已转化'].includes(cleaned)) return true;
    if (['false', '0', 'no', 'n', '否', '未转化'].includes(cleaned)) return false;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) && parsed > 0;
  }
  return false;
}

/** 两次触点列表是否完全一致（幂等判定用）。 */
function sameTouchpoints(prev: unknown[], next: string[]): boolean {
  if (prev.length !== next.length) return false;
  return prev.every((item, index) => text(item) === next[index]);
}

/* ---------- 领域动作 ---------- */

/**
 * launch：启动活动（策划中 → 进行中）。
 *
 * 必填 payload.channel（投放渠道）与 payload.budgetFen（预算，整数分）。
 * 启动成功后把 payload.launchedAt 记下，作为这轮投放的时间起点。
 * 缺项 → ok=false；活动已在进行中 → changed=false（不重复启动、不重复记账）。
 */
async function launch(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('活动不存在或不属于你');

  const payload = ctx.input.payload ?? {};
  const channel = text(payload['channel']);
  if (!channel) return fail('启动活动需要填写投放渠道');
  const budgetFen = num(payload['budgetFen']);
  if (budgetFen === null || !Number.isInteger(budgetFen) || budgetFen <= 0) {
    return fail('启动活动需要填写大于 0 的预算（整数分）');
  }

  // 幂等：已在进行中的活动重复启动只回报当前状态，不改数据。
  if (board.stage === 'running') {
    const prevChannel = text(board.payload?.['channel']);
    const prevBudget = numOf(board.payload, 'budgetFen');
    const same = prevChannel === channel && prevBudget === budgetFen;
    return {
      ok: true,
      changed: false,
      message: same
        ? `活动已在进行中（${prevChannel}，预算 ${yuan(prevBudget ?? 0)} 元）`
        : '活动已在进行中，渠道与预算需要调整时请先结算或另建活动',
      item: toItem(board),
      data: { channel: prevChannel, budgetFen: prevBudget },
    };
  }
  if (board.stage === 'settled') return fail('已结算的活动不能重新启动');
  if (!canTransit(TRANSITIONS, board.stage, 'running')) {
    return fail(`「${labelOf(board.stage)}」的活动不能直接启动`);
  }

  const now = new Date();
  const launchedAt = now.toISOString();
  const updated = await ctx.store.suite.boards.update(board.id, {
    stage: 'running',
    payload: { ...(board.payload ?? {}), channel, budgetFen, launchedAt },
  });
  if (!updated) return fail('启动失败，请稍后再试');
  return {
    ok: true,
    changed: true,
    message: `活动已启动：${channel}，预算 ${yuan(budgetFen)} 元`,
    item: toItem(updated),
    data: { channel, budgetFen, launchedAt },
  };
}

/**
 * funnel：记录漏斗四级并算转化率。
 *
 * 入参 payload.funnel = { clicks, visits, leads, orders }，四级缺一不可、不能为负。
 * 返回 data { funnel, rates, overall }：rates 是三级转化率，overall 是点击到订单的总体转化率，
 * 一律按百分比给。同时落一条 kind='funnel' 的台账事件，供事后回看同一轮活动的漏斗快照。
 */
async function funnel(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('活动不存在或不属于你');

  const parsed = parseFunnel(ctx.input.payload?.['funnel']);
  if (!parsed.ok) return fail(parsed.message);
  const values = parsed.value;

  const rates: FunnelRates = {
    clickToVisit: percent(values.visits, values.clicks),
    visitToLead: percent(values.leads, values.visits),
    leadToOrder: percent(values.orders, values.leads),
  };
  const overall = percent(values.orders, values.clicks);
  const data = { funnel: values, rates, overall };

  // 幂等：同一组漏斗数据重复提交不再写事件。
  if (sameFunnel(board.payload?.['funnel'], values)) {
    return {
      ok: true,
      changed: false,
      message: `漏斗未变化：总体转化率 ${overall}%`,
      item: toItem(board),
      data,
    };
  }

  const now = new Date();
  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: {
      ...(board.payload ?? {}),
      funnel: values,
      funnelRates: rates,
      funnelOverall: overall,
    },
  });
  if (!updated) return fail('漏斗记录失败，请稍后再试');

  await ctx.store.suite.events.insert({
    id: ctx.ids.next().id,
    domainId: DOMAIN_ID,
    userId: ctx.userId as string,
    kind: FUNNEL_EVENT_KIND,
    subject: board.title,
    amountFen: 0,
    status: 'done',
    outTradeNo: null,
    payload: {
      boardId: board.id,
      stage: board.stage,
      channel: text(board.payload?.['channel']),
      funnel: values,
      rates,
      overall,
      recordedAt: now.toISOString(),
    },
    createdAt: now,
    updatedAt: now,
  });

  return {
    ok: true,
    changed: true,
    message: `漏斗已记录：点击 ${values.clicks} → 订单 ${values.orders}，总体转化率 ${overall}%`,
    item: toItem(updated),
    data,
  };
}

/**
 * roi：算投产比。
 *
 * 入参 payload.spendFen（花费，整数分）与 payload.revenueFen（收入，整数分）。
 * 投产比 = 收入 ÷ 花费，保留两位小数；回收倍数是同一个数的口语说法，一并给出。
 * 花费必须大于 0，否则不成立。带 entryId 时把两个数与投产比写回条目，
 * 供列表的「投产比」与统计里的「平均投产比」使用。
 */
async function roi(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const payload = ctx.input.payload ?? {};
  const spendFen = num(payload['spendFen']);
  const revenueFen = num(payload['revenueFen']);
  if (spendFen === null || !Number.isInteger(spendFen) || spendFen <= 0) {
    return fail('算投产比需要填写大于 0 的花费（整数分）');
  }
  if (revenueFen === null || !Number.isInteger(revenueFen) || revenueFen < 0) {
    return fail('算投产比需要填写不小于 0 的收入（整数分）');
  }

  const roiValue = Number((revenueFen / spendFen).toFixed(2));
  const multiple = roiValue;
  const profitFen = revenueFen - spendFen;
  const data = { spendFen, revenueFen, roi: roiValue, multiple, profitFen };
  const message = `投产比 ${roiValue.toFixed(2)}（每投入 1 元回收 ${roiValue.toFixed(2)} 元），毛利 ${yuan(profitFen)} 元`;

  const board = await findBoard(ctx);
  // 没有归属活动时只做测算，不落台账。
  if (!board) {
    return { ok: true, changed: false, message, item: null, data };
  }

  const prevSpend = numOf(board.payload, 'spendFen');
  const prevRevenue = numOf(board.payload, 'revenueFen');
  if (prevSpend === spendFen && prevRevenue === revenueFen) {
    return { ok: true, changed: false, message, item: toItem(board), data };
  }

  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: { ...(board.payload ?? {}), spendFen, revenueFen, roi: roiValue },
  });
  if (!updated) return fail('投产比记录失败，请稍后再试');
  return { ok: true, changed: true, message, item: toItem(updated), data };
}

/**
 * attribute：渠道归因。
 *
 * 入参 payload.channel（渠道）、payload.touchpoints（触点数组）、payload.converted（是否转化）。
 * 记下 payload.firstTouch / lastTouch / touchCount：首触看谁把用户带进来，末触看谁促成成交，
 * 触点数说明这次成交的路径长短。
 */
async function attribute(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const payload = ctx.input.payload ?? {};
  const channel = text(payload['channel']);
  if (!channel) return fail('归因需要填写渠道');

  const raw = payload['touchpoints'];
  if (!Array.isArray(raw)) return fail('归因需要填写触点列表');
  const touchpoints = raw.map((item) => text(item)).filter((item) => item !== '');
  if (touchpoints.length === 0) return fail('归因需要填写触点列表');

  const converted = toConverted(payload['converted']);
  const firstTouch = touchpoints[0];
  const lastTouch = touchpoints[touchpoints.length - 1];
  const touchCount = touchpoints.length;
  const data = { channel, touchpoints, firstTouch, lastTouch, touchCount, converted };
  const message = `归因已记录：首触 ${firstTouch}，末触 ${lastTouch}，共 ${touchCount} 个触点${converted ? '（已转化）' : ''}`;

  const board = await findBoard(ctx);
  if (!board) {
    return { ok: true, changed: false, message, item: null, data };
  }

  const prev = board.payload ?? {};
  const same =
    text(prev['channel']) === channel &&
    Array.isArray(prev['touchpoints']) &&
    sameTouchpoints(prev['touchpoints'] as unknown[], touchpoints) &&
    toConverted(prev['converted']) === converted;
  if (same) {
    return { ok: true, changed: false, message, item: toItem(board), data };
  }

  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: { ...prev, channel, touchpoints, firstTouch, lastTouch, touchCount, converted },
  });
  if (!updated) return fail('归因记录失败，请稍后再试');
  return { ok: true, changed: true, message, item: toItem(updated), data };
}

/**
 * settle：结算活动（进行中 → 已结算）。
 *
 * 入参 payload.spendFen（实际花费，整数分）。结算把花费写进条目 amountFen，
 * 同时落一条 kind='campaign-settlement' 的台账事件备查，并把进度记为完成。
 * 已结算的活动重复提交只回报当前金额，不再写第二条事件。
 */
async function settle(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('活动不存在或不属于你');

  // 幂等：已结算的活动重复结算不改数据，也不重复记账。
  if (board.stage === 'settled') {
    return {
      ok: true,
      changed: false,
      message: `该活动已结算（花费 ${yuan(board.amountFen)} 元）`,
      item: toItem(board),
      data: { amountFen: board.amountFen },
    };
  }

  const spendFen = num(ctx.input.payload?.['spendFen']);
  if (spendFen === null || !Number.isInteger(spendFen) || spendFen <= 0) {
    return fail('结算需要填写大于 0 的实际花费（整数分）');
  }
  if (board.stage !== 'running') {
    return fail('策划中的活动不能结算，请先启动活动');
  }
  if (!canTransit(TRANSITIONS, board.stage, 'settled')) {
    return fail(`「${labelOf(board.stage)}」的活动不能直接结算`);
  }

  const userId = ctx.userId as string;
  const now = new Date();
  const updated = await ctx.store.suite.boards.update(board.id, {
    stage: 'settled',
    amountFen: spendFen,
    payload: { ...(board.payload ?? {}), spendFen },
  });
  if (!updated) return fail('结算失败，请稍后再试');

  // 进度：结算即完成。
  const existing = await ctx.store.suite.progress.find(userId, DOMAIN_ID, board.id);
  await ctx.store.suite.progress.upsert({
    id: existing?.id ?? ctx.ids.next().id,
    userId,
    domainId: DOMAIN_ID,
    entryId: board.id,
    status: 'done',
    value: 100,
    notes: `结算 ${yuan(spendFen)} 元`,
    dueAt: existing?.dueAt ?? null,
    completedAt: existing?.completedAt ?? now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  // 台账事件：结算留痕，供对账与复盘回看。
  await ctx.store.suite.events.insert({
    id: ctx.ids.next().id,
    domainId: DOMAIN_ID,
    userId,
    kind: SETTLEMENT_EVENT_KIND,
    subject: board.title,
    amountFen: spendFen,
    status: 'done',
    outTradeNo: null,
    payload: {
      boardId: board.id,
      stage: 'settled',
      channel: text(board.payload?.['channel']),
      spendFen,
      settledAt: now.toISOString(),
    },
    createdAt: now,
    updatedAt: now,
  });

  return {
    ok: true,
    changed: true,
    message: `已结算：实际花费 ${yuan(spendFen)} 元`,
    item: toItem(updated),
    data: { amountFen: spendFen, settledAt: now.toISOString() },
  };
}

/**
 * advance 的领域化：从「策划中」推进时走启动流程，从「进行中」推进时走结算流程，
 * 让渠道、预算、实际花费与台账事件一次落齐；其余情况仍由基线推进。
 */
async function advance(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return base.act(ctx);
  if (board.stage === 'draft') return launch(ctx);
  if (board.stage === 'running') return settle(ctx);
  return base.act(ctx);
}

/* ---------- 对外导出 ---------- */

export const growthModule: SuiteDomainModule = {
  id: 'growth',

  /**
   * 读：基线条目 + 领域 meta（投放渠道 / 预算 / 投产比 / 触点数）。
   * 排序口径：先按阶段优先级（策划中 → 进行中 → 已结算），
   * 同一阶段内按更新时间倒序。
   */
  async list(ctx: SuiteDomainReadContext): Promise<SuiteDomainItemDto[]> {
    const boards = await listBoards(ctx);
    return boards
      .map((board) => toItem(board))
      .sort((a, b) => {
        const rank = (STAGE_ORDER[a.stage] ?? 99) - (STAGE_ORDER[b.stage] ?? 99);
        if (rank !== 0) return rank;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  },

  /** 写：领域动作优先，未命中再回落到基线的 create / advance / setStage / remove。 */
  async act(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
    switch (ctx.input.action) {
      case 'launch':
        return launch(ctx);
      case 'funnel':
        return funnel(ctx);
      case 'roi':
        return roi(ctx);
      case 'attribute':
        return attribute(ctx);
      case 'settle':
        return settle(ctx);
      case 'advance':
        return advance(ctx);
      default:
        return base.act(ctx);
    }
  },

  /**
   * 统计：进行中活动数、已结算活动数、总预算、平均投产比。
   * 总预算取各活动登记的预算额度之和；平均投产比只统计已算过投产比的活动。
   * 没有数据时不给假数（对应指标直接不出现）。
   */
  async stats(ctx: SuiteDomainReadContext): Promise<Array<{ label: string; value: string; hint?: string }>> {
    const boards = await listBoards(ctx);
    const metrics: Array<{ label: string; value: string; hint?: string }> = [];

    const running = boards.filter((board) => board.stage === 'running');
    const settled = boards.filter((board) => board.stage === 'settled');
    if (running.length > 0) {
      metrics.push({
        label: '进行中活动',
        value: String(running.length),
        hint: '阶段为「进行中」的活动数',
      });
    }
    if (settled.length > 0) {
      metrics.push({
        label: '已结算活动',
        value: String(settled.length),
        hint: '阶段为「已结算」的活动数',
      });
    }

    const budgetFen = boards.reduce((sum, board) => sum + (numOf(board.payload, 'budgetFen') ?? 0), 0);
    if (budgetFen > 0) {
      metrics.push({
        label: '总预算',
        value: `${yuan(budgetFen)} 元`,
        hint: '各活动登记的预算额度合计',
      });
    }

    const rois = boards
      .map((board) => numOf(board.payload, 'roi'))
      .filter((value): value is number => value !== null);
    if (rois.length > 0) {
      const average = rois.reduce((sum, value) => sum + value, 0) / rois.length;
      metrics.push({
        label: '平均投产比',
        value: average.toFixed(2),
        hint: `已算过投产比的 ${rois.length} 个活动平均值`,
      });
    }

    return metrics;
  },
};
