import type { SuiteActionResultDto, SuiteDomainId } from '@mixmapp/contracts';
import {
  createBoardDomain,
  type SuiteDomainActionContext,
  type SuiteDomainModule,
  type SuiteDomainReadContext,
} from '../suite/domain.js';

/**
 * 医疗医药领域模块（用药记录、剂量核对与随访提醒）。
 *
 * 定位：只做「记录 + 算术核对 + 提醒」，不提供诊断、处方或用药建议。
 * 因此本模块刻意不实现任何「推荐用药」「调整剂量」类动作，剂量相关的动作
 * 只把单次剂量 × 每日次数算出来，再与用户自填的上限做减法，结果原样返回。
 *
 * 数据全部落通用台账（boards / events / progress），健康信息按账号隔离。
 */
const DOMAIN_ID = 'health' as SuiteDomainId;
/** 随访台账事件类型。 */
const FOLLOWUP_EVENT_KIND = 'health-followup';
/** 一天的毫秒数，用于「待复诊」口径。 */
const DAY_MS = 86_400_000;

const STAGE_LABELS: Record<string, string> = {
  recorded: '已记录',
  reviewing: '复核中',
  active: '执行中',
  closed: '已结束',
};

/** 取字符串并去空白。 */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 取正数；非法或非正返回 null。 */
function positive(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/** 取日期（YYYY-MM-DD）；非法返回空串。 */
function dayKey(value: unknown): string {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const at = new Date(`${raw}T00:00:00`);
  return Number.isNaN(at.getTime()) ? '' : raw;
}

/** 统一的失败返回，文案直接给用户看。 */
function fail(message: string): SuiteActionResultDto {
  return { ok: false, changed: false, message, item: null };
}

/** 条目摘要：优先用用户写的用途说明，没有就用标题。 */
function summaryOf(payload: Record<string, unknown>, title: string): string {
  return text(payload['summary']) || title;
}

/** 领域 meta：服药人 / 剂量 / 频次 / 复诊日 / 最近核对。 */
function healthMeta(payload: Record<string, unknown>, stage: string): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: '当前阶段', value: STAGE_LABELS[stage] ?? stage },
  ];
  const person = text(payload['person']);
  if (person) rows.push({ label: '服药人', value: person });
  const dosage = text(payload['dosage']);
  if (dosage) rows.push({ label: '单次剂量', value: dosage });
  const frequency = text(payload['frequency']);
  if (frequency) rows.push({ label: '每日次数', value: frequency });
  const followupAt = text(payload['followupAt']);
  if (followupAt) rows.push({ label: '复诊日', value: followupAt });
  const lastCheck = text(payload['lastDoseCheck']);
  if (lastCheck) rows.push({ label: '最近核对', value: lastCheck });
  return rows;
}

const base = createBoardDomain({
  id: DOMAIN_ID,
  stages: [
    { key: 'recorded', label: '已记录' },
    { key: 'reviewing', label: '复核中' },
    { key: 'active', label: '执行中' },
    { key: 'closed', label: '已结束' },
  ],
  transitions: {
    recorded: ['reviewing'],
    reviewing: ['active', 'recorded'],
    active: ['closed', 'reviewing'],
    closed: [],
  },
  initialStage: 'recorded',
  eventKind: 'health-record',
  describe: (board) => ({
    summary: summaryOf(board.payload, board.title),
    meta: healthMeta(board.payload, board.stage),
  }),
});

/** 取当前用户的条目；不属于本人一律当作不存在。 */
async function findBoard(ctx: SuiteDomainActionContext) {
  const entryId = ctx.input.entryId?.trim() ?? '';
  if (!entryId) return null;
  const found = await ctx.store.suite.boards.find(entryId);
  if (!found || found.userId !== ctx.userId) return null;
  return found;
}

/** 动作完成后回读条目，供前端就地更新。 */
async function itemOf(ctx: SuiteDomainActionContext, id: string) {
  const list = await base.list(ctx as SuiteDomainReadContext);
  return list.find((item) => item.id === id) ?? null;
}

/**
 * record：用药记录建档。
 *
 * 不带 entryId 时新建一条（进入「已记录」），带 entryId 时补齐药名、剂量、频次与服药人。
 * 只保存用户填写的事实，不推断用法；剂量单位必须由用户写明。
 *
 * 幂等：同一条目上重复提交完全相同的字段返回 changed=false。
 */
