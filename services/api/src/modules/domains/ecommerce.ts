import type { SuiteActionResultDto, SuiteDomainId, SuiteDomainItemDto } from '@mixmapp/contracts';
import type { SuiteBoardRecord } from '../../db/types.js';
import {
  createBoardDomain,
  toDomainItem,
  type SuiteDomainActionContext,
  type SuiteDomainModule,
  type SuiteDomainReadContext,
  type SuiteMetaEntry,
} from '../suite/domain.js';

/**
 * 电商领域模块（客服工单、服务评价与复购运营）。
 *
 * 边界先说清楚：**商品、购物车与订单由商城模块负责**，这里不重复造。
 * 本领域只做成交之后的那半程：
 * - 客服工单：登记（ticket）→ 分派（assign）→ 回复（respond）→ 评分（rate）→ 解决（resolve）；
 * - 复购运营：按客户 + 商品 + 提醒时间登记复购提醒（reorder）；
 * - 售后与退换：作为工单的一种问题类型（issueType = 售后 / 物流）登记，处理口径与其它工单一致。
 *
 * 基线是「条目 + 阶段状态机」：待处理 → 处理中 → 已解决。
 * 领域专属语义在下面几处扩展：
 * - list：补齐来源渠道 / 关联商品 / 问题类型 / 处理人，并按「优先级 → 更新时间」排序；
 * - act：ticket / assign / respond / rate / resolve / reorder 六个领域动作，
 *   未命中时回落到基线的 create / advance / setStage / remove；
 * - stats：待处理工单数、处理中、平均首次响应时长、平均服务评分。
 *
 * 三条硬规矩（与 docs/49 §4.4 一致）：
 * - 幂等：同一 action + 同一份入参重复提交，第二次必须 changed=false；
 * - 不抛异常：业务不成立时返回 { ok:false, changed:false, message, item:null }；
 * - 金额一律用整数分，展示给用户的文案自己换算成元。
 *
 * 两条容易被误读的口径，先写在这里：
 * - **分派不改阶段**：assign 只落处理人（payload.owner）与分派时间，
 *   工单从待处理走到处理中、或走到已解决，都由 advance / resolve 负责。
 * - **首次响应时长取最小间隔**：工单创建到最早一次回复的间隔；
 *   没有回复记录时用「最后更新时间 − 创建时间」近似，且只统计近 7 天内的工单，
 *   这是估算口径而不是承诺值。
 */
const DOMAIN_ID = 'ecommerce' as SuiteDomainId;

/** 一天的毫秒数，用于时长口径换算。 */
const DAY_MS = 86_400_000;
/** 近 7 天的毫秒数，用于平均首次响应时长的统计窗口。 */
const WEEK_MS = 7 * DAY_MS;

/** 阶段中文名。与基线 stages 的 label 保持一致。 */
const STAGE_LABELS: Record<string, string> = {
  pending: '待处理',
  handling: '处理中',
  resolved: '已解决',
};

/** 允许的阶段迁移：待处理 → 处理中 → 已解决；处理中可退回待处理（补充信息后重排）。 */
const TRANSITIONS: Record<string, readonly string[]> = {
  pending: ['handling'],
  handling: ['resolved', 'pending'],
  resolved: [],
};

/** 问题类型四选一：售前 / 售后 / 物流 / 其他。 */
const ISSUE_TYPES = ['售前', '售后', '物流', '其他'] as const;

/** 优先级取值，与看板优先级口径一致。 */
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

/** 列表排序用的优先级权重：越靠前越先显示（紧急在最上）。 */
const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** 台账事件类型：客服工单登记。 */
const TICKET_EVENT_KIND = 'service-ticket';
/** 台账事件类型：复购提醒登记。 */
const REORDER_EVENT_KIND = 'reorder-reminder';

