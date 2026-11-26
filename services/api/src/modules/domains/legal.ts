import type { SuiteActionResultDto, SuiteDomainId } from '@mixmapp/contracts';
import {
  createBoardDomain,
  type SuiteDomainActionContext,
  type SuiteDomainModule,
} from '../suite/domain.js';

/**
 * 法律政务领域模块（办事指南、材料清单与合规自查）。
 *
 * 定位：只做流程梳理与清单核对，不提供法律意见、不判定合规与否。
 * 因此本模块没有「出具意见」「认定合规」类动作，自查只回完成度与缺失项。
 *
 * 数据落通用台账；政务数据接口、电子证照核验均未接入，不在代码里伪造。
 */
const DOMAIN_ID = 'legal' as SuiteDomainId;
/** 一天的毫秒数，用于「近七天办结」口径。 */
const DAY_MS = 86_400_000;

const STAGE_LABELS: Record<string, string> = {
  draft: '自查中',
  submitted: '已提交',
  processing: '办理中',
  done: '已办结',
};

/** 取字符串并去空白。 */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 取非负整数；非法返回 null。 */
function nonNegative(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

/** 按行拆清单（一条一行，不按逗号拆）。 */
function toLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => text(item)).filter((item) => item !== '');
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter((item) => item !== '');
  }
  return [];
}

/** 统一的失败返回。 */
function fail(message: string): SuiteActionResultDto {
  return { ok: false, changed: false, message, item: null };
}

/** 领域 meta：受理机构 / 依据类型 / 承诺时限 / 材料完成率 / 自查完成率。 */
function legalMeta(payload: Record<string, unknown>, stage: string): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: '当前阶段', value: STAGE_LABELS[stage] ?? stage },
  ];
  const authority = text(payload['authority']);
  if (authority) rows.push({ label: '受理机构', value: authority });
  const basis = text(payload['basis']);
  if (basis) rows.push({ label: '依据类型', value: basis });
  const dueDays = text(payload['dueDays']);
  if (dueDays) rows.push({ label: '承诺时限', value: dueDays });
  const materialPercent = nonNegative(payload['materialPercent']);
  if (materialPercent !== null && materialPercent > 0) {
    rows.push({ label: '材料完成率', value: `${materialPercent}%` });
  }
  const checkPercent = nonNegative(payload['selfCheckPercent']);
  if (checkPercent !== null && checkPercent > 0) {
    rows.push({ label: '自查完成率', value: `${checkPercent}%` });
  }
  return rows;
}

/** 摘要：优先用事项说明，没有就退回标题。 */
function summaryOf(payload: Record<string, unknown>, title: string): string {
  return text(payload['summary']) || title;
}

const base = createBoardDomain({
  id: DOMAIN_ID,
  stages: [
    { key: 'draft', label: '自查中' },
    { key: 'submitted', label: '已提交' },
    { key: 'processing', label: '办理中' },
    { key: 'done', label: '已办结' },
  ],
  transitions: {
    draft: ['submitted'],
    submitted: ['processing', 'draft'],
    processing: ['done', 'submitted'],
    done: [],
  },
  initialStage: 'draft',
  eventKind: 'legal-item',
  describe: (board) => ({
    summary: summaryOf(board.payload, board.title),
    meta: legalMeta(board.payload, board.stage),
  }),
});

/** 取当前用户条目。 */
async function findBoard(ctx: SuiteDomainActionContext) {
  const entryId = ctx.input.entryId?.trim() ?? '';
  if (!entryId) return null;
  const found = await ctx.store.suite.boards.find(entryId);
  if (!found || found.userId !== ctx.userId) return null;
  return found;
}

/** 动作后回读条目。 */
async function itemOf(ctx: SuiteDomainActionContext, id: string) {
  const list = await base.list(ctx);
  return list.find((item) => item.id === id) ?? null;
}

