import type { SuiteActionInput, SuiteActionResultDto, SuiteDomainId, SuiteDomainItemDto } from '@mixmapp/contracts';
import type { IdFactory } from '@mixmapp/ids';
import type { Config } from '../../config.js';
import type { Store } from '../../db/types.js';

/**
 * 领域模块契约。
 *
 * 13 个业务领域各自实现这一份接口，服务端按 domainId 派发。
 * 刻意只给三个动作（读 / 写 / 统计），是为了让「新增一个领域」的成本降到
 * 一个文件 + 一张登记表，不牵动路由、鉴权与存储层。
 *
 * 领域模块不直接碰 HTTP：不认识 Fastify 的 request/reply，也不自己取用户身份，
 * 用户身份由 SuiteService 从鉴权结果注入到 ctx.userId。
 */
export type SuiteDomainReadContext = {
  /** 当前登录用户；公开读时为 null */
  userId: string | null;
  store: Store;
  config: Config;
  ids: IdFactory;
};

export type SuiteDomainActionContext = SuiteDomainReadContext & {
  /** 已通过契约校验的动作入参 */
  input: SuiteActionInput;
};

/** 领域模块实现。 */
export type SuiteDomainModule = {
  id: SuiteDomainId;

  /**
   * 读：该领域当前用户的动态条目。
   *
   * 返回值按领域自解释：办公是任务卡片、财税是账单行、教育是学习条目。
   * 允许返回空数组（该用户还没开始用）。
   */
  list(ctx: SuiteDomainReadContext): Promise<SuiteDomainItemDto[]>;

  /**
   * 写：执行一次领域动作。
   *
   * 约定：
   * - 必须是幂等的：同一个 action + 同一份入参重复提交，第二次返回 changed=false；
   * - 非法状态流转返回 ok=false + message，不要抛异常（错误文案直接给用户看）；
   * - 写操作统一落到通用台账（board / event / progress），保证「我的」页能聚合。
   */
  act(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto>;

  /**
   * 统计：给套件中心与「我的」页展示的领域指标。
   * 没有数据时返回空数组即可，不要返回占位假数。
   */
  stats(ctx: SuiteDomainReadContext): Promise<Array<{ label: string; value: string; hint?: string }>>;
};

/* ---------- 给领域模块用的通用小工具 ---------- */

/** 元组标签：内容包与领域模块共用「标签 → 值」的展示口径。 */
export type SuiteMetaEntry = { label: string; value: string };

/** 分 → 展示金额（保留两位，去掉多余的 .00）。 */
export function formatFen(fen: number): string {
  const yuan = fen / 100;
  return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2);
}

/** 元 → 分。输入非法时返回 0，不抛异常（领域入参可能来自用户输入）。 */
export function yuanToFen(yuan: number | undefined): number {
  if (yuan == null || !Number.isFinite(yuan)) return 0;
  return Math.round(yuan * 100);
}

/**
 * 阶段流转守卫：允许从 from 走到 to 时返回 true。
 * 领域自己定义阶段集合与允许的迁移边，这里只做集合判断。
 */
