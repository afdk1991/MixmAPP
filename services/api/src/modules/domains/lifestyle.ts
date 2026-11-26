import type { SuiteActionResultDto, SuiteDomainId } from '@mixmapp/contracts';
import {
  createBoardDomain,
  type SuiteDomainActionContext,
  type SuiteDomainModule,
} from '../suite/domain.js';

/**
 * 生活休闲领域模块（活动计划、预约记录、会员权益与完成回填）。
 *
 * 边界：预约与权益都是**本地记录**，模块不向场馆、票务或商家提交订单，
 * 不锁定名额、不支付定金；真实预订与核销仍以官方渠道为准。
 * 票务、场馆余位与会员系统接口均未接入，代码里不伪造这些能力。
 */
const DOMAIN_ID = 'lifestyle' as SuiteDomainId;
/** 一天的毫秒数，用于「临期权益」口径。 */
const DAY_MS = 86_400_000;

const STAGE_LABELS: Record<string, string> = {
  planned: '已计划',
  booked: '已预约',
  ongoing: '进行中',
  done: '已完成',
};

/** 取字符串并去空白。 */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 取日期（YYYY-MM-DD）；非法返回空串。 */
function dayKey(value: unknown): string {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const at = new Date(`${raw}T00:00:00`);
  return Number.isNaN(at.getTime()) ? '' : raw;
}

/** 取正整数（分）；非法返回 null。 */
function positiveInt(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

/** 分 → 元文案。 */
function yuan(fen: number): string {
  return (fen / 100).toFixed(2);
}

/** 统一失败返回。 */
function fail(message: string): SuiteActionResultDto {
  return { ok: false, changed: false, message, item: null };
}

/** 领域 meta：时间 / 地点 / 同行 / 预约确认号 / 权益到期 / 预算。 */
function lifeMeta(payload: Record<string, unknown>, stage: string, amountFen: number): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: '当前阶段', value: STAGE_LABELS[stage] ?? stage },
  ];
  const at = text(payload['planAt']);
  if (at) rows.push({ label: '计划时间', value: at });
  const venue = text(payload['venue']);
  if (venue) rows.push({ label: '地点', value: venue });
  const companions = text(payload['companions']);
  if (companions) rows.push({ label: '同行', value: companions });
  const confirmationNo = text(payload['confirmationNo']);
  if (confirmationNo) rows.push({ label: '确认号', value: confirmationNo });
  const expiresAt = text(payload['expiresAt']);
  if (expiresAt) rows.push({ label: '权益到期', value: expiresAt });
  if (amountFen > 0) rows.push({ label: '预算', value: `${yuan(amountFen)} 元` });
  return rows;
}

/** 摘要：优先用计划说明。 */
function summaryOf(payload: Record<string, unknown>, title: string): string {
  return text(payload['summary']) || title;
}

