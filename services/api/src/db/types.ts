import type { OAuthProviderKey } from '@mixmapp/contracts';

export type UserRecord = {
  id: string;
  accountNo: string;
  snowflake: string;
  ulid: string;
  uuidV7: string;
  nickname: string;
  avatarUrl: string | null;
  bio: string | null;
  /** 用户名（唯一，可空）；密码登录与用户名注册都依赖它 */
  username: string | null;
  /** 游客账号标记；绑定手机号/邮箱/第三方或补设用户名后置 false */
  guest: boolean;
  phone: string | null;
  email: string | null;
  passwordHash: string | null;
  status: 'active' | 'frozen';
  createdAt: Date;
  updatedAt: Date;
};

/** 第三方渠道与 contracts 同源；'guest' 是设备绑定，不属于 OAuth。 */
export type BindingProvider = OAuthProviderKey | 'guest';

export type BindingRecord = {
  id: string;
  userId: string;
  provider: BindingProvider;
  openId: string;
  unionId: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  createdAt: Date;
};

/** 一次性的 OAuth state 票据：写入后只能被 claim 一次，过期即失效。 */
export type OAuthStateRecord = {
  state: string;
  provider: string;
  /** 登录成功后回到的前端页面 */
  redirect: string;
  /** 发起授权时使用的回调地址，换 token 必须与之一致 */
  redirectUri: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
};

export type RefreshTokenRecord = {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
  createdAt: Date;
};

export type SmsCodeRecord = {
  id: string;
  phone: string;
  purpose: 'register' | 'login' | 'bind';
  codeHash: string;
  attempts: number;
  consumedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
};

export type PaymentRecord = {
  id: string;
  outTradeNo: string;
  userId: string;
  channel: 'wechat' | 'alipay';
  amountFen: number;
  subject: string;
  status: 'pending' | 'paid' | 'failed' | 'closed';
  prepay: Record<string, unknown> | null;
  transactionId: string | null;
  paidAt: Date | null;
  createdAt: Date;
};

export type PushTokenRecord = {
  id: string;
  userId: string;
  provider: 'fcm' | 'jpush';
  platform: 'android' | 'ios' | 'harmony' | 'web';
  token: string;
  createdAt: Date;
};

export type ProductRecord = {
  id: string;
  title: string;
  subtitle: string;
  priceFen: number;
  originalPriceFen: number;
  stock: number;
  category: string;
  cover: string;
  images: string[];
  tags: string[];
  description: string;
  sortNo: number;
  createdAt: Date;
  // ===== 目录导入增补字段（旧商品可空，零影响） =====
  /** 幂等稳定键：`sku:<型号>` 或 `url:<规范化URL>`，唯一索引 */
  sourceKey?: string | null;
  sourceUrl?: string | null;
  sourceId?: string | null;
  brand?: string | null;
  /** 完整分类路径，一级到三级 */
  categoryPath?: string[];
  /** 一级分类中文名 */
  categoryName?: string | null;
  specs?: Record<string, string>;
  unit?: string | null;
  packQty?: number | null;
  priceSource?: 'anonymous' | 'login' | 'inquiry' | null;
  priceCapturedAt?: string | null;
  stockSource?: 'anonymous' | 'unknown' | null;
  /**
   * 导入批次号。重复导入同一批会刷新为本次 batch；
   * 运营在后台人工改过 title/category/stock/sortNo 的记录会被置为 `manual`，
   * 此后导入 upsert 不再覆盖这些运营侧字段（见 memory/postgres 的 upsert 实现）。
   */
  importBatch?: string | null;
  // ===== 详情页结构化字段（0007，旧商品可空/默认，零影响） =====
  /** 类目属性 key-value（等级/材质/标准/牙别/表面处理/品名…按类目实际存在形态） */
  attributes?: Record<string, string>;
  /** 面价，厘/支（源站元/千支） */
  priceLi?: number | null;
  /** 折扣百分比，100 = 无折扣 */
  discountPct?: number | null;
  /** 特价，厘/支 */
  salePriceLi?: number | null;
  /** 优惠活动文案与有效期 */
  promotions?: Array<{ text: string; kind?: string; validFrom?: string; validTo?: string }>;
  /** 包装换算文案原文 */
  packagingDesc?: string | null;
  /** 购买方式 [{code,name}] */
  unitOptions?: Array<{ code: string; name: string }>;
  /** 单位换算 { 单位代码: 每单位支数 } */
  unitConversions?: Record<string, number>;
  /** 商品详图（按三级类目共享） */
  specImage?: string | null;
  /** 源站详情键（列表 no） */
  sourceItemNo?: string | null;
  minOrderQty?: number;
  qtyStep?: number;
  maxOrderQty?: number;
  /** 源站在售标记：false 表示源站已下架，商品保留但不可售 */
  listed?: boolean;
};

