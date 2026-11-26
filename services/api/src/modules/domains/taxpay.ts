import type { SuiteActionResultDto, SuiteDomainId } from '@mixmapp/contracts';
import {
  createBoardDomain,
  type SuiteDomainActionContext,
  type SuiteDomainModule,
} from '../suite/domain.js';

/**
 * 财税支付领域模块（发票登记、税额试算与对账记录）。
 *
 * 边界（务必遵守）：
 * - 只做登记、算术试算与内部对账状态，**不提供纳税申报、税额核定与代扣代缴**；
 * - **不发起任何支付、转账或订单提交**，模块内不存在 pay / checkout 类动作；
 * - 「已核验」指内部核对记录，发票真伪仍以官方查验平台结论为准；
 * - 发票查验、银行流水、支付账单与申报通道均未接入，代码里不伪造这些能力。
 */
const DOMAIN_ID = 'taxpay' as SuiteDomainId;
/** 一天的毫秒数。 */
const DAY_MS = 86_400_000;

const STAGE_LABELS: Record<string, string> = {
  draft: '待录入',
  recorded: '已登记',
  verified: '已核验',
  reconciled: '已对账',
};

/** 取字符串并去空白。 */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 取正整数（分）；非法返回 null。 */
function positiveInt(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

/** 取税率（0..1）；非法返回 null。 */
function rateOf(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;
  return parsed;
}

/** 分 → 元文案（两位小数）。 */
function yuan(fen: number): string {
  return (fen / 100).toFixed(2);
}

/** 统一的失败返回。 */
function fail(message: string): SuiteActionResultDto {
  return { ok: false, changed: false, message, item: null };
}

/** 领域 meta：发票号 / 税率 / 开票方 / 票面金额 / 核验与对账时间。 */
function taxMeta(payload: Record<string, unknown>, stage: string, amountFen: number): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: '当前阶段', value: STAGE_LABELS[stage] ?? stage },
  ];
  const invoiceNo = text(payload['invoiceNo']);
  if (invoiceNo) rows.push({ label: '发票号', value: invoiceNo });
  const counterparty = text(payload['counterparty']);
  if (counterparty) rows.push({ label: '开票方', value: counterparty });
  const rate = rateOf(payload['rate']);
  if (rate !== null) rows.push({ label: '税率', value: `${Math.round(rate * 10000) / 100}%` });
  if (amountFen > 0) rows.push({ label: '价税合计', value: `${yuan(amountFen)} 元` });
  const verifiedAt = text(payload['verifiedAt']);
  if (verifiedAt) rows.push({ label: '内部核验', value: verifiedAt.slice(0, 10) });
  const reconciledAt = text(payload['reconciledAt']);
  if (reconciledAt) rows.push({ label: '对账时间', value: reconciledAt.slice(0, 10) });
  return rows;
}

/** 摘要：优先用事项说明。 */
function summaryOf(payload: Record<string, unknown>, title: string): string {
  return text(payload['summary']) || title;
}

