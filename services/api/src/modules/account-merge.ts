import type { IdFactory } from '@mixmapp/ids';
import type {
  AccountMergeRecord,
  BindingRecord,
  CartItemRecord,
  MergeMoved,
  MergeReason,
  MergeSnapshot,
  Store,
  UserRecord,
} from '../db/types.js';
import { AppError } from '../lib/errors.js';

/**
 * 账号合并的冲突策略：写进审计记录，事后不用回看代码猜当时怎么处理的。
 * 这里的每一条都对应 merge() 里的一个迁移步骤。
 */
export const MERGE_CONFLICT_STRATEGY: Record<string, string> = {
  bindings: '全部迁移到主账号；完全相同的 (provider, open_id) 去重，保留主账号那条',
  orders: '双方订单一律保留并全部挂到主账号，订单号不变，不取消、不合并',
  carts: '同一商品数量相加，包装信息保留主账号的',
  payments: '支付单全部挂到主账号，商户单号不变',
  pushTokens: '相同 token 去重，其余挂到主账号',
  refreshTokens: '次账号会话全部吊销，不迁移（合并后必须重新登录主账号）',
  profile: '主账号昵称/头像优先；仅主账号为空的字段用次账号补齐',
  user: '迁移完成后删除次账号；旧账号标识与旧会话立即失效',
};

export type MergeInput = {
  primaryUserId: string;
  secondaryUserId: string;
  reason: MergeReason;
  /** 幂等键：同一个业务动作重复提交只执行一次 */
  mergeKey: string;
  /** 额外一致性校验：主账号必须仍持有该手机号（bindPhone 场景） */
  requirePrimaryPhone?: string;
};

export type MergeResult = {
  merge: AccountMergeRecord;
  primary: UserRecord;
  replayed: boolean;
};

type SnapshotBundle = {
  snapshot: MergeSnapshot;
  secondaryBindings: BindingRecord[];
  primaryCarts: CartItemRecord[];
  secondaryCarts: CartItemRecord[];
};

export class AccountMergeService {
  constructor(
    private readonly store: Store,
    private readonly ids: IdFactory,
  ) {}

