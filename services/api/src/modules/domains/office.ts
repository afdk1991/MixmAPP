import type { SuiteActionResultDto, SuiteDomainId, SuiteDomainItemDto } from '@mixmapp/contracts';
import type { SuiteBoardRecord, SuiteProgressStatus } from '../../db/types.js';
import {
  createBoardDomain,
  toDomainItem,
  type SuiteDomainActionContext,
  type SuiteDomainModule,
} from '../suite/domain.js';

/**
 * 办公管理领域模块（任务看板、审批流转与会议纪要）。
 *
 * 基线用看板 + 阶段状态机实现（待处理 → 办理中 → 待审核 → 已完成），
 * 办公管理的专属语义在下面几处扩展：
 * - list：补齐负责人 / 期限 / 审核状态三项领域字段；
 * - act：review（通过与驳回）、meeting_note（会议纪要台账）、checklist_progress（清单完成率）；
 * - stats：待审核条数、本周完成条数、平均办理时长。
 *
 * 约定（同 §4.4）：全部动作幂等；业务不成立时返回 ok=false + message，不抛异常；
 * 数据只落 store.suite.* 四张通用台账，领域差异放进 payload。
 */
const DOMAIN_ID = 'office' as SuiteDomainId;
/** 会议纪要台账事件的类型。 */
const MEETING_EVENT_KIND = 'meeting-note';
/** 一天的毫秒数，用于「本周完成」「平均办理时长」口径。 */
const DAY_MS = 86_400_000;

const STAGE_LABELS: Record<string, string> = {
  todo: '待处理',
  doing: '办理中',
  review: '待审核',
  done: '已完成',
};

const base = createBoardDomain({
  id: DOMAIN_ID,
  stages: [
    { key: 'todo', label: '待处理' },
    { key: 'doing', label: '办理中' },
    { key: 'review', label: '待审核' },
    { key: 'done', label: '已完成' },
  ],
  transitions: {
    todo: ['doing'],
    doing: ['review', 'todo'],
    review: ['done', 'doing'],
    done: [],
  },
  initialStage: 'todo',
  eventKind: 'office-task',
  describe: (board) => ({
    summary: board.payload['summary'] ? String(board.payload['summary']) : board.title,
    meta: [
      {
        label: '负责人',
        value: typeof board.payload['owner'] === 'string' ? String(board.payload['owner']) : '',
      },
      {
        label: '期限',
        value: typeof board.payload['deadline'] === 'string' ? String(board.payload['deadline']) : '',
      },
    ].filter((m) => m.value !== ''),
  }),
});

/* ---------- 通用小工具 ---------- */

/** 取字符串值并去掉首尾空白；非字符串一律视为空。 */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 按行拆列表（清单 / 决议：一条一行，不按逗号拆，避免把一句话拆成两条）。 */
function toLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => text(v)).filter((v) => v !== '');
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter((v) => v !== '');
  }
  return [];
}

/** 拆名单（参与人：顿号、逗号、分号、换行都算分隔符）。 */
function toNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => text(v)).filter((v) => v !== '');
  }
  if (typeof value === 'string') {
    return value
      .split(/[\r\n、,，;；]+/)
      .map((v) => v.trim())
      .filter((v) => v !== '');
  }
  return [];
}

/** 审核状态：待审核优先，其次看上一次结论，最后是没提交过审核。 */
function reviewStatusOf(payload: Record<string, unknown>, stage: string): string {
  if (stage === 'review') return '待审核';
  const result = text(payload['reviewResult']);
  if (result === 'approved') return '已通过';
  if (result === 'rejected') return '已驳回';
  return '未提交';
}

/**
 * 领域 meta：负责人 / 期限 / 审核状态（+ 审核意见）。
 * 基线 describe 里已有的同名字段先摘掉，避免一条条目出现两个「负责人」。
 */
function officeMeta(
  baseMeta: Array<{ label: string; value: string }>,
  payload: Record<string, unknown>,
  stage: string,
): Array<{ label: string; value: string }> {
  const rest = baseMeta.filter(
    (m) => m.label !== '负责人' && m.label !== '期限' && m.label !== '审核状态' && m.label !== '审核意见',
  );
  const note = text(payload['reviewNote']);
  const rejected = text(payload['reviewResult']) === 'rejected';
  const rows: Array<{ label: string; value: string }> = [
    { label: '负责人', value: text(payload['owner']) || '未指派' },
    { label: '期限', value: text(payload['deadline']) || '未设置' },
    { label: '审核状态', value: reviewStatusOf(payload, stage) },
  ];
  if (note) rows.push({ label: rejected ? '驳回原因' : '审核意见', value: note });
  return [...rows, ...rest];
}