export function canTransit(
  edges: Record<string, readonly string[]>,
  from: string,
  to: string,
): boolean {
  const allowed = edges[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/**
 * 把通用台账条目转成领域条目。
 * 领域只要写好标题 / 摘要 / 阶段，其余字段由这一份统一口径产出。
 */
export function toDomainItem(input: {
  id: string;
  title: string;
  summary: string;
  stage: string;
  stageLabel: string;
  priority: SuiteDomainItemDto['priority'];
  amountFen?: number;
  meta?: SuiteMetaEntry[];
  payload?: Record<string, unknown>;
  updatedAt: Date;
}): SuiteDomainItemDto {
  return {
    id: input.id,
    title: input.title,
    summary: input.summary,
    stage: input.stage,
    stageLabel: input.stageLabel,
    priority: input.priority,
    amountFen: input.amountFen ?? 0,
    meta: input.meta ?? [],
    payload: input.payload ?? {},
    updatedAt: input.updatedAt.toISOString(),
  };
}

/* ---------- 看板型领域的通用实现 ---------- */

/**
 * 绝大多数领域（任务、工单、账单行、稿件、预约…）的业务形态都是
 * 「一条记录 + 一个阶段状态机 + 若干动作」。这里把这段共性抽成一个工厂，
 * 领域只需要声明阶段表、允许的迁移边和文案口径，就能拿到一整套可用实现：
 *
 * - list：读该用户在此领域的看板条目，按更新时间倒序；
 * - act：create / advance / setStage / remove 四个动作，全部幂等；
 * - stats：各阶段条目数与完成率。
 *
 * 领域若有额外语义（判分、计息、预约冲突校验），在工厂返回的对象上再包一层即可。
 */
export type BoardDomainConfig = {
  id: SuiteDomainId;
  /** 阶段定义，顺序即流程顺序。 */
  stages: readonly { key: string; label: string }[];
  /** 允许的阶段迁移：from → [to…]。没写的阶段不允许迁移。 */
  transitions: Record<string, readonly string[]>;
  /** 新建条目的初始阶段，必须是 stages 里的一项。 */
  initialStage: string;
  /** 台账事件类型（写进 suite_events.kind）。 */
  eventKind: string;
  /** 条目摘要与元信息口径。 */
  describe: (board: {
    title: string;
    stage: string;
    amountFen: number;
    payload: Record<string, unknown>;
    dueAt: Date | null;
    createdAt: Date;
  }) => { summary: string; meta: SuiteMetaEntry[] };
  /** 终态阶段（计入「已完成」）。默认取 stages 的最后一项。 */
  doneStage?: string;
};

export function createBoardDomain(config: BoardDomainConfig): SuiteDomainModule {
  const labelOf = (stage: string): string =>
    config.stages.find((s) => s.key === stage)?.label ?? stage;
  const doneStage = config.doneStage ?? config.stages[config.stages.length - 1]?.key ?? 'done';

  return {
    id: config.id,

    async list(ctx: SuiteDomainReadContext): Promise<SuiteDomainItemDto[]> {
      const boards = await ctx.store.suite.boards.listByUser(ctx.userId as string, {
        domainId: config.id,
      });
      return boards.map((board) => {
        const described = config.describe(board);
        return toDomainItem({
          id: board.id,
          title: board.title,
          summary: described.summary,
          stage: board.stage,
          stageLabel: labelOf(board.stage),
          priority: board.priority,
          amountFen: board.amountFen,
          meta: described.meta,
          payload: board.payload,
          updatedAt: board.updatedAt,
        });
      });
    },

    async act(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
      const userId = ctx.userId as string;
      const input = ctx.input;
      const now = new Date();

      if (input.action === 'create') {
        const title = (input.note ?? '').trim() || String(input.payload?.['title'] ?? '').trim();
        if (!title) {
          return { ok: false, changed: false, message: '请填写条目标题', item: null };
        }
        // 幂等：同领域内标题重复且仍在进行中，返回既有条目。
        const existing = await ctx.store.suite.boards.listByUser(userId, { domainId: config.id });
        const duplicated = existing.find(
          (b) => b.title === title && b.stage !== doneStage && b.stage !== 'cancelled',
        );
        if (duplicated) {
          const described = config.describe(duplicated);
          return {
            ok: true,
            changed: false,
            message: '这条记录已经在列表里了',
            item: toDomainItem({
              id: duplicated.id,
              title: duplicated.title,
              summary: described.summary,
              stage: duplicated.stage,
              stageLabel: labelOf(duplicated.stage),
              priority: duplicated.priority,
              amountFen: duplicated.amountFen,
              meta: described.meta,
              payload: duplicated.payload,
              updatedAt: duplicated.updatedAt,
            }),
          };
        }
        const amountFen =
          typeof input.payload?.['amountFen'] === 'number'
            ? Math.max(0, Math.round(input.payload['amountFen'] as number))
            : 0;
        const board = await ctx.store.suite.boards.insert({
          id: ctx.ids.next().id,
          domainId: config.id,
          userId,
          title,
          stage: config.initialStage,
          priority: 'normal',
          amountFen,
          payload: { ...(input.payload ?? {}) },
          dueAt: input.at ? new Date(input.at) : null,
          createdAt: now,
          updatedAt: now,
        });
        // 同步落一条台账事件，供「我的」页聚合与对账。
        await ctx.store.suite.events.insert({
          id: ctx.ids.next().id,
          domainId: config.id,
          userId,
          kind: config.eventKind,
          subject: title,
          amountFen,
          status: 'pending',
          outTradeNo: null,
          payload: { boardId: board.id, stage: board.stage },
          createdAt: now,
          updatedAt: now,
        });
        const described = config.describe(board);
        return {
          ok: true,
          changed: true,
          message: '已添加',
          item: toDomainItem({
            id: board.id,
            title: board.title,
            summary: described.summary,
            stage: board.stage,
            stageLabel: labelOf(board.stage),
            priority: board.priority,
            amountFen: board.amountFen,
            meta: described.meta,
            payload: board.payload,
            updatedAt: board.updatedAt,
          }),
        };
      }

      const entryId = input.entryId ?? '';
      const current = entryId ? await ctx.store.suite.boards.find(entryId) : null;
      if (!current || current.userId !== userId) {
        return { ok: false, changed: false, message: '条目不存在或不属于你', item: null };
      }

      if (input.action === 'remove') {
        await ctx.store.suite.boards.remove(current.id, userId);
        return { ok: true, changed: true, message: '已删除', item: null };
      }

      if (input.action === 'advance' || input.action === 'setStage') {
        const target =
          input.action === 'setStage'
            ? String(input.payload?.['stage'] ?? '')
            : (config.transitions[current.stage]?.[0] ?? '');
        if (!target) {
          return {
            ok: false,
            changed: false,
            message: `当前阶段「${labelOf(current.stage)}」没有可推进的下一步`,
            item: null,
          };
        }
        if (target === current.stage) {
          return { ok: true, changed: false, message: '已经在该阶段', item: null };
        }
        if (!canTransit(config.transitions, current.stage, target)) {
          return {
            ok: false,
            changed: false,
            message: `不能从「${labelOf(current.stage)}」直接到「${labelOf(target)}」`,
            item: null,
          };
        }
        const updated = await ctx.store.suite.boards.update(current.id, {
          stage: target,
        });
        if (!updated) {
          return { ok: false, changed: false, message: '更新失败，请稍后再试', item: null };
        }
        const described = config.describe(updated);
        return {
          ok: true,
          changed: true,
          message: `已推进到「${labelOf(target)}」`,
          item: toDomainItem({
            id: updated.id,
            title: updated.title,
            summary: described.summary,
            stage: updated.stage,
            stageLabel: labelOf(updated.stage),
            priority: updated.priority,
            amountFen: updated.amountFen,
            meta: described.meta,
            payload: updated.payload,
            updatedAt: updated.updatedAt,
          }),
        };
      }

      return { ok: false, changed: false, message: `不支持的动作：${input.action}`, item: null };
    },

    async stats(ctx: SuiteDomainReadContext) {
      const boards = await ctx.store.suite.boards.listByUser(ctx.userId as string, {
        domainId: config.id,
      });
      const total = boards.length;
      const done = boards.filter((b) => b.stage === doneStage).length;
      const metrics: Array<{ label: string; value: string; hint?: string }> = [
        { label: '进行中', value: String(total - done) },
        { label: '已完成', value: String(done) },
      ];
      if (total > 0) {
        metrics.push({
          label: '完成率',
          value: `${Math.round((done / total) * 100)}%`,
          hint: '已完成条目占全部条目的比例',
        });
      }
      return metrics;
    },
  };
}
