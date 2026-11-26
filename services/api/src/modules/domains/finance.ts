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
 * 金融领域模块（预算、记账、资产负债与结清对账）。
 *
 * 基线是「条目 + 阶段状态机」：计划中 → 已审批 → 执行中 → 已结清。
 * 金融的专属语义在下面四处扩展：
 * - list：补齐资金账户 / 收支分类 / 收支方向，并按「阶段优先级 + 更新时间」排序；
 * - act：split_tax（价税分离）、budget_check（校验预算）、settle（结清）、
 *   record（记一笔）四个领域动作，未命中时回落到基线的 create / advance / setStage / remove；
 * - stats：在账金额合计、已结清金额、待结清笔数、预算使用率。
 *
 * 三条硬规矩（与 docs/49 §4.4 一致）：
 * - 幂等：同一 action + 同一份入参重复提交，第二次必须 changed=false；
 * - 不抛异常：业务上不成立时返回 { ok:false, changed:false, message, item:null }；
 * - 金额一律用整数分，展示给用户的文案自己换算成元。
 *
 * 口径说明（两条容易被误读，先写在这里）：
 * - 「在账金额合计」与「预算使用率」都按**全部条目**的 amountFen 合计，不区分收支方向；
 *   这与「一条流水就是一笔账目」的记账口径一致，方向只用于分类展示。
 * - 「汇总预算」= 各条目登记的预算额度（payload.budgetFen）之和，
 *   因此校验预算本身是纯计算动作，不写台账、不改变任何状态。
 */
const DOMAIN_ID = 'finance' as SuiteDomainId;

/** 阶段中文名。与基线 stages 的 label 保持一致。 */
const STAGE_LABEL: Record<string, string> = {
  planned: '计划中',
  approved: '已审批',
  executing: '执行中',
  settled: '已结清',
};

/** 阶段排序权重：越靠前越先显示，已结清沉底。 */
const STAGE_ORDER: Record<string, number> = {
  planned: 0,
  approved: 1,
  executing: 2,
  settled: 3,
};

/** 收支方向中文名。 */
const DIRECTION_LABEL: Record<string, string> = {
  in: '收入',
  out: '支出',
};

/**
 * 允许的阶段迁移。
 *
 * 基线口径是 planned → approved → executing → settled 逐级推进；
 * 这里额外允许从「计划中 / 已审批」直接结清 —— 结清是一个明确的核对结论，
 * 不必先把每条记录都走完审批流。所有迁移边都在这里声明，不做隐式跳转。
 */
const TRANSITIONS: Record<string, readonly string[]> = {
  planned: ['approved', 'settled'],
  approved: ['executing', 'planned', 'settled'],
  executing: ['settled', 'approved'],
  settled: [],
};

/** 台账事件类型：普通记账条目（沿用基线）。 */
const ITEM_EVENT_KIND = 'finance-item';
/** 台账事件类型：结清留痕。 */
const SETTLEMENT_EVENT_KIND = 'settlement';