const base = createBoardDomain({
  id: DOMAIN_ID,
  stages: [
    { key: 'pending', label: '待处理' },
    { key: 'handling', label: '处理中' },
    { key: 'resolved', label: '已解决' },
  ],
  transitions: TRANSITIONS,
  initialStage: 'pending',
  eventKind: TICKET_EVENT_KIND,
  describe: (board) => ({
    summary: text(board.payload['summary']) || board.title,
    // meta 由领域层统一组装（来源渠道 / 关联商品 / 问题类型 / 处理人）。
    meta: [],
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

/** 取对象（payload 里的一层对象）；非对象一律当作空对象。 */
function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** 业务不成立时的统一返回：不抛异常，只给用户看的话。 */
function fail(message: string): SuiteActionResultDto {
  return { ok: false, changed: false, message, item: null };
}

/** 阶段中文名。 */
function labelOf(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

/** 一条工单回复：时间戳 + 内容。 */
type TicketReply = { at: string; content: string };

/** 读条目上已存的回复列表（按写入顺序）。 */
function repliesOf(payload: Record<string, unknown>): TicketReply[] {
  const raw = payload['replies'];
  if (!Array.isArray(raw)) return [];
  const out: TicketReply[] = [];
  for (const entry of raw) {
    const row = obj(entry);
    const content = text(row['content']);
    if (!content) continue;
    out.push({ at: text(row['at']), content });
  }
  return out;
}

/** 这条条目是不是复购提醒（而不是客服工单）。 */
function isReminder(payload: Record<string, unknown>): boolean {
  return text(payload['kind']) === 'reorder';
}

/** 这条是不是客服工单（复购提醒不算工单，指标不混在一起）。 */
function isTicket(board: SuiteBoardRecord): boolean {
  return !isReminder(board.payload ?? {});
}

/**
 * 领域 meta：来源渠道 / 关联商品 / 问题类型 / 处理人。
 *
 * 四个字段是电商条目的固定口径，缺失时给「—」而不是悄悄少一行；
 * 复购提醒另外补客户与提醒时间两项，方便一眼看出它是提醒不是工单。
 */
function ecommerceMeta(payload: Record<string, unknown>): SuiteMetaEntry[] {
  const meta: SuiteMetaEntry[] = [
    { label: '来源渠道', value: text(payload['channel']) || '—' },
    { label: '关联商品', value: text(payload['sku']) || '—' },
    { label: '问题类型', value: text(payload['issueType']) || '—' },
    { label: '处理人', value: text(payload['owner']) || '未分派' },
  ];
  if (isReminder(payload)) {
    meta.push({ label: '客户', value: text(payload['customer']) || '—' });
    meta.push({ label: '提醒时间', value: text(payload['remindAt']) || '—' });
  }
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
    meta: ecommerceMeta(payload),
    payload,
    updatedAt: board.updatedAt,
  });
}

/** 当前用户在电商领域的全部条目。 */
async function listBoards(ctx: SuiteDomainReadContext): Promise<SuiteBoardRecord[]> {
  return ctx.store.suite.boards.listByUser(ctx.userId as string, { domainId: DOMAIN_ID });
}

/** 取当前用户的条目；不存在或不属于当前用户时返回 null。 */
async function findBoard(ctx: SuiteDomainActionContext): Promise<SuiteBoardRecord | null> {
  const entryId = ctx.input.entryId?.trim() ?? '';
  if (!entryId) return null;
  const found = await ctx.store.suite.boards.find(entryId);
  if (!found || found.userId !== ctx.userId) return null;
  return found;
}

/** 优先级入参：合法返回取值，非法返回 null（由调用方给用户看的话）。 */
function normalizePriority(value: unknown): (typeof PRIORITIES)[number] | null {
  const raw = text(value);
  if (!raw) return 'normal';
  const hit = PRIORITIES.find((p) => p === raw);
  return hit ?? null;
}

/** 毫秒 → 口语化时长（分钟 / 小时 / 天）。 */
function formatDuration(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))} 分钟`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} 小时`;
  return `${(hours / 24).toFixed(1)} 天`;
}

