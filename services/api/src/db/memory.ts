import type {
  BindingRecord,
  PaymentRecord,
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
    findByAccountNo: async (accountNo: string): Promise<UserRecord | null> => {
      const found = this.userList.find((u) => u.accountNo === accountNo);
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
}
