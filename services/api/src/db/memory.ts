import { buildSearchIndexRow, buildSearchTokens, matchesSearchTokens } from '../lib/search.js';
import type {
  AccountMergeRecord,
  AddressRecord,
  AdminAuditRecord,
  AdminCounts,
  AdminFavoriteFolderRow,
  AdminOrderFilter,
  AdminProductFilter,
  AdminUserFilter,
  AdminUserSummary,
  BindingRecord,
  CartItemRecord,
  FavoriteFolderRecord,
  FavoriteItemRecord,
  ManjianTierRecord,
  MergeCandidate,
  OrderItemRecord,
  OrderRecord,
  OAuthStateRecord,
  PaymentRecord,
  ProductRecord,
  PushTokenRecord,
  RefreshTokenRecord,
  SmsCodeRecord,
  Store,
  UserRecord,
} from './types.js';

const clone = <T>(value: T): T => structuredClone(value);

/**
 * 满减梯度档位默认值（与 infra/sql/0017 的种子一致）。
 * 源站满减档位接口未开放，这里是本地占位值，不是源站真实档位；默认全部停用（enabled = false），
 * 停用时满减命中数为 0，购物车不展示满减行与提示。拿到源站真实档位后改库表启用，不动代码。
 */
const MEMORY_MANJIAN_TIERS: ManjianTierRecord[] = [
  { id: 'mj_tier_1', minFen: 50000, maxFen: 100000, percent: 1, label: '满 500 元减免 1%', enabled: false, sortNo: 1 },
  { id: 'mj_tier_2', minFen: 100000, maxFen: 300000, percent: 2, label: '满 1000 元减免 2%', enabled: false, sortNo: 2 },
  { id: 'mj_tier_3', minFen: 300000, maxFen: null, percent: 3, label: '满 3000 元减免 3%', enabled: false, sortNo: 3 },
];

/** 内存驱动：本机开发与自动化测试默认用它，零外部依赖。 */
export class MemoryStore implements Store {
  readonly driver = 'memory' as const;

  private userList: UserRecord[] = [];
  private bindingList: BindingRecord[] = [];
  private oauthStateList: OAuthStateRecord[] = [];
  private tokenList: RefreshTokenRecord[] = [];
  private smsList: SmsCodeRecord[] = [];
  private paymentList: PaymentRecord[] = [];
  private pushList: PushTokenRecord[] = [];
  private productList: ProductRecord[] = [];
  private cartList: CartItemRecord[] = [];
  private addressList: AddressRecord[] = [];
  private orderList: OrderRecord[] = [];
  private orderItemList: OrderItemRecord[] = [];
  private orderRequestMap = new Map<string, { orderNo: string | null }>();
  /** 收藏夹与条目（0019） */
  private favoriteFolderList: FavoriteFolderRecord[] = [];
  private favoriteItemList: FavoriteItemRecord[] = [];
  private mergeList: AccountMergeRecord[] = [];
  /** 后台写操作审计（0020）：内存模式下只存在于进程生命周期内 */
  private auditList: AdminAuditRecord[] = [];

  async ping(): Promise<boolean> {
    return true;
  }

  /** 内存库没有目录同步记账，统一返回 null（健康检查显示 unknown） */
  ops = {
    lastCatalogSyncRun: async () => null,
  };

  async close(): Promise<void> {
    this.userList = [];
    this.bindingList = [];
    this.oauthStateList = [];
    this.tokenList = [];
    this.smsList = [];
    this.paymentList = [];
    this.pushList = [];
    this.productList = [];
    this.cartList = [];
    this.addressList = [];
    this.orderList = [];
    this.orderItemList = [];
    this.orderRequestMap.clear();
    this.favoriteFolderList = [];
    this.favoriteItemList = [];
    this.mergeList = [];
    this.auditList = [];
  }