const base = createBoardDomain({
  id: DOMAIN_ID,
  stages: [
    { key: 'draft', label: '待录入' },
    { key: 'recorded', label: '已登记' },
    { key: 'verified', label: '已核验' },
    { key: 'reconciled', label: '已对账' },
  ],
  transitions: {
    draft: ['recorded'],
    recorded: ['verified', 'draft'],
    verified: ['reconciled', 'recorded'],
    reconciled: [],
  },
  initialStage: 'draft',
  eventKind: 'tax-item',
  describe: (board) => ({
    summary: summaryOf(board.payload, board.title),
    meta: taxMeta(board.payload, board.stage, board.amountFen),
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
 * invoice：发票登记。
 *
 * 不带 entryId 时新建票据（直接进入「已登记」），带 entryId 时修改票面信息，
 * 但只允许在「待录入 / 已登记」阶段改——已核验或已对账的票不允许再改金额。
 *
 * 幂等：同一发票号已存在时返回既有条目，不重复建单。
 */
async function invoiceAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const payload = ctx.input.payload ?? {};
  const invoiceNo = text(payload['invoiceNo']);
  const amountFen = positiveInt(payload['amountFen']);
  const rate = rateOf(payload['rate']);
  const counterparty = text(payload['counterparty']);
  const matter = text(payload['matter']);

  if (!ctx.input.entryId) {
    if (!invoiceNo) return fail('请填写发票号码');
    if (amountFen === null) return fail('价税合计需要是大于 0 的金额');
    if (rate === null) return fail('税率需要是 0 到 1 之间的小数，例如 0.13');

    // 幂等：先按发票号查重，重复登记直接返回既有条目。
    const existing = await ctx.store.suite.boards.listByUser(ctx.userId as string, {
      domainId: DOMAIN_ID,
    });
    const duplicated = existing.find((board) => text((board.payload ?? {})['invoiceNo']) === invoiceNo);
    if (duplicated) {
      return {
        ok: true,
        changed: false,
        message: `发票 ${invoiceNo} 已经登记过，无需重复录入`,
        item: await itemOf(ctx, duplicated.id),
        data: {},
      };
    }

    const title = `发票 ${invoiceNo}`;
    const created = await base.act({
      ...ctx,
      input: {
        ...ctx.input,
        action: 'create',
        amount: amountFen,
        payload: {
          ...payload,
          title,
          invoiceNo,
          rate,
          counterparty,
          matter,
          summary:
            text(payload['summary']) ||
            `${counterparty || '开票方未填'} · ${yuan(amountFen)} 元${matter ? ` · ${matter}` : ''}`,
        },
      },
    });
    if (!created.ok || !created.item) return created;
    // 登记即进入「已登记」，避免新票停在「待录入」造成对账口径混乱。
    await ctx.store.suite.boards.update(created.item.id, { stage: 'recorded', amountFen });
    return {
      ...created,
      message: `发票 ${invoiceNo} 已登记：${yuan(amountFen)} 元（本模块不发起支付与申报）`,
      item: await itemOf(ctx, created.item.id),
    };
  }

  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');
  if (board.stage === 'verified' || board.stage === 'reconciled') {
    return fail(`「${STAGE_LABELS[board.stage]}」的票据不再修改票面信息，如需更正请新增冲销记录`);
  }

  const prev = board.payload ?? {};
  const same =
    text(prev['invoiceNo']) === invoiceNo &&
    rateOf(prev['rate']) === rate &&
    board.amountFen === amountFen &&
    text(prev['counterparty']) === counterparty &&
    text(prev['matter']) === matter;
  if (same) {
    return {
      ok: true,
      changed: false,
      message: '票面信息没有变化',
      item: await itemOf(ctx, board.id),
      data: {},
    };
  }

  const updated = await ctx.store.suite.boards.update(board.id, {
    amountFen: amountFen ?? board.amountFen,
    payload: { ...prev, ...payload, invoiceNo, rate, counterparty, matter },
  });
  if (!updated) return fail('票面信息保存失败，请稍后再试');
  return {
    ok: true,
    changed: true,
    message: '票面信息已更新（真伪仍以官方查验平台结论为准）',
    item: await itemOf(ctx, board.id),
    data: {},
  };
}

/**
 * split_tax：价税分离试算。
 *
 * 纯算术：不含税 = 含税 ÷（1 + 税率），税额 = 含税 - 不含税。
 * 不判断适用税率、不考虑进项抵扣与优惠政策，不生成申报数据。
 * 该动作不写库，重复调用结果一致。
 */
async function splitTaxAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const payload = ctx.input.payload ?? {};
  const grossFen = positiveInt(payload['amountFen'] ?? payload['grossFen']);
  const rate = rateOf(payload['rate']);
  if (grossFen === null) return fail('含税金额需要是大于 0 的金额');
  if (rate === null) return fail('税率需要是 0 到 1 之间的小数，例如 0.13');

  const netFen = Math.round((grossFen * 100) / (100 + rate * 100));
  const taxFen = grossFen - netFen;
  return {
    ok: true,
    changed: true,
    message: `不含税 ${yuan(netFen)} 元，税额 ${yuan(taxFen)} 元；仅为算术试算，不构成税务结论`,
    item: null,
    data: { grossFen, netFen, taxFen, rate },
  };
}

/**
 * verify：内部核验登记（已登记 → 已核验）。
 *
 * 只记录「内部核对过票面与凭证」，不代表官方查验通过；
 * 发票真伪请到官方查验平台确认后，再把结论写进备注。
 */
async function verifyAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');
  if (board.stage === 'verified' || board.stage === 'reconciled') {
    return {
      ok: true,
      changed: false,
      message: '这张票据已经登记过核验',
      item: await itemOf(ctx, board.id),
      data: {},
    };
  }
  if (board.stage !== 'recorded') {
    return fail(`只有「已登记」的票据可以做核验，当前是「${STAGE_LABELS[board.stage] ?? board.stage}」`);
  }
  const now = new Date().toISOString();
  const updated = await ctx.store.suite.boards.update(board.id, {
    stage: 'verified',
    payload: { ...(board.payload ?? {}), verifiedAt: now },
  });
  if (!updated) return fail('核验登记失败，请稍后再试');
  return {
    ok: true,
    changed: true,
    message: '已登记内部核验（发票真伪以官方查验平台结论为准）',
    item: await itemOf(ctx, board.id),
    data: {},
  };
}

/**
 * reconcile：内部对账登记（已核验 → 已对账）。
 *
 * 只表示内部核对完成，**不代表资金已经收付**；真实收付以银行流水或渠道回单为准。
 */
async function reconcileAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');
  if (board.stage === 'reconciled') {
    return {
      ok: true,
      changed: false,
      message: '这张票据已经对账',
      item: await itemOf(ctx, board.id),
      data: {},
    };
  }
  if (board.stage !== 'verified') {
    return fail(`只有「已核验」的票据可以登记对账，当前是「${STAGE_LABELS[board.stage] ?? board.stage}」`);
  }
  const now = new Date().toISOString();
  const updated = await ctx.store.suite.boards.update(board.id, {
    stage: 'reconciled',
    payload: { ...(board.payload ?? {}), reconciledAt: now },
  });
  if (!updated) return fail('对账登记失败，请稍后再试');
  return {
    ok: true,
    changed: true,
    message: '已登记内部对账（不代表资金已收付，以银行流水与渠道回单为准）',
    item: await itemOf(ctx, board.id),
    data: {},
  };
}

