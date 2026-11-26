import type {
  SuiteActionInput,
  SuiteActionResultDto,
  SuiteBoardDto,
  SuiteDomainId,
  SuiteDomainItemDto,
  SuiteDomainMetaDto,
  SuiteDomainStatsDto,
  SuiteEventDto,
  SuiteInteractionDto,
  SuiteInteractionInput,
  SuiteInteractionListDto,
  SuiteProgressDto,
  SuiteProgressInput,
} from '@mixmapp/contracts';
import { IdFactory } from '@mixmapp/ids';
import type { Config } from '../../config.js';
import type { Store } from '../../db/types.js';
import { AppError } from '../../lib/errors.js';
import type {
  SuiteDomainModule,
  SuiteDomainReadContext,
} from './domain.js';
import { findSuiteDomain, listSuiteDomains } from './registry.js';

export type SuiteServiceDeps = {
  config: Config;
  store: Store;
  /** 领域模块表：id → 实现。缺失的领域在派发时按「未接入」处理。 */
  modules: Map<SuiteDomainId, SuiteDomainModule>;
  ids?: IdFactory;
};

/**
 * 业务套件服务。
 *
 * 职责边界：
 * - 通用台账（交互 / 进度 / 看板 / 事件）的读写与口径统一在这里；
 * - 领域特有逻辑一律下沉到领域模块（SuiteDomainModule），本服务只做派发与兜底；
 * - 领域不存在时一律 404，不静默返回空数组，避免前端把「没接」当成「没数据」。
 */
export class SuiteService {
  private readonly config: Config;
  private readonly store: Store;
  private readonly modules: Map<SuiteDomainId, SuiteDomainModule>;
  private readonly ids: IdFactory;

  constructor(deps: SuiteServiceDeps) {
    this.config = deps.config;
    this.store = deps.store;
    this.modules = deps.modules;
    this.ids = deps.ids ?? new IdFactory({ workerId: deps.config.ids.workerId });
  }

  /* ---------------- 领域目录 ---------------- */

  /** 全量领域元信息（公开读）。 */
  listDomains(): SuiteDomainMetaDto[] {
    return listSuiteDomains();
  }

  /** 单个领域元信息；未登记的领域抛 404。 */
  domainMeta(domainId: string): SuiteDomainMetaDto {
    const meta = findSuiteDomain(domainId);
    if (!meta) throw AppError.notFound(`未知的业务领域：${domainId}`);
    return { ...meta, capabilities: [...meta.capabilities] };
  }

  /* ---------------- 领域动态能力 ---------------- */

  /** 取领域模块；未登记或未接入实现都按 404 处理。 */
  private module(domainId: string): SuiteDomainModule {
    this.domainMeta(domainId);
    const mod = this.modules.get(domainId as SuiteDomainId);
    if (!mod) throw AppError.notFound(`该领域暂未接入动态能力：${domainId}`);
    return mod;
  }

  private readCtx(userId: string | null): SuiteDomainReadContext {
    return { userId, store: this.store, config: this.config, ids: this.ids };
  }

  /** 读某领域的动态条目。未登录时返回空数组（个人数据必须登录）。 */
  async domainItems(domainId: string, userId: string | null): Promise<SuiteDomainItemDto[]> {
    if (!userId) return [];
    const mod = this.module(domainId);
    const items = await mod.list(this.readCtx(userId));
    return items.map((item) => ({ ...item, meta: [...item.meta] }));
  }

  /** 执行一次领域动作。 */
  async domainAct(
    domainId: string,
    input: SuiteActionInput,
    userId: string | null,
  ): Promise<SuiteActionResultDto> {
    if (!userId) throw AppError.unauthorized();
    const mod = this.module(domainId);
    return mod.act({ ...this.readCtx(userId), input });
  }

  /** 领域统计：通用台账计数 + 领域自定义指标。 */
  async domainStats(domainId: string, userId: string | null): Promise<SuiteDomainStatsDto> {
    this.domainMeta(domainId);
    const empty = { boards: 0, events: 0, progress: 0, interactions: 0 };
    if (!userId) {
      return { domainId: domainId as SuiteDomainId, counts: empty, metrics: [] };
    }
    const [boards, events, progress, interactions] = await Promise.all([
      this.store.suite.boards.countByUser(userId, { domainId }),
      this.store.suite.events.countByUser(userId, { domainId }),
      this.store.suite.progress.countByUser(userId, { domainId }),
      this.countUserInteractions(userId, domainId),
    ]);
    const mod = this.modules.get(domainId as SuiteDomainId);
    const metrics = mod ? await mod.stats(this.readCtx(userId)) : [];
    return {
      domainId: domainId as SuiteDomainId,
      counts: { boards, events, progress, interactions },
      metrics,
    };
  }

