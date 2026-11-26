import type { SuiteActionResultDto, SuiteDomainId, SuiteDomainItemDto } from '@mixmapp/contracts';
import type { SuiteBoardRecord } from '../../db/types.js';
import {
  createBoardDomain,
  toDomainItem,
  type SuiteDomainActionContext,
  type SuiteDomainModule,
  type SuiteDomainReadContext,
} from '../suite/domain.js';

/**
 * 产品研发领域模块（需求池、缺陷流转与迭代燃尽）。
 *
 * 基线用看板 + 阶段状态机实现（idea 需求池 → planned 已排期 → doing 开发中
 * → review 待验收 → done 已发布），产品研发的专属语义在下面四处扩展：
 * - list：补齐负责人 / 所属迭代 / 严重级别，并按「严重级别 → 更新时间」排序；
 * - act：estimate（估点）、burndown（燃尽）、triage（排期 / 退回）、
 *   review（评审通过 / 打回）、defect（缺陷登记）五个领域动作，
 *   未命中时回落到基线的 create / advance / setStage / remove；
 * - stats：需求池、本迭代已交付、开发中、缺陷未闭环四项领域指标。
 *
 * 两条硬规矩（与 docs/49 §4.4 一致）：
 * - 幂等：同一 action + 同一份入参重复提交，第二次必须 changed=false；
 * - 不抛异常：业务上不成立时返回 { ok:false, changed:false, message, item:null }。
 */
const DOMAIN_ID = 'product' as SuiteDomainId;

/** 阶段中文名。与基线 stages 的 label 保持一致，领域内多处复用。 */
const STAGE_LABEL: Record<string, string> = {
  idea: '需求池',
  planned: '已排期',
  doing: '开发中',
  review: '待验收',
  done: '已发布',
};

/** 缺陷严重级别：P0 最急，P3 最轻。用于排序与发布评审底线。 */
const SEVERITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** 没有严重级别的普通需求排在所有缺陷之后。 */
const NO_SEVERITY_RANK = 4;

const base = createBoardDomain({
  id: DOMAIN_ID,
  stages: [
    { key: 'idea', label: '需求池' },
    { key: 'planned', label: '已排期' },
    { key: 'doing', label: '开发中' },
    { key: 'review', label: '待验收' },
    { key: 'done', label: '已发布' },
  ],
  transitions: {
    idea: ['planned'],
    planned: ['doing', 'idea'],
    doing: ['review', 'planned'],
    review: ['done', 'doing'],
    done: [],
  },
  initialStage: 'idea',
  eventKind: 'product-item',
  describe: (board) => ({
    summary: board.payload['summary'] ? String(board.payload['summary']) : board.title,
    meta: [
      {
        label: '负责人',
        value: typeof board.payload['owner'] === 'string' ? String(board.payload['owner']) : '',
      },
      {
        label: '所属迭代',
        value: typeof board.payload['sprint'] === 'string' ? String(board.payload['sprint']) : '',
      },
    ].filter((m) => m.value !== ''),
  }),
});

/* ---------- 通用小工具 ---------- */