export const taxpayModule: SuiteDomainModule = {
  id: 'taxpay',

  /** 读：基线列表 + 领域 meta。 */
  async list(ctx) {
    return base.list(ctx);
  },

  /** 写：领域动作优先；**没有支付动作**，未命中回落基线。 */
  async act(ctx) {
    switch (ctx.input.action) {
      case 'invoice':
        return invoiceAction(ctx);
      case 'split_tax':
        return splitTaxAction(ctx);
      case 'verify':
        return verifyAction(ctx);
      case 'reconcile':
        return reconcileAction(ctx);
      default:
        return base.act(ctx);
    }
  },

  /** 统计：待录入 / 已登记 / 已核验 / 已对账 / 票面合计 / 近七天对账。 */
  async stats(ctx) {
    const metrics = await base.stats(ctx);
    const boards = await ctx.store.suite.boards.listByUser(ctx.userId as string, {
      domainId: DOMAIN_ID,
    });

    const recorded = boards.filter((b) => b.stage === 'recorded').length;
    if (recorded > 0) metrics.push({ label: '待核验', value: `${recorded} 条` });

    const verified = boards.filter((b) => b.stage === 'verified').length;
    if (verified > 0) metrics.push({ label: '待对账', value: `${verified} 条` });

    const totalFen = boards.reduce((sum, b) => sum + Math.max(0, b.amountFen), 0);
    if (totalFen > 0) {
      metrics.push({ label: '票面合计', value: `${yuan(totalFen)} 元`, hint: '已登记票据价税合计，不代表已收付' });
    }

    const weekAgo = Date.now() - 7 * DAY_MS;
    const reconciledThisWeek = boards.filter(
      (b) => b.stage === 'reconciled' && b.updatedAt.getTime() >= weekAgo,
    ).length;
    if (reconciledThisWeek > 0) metrics.push({ label: '近七天对账', value: `${reconciledThisWeek} 条` });

    return metrics;
  },
};
