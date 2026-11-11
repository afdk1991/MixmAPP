export type UserRecord = {
  id: string;
  accountNo: string;
  snowflake: string;
  ulid: string;
  uuidV7: string;
  nickname: string;
  avatarUrl: string | null;
  bio: string | null;
  phone: string | null;
  email: string | null;
  passwordHash: string | null;
  status: 'active' | 'frozen';
  createdAt: Date;
  updatedAt: Date;
};

export type BindingRecord = {
  id: string;
  userId: string;
  provider: 'wechat' | 'qq' | 'github';
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

export type Store = {
  driver: 'memory' | 'postgres';
  ping(): Promise<boolean>;
  close(): Promise<void>;

  users: {
    insert(user: UserRecord): Promise<UserRecord>;
    findById(id: string): Promise<UserRecord | null>;
    findByPhone(phone: string): Promise<UserRecord | null>;
    findByEmail(email: string): Promise<UserRecord | null>;
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
};