/** 取字符串（去空白）；null / undefined 一律当空串。 */
function str(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value.trim() : String(value).trim();
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

/** 业务不成立时的统一返回：不抛异常，只给用户看的话。 */
function fail(message: string): SuiteActionResultDto {
  return { ok: false, changed: false, message, item: null };
}

/** 阶段中文名。 */
function labelOf(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
}

/** 条目严重级别（无则空串）。 */
function severityOf(payload: Record<string, unknown> | undefined): string {
  return str(payload?.['severity']).toUpperCase();
}

/** 严重级别排序权重：无级别的条目排在最后。 */
function severityRank(payload: Record<string, unknown> | undefined): number {
  const severity = severityOf(payload);
  if (!severity) return NO_SEVERITY_RANK;
  return SEVERITY_ORDER[severity] ?? NO_SEVERITY_RANK;
}

/** 严重级别 → 看板优先级。 */
function priorityOf(severity: string): SuiteBoardRecord['priority'] {
  switch (severity) {
    case 'P0':
      return 'urgent';
    case 'P1':
      return 'high';
    case 'P3':
      return 'low';
    default:
      return 'normal';
  }
}

/** 看板条目 → 领域条目（meta 与摘要按产品研发口径补齐）。 */
function toItem(board: SuiteBoardRecord): SuiteDomainItemDto {
  const payload = board.payload ?? {};
  const meta: Array<{ label: string; value: string }> = [];
  const owner = str(payload['owner']);
  if (owner) meta.push({ label: '负责人', value: owner });
  const sprint = str(payload['sprint']);
  if (sprint) meta.push({ label: '所属迭代', value: sprint });
  const severity = severityOf(payload);
  if (severity) meta.push({ label: '严重级别', value: severity });
  return toDomainItem({
    id: board.id,
    title: board.title,
    summary: str(payload['summary']) || board.title,
    stage: board.stage,
    stageLabel: labelOf(board.stage),
    priority: board.priority,
    amountFen: board.amountFen,
    meta,
    payload,
    updatedAt: board.updatedAt,
  });
}

/** 取当前用户的条目；不属于本人一律当作不存在。 */
async function findBoard(ctx: SuiteDomainActionContext): Promise<SuiteBoardRecord | null> {
  const entryId = ctx.input.entryId ?? '';
  if (!entryId) return null;
  const found = await ctx.store.suite.boards.find(entryId);
  if (!found || found.userId !== ctx.userId) return null;
  return found;
}

/** 当前迭代：取「最近一次被更新的条目所属的迭代」。 */
function latestSprint(boards: SuiteBoardRecord[]): string {
  let sprint = '';
  let at = 0;
  for (const board of boards) {
    const value = str(board.payload?.['sprint']);
    if (!value) continue;
    const updated = board.updatedAt.getTime();
    if (!sprint || updated >= at) {
      sprint = value;
      at = updated;
    }
  }
  return sprint;
}

/* ---------- 领域动作 ---------- */

/**
 * estimate：给条目设定所属迭代与工作量点数。
 *
 * 点数必须是正整数；点数发生变化时，提示里给出「原点数 → 新点数」的对比，
 * 便于复盘时判断是估点偏乐观还是范围真的变大了。
 */
async function estimate(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');
  const payload = board.payload ?? {};
  const sprint = str(ctx.input.payload?.['sprint']);
  if (!sprint) return fail('请填写所属迭代，例如 S12');
  const points = num(ctx.input.payload?.['points']);
  if (points === null || !Number.isInteger(points) || points <= 0) {
    return fail('工作量点数需要是正整数');
  }
  const prevSprint = str(payload['sprint']);
  const prevPoints = num(payload['points']);
  if (prevSprint === sprint && prevPoints === points) {
    return {
      ok: true,
      changed: false,
      message: `点数与迭代未变化（${sprint} · ${points} 点）`,
      item: toItem(board),
    };
  }
  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: { ...payload, sprint, points },
  });
  if (!updated) return fail('估点失败，请稍后再试');
  const message =
    prevPoints === null
      ? `已估点 ${points} 点，挂到迭代 ${sprint}`
      : prevPoints === points
        ? `迭代改为 ${sprint}，点数保持 ${points} 点`
        : `点数 ${prevPoints} → ${points}（${points - prevPoints > 0 ? '+' : ''}${
            points - prevPoints
          }），迭代 ${sprint}`;
  return {
    ok: true,
    changed: true,
    message,
    item: toItem(updated),
    data: { sprint, points, previousSprint: prevSprint, previousPoints: prevPoints },
  };
}

/**
 * burndown：统计某个迭代（payload.sprint 相同）的阶段分布与剩余量。
 *
 * 阶段口径：idea / planned 是未开始，doing 是在做，review 是待验收，done 是已发布。
 * 剩余量 = 总数 − 已完成（未交付的活仍在迭代里，在做与待验收都算剩余）；
 * 未开始 / 在做 / 待验收的拆分一并给出，便于判断偏差来自插单还是估点偏乐观。
 *
 * 每次拿到新的阶段分布就落一条 suite_events（kind='burndown'），
 * 快照与上一条完全相同时不重复落库，保证重复提交幂等。
 */
