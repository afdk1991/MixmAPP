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
  /**
   * 隐私政策同意记录（注册时取得）。落库而非只存本机，便于合规审计：
   * 版本号变了即视为未同意新政策，可在下一版重新征得同意。
   */
  privacyConsent: PrivacyConsentRecord | null;
  createdAt: Date;
  updatedAt: Date;
};

/** 一次隐私政策同意：政策版本、同意时间、本机存储通道、注册来源（如 register:phone/android）。 */
export type PrivacyConsentRecord = {
  version: string;
  acceptedAt: Date;
  channel: 'web' | 'native';
  source: string;
};

/** 绑定渠道：内置渠道与注册表里的通用渠道共用一个字符串标识；'guest' 是设备绑定。 */
export type BindingProvider = string;

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
  // ===== 0021 设备与网络快照（全部 nullable，老会话/老客户端为 null，向后兼容） =====
  /** 登录设备号；取不到为 null */
  deviceId: string | null;
  /** 机型；取不到为空串 */
  deviceModel: string | null;
  /** 系统名：Android / iOS / Web */
  osName: string | null;
  /** 系统版本；取不到为空串 */
  osVersion: string | null;
  /** 网络类型：wifi / cellular / ethernet / none */
  networkType: string | null;
  /** 运营商名；取不到为空串，不填假值 */
  carrier: string | null;
  /** 服务端看到的来源 IP（XFF 首跳回落直连地址），不采信客户端上报 */
  clientIp: string | null;
};

/**
 * 用户每台设备的最近一次快照（0021，user_devices 主键 (user_id, device_id)）。
 * 与 refresh_tokens 的区别：本表跨会话保留同一设备的最新状态，供后台「最近一次登录设备」与本人展示。
 */
export type UserDeviceRecord = {
  userId: string;
  deviceId: string;
  deviceModel: string;
  osName: string;
  osVersion: string;
  networkType: string;
  carrier: string;
  clientIp: string;
  updatedAt: Date;
};

