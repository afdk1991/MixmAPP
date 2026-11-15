// 后台运营台服务：
// - 认证：ADMIN_TOKEN 只用于换取短期会话，前端永远拿不到明文 token；
// - 数据：概览/商品/订单/用户/收藏夹/满减/运营位，全部走 Store.admin 命名空间；
// - 写操作：商品上下架、订单状态推进、订单取消，全部写审计（谁/何时/对什么/改前改后）。
// 该文件是新增文件，不改动用户侧任何服务与读路径。

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config.js';
import type {
  AdminAuditRecord,
  AdminCounts,
  AdminFavoriteFolderRow,
  AdminUserSummary,
  OrderRecord,
  ProductRecord,
  Store,
  UserRecord,
} from '../db/types.js';
import { AppError } from '../lib/errors.js';
import type { MallService } from './mall.js';

/** 会话 Cookie 名：HttpOnly，前端 JS 不可读。 */
export const ADMIN_SESSION_COOKIE = 'mixm_ops_session';

/** 登录失败限速：5 分钟内最多 5 次，超限封禁 10 分钟。 */
const LOGIN_WINDOW_MS = 5 * 60_000;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_BLOCK_MS = 10 * 60_000;

/** 写操作请求上下文：审计需要记录来源。 */
export type AdminRequestContext = {
  ip: string;
  userAgent: string;
  requestId: string;
};

/** 会话内部结构：时间戳用于 TTL 与最近活跃判断。 */
type SessionEntry = {
  createdAt: number;
  lastSeen: number;
  ip: string;
};

/** 登录失败计数：按 IP 维度。 */
type AttemptEntry = {
  count: number;
  windowStart: number;
  blockedUntil: number;
};

/** 后台允许的订单正向流转：只允许按六态顺序向前推进，不允许回退。 */
const ADMIN_TRANSITIONS: Partial<Record<OrderRecord['status'], OrderRecord['status']>> = {
  paid: 'picking',
  picking: 'shipped',
  shipped: 'completed',
};

/** 可被后台取消的状态：已付款但尚未开始拣货（pickingAt 为空）。 */
const CANCELLABLE_STATUSES: OrderRecord['status'][] = ['pending', 'paid'];

/**
 * 后台运营台服务。
 * 会话保存在进程内存：API 重启即全部失效，这是「短期会话」的预期行为，
 * 也避免引入额外存储与多账号体系。
 */
export class AdminConsoleService {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly attempts = new Map<string, AttemptEntry>();

  constructor(
    private readonly config: Config,
    private readonly store: Store,
    /** 只读复用商城服务里的运营位/推荐分类（当前是代码内置数据）。 */
    private readonly mall: Pick<MallService, 'listHomeAds' | 'listRecommendedCategories'>,
  ) {}

  /** ADMIN_TOKEN 是否已配置。未配置时后台整体按 404 处理，不暴露存在性。 */
  get enabled(): boolean {
    return Boolean(this.config.adminToken);
  }

  /** 会话有效期（秒）。 */
  get ttlSec(): number {
    return Math.max(60, Math.floor(this.config.adminSessionTtlSec));
  }

  /** 计算会话令牌的存储键：内存里只存摘要，进程被 dump 也拿不到可用令牌。 */
  private sessionKey(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** 常量时间比对 ADMIN_TOKEN，避免长度/内容侧信道。 */
  private tokenMatches(input: string): boolean {
    if (!this.config.adminToken) return false;
    const a = createHash('sha256').update(input).digest();
    const b = createHash('sha256').update(this.config.adminToken).digest();
    return timingSafeEqual(a, b);
  }

  /** 清理过期会话与过期限速窗口，避免内存无限增长。 */
  private sweep(now: number): void {
    const ttlMs = this.ttlSec * 1000;
    for (const [key, entry] of this.sessions) {
      if (now - entry.lastSeen > ttlMs) this.sessions.delete(key);
    }
    for (const [ip, entry] of this.attempts) {
      const expiredWindow = now - entry.windowStart > LOGIN_WINDOW_MS;
      const expiredBlock = entry.blockedUntil !== 0 && now > entry.blockedUntil;
      if (expiredWindow && expiredBlock) this.attempts.delete(ip);
    }
  }

  /** 命中原语：IP 处于封禁期时按 404 处理，不暴露限速细节。 */
  private assertNotBlocked(ip: string, now: number): void {
    const entry = this.attempts.get(ip);
    if (entry && entry.blockedUntil > now) throw AppError.notFound();
  }

  /** 记录一次失败；达到阈值后进入封禁期。 */
  private noteFailure(ip: string, now: number): void {
    const entry = this.attempts.get(ip);
    if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
      this.attempts.set(ip, { count: 1, windowStart: now, blockedUntil: 0 });
      return;
    }
    entry.count += 1;
    if (entry.count >= LOGIN_MAX_FAILURES) entry.blockedUntil = now + LOGIN_BLOCK_MS;
  }