async function burndown(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const userId = ctx.userId as string;
  const boards = await ctx.store.suite.boards.listByUser(userId, { domainId: DOMAIN_ID });
  const requested = str(ctx.input.payload?.['sprint']);
  const sprint = requested || latestSprint(boards);
  if (!sprint) return fail('还没有条目归属到迭代，先用「估点」把条目挂到某个迭代上');

  const scoped = boards.filter((board) => str(board.payload?.['sprint']) === sprint);
  const byStage: Record<string, number> = { idea: 0, planned: 0, doing: 0, review: 0, done: 0 };
  let totalPoints = 0;
  let donePoints = 0;
  for (const board of scoped) {
    byStage[board.stage] = (byStage[board.stage] ?? 0) + 1;
    const points = num(board.payload?.['points']) ?? 0;
    totalPoints += points;
    if (board.stage === 'done') donePoints += points;
  }
  const total = scoped.length;
  const done = byStage['done'] ?? 0;
  const remaining = total - done;
  const notStarted = (byStage['idea'] ?? 0) + (byStage['planned'] ?? 0);
  const inProgress = byStage['doing'] ?? 0;
  const pendingReview = byStage['review'] ?? 0;
  const snapshotKey = JSON.stringify({ total, done, byStage });

  const events = await ctx.store.suite.events.listByUser(userId, {
    domainId: DOMAIN_ID,
    kind: 'burndown',
    limit: 100,
  });
  const recorded = events.find((event) => str(event.payload?.['snapshotKey']) === snapshotKey);
  if (!recorded) {
    const now = new Date();
    await ctx.store.suite.events.insert({
      id: ctx.ids.next().id,
      domainId: DOMAIN_ID,
      userId,
      kind: 'burndown',
      subject: `迭代 ${sprint} 燃尽快照`,
      amountFen: 0,
      status: 'pending',
      outTradeNo: null,
      payload: { sprint, total, done, remaining, byStage, snapshotKey },
      createdAt: now,
      updatedAt: now,
    });
  }

  const message = `迭代 ${sprint}：共 ${total} 条，已完成 ${done} 条，剩余 ${remaining} 条（未开始 ${notStarted} · 在做 ${inProgress} · 待验收 ${pendingReview}）`;
  return {
    ok: true,
    changed: !recorded,
    message: recorded ? `${message}（与上一条快照一致，未重复记录）` : message,
    item: null,
    data: {
      sprint,
      total,
      done,
      remaining,
      byStage,
      notStarted,
      inProgress,
      pendingReview,
      totalPoints,
      donePoints,
      remainingPoints: totalPoints - donePoints,
    },
  };
}

/** triage 的两种走向：排期（进入迭代队列）或退回（留在需求池并写明原因）。 */
function triageDecision(ctx: SuiteDomainActionContext): 'schedule' | 'reject' {
  const raw = str(ctx.input.payload?.['decision']).toLowerCase();
  if (raw === 'reject' || raw === 'back' || raw === '退回') return 'reject';
  if (raw === 'schedule' || raw === 'plan' || raw === '排期') return 'schedule';
  // 没显式给结论时：写了退回原因就按退回处理，否则按排期处理。
  if (str(ctx.input.payload?.['reason'])) return 'reject';
  return 'schedule';
}

/**
 * triage：给需求池里的条目排期（idea → planned）或退回（留在 idea 并写明原因）。
 *
 * 排期会移动阶段，因此 changed=true；重复排期（仍在已排期）→ changed=false。
 * 退回不改阶段（条目仍留在需求池），因此按领域口径 changed=false；
 * 退回原因写进 payload.reason 留痕，重复提交同一原因不会重复写。
 */