/* ---------- 领域动作 ---------- */

/**
 * ticket：登记客服工单（走基线 create）。
 *
 * 入参：payload.title（标题）、payload.channel（来源渠道）、payload.sku（关联商品，可空）、
 * payload.issueType（售前 / 售后 / 物流 / 其他）、payload.priority（low / normal / high / urgent），
 * 可选 payload.amountFen（涉及金额，整数分）。
 *
 * 幂等口径沿用基线：同领域内标题重复且仍未结案时，返回已有工单且 changed=false。
 * 优先级在基线 create 之后补写（基线固定写 normal），不额外建单。
 */
async function ticketAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const input = ctx.input.payload ?? {};
  const title = text(input['title']) || text(ctx.input.note);
  if (!title) return fail('请先写一句工单标题');

  const channel = text(input['channel']);
  if (!channel) return fail('请写明来源渠道，例如商城、直播间或电话');

  const issueType = text(input['issueType']);
  if (!(ISSUE_TYPES as readonly string[]).includes(issueType)) {
    return fail('问题类型只能是：售前 / 售后 / 物流 / 其他');
  }

  const priority = normalizePriority(input['priority']);
  if (priority === null) return fail('优先级只能是：low / normal / high / urgent');

  const sku = text(input['sku']);

  let amountFen = 0;
  const rawAmount = input['amountFen'];
  if (rawAmount !== undefined && rawAmount !== null && rawAmount !== '') {
    const parsed = num(rawAmount);
    if (parsed === null || !Number.isInteger(parsed) || parsed < 0) {
      return fail('涉及金额需要是非负整数分');
    }
    amountFen = parsed;
  }

  // 走基线 create：标题去重、台账事件与初始阶段都由基线负责。
  const created = await base.act({
    ...ctx,
    input: {
      ...ctx.input,
      action: 'create',
      note: title,
      payload: {
        ...input,
        kind: 'ticket',
        title,
        channel,
        sku,
        issueType,
        priority,
        ...(amountFen > 0 ? { amountFen } : {}),
      },
    },
  });
  if (!created.item) return created;

  // 基线 create 把优先级固定写成 normal，这里按入参补写一次（只在新建时写）。
  let board = await ctx.store.suite.boards.find(created.item.id);
  if (created.changed && board && board.priority !== priority) {
    const updated = await ctx.store.suite.boards.update(board.id, { priority });
    if (updated) board = updated;
  }

  const item = board ? toItem(board) : { ...created.item, meta: ecommerceMeta(created.item.payload) };
  return {
    ok: true,
    changed: created.changed,
    message: created.changed ? `已登记客服工单：${title}` : created.message,
    item,
    data: { channel, sku, issueType, priority, amountFen },
  };
}

/**
 * assign：分派处理人。
 *
 * 入参 payload.owner（处理人）。未指定直接拒绝；同一个负责人重复分派视为没有新动作。
 * 分派只落 owner 与 assignedAt，不改工单阶段（阶段由 advance / resolve 推进）。
 */
async function assignAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('工单不存在或不属于你');

  const owner = text(ctx.input.payload?.['owner']) || text(ctx.input.note);
  if (!owner) return fail('分派前要先写明处理人');

  const currentOwner = text(board.payload['owner']);
  if (currentOwner === owner) {
    return {
      ok: true,
      changed: false,
      message: `这条工单已经分派给 ${owner} 了`,
      item: toItem(board),
      data: { owner },
    };
  }

  const at = new Date().toISOString();
  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: { ...board.payload, owner, assignedAt: at },
  });
  if (!updated) return fail('分派失败，请稍后再试');

  return {
    ok: true,
    changed: true,
    message: currentOwner ? `已改派给 ${owner}` : `已分派给 ${owner}`,
    item: toItem(updated),
    data: { owner, previousOwner: currentOwner, assignedAt: at },
  };
}