  /**
   * 用 ADMIN_TOKEN 换取短期会话。
   * 失败（未配置 / token 错误 / IP 封禁）一律 404，延续既有 /admin/* 门禁语义。
   */
  login(input: string, ctx: AdminRequestContext): { token: string; expiresIn: number } {
    const now = Date.now();
    this.sweep(now);
    this.assertNotBlocked(ctx.ip, now);
    // 未配置 ADMIN_TOKEN 时后台不存在；空输入直接失败。
    if (!this.enabled || !input || !this.tokenMatches(input.trim())) {
      this.noteFailure(ctx.ip, now);
      throw AppError.notFound();
    }
    this.attempts.delete(ctx.ip);
    // 原始令牌只回填进 HttpOnly Cookie，服务端只存摘要。
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(this.sessionKey(token), { createdAt: now, lastSeen: now, ip: ctx.ip });
    return { token, expiresIn: this.ttlSec };
  }

  /** 校验会话并刷新最近活跃时间；无效一律 404。 */
  verify(token: string | null | undefined): SessionEntry {
    const now = Date.now();
    this.sweep(now);
    if (!this.enabled || !token) throw AppError.notFound();
    const key = this.sessionKey(token);
    const entry = this.sessions.get(key);
    if (!entry) throw AppError.notFound();
    if (now - entry.lastSeen > this.ttlSec * 1000) {
      this.sessions.delete(key);
      throw AppError.notFound();
    }
    entry.lastSeen = now;
    return entry;
  }

  /** 主动登出：删除会话即可，前端同时清 Cookie。 */
  logout(token: string | null | undefined): void {
    if (!token) return;
    this.sessions.delete(this.sessionKey(token));
  }

  /** 会话自检：返回剩余有效期，供控制台首屏判断是否需要重新登录。 */
  describeSession(token: string | null | undefined): { expiresAt: string; ip: string } {
    const entry = this.verify(token);
    return {
      expiresAt: new Date(entry.lastSeen + this.ttlSec * 1000).toISOString(),
      ip: entry.ip,
    };
  }

  /** 概览：数据库连通性 + 目录同步状态 + 关键计数。 */
  async overview(): Promise<{
    health: { db: boolean; driver: string };
    catalogSync: Awaited<ReturnType<Store['ops']['lastCatalogSyncRun']>>;
    counts: AdminCounts;
  }> {
    // ping 与计数互不依赖，可并行。
    const [db, catalogSync, counts] = await Promise.all([
      this.store.ping(),
      this.store.ops.lastCatalogSyncRun(),
      this.store.admin.counts(),
    ]);
    return { health: { db, driver: this.store.driver }, catalogSync, counts };
  }

