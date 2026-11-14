import type {
  AccountMergeRecord,
  BindingRecord,
  CartItemRecord,
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
  private orderList: OrderRecord[] = [];
  private orderItemList: OrderItemRecord[] = [];
  private orderRequestMap = new Map<string, { orderNo: string | null }>();
  private mergeList: AccountMergeRecord[] = [];

  async ping(): Promise<boolean> {
    return true;
  }

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
    this.orderList = [];
    this.orderItemList = [];
    this.orderRequestMap.clear();
    this.mergeList = [];
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
        dims?: string;
        lens?: string;
        keyword?: string;
        limit: number;
        offset: number;
      }): Promise<ProductRecord[]> => {
        // 内存实现没有分类树与规格数据：树节点/规格筛选下无商品可返回，保持与 PG 口径一致。
        if (filter.cat || filter.dims || filter.lens) return [];
        const keyword = filter.keyword?.toLowerCase();
        return this.productList
          .filter((p) => p.listed !== false)
          .filter((p) => (filter.category ? p.category === filter.category : true))
          .filter((p) =>
            keyword ? p.title.toLowerCase().includes(keyword) || p.subtitle.toLowerCase().includes(keyword) : true,
          )
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
      listChildCategories: async (parentId: string | null) => {
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
      listSpecOptions: async () => ({ dims: [], lens: [] }),
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
}
