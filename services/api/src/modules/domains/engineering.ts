import type { SuiteActionResultDto, SuiteDomainId, SuiteDomainItemDto } from '@mixmapp/contracts';
import type { SuiteBoardRecord } from '../../db/types.js';
import {
  createBoardDomain,
  formatFen,
  toDomainItem,
  type SuiteDomainActionContext,
  type SuiteDomainModule,
} from '../suite/domain.js';

/**
 * 工程领域模块（工单派发、材料清单与验收留痕）。
 *
 * 基线用看板 + 阶段状态机实现（待派工 → 已派工 → 施工中 → 验收中 → 已完工），
 * 工程的专属语义在下面几处扩展：
 * - list：补齐施工地点 / 负责人 / 材料清单条数 / 验收状态，并按阶段优先级排序；
 * - act：dispatch（派工）、materials_cost（核材料）、accept（验收）、progress_note（施工记录）；
 * - stats：待派工数、施工中、验收中、材料费用合计、平均验收周期。
 *
 * 约定（同架构规约 §4.4）：全部动作幂等；业务不成立时返回 ok=false + message，不抛异常；
 * 数据只落 store.suite.* 四张通用台账，领域差异放进 payload。
 */
const DOMAIN_ID = 'engineering' as SuiteDomainId;
/** 一天的毫秒数，用于平均验收周期口径。 */
const DAY_MS = 86_400_000;

const STAGE_LABELS: Record<string, string> = {
  reported: '待派工',
  assigned: '已派工',
  working: '施工中',
  checking: '验收中',
  done: '已完工',
};

/** 列表排序用的阶段优先级：待派工最前，其后按流程顺序往后排。 */
const STAGE_PRIORITY = ['reported', 'assigned', 'working', 'checking', 'done'];

const base = createBoardDomain({
  id: DOMAIN_ID,
  stages: [
    { key: 'reported', label: '待派工' },
    { key: 'assigned', label: '已派工' },
    { key: 'working', label: '施工中' },
    { key: 'checking', label: '验收中' },
    { key: 'done', label: '已完工' },
  ],
  transitions: {
    reported: ['assigned'],
    assigned: ['working', 'reported'],
    working: ['checking', 'assigned'],
    checking: ['done', 'working'],
    done: [],
  },
  initialStage: 'reported',
  eventKind: 'work-order',
  describe: (board) => ({
    summary: board.payload['summary'] ? String(board.payload['summary']) : board.title,
    // meta 由领域层统一组装（施工地点 / 负责人 / 材料清单条数 / 验收状态）。
    meta: [],
  }),
});

/* ---------- 通用小工具 ---------- */

/** 取字符串值并去掉首尾空白；非字符串一律视为空。 */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 把可能是数字或数字字符串的入参转成 number；无法解析时返回 NaN。 */
function num(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

/** 取记录对象（payload 里的一层对象）；非对象一律当作空对象。 */
function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** 材料清单的一行：名称 + 数量 + 单价（分）+ 小计（分）。 */
type MaterialLine = {
  name: string;
  qty: number;
  unitPriceFen: number;
  amountFen: number;
};

/** 施工记录的一行：时间 + 内容。 */
type NoteLine = {
  at: string;
  text: string;
};

/**
 * 解析材料清单。
 *
 * 规则：每行必须有名称；数量必须是大于 0 的数字；单价是以分表示的非负数字。
 * 返回清单小计之和与一份摘要串（摘要用于幂等判断：清单没变就不重复记账）。
 */
function readMaterials(
  raw: unknown,
): { lines: MaterialLine[]; totalFen: number; digest: string } | { message: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { message: '请先填写材料清单（名称、数量、单价）' };
  }
  const lines: MaterialLine[] = [];
  let totalFen = 0;
  for (const entry of raw) {
    const row = obj(entry);
    const name = text(row['name']);
    if (!name) {
      return { message: '材料清单里每一项都要写名称' };
    }
    const qty = num(row['qty']);
    if (!Number.isFinite(qty) || qty <= 0) {
      return { message: `材料「${name}」的数量需要是大于 0 的数字` };
    }
    const unitPriceFen = num(row['unitPriceFen']);
    if (!Number.isFinite(unitPriceFen) || unitPriceFen < 0) {
      return { message: `材料「${name}」的单价需要是以分表示的非负数字` };
    }
    const price = Math.round(unitPriceFen);
    const amountFen = Math.round(qty * price);
    lines.push({ name, qty, unitPriceFen: price, amountFen });
    totalFen += amountFen;
  }
  return {
    lines,
    totalFen,
    digest: lines.map((l) => `${l.name}|${l.qty}|${l.unitPriceFen}`).join(';'),
  };
}