/**
 * guide：办事指南建档。
 *
 * 不带 entryId 时新建事项（进入「自查中」）；带 entryId 时只允许在「自查中」补充
 * 受理机构、依据类型、承诺时限与办理方式——事项一旦提交，口径就不允许悄悄改。
 *
 * 幂等：同一组字段重复提交返回 changed=false。
 */
async function guideAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const payload = ctx.input.payload ?? {};
  const authority = text(payload['authority']);
  const basis = text(payload['basis']);
  const dueDays = text(payload['dueDays']);
  const channel = text(payload['channel']);

  if (!ctx.input.entryId) {
    const title = text(payload['title']) || text(ctx.input.note);
    if (!title) return fail('请填写事项名称');
    if (!authority) return fail('请填写受理机构，先确认归谁办');
    const created = await base.act({
      ...ctx,
      input: {
        ...ctx.input,
        action: 'create',
        payload: {
          ...payload,
          title,
          authority,
          basis,
          dueDays,
          channel,
          summary:
            text(payload['summary']) ||
            `${authority}${basis ? ` · ${basis}` : ''}${dueDays ? ` · 承诺 ${dueDays}` : ''}`,
        },
      },
    });
    if (!created.ok) return created;
    return {
      ...created,
      message: created.changed ? '事项已建档：先核对受理机构与材料清单' : created.message,
    };
  }

  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');
  if (board.stage !== 'draft') {
    return fail(`只有「自查中」的事项可以修改指南信息，当前是「${STAGE_LABELS[board.stage] ?? board.stage}」`);
  }

  const prev = board.payload ?? {};
  const same =
    text(prev['authority']) === authority &&
    text(prev['basis']) === basis &&
    text(prev['dueDays']) === dueDays &&
    text(prev['channel']) === channel;
  if (same) {
    return {
      ok: true,
      changed: false,
      message: '指南信息没有变化',
      item: await itemOf(ctx, board.id),
      data: {},
    };
  }

  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: { ...prev, ...payload, authority, basis, dueDays, channel },
  });
  if (!updated) return fail('指南信息保存失败，请稍后再试');
  return {
    ok: true,
    changed: true,
    message: '指南信息已更新（口径以受理机构最新发布为准）',
    item: await itemOf(ctx, board.id),
    data: {},
  };
}

/**
 * materials：材料清单完成度。
 *
 * 入参 payload.materials（清单，数组或换行字符串）+ payload.done（已备条数）。
 * 只算完成度并列出缺失项，不代表受理机构已认可材料齐全。
 *
 * 幂等：清单内容与完成数完全一致时返回 changed=false。
 */
async function materialsAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const payload = ctx.input.payload ?? {};
  const materials = toLines(payload['materials']);
  if (!materials.length) return fail('请提供材料清单，一条一行');

  const rawDone = payload['done'] ?? payload['checked'];
  const parsed = nonNegative(rawDone);
  if (parsed === null) return fail('已备条数需要是大于等于 0 的整数');
  const done = Math.min(parsed, materials.length);
  const percent = Math.round((done / materials.length) * 100);

  const prev = board.payload ?? {};
  const prevList = toLines(prev['materials']);
  const same =
    nonNegative(prev['materialPercent']) === percent &&
    prevList.length === materials.length &&
    prevList.every((item, index) => item === materials[index]);
  if (same) {
    return {
      ok: true,
      changed: false,
      message: `材料完成率 ${percent}%（${done}/${materials.length}）`,
      item: await itemOf(ctx, board.id),
      data: { percent, done, total: materials.length },
    };
  }

  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: {
      ...prev,
      materials,
      materialDone: done,
      materialTotal: materials.length,
      materialPercent: percent,
    },
  });
  if (!updated) return fail('材料清单保存失败，请稍后再试');

  const missing = materials.length - done;
  return {
    ok: true,
    changed: true,
    message: `材料完成率 ${percent}%（${done}/${materials.length}）${missing > 0 ? `，尚有 ${missing} 项未备` : ''}`,
    item: await itemOf(ctx, board.id),
    data: { percent, done, total: materials.length },
  };
}