async function recordAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const payload = ctx.input.payload ?? {};
  const dosage = text(payload['dosage']);
  const frequency = text(payload['frequency']);
  const person = text(payload['person']);

  if (!ctx.input.entryId) {
    const title = text(payload['title']) || text(payload['medName']) || text(ctx.input.note);
    if (!title) return fail('请填写药品名称');
    if (!dosage) return fail('请填写单次剂量，并写清单位（例如 0.5 克、10 毫升、1 片）');
    if (!frequency) return fail('请填写每日次数');
    const created = await base.act({
      ...ctx,
      input: {
        ...ctx.input,
        action: 'create',
        payload: {
          ...payload,
          title,
          dosage,
          frequency,
          person: person || '未填写',
          summary: text(payload['summary']) || `${person || '未填写'} · ${dosage} · ${frequency}`,
        },
      },
    });
    if (!created.ok) return created;
    return {
      ...created,
      message: created.changed ? '用药记录已保存：只登记事实，不生成用法建议' : created.message,
    };
  }

  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');
  if (board.stage === 'closed') return fail('已结束的用药记录不再修改，需要继续用药请另建一条并注明关联');

  const prev = board.payload ?? {};
  const same =
    text(prev['dosage']) === dosage &&
    text(prev['frequency']) === frequency &&
    text(prev['person']) === person &&
    text(prev['summary']) === text(payload['summary']);
  if (same) {
    return {
      ok: true,
      changed: false,
      message: '这条用药记录的字段没有变化',
      item: await itemOf(ctx, board.id),
      data: {},
    };
  }

  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: {
      ...prev,
      ...payload,
      dosage,
      frequency,
      person,
      summary: text(payload['summary']) || summaryOf(prev, board.title),
    },
  });
  if (!updated) return fail('用药记录保存失败，请稍后再试');
  return {
    ok: true,
    changed: true,
    message: '用药记录已更新（仅记录事实，不构成用药建议）',
    item: await itemOf(ctx, board.id),
    data: {},
  };
}

/**
 * dose_check：剂量算术核对。
 *
 * 计算口径只有一条：每日总量 = 单次剂量 × 每日次数；
 * 再与用户自填的每日上限比较，差异用数字返回。
 *
 * 明确不做：不判断是否超量危险、不考虑体重肝肾功能、不给出加量减量停药建议。
 * 幂等：同一组数字重复核对返回 changed=false（不在条目上重复写同一结果）。
 */
async function doseCheckAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const payload = ctx.input.payload ?? {};
  const dose = positive(payload['dose']);
  const times = positive(payload['timesPerDay']);
  const max = positive(payload['dailyMax']);
  const unit = text(payload['unit']) || '单位';

  if (dose === null) return fail('单次剂量需要是大于 0 的数字');
  if (times === null || times > 24) return fail('每日次数需要是 1 到 24 之间的数字');
  if (max === null) return fail('请填写处方或药师说明的每日上限，用于比较');

  // 保留三位小数，避免 0.1 这类小数相乘产生长尾误差。
  const total = Math.round(dose * times * 1000) / 1000;
  const diff = Math.round((total - max) * 1000) / 1000;
  const over = diff > 0;
  const resultText = `${total}${unit}/日（上限 ${max}${unit}，${over ? '超出' : diff < 0 ? '低于' : '持平'} ${Math.abs(diff)}${unit}）`;

  const board = ctx.input.entryId ? await findBoard(ctx) : null;
  if (ctx.input.entryId && !board) return fail('条目不存在或不属于你');

  // 有条目时把最近一次核对结果挂上去，便于复诊时回看；没有条目则只返回结果。
  if (board) {
    const prev = board.payload ?? {};
    if (text(prev['lastDoseCheck']) === resultText) {
      return {
        ok: true,
        changed: false,
        message: `核对结果没有变化：${resultText}`,
        item: await itemOf(ctx, board.id),
        data: { dailyTotal: total, dailyMax: max, diff, over, unit },
      };
    }
    await ctx.store.suite.boards.update(board.id, {
      payload: { ...prev, lastDoseCheck: resultText, lastDoseCheckAt: new Date().toISOString() },
    });
  }

  return {
    ok: true,
    changed: true,
    message: `每日总量 ${resultText}；仅算术核对，请与处方或药师说明核对`,
    item: board ? await itemOf(ctx, board.id) : null,
    data: { dailyTotal: total, dailyMax: max, diff, over, unit },
  };
}

/**
 * followup：随访提醒登记。
 *
 * 记录复诊日期、复查项目与携带材料，并把日期写进条目的 dueAt，
 * 让列表能按临近程度排序。只做提醒，不解释检查结果。
 */
