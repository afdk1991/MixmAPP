import type {
  BindingRecord,
  CartItemRecord,
  OrderItemRecord,
  OrderRecord,
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
  private tokenList: RefreshTokenRecord[] = [];
  private smsList: SmsCodeRecord[] = [];
  private paymentList: PaymentRecord[] = [];
  private pushList: PushTokenRecord[] = [];
  private productList: ProductRecord[] = [];
  private cartList: CartItemRecord[] = [];
  private orderList: OrderRecord[] = [];
  private orderItemList: OrderItemRecord[] = [];
  private orderRequestMap = new Map<string, { orderNo: string | null }>();

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.userList = [];
    this.bindingList = [];
    this.tokenList = [];
    this.smsList = [];
    this.paymentList = [];
    this.pushList = [];
    this.productList = [];
    this.cartList = [];
    this.orderList = [];
    this.orderItemList = [];
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
  };

  bindings = {
    insert: async (binding: BindingRecord): Promise<BindingRecord> => {
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
    listByUser: async (userId: string): Promise<BindingRecord[]> => {
      return this.bindingList.filter((b) => b.userId === userId).map(clone);
    },
    remove: async (userId: string, provider: BindingRecord['provider']): Promise<void> => {
      this.bindingList = this.bindingList.filter(
        (b) => !(b.userId === userId && b.provider === provider),
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
    update: async (id: string, patch: Partial<PaymentRecord>): Promise<PaymentRecord | null> => {
      const idx = this.paymentList.findIndex((p) => p.id === id);
      if (idx < 0) return null;
      this.paymentList[idx] = { ...this.paymentList[idx], ...patch } as PaymentRecord;
      return clone(this.paymentList[idx]);
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
  };

  mall = {
    products: {
      insert: async (product: ProductRecord): Promise<ProductRecord> => {
        this.productList.push(clone(product));
        return clone(product);
      },
      list: async (filter: { category?: string; keyword?: string; limit: number; offset: number }): Promise<ProductRecord[]> => {
        const keyword = filter.keyword?.toLowerCase();
        return this.productList
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
          const existing = byCode.get(p.category);
          if (existing) existing.count += 1;
          else byCode.set(p.category, { code: p.category, name: p.categoryName ?? p.category, count: 1 });
        }
        return [...byCode.values()];
      },
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
    },
  };
}