/** 读条目上已存的材料清单（用于展示清单条数）。 */
function materialsOf(payload: Record<string, unknown>): MaterialLine[] {
  const raw = payload['materials'];
  if (!Array.isArray(raw)) return [];
  const out: MaterialLine[] = [];
  for (const entry of raw) {
    const row = obj(entry);
    const name = text(row['name']);
    if (!name) continue;
    const qty = num(row['qty']);
    const unitPriceFen = num(row['unitPriceFen']);
    const price = Number.isFinite(unitPriceFen) ? Math.round(unitPriceFen) : 0;
    const count = Number.isFinite(qty) ? qty : 0;
    out.push({ name, qty: count, unitPriceFen: price, amountFen: Math.round(count * price) });
  }
  return out;
}

/** 读条目上的施工记录列表。 */
function notesOf(payload: Record<string, unknown>): NoteLine[] {
  const raw = payload['notes'];
  if (!Array.isArray(raw)) return [];
  const out: NoteLine[] = [];
  for (const entry of raw) {
    const row = obj(entry);
    const content = text(row['text']);
    if (!content) continue;
    out.push({ at: text(row['at']), text: content });
  }
  return out;
}

/** 验收状态：看结论、看是否待验收，最后兜底为未验收。 */
function acceptStatusOf(payload: Record<string, unknown>, stage: string): string {
  const result = text(payload['acceptResult']);
  if (result === 'passed') return '已通过';
  if (result === 'rejected') return '未通过（已退回）';
  if (stage === 'checking') return '待验收';
  return '未验收';
}

/** 领域 meta：施工地点 / 负责人 / 材料清单条数 / 验收状态。 */
function engineeringMeta(
  payload: Record<string, unknown>,
  stage: string,
): Array<{ label: string; value: string }> {
  return [
    { label: '施工地点', value: text(payload['site']) || '未填写' },
    { label: '负责人', value: text(payload['owner']) || '未指派' },
    { label: '材料清单条数', value: `${materialsOf(payload).length} 项` },
    { label: '验收状态', value: acceptStatusOf(payload, stage) },
  ];
}

/** 看板记录 → 领域条目（工程自己的展示口径）。 */
function toItem(board: SuiteBoardRecord): SuiteDomainItemDto {
  return toDomainItem({
    id: board.id,
    title: board.title,
    summary: text(board.payload['summary']) || board.title,
    stage: board.stage,
    stageLabel: STAGE_LABELS[board.stage] ?? board.stage,
    priority: board.priority,
    amountFen: board.amountFen,
    meta: engineeringMeta(board.payload, board.stage),
    payload: board.payload,
    updatedAt: board.updatedAt,
  });
}

/** 取当前用户的条目；不存在或不属于当前用户时返回 null。 */
async function findBoard(ctx: SuiteDomainActionContext): Promise<SuiteBoardRecord | null> {
  const userId = ctx.userId as string;
  const entryId = ctx.input.entryId ?? '';
  if (!entryId) return null;
  const found = await ctx.store.suite.boards.find(entryId);
  if (!found || found.userId !== userId) return null;
  return found;
}

/* ---------- 领域动作 ---------- */

/**
 * 派工：待派工 → 已派工。
 *
 * 必须给负责人；派工时间写进 payload.dispatchedAt。
 * 重复派给同一个人不算新动作（changed=false）；换人按改派处理。
 */
async function dispatchAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const current = await findBoard(ctx);
  if (!current) {
    return { ok: false, changed: false, message: '条目不存在或不属于你', item: null };
  }
  const owner = text(ctx.input.payload?.['owner']) || text(ctx.input.note);
  if (!owner) {
    return { ok: false, changed: false, message: '派工要先写明负责人', item: null };
  }
  if (current.stage !== 'reported' && current.stage !== 'assigned') {
    return {
      ok: false,
      changed: false,
      message: `只有「待派工」的工单可以派工，当前是「${STAGE_LABELS[current.stage] ?? current.stage}」`,
      item: null,
    };
  }
  const currentOwner = text(current.payload['owner']);
  if (current.stage === 'assigned' && currentOwner === owner) {
    return {
      ok: true,
      changed: false,
      message: `这条工单已经派给 ${owner} 了`,
      item: toItem(current),
      data: { owner },
    };
  }
  const dispatchedAt = new Date().toISOString();
  const updated = await ctx.store.suite.boards.update(current.id, {
    stage: 'assigned',
    payload: { ...current.payload, owner, dispatchedAt },
  });
  if (!updated) {
    return { ok: false, changed: false, message: '更新失败，请稍后再试', item: null };
  }
  return {
    ok: true,
    changed: true,
    message: current.stage === 'assigned' ? `已改派给 ${owner}` : `已派给 ${owner}`,
    item: toItem(updated),
    data: { owner, dispatchedAt },
  };
}

/**
 * 核材料：按材料清单核算总价。
 *
 * 清单摘要没变且已经核算过 → changed=false；清单变了 → 重新核算并覆盖总价。
 */