  /**
   * 破坏性合并：先写快照 → 迁移 → 删除次账号 → 标记完成。
   * - 同一 mergeKey 重放直接返回首次结果，不会二次迁移
   * - 任何一步失败都按快照补偿回滚，记录状态置 failed，不留下半合并账号
   */
  async merge(input: MergeInput): Promise<MergeResult> {
    const existing = await this.store.merges.findByKey(input.mergeKey);
    if (existing) {
      const primary = await this.store.users.findById(existing.primaryUserId);
      if (!primary) throw AppError.notFound('合并记录对应的主账号不存在');
      return { merge: existing, primary, replayed: true };
    }

    const primary = await this.store.users.findById(input.primaryUserId);
    const secondary = await this.store.users.findById(input.secondaryUserId);
    if (!primary || !secondary) throw AppError.notFound('待合并的账号不存在');
    if (primary.id === secondary.id) {
      throw AppError.validation('主账号与次账号不能相同');
    }
    if (primary.status !== 'active' || secondary.status !== 'active') {
      throw new AppError('FORBIDDEN', '账号已被冻结，不能合并');
    }
    if (input.requirePrimaryPhone && primary.phone !== input.requirePrimaryPhone) {
      throw AppError.conflict('手机号归属已变化，请重新验证后再试');
    }

    const bundle = await this.takeSnapshot(primary, secondary);
    let record: AccountMergeRecord;
    try {
      record = await this.store.merges.insert({
        id: this.ids.next().id,
        mergeKey: input.mergeKey,
        primaryUserId: primary.id,
        secondaryUserId: secondary.id,
        reason: input.reason,
        status: 'pending',
        snapshot: bundle.snapshot,
        moved: null,
        conflictStrategy: MERGE_CONFLICT_STRATEGY,
        error: null,
        createdAt: new Date(),
        completedAt: null,
        rolledBackAt: null,
      });
    } catch (error) {
      // 并发重复提交：另一个请求已经建了同 key 的记录，按重放处理。
      if (isUniqueViolation(error)) {
        const raced = await this.store.merges.findByKey(input.mergeKey);
        if (raced) {
          const fresh = await this.store.users.findById(raced.primaryUserId);
          if (fresh) return { merge: raced, primary: fresh, replayed: true };
        }
      }
      throw error;
    }

    try {
      const moved = await this.apply(bundle);
      const updated = await this.store.merges.update(record.id, {
        status: 'completed',
        moved,
        completedAt: new Date(),
        error: null,
      });
      const fresh = await this.store.users.findById(primary.id);
      if (!fresh) throw new Error('合并完成后主账号意外缺失');
      return { merge: updated ?? { ...record, status: 'completed', moved }, primary: fresh, replayed: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let compensationError: string | null = null;
      try {
        await this.compensate(bundle);
      } catch (compensateFailure) {
        compensationError =
          compensateFailure instanceof Error ? compensateFailure.message : String(compensateFailure);
      }
      const detail = compensationError
        ? `迁移失败：${message}；自动回滚也失败：${compensationError}（快照已保留，可用 /admin/merges/${record.id}/rollback 恢复）`
        : `迁移失败：${message}（已按快照回滚）`;
      await this.store.merges.update(record.id, { status: 'failed', error: detail });
      throw new AppError('CONFLICT', '账号合并失败，已回滚', {
        mergeId: record.id,
        compensationFailed: Boolean(compensationError),
        detail,
      });
    }
  }

  /** 按快照把已完成的合并恢复回去（管理员手动兜底，刷新令牌无法复活）。 */
  async rollback(mergeId: string): Promise<MergeResult> {
    const record = await this.store.merges.findById(mergeId);
    if (!record) throw AppError.notFound('合并记录不存在');
    if (record.status !== 'completed') {
      throw AppError.conflict(`只有 completed 状态可以回滚，当前是 ${record.status}`);
    }
    const snapshot = record.snapshot;
    const primary = await this.store.users.findById(snapshot.primary.id);
    if (!primary) throw AppError.notFound('主账号不存在，无法回滚');

    // 次账号已删除的话先按快照重建（订单等外键仍指向主账号，重建后再迁回）。
    let secondary = await this.store.users.findById(snapshot.secondary.id);
    if (!secondary) {
      secondary = await this.store.users.insert(snapshot.secondary);
    }

    const bundle: SnapshotBundle = {
      snapshot,
      secondaryBindings: snapshot.bindings.filter((b) => b.userId === snapshot.secondary.id),
      primaryCarts: snapshot.carts.filter((c) => c.userId === snapshot.primary.id),
      secondaryCarts: snapshot.carts.filter((c) => c.userId === snapshot.secondary.id),
    };
    await this.compensate(bundle);
    await this.store.users.update(snapshot.primary.id, snapshot.primary);
    await this.store.users.update(snapshot.secondary.id, snapshot.secondary);

    const updated = await this.store.merges.update(mergeId, {
      status: 'rolled_back',
      rolledBackAt: new Date(),
    });
    const fresh = await this.store.users.findById(snapshot.primary.id);
    if (!fresh) throw AppError.notFound('主账号不存在');
    return {
      merge: updated ?? { ...record, status: 'rolled_back', rolledBackAt: new Date() },
      primary: fresh,
      replayed: true,
    };
  }

  async candidates() {
    return this.store.merges.findCandidates();
  }

  private async takeSnapshot(
    primary: UserRecord,
    secondary: UserRecord,
  ): Promise<SnapshotBundle> {
    const [primaryBindings, secondaryBindings, primaryCarts, secondaryCarts, orders, payments, tokens, refreshTokens] =
      await Promise.all([
        this.store.bindings.listByUser(primary.id),
        this.store.bindings.listByUser(secondary.id),
        this.store.mall.carts.listByUser(primary.id),
        this.store.mall.carts.listByUser(secondary.id),
        this.store.mall.orders.listByUser(secondary.id),
        this.store.payments.listByUser(secondary.id),
        this.store.pushTokens.listByUser(secondary.id),
        this.store.refreshTokens.listActiveByUser(secondary.id),
      ]);

    const snapshot: MergeSnapshot = {
      takenAt: new Date().toISOString(),
      primary,
      secondary,
      bindings: [...primaryBindings, ...secondaryBindings],
      carts: [...primaryCarts, ...secondaryCarts],
      orderIds: orders.map((o) => o.id),
      paymentIds: payments.map((p) => p.id),
      pushTokenIds: tokens.map((t) => t.id),
      refreshTokenHashes: refreshTokens.map((t) => t.tokenHash),
    };
    return { snapshot, secondaryBindings, primaryCarts, secondaryCarts };
  }

  /** 迁移步骤本身是「设定目标状态」，重复执行不会重复累加（购物车用快照计算绝对结果）。 */
  private async apply(bundle: SnapshotBundle): Promise<MergeMoved> {
    const { snapshot, secondaryBindings, primaryCarts, secondaryCarts } = bundle;
    const primaryId = snapshot.primary.id;
    const secondaryId = snapshot.secondary.id;

    // 1) 绑定：先删掉与主账号完全相同的 (provider, open_id)，再整体迁移。
    const keyOf = (b: BindingRecord) => `${b.provider}:${b.openId}`;
    const primaryKeys = new Set(
      snapshot.bindings.filter((b) => b.userId === primaryId).map(keyOf),
    );
    const dropped: BindingRecord[] = [];
    const movable: BindingRecord[] = [];
    for (const binding of secondaryBindings) {
      if (primaryKeys.has(keyOf(binding))) dropped.push(binding);
      else movable.push(binding);
    }
    for (const binding of dropped) {
      await this.store.bindings.remove(secondaryId, binding.provider);
    }
    await this.store.bindings.move(
      movable.map((b) => b.id),
      primaryId,
    );

    // 2) 购物车：同商品数量相加；结果以绝对目标写入，重放不会翻倍。
    const cartConflicts: MergeMoved['cartConflicts'] = [];
    const primaryByProduct = new Map(primaryCarts.map((c) => [c.productId, c]));
    const target = primaryCarts.map((c) => ({ ...c }));
    for (const item of secondaryCarts) {
      const existing = primaryByProduct.get(item.productId);
      if (existing) {
        const resultQty = existing.quantity + item.quantity;
        cartConflicts.push({
          productId: item.productId,
          primaryQty: existing.quantity,
          secondaryQty: item.quantity,
          resultQty,
        });
        const row = target.find((c) => c.productId === item.productId);
        if (row) row.quantity = resultQty;
      } else {
        target.push({ ...item, userId: primaryId });
      }
    }
    await this.store.mall.carts.replaceAll(primaryId, target);
    await this.store.mall.carts.replaceAll(secondaryId, []);

    // 3) 订单 / 支付 / 推送：全部改挂主账号。
    const orders = await this.store.mall.orders.move(snapshot.orderIds, primaryId);
    const payments = await this.store.payments.move(snapshot.paymentIds, primaryId);

    const primaryTokens = await this.store.pushTokens.listByUser(primaryId);
    const primaryTokenSet = new Set(primaryTokens.map((t) => t.token));
    const secondaryTokens = await this.store.pushTokens.listByUser(secondaryId);
    const duplicateTokenIds = secondaryTokens
      .filter((t) => primaryTokenSet.has(t.token))
      .map((t) => t.id);
    if (duplicateTokenIds.length) await this.store.pushTokens.remove(duplicateTokenIds);
    const movableTokenIds = snapshot.pushTokenIds.filter((id) => !duplicateTokenIds.includes(id));
    const pushTokens = await this.store.pushTokens.move(movableTokenIds, primaryId);

    // 4) 档案：主账号为空的字段用次账号补，手机号只属于主账号。
    const profileFieldsFilled: string[] = [];
    const patch: Partial<UserRecord> = {};
    const fillable: Array<keyof UserRecord> = ['email', 'username', 'passwordHash', 'avatarUrl', 'bio'];
    for (const field of fillable) {
      const current = snapshot.primary[field];
      const incoming = snapshot.secondary[field];
      if ((current === null || current === '' || current === undefined) && incoming) {
        (patch as Record<string, unknown>)[field] = incoming;
        profileFieldsFilled.push(field);
      }
    }
    if (snapshot.primary.guest) {
      patch.guest = false;
      profileFieldsFilled.push('guest');
    }
    if (Object.keys(patch).length) await this.store.users.update(primaryId, patch);

    // 5) 会话收口：次账号刷新令牌全部吊销，幂等占位丢弃，最后删账号。
    const refreshTokensRevoked = await this.store.refreshTokens.revokeByUser(secondaryId);
    await this.store.mall.orderRequests.dropByUser(secondaryId);
    await this.store.users.delete(secondaryId);

    return {
      bindings: movable.length,
      droppedBindings: dropped.map((b) => `${b.provider}:${b.openId}`),
      carts: secondaryCarts.length,
      cartConflicts,
      orders,
      payments,
      pushTokens,
      refreshTokensRevoked,
      profileFieldsFilled,
    };
  }

  /** 按快照还原两个账号的数据归属；只在次账号仍存在时能完整还原。 */
  private async compensate(bundle: SnapshotBundle): Promise<void> {
    const { snapshot } = bundle;
    const primaryId = snapshot.primary.id;
    const secondaryId = snapshot.secondary.id;

    const secondary = await this.store.users.findById(secondaryId);
    if (!secondary) {
      // 次账号已被删掉：先按快照重建，后续补偿才有落点。
      await this.store.users.insert(snapshot.secondary);
    }

    const secondaryBindingIds = bundle.secondaryBindings.map((b) => b.id);
    if (secondaryBindingIds.length) {
      await this.store.bindings.move(secondaryBindingIds, secondaryId);
    }
    // 被去重删掉的绑定按快照补回（如果还没被别的请求占用）。
    for (const binding of bundle.secondaryBindings) {
      const existing = await this.store.bindings.findByProvider(binding.provider, binding.openId);
      if (!existing) await this.store.bindings.insert(binding).catch(() => undefined);
    }

    await this.store.mall.carts.replaceAll(primaryId, bundle.primaryCarts);
    await this.store.mall.carts.replaceAll(secondaryId, bundle.secondaryCarts);

    if (snapshot.orderIds.length) await this.store.mall.orders.move(snapshot.orderIds, secondaryId);
    if (snapshot.paymentIds.length) await this.store.payments.move(snapshot.paymentIds, secondaryId);
    if (snapshot.pushTokenIds.length) {
      await this.store.pushTokens.move(snapshot.pushTokenIds, secondaryId);
    }

    await this.store.users.update(primaryId, snapshot.primary);
    await this.store.users.update(secondaryId, snapshot.secondary);
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  return code === '23505' || /duplicate key|UNIQUE constraint/i.test(String(error));
}