/** 注销设备挑战票据：一次性、绑定 (userId, deviceId)，5 分钟过期。 */
export type DeletionChallengeRecord = {
  challenge: string;
  userId: string;
  deviceId: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

/** 注销级联删除 / 脱敏的结果计数（接口响应与对账用）。 */
export type DeletionCascadeCounts = {
  binds: number;
  devices: number;
  addresses: number;
  favorites: number;
  carts: number;
  pushTokens: number;
  ordersAnonymized: number;
  paymentsAnonymized: number;
  revokedSessions: number;
  /** 账号合并审计记录中快照被覆写为墓碑的条数（行保留，不整行删除） */
  mergeRecordsRedacted: number;
};

/** 后台会话摘要（/admin/console/users/:id/sessions）：令牌只返哈希前缀，不返原文。 */export type AdminUserSessionSummary = {
  /** 刷新令牌哈希前 8 位，仅用于区分会话 */
  id: string;
  createdAt: Date;
  revokedAt: Date | null;
  deviceId: string | null;
  model: string;
  osName: string | null;
  osVersion: string;
  networkType: string | null;
  carrier: string;
  ip: string | null;
  /** user_devices 中该设备的 updated_at；没有快照则回会话 created_at */
  lastSeenAt: Date | null;
};

export type SmsCodeRecord = {
  id: string;
  phone: string;
  purpose: 'register' | 'login' | 'bind' | 'delete';
  codeHash: string;
  attempts: number;
  consumedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
};

export type PaymentRecord = {
  id: string;
  outTradeNo: string;
  /** 注销 / 留存脱敏后置空，留行对账但不回连个人身份 */
  userId: string | null;
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
  /** 源站特价折扣百分比（`tejiaD2N2`）。0/缺失为 null 表示非特价；只透传，不参与价格派生。 */
  tejiaDiscountPct?: number | null;
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
  /** 源站原始在售标记（onSale），用于区分「下架」与「缺货」 */
  sourceOnSale?: boolean | null;
  /** 源站库存状态原文（invStatusDesc）。有值时优先于假设库存决定能否下单。 */
  sourceInvStatus?: string | null;
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

/** 收货地址（0014）。源站口径：省/市/区三级 + 详细地址，收货人与手机号随地址保存。 */
export type AddressRecord = {
  id: string;
  userId: string;
  receiverName: string;
  receiverPhone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  /** 同一用户至多一条默认地址 */
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CatalogSyncRunRecord = {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'partial' | 'failed' | string;
  stats: Record<string, unknown> | null;
  reportPath: string | null;
  /** 失败摘要（单行、最长 500 字），健康检查直接展示 */
  error: string | null;
};

/** 行状态四态（与 @mixmapp/contracts 的 CartLineStatus 同构，store 层不反向依赖 contracts） */
export type StoredCartLineStatus = 'R' | 'L' | 'A' | 'X';

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
  /** 下单时货源未确认（仅匿名视图推断缺货），需人工确认后再发货 */
  stockUnconfirmed?: boolean;
  /** 下单时的行状态快照（0017）：R 需求 / L 缺货 / A 到货 / X 下架；历史订单为 A */
  lineStatus?: StoredCartLineStatus;
};

/** 收藏夹（0019）：一个用户可建多个，恰好一个为默认收藏夹 */
export type FavoriteFolderRecord = {
  id: string;
  userId: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** 收藏条目（0019）：只存商品引用，不落价格快照 */
export type FavoriteItemRecord = {
  id: string;
  folderId: string;
  userId: string;
  productId: string;
  createdAt: Date;
};

/**
 * 满减梯度档位（0017）：`min~max → percent%`，金额单位统一为分。
 * min 含、max 不含，max 为 null 表示无上限。
 */
export type ManjianTierRecord = {
  id: string;
  minFen: number;
  maxFen: number | null;
  /** 档位折扣百分比，2 表示减免 2% */
  percent: number;
  label: string;
  enabled: boolean;
  sortNo: number;
};

export type OrderRecord = {
  id: string;
  orderNo: string;
  /** 注销 / 留存脱敏后置空，留行对账但不回连个人身份 */
  userId: string | null;
  /** 六态订单状态（0018）：pending/paid/picking/shipped/completed/cancelled */
  status: 'pending' | 'paid' | 'picking' | 'shipped' | 'completed' | 'cancelled';
  totalFen: number;
  receiverName: string;
  receiverPhone: string;
  address: string;
  /** 下单时选择的地址簿 id（手填地址的历史订单为 null） */
  addressId: string | null;
  /** 配送方式代码：express=快递配送 / pickup=门店自提 */
  deliveryMethod: string | null;
  /** 配送时间段代码（见 deliveryOptions） */
  deliverySlot: string | null;
  remark: string | null;
  /** 三层优惠快照（0017）：面价小计与各层优惠，均为整数分；历史订单缺省为 0 */
  subtotalFen?: number;
  mallDiscountFen?: number;
  tejiaDiscountFen?: number;
  manjianDiscountFen?: number;
  discountTotalFen?: number;
  createdAt: Date;
  paidAt: Date | null;
  /** 进入拣货时间（0018）：非空即已分配拣货，此后禁止取消 */
  pickingAt?: Date | null;
  /** 发货时间（0018） */
  shippedAt?: Date | null;
  /** 完成时间（0018） */
  completedAt?: Date | null;
  /** 取消时间（0018） */
  cancelledAt?: Date | null;
  /** 取消原因（0018） */
  cancelReason?: string | null;
  /** 取消方（0018）：user / system / admin */
  cancelledBy?: 'user' | 'system' | 'admin' | null;
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

  /** 运维观测：不参与业务，缺表/无记录都返回 null，不让健康检查失败 */
  ops: {
    /** 最近一次目录同步运行（catalog_sync_runs 最新一行） */
    lastCatalogSyncRun(): Promise<CatalogSyncRunRecord | null>;
  };

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
  /** 注销设备挑战票据：一次性消费，过期即失效。 */
  accountChallenges: {
    insert(record: DeletionChallengeRecord): Promise<void>;
    /** 原子消费：未使用且未过期才返回并标记 consumed_at，重复调用返回 null。 */
    consume(challenge: string): Promise<DeletionChallengeRecord | null>;
    /** 留存清理：已消费或已过期且早于 before 的票据物理删除，返回条数。 */
    purgeStale(before: Date): Promise<number>;
  };
  /** 账号注销级联：物理清除个人数据 + 订单/支付留行脱敏。PG 走单事务函数，内存库顺序执行。 */
  accountDeletion: {
    erase(userId: string): Promise<DeletionCascadeCounts>;
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
    /** 注销级联：物理删除该用户全部绑定，返回删除条数。 */
    deleteByUser(userId: string): Promise<number>;
  };
  oauthStates: {
    insert(record: OAuthStateRecord): Promise<void>;
    /** 原子消费：未使用且未过期才返回并标记 consumed_at，重复调用返回 null。 */
    claim(state: string): Promise<OAuthStateRecord | null>;
    purgeExpired(before: Date): Promise<void>;
    /** 留存清理：已消费或已过期且早于 before 的票据物理删除，返回条数。 */
    purgeStale(before: Date): Promise<number>;
  };
  refreshTokens: {
    insert(token: RefreshTokenRecord): Promise<void>;
    findByHash(hash: string): Promise<RefreshTokenRecord | null>;
    revoke(hash: string, replacedBy?: string | null): Promise<void>;
    /** 合并审计用：列出某账号的全部刷新令牌（只取未吊销的） */
    listActiveByUser(userId: string): Promise<RefreshTokenRecord[]>;
    /** 后台会话视图：列出某账号的全部会话（含已吊销），按创建时间倒序，limit 兜底 */
    listByUser(userId: string, limit: number): Promise<RefreshTokenRecord[]>;
    /** 合并时吊销次账号全部会话；返回实际吊销条数 */
    revokeByUser(userId: string): Promise<number>;
    /** 注销级联：物理删除该用户全部刷新令牌，返回删除条数。 */
    deleteByUser(userId: string): Promise<number>;
    /** 留存清理：已过期或已撤销且早于 before 的令牌物理删除，返回条数。 */
    purgeExpired(before: Date): Promise<number>;
  };
  /** 用户设备最近快照（0021）：upsert 与按设备/最近读取，双驱动同口径 */
  userDevices: {
    upsert(record: UserDeviceRecord): Promise<void>;
    find(userId: string, deviceId: string): Promise<UserDeviceRecord | null>;
    /** 该用户最近一次快照（按 updated_at 倒序首条）；无记录返回 null */
    latest(userId: string): Promise<UserDeviceRecord | null>;
    listByUser(userId: string): Promise<UserDeviceRecord[]>;
    /** 注销级联：物理删除该用户全部设备快照，返回删除条数。 */
    deleteByUser(userId: string): Promise<number>;
    /** 留存清理：updated_at 早于 before 且无活跃会话的快照，返回删除条数。 */
    purgeStale(before: Date): Promise<number>;
  };
  smsCodes: {
    insert(code: SmsCodeRecord): Promise<void>;
    latest(phone: string, purpose: SmsCodeRecord['purpose']): Promise<SmsCodeRecord | null>;
    update(id: string, patch: Partial<SmsCodeRecord>): Promise<void>;
    /** 留存清理：已消费或已过期且早于 before 的验证码物理删除，返回条数。 */
    purgeStale(before: Date): Promise<number>;
  };
  payments: {
    insert(payment: PaymentRecord): Promise<PaymentRecord>;
    findByOutTradeNo(outTradeNo: string): Promise<PaymentRecord | null>;
    listByUser(userId: string): Promise<PaymentRecord[]>;
    update(id: string, patch: Partial<PaymentRecord>): Promise<PaymentRecord | null>;
    move(ids: string[], userId: string): Promise<number>;
    /** 注销级联：支付留行对账，user_id 置空，返回脱敏条数。 */
    anonymizeByUser(userId: string): Promise<number>;
  };
  pushTokens: {
    upsert(record: PushTokenRecord): Promise<void>;
    listByUser(userId: string): Promise<PushTokenRecord[]>;
    move(ids: string[], userId: string): Promise<number>;
    remove(ids: string[]): Promise<void>;
    /** 注销级联：物理删除该用户全部推送令牌，返回删除条数。 */
    deleteByUser(userId: string): Promise<number>;
  };
  mall: {
    products: {
      insert(product: ProductRecord): Promise<ProductRecord>;
      list(filter: {
        category?: string;
        cat?: string;
        /** 分类多选（源站 ctgs）：节点 id 数组，多值 OR，每个节点按子孙收敛 */
        ctgs?: string[];
        dims?: string;
        lens?: string;
        brand?: string;
        std?: string;
        grd?: string;
        mtl?: string;
        ttt?: string;
        /** 牙别多选（源站 trts）：specs.牙别 的取值数组，多值 OR */
        trts?: string[];
        keyword?: string;
        limit: number;
        offset: number;
      }): Promise<ProductRecord[]>;
      /**
       * 分类树逐层读取：parentId 为空取一级类目，否则取该节点的直接子级。
       * 默认只返回 is_active 且 product_count > 0 的节点（列表页不显示空壳）；
       * includeEmpty=true 时连同 0 商品节点一起返回，供「商品分类」抽屉与源站树一比一。
       */
      listChildCategories(
        parentId: string | null,
        opts?: { includeEmpty?: boolean },
      ): Promise<Array<{ id: string; code: string; name: string; level: number; count: number }>>;
      /** 某分类节点（含子孙）下商品实际出现的筛选候选，无数据时为空数组。 */
      listSpecOptions(c3Id: string): Promise<{
        dims: string[];
        lens: string[];
        brands: string[];
        stds: string[];
        grds: string[];
        mtls: string[];
        ttts: string[];
        /** 牙别（源站 trts 维度）候选值 */
        trts: string[];
      }>;
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
      /** 注销级联：物理清空该用户购物车，返回删除条数。 */
      deleteByUser(userId: string): Promise<number>;
      /** 留存清理：updated_at 早于 before 的购物车行，返回删除条数。 */
      purgeStale(before: Date): Promise<number>;
    };
    /** 地址簿（0014）：下单必填项，结算页选择地址后取快照写入订单 */
    addresses: {
      listByUser(userId: string): Promise<AddressRecord[]>;
      findById(userId: string, id: string): Promise<AddressRecord | null>;
      insert(address: AddressRecord): Promise<AddressRecord>;
      update(userId: string, id: string, patch: Partial<AddressRecord>): Promise<AddressRecord | null>;
      remove(userId: string, id: string): Promise<void>;
      /**
       * 设默认：一条 update 把该用户全部地址的 is_default 整体改写成「仅 id 命中为 true」，
       * 规避网关无事务时的两条语句竞态；id 不属于该用户时返回 null。
       */
      setDefault(userId: string, id: string): Promise<AddressRecord | null>;
      /** 注销级联：物理删除该用户全部地址，返回删除条数。 */
      deleteByUser(userId: string): Promise<number>;
    };
    /** 满减梯度档位（0017）：`min~max → percent%`，购物车三层优惠汇总使用 */
    manjianTiers: {
      /** 只取启用档位，按 sortNo 升序 */
      listEnabled(): Promise<ManjianTierRecord[]>;
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
      /**
       * 取消订单（0018）：仅当当前状态命中 fromStatuses 且 picking 未发生（picking_at 为空）时才写入，
       * 同时落 cancelled_at / cancel_reason / cancelled_by；返回是否真的改了（并发安全 + 幂等）。
       */
      cancel(
        orderId: string,
        fromStatuses: OrderRecord['status'][],
        reason: string,
        by: NonNullable<OrderRecord['cancelledBy']>,
      ): Promise<boolean>;
      /** 状态流转打点（0018）：picking/shipped/completed 时写入对应时间戳；返回是否真的改了 */
      markStatusAt(
        orderId: string,
        from: OrderRecord['status'],
        to: OrderRecord['status'],
        at: Date,
      ): Promise<boolean>;
      /** 注销级联：订单留行脱敏，user_id 置空并清空可识别字段，返回脱敏条数。 */
      anonymizeByUser(userId: string): Promise<number>;
      /** 留存清理：已完结（completed/cancelled）且完结时间早于 before 的订单脱敏，返回条数。 */
      anonymizeStaleCompleted(before: Date): Promise<number>;
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
      /** 注销级联：物理删除该用户全部下单幂等占位，返回删除条数。 */
      deleteByUser(userId: string): Promise<number>;
    };
    /** 收藏夹（0019）：多收藏夹 + 条目，条目只存商品引用 */
    favorites: {
      listFolders(userId: string): Promise<FavoriteFolderRecord[]>;
      findFolder(userId: string, folderId: string): Promise<FavoriteFolderRecord | null>;
      /** 同一用户最多一个默认收藏夹由部分唯一索引兜底；插入默认夹前需先清掉旧默认 */
      insertFolder(folder: FavoriteFolderRecord): Promise<FavoriteFolderRecord>;
      /** 改名 / 改默认（只允许这两个字段），归属不匹配返回 null */
      updateFolder(
        userId: string,
        folderId: string,
        patch: { name?: string; isDefault?: boolean },
      ): Promise<FavoriteFolderRecord | null>;
      /** 设默认：一条 update 把该用户全部收藏夹改写成「仅目标为 true」，规避两条语句竞态 */
      setDefault(userId: string, folderId: string): Promise<FavoriteFolderRecord | null>;
      listItems(folderId: string): Promise<FavoriteItemRecord[]>;
      /** 加条目：同一收藏夹内重复收藏返回已有行（幂等） */
      insertItem(item: FavoriteItemRecord): Promise<FavoriteItemRecord>;
      /** 删条目：返回是否真的删掉了 */
      deleteItem(folderId: string, productId: string): Promise<boolean>;
      /** 清空某收藏夹的条目，返回删除条数 */
      clearItems(folderId: string): Promise<number>;
      /** 条目数统计（收藏夹列表用） */
      countItems(folderId: string): Promise<number>;
      /** 注销级联：物理删除该用户全部收藏夹与条目，返回条目删除条数。 */
      deleteByUser(userId: string): Promise<number>;
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
  /**
   * 后台运营台（/admin/console）数据面。
   * 全部是新增方法，不改动既有用户侧读路径；MemoryStore 与 PgStore 双实现，
   * 保证本地内存库与生产库行为一致。写操作只提供「上下架」一种商品写能力，
   * 订单侧复用既有六态原语（transitionStatus / markStatusAt / cancel）。
   */
  admin: {
    /** 概览计数：商品/用户/订单/收藏/购物车 */
    counts(): Promise<AdminCounts>;
    /** 商品检索（包含已下架商品，用户侧 list 会过滤掉它们） */
    listProducts(filter: AdminProductFilter): Promise<{ rows: ProductRecord[]; total: number }>;
    /** 批量上下架：只更新确实需要变化的行，返回实际变更条数 */
    setProductsListed(ids: string[], listed: boolean): Promise<number>;
    /** 订单检索与分页 */
    listOrders(filter: AdminOrderFilter): Promise<{ rows: OrderRecord[]; total: number }>;
    /** 按主键取单个订单（后台订单详情用；用户侧无此入口） */
    getOrder(orderId: string): Promise<OrderRecord | null>;
    /** 用户检索与分页 */
    listUsers(filter: AdminUserFilter): Promise<{ rows: UserRecord[]; total: number }>;
    /** 用户详情附加汇总；用户不存在返回 null */
    userSummary(userId: string): Promise<AdminUserSummary | null>;
    /** 后台会话视图：某用户最近 N 条会话摘要（含设备/网络快照；令牌只返哈希前缀） */
    listUserSessions(userId: string, limit: number): Promise<AdminUserSessionSummary[]>;
    /** 全站收藏夹（含条目数、归属用户昵称/账号），运营只读 */
    listFavoriteFolders(
      filter: { limit: number; offset: number },
    ): Promise<{ rows: AdminFavoriteFolderRow[]; total: number }>;
    /** 满减档位（含停用档位，运营需要看到全貌） */
    listManjianTiers(): Promise<ManjianTierRecord[]>;
    /** 写操作审计：append 落库，list 按时间倒序取最近若干条 */
    audit: {
      append(entry: AdminAuditRecord): Promise<void>;
      list(limit: number, offset?: number): Promise<AdminAuditRecord[]>;
    };
  };
};

// ===== 后台运营台类型（additive；不参与用户侧任何逻辑） =====

/** 概览计数。订单按六态展开，未出现的状态补 0。 */
export type AdminCounts = {
  products: { total: number; listed: number; unlisted: number; catalog: number };
  users: { total: number; active: number; guests: number; frozen: number };
  orders: { total: number; byStatus: Record<OrderRecord['status'], number> };
  favorites: { folders: number; items: number };
  carts: { items: number; users: number };
};

/** 商品筛选：keyword 匹配标题/货号/品牌/来源 id/主键；listed 为空表示不筛选。 */
export type AdminProductFilter = {
  keyword?: string;
  category?: string;
  listed?: boolean;
  limit: number;
  offset: number;
};

/** 订单筛选：status 精确命中；keyword 匹配订单号/收货人/手机号/用户 id。 */
export type AdminOrderFilter = {
  status?: OrderRecord['status'];
  keyword?: string;
  limit: number;
  offset: number;
};

/** 用户筛选：keyword 匹配账号编号/昵称/用户名/手机号/邮箱。 */
export type AdminUserFilter = {
  keyword?: string;
  limit: number;
  offset: number;
};

/** 用户详情附加汇总：绑定渠道、订单数、收藏与购物车规模。 */
export type AdminUserSummary = {
  bindings: BindingRecord[];
  orders: number;
  favoriteFolders: number;
  favoriteItems: number;
  cartItems: number;
};

/** 全站收藏夹行：在收藏夹本体上补条目数与归属用户展示字段。 */
export type AdminFavoriteFolderRow = FavoriteFolderRecord & {
  itemCount: number;
  userNickname: string | null;
  userAccountNo: string | null;
};

/**
 * 后台写操作审计记录：谁（actor/ip/ua/requestId）、何时（createdAt）、
 * 对什么（targetType/targetId）、改前改后（before/after）。
 * 批量操作共用一个 batchId，便于按批次回溯。
 */
export type AdminAuditRecord = {
  id: string;
  /** 动作标识，如 product.list / product.unlist / order.transition / order.cancel */
  action: string;
  targetType: 'product' | 'order';
  targetId: string;
  /** 人可读摘要，后台列表直接展示 */
  summary: string;
  before: unknown;
  after: unknown;
  actor: string;
  ip: string;
  userAgent: string;
  requestId: string;
  batchId: string | null;
  createdAt: Date;
};