async function triage(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');
  const payload = board.payload ?? {};

  if (triageDecision(ctx) === 'reject') {
    if (board.stage !== 'idea') {
      return fail(`只有需求池里的条目可以退回，当前处于「${labelOf(board.stage)}」`);
    }
    const reason = str(ctx.input.payload?.['reason']);
    if (!reason) return fail('退回需要写明原因');
    const prevReason = str(payload['reason']);
    if (prevReason === reason) {
      return {
        ok: true,
        changed: false,
        message: `该条目已在需求池（退回原因未变化：${reason}）`,
        item: toItem(board),
      };
    }
    const updated = await ctx.store.suite.boards.update(board.id, {
      payload: { ...payload, reason, rejectedAt: new Date().toISOString() },
    });
    if (!updated) return fail('退回失败，请稍后再试');
    // 退回不改阶段：条目仍留在需求池，所以按领域口径 changed=false；
    // 退回原因照常写进 payload.reason 留痕，重复提交同一原因不会重复写。
    return {
      ok: true,
      changed: false,
      message: `已退回需求池，原因：${reason}（阶段未变，仍在需求池）`,
      item: toItem(updated),
    };
  }

  const rawDue = str(ctx.input.payload?.['dueAt']) || ctx.input.at || '';
  let dueDate: Date | null = null;
  if (rawDue) {
    dueDate = new Date(rawDue);
    if (Number.isNaN(dueDate.getTime())) {
      return fail('交付日期无法识别，请用 YYYY-MM-DD 这类格式');
    }
  }

  if (board.stage === 'idea') {
    const updated = await ctx.store.suite.boards.update(board.id, {
      stage: 'planned',
      payload: rawDue ? { ...payload, dueAt: rawDue } : payload,
      ...(dueDate ? { dueAt: dueDate } : {}),
    });
    if (!updated) return fail('排期失败，请稍后再试');
    return {
      ok: true,
      changed: true,
      message: rawDue ? `已排期到「已排期」，交付日期 ${rawDue}` : '已排期到「已排期」',
      item: toItem(updated),
      data: { sprint: str(updated.payload?.['sprint']), dueAt: rawDue },
    };
  }

  if (board.stage === 'planned') {
    const prevDue = str(payload['dueAt']) || (board.dueAt ? board.dueAt.toISOString() : '');
    if (rawDue && !prevDue.startsWith(rawDue)) {
      const updated = await ctx.store.suite.boards.update(board.id, {
        payload: { ...payload, dueAt: rawDue },
        dueAt: dueDate,
      });
      if (!updated) return fail('更新交付日期失败，请稍后再试');
      return {
        ok: true,
        changed: true,
        message: `交付日期更新为 ${rawDue}`,
        item: toItem(updated),
      };
    }
    return { ok: true, changed: false, message: '该条目已在排期队列中', item: toItem(board) };
  }

  return fail(`只有需求池里的条目可以排期，当前处于「${labelOf(board.stage)}」`);
}

/**
 * review：发布评审。通过 → done（已发布）；打回 → doing（开发中），并记下评审意见。
 *
 * 幂等：已发布且结论为通过的条目再次评审通过 → changed=false；
 * 已打回且结论为打回的条目再次打回 → changed=false。
 */
async function review(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');
  const payload = board.payload ?? {};
  const raw = str(ctx.input.payload?.['decision']).toLowerCase();
  const pass = raw === 'pass' || raw === 'approve' || raw === '通过';
  const reject = raw === 'reject' || raw === 'back' || raw === '打回';
  if (!pass && !reject) return fail('请给出评审结论：通过或打回');
  const note = str(ctx.input.payload?.['reviewNote']);

  if (pass) {
    if (board.stage === 'done' && str(payload['reviewDecision']) === 'passed') {
      return { ok: true, changed: false, message: '该条目已评审通过并发布', item: toItem(board) };
    }
    if (board.stage !== 'review') {
      return fail(`只有待验收的条目可以评审，当前处于「${labelOf(board.stage)}」`);
    }
    const updated = await ctx.store.suite.boards.update(board.id, {
      stage: 'done',
      payload: { ...payload, reviewDecision: 'passed', ...(note ? { reviewNote: note } : {}) },
    });
    if (!updated) return fail('评审失败，请稍后再试');
    return {
      ok: true,
      changed: true,
      message: note ? `评审通过，已发布（${note}）` : '评审通过，已发布',
      item: toItem(updated),
    };
  }

  if (board.stage === 'doing' && str(payload['reviewDecision']) === 'rejected') {
    return { ok: true, changed: false, message: '该条目已打回开发中', item: toItem(board) };
  }
  if (board.stage !== 'review') {
    return fail(`只有待验收的条目可以打回，当前处于「${labelOf(board.stage)}」`);
  }
  const updated = await ctx.store.suite.boards.update(board.id, {
    stage: 'doing',
    payload: { ...payload, reviewDecision: 'rejected', ...(note ? { reviewNote: note } : {}) },
  });
  if (!updated) return fail('打回失败，请稍后再试');
  return {
    ok: true,
    changed: true,
    message: note ? `已打回开发中（${note}）` : '已打回开发中',
    item: toItem(updated),
  };
}

/**
 * defect：登记缺陷条目（payload.kind='defect'）。
 *
 * 缺陷默认落到「已排期」——位置不明的缺陷直接进开发容易浪费工时，
 * 等复现与定位清楚再推进到开发中。严重级别 payload.severity 取 P0–P3，
 * 决定看板优先级，也决定在列表里的排序位次。
 */