async function materialsCostAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const current = await findBoard(ctx);
  if (!current) {
    return { ok: false, changed: false, message: '条目不存在或不属于你', item: null };
  }
  const parsed = readMaterials(ctx.input.payload?.['materials']);
  if ('message' in parsed) {
    return { ok: false, changed: false, message: parsed.message, item: null };
  }
  const { lines, totalFen, digest } = parsed;

  const prevDigest = text(current.payload['materialsDigest']);
  const prevTotal = num(current.payload['materialsTotalFen']);
  if (prevDigest === digest && Number.isFinite(prevTotal) && prevTotal === totalFen) {
    return {
      ok: true,
      changed: false,
      message: `清单没变，材料总价仍是 ${formatFen(totalFen)} 元`,
      item: toItem(current),
      data: { totalFen, items: lines },
    };
  }

  const updated = await ctx.store.suite.boards.update(current.id, {
    payload: {
      ...current.payload,
      materials: lines,
      materialsTotalFen: totalFen,
      materialsDigest: digest,
      materialsCostedAt: new Date().toISOString(),
    },
  });
  if (!updated) {
    return { ok: false, changed: false, message: '更新失败，请稍后再试', item: null };
  }
  return {
    ok: true,
    changed: true,
    message: `材料总价 ${formatFen(totalFen)} 元（${lines.length} 项）`,
    item: toItem(updated),
    data: { totalFen, items: lines },
  };
}

/**
 * 验收：验收中 → 已完工（通过）或 → 施工中（不通过）。
 *
 * 通过：把材料总价写进条目金额。
 * 不通过：必须写明问题（写入 payload.acceptNote），退回施工中，总价不计入金额。
 */
async function acceptAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const current = await findBoard(ctx);
  if (!current) {
    return { ok: false, changed: false, message: '条目不存在或不属于你', item: null };
  }
  const decision = text(ctx.input.payload?.['decision']);
  if (decision !== 'pass' && decision !== 'reject') {
    return {
      ok: false,
      changed: false,
      message: '验收结论只能是 pass（通过）或 reject（不通过）',
      item: null,
    };
  }
  const note =
    text(ctx.input.payload?.['acceptNote']) || text(ctx.input.payload?.['note']) || text(ctx.input.note);

  // 幂等：同一结论重复提交不产生第二条验收记录。
  if (decision === 'pass' && current.stage === 'done' && text(current.payload['acceptResult']) === 'passed') {
    return {
      ok: true,
      changed: false,
      message: '这条工单已经验收通过',
      item: toItem(current),
      data: { decision },
    };
  }
  if (
    decision === 'reject' &&
    current.stage === 'working' &&
    text(current.payload['acceptResult']) === 'rejected' &&
    text(current.payload['acceptNote']) === note
  ) {
    return {
      ok: true,
      changed: false,
      message: `已退回施工：${note}`,
      item: toItem(current),
      data: { decision, acceptNote: note },
    };
  }

  if (current.stage !== 'checking') {
    return {
      ok: false,
      changed: false,
      message: `只有「验收中」的工单可以验收，当前是「${STAGE_LABELS[current.stage] ?? current.stage}」`,
      item: null,
    };
  }
  if (decision === 'reject' && !note) {
    return { ok: false, changed: false, message: '验收不通过要写明问题，方便施工方照着改', item: null };
  }

  const at = new Date().toISOString();
  if (decision === 'pass') {
    const rawTotal = num(current.payload['materialsTotalFen']);
    const totalFen = Number.isFinite(rawTotal) ? Math.max(0, Math.round(rawTotal)) : 0;
    const updated = await ctx.store.suite.boards.update(current.id, {
      stage: 'done',
      amountFen: totalFen,
      payload: { ...current.payload, acceptResult: 'passed', acceptedAt: at },
    });
    if (!updated) {
      return { ok: false, changed: false, message: '更新失败，请稍后再试', item: null };
    }
    return {
      ok: true,
      changed: true,
      message: `验收通过，材料总价 ${formatFen(totalFen)} 元已计入条目金额`,
      item: toItem(updated),
      data: { decision, totalFen },
    };
  }
  const updated = await ctx.store.suite.boards.update(current.id, {
    stage: 'working',
    payload: { ...current.payload, acceptResult: 'rejected', acceptNote: note, rejectedAt: at },
  });
  if (!updated) {
    return { ok: false, changed: false, message: '更新失败，请稍后再试', item: null };
  }
  return {
    ok: true,
    changed: true,
    message: `验收不通过，已退回施工：${note}`,
    item: toItem(updated),
    data: { decision, acceptNote: note },
  };
}