const base = createBoardDomain({
  id: DOMAIN_ID,
  stages: [
    { key: 'planned', label: '已计划' },
    { key: 'booked', label: '已预约' },
    { key: 'ongoing', label: '进行中' },
    { key: 'done', label: '已完成' },
  ],
  transitions: {
    planned: ['booked'],
    booked: ['ongoing', 'planned'],
    ongoing: ['done', 'booked'],
    done: [],
  },
  initialStage: 'planned',
  eventKind: 'life-item',
  describe: (board) => ({
    summary: summaryOf(board.payload, board.title),
    meta: lifeMeta(board.payload, board.stage, board.amountFen),
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
 * plan：周末 / 出行计划建档。
 *
 * 不带 entryId 时新建（进入「已计划」）；带 entryId 时补充时间、地点与同行人。
 * 计划只是自己的安排，不代表任何预订已经完成。
 */
async function planAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const payload = ctx.input.payload ?? {};
  const planAt = dayKey(payload['planAt']);
  const venue = text(payload['venue']);
  const companions = text(payload['companions']);
  const budgetFen = positiveInt(payload['budgetFen']);

  if (!ctx.input.entryId) {
    const title = text(payload['title']) || text(ctx.input.note);
    if (!title) return fail('请填写计划名称，例如「周六去美术馆」');
    if (!planAt) return fail('计划日期需要是 YYYY-MM-DD 这样的有效日期');
    const created = await base.act({
      ...ctx,
      input: {
        ...ctx.input,
        action: 'create',
        amount: budgetFen ?? 0,
        payload: {
          ...payload,
          title,
          planAt,
          venue,
          companions,
          summary:
            text(payload['summary']) ||
            `${planAt}${venue ? ` · ${venue}` : ''}${companions ? ` · ${companions}` : ''}`,
        },
      },
    });
    if (!created.ok || !created.item) return created;
    await ctx.store.suite.boards.update(created.item.id, {
      dueAt: new Date(`${planAt}T00:00:00`),
      amountFen: budgetFen ?? 0,
    });
    return {
      ...created,
      message: created.changed ? '计划已记下：预约仍需走官方渠道' : created.message,
      item: await itemOf(ctx, created.item.id),
    };
  }

  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');
  if (board.stage === 'done') return fail('已完成的计划不再修改，需要再约请新建一条');

  const prev = board.payload ?? {};
  const same =
    text(prev['planAt']) === planAt &&
    text(prev['venue']) === venue &&
    text(prev['companions']) === companions &&
    (budgetFen ?? 0) === board.amountFen;
  if (same) {
    return {
      ok: true,
      changed: false,
      message: '计划信息没有变化',
      item: await itemOf(ctx, board.id),
      data: {},
    };
  }

  // 只有拿到有效日期时才改 dueAt，避免把已有提醒清空。
  const patch: Parameters<typeof ctx.store.suite.boards.update>[1] = {
    amountFen: budgetFen ?? board.amountFen,
    payload: { ...prev, ...payload, planAt, venue, companions },
  };
  if (planAt) patch.dueAt = new Date(`${planAt}T00:00:00`);
  const updated = await ctx.store.suite.boards.update(board.id, patch);
  if (!updated) return fail('计划保存失败，请稍后再试');
  return {
    ok: true,
    changed: true,
    message: '计划已更新（预约是否成功以官方渠道确认为准）',
    item: await itemOf(ctx, board.id),
    data: {},
  };
}

/**
 * book：预约记录（已计划 → 已预约）。
 *
 * 记录渠道、确认号与退改截止时间，只表示「你登记了一条已完成的预订」，
 * 模块本身不提交订单、不锁名额、不支付定金。
 *
 * 幂等：同一确认号重复提交返回 changed=false。
 */
async function bookAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const payload = ctx.input.payload ?? {};
  const channel = text(payload['channel']);
  if (!channel) return fail('请填写预约渠道，例如场馆公众号、票务平台或电话');
  const confirmationNo = text(payload['confirmationNo']);
  const cancelBefore = dayKey(payload['cancelBefore']);
  const people = positiveInt(payload['people']);

  const prev = board.payload ?? {};
  if (board.stage === 'booked' && text(prev['confirmationNo']) === confirmationNo && text(prev['channel']) === channel) {
    return {
      ok: true,
      changed: false,
      message: '这条预约已经登记过，无需重复记录',
      item: await itemOf(ctx, board.id),
      data: {},
    };
  }
  if (board.stage !== 'planned' && board.stage !== 'booked') {
    return fail(`只有「已计划」或「已预约」的条目可以登记预约，当前是「${STAGE_LABELS[board.stage] ?? board.stage}」`);
  }

  const updated = await ctx.store.suite.boards.update(board.id, {
    stage: 'booked',
    payload: {
      ...prev,
      ...payload,
      channel,
      confirmationNo,
      cancelBefore,
      people: people ?? 0,
      bookedAt: new Date().toISOString(),
    },
  });
  if (!updated) return fail('预约记录保存失败，请稍后再试');
  return {
    ok: true,
    changed: true,
    message: `已登记预约：${channel}${confirmationNo ? ` · 确认号 ${confirmationNo}` : ''}（真实预订以官方渠道为准）`,
    item: await itemOf(ctx, board.id),
    data: {},
  };
}

/**
 * benefit：会员权益登记。
 *
 * 不带 entryId 时新建一条权益卡（进入「已计划」），带 entryId 时补登到期日与限制。
 * 只做到期提醒，不接入会员系统、不核销权益。
 *
 * 幂等：同一权益名称与到期日重复提交返回 changed=false。
 */
async function benefitAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const payload = ctx.input.payload ?? {};
  const name = text(payload['benefitName']) || text(payload['title']);
  const expiresAt = dayKey(payload['expiresAt']);
  if (!name) return fail('请填写权益名称，例如「电影年卡」');
  if (!expiresAt) return fail('权益到期日需要是 YYYY-MM-DD 这样的有效日期');
  const limits = text(payload['limits']);

  if (!ctx.input.entryId) {
    const existing = await ctx.store.suite.boards.listByUser(ctx.userId as string, {
      domainId: DOMAIN_ID,
    });
    const duplicated = existing.find(
      (board) =>
        text((board.payload ?? {})['benefitName']) === name &&
        text((board.payload ?? {})['expiresAt']) === expiresAt,
    );
    if (duplicated) {
      return {
        ok: true,
        changed: false,
        message: `「${name}」的权益已经登记过`,
        item: await itemOf(ctx, duplicated.id),
        data: {},
      };
    }
    const created = await base.act({
      ...ctx,
      input: {
        ...ctx.input,
        action: 'create',
        payload: {
          ...payload,
          title: `权益 · ${name}`,
          benefitName: name,
          expiresAt,
          limits,
          summary: `${expiresAt} 到期${limits ? ` · ${limits}` : ''}`,
        },
      },
    });
    if (!created.ok || !created.item) return created;
    await ctx.store.suite.boards.update(created.item.id, {
      dueAt: new Date(`${expiresAt}T00:00:00`),
    });
    return {
      ...created,
      message: `已登记权益「${name}」，到期日 ${expiresAt}（核销以商家系统为准）`,
      item: await itemOf(ctx, created.item.id),
    };
  }

  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');
  const prev = board.payload ?? {};
  if (text(prev['benefitName']) === name && text(prev['expiresAt']) === expiresAt && text(prev['limits']) === limits) {
    return {
      ok: true,
      changed: false,
      message: '权益信息没有变化',
      item: await itemOf(ctx, board.id),
      data: {},
    };
  }
  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: { ...prev, benefitName: name, expiresAt, limits },
    dueAt: new Date(`${expiresAt}T00:00:00`),
  });
  if (!updated) return fail('权益信息保存失败，请稍后再试');
  return {
    ok: true,
    changed: true,
    message: `权益「${name}」已更新，到期日 ${expiresAt}`,
    item: await itemOf(ctx, board.id),
    data: {},
  };
}