async function registerDefect(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const title = str(ctx.input.payload?.['title']) || str(ctx.input.note);
  if (!title) return fail('请填写缺陷标题');
  const severity = severityOf(ctx.input.payload) || 'P2';
  if (SEVERITY_ORDER[severity] === undefined) return fail('严重级别只支持 P0、P1、P2、P3');

  const userId = ctx.userId as string;
  const boards = await ctx.store.suite.boards.listByUser(userId, { domainId: DOMAIN_ID });
  const duplicated = boards.find(
    (board) =>
      board.title === title &&
      str(board.payload?.['kind']) === 'defect' &&
      board.stage !== 'done',
  );
  if (duplicated) {
    return {
      ok: true,
      changed: false,
      message: `这条缺陷已经在列表里（${severityOf(duplicated.payload)}）`,
      item: toItem(duplicated),
    };
  }

  const now = new Date();
  const payload: Record<string, unknown> = {
    ...(ctx.input.payload ?? {}),
    kind: 'defect',
    severity,
  };
  delete payload['title'];
  const board = await ctx.store.suite.boards.insert({
    id: ctx.ids.next().id,
    domainId: DOMAIN_ID,
    userId,
    title,
    stage: 'planned',
    priority: priorityOf(severity),
    amountFen: 0,
    payload,
    dueAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.store.suite.events.insert({
    id: ctx.ids.next().id,
    domainId: DOMAIN_ID,
    userId,
    kind: 'defect',
    subject: title,
    amountFen: 0,
    status: 'pending',
    outTradeNo: null,
    payload: { boardId: board.id, severity, sprint: str(ctx.input.payload?.['sprint']) },
    createdAt: now,
    updatedAt: now,
  });
  return {
    ok: true,
    changed: true,
    message: `缺陷已登记（${severity}），已进入待开发队列`,
    item: toItem(board),
    data: { severity, stage: board.stage },
  };
}

/* ---------- 领域模块 ---------- */

export const productModule: SuiteDomainModule = {
  id: 'product',

  /**
   * 读：领域条目按「严重级别 → 更新时间」排序。
   * 缺陷（P0–P3）永远排在普通需求之前，同级别内按更新时间倒序。
   */
  async list(ctx: SuiteDomainReadContext): Promise<SuiteDomainItemDto[]> {
    const boards = await ctx.store.suite.boards.listByUser(ctx.userId as string, {
      domainId: DOMAIN_ID,
    });
    return boards
      .map((board) => toItem(board))
      .sort((a, b) => {
        const rank = severityRank(a.payload) - severityRank(b.payload);
        if (rank !== 0) return rank;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  },

  /** 写：领域动作优先，未命中再回落到基线动作。 */
  async act(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
    switch (ctx.input.action) {
      case 'estimate':
        return estimate(ctx);
      case 'burndown':
        return burndown(ctx);
      case 'triage':
        return triage(ctx);
      case 'review':
        return review(ctx);
      case 'defect':
        return registerDefect(ctx);
      default:
        return base.act(ctx);
    }
  },

  /** 统计：需求池、本迭代已交付、开发中、缺陷未闭环，外加基线整体口径。 */
  async stats(ctx: SuiteDomainReadContext) {
    const boards = await ctx.store.suite.boards.listByUser(ctx.userId as string, {
      domainId: DOMAIN_ID,
    });
    const pool = boards.filter(
      (board) => board.stage === 'idea' && str(board.payload?.['kind']) !== 'defect',
    ).length;
    const doing = boards.filter((board) => board.stage === 'doing').length;
    const sprint = latestSprint(boards);
    const delivered = sprint
      ? boards.filter(
          (board) => str(board.payload?.['sprint']) === sprint && board.stage === 'done',
        ).length
      : 0;
    const openDefects = boards.filter(
      (board) => str(board.payload?.['kind']) === 'defect' && board.stage !== 'done',
    ).length;
    const baseStats = await base.stats(ctx);
    return [
      { label: '需求池', value: String(pool), hint: '尚未排期的需求条目数' },
      {
        label: '本迭代已交付',
        value: String(delivered),
        hint: sprint ? `迭代 ${sprint} 内已发布的条目数` : '先给条目指定所属迭代后开始统计',
      },
      { label: '开发中', value: String(doing), hint: '处于开发中阶段的条目数' },
      { label: '缺陷未闭环', value: String(openDefects), hint: '已登记但尚未发布的缺陷数' },
      ...baseStats,
    ];
  },
};