/** 施工记录：追加一条带时间戳的记录，并更新记录条数。 */
async function progressNoteAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const current = await findBoard(ctx);
  if (!current) {
    return { ok: false, changed: false, message: '条目不存在或不属于你', item: null };
  }
  const content = text(ctx.input.payload?.['note']) || text(ctx.input.note);
  if (!content) {
    return { ok: false, changed: false, message: '写一句记录内容再提交', item: null };
  }
  const notes = notesOf(current.payload);
  const last = notes[notes.length - 1];
  if (last && last.text === content) {
    return {
      ok: true,
      changed: false,
      message: `这条记录已经记过了（共 ${notes.length} 条）`,
      item: toItem(current),
      data: { noteCount: notes.length },
    };
  }
  const at = new Date().toISOString();
  const next = [...notes, { at, text: content }];
  const updated = await ctx.store.suite.boards.update(current.id, {
    payload: { ...current.payload, notes: next, noteCount: next.length },
  });
  if (!updated) {
    return { ok: false, changed: false, message: '更新失败，请稍后再试', item: null };
  }
  return {
    ok: true,
    changed: true,
    message: `已记下施工记录（共 ${next.length} 条）`,
    item: toItem(updated),
    data: { noteCount: next.length, at },
  };
}

/**
 * 推进：基线的阶段推进。
 * 待派工的工单必须先派工（负责人是必填项），所以这里拦一道并说明原因。
 */
async function advanceAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const current = await findBoard(ctx);
  if (!current) {
    return { ok: false, changed: false, message: '条目不存在或不属于你', item: null };
  }
  if (current.stage === 'reported') {
    return {
      ok: false,
      changed: false,
      message: '待派工的工单要先派工，指定负责人后再推进',
      item: null,
    };
  }
  return base.act(ctx);
}

/* ---------- 对外导出 ---------- */

export const engineeringModule: SuiteDomainModule = {
  id: 'engineering',

  /** 读：工程条目 + 领域 meta，按「阶段优先级 → 更新时间」排序。 */
  async list(ctx) {
    const boards = await ctx.store.suite.boards.listByUser(ctx.userId as string, {
      domainId: DOMAIN_ID,
    });
    return boards
      .map((board) => toItem(board))
      .sort((a, b) => {
        const rankA = STAGE_PRIORITY.indexOf(a.stage);
        const rankB = STAGE_PRIORITY.indexOf(b.stage);
        const pa = rankA < 0 ? STAGE_PRIORITY.length : rankA;
        const pb = rankB < 0 ? STAGE_PRIORITY.length : rankB;
        if (pa !== pb) return pa - pb;
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      });
  },

  /** 写：领域动作优先，未命中回落基线的 create / setStage / remove。 */
  async act(ctx) {
    switch (ctx.input.action) {
      case 'dispatch':
        return dispatchAction(ctx);
      case 'materials_cost':
        return materialsCostAction(ctx);
      case 'accept':
        return acceptAction(ctx);
      case 'progress_note':
        return progressNoteAction(ctx);
      case 'advance':
        return advanceAction(ctx);
      default: {
        const result = await base.act(ctx);
        if (!result.item) return result;
        return {
          ...result,
          item: {
            ...result.item,
            meta: engineeringMeta(result.item.payload, result.item.stage),
          },
        };
      }
    }
  },

  /** 统计：待派工数 / 施工中 / 验收中 / 材料费用合计 / 平均验收周期。 */
  async stats(ctx) {
    const boards = await ctx.store.suite.boards.listByUser(ctx.userId as string, {
      domainId: DOMAIN_ID,
    });
    const metrics: Array<{ label: string; value: string; hint?: string }> = [
      {
        label: '待派工',
        value: `${boards.filter((b) => b.stage === 'reported').length} 条`,
        hint: '还没落到具体负责人的工单',
      },
      {
        label: '施工中',
        value: `${boards.filter((b) => b.stage === 'working').length} 条`,
        hint: '正在现场施工的工单',
      },
      {
        label: '验收中',
        value: `${boards.filter((b) => b.stage === 'checking').length} 条`,
        hint: '施工完成、等待验收确认的工单',
      },
    ];

    const done = boards.filter((b) => b.stage === 'done');
    if (done.length > 0) {
      const total = done.reduce((sum, b) => sum + (b.amountFen || 0), 0);
      metrics.push({
        label: '材料费用合计',
        value: `${formatFen(total)} 元`,
        hint: '已验收工单的材料总价之和',
      });
      const durations = done
        .map((b) => b.updatedAt.getTime() - b.createdAt.getTime())
        .filter((ms) => ms >= 0);
      if (durations.length > 0) {
        const average = durations.reduce((sum, ms) => sum + ms, 0) / durations.length;
        metrics.push({
          label: '平均验收周期',
          value: `${(average / DAY_MS).toFixed(1)} 天`,
          hint: '已验收工单从建单到验收通过的平均间隔',
        });
      }
    }

    return metrics;
  },
};