/**
 * respond：追加一条回复。
 *
 * 入参 payload.content（回复内容）。回复带时间戳写进 payload.replies，
 * 并同步更新 payload.replyCount；内容与上一条完全相同时视为没有新信息。
 */
async function respondAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('工单不存在或不属于你');

  const content =
    text(ctx.input.payload?.['content']) ||
    text(ctx.input.payload?.['reply']) ||
    text(ctx.input.note);
  if (!content) return fail('写一句回复内容再提交');

  const replies = repliesOf(board.payload);
  const last = replies[replies.length - 1];
  if (last && last.content === content) {
    return {
      ok: true,
      changed: false,
      message: `上一条回复内容相同，没有重复记录（共 ${replies.length} 条回复）`,
      item: toItem(board),
      data: { replyCount: replies.length },
    };
  }

  const at = new Date().toISOString();
  const next = [...replies, { at, content }];
  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: { ...board.payload, replies: next, replyCount: next.length },
  });
  if (!updated) return fail('回复没保存成功，请稍后再试');

  return {
    ok: true,
    changed: true,
    message: `已记录第 ${next.length} 条回复`,
    item: toItem(updated),
    data: { replyCount: next.length, at },
  };
}

/**
 * rate：登记服务评分。
 *
 * 入参 payload.score（1–5 的整数）。越界直接拒绝；同一条工单重复评分不覆盖先前的分数。
 */
async function rateAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('工单不存在或不属于你');

  const score = num(ctx.input.payload?.['score']);
  if (score === null || !Number.isInteger(score) || score < 1 || score > 5) {
    return fail('服务评分需要是 1 到 5 之间的整数');
  }

  const previous = num(board.payload['serviceScore']);
  if (previous !== null) {
    return {
      ok: true,
      changed: false,
      message: `这条工单已经评过分（${previous} 分），不重复登记`,
      item: toItem(board),
      data: { score: previous },
    };
  }

  const at = new Date().toISOString();
  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: { ...board.payload, serviceScore: score, ratedAt: at },
  });
  if (!updated) return fail('评分没保存成功，请稍后再试');

  return {
    ok: true,
    changed: true,
    message: `已登记服务评分 ${score} 分`,
    item: toItem(updated),
    data: { score },
  };
}

/**
 * resolve：结案。
 *
 * 入参 payload.resolution（处理结果，必填）。待处理 / 处理中 → 已解决；
 * 已解决的工单再提交只回报当前状态，不产生第二次结案。
 */
async function resolveAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('工单不存在或不属于你');

  if (board.stage === 'resolved') {
    return {
      ok: true,
      changed: false,
      message: '这条工单已经结案了',
      item: toItem(board),
      data: { resolution: text(board.payload['resolution']) },
    };
  }

  const resolution = text(ctx.input.payload?.['resolution']) || text(ctx.input.note);
  if (!resolution) return fail('结案要写明处理结果，例如已换货并退回运费');
  if (board.stage !== 'pending' && board.stage !== 'handling') {
    return fail(`「${labelOf(board.stage)}」的工单不能结案`);
  }

  const at = new Date().toISOString();
  const updated = await ctx.store.suite.boards.update(board.id, {
    stage: 'resolved',
    payload: { ...board.payload, resolution, resolvedAt: at },
  });
  if (!updated) return fail('结案失败，请稍后再试');

  // 进度：结案即完成。
  const userId = ctx.userId as string;
  const current = now();
  const existing = await ctx.store.suite.progress.find(userId, DOMAIN_ID, board.id);
  await ctx.store.suite.progress.upsert({
    id: existing?.id ?? ctx.ids.next().id,
    userId,
    domainId: DOMAIN_ID,
    entryId: board.id,
    status: 'done',
    value: 100,
    notes: resolution,
    dueAt: existing?.dueAt ?? null,
    completedAt: existing?.completedAt ?? current,
    createdAt: existing?.createdAt ?? current,
    updatedAt: current,
  });

  return {
    ok: true,
    changed: true,
    message: `已结案：${resolution}`,
    item: toItem(updated),
    data: { resolution, resolvedAt: at },
  };
}

