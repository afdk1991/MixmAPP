import pg from 'pg';
import type {
  BindingRecord,
  PaymentRecord,
  PushTokenRecord,
  RefreshTokenRecord,
  SmsCodeRecord,
  Store,
  UserRecord,
} from './types.js';

const { Pool } = pg;

type Row = Record<string, unknown>;

const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(v as string));
const toDateOrNull = (v: unknown): Date | null => (v == null ? null : toDate(v));

function mapUser(row: Row): UserRecord {
  return {
    id: row['id'] as string,
    accountNo: row['account_no'] as string,
    snowflake: row['snowflake'] as string,
    ulid: row['ulid'] as string,
    uuidV7: row['uuid_v7'] as string,
    nickname: row['nickname'] as string,
    avatarUrl: (row['avatar_url'] as string | null) ?? null,
    bio: (row['bio'] as string | null) ?? null,
    phone: (row['phone'] as string | null) ?? null,
    email: (row['email'] as string | null) ?? null,
    passwordHash: (row['password_hash'] as string | null) ?? null,
    status: row['status'] as UserRecord['status'],
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

function mapBinding(row: Row): BindingRecord {
  return {
    id: row['id'] as string,
    userId: row['user_id'] as string,
    provider: row['provider'] as BindingRecord['provider'],
    openId: row['open_id'] as string,
    unionId: (row['union_id'] as string | null) ?? null,
    nickname: (row['nickname'] as string | null) ?? null,
    avatarUrl: (row['avatar_url'] as string | null) ?? null,
    createdAt: toDate(row['created_at']),
  };
}

/** PostgreSQL 驱动：生产环境唯一使用的持久化实现。 */
export class PgStore implements Store {
  readonly driver = 'postgres' as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: Number(process.env['PG_POOL_MAX'] ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  async ping(): Promise<boolean> {
    const res = await this.pool.query('select 1 as ok');
    return res.rows.length === 1;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  users = {
    insert: async (user: UserRecord): Promise<UserRecord> => {
      const res = await this.pool.query(
        `insert into users (id, account_no, snowflake, ulid, uuid_v7, nickname, avatar_url, bio,
           phone, email, password_hash, status, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
        [
          user.id,
          user.accountNo,
          user.snowflake,
          user.ulid,
          user.uuidV7,
          user.nickname,
          user.avatarUrl,
          user.bio,
          user.phone,
          user.email,
          user.passwordHash,
          user.status,
          user.createdAt,
          user.updatedAt,
        ],
      );
      return mapUser(res.rows[0] as Row);
    },
    findById: async (id: string): Promise<UserRecord | null> => {
      const res = await this.pool.query('select * from users where id = $1 limit 1', [id]);
      return res.rows[0] ? mapUser(res.rows[0] as Row) : null;
    },
    findByPhone: async (phone: string): Promise<UserRecord | null> => {
      const res = await this.pool.query('select * from users where phone = $1 limit 1', [phone]);
      return res.rows[0] ? mapUser(res.rows[0] as Row) : null;
    },
    findByEmail: async (email: string): Promise<UserRecord | null> => {
      const res = await this.pool.query('select * from users where lower(email) = lower($1) limit 1', [
        email,
      ]);
      return res.rows[0] ? mapUser(res.rows[0] as Row) : null;
    },
    findByAccountNo: async (accountNo: string): Promise<UserRecord | null> => {
      const res = await this.pool.query('select * from users where account_no = $1 limit 1', [
        accountNo,
      ]);
      return res.rows[0] ? mapUser(res.rows[0] as Row) : null;
    },
    update: async (id: string, patch: Partial<UserRecord>): Promise<UserRecord | null> => {
      const columns: Record<keyof UserRecord, string> = {
        id: 'id',
        accountNo: 'account_no',
        snowflake: 'snowflake',
        ulid: 'ulid',
        uuidV7: 'uuid_v7',
        nickname: 'nickname',
        avatarUrl: 'avatar_url',
        bio: 'bio',
        phone: 'phone',
        email: 'email',
        passwordHash: 'password_hash',
        status: 'status',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      };
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [key, column] of Object.entries(columns)) {
        if (key === 'id' || key === 'createdAt' || key === 'updatedAt') continue;
        if (!(key in patch)) continue;
        sets.push(`${column} = $${i}`);
        values.push(patch[key as keyof UserRecord]);
        i += 1;
      }
      sets.push(`updated_at = now()`);
      const res = await this.pool.query(
        `update users set ${sets.join(', ')} where id = $${i} returning *`,
        [...values, id],
      );
      return res.rows[0] ? mapUser(res.rows[0] as Row) : null;
    },
  };

  bindings = {
    insert: async (binding: BindingRecord): Promise<BindingRecord> => {
      const res = await this.pool.query(
        `insert into bindings (id, user_id, provider, open_id, union_id, nickname, avatar_url, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [
          binding.id,
          binding.userId,
          binding.provider,
          binding.openId,
          binding.unionId,
          binding.nickname,
          binding.avatarUrl,
          binding.createdAt,
        ],
      );
      return mapBinding(res.rows[0] as Row);
    },
    findByProvider: async (
      provider: BindingRecord['provider'],
      openId: string,
    ): Promise<BindingRecord | null> => {
      const res = await this.pool.query(
        'select * from bindings where provider = $1 and open_id = $2 limit 1',
        [provider, openId],
      );
      return res.rows[0] ? mapBinding(res.rows[0] as Row) : null;
    },
    listByUser: async (userId: string): Promise<BindingRecord[]> => {
      const res = await this.pool.query('select * from bindings where user_id = $1', [userId]);
      return res.rows.map((r) => mapBinding(r as Row));
    },
    remove: async (userId: string, provider: BindingRecord['provider']): Promise<void> => {
      await this.pool.query('delete from bindings where user_id = $1 and provider = $2', [
        userId,
        provider,
      ]);
    },
  };

  refreshTokens = {
    insert: async (token: RefreshTokenRecord): Promise<void> => {
      await this.pool.query(
        `insert into refresh_tokens (token_hash, user_id, expires_at, revoked_at, replaced_by, created_at)
         values ($1,$2,$3,$4,$5,$6)`,
        [token.tokenHash, token.userId, token.expiresAt, token.revokedAt, token.replacedBy, token.createdAt],
      );
    },
    findByHash: async (hash: string): Promise<RefreshTokenRecord | null> => {
      const res = await this.pool.query('select * from refresh_tokens where token_hash = $1 limit 1', [
        hash,
      ]);
      if (!res.rows[0]) return null;
      const row = res.rows[0] as Row;
      return {
        tokenHash: row['token_hash'] as string,
        userId: row['user_id'] as string,
        expiresAt: toDate(row['expires_at']),
        revokedAt: toDateOrNull(row['revoked_at']),
        replacedBy: (row['replaced_by'] as string | null) ?? null,
        createdAt: toDate(row['created_at']),
      };
    },
    revoke: async (hash: string, replacedBy?: string | null): Promise<void> => {
      await this.pool.query(
        'update refresh_tokens set revoked_at = now(), replaced_by = $2 where token_hash = $1',
        [hash, replacedBy ?? null],
      );
    },
  };

  smsCodes = {
    insert: async (code: SmsCodeRecord): Promise<void> => {
      await this.pool.query(
        `insert into sms_codes (id, phone, purpose, code_hash, attempts, consumed_at, expires_at, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          code.id,
          code.phone,
          code.purpose,
          code.codeHash,
          code.attempts,
          code.consumedAt,
          code.expiresAt,
          code.createdAt,
        ],
      );
    },
    latest: async (
      phone: string,
      purpose: SmsCodeRecord['purpose'],
    ): Promise<SmsCodeRecord | null> => {
      const res = await this.pool.query(
        `select * from sms_codes where phone = $1 and purpose = $2
         order by created_at desc limit 1`,
        [phone, purpose],
      );
      if (!res.rows[0]) return null;
      const row = res.rows[0] as Row;
      return {
        id: row['id'] as string,
        phone: row['phone'] as string,
        purpose: row['purpose'] as SmsCodeRecord['purpose'],
        codeHash: row['code_hash'] as string,
        attempts: Number(row['attempts']),
        consumedAt: toDateOrNull(row['consumed_at']),
        expiresAt: toDate(row['expires_at']),
        createdAt: toDate(row['created_at']),
      };
    },
    update: async (id: string, patch: Partial<SmsCodeRecord>): Promise<void> => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (patch.attempts !== undefined) {
        sets.push(`attempts = $${i}`);
        values.push(patch.attempts);
        i += 1;
      }
      if (patch.consumedAt !== undefined) {
        sets.push(`consumed_at = $${i}`);
        values.push(patch.consumedAt);
        i += 1;
      }
      if (!sets.length) return;
      await this.pool.query(
        `update sms_codes set ${sets.join(', ')} where id = $${i}`,
        [...values, id],
      );
    },
  };

  payments = {
    insert: async (payment: PaymentRecord): Promise<PaymentRecord> => {
      const res = await this.pool.query(
        `insert into payments (id, out_trade_no, user_id, channel, amount_fen, subject, status,
           prepay, transaction_id, paid_at, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
        [
          payment.id,
          payment.outTradeNo,
          payment.userId,
          payment.channel,
          payment.amountFen,
          payment.subject,
          payment.status,
          payment.prepay,
          payment.transactionId,
          payment.paidAt,
          payment.createdAt,
        ],
      );
      return mapPayment(res.rows[0] as Row);
    },
    findByOutTradeNo: async (outTradeNo: string): Promise<PaymentRecord | null> => {
      const res = await this.pool.query('select * from payments where out_trade_no = $1 limit 1', [
        outTradeNo,
      ]);
      return res.rows[0] ? mapPayment(res.rows[0] as Row) : null;
    },
    update: async (id: string, patch: Partial<PaymentRecord>): Promise<PaymentRecord | null> => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      const keys: Array<keyof PaymentRecord> = [
        'status',
        'prepay',
        'transactionId',
        'paidAt',
        'amountFen',
      ];
      const columns: Record<string, string> = {
        status: 'status',
        prepay: 'prepay',
        transactionId: 'transaction_id',
        paidAt: 'paid_at',
        amountFen: 'amount_fen',
      };
      for (const key of keys) {
        if (patch[key] === undefined) continue;
        sets.push(`${columns[key]} = $${i}`);
        values.push(patch[key]);
        i += 1;
      }
      if (!sets.length) return null;
      const res = await this.pool.query(
        `update payments set ${sets.join(', ')} where id = $${i} returning *`,
        [...values, id],
      );
      return res.rows[0] ? mapPayment(res.rows[0] as Row) : null;
    },
  };

  pushTokens = {
    upsert: async (record: PushTokenRecord): Promise<void> => {
      await this.pool.query(
        `insert into push_tokens (id, user_id, provider, platform, token, created_at)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (user_id, token) do update set provider = excluded.provider,
           platform = excluded.platform, created_at = excluded.created_at`,
        [record.id, record.userId, record.provider, record.platform, record.token, record.createdAt],
      );
    },
    listByUser: async (userId: string): Promise<PushTokenRecord[]> => {
      const res = await this.pool.query('select * from push_tokens where user_id = $1', [userId]);
      return res.rows.map((row) => {
        const r = row as Row;
        return {
          id: r['id'] as string,
          userId: r['user_id'] as string,
          provider: r['provider'] as PushTokenRecord['provider'],
          platform: r['platform'] as PushTokenRecord['platform'],
          token: r['token'] as string,
          createdAt: toDate(r['created_at']),
        };
      });
    },
  };
}

function mapPayment(row: Row): PaymentRecord {
  return {
    id: row['id'] as string,
    outTradeNo: row['out_trade_no'] as string,
    userId: row['user_id'] as string,
    channel: row['channel'] as PaymentRecord['channel'],
    amountFen: Number(row['amount_fen']),
    subject: row['subject'] as string,
    status: row['status'] as PaymentRecord['status'],
    prepay: (row['prepay'] as Record<string, unknown> | null) ?? null,
    transactionId: (row['transaction_id'] as string | null) ?? null,
    paidAt: toDateOrNull(row['paid_at']),
    createdAt: toDate(row['created_at']),
  };
}

export function createStore(databaseUrl: string): Store {
  return new PgStore(databaseUrl);
}
