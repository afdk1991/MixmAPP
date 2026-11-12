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

export type BindingProvider = 'wechat' | 'qq' | 'github' | 'apple' | 'guest';

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
};

export type CartItemRecord = {
  id: string;
  userId: string;
  productId: string;
  quantity: number;
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
  };
  bindings: {
    insert(binding: BindingRecord): Promise<BindingRecord>;
    findByProvider(provider: BindingRecord['provider'], openId: string): Promise<BindingRecord | null>;
    listByUser(userId: string): Promise<BindingRecord[]>;
    remove(userId: string, provider: BindingRecord['provider']): Promise<void>;
  };
  refreshTokens: {
    insert(token: RefreshTokenRecord): Promise<void>;
    findByHash(hash: string): Promise<RefreshTokenRecord | null>;
    revoke(hash: string, replacedBy?: string | null): Promise<void>;
  };
  smsCodes: {
    insert(code: SmsCodeRecord): Promise<void>;
    latest(phone: string, purpose: SmsCodeRecord['purpose']): Promise<SmsCodeRecord | null>;
    update(id: string, patch: Partial<SmsCodeRecord>): Promise<void>;
  };
  payments: {
    insert(payment: PaymentRecord): Promise<PaymentRecord>;
    findByOutTradeNo(outTradeNo: string): Promise<PaymentRecord | null>;
    update(id: string, patch: Partial<PaymentRecord>): Promise<PaymentRecord | null>;
  };
  pushTokens: {
    upsert(record: PushTokenRecord): Promise<void>;
    listByUser(userId: string): Promise<PushTokenRecord[]>;
  };
  mall: {
    products: {
      insert(product: ProductRecord): Promise<ProductRecord>;
      list(filter: { category?: string; keyword?: string; limit: number; offset: number }): Promise<ProductRecord[]>;
      findById(id: string): Promise<ProductRecord | null>;
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
    };
    orders: {
      insert(order: OrderRecord, items: OrderItemRecord[]): Promise<OrderRecord>;
      findByOrderNo(orderNo: string): Promise<OrderRecord | null>;
      listByUser(userId: string): Promise<OrderRecord[]>;
      itemsByOrder(orderId: string): Promise<OrderItemRecord[]>;
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
    };
  };
};