/**
 * reorder：登记复购提醒。
 *
 * 入参 payload.customer（客户）、payload.sku（关联商品）、payload.remindAt（提醒时间）。
 * 同客户 + 同商品 + 同提醒时间视为同一条提醒，重复登记不新建。
 */
async function reorderAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const input = ctx.input.payload ?? {};
  const customer = text(input['customer']);
  if (!customer) return fail('复购提醒要写明客户');

  const sku = text(input['sku']);
  if (!sku) return fail('复购提醒要写明关联商品');

  const remindAt = text(input['remindAt']);
  if (!remindAt) return fail('复购提醒要写明提醒时间');
  const remindDate = new Date(remindAt);
  if (Number.isNaN(remindDate.getTime())) {
    return fail('提醒时间需要是一个能识别的日期，例如 2026-12-01');
  }

  // 幂等：客户 + 商品 + 提醒时间三者一致即视为同一条提醒。
  const boards = await listBoards(ctx);
  const duplicated = boards.find(
    (board) =>
      isReminder(board.payload) &&
      text(board.payload['customer']) === customer &&
      text(board.payload['sku']) === sku &&
      text(board.payload['remindAt']) === remindAt,
  );
  if (duplicated) {
    return {
      ok: true,
      changed: false,
      message: `${customer} 的 ${sku} 复购提醒已经登记过了（${remindAt}）`,
      item: toItem(duplicated),
      data: { customer, sku, remindAt },
    };
  }

  const userId = ctx.userId as string;
  const current = now();
  const title = `复购提醒 · ${customer} · ${sku}`;
  const board = await ctx.store.suite.boards.insert({
    id: ctx.ids.next().id,
    domainId: DOMAIN_ID,
    userId,
    title,
    stage: 'pending',
    priority: 'normal',
    amountFen: 0,
    payload: { kind: 'reorder', customer, sku, remindAt },
    dueAt: remindDate,
    createdAt: current,
    updatedAt: current,
  });
  await ctx.store.suite.events.insert({
    id: ctx.ids.next().id,
    domainId: DOMAIN_ID,
    userId,
    kind: REORDER_EVENT_KIND,
    subject: title,
    amountFen: 0,
    status: 'pending',
    outTradeNo: null,
    payload: { customer, sku, remindAt, boardId: board.id },
    createdAt: current,
    updatedAt: current,
  });

  return {
    ok: true,
    changed: true,
    message: `已登记 ${customer} 的 ${sku} 复购提醒（${remindAt}）`,
    item: toItem(board),
    data: { customer, sku, remindAt },
  };
}

/**
 * advance：阶段推进。
 *
 * 待处理 → 处理中走基线；处理中 → 已解决时要求写明处理结果，
 * 与 resolve 同一口径（不写结果就结不了案）。
 */
async function advanceAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return base.act(ctx);
  const target = TRANSITIONS[board.stage]?.[0] ?? '';
  if (target === 'resolved') {
    const resolution = text(ctx.input.payload?.['resolution']) || text(ctx.input.note);
    if (!resolution) return fail('推进到「已解决」前要先写明处理结果');
    return resolveAction(ctx);
  }
  return base.act(ctx);
}

/** 当前时刻（单独一个函数，便于统一口径）。 */
function now(): Date {
  return new Date();
}

/* ---------- 对外导出 ---------- */