  users = {
    insert: async (user: UserRecord): Promise<UserRecord> => {
      const record = clone(user);
      this.userList.push(record);
      return clone(record);
    },
    findById: async (id: string): Promise<UserRecord | null> => {
      const found = this.userList.find((u) => u.id === id);
      return found ? clone(found) : null;
    },
    findByPhone: async (phone: string): Promise<UserRecord | null> => {
      const found = this.userList.find((u) => u.phone === phone);
      return found ? clone(found) : null;
    },
    findByEmail: async (email: string): Promise<UserRecord | null> => {
      const lower = email.toLowerCase();
      const found = this.userList.find((u) => (u.email ?? '').toLowerCase() === lower);
      return found ? clone(found) : null;
    },
    findByUsername: async (username: string): Promise<UserRecord | null> => {
      const lower = username.toLowerCase();
      const found = this.userList.find((u) => (u.username ?? '').toLowerCase() === lower);
      return found ? clone(found) : null;
    },
    findByAccountNo: async (accountNo: string): Promise<UserRecord | null> => {
      const key = accountNo.toUpperCase();
      const found = this.userList.find((u) => u.accountNo.toUpperCase() === key);
      return found ? clone(found) : null;
    },
    update: async (id: string, patch: Partial<UserRecord>): Promise<UserRecord | null> => {
      const idx = this.userList.findIndex((u) => u.id === id);
      if (idx < 0) return null;
      const next = { ...this.userList[idx], ...patch, updatedAt: new Date() } as UserRecord;
      this.userList[idx] = next;
      return clone(next);
    },
    delete: async (id: string): Promise<void> => {
      this.userList = this.userList.filter((u) => u.id !== id);
    },
  };

  bindings = {
    insert: async (binding: BindingRecord): Promise<BindingRecord> => {
      const duplicate = this.bindingList.find(
        (b) => b.provider === binding.provider && b.openId === binding.openId,
      );
      if (duplicate) {
        throw Object.assign(new Error('duplicate key: bindings provider open_id'), { code: '23505' });
      }
      this.bindingList.push(clone(binding));
      return clone(binding);
    },
    findByProvider: async (
      provider: BindingRecord['provider'],
      openId: string,
    ): Promise<BindingRecord | null> => {
      const found = this.bindingList.find((b) => b.provider === provider && b.openId === openId);
      return found ? clone(found) : null;
    },
    findByUnionId: async (unionId: string): Promise<BindingRecord[]> =>
      this.bindingList.filter((b) => b.unionId === unionId).map(clone),
    listByUser: async (userId: string): Promise<BindingRecord[]> => {
      return this.bindingList.filter((b) => b.userId === userId).map(clone);
    },
    remove: async (userId: string, provider: BindingRecord['provider']): Promise<void> => {
      this.bindingList = this.bindingList.filter(
        (b) => !(b.userId === userId && b.provider === provider),
      );
    },
    move: async (ids: string[], userId: string): Promise<number> => {
      const wanted = new Set(ids);
      let moved = 0;
      for (const binding of this.bindingList) {
        if (!wanted.has(binding.id)) continue;
        if (binding.userId !== userId) {
          binding.userId = userId;
          moved += 1;
        }
      }
      return moved;
    },
  };

  oauthStates = {
    insert: async (record: OAuthStateRecord): Promise<void> => {
      this.oauthStateList.push(clone(record));
    },
    claim: async (state: string): Promise<OAuthStateRecord | null> => {
      const found = this.oauthStateList.find((item) => item.state === state);
      if (!found) return null;
      if (found.consumedAt) return null;
      if (found.expiresAt.getTime() <= Date.now()) return null;
      found.consumedAt = new Date();
      return clone(found);
    },
    purgeExpired: async (before: Date): Promise<void> => {
      this.oauthStateList = this.oauthStateList.filter(
        (item) => item.expiresAt.getTime() > before.getTime(),
      );
    },
  };

  refreshTokens = {
    insert: async (token: RefreshTokenRecord): Promise<void> => {
      this.tokenList.push(clone(token));
    },
    findByHash: async (hash: string): Promise<RefreshTokenRecord | null> => {
      const found = this.tokenList.find((t) => t.tokenHash === hash);
      return found ? clone(found) : null;
    },
    revoke: async (hash: string, replacedBy?: string | null): Promise<void> => {
      const found = this.tokenList.find((t) => t.tokenHash === hash);
      if (found) {
        found.revokedAt = new Date();
        found.replacedBy = replacedBy ?? null;
      }
    },
    listActiveByUser: async (userId: string): Promise<RefreshTokenRecord[]> =>
      this.tokenList.filter((t) => t.userId === userId && !t.revokedAt).map(clone),
    revokeByUser: async (userId: string): Promise<number> => {
      let count = 0;
      for (const token of this.tokenList) {
        if (token.userId !== userId || token.revokedAt) continue;
        token.revokedAt = new Date();
        count += 1;
      }
      return count;
    },
  };