  /** 该用户在某领域的交互总数（四类合计）。 */
  private async countUserInteractions(userId: string, domainId: string): Promise<number> {
    return this.store.suite.interactions.countByUser(userId, domainId);
  }

  /* ---------------- 交互（评论 / 点赞 / 收藏 / 评分） ---------------- */

  /** 读某条目的交互：列表 + 四类计数 + 当前用户交互态，一次给全。 */
  async listInteractions(
    domainId: string,
    entryId: string,
    userId: string | null,
    opts?: { kind?: SuiteInteractionInput['kind']; limit?: number; offset?: number },
  ): Promise<SuiteInteractionListDto> {
    this.domainMeta(domainId);
    const [rows, counts] = await Promise.all([
      this.store.suite.interactions.list(domainId, entryId, opts),
      this.store.suite.interactions.countByKind(domainId, entryId),
    ]);
    const mine = { liked: false, saved: false, rating: null as number | null };
    if (userId) {
      const [liked, saved, rating] = await Promise.all([
        this.store.suite.interactions.findByUser(userId, domainId, entryId, 'like'),
        this.store.suite.interactions.findByUser(userId, domainId, entryId, 'save'),
        this.store.suite.interactions.findByUser(userId, domainId, entryId, 'rating'),
      ]);
      mine.liked = Boolean(liked);
      mine.saved = Boolean(saved);
      mine.rating = rating?.rating ?? null;
    }
    const items = await Promise.all(
      rows.map(async (row) => {
        const accountNo = row.userId
          ? ((await this.store.users.findById(row.userId))?.accountNo ?? null)
          : null;
        return {
          id: row.id,
          domainId: row.domainId as SuiteDomainId,
          entryId: row.entryId,
          kind: row.kind,
          body: row.body,
          rating: row.rating,
          parentId: row.parentId,
          accountNo,
          createdAt: row.createdAt.toISOString(),
        } satisfies SuiteInteractionDto;
      }),
    );
    return { items, total: items.length, counts, mine };
  }

  /**
   * 写一条交互。
   * - comment：新增一条（重复提交即多条评论，调用方自行防抖）。
   * - rating：同一用户对同一条目只保留一条评分，重复提交即更新。
   * - like / save：请走 toggleInteraction，这里按「已存在则不再新增」处理。
   */
  async addInteraction(input: SuiteInteractionInput, userId: string): Promise<SuiteInteractionDto> {
    this.domainMeta(input.domainId);
    if (!input.body?.trim() && input.kind === 'comment') {
      throw AppError.validation('评论内容不能为空');
    }
    const now = new Date();
    if (input.kind === 'rating') {
      const existing = await this.store.suite.interactions.findByUser(
        userId,
        input.domainId,
        input.entryId,
        'rating',
      );
      if (existing) {
        const updated = await this.updateInteraction(existing.id, userId, {
          body: input.body ?? existing.body,
          rating: input.rating ?? existing.rating ?? 5,
        });
        return updated;
      }
    }
    const record = {
      id: this.ids.next().id,
      domainId: input.domainId,
      entryId: input.entryId,
      userId,
      kind: input.kind,
      body: (input.body ?? '').trim(),
      rating: input.kind === 'rating' ? (input.rating ?? 5) : null,
      parentId: input.parentId ?? null,
      status: 'visible' as const,
      createdAt: now,
      updatedAt: now,
    };
    const inserted = await this.store.suite.interactions.insert(record);
    return this.toInteractionDto(inserted);
  }

  /** 点赞 / 收藏切换：已存在则取消，不存在则新增。返回切换后的当前态。 */
  async toggleInteraction(
    domainId: string,
    entryId: string,
    kind: 'like' | 'save',
    userId: string,
  ): Promise<{ active: boolean; counts: SuiteInteractionListDto['counts'] }> {
    this.domainMeta(domainId);
    const existing = await this.store.suite.interactions.findByUser(userId, domainId, entryId, kind);
    if (existing) {
      await this.store.suite.interactions.remove(existing.id, userId);
    } else {
      const now = new Date();
      await this.store.suite.interactions.insert({
        id: this.ids.next().id,
        domainId,
        entryId,
        userId,
        kind,
        body: '',
        rating: null,
        parentId: null,
        status: 'visible',
        createdAt: now,
        updatedAt: now,
      });
    }
    const counts = await this.store.suite.interactions.countByKind(domainId, entryId);
    return { active: !existing, counts };
  }