export type CartItemRecord = {
  id: string;
  userId: string;
  productId: string;
  /** 支数（含包装换算后的总需求支数） */
  quantity: number;
  packUnit?: string | null;
  packQty?: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OrderItemRecord = {
  id: string;
  orderId: string;
  productId: string;
  title: string;
  priceFen: number;
  quantity: number;
  subtotalFen: number;
  packUnit?: string | null;
  packQty?: number | null;
  /** 精确单价，厘/支 */
  priceLi?: number | null;
};

export type OrderRecord = {
  id: string;
  orderNo: string;
  userId: string;
  status: 'pending' | 'paid' | 'cancelled';
  totalFen: number;
  receiverName: string;
  receiverPhone: string;
  address: string;
  remark: string | null;
  createdAt: Date;
  paidAt: Date | null;
};

/** 账号合并的触发原因；审计与前端提示都依赖它。 */
export type MergeReason = 'bind_phone' | 'oauth_union' | 'admin';
/** pending 只在快照写入后、迁移完成前短暂存在；完成后不允许停留在 pending。 */
export type MergeStatus = 'pending' | 'completed' | 'failed' | 'rolled_back';

/** 合并前快照：足以把两个账号恢复到合并前的样子（刷新令牌只能吊销，无法恢复）。 */
export type MergeSnapshot = {
  takenAt: string;
  primary: UserRecord;
  secondary: UserRecord;
  bindings: BindingRecord[];
  carts: CartItemRecord[];
  orderIds: string[];
  paymentIds: string[];
  pushTokenIds: string[];
  refreshTokenHashes: string[];
};

/** 合并实际发生了什么，便于审计与对账。 */
export type MergeMoved = {
  bindings: number;
  droppedBindings: string[];
  carts: number;
  cartConflicts: Array<{ productId: string; primaryQty: number; secondaryQty: number; resultQty: number }>;
  orders: number;
  payments: number;
  pushTokens: number;
  refreshTokensRevoked: number;
  profileFieldsFilled: string[];
};

export type AccountMergeRecord = {
  id: string;
  /** 幂等键：同一对账号重复提交只会执行一次 */
  mergeKey: string;
  primaryUserId: string;
  secondaryUserId: string;
  reason: MergeReason;
  status: MergeStatus;
  snapshot: MergeSnapshot;
  moved: MergeMoved | null;
  /** 冲突策略快照（订单/购物车/绑定各自怎么处理），审计时不用猜 */
  conflictStrategy: Record<string, string>;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
  rolledBackAt: Date | null;
};

/** 历史重复账号候选：同一 union_id 出现在多个账号下，需要人工/流程合并。 */
export type MergeCandidate = {
  unionId: string;
  userIds: string[];
  bindingIds: string[];
};

export type Store = {
  driver: 'memory' | 'postgres';
  ping(): Promise<boolean>;
  close(): Promise<void>;

  users: {
    insert(user: UserRecord): Promise<UserRecord>;
    findById(id: string): Promise<UserRecord | null>;
    findByPhone(phone: string): Promise<UserRecord | null>;
    findByEmail(email: string): Promise<UserRecord | null>;
    findByUsername(username: string): Promise<UserRecord | null>;
    findByAccountNo(accountNo: string): Promise<UserRecord | null>;
    update(id: string, patch: Partial<UserRecord>): Promise<UserRecord | null>;
    /** 合并完成后删除次账号；调用前必须已迁移全部外键数据 */
    delete(id: string): Promise<void>;
  };
  bindings: {
    insert(binding: BindingRecord): Promise<BindingRecord>;
    findByProvider(provider: BindingRecord['provider'], openId: string): Promise<BindingRecord | null>;
    /** union_id 跨渠道聚合：同一微信开放平台下的公众号/网站应用会共享它 */
    findByUnionId(unionId: string): Promise<BindingRecord[]>;
    listByUser(userId: string): Promise<BindingRecord[]>;
    remove(userId: string, provider: BindingRecord['provider']): Promise<void>;
    /** 按 id 批量改归属（合并迁移与回滚都用它，重复执行是幂等的） */
    move(ids: string[], userId: string): Promise<number>;
  };
  oauthStates: {
    insert(record: OAuthStateRecord): Promise<void>;
    /** 原子消费：未使用且未过期才返回并标记 consumed_at，重复调用返回 null。 */
    claim(state: string): Promise<OAuthStateRecord | null>;
    purgeExpired(before: Date): Promise<void>;
  };
  refreshTokens: {
    insert(token: RefreshTokenRecord): Promise<void>;
    findByHash(hash: string): Promise<RefreshTokenRecord | null>;
    revoke(hash: string, replacedBy?: string | null): Promise<void>;
    /** 合并审计用：列出某账号的全部刷新令牌（只取未吊销的） */
    listActiveByUser(userId: string): Promise<RefreshTokenRecord[]>;
    /** 合并时吊销次账号全部会话；返回实际吊销条数 */
    revokeByUser(userId: string): Promise<number>;
  };
  smsCodes: {
    insert(code: SmsCodeRecord): Promise<void>;
    latest(phone: string, purpose: SmsCodeRecord['purpose']): Promise<SmsCodeRecord | null>;
    update(id: string, patch: Partial<SmsCodeRecord>): Promise<void>;
  };
  payments: {
    insert(payment: PaymentRecord): Promise<PaymentRecord>;
    findByOutTradeNo(outTradeNo: string): Promise<PaymentRecord | null>;
    listByUser(userId: string): Promise<PaymentRecord[]>;
    update(id: string, patch: Partial<PaymentRecord>): Promise<PaymentRecord | null>;
    move(ids: string[], userId: string): Promise<number>;
  };
  pushTokens: {
    upsert(record: PushTokenRecord): Promise<void>;
    listByUser(userId: string): Promise<PushTokenRecord[]>;
    move(ids: string[], userId: string): Promise<number>;
    remove(ids: string[]): Promise<void>;
  };
  mall: {
    products: {
      insert(product: ProductRecord): Promise<ProductRecord>;
      list(filter: {
        category?: string;
        cat?: string;
        dims?: string;
        lens?: string;
        keyword?: string;
        limit: number;
        offset: number;
      }): Promise<ProductRecord[]>;
      /**
       * 分类树逐层读取：parentId 为空取一级类目，否则取该节点的直接子级。
       * 只返回 is_active 且 product_count > 0 的节点（空分类不显示空壳）。
       */
      listChildCategories(
        parentId: string | null,
      ): Promise<Array<{ id: string; code: string; name: string; level: number; count: number }>>;
      /** 某三级类目下商品实际出现的规格候选（dims / lens），无数据时为空数组。 */
      listSpecOptions(c3Id: string): Promise<{ dims: string[]; lens: string[] }>;
      /**
       * 是否存在「真实目录商品」：以 source_key 非空为判据（0002 演示品、测试夹具都不带）。
       * MALL_CATALOG_SOURCE=auto 时用它决定要不要让内嵌只读目录源接管公开读。
       */
      hasCatalogProducts(): Promise<boolean>;
      /**
       * 全量按 category 真聚合（PG group by / memory 统计 Map），不经过分页 list；
       * 返回 [{ code, name, count }]，count 为该分类全量条数。
       */
      aggregateCategories(): Promise<Array<{ code: string; name: string; count: number }>>;
      findById(id: string): Promise<ProductRecord | null>;
      /**
       * 按 sourceKey 幂等 upsert：不存在则整行插入；已存在则只刷新导入侧字段。
       * 运营侧字段（title/category/stock/sortNo）仅在记录未被人工标记（importBatch='manual'）时刷新。
       */
      upsert(
        record: ProductRecord,
      ): Promise<{ record: ProductRecord; action: 'inserted' | 'updated' }>;
      /** 扣减库存，库存不足返回 false（并发安全由实现侧保证） */
      decrementStock(id: string, quantity: number): Promise<boolean>;
      /** 归还库存：多行下单中途失败时回滚已扣的库存，避免库存凭空消失 */
      restoreStock(id: string, quantity: number): Promise<void>;
    };
    carts: {
      listByUser(userId: string): Promise<CartItemRecord[]>;
      find(userId: string, productId: string): Promise<CartItemRecord | null>;
      upsert(item: CartItemRecord): Promise<CartItemRecord>;
      remove(userId: string, productId: string): Promise<void>;
      clear(userId: string): Promise<void>;
      /** 用给定行整体替换某用户购物车（合并回滚按快照还原时使用） */
      replaceAll(userId: string, items: CartItemRecord[]): Promise<void>;
    };
    orders: {
      insert(order: OrderRecord, items: OrderItemRecord[]): Promise<OrderRecord>;
      findByOrderNo(orderNo: string): Promise<OrderRecord | null>;
      listByUser(userId: string): Promise<OrderRecord[]>;
      itemsByOrder(orderId: string): Promise<OrderItemRecord[]>;
      /** 订单归属迁移：订单号不变，只换 userId */
      move(ids: string[], userId: string): Promise<number>;
      /** 待支付且创建时间早于 before 的订单（超时取消扫描用） */
      listExpiredPending(before: Date): Promise<OrderRecord[]>;
      /** 条件状态流转：只有当前状态等于 from 才改成 to，返回是否真的改了（并发安全） */
      transitionStatus(orderId: string, from: OrderRecord['status'], to: OrderRecord['status']): Promise<boolean>;
    };
    /** 下单幂等表：claim 占位 → attach 回写 order_no，并发重试不会重复扣库存 */
    orderRequests: {
      /** 抢占幂等键：插入成功返回 claimed；已存在返回 exists 与已有 orderNo（可能还没回写） */
      claim(userId: string, key: string): Promise<{ claimed: boolean; orderNo: string | null }>;
      attach(userId: string, key: string, orderNo: string): Promise<void>;
      /** 下单失败时释放占位，允许客户端用同一个键重试 */
      release(userId: string, key: string): Promise<void>;
      /** 账号合并：次账号的幂等占位整体丢弃（合并后旧键不再有意义） */
      dropByUser(userId: string): Promise<void>;
    };
  };
  /** 账号合并审计与快照；同一 mergeKey 只允许一条记录 */
  merges: {
    insert(record: AccountMergeRecord): Promise<AccountMergeRecord>;
    findByKey(mergeKey: string): Promise<AccountMergeRecord | null>;
    findById(id: string): Promise<AccountMergeRecord | null>;
    list(limit: number): Promise<AccountMergeRecord[]>;
    update(id: string, patch: Partial<AccountMergeRecord>): Promise<AccountMergeRecord | null>;
    /** 真实重复账号统计：同一 union_id 落在多个用户上 */
    findCandidates(): Promise<MergeCandidate[]>;
  };
};