/**
 * self_check：合规自查完成度。
 *
 * 入参 payload.items（检查项，数组或换行字符串）+ payload.checked（已勾选条数）。
 * 只返回完成度与未勾选数量，**不输出合规或不合规的结论**。
 *
 * 幂等：检查项与勾选数完全一致时返回 changed=false。
 */
async function selfCheckAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const payload = ctx.input.payload ?? {};
  const items = toLines(payload['items']);
  if (!items.length) return fail('请提供检查项，一条一行');

  const parsed = nonNegative(payload['checked'] ?? payload['done']);
  if (parsed === null) return fail('已勾选条数需要是大于等于 0 的整数');
  const checked = Math.min(parsed, items.length);
  const percent = Math.round((checked / items.length) * 100);
  const missing = items.length - checked;

  const prev = board.payload ?? {};
  const prevItems = toLines(prev['selfCheckItems']);
  const same =
    nonNegative(prev['selfCheckPercent']) === percent &&
    prevItems.length === items.length &&
    prevItems.every((item, index) => item === items[index]);
  if (same) {
    return {
      ok: true,
      changed: false,
      message: `自查完成 ${checked}/${items.length}，未勾选 ${missing} 项；自查不构成合规结论`,
      item: await itemOf(ctx, board.id),
      data: { percent, checked, total: items.length, missing },
    };
  }

  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: {
      ...prev,
      selfCheckItems: items,
      selfCheckChecked: checked,
      selfCheckTotal: items.length,
      selfCheckPercent: percent,
      selfCheckMissing: missing,
      selfCheckAt: new Date().toISOString(),
    },
  });
  if (!updated) return fail('自查记录保存失败，请稍后再试');
  return {
    ok: true,
    changed: true,
    message: `自查完成 ${checked}/${items.length}，未勾选 ${missing} 项；自查不构成合规结论，高风险项请咨询律师或主管机关`,
    item: await itemOf(ctx, board.id),
    data: { percent, checked, total: items.length, missing },
  };
}

export const legalModule: SuiteDomainModule = {
  id: 'legal',

  /** 读：基线列表 + 领域 meta。 */
  async list(ctx) {
    return base.list(ctx);
  },

  /** 写：领域动作优先，未命中回落到基线的 create / advance / setStage / remove。 */
  async act(ctx) {
    switch (ctx.input.action) {
      case 'guide':
        return guideAction(ctx);
      case 'materials':
        return materialsAction(ctx);
      case 'self_check':
        return selfCheckAction(ctx);
      default:
        return base.act(ctx);
    }
  },

  /** 统计：办理中、待办结、近七天办结、材料未齐。 */
  async stats(ctx) {
    const metrics = await base.stats(ctx);
    const boards = await ctx.store.suite.boards.listByUser(ctx.userId as string, {
      domainId: DOMAIN_ID,
    });

    const ongoing = boards.filter((b) => b.stage === 'submitted' || b.stage === 'processing').length;
    if (ongoing > 0) metrics.push({ label: '办理中', value: `${ongoing} 条`, hint: '已提交或办理中的事项' });

    const pending = boards.filter((b) => b.stage !== 'done').length;
    if (pending > 0) metrics.push({ label: '待办结', value: `${pending} 条` });

    const weekAgo = Date.now() - 7 * DAY_MS;
    const doneThisWeek = boards.filter(
      (b) => b.stage === 'done' && b.updatedAt.getTime() >= weekAgo,
    ).length;
    if (doneThisWeek > 0) metrics.push({ label: '近七天办结', value: `${doneThisWeek} 条` });

    const incomplete = boards.filter((b) => {
      const percent = nonNegative((b.payload ?? {})['materialPercent']);
      return percent !== null && percent > 0 && percent < 100 && b.stage !== 'done';
    }).length;
    if (incomplete > 0) metrics.push({ label: '材料未齐', value: `${incomplete} 条`, hint: '完成率低于 100% 的未办结事项' });

    return metrics;
  },
};