/**
 * finish：完成回填（任意未完成阶段 → 已完成）。
 *
 * 记录完成时间与可选评分 / 感受，用于下次选择参考；不对外发布、不参与公开评分。
 */
async function finishAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');
  if (board.stage === 'done') {
    return {
      ok: true,
      changed: false,
      message: '这条计划已经完成',
      item: await itemOf(ctx, board.id),
      data: {},
    };
  }

  const payload = ctx.input.payload ?? {};
  const rawRating = payload['rating'];
  let rating = 0;
  if (rawRating !== undefined && rawRating !== null) {
    const parsed = Number(rawRating);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) {
      return fail('评分需要是 1 到 5 之间的整数');
    }
    rating = Math.round(parsed);
  }
  const note = text(payload['note']) || text(ctx.input.note);

  const updated = await ctx.store.suite.boards.update(board.id, {
    stage: 'done',
    payload: {
      ...(board.payload ?? {}),
      finishedAt: new Date().toISOString(),
      rating,
      finishNote: note,
    },
  });
  if (!updated) return fail('完成回填失败，请稍后再试');
  return {
    ok: true,
    changed: true,
    message: `已完成${rating > 0 ? ` · 评分 ${rating}/5` : ''}${note ? ` · ${note}` : ''}`,
    item: await itemOf(ctx, board.id),
    data: { rating },
  };
}

export const lifestyleModule: SuiteDomainModule = {
  id: 'lifestyle',

  /** 读：基线列表 + 领域 meta。 */
  async list(ctx) {
    return base.list(ctx);
  },

  /** 写：领域动作优先，未命中回落基线；**没有支付与下单动作**。 */
  async act(ctx) {
    switch (ctx.input.action) {
      case 'plan':
        return planAction(ctx);
      case 'book':
        return bookAction(ctx);
      case 'benefit':
        return benefitAction(ctx);
      case 'finish':
        return finishAction(ctx);
      default:
        return base.act(ctx);
    }
  },

  /** 统计：已计划 / 已预约 / 已完成 / 临期权益。 */
  async stats(ctx) {
    const metrics = await base.stats(ctx);
    const boards = await ctx.store.suite.boards.listByUser(ctx.userId as string, {
      domainId: DOMAIN_ID,
    });

    const booked = boards.filter((b) => b.stage === 'booked').length;
    if (booked > 0) metrics.push({ label: '已预约', value: `${booked} 条`, hint: '本地登记的预约记录' });

    const now = Date.now();
    const soon = boards.filter((b) => {
      const expiresAt = text((b.payload ?? {})['expiresAt']);
      if (!expiresAt || b.stage === 'done') return false;
      const time = new Date(`${expiresAt}T00:00:00`).getTime();
      return Number.isFinite(time) && time >= now && time - now <= 30 * DAY_MS;
    }).length;
    if (soon > 0) metrics.push({ label: '临期权益', value: `${soon} 条`, hint: '30 天内到期，核销以商家系统为准' });

    return metrics;
  },
};