async function followupAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const payload = ctx.input.payload ?? {};
  const at = dayKey(payload['followupAt']);
  if (!at) return fail('复诊日期需要是 YYYY-MM-DD 这样的有效日期');
  const items = text(payload['items']);
  const materials = text(payload['materials']);

  const prev = board.payload ?? {};
  const same =
    text(prev['followupAt']) === at &&
    text(prev['followupItems']) === items &&
    text(prev['followupMaterials']) === materials;
  if (same) {
    return {
      ok: true,
      changed: false,
      message: `复诊提醒已经是 ${at}，无需重复登记`,
      item: await itemOf(ctx, board.id),
      data: { followupAt: at },
    };
  }

  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: {
      ...prev,
      followupAt: at,
      followupItems: items,
      followupMaterials: materials,
    },
    dueAt: new Date(`${at}T00:00:00`),
  });
  if (!updated) return fail('随访提醒登记失败，请稍后再试');

  await ctx.store.suite.events.insert({
    id: ctx.ids.next().id,
    domainId: DOMAIN_ID,
    userId: ctx.userId as string,
    kind: FOLLOWUP_EVENT_KIND,
    subject: `${board.title} · ${at}`,
    amountFen: 0,
    status: 'pending',
    outTradeNo: null,
    payload: { boardId: board.id, followupAt: at, items, materials },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return {
    ok: true,
    changed: true,
    message: `已登记复诊提醒：${at}${items ? ` · ${items}` : ''}`,
    item: await itemOf(ctx, board.id),
    data: { followupAt: at },
  };
}

/**
 * close：结束一条用药记录。
 *
 * 只改状态并保留历史，不删除条目；结束后仍可在复诊时回看用法与核对结果。
 * 幂等：已结束的条目再次提交返回 changed=false。
 */
async function closeAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');
  if (board.stage === 'closed') {
    return {
      ok: true,
      changed: false,
      message: '这条用药记录已经结束',
      item: await itemOf(ctx, board.id),
      data: {},
    };
  }
  const updated = await ctx.store.suite.boards.update(board.id, {
    stage: 'closed',
    payload: { ...(board.payload ?? {}), closedAt: new Date().toISOString() },
  });
  if (!updated) return fail('结束记录失败，请稍后再试');
  return {
    ok: true,
    changed: true,
    message: '已结束这条用药记录，历史保留可回看',
    item: await itemOf(ctx, board.id),
    data: {},
  };
}

export const healthModule: SuiteDomainModule = {
  id: 'health',

  /** 读：基线列表 + 领域 meta（服药人 / 剂量 / 频次 / 复诊日）。 */
  async list(ctx) {
    return base.list(ctx);
  },

  /** 写：领域动作优先，未命中回落到基线的 create / advance / setStage / remove。 */
  async act(ctx) {
    switch (ctx.input.action) {
      case 'record':
        return recordAction(ctx);
      case 'dose_check':
        return doseCheckAction(ctx);
      case 'followup':
        return followupAction(ctx);
      case 'close':
        return closeAction(ctx);
      default:
        return base.act(ctx);
    }
  },

  /**
   * 统计：进行中用药、待复诊、近七天新增记录。
   * 没有对应数据时整项不出现，不用零值占位。
   */
  async stats(ctx) {
    const metrics = await base.stats(ctx);
    const boards = await ctx.store.suite.boards.listByUser(ctx.userId as string, {
      domainId: DOMAIN_ID,
    });

    const active = boards.filter((b) => b.stage === 'active' || b.stage === 'reviewing').length;
    if (active > 0) metrics.push({ label: '进行中', value: `${active} 条`, hint: '复核中与执行中的用药记录' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = boards.filter((b) => {
      const at = text((b.payload ?? {})['followupAt']);
      if (!at || b.stage === 'closed') return false;
      const time = new Date(`${at}T00:00:00`).getTime();
      return Number.isFinite(time) && time >= today.getTime();
    }).length;
    if (upcoming > 0) metrics.push({ label: '待复诊', value: `${upcoming} 条`, hint: '已登记复诊日期、尚未结束的记录' });

    const weekAgo = Date.now() - 7 * DAY_MS;
    const fresh = boards.filter((b) => b.createdAt.getTime() >= weekAgo).length;
    if (fresh > 0) metrics.push({ label: '近七天新增', value: `${fresh} 条` });

    return metrics;
  },
};