export const ecommerceModule: SuiteDomainModule = {
  id: 'ecommerce',

  /**
   * 读：工单 + 复购提醒条目，meta 补齐来源渠道 / 关联商品 / 问题类型 / 处理人。
   * 排序口径：先按优先级（urgent → high → normal → low），同一优先级内按更新时间倒序。
   */
  async list(ctx: SuiteDomainReadContext): Promise<SuiteDomainItemDto[]> {
    const boards = await listBoards(ctx);
    return boards
      .map((board) => toItem(board))
      .sort((a, b) => {
        const rankA = PRIORITY_ORDER[a.priority] ?? 99;
        const rankB = PRIORITY_ORDER[b.priority] ?? 99;
        if (rankA !== rankB) return rankA - rankB;
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      });
  },

  /** 写：领域动作优先，未命中回落基线的 create / setStage / remove。 */
  async act(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
    switch (ctx.input.action) {
      case 'ticket':
        return ticketAction(ctx);
      case 'assign':
        return assignAction(ctx);
      case 'respond':
        return respondAction(ctx);
      case 'rate':
        return rateAction(ctx);
      case 'resolve':
        return resolveAction(ctx);
      case 'reorder':
        return reorderAction(ctx);
      case 'advance':
        return advanceAction(ctx);
      default: {
        const result = await base.act(ctx);
        if (!result.item) return result;
        return {
          ...result,
          item: { ...result.item, meta: ecommerceMeta(result.item.payload) },
        };
      }
    }
  },

  /**
   * 统计：待处理工单数、处理中、平均首次响应时长、平均服务评分。
   * 没有数据就不给数：一条工单都没有时返回空数组，
   * 没有评分记录就不给均分，没有近 7 天内的首次响应就不给时长。
   *
   * 口径说明：复购提醒不是客服工单，不计入工单数与响应时长，只单独给一条提醒数。
   */
  async stats(ctx: SuiteDomainReadContext): Promise<Array<{ label: string; value: string; hint?: string }>> {
    const boards = await listBoards(ctx);
    if (boards.length === 0) return [];

    const tickets = boards.filter((board) => isTicket(board));
    const reminders = boards.filter((board) => !isTicket(board));

    const metrics: Array<{ label: string; value: string; hint?: string }> = [
      {
        label: '待处理工单',
        value: `${tickets.filter((b) => b.stage === 'pending').length} 条`,
        hint: '还没人处理的工单',
      },
      {
        label: '处理中',
        value: `${tickets.filter((b) => b.stage === 'handling').length} 条`,
        hint: '已分派、正在跟进的工单',
      },
    ];

    if (reminders.length > 0) {
      metrics.push({
        label: '复购提醒',
        value: `${reminders.length} 条`,
        hint: '已登记、到点需要触达的复购提醒',
      });
    }

    // 平均首次响应时长：创建时间到最早一次回复的间隔；
    // 没有回复记录时用「最后更新时间 − 创建时间」近似。只统计近 7 天内首次响应的工单。
    const current = Date.now();
    const firstResponseMs: number[] = [];
    for (const board of tickets) {
      const created = board.createdAt.getTime();
      const replyGaps = repliesOf(board.payload)
        .map((reply) => Date.parse(reply.at) - created)
        .filter((ms) => Number.isFinite(ms) && ms >= 0);
      const updatedGap = board.updatedAt.getTime() - created;
      const candidates = [...replyGaps, updatedGap].filter((ms) => Number.isFinite(ms) && ms >= 0);
      if (candidates.length === 0) continue;
      const first = Math.min(...candidates);
      if (current - (created + first) > WEEK_MS) continue;
      firstResponseMs.push(first);
    }
    if (firstResponseMs.length > 0) {
      const average =
        firstResponseMs.reduce((sum, ms) => sum + ms, 0) / firstResponseMs.length;
      metrics.push({
        label: '平均首次响应时长',
        value: formatDuration(average),
        hint: `近 7 天内 ${firstResponseMs.length} 张工单的首次响应均值`,
      });
    }

    // 平均服务评分：只对已登记评分的工单求均值。
    const scores = tickets
      .map((board) => num(board.payload['serviceScore']))
      .filter((score): score is number => score !== null);
    if (scores.length > 0) {
      const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
      metrics.push({
        label: '平均服务评分',
        value: `${average.toFixed(1)} 分`,
        hint: `${scores.length} 张已评分工单的均值`,
      });
    }

    return metrics;
  },
};