/** 看板记录 → 领域条目（领域模块自己的展示口径）。 */
function toItem(board: SuiteBoardRecord): SuiteDomainItemDto {
  return toDomainItem({
    id: board.id,
    title: board.title,
    summary: text(board.payload['summary']) || board.title,
    stage: board.stage,
    stageLabel: STAGE_LABELS[board.stage] ?? board.stage,
    priority: board.priority,
    amountFen: board.amountFen,
    meta: officeMeta([], board.payload, board.stage),
    payload: board.payload,
    updatedAt: board.updatedAt,
  });
}

/** 会议纪要的幂等键：标题 + 参与人 + 决议内容完全一致才视为同一场会。 */
function meetingKey(title: string, participants: string[], decisions: string[]): string {
  return [title, ...participants, ...decisions].join('｜');
}

/* ---------- 领域动作 ---------- */

/**
 * 审核：通过（待审核 → 已完成）或驳回（待审核 → 办理中）。
 * 驳回必须写明原因，原因落到 payload.reviewNote。
 */
async function reviewAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const userId = ctx.userId as string;
  const entryId = ctx.input.entryId ?? '';
  const current = entryId ? await ctx.store.suite.boards.find(entryId) : null;
  if (!current || current.userId !== userId) {
    return { ok: false, changed: false, message: '条目不存在或不属于你', item: null };
  }

  const decision = text(ctx.input.payload?.['decision']);
  if (decision !== 'approve' && decision !== 'reject') {
    return {
      ok: false,
      changed: false,
      message: '审核结论只能是 approve（通过）或 reject（驳回）',
      item: null,
    };
  }
  const note = text(ctx.input.payload?.['reviewNote']) || text(ctx.input.payload?.['note']) || text(ctx.input.note);

  // 幂等：同一个结论重复提交不重复记账，只回报当前状态。
  const lastResult = text(current.payload['reviewResult']);
  const alreadyHandled =
    (decision === 'approve' && lastResult === 'approved' && current.stage === 'done') ||
    (decision === 'reject' && lastResult === 'rejected' && current.stage === 'doing');
  if (alreadyHandled) {
    return {
      ok: true,
      changed: false,
      message: decision === 'approve' ? '该条目已通过审核' : '该条目已驳回，正在返工',
      item: toItem(current),
    };
  }

  if (current.stage !== 'review') {
    return {
      ok: false,
      changed: false,
      message: `只有「待审核」的条目可以审核，当前是「${STAGE_LABELS[current.stage] ?? current.stage}」`,
      item: null,
    };
  }

  if (decision === 'reject' && !note) {
    return { ok: false, changed: false, message: '驳回必须写明原因，方便对方照着改', item: null };
  }

  const target = decision === 'approve' ? 'done' : 'doing';
  const payload: Record<string, unknown> = {
    ...current.payload,
    reviewResult: decision === 'approve' ? 'approved' : 'rejected',
    reviewedAt: new Date().toISOString(),
    ...(note ? { reviewNote: note } : {}),
  };
  const updated = await ctx.store.suite.boards.update(current.id, { stage: target, payload });
  if (!updated) {
    return { ok: false, changed: false, message: '更新失败，请稍后再试', item: null };
  }
  return {
    ok: true,
    changed: true,
    message: decision === 'approve' ? '审核通过，条目已完成' : `已驳回并退回办理：${note}`,
    item: toItem(updated),
    data: { decision, reviewNote: note },
  };
}

/**
 * 会议纪要：记一条台账事件（kind = meeting-note），
 * 事件里带纪要标题、参与人与决议条目数，并返回一句可读的摘要。
 */
async function meetingNoteAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const userId = ctx.userId as string;
  const payload = ctx.input.payload ?? {};
  const title = text(payload['title']) || text(ctx.input.note);
  if (!title) {
    return { ok: false, changed: false, message: '请填写会议纪要标题', item: null };
  }
  const participants = toNames(payload['participants']);
  const decisions = toLines(payload['decisions']);
  const key = meetingKey(title, participants, decisions);

  // 幂等：同一场会重复提交只记一条。
  const existing = await ctx.store.suite.events.listByUser(userId, {
    domainId: DOMAIN_ID,
    kind: MEETING_EVENT_KIND,
  });
  const duplicated = existing.find((e) => text(e.payload['meetingKey']) === key);
  if (duplicated) {
    return {
      ok: true,
      changed: false,
      message: `《${title}》已在台账里，没有重复记录`,
      item: null,
      data: {
        eventId: duplicated.id,
        participantCount: participants.length,
        decisionCount: decisions.length,
      },
    };
  }

  const now = new Date();
  const event = await ctx.store.suite.events.insert({
    id: ctx.ids.next().id,
    domainId: DOMAIN_ID,
    userId,
    kind: MEETING_EVENT_KIND,
    subject: title,
    amountFen: 0,
    // 纪要已归档，但决议事项仍待跟进，台账状态记为待处理。
    status: 'pending',
    outTradeNo: null,
    payload: {
      meetingKey: key,
      title,
      participants,
      participantCount: participants.length,
      decisions,
      decisionCount: decisions.length,
    },
    createdAt: now,
    updatedAt: now,
  });

  return {
    ok: true,
    changed: true,
    message: `《${title}》已记入台账：参与 ${participants.length} 人，决议 ${decisions.length} 条`,
    item: null,
    data: {
      eventId: event.id,
      participantCount: participants.length,
      decisionCount: decisions.length,
    },
  };
}