  smsCodes = {
    insert: async (code: SmsCodeRecord): Promise<void> => {
      this.smsList.push(clone(code));
    },
    latest: async (
      phone: string,
      purpose: SmsCodeRecord['purpose'],
    ): Promise<SmsCodeRecord | null> => {
      const list = this.smsList
        .filter((c) => c.phone === phone && c.purpose === purpose)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return list[0] ? clone(list[0]) : null;
    },
    update: async (id: string, patch: Partial<SmsCodeRecord>): Promise<void> => {
      const idx = this.smsList.findIndex((c) => c.id === id);
      if (idx >= 0) this.smsList[idx] = { ...this.smsList[idx], ...patch } as SmsCodeRecord;
    },
  };

  payments = {
    insert: async (payment: PaymentRecord): Promise<PaymentRecord> => {
      this.paymentList.push(clone(payment));
      return clone(payment);
    },
    findByOutTradeNo: async (outTradeNo: string): Promise<PaymentRecord | null> => {
      const found = this.paymentList.find((p) => p.outTradeNo === outTradeNo);
      return found ? clone(found) : null;
    },
    listByUser: async (userId: string): Promise<PaymentRecord[]> =>
      this.paymentList.filter((p) => p.userId === userId).map(clone),
    update: async (id: string, patch: Partial<PaymentRecord>): Promise<PaymentRecord | null> => {
      const idx = this.paymentList.findIndex((p) => p.id === id);
      if (idx < 0) return null;
      this.paymentList[idx] = { ...this.paymentList[idx], ...patch } as PaymentRecord;
      return clone(this.paymentList[idx]);
    },
    move: async (ids: string[], userId: string): Promise<number> => {
      const wanted = new Set(ids);
      let moved = 0;
      for (const payment of this.paymentList) {
        if (!wanted.has(payment.id) || payment.userId === userId) continue;
        payment.userId = userId;
        moved += 1;
      }
      return moved;
    },
  };

  pushTokens = {
    upsert: async (record: PushTokenRecord): Promise<void> => {
      const idx = this.pushList.findIndex(
        (p) => p.userId === record.userId && p.token === record.token,
      );
      if (idx >= 0) this.pushList[idx] = clone(record);
      else this.pushList.push(clone(record));
    },
    listByUser: async (userId: string): Promise<PushTokenRecord[]> =>
      this.pushList.filter((p) => p.userId === userId).map(clone),
    move: async (ids: string[], userId: string): Promise<number> => {
      const wanted = new Set(ids);
      let moved = 0;
      for (const token of this.pushList) {
        if (!wanted.has(token.id) || token.userId === userId) continue;
        token.userId = userId;
        moved += 1;
      }
      return moved;
    },
    remove: async (ids: string[]): Promise<void> => {
      const wanted = new Set(ids);
      this.pushList = this.pushList.filter((token) => !wanted.has(token.id));
    },
  };