const base = createBoardDomain({
  id: DOMAIN_ID,
  stages: [
    { key: 'planned', label: '计划中' },
    { key: 'approved', label: '已审批' },
    { key: 'executing', label: '执行中' },
    { key: 'settled', label: '已结清' },
  ],
  transitions: TRANSITIONS,
  initialStage: 'planned',
  eventKind: ITEM_EVENT_KIND,
  describe: (board) => ({
    summary: text(board.payload['summary']) || board.title,
    meta: financeMeta(board.payload ?? {}),
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

/** 领域 meta：资金账户 / 收支分类 / 收支方向。 */
function financeMeta(payload: Record<string, unknown>): SuiteMetaEntry[] {
  return [
    { label: '资金账户', value: text(payload['account']) },
    { label: '收支分类', value: text(payload['category']) },
    { label: '方向', value: DIRECTION_LABEL[text(payload['direction'])] ?? '' },
  ].filter((m) => m.value !== '');
}

/** 阶段中文名。 */
function labelOf(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
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
    meta: financeMeta(payload),
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

/** 当前用户在金融领域的全部条目。 */
async function listBoards(ctx: SuiteDomainReadContext): Promise<SuiteBoardRecord[]> {
  return ctx.store.suite.boards.listByUser(ctx.userId as string, { domainId: DOMAIN_ID });
}

/** 金额求和；非有限数按 0 计。 */
function sumAmount(boards: SuiteBoardRecord[]): number {
  return boards.reduce((sum, board) => sum + (Number.isFinite(board.amountFen) ? board.amountFen : 0), 0);
}

/* ---------- 领域动作 ---------- */

/**
 * split_tax：价税分离。
 *
 * 入参 payload.amount 是含税金额（分），payload.rate 是税率小数（0.13 表示 13%）。
 * 不含税金额 = 含税金额 ÷ (1 + 税率)，税额 = 含税金额 − 不含税金额，
 * 两个数都是整数分（按四舍五入取整，合计仍然等于含税金额）。
 * 拆分结果写进条目 payload.taxSplit，方便事后复查。
 */
async function splitTax(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const amount = num(ctx.input.payload?.['amount']);
  if (amount === null || !Number.isInteger(amount) || amount <= 0) {
    return fail('含税金额需要是大于 0 的整数分');
  }
  const rate = num(ctx.input.payload?.['rate']);
  if (rate === null || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    return fail('税率需要是 0 到 1 之间的小数，例如 0.13');
  }
  // 税率先折成万分位整数再参与运算，避免 0.13 这类小数在浮点里带尾巴。
  const rateBp = Math.round(rate * 10000);

  const netFen = Math.round((amount * 10000) / (10000 + rateBp));
  const taxFen = amount - netFen;
  const payload = board.payload ?? {};
  const prev = payload['taxSplit'];
  const unchanged =
    numOf(prev, 'amountFen') === amount &&
    numOf(prev, 'rate') === rate &&
    numOf(prev, 'netFen') === netFen &&
    numOf(prev, 'taxFen') === taxFen;
  if (unchanged) {
    return {
      ok: true,
      changed: false,
      message: `价税已分离：不含税 ${yuan(netFen)} 元，税额 ${yuan(taxFen)} 元`,
      item: toItem(board),
      data: { netFen, taxFen, rate },
    };
  }

  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: { ...payload, taxSplit: { amountFen: amount, rate, netFen, taxFen } },
  });
  if (!updated) return fail('价税分离失败，请稍后再试');
  return {
    ok: true,
    changed: true,
    message: `价税分离完成：不含税 ${yuan(netFen)} 元，税额 ${yuan(taxFen)} 元`,
    item: toItem(updated),
    data: { netFen, taxFen, rate },
  };
}

/**
 * budget_check：校验预算。
 *
 * 纯计算动作：把本领域所有条目的 amountFen 合计成已用金额，
 * 与 payload.budgetFen（预算总额，分）比较。
 * 超预算时明确写出超出多少，没超时给出剩余额度；两种情况都不写台账。
 */
async function budgetCheck(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const budgetFen = num(ctx.input.payload?.['budgetFen']);
  if (budgetFen === null || !Number.isInteger(budgetFen) || budgetFen <= 0) {
    return fail('预算总额需要是大于 0 的整数分');
  }
  const boards = await listBoards(ctx);
  const usedFen = sumAmount(boards);
  const remainingFen = budgetFen - usedFen;
  const over = remainingFen < 0;
  const usageRate = usedFen / budgetFen;
  const message = over
    ? `已超预算 ${yuan(-remainingFen)} 元（预算 ${yuan(budgetFen)} 元，在账 ${yuan(usedFen)} 元）`
    : `预算内，剩余额度 ${yuan(remainingFen)} 元（预算 ${yuan(budgetFen)} 元，在账 ${yuan(usedFen)} 元）`;
  return {
    ok: true,
    changed: false,
    message,
    item: null,
    data: {
      budgetFen,
      usedFen,
      remainingFen,
      usageRate,
      usagePercent: Math.round(usageRate * 100),
      over,
    },
  };
}

/**
 * settle：结清。
 *
 * 结清是一次核对结论：条目推进到已结清、进度记为完成（value=100）、
 * 并落一条 kind='settlement' 的台账事件备查。
 * 已经结清的条目再点一次只回报当前状态，不重复记账。
 */
async function settle(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');
  if (board.amountFen <= 0) {
    return fail('结清前需要先记一笔金额');
  }
  if (board.stage === 'settled') {
    return {
      ok: true,
      changed: false,
      message: `该条目已结清 ${yuan(board.amountFen)} 元`,
      item: toItem(board),
      data: { amountFen: board.amountFen },
    };
  }
  if (!canTransit(TRANSITIONS, board.stage, 'settled')) {
    return fail(`「${labelOf(board.stage)}」的条目不能直接结清`);
  }

  const userId = ctx.userId as string;
  const now = new Date();
  const updated = await ctx.store.suite.boards.update(board.id, { stage: 'settled' });
  if (!updated) return fail('结清失败，请稍后再试');

  // 进度：结清即完成。
  const existing = await ctx.store.suite.progress.find(userId, DOMAIN_ID, board.id);
  await ctx.store.suite.progress.upsert({
    id: existing?.id ?? ctx.ids.next().id,
    userId,
    domainId: DOMAIN_ID,
    entryId: board.id,
    status: 'done',
    value: 100,
    notes: `结清 ${yuan(board.amountFen)} 元`,
    dueAt: existing?.dueAt ?? null,
    completedAt: existing?.completedAt ?? now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  // 台账事件：结清留痕，供对账与复盘回看。
  await ctx.store.suite.events.insert({
    id: ctx.ids.next().id,
    domainId: DOMAIN_ID,
    userId,
    kind: SETTLEMENT_EVENT_KIND,
    subject: board.title,
    amountFen: board.amountFen,
    status: 'done',
    outTradeNo: null,
    payload: {
      boardId: board.id,
      stage: 'settled',
      direction: text(board.payload?.['direction']),
      category: text(board.payload?.['category']),
      account: text(board.payload?.['account']),
      settledAt: now.toISOString(),
    },
    createdAt: now,
    updatedAt: now,
  });

  return {
    ok: true,
    changed: true,
    message: `已结清 ${yuan(board.amountFen)} 元`,
    item: toItem(updated),
    data: { amountFen: board.amountFen, settledAt: now.toISOString() },
  };
}

/**
 * record：记一笔。
 *
 * 入参：payload.amountFen（正整数分）、payload.category（收支分类）、
 * payload.account（资金账户）、payload.direction（'in' 收入 / 'out' 支出），
 * 可选 payload.budgetFen（这条支出的预算额度，累加即汇总预算）。
 *
 * 给了 entryId 就把金额写回该条目，没给就新建一条记账条目；
 * 新建的条目落在「执行中」——钱已经发生，等着结清对账。
 * 幂等键 payload.idempotencyKey：同一个键重复提交只记一次。
 */
async function record(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const userId = ctx.userId as string;
  const input = ctx.input.payload ?? {};

  const rawAmount = input['amountFen'] !== undefined ? input['amountFen'] : ctx.input.amount;
  const amountFen = num(rawAmount);
  if (amountFen === null || !Number.isInteger(amountFen) || amountFen <= 0) {
    return fail('金额需要是大于 0 的整数分');
  }

  const direction = text(input['direction']);
  if (direction !== 'in' && direction !== 'out') {
    return fail('收支方向只能是 in（收入）或 out（支出）');
  }

  const category = text(input['category']);
  const account = text(input['account']);
  const budgetFen = num(input['budgetFen']);
  const idempotencyKey = text(input['idempotencyKey']);

  // 幂等：同一个幂等键只记一次。
  if (idempotencyKey) {
    const boards = await listBoards(ctx);
    const duplicated = boards.find(
      (board) => text(board.payload?.['recordKey']) === idempotencyKey,
    );
    if (duplicated) {
      return {
        ok: true,
        changed: false,
        message: `这笔已经记过了（${yuan(duplicated.amountFen)} 元）`,
        item: toItem(duplicated),
        data: { amountFen: duplicated.amountFen, direction: text(duplicated.payload?.['direction']) },
      };
    }
  }

  const entryId = ctx.input.entryId?.trim() ?? '';
  if (entryId) {
    const board = await findBoard(ctx);
    if (!board) return fail('条目不存在或不属于你');
    const payload = board.payload ?? {};
    const unchanged =
      board.amountFen === amountFen &&
      text(payload['category']) === category &&
      text(payload['account']) === account &&
      text(payload['direction']) === direction &&
      (budgetFen === null || numOf(payload, 'budgetFen') === budgetFen);
    if (unchanged) {
      return {
        ok: true,
        changed: false,
        message: `金额与分类未变化（${yuan(amountFen)} 元）`,
        item: toItem(board),
        data: { amountFen, direction },
      };
    }
    const updated = await ctx.store.suite.boards.update(board.id, {
      amountFen,
      payload: {
        ...payload,
        category,
        account,
        direction,
        ...(budgetFen !== null ? { budgetFen } : {}),
        ...(idempotencyKey ? { recordKey: idempotencyKey } : {}),
      },
    });
    if (!updated) return fail('记账失败，请稍后再试');
    return {
      ok: true,
      changed: true,
      message: `已记一笔 ${yuan(amountFen)} 元（${DIRECTION_LABEL[direction]}）`,
      item: toItem(updated),
      data: { amountFen, direction },
    };
  }

  const now = new Date();
  const title =
    text(input['title']) ||
    text(ctx.input.note) ||
    `${DIRECTION_LABEL[direction]}·${category || '未分类'}`;
  const board = await ctx.store.suite.boards.insert({
    id: ctx.ids.next().id,
    domainId: DOMAIN_ID,
    userId,
    title,
    stage: 'executing',
    priority: 'normal',
    amountFen,
    payload: {
      category,
      account,
      direction,
      ...(budgetFen !== null ? { budgetFen } : {}),
      ...(idempotencyKey ? { recordKey: idempotencyKey } : {}),
    },
    dueAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.store.suite.events.insert({
    id: ctx.ids.next().id,
    domainId: DOMAIN_ID,
    userId,
    kind: ITEM_EVENT_KIND,
    subject: title,
    amountFen,
    status: 'pending',
    outTradeNo: null,
    payload: {
      boardId: board.id,
      stage: board.stage,
      direction,
      category,
      account,
    },
    createdAt: now,
    updatedAt: now,
  });
  return {
    ok: true,
    changed: true,
    message: `已记一笔 ${yuan(amountFen)} 元（${DIRECTION_LABEL[direction]}）`,
    item: toItem(board),
    data: { amountFen, direction },
  };
}

/**
 * advance 的领域化：从「执行中」推进到「已结清」时走结清流程，
 * 让进度与结清事件一起落地；其余阶段仍由基线推进。
 */
async function advance(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return base.act(ctx);
  const target = TRANSITIONS[board.stage]?.[0] ?? '';
  if (target === 'settled' && board.amountFen > 0) return settle(ctx);
  return base.act(ctx);
}

/* ---------- 对外导出 ---------- */

export const financeModule: SuiteDomainModule = {
  id: 'finance',

  /**
   * 读：基线条目 + 领域 meta（资金账户 / 收支分类 / 方向）。
   * 排序口径：先按阶段优先级（计划中 → 已审批 → 执行中 → 已结清），
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
      case 'split_tax':
        return splitTax(ctx);
      case 'budget_check':
        return budgetCheck(ctx);
      case 'settle':
        return settle(ctx);
      case 'record':
        return record(ctx);
      case 'advance':
        return advance(ctx);
      default:
        return base.act(ctx);
    }
  },

  /**
   * 统计：在账金额合计、已结清金额、待结清笔数、预算使用率。
   * 汇总预算取各条目登记的预算额度之和，没有汇总预算就不给使用率；
   * 没有数据时不给假数（对应指标直接不出现）。
   */
  async stats(ctx: SuiteDomainReadContext): Promise<Array<{ label: string; value: string; hint?: string }>> {
    const boards = await listBoards(ctx);
    const metrics: Array<{ label: string; value: string; hint?: string }> = [];

    const totalFen = sumAmount(boards);
    const settledBoards = boards.filter((board) => board.stage === 'settled');
    const settledFen = sumAmount(settledBoards);
    const pendingCount = boards.length - settledBoards.length;
    const budgetFen = boards.reduce(
      (sum, board) => sum + (numOf(board.payload, 'budgetFen') ?? 0),
      0,
    );

    if (boards.length > 0) {
      metrics.push({
        label: '在账金额合计',
        value: `${yuan(totalFen)} 元`,
        hint: '全部条目金额合计',
      });
    }
    if (settledBoards.length > 0) {
      metrics.push({
        label: '已结清金额',
        value: `${yuan(settledFen)} 元`,
        hint: `已结清 ${settledBoards.length} 笔`,
      });
    }
    if (pendingCount > 0) {
      metrics.push({
        label: '待结清笔数',
        value: `${pendingCount} 笔`,
        hint: '尚未进入已结清的条目数',
      });
    }
    if (budgetFen > 0) {
      metrics.push({
        label: '预算使用率',
        value: `${Math.round((totalFen / budgetFen) * 100)}%`,
        hint: `在账 ${yuan(totalFen)} 元 / 汇总预算 ${yuan(budgetFen)} 元`,
      });
    }

    return metrics;
  },
};