/**
 * 清单完成率：按清单条目数与已完成数算百分比，写进 suite_progress。
 * 状态按完成率自动取 todo（0）/ doing（0~100）/ done（100）。
 */
async function checklistProgressAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const userId = ctx.userId as string;
  const entryId = ctx.input.entryId?.trim() ?? '';
  if (!entryId) {
    return { ok: false, changed: false, message: '请指定要记录清单的条目', item: null };
  }
  const payload = ctx.input.payload ?? {};
  const checklist = toLines(payload['checklist']);
  if (!checklist.length) {
    return { ok: false, changed: false, message: '请提供清单条目', item: null };
  }
  const raw = payload['checked'];
  const parsed = typeof raw === 'number' ? raw : Number(raw ?? 0);
  const checked = Math.min(Math.max(Math.trunc(Number.isFinite(parsed) ? parsed : 0), 0), checklist.length);
  const value = Math.round((checked / checklist.length) * 100);
  const status: SuiteProgressStatus = value >= 100 ? 'done' : value > 0 ? 'doing' : 'todo';

  const existing = await ctx.store.suite.progress.find(userId, DOMAIN_ID, entryId);
  if (existing && existing.status === status && existing.value === value) {
    return {
      ok: true,
      changed: false,
      message: `清单完成率 ${value}%（${checked}/${checklist.length}）`,
      item: null,
      data: { status, value, checked, total: checklist.length },
    };
  }

  const now = new Date();
  await ctx.store.suite.progress.upsert({
    id: existing?.id ?? ctx.ids.next().id,
    userId,
    domainId: DOMAIN_ID,
    entryId,
    status,
    value,
    notes: text(payload['notes']) || existing?.notes || '',
    dueAt: existing?.dueAt ?? null,
    completedAt: status === 'done' ? (existing?.completedAt ?? now) : null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  return {
    ok: true,
    changed: true,
    message: `清单完成率 ${value}%（${checked}/${checklist.length}）`,
    item: null,
    data: { status, value, checked, total: checklist.length },
  };
}

/* ---------- 对外导出 ---------- */

export const officeModule: SuiteDomainModule = {
  id: 'office',

  /** 读：基线条目 + 领域 meta（负责人 / 期限 / 审核状态）。 */
  async list(ctx) {
    const items = await base.list(ctx);
    return items.map((item) => ({
      ...item,
      meta: officeMeta(item.meta, item.payload, item.stage),
    }));
  },

  /** 写：领域动作优先，未命中回落基线的 create / advance / setStage / remove。 */
  async act(ctx) {
    switch (ctx.input.action) {
      case 'review':
        return reviewAction(ctx);
      case 'meeting_note':
        return meetingNoteAction(ctx);
      case 'checklist_progress':
        return checklistProgressAction(ctx);
      default:
        return base.act(ctx);
    }
  },

  /** 统计：基线指标 + 待审核 / 本周完成 / 平均办理时长。 */
  async stats(ctx) {
    const baseStats = await base.stats(ctx);
    const boards = await ctx.store.suite.boards.listByUser(ctx.userId as string, {
      domainId: DOMAIN_ID,
    });
    const metrics: Array<{ label: string; value: string; hint?: string }> = [...baseStats];

    const pendingReview = boards.filter((b) => b.stage === 'review').length;
    if (pendingReview > 0) {
      metrics.push({
        label: '待审核',
        value: `${pendingReview} 条`,
        hint: '停在待审核阶段、等一个人点头的条目',
      });
    }

    const weekAgo = Date.now() - 7 * DAY_MS;
    const doneThisWeek = boards.filter(
      (b) => b.stage === 'done' && b.updatedAt.getTime() >= weekAgo,
    ).length;
    if (doneThisWeek > 0) {
      metrics.push({
        label: '本周完成',
        value: `${doneThisWeek} 条`,
        hint: '最近 7 天内完成的条目',
      });
    }

    const durations = boards
      .filter((b) => b.stage === 'done')
      .map((b) => b.updatedAt.getTime() - b.createdAt.getTime())
      .filter((ms) => ms >= 0);
    if (durations.length > 0) {
      const average = durations.reduce((sum, ms) => sum + ms, 0) / durations.length;
      metrics.push({
        label: '平均办理时长',
        value: `${(average / DAY_MS).toFixed(1)} 天`,
        hint: '已完成条目从建单到完成的平均间隔',
      });
    }

    return metrics;
  },
};