  /** 商品列表：包含已下架商品；limit 上限 100，防止一次拉爆。 */
  async listProducts(query: {
    keyword?: string;
    category?: string;
    listed?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ rows: ProductRecord[]; total: number; limit: number; offset: number }> {
    const limit = this.clampLimit(query.limit);
    const offset = this.clampOffset(query.offset);
    // listed 只接受 true/false；其他值视为不筛选，避免误把非法输入当成下架。
    const listed =
      query.listed === 'true' ? true : query.listed === 'false' ? false : undefined;
    const { rows, total } = await this.store.admin.listProducts({
      keyword: query.keyword,
      category: query.category,
      listed,
      limit,
      offset,
    });
    return { rows, total, limit, offset };
  }

  /**
   * 批量上下架。
   * 调用方必须先做二次确认（confirm=true），服务端这里再校验一次；
   * 审计按商品逐条写入，共用 batchId，便于按批次回溯。
   */
  async setProductsListed(params: {
    ids: string[];
    listed: boolean;
    confirm: boolean;
    ctx: AdminRequestContext;
  }): Promise<{ requested: number; changed: number; batchId: string }> {
    if (!params.confirm) throw AppError.validation('危险操作需要二次确认');
    const ids = Array.from(new Set(params.ids.map((id) => id.trim()).filter(Boolean)));
    if (!ids.length) throw AppError.validation('请选择至少一个商品');
    if (ids.length > 100) throw AppError.validation('单次最多操作 100 个商品');

    // 先取改前快照：并行读取，最多 100 条；读不到的 id 直接忽略（可能已被删除）。
    const beforeRows = await Promise.all(
      ids.map((id) => this.store.mall.products.findById(id)),
    );
    const existing = beforeRows.filter((row): row is ProductRecord => Boolean(row));
    // 只对状态确实需要变化的商品发更新，避免无效审计。
    const toChange = existing.filter((row) => (row.listed !== false) !== params.listed);
    const changed = await this.store.admin.setProductsListed(
      toChange.map((row) => row.id),
      params.listed,
    );

    const batchId = randomUUID();
    const now = new Date();
    // 逐条审计：改前只保留后台关心的字段，避免把整行目录数据塞进 jsonb。
    for (const row of toChange) {
      await this.appendAudit(params.ctx, {
        action: params.listed ? 'product.list' : 'product.unlist',
        targetType: 'product',
        targetId: row.id,
        summary: `${params.listed ? '上架' : '下架'}商品「${row.title}」`,
        before: { listed: row.listed !== false },
        after: { listed: params.listed },
        batchId,
        createdAt: now,
      });
    }
    return { requested: ids.length, changed, batchId };
  }

  /** 订单列表：status 只接受六态之一。 */
  async listOrders(query: {
    status?: string;
    keyword?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ rows: OrderRecord[]; total: number; limit: number; offset: number }> {
    const limit = this.clampLimit(query.limit);
    const offset = this.clampOffset(query.offset);
    const allowed: OrderRecord['status'][] = [
      'pending',
      'paid',
      'picking',
      'shipped',
      'completed',
      'cancelled',
    ];
    const status = allowed.includes(query.status as OrderRecord['status'])
      ? (query.status as OrderRecord['status'])
      : undefined;
    const { rows, total } = await this.store.admin.listOrders({
      status,
      keyword: query.keyword,
      limit,
      offset,
    });
    return { rows, total, limit, offset };
  }

  /** 订单详情：订单本体 + 明细 + 下单用户展示信息。 */
  async orderDetail(orderId: string): Promise<{
    order: OrderRecord;
    items: Awaited<ReturnType<Store['mall']['orders']['itemsByOrder']>>;
    user: { id: string; nickname: string | null; accountNo: string | null } | null;
  }> {
    const order = await this.store.admin.getOrder(orderId);
    if (!order) throw AppError.notFound('订单不存在');
    const [items, user] = await Promise.all([
      this.store.mall.orders.itemsByOrder(orderId),
      this.store.users.findById(order.userId),
    ]);
    return {
      order,
      items,
      user: user
        ? { id: user.id, nickname: user.nickname ?? null, accountNo: user.accountNo ?? null }
        : null,
    };
  }

  /**
   * 订单正向流转：paid → picking → shipped → completed。
   * 只做单向推进，回退/跨态一律拒绝；并发下以条件更新为准。
   */
  async advanceOrder(
    orderId: string,
    to: string,
    ctx: AdminRequestContext,
  ): Promise<OrderRecord> {
    const before = await this.store.admin.getOrder(orderId);
    if (!before) throw AppError.notFound('订单不存在');
    const expectedTo = ADMIN_TRANSITIONS[before.status];
    if (!expectedTo || expectedTo !== to) {
      throw AppError.conflict(
        `订单当前为 ${before.status}，不能推进到 ${to}`,
      );
    }
    const target = expectedTo as OrderRecord['status'];
    // markStatusAt 同时写状态与时间戳，并且是条件更新（并发安全）。
    const ok = await this.store.mall.orders.markStatusAt(
      orderId,
      before.status,
      target,
      new Date(),
    );
    if (!ok) throw AppError.conflict('订单状态已被其他操作改变，请刷新后重试');
    const after = await this.store.admin.getOrder(orderId);
    await this.appendAudit(ctx, {
      action: 'order.transition',
      targetType: 'order',
      targetId: orderId,
      summary: `订单 ${before.orderNo}：${before.status} → ${target}`,
      before: { status: before.status },
      after: { status: target },
      batchId: null,
      createdAt: new Date(),
    });
    return after ?? { ...before, status: target };
  }

  /**
   * 取消订单：只允许 pending/paid 且未开始拣货；必须填写原因。
   * 取消发起方固定记为 admin，便于和用户侧取消区分。
   */
  async cancelOrder(
    orderId: string,
    params: { reason: string; confirm: boolean; ctx: AdminRequestContext },
  ): Promise<OrderRecord> {
    if (!params.confirm) throw AppError.validation('取消订单需要二次确认');
    const reason = (params.reason ?? '').trim();
    if (reason.length < 2) throw AppError.validation('请填写取消原因（至少 2 个字）');
    if (reason.length > 200) throw AppError.validation('取消原因不能超过 200 字');
    const before = await this.store.admin.getOrder(orderId);
    if (!before) throw AppError.notFound('订单不存在');
    if (!CANCELLABLE_STATUSES.includes(before.status)) {
      throw AppError.conflict(`订单当前为 ${before.status}，不允许取消`);
    }
    const ok = await this.store.mall.orders.cancel(
      orderId,
      CANCELLABLE_STATUSES,
      reason,
      'admin',
    );
    if (!ok) throw AppError.conflict('订单已开始拣货或状态已变化，无法取消');
    const after = await this.store.admin.getOrder(orderId);
    await this.appendAudit(params.ctx, {
      action: 'order.cancel',
      targetType: 'order',
      targetId: orderId,
      summary: `取消订单 ${before.orderNo}，原因：${reason}`,
      before: { status: before.status, cancelReason: before.cancelReason ?? null },
      after: { status: 'cancelled', cancelReason: reason, cancelledBy: 'admin' },
      batchId: null,
      createdAt: new Date(),
    });
    return after ?? { ...before, status: 'cancelled', cancelReason: reason, cancelledBy: 'admin' };
  }

  /** 用户列表。 */
  async listUsers(query: {
    keyword?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ rows: UserRecord[]; total: number; limit: number; offset: number }> {
    const limit = this.clampLimit(query.limit);
    const offset = this.clampOffset(query.offset);
    const { rows, total } = await this.store.admin.listUsers({
      keyword: query.keyword,
      limit,
      offset,
    });
    // 用户侧不返回 passwordHash；后台同样不下发，只保留展示所需字段。
    return {
      rows: rows.map((row) => ({ ...row, passwordHash: null })),
      total,
      limit,
      offset,
    };
  }

  /** 用户详情：本体（脱敏） + 绑定/订单/收藏/购物车汇总。 */
  async userDetail(
    userId: string,
  ): Promise<{ user: UserRecord; summary: AdminUserSummary; bindings: AdminUserSummary['bindings'] }> {
    const user = await this.store.users.findById(userId);
    if (!user) throw AppError.notFound('用户不存在');
    const summary = await this.store.admin.userSummary(userId);
    if (!summary) throw AppError.notFound('用户不存在');
    return {
      user: { ...user, passwordHash: null },
      summary,
      bindings: summary.bindings,
    };
  }

  /** 运营位与推荐分类：当前是代码内置数据，后台只读展示。 */
  async content(): Promise<{
    homeAds: Awaited<ReturnType<MallService['listHomeAds']>>;
    recommendedCategories: Awaited<ReturnType<MallService['listRecommendedCategories']>>;
    editable: false;
    note: string;
  }> {
    const [homeAds, recommendedCategories] = await Promise.all([
      this.mall.listHomeAds(),
      this.mall.listRecommendedCategories(12),
    ]);
    return {
      homeAds,
      recommendedCategories,
      editable: false,
      // 明确代价：改数据要发版，且改代码文件会与首页改造线冲突。
      note:
        '运营位与推荐分类目前是 API 代码内置数据（modules/mall.ts 的 HOME_ADS 与推荐算法），' +
        '后台只读展示。要做成可编辑需要新增 CMS 表 + 管理写接口 + 缓存失效机制，' +
        '并改动正在并行重做的首页数据链路，代价较高，本次不做。',
    };
  }

  /** 全站收藏夹（只读）：含条目数与归属用户。 */
  async favorites(query: {
    limit?: number;
    offset?: number;
  }): Promise<{ rows: AdminFavoriteFolderRow[]; total: number; limit: number; offset: number }> {
    const limit = this.clampLimit(query.limit);
    const offset = this.clampOffset(query.offset);
    const { rows, total } = await this.store.admin.listFavoriteFolders({ limit, offset });
    return { rows, total, limit, offset };
  }

  /** 满减档位（只读）：包含停用档位。 */
  async manjian(): Promise<Awaited<ReturnType<Store['admin']['listManjianTiers']>>> {
    return this.store.admin.listManjianTiers();
  }

  /** 最近审计记录。 */
  async audit(limit?: number, offset?: number): Promise<AdminAuditRecord[]> {
    return this.store.admin.audit.list(this.clampLimit(limit, 100), this.clampOffset(offset));
  }

  /** limit 归一：默认 20，范围 1–100。 */
  private clampLimit(value?: number, fallback = 20): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(100, Math.floor(n));
  }

  /** offset 归一：默认 0，不能为负。 */
  private clampOffset(value?: number): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  }

  /** 组装并落库一条审计记录。 */
  private async appendAudit(
    ctx: AdminRequestContext,
    entry: Omit<AdminAuditRecord, 'id' | 'actor' | 'ip' | 'userAgent' | 'requestId'>,
  ): Promise<void> {
    await this.store.admin.audit.append({
      ...entry,
      id: randomUUID(),
      actor: 'admin',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
  }
}