  mall = {
    products: {
      insert: async (product: ProductRecord): Promise<ProductRecord> => {
        this.productList.push(clone(product));
        return clone(product);
      },
      hasCatalogProducts: async (): Promise<boolean> =>
        this.productList.some((p) => Boolean(p.sourceKey)),
      list: async (filter: {
        category?: string;
        cat?: string;
        ctgs?: string[];
        dims?: string;
        lens?: string;
        ttt?: string;
        trts?: string[];
        keyword?: string;
        limit: number;
        offset: number;
      }): Promise<ProductRecord[]> => {
        // 内存实现没有分类树与规格数据：树节点/规格筛选下无商品可返回，保持与 PG 口径一致。
        if (filter.cat || filter.dims || filter.lens) return [];
        // 分类多选（源站 ctgs）：内存库只有一级类目（id = c1:<category>），其它节点视为无商品。
        const ctgCategories = filter.ctgs?.length
          ? filter.ctgs.map((id) => (id.startsWith('c1:') ? id.slice(3) : '\u0000'))
          : null;
        // 牙别（源站 trts）：直接比对 specs.牙别，多值 OR。
        const trts = filter.trts?.length ? filter.trts : null;
        const tokens = buildSearchTokens(filter.keyword);
        return this.productList
          .filter((p) => p.listed !== false)
          .filter((p) => (filter.category ? p.category === filter.category : true))
          .filter((p) => (ctgCategories ? ctgCategories.includes(p.category) : true))
          // 表面处理（ttt）与牙别（trts）都直接比对 specs 上的真实取值
          .filter((p) => (filter.ttt ? p.specs?.['表面处理'] === filter.ttt : true))
          .filter((p) => (trts ? trts.includes(p.specs?.['牙别'] ?? '') : true))
          .filter((p) => {
            if (!tokens.length) return true;
            const row = buildSearchIndexRow({
              title: p.title,
              subtitle: p.subtitle,
              brand: p.brand,
              specs: p.specs,
              sourceId: p.sourceId ?? null,
              sourceItemNo: p.sourceItemNo ?? null,
              sourceKey: p.sourceKey ?? null,
            });
            return matchesSearchTokens(row, tokens);
          })
          .sort((a, b) => a.sortNo - b.sortNo)
          .slice(filter.offset, filter.offset + filter.limit)
          .map(clone);
      },
      aggregateCategories: async () => {
        const byCode = new Map<string, { code: string; name: string; count: number }>();
        for (const p of this.productList) {
          if (p.listed === false) continue;
          const existing = byCode.get(p.category);
          if (existing) existing.count += 1;
          else byCode.set(p.category, { code: p.category, name: p.categoryName ?? p.category, count: 1 });
        }
        return [...byCode.values()];
      },
      // 内存库只有演示商品，没有空分类壳，includeEmpty 对它无影响。
      listChildCategories: async (parentId: string | null, _opts?: { includeEmpty?: boolean }) => {
        if (parentId) return [];
        const byCode = new Map<string, { id: string; code: string; name: string; level: number; count: number }>();
        for (const p of this.productList) {
          if (p.listed === false) continue;
          const existing = byCode.get(p.category);
          if (existing) existing.count += 1;
          else
            byCode.set(p.category, {
              id: `c1:${p.category}`,
              code: p.category,
              name: p.categoryName ?? p.category,
              level: 1,
              count: 1,
            });
        }
        return [...byCode.values()];
      },
      listSpecOptions: async () => ({
        dims: [],
        lens: [],
        brands: [],
        stds: [],
        grds: [],
        mtls: [],
        ttts: [],
        trts: [],
      }),
      findById: async (id: string): Promise<ProductRecord | null> => {
        const found = this.productList.find((p) => p.id === id);
        return found ? clone(found) : null;
      },
      upsert: async (
        product: ProductRecord,
      ): Promise<{ record: ProductRecord; action: 'inserted' | 'updated' }> => {
        const idx = this.productList.findIndex((p) => p.sourceKey && p.sourceKey === product.sourceKey);
        if (idx < 0) {
          this.productList.push(clone(product));
          return { record: clone(product), action: 'inserted' };
        }
        const existing = this.productList[idx]!;
        // 人工改过的记录被后台标记为 importBatch='manual'：运营侧字段保留，只刷新导入侧字段。
        const manual = existing.importBatch === 'manual';
        const next: ProductRecord = {
          ...existing,
          subtitle: product.subtitle,
          priceFen: product.priceFen,
          originalPriceFen: product.originalPriceFen,
          cover: product.cover,
          images: product.images,
          tags: product.tags,
          description: product.description,
          sourceKey: product.sourceKey,
          sourceUrl: product.sourceUrl,
          sourceId: product.sourceId,
          brand: product.brand,
          categoryPath: product.categoryPath,
          categoryName: product.categoryName,
          specs: product.specs,
          unit: product.unit,
          packQty: product.packQty,
          priceSource: product.priceSource,
          priceCapturedAt: product.priceCapturedAt,
          stockSource: product.stockSource,
          importBatch: product.importBatch,
          ...(manual
            ? {}
            : {
                title: product.title,
                category: product.category,
                stock: product.stock,
                sortNo: product.sortNo,
              }),
        };
        this.productList[idx] = next;
        return { record: clone(next), action: 'updated' };
      },
      decrementStock: async (id: string, quantity: number): Promise<boolean> => {
        const found = this.productList.find((p) => p.id === id);
        if (!found || found.stock < quantity) return false;
        found.stock -= quantity;
        return true;
      },
      restoreStock: async (id: string, quantity: number): Promise<void> => {
        const found = this.productList.find((p) => p.id === id);
        if (found) found.stock += quantity;
      },
    },
    carts: {
      listByUser: async (userId: string): Promise<CartItemRecord[]> => {
        const list = this.cartList.filter((c) => c.userId === userId);
        return list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(clone);
      },
      find: async (userId: string, productId: string): Promise<CartItemRecord | null> => {
        const found = this.cartList.find((c) => c.userId === userId && c.productId === productId);
        return found ? clone(found) : null;
      },
      upsert: async (item: CartItemRecord): Promise<CartItemRecord> => {
        const idx = this.cartList.findIndex((c) => c.userId === item.userId && c.productId === item.productId);
        const existing = idx >= 0 ? this.cartList[idx] : undefined;
        if (existing) {
          const next: CartItemRecord = {
            ...existing,
            quantity: item.quantity,
            updatedAt: item.updatedAt,
          };
          this.cartList[idx] = next;
          return clone(next);
        }
        this.cartList.push(clone(item));
        return clone(item);
      },
      remove: async (userId: string, productId: string): Promise<void> => {
        this.cartList = this.cartList.filter((c) => !(c.userId === userId && c.productId === productId));
      },
      clear: async (userId: string): Promise<void> => {
        this.cartList = this.cartList.filter((c) => c.userId !== userId);
      },
      replaceAll: async (userId: string, items: CartItemRecord[]): Promise<void> => {
        this.cartList = this.cartList.filter((c) => c.userId !== userId);
        for (const item of items) this.cartList.push(clone({ ...item, userId }));
      },
    },
    addresses: {
      listByUser: async (userId: string): Promise<AddressRecord[]> =>
        this.addressList
          .filter((a) => a.userId === userId)
          .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.createdAt.getTime() - a.createdAt.getTime())
          .map(clone),
      findById: async (userId: string, id: string): Promise<AddressRecord | null> => {
        const found = this.addressList.find((a) => a.userId === userId && a.id === id);
        return found ? clone(found) : null;
      },
      insert: async (address: AddressRecord): Promise<AddressRecord> => {
        // 内存实现与 pg 口径一致：同一用户只保留一条默认地址
        if (address.isDefault) {
          for (const row of this.addressList) {
            if (row.userId === address.userId) row.isDefault = false;
          }
        }
        this.addressList.push(clone(address));
        return clone(address);
      },
      update: async (
        userId: string,
        id: string,
        patch: Partial<AddressRecord>,
      ): Promise<AddressRecord | null> => {
        const found = this.addressList.find((a) => a.userId === userId && a.id === id);
        if (!found) return null;
        if (patch.isDefault === true) {
          for (const row of this.addressList) {
            if (row.userId === userId) row.isDefault = row.id === id;
          }
        }
        const next: AddressRecord = { ...found, ...patch, id: found.id, userId: found.userId };
        Object.assign(found, next);
        return clone(found);
      },
      remove: async (userId: string, id: string): Promise<void> => {
        this.addressList = this.addressList.filter((a) => !(a.userId === userId && a.id === id));
      },
      setDefault: async (userId: string, id: string): Promise<AddressRecord | null> => {
        const found = this.addressList.find((a) => a.userId === userId && a.id === id);
        if (!found) return null;
        for (const row of this.addressList) {
          if (row.userId === userId) row.isDefault = row.id === id;
        }
        return clone(found);
      },
    },
    /**
     * 满减档位（0017）：内存驱动与 0017 迁移的种子数据保持一致，
     * 单测直接覆盖档位匹配与取整口径，不需要连 PG。
     */
    manjianTiers: {
      // 与 PG 的 `where enabled = true` 对齐：停用档位不参与匹配
      listEnabled: async (): Promise<ManjianTierRecord[]> =>
        clone(MEMORY_MANJIAN_TIERS.filter((tier) => tier.enabled)),
    },
    orders: {
      insert: async (order: OrderRecord, items: OrderItemRecord[]): Promise<OrderRecord> => {
        this.orderList.push(clone(order));
        for (const item of items) this.orderItemList.push(clone(item));
        return clone(order);
      },
      findByOrderNo: async (orderNo: string): Promise<OrderRecord | null> => {
        const found = this.orderList.find((o) => o.orderNo === orderNo);
        return found ? clone(found) : null;
      },
      listByUser: async (userId: string): Promise<OrderRecord[]> =>
        this.orderList
          .filter((o) => o.userId === userId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(clone),
      itemsByOrder: async (orderId: string): Promise<OrderItemRecord[]> =>
        this.orderItemList.filter((i) => i.orderId === orderId).map(clone),
      move: async (ids: string[], userId: string): Promise<number> => {
        const wanted = new Set(ids);
        let moved = 0;
        for (const order of this.orderList) {
          if (!wanted.has(order.id) || order.userId === userId) continue;
          order.userId = userId;
          moved += 1;
        }
        return moved;
      },
      listExpiredPending: async (before: Date): Promise<OrderRecord[]> =>
        this.orderList.filter((o) => o.status === 'pending' && o.createdAt.getTime() < before.getTime()).map(clone),
      transitionStatus: async (
        orderId: string,
        from: OrderRecord['status'],
        to: OrderRecord['status'],
      ): Promise<boolean> => {
        const found = this.orderList.find((o) => o.id === orderId);
        if (!found || found.status !== from) return false;
        found.status = to;
        return true;
      },
      cancel: async (
        orderId: string,
        fromStatuses: OrderRecord['status'][],
        reason: string,
        by: NonNullable<OrderRecord['cancelledBy']>,
      ): Promise<boolean> => {
        const found = this.orderList.find((o) => o.id === orderId);
        // 与 pg 同口径：状态必须命中，且 picking 未发生（picking_at 为空）才允许取消
        if (!found || !fromStatuses.includes(found.status) || found.pickingAt) return false;
        found.status = 'cancelled';
        found.cancelledAt = new Date();
        found.cancelReason = reason;
        found.cancelledBy = by;
        return true;
      },
      markStatusAt: async (
        orderId: string,
        from: OrderRecord['status'],
        to: OrderRecord['status'],
        at: Date,
      ): Promise<boolean> => {
        const found = this.orderList.find((o) => o.id === orderId);
        if (!found || found.status !== from) return false;
        found.status = to;
        // 只给 picking/shipped/completed 打点，其余状态不写时间戳
        if (to === 'picking') found.pickingAt = at;
        if (to === 'shipped') found.shippedAt = at;
        if (to === 'completed') found.completedAt = at;
        return true;
      },
    },
    orderRequests: {
      claim: async (userId: string, key: string) => {
        const existing = this.orderRequestMap.get(`${userId}:${key}`);
        if (existing) return { claimed: false, orderNo: existing.orderNo };
        this.orderRequestMap.set(`${userId}:${key}`, { orderNo: null });
        return { claimed: true, orderNo: null };
      },
      attach: async (userId: string, key: string, orderNo: string) => {
        this.orderRequestMap.set(`${userId}:${key}`, { orderNo });
      },
      release: async (userId: string, key: string) => {
        this.orderRequestMap.delete(`${userId}:${key}`);
      },
      dropByUser: async (userId: string) => {
        const prefix = `${userId}:`;
        for (const key of [...this.orderRequestMap.keys()]) {
          if (key.startsWith(prefix)) this.orderRequestMap.delete(key);
        }
      },
    },
    favorites: {
      listFolders: async (userId: string): Promise<FavoriteFolderRecord[]> =>
        this.favoriteFolderList
          .filter((f) => f.userId === userId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone),
      findFolder: async (userId: string, folderId: string): Promise<FavoriteFolderRecord | null> => {
        const found = this.favoriteFolderList.find((f) => f.id === folderId && f.userId === userId);
        return found ? clone(found) : null;
      },
      insertFolder: async (folder: FavoriteFolderRecord): Promise<FavoriteFolderRecord> => {
        this.favoriteFolderList.push(clone(folder));
        return clone(folder);
      },
      updateFolder: async (
        userId: string,
        folderId: string,
        patch: { name?: string; isDefault?: boolean },
      ): Promise<FavoriteFolderRecord | null> => {
        const found = this.favoriteFolderList.find((f) => f.id === folderId && f.userId === userId);
        if (!found) return null;
        if (patch.name !== undefined) found.name = patch.name;
        if (patch.isDefault !== undefined) {
          // 与 pg 部分唯一索引同口径：置为默认时先把同用户其它夹的默认位清掉
          if (patch.isDefault) {
            for (const other of this.favoriteFolderList) {
              if (other.userId === userId) other.isDefault = other.id === folderId;
            }
          } else {
            found.isDefault = false;
          }
        }
        found.updatedAt = new Date();
        return clone(found);
      },
      setDefault: async (userId: string, folderId: string): Promise<FavoriteFolderRecord | null> => {
        const target = this.favoriteFolderList.find((f) => f.id === folderId && f.userId === userId);
        if (!target) return null;
        for (const other of this.favoriteFolderList) {
          if (other.userId === userId) other.isDefault = other.id === folderId;
        }
        target.updatedAt = new Date();
        return clone(target);
      },
      listItems: async (folderId: string): Promise<FavoriteItemRecord[]> =>
        this.favoriteItemList
          .filter((item) => item.folderId === folderId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(clone),
      insertItem: async (item: FavoriteItemRecord): Promise<FavoriteItemRecord> => {
        const existing = this.favoriteItemList.find(
          (i) => i.folderId === item.folderId && i.productId === item.productId,
        );
        if (existing) return clone(existing);
        this.favoriteItemList.push(clone(item));
        return clone(item);
      },
      deleteItem: async (folderId: string, productId: string): Promise<boolean> => {
        const before = this.favoriteItemList.length;
        this.favoriteItemList = this.favoriteItemList.filter(
          (i) => !(i.folderId === folderId && i.productId === productId),
        );
        return this.favoriteItemList.length !== before;
      },
      clearItems: async (folderId: string): Promise<number> => {
        const before = this.favoriteItemList.length;
        this.favoriteItemList = this.favoriteItemList.filter((i) => i.folderId !== folderId);
        return before - this.favoriteItemList.length;
      },
      countItems: async (folderId: string): Promise<number> =>
        this.favoriteItemList.filter((i) => i.folderId === folderId).length,
    },
  };

  merges = {
    insert: async (record: AccountMergeRecord): Promise<AccountMergeRecord> => {
      if (this.mergeList.some((m) => m.mergeKey === record.mergeKey)) {
        throw Object.assign(new Error('duplicate key: account_merges merge_key'), { code: '23505' });
      }
      this.mergeList.push(clone(record));
      return clone(record);
    },
    findByKey: async (mergeKey: string): Promise<AccountMergeRecord | null> => {
      const found = this.mergeList.find((m) => m.mergeKey === mergeKey);
      return found ? clone(found) : null;
    },
    findById: async (id: string): Promise<AccountMergeRecord | null> => {
      const found = this.mergeList.find((m) => m.id === id);
      return found ? clone(found) : null;
    },
    list: async (limit: number): Promise<AccountMergeRecord[]> =>
      this.mergeList
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
        .map(clone),
    update: async (
      id: string,
      patch: Partial<AccountMergeRecord>,
    ): Promise<AccountMergeRecord | null> => {
      const idx = this.mergeList.findIndex((m) => m.id === id);
      if (idx < 0) return null;
      this.mergeList[idx] = { ...this.mergeList[idx], ...patch } as AccountMergeRecord;
      return clone(this.mergeList[idx]);
    },
    findCandidates: async (): Promise<MergeCandidate[]> => {
      const byUnion = new Map<string, BindingRecord[]>();
      for (const binding of this.bindingList) {
        if (!binding.unionId) continue;
        const list = byUnion.get(binding.unionId) ?? [];
        list.push(binding);
        byUnion.set(binding.unionId, list);
      }
      const candidates: MergeCandidate[] = [];
      for (const [unionId, list] of byUnion) {
        const userIds = [...new Set(list.map((b) => b.userId))];
        if (userIds.length > 1) {
          candidates.push({ unionId, userIds, bindingIds: list.map((b) => b.id) });
        }
      }
      return candidates;
    },
  };

  /**
   * 后台运营台数据面（内存实现）。
   * 与 PgStore 同口径：关键字大小写不敏感、按创建时间倒序、total 为筛选后总数。
   */
  admin = {
    counts: async (): Promise<AdminCounts> => {
      // 用户侧把 listed=false 视为下架；这里把「未显式下架」都算作在架。
      const listedCount = this.productList.filter((p) => p.listed !== false).length;
      const byStatus: AdminCounts['orders']['byStatus'] = {
        pending: 0,
        paid: 0,
        picking: 0,
        shipped: 0,
        completed: 0,
        cancelled: 0,
      };
      for (const order of this.orderList) byStatus[order.status] += 1;
      return {
        products: {
          total: this.productList.length,
          listed: listedCount,
          unlisted: this.productList.length - listedCount,
          // 目录商品以 sourceKey（sku:/url: 稳定键）判定
          catalog: this.productList.filter((p) => Boolean(p.sourceKey)).length,
        },
        users: {
          total: this.userList.length,
          active: this.userList.filter((u) => u.status === 'active').length,
          guests: this.userList.filter((u) => u.guest).length,
          frozen: this.userList.filter((u) => u.status === 'frozen').length,
        },
        orders: { total: this.orderList.length, byStatus },
        favorites: {
          folders: this.favoriteFolderList.length,
          items: this.favoriteItemList.length,
        },
        carts: {
          items: this.cartList.length,
          users: new Set(this.cartList.map((c) => c.userId)).size,
        },
      };
    },
    listProducts: async (
      filter: AdminProductFilter,
    ): Promise<{ rows: ProductRecord[]; total: number }> => {
      const keyword = (filter.keyword ?? '').trim().toLowerCase();
      const matched = this.productList.filter((p) => {
        // listed 未传即不过滤；传了则按「是否在架」精确命中
        if (filter.listed !== undefined && (p.listed !== false) !== filter.listed) return false;
        if (filter.category && p.category !== filter.category) return false;
        if (!keyword) return true;
        return [p.title, p.sourceItemNo, p.brand, p.sourceId, p.id].some((value) =>
          String(value ?? '')
            .toLowerCase()
            .includes(keyword),
        );
      });
      const sorted = matched
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return {
        rows: sorted.slice(filter.offset, filter.offset + filter.limit).map(clone),
        total: sorted.length,
      };
    },
    setProductsListed: async (ids: string[], listed: boolean): Promise<number> => {
      const wanted = new Set(ids);
      let changed = 0;
      for (const product of this.productList) {
        if (!wanted.has(product.id)) continue;
        // 已经是目标状态的商品不重复计数，避免审计记录虚增
        if ((product.listed !== false) === listed) continue;
        product.listed = listed;
        changed += 1;
      }
      return changed;
    },
    listOrders: async (
      filter: AdminOrderFilter,
    ): Promise<{ rows: OrderRecord[]; total: number }> => {
      const keyword = (filter.keyword ?? '').trim().toLowerCase();
      const matched = this.orderList.filter((order) => {
        if (filter.status && order.status !== filter.status) return false;
        if (!keyword) return true;
        return [order.orderNo, order.receiverName, order.receiverPhone, order.userId, order.id].some(
          (value) =>
            String(value ?? '')
              .toLowerCase()
              .includes(keyword),
        );
      });
      const sorted = matched
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return {
        rows: sorted.slice(filter.offset, filter.offset + filter.limit).map(clone),
        total: sorted.length,
      };
    },
    getOrder: async (orderId: string): Promise<OrderRecord | null> => {
      const found = this.orderList.find((order) => order.id === orderId);
      return found ? clone(found) : null;
    },
    listUsers: async (
      filter: AdminUserFilter,
    ): Promise<{ rows: UserRecord[]; total: number }> => {
      const keyword = (filter.keyword ?? '').trim().toLowerCase();
      const matched = this.userList.filter((user) => {
        if (!keyword) return true;
        return [user.accountNo, user.nickname, user.username, user.phone, user.email, user.id].some(
          (value) =>
            String(value ?? '')
              .toLowerCase()
              .includes(keyword),
        );
      });
      const sorted = matched
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return {
        rows: sorted.slice(filter.offset, filter.offset + filter.limit).map(clone),
        total: sorted.length,
      };
    },
    userSummary: async (userId: string): Promise<AdminUserSummary | null> => {
      const user = this.userList.find((u) => u.id === userId);
      if (!user) return null;
      return {
        bindings: this.bindingList.filter((b) => b.userId === userId).map(clone),
        orders: this.orderList.filter((o) => o.userId === userId).length,
        favoriteFolders: this.favoriteFolderList.filter((f) => f.userId === userId).length,
        favoriteItems: this.favoriteItemList.filter((i) => i.userId === userId).length,
        cartItems: this.cartList.filter((c) => c.userId === userId).length,
      };
    },
    listFavoriteFolders: async (filter: {
      limit: number;
      offset: number;
    }): Promise<{ rows: AdminFavoriteFolderRow[]; total: number }> => {
      const sorted = this.favoriteFolderList
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const rows = sorted.slice(filter.offset, filter.offset + filter.limit).map((folder) => {
        const owner = this.userList.find((u) => u.id === folder.userId) ?? null;
        return {
          ...clone(folder),
          itemCount: this.favoriteItemList.filter((i) => i.folderId === folder.id).length,
          userNickname: owner?.nickname ?? null,
          userAccountNo: owner?.accountNo ?? null,
        };
      });
      return { rows, total: sorted.length };
    },
    listManjianTiers: async (): Promise<ManjianTierRecord[]> =>
      MEMORY_MANJIAN_TIERS.slice()
        .sort((a, b) => a.sortNo - b.sortNo)
        .map(clone),
    audit: {
      append: async (entry: AdminAuditRecord): Promise<void> => {
        this.auditList.push(clone(entry));
      },
      list: async (limit: number, offset = 0): Promise<AdminAuditRecord[]> =>
        this.auditList
          .slice()
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(offset, offset + limit)
          .map(clone),
    },
  };
}