  /** 更新自己的交互（评分改分、评论编辑）。 */
  async updateInteraction(
    id: string,
    userId: string,
    patch: { body?: string; rating?: number },
  ): Promise<SuiteInteractionDto> {
    const found = await this.store.suite.interactions.findById(id);
    if (!found || found.userId !== userId) throw AppError.notFound('这条记录不存在或不属于你');
    const updated = await this.store.suite.interactions.update(id, {
      ...(patch.body !== undefined ? { body: patch.body.trim() } : {}),
      ...(patch.rating !== undefined ? { rating: patch.rating } : {}),
      updatedAt: new Date(),
    });
    if (!updated) throw AppError.notFound('这条记录不存在或不属于你');
    return this.toInteractionDto(updated);
  }

  /** 删除自己的交互。 */
  async removeInteraction(id: string, userId: string): Promise<boolean> {
    return this.store.suite.interactions.remove(id, userId);
  }

  private async toInteractionDto(row: {
    id: string;
    domainId: string;
    entryId: string;
    kind: SuiteInteractionListDto['items'][number]['kind'];
    body: string;
    rating: number | null;
    parentId: string | null;
    userId: string | null;
    createdAt: Date;
  }): Promise<SuiteInteractionDto> {
    const accountNo = row.userId
      ? ((await this.store.users.findById(row.userId))?.accountNo ?? null)
      : null;
    return {
      id: row.id,
      domainId: row.domainId as SuiteDomainId,
      entryId: row.entryId,
      kind: row.kind,
      body: row.body,
      rating: row.rating,
      parentId: row.parentId,
      accountNo,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /* ---------------- 进度 ---------------- */

  /** 写入进度：同一 (user, domain, entry) 覆盖。 */
  async upsertProgress(input: SuiteProgressInput, userId: string): Promise<SuiteProgressDto> {
    this.domainMeta(input.domainId);
    const now = new Date();
    const existing = await this.store.suite.progress.find(userId, input.domainId, input.entryId);
    const done = input.status === 'done';
    const record = {
      id: existing?.id ?? this.ids.next().id,
      userId,
      domainId: input.domainId,
      entryId: input.entryId,
      status: input.status,
      value: input.value ?? (done ? 100 : existing?.value ?? 0),
      notes: input.notes ?? existing?.notes ?? '',
      dueAt: input.dueAt ? new Date(input.dueAt) : (existing?.dueAt ?? null),
      completedAt: done ? (existing?.completedAt ?? now) : null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const saved = await this.store.suite.progress.upsert(record);
    return {
      id: saved.id,
      domainId: saved.domainId as SuiteDomainId,
      entryId: saved.entryId,
      status: saved.status,
      value: saved.value,
      notes: saved.notes,
      dueAt: saved.dueAt ? saved.dueAt.toISOString() : null,
      completedAt: saved.completedAt ? saved.completedAt.toISOString() : null,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  /** 读某用户的进度列表。 */
  async listProgress(
    userId: string,
    opts?: { domainId?: string; status?: SuiteProgressInput['status'] },
  ): Promise<SuiteProgressDto[]> {
    const rows = await this.store.suite.progress.listByUser(userId, opts);
    return rows.map((row) => ({
      id: row.id,
      domainId: row.domainId as SuiteDomainId,
      entryId: row.entryId,
      status: row.status,
      value: row.value,
      notes: row.notes,
      dueAt: row.dueAt ? row.dueAt.toISOString() : null,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /* ---------------- 看板 ---------------- */

  /** 看板条目 → DTO。 */
  private toBoardDto(row: {
    id: string;
    domainId: string;
    title: string;
    stage: string;
    priority: SuiteBoardDto['priority'];
    amountFen: number;
    payload: Record<string, unknown>;
    dueAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): SuiteBoardDto {
    return {
      id: row.id,
      domainId: row.domainId as SuiteDomainId,
      title: row.title,
      stage: row.stage,
      priority: row.priority,
      amountFen: row.amountFen,
      payload: row.payload ?? {},
      dueAt: row.dueAt ? row.dueAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** 新建看板条目。 */
  async createBoard(
    input: {
      domainId: string;
      title: string;
      stage: string;
      priority?: SuiteBoardDto['priority'];
      amountFen?: number;
      dueAt?: string;
      payload?: Record<string, unknown>;
    },
    userId: string,
  ): Promise<SuiteBoardDto> {
    this.domainMeta(input.domainId);
    const now = new Date();
    const record = {
      id: this.ids.next().id,
      domainId: input.domainId,
      userId,
      title: input.title,
      stage: input.stage,
      priority: input.priority ?? ('normal' as const),
      amountFen: input.amountFen ?? 0,
      payload: input.payload ?? {},
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      createdAt: now,
      updatedAt: now,
    };
    return this.toBoardDto(await this.store.suite.boards.insert(record));
  }

  /** 读看板列表。 */
  async listBoards(
    userId: string,
    opts?: { domainId?: string; stage?: string; limit?: number },
  ): Promise<SuiteBoardDto[]> {
    const rows = await this.store.suite.boards.listByUser(userId, opts);
    return rows.map((row) => this.toBoardDto(row));
  }

  /** 更新看板条目；非本人条目返回 null。 */
  async updateBoard(
    id: string,
    userId: string,
    patch: {
      title?: string;
      stage?: string;
      priority?: SuiteBoardDto['priority'];
      amountFen?: number;
      dueAt?: string | null;
      payload?: Record<string, unknown>;
    },
  ): Promise<SuiteBoardDto | null> {
    const existing = await this.store.suite.boards.find(id);
    if (!existing || existing.userId !== userId) return null;
    const updated = await this.store.suite.boards.update(id, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.amountFen !== undefined ? { amountFen: patch.amountFen } : {}),
      ...(patch.payload !== undefined ? { payload: patch.payload } : {}),
      ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt ? new Date(patch.dueAt) : null } : {}),
    });
    return updated ? this.toBoardDto(updated) : null;
  }

  /** 删除看板条目；非本人条目返回 false。 */
  async removeBoard(id: string, userId: string): Promise<boolean> {
    return this.store.suite.boards.remove(id, userId);
  }

  /* ---------------- 台账事件 ---------------- */

  /** 新建台账事件。 */
  async createEvent(
    input: {
      domainId: string;
      kind: string;
      subject: string;
      amountFen?: number;
      status?: SuiteEventDto['status'];
      outTradeNo?: string;
      payload?: Record<string, unknown>;
    },
    userId: string,
  ): Promise<SuiteEventDto> {
    this.domainMeta(input.domainId);
    const now = new Date();
    const record = {
      id: this.ids.next().id,
      domainId: input.domainId,
      userId,
      kind: input.kind,
      subject: input.subject,
      amountFen: input.amountFen ?? 0,
      status: input.status ?? ('pending' as const),
      outTradeNo: input.outTradeNo ?? null,
      payload: input.payload ?? {},
      createdAt: now,
      updatedAt: now,
    };
    const saved = await this.store.suite.events.insert(record);
    return this.toEventDto(saved);
  }

  /** 读台账事件列表。 */
  async listEvents(
    userId: string,
    opts?: { domainId?: string; kind?: string; status?: SuiteEventDto['status']; limit?: number },
  ): Promise<SuiteEventDto[]> {
    const rows = await this.store.suite.events.listByUser(userId, opts);
    return rows.map((row) => this.toEventDto(row));
  }

  /** 更新台账事件状态。 */
  async updateEventStatus(id: string, status: SuiteEventDto['status'], userId: string): Promise<SuiteEventDto | null> {
    const rows = await this.store.suite.events.listByUser(userId, { limit: 500 });
    const found = rows.find((r) => r.id === id);
    if (!found) return null;
    const updated = await this.store.suite.events.updateStatus(id, status);
    return updated ? this.toEventDto(updated) : null;
  }

  private toEventDto(row: {
    id: string;
    domainId: string;
    kind: string;
    subject: string;
    amountFen: number;
    status: SuiteEventDto['status'];
    outTradeNo: string | null;
    payload: Record<string, unknown>;
    createdAt: Date;
  }): SuiteEventDto {
    return {
      id: row.id,
      domainId: row.domainId as SuiteDomainId,
      kind: row.kind,
      subject: row.subject,
      amountFen: row.amountFen,
      status: row.status,
      outTradeNo: row.outTradeNo,
      payload: row.payload ?? {},
      createdAt: row.createdAt.toISOString(),
    };
  }
}
