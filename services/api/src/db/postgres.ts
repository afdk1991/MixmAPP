import pg from 'pg';
import type { Queryable } from './gateway.js';
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

const { Pool } = pg;

type Row = Record<string, unknown>;

type QueryOutcome = { rows: Row[]; rowCount: number | null };
type PoolClientLike = {
  query(sql: string, params?: unknown[]): Promise<QueryOutcome>;
  release(): void;
};
/** pg.Pool 与 CloudBase PG 网关客户端共用的最小接口。 */
type PoolLike = Queryable & {
  connect?: () => Promise<PoolClientLike>;
  end?: () => Promise<void>;
};

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
    username: (row['username'] as string | null) ?? null,
    guest: Boolean(row['guest']),
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

function mapOAuthState(row: Row): OAuthStateRecord {
  return {
    state: row['state'] as string,
    provider: row['provider'] as string,
    redirect: row['redirect'] as string,
    redirectUri: row['redirect_uri'] as string,
    createdAt: toDate(row['created_at']),
    expiresAt: toDate(row['expires_at']),
    consumedAt: toDateOrNull(row['consumed_at']),
  };
}

/** PostgreSQL 驱动：生产环境唯一使用的持久化实现。 */
export class PgStore implements Store {
  readonly driver = 'postgres' as const;
  private readonly pool: PoolLike;

  constructor(connection: string | PoolLike) {
    if (typeof connection === 'string') {
      this.pool = new Pool({
        connectionString: connection,
        max: Number(process.env['PG_POOL_MAX'] ?? 10),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      });
    } else {
      this.pool = connection;
    }
  }

  async ping(): Promise<boolean> {
    const res = await this.pool.query('select 1 as ok');
    return res.rows.length === 1;
  }

  async close(): Promise<void> {
    await this.pool.end?.();
  }

  users = {
    insert: async (user: UserRecord): Promise<UserRecord> => {
      const res = await this.pool.query(
        `insert into users (id, account_no, snowflake, ulid, uuid_v7, nickname, avatar_url, bio,
           username, guest, phone, email, password_hash, status, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
        [
          user.id,
          user.accountNo,
          user.snowflake,
          user.ulid,
          user.uuidV7,
          user.nickname,
          user.avatarUrl,
          user.bio,
          user.username,
          user.guest,
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
      const res = await this.pool.query(
        'select * from users where upper(account_no) = upper($1) limit 1',
        [accountNo],
      );
      return res.rows[0] ? mapUser(res.rows[0] as Row) : null;
    },
    findByUsername: async (username: string): Promise<UserRecord | null> => {
      const res = await this.pool.query(
        'select * from users where lower(username) = lower($1) limit 1',
        [username],
      );
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
        username: 'username',
        guest: 'guest',
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
    delete: async (id: string): Promise<void> => {
      await this.pool.query('delete from users where id = $1', [id]);
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
    findByUnionId: async (unionId: string): Promise<BindingRecord[]> => {
      const res = await this.pool.query(
        'select * from bindings where union_id = $1 order by created_at asc',
        [unionId],
      );
      return res.rows.map((r) => mapBinding(r as Row));
    },
    remove: async (userId: string, provider: BindingRecord['provider']): Promise<void> => {
      await this.pool.query('delete from bindings where user_id = $1 and provider = $2', [
        userId,
        provider,
      ]);
    },
    move: async (ids: string[], userId: string): Promise<number> => {
      if (!ids.length) return 0;
      const res = await this.pool.query(
        'update bindings set user_id = $1 where id = any($2::text[]) and user_id <> $1',
        [userId, ids],
      );
      return res.rowCount ?? 0;
    },
  };

  oauthStates = {
    insert: async (record: OAuthStateRecord): Promise<void> => {
      await this.pool.query(
        `insert into oauth_states (state, provider, redirect, redirect_uri, created_at, expires_at, consumed_at)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (state) do nothing`,
        [
          record.state,
          record.provider,
          record.redirect,
          record.redirectUri,
          record.createdAt,
          record.expiresAt,
          record.consumedAt,
        ],
      );
    },
    // 单条 UPDATE 完成「校验 + 消费」，并发回放只有一个请求能拿到行。
    claim: async (state: string): Promise<OAuthStateRecord | null> => {
      const res = await this.pool.query(
        `update oauth_states set consumed_at = now()
         where state = $1 and consumed_at is null and expires_at > now()
         returning *`,
        [state],
      );
      return res.rows[0] ? mapOAuthState(res.rows[0] as Row) : null;
    },
    purgeExpired: async (before: Date): Promise<void> => {
      await this.pool.query('delete from oauth_states where expires_at <= $1', [before]);
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
    listActiveByUser: async (userId: string): Promise<RefreshTokenRecord[]> => {
      const res = await this.pool.query(
        'select * from refresh_tokens where user_id = $1 and revoked_at is null',
        [userId],
      );
      return res.rows.map((row) => {
        const r = row as Row;
        return {
          tokenHash: r['token_hash'] as string,
          userId: r['user_id'] as string,
          expiresAt: toDate(r['expires_at']),
          revokedAt: toDateOrNull(r['revoked_at']),
          replacedBy: (r['replaced_by'] as string | null) ?? null,
          createdAt: toDate(r['created_at']),
        };
      });
    },
    revokeByUser: async (userId: string): Promise<number> => {
      const res = await this.pool.query(
        'update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null',
        [userId],
      );
      return res.rowCount ?? 0;
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
    listByUser: async (userId: string): Promise<PaymentRecord[]> => {
      const res = await this.pool.query('select * from payments where user_id = $1', [userId]);
      return res.rows.map((row) => mapPayment(row as Row));
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
    move: async (ids: string[], userId: string): Promise<number> => {
      if (!ids.length) return 0;
      const res = await this.pool.query(
        'update payments set user_id = $1 where id = any($2::text[]) and user_id <> $1',
        [userId, ids],
      );
      return res.rowCount ?? 0;
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
    move: async (ids: string[], userId: string): Promise<number> => {
      if (!ids.length) return 0;
      const res = await this.pool.query(
        'update push_tokens set user_id = $1 where id = any($2::text[]) and user_id <> $1',
        [userId, ids],
      );
      return res.rowCount ?? 0;
    },
    remove: async (ids: string[]): Promise<void> => {
      if (!ids.length) return;
      await this.pool.query('delete from push_tokens where id = any($1::text[])', [ids]);
    },
  };

  mall = {
    products: {
      insert: async (product: ProductRecord): Promise<ProductRecord> => {
        const res = await this.pool.query(
          `insert into products (id, title, subtitle, price_fen, original_price_fen, stock, category,
             cover, images, tags, description, sort_no, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
          [
            product.id,
            product.title,
            product.subtitle,
            product.priceFen,
            product.originalPriceFen,
            product.stock,
            product.category,
            product.cover,
            JSON.stringify(product.images),
            JSON.stringify(product.tags),
            product.description,
            product.sortNo,
            product.createdAt,
          ],
        );
        return mapProduct(res.rows[0] as Row);
      },
      hasCatalogProducts: async (): Promise<boolean> => {
        try {
          const res = await this.pool.query(
            "select 1 from products where source_key is not null and source_key <> '' limit 1",
          );
          return res.rows.length > 0;
        } catch {
          // 旧库尚未执行 0006、或 PG 网关暂不可用时保守判为「无真实目录商品」，
          // 交给内嵌只读源兜底，绝不因探测失败拖垮启动/请求。
          return false;
        }
      },
      list: async (filter: {
        category?: string;
        cat?: string;
        dims?: string;
        lens?: string;
        keyword?: string;
        limit: number;
        offset: number;
      }): Promise<ProductRecord[]> => {
        const conditions: string[] = ['listed is not false'];
        const params: unknown[] = [];
        if (filter.category) {
          params.push(filter.category);
          conditions.push(`category = $${params.length}`);
        }
        // 分类树节点：一级/二级按子孙三级类目收敛（商品只挂三级），三级即自身。
        if (filter.cat) {
          params.push(filter.cat);
          const i = params.length;
          conditions.push(
            `c3_id in (select id from catalog_categories where id = $${i} or parent_id = $${i}
                        or parent_id in (select id from catalog_categories where parent_id = $${i}))`,
          );
        }
        if (filter.dims) {
          params.push(filter.dims);
          conditions.push(`spec_dims = $${params.length}`);
        }
        if (filter.lens) {
          params.push(filter.lens);
          conditions.push(`spec_lens = $${params.length}`);
        }
        if (filter.keyword) {
          params.push(`%${filter.keyword}%`);
          conditions.push(`(title ilike $${params.length} or subtitle ilike $${params.length})`);
        }
        const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
        params.push(filter.limit, filter.offset);
        // id desc 是必要的稳定兜底：批量导入的 created_at 大量相同，
        // 只按 sort_no/created_at 排序时同一页在不同请求间会漂移，
        // limit/offset 翻页就会出现重复卡片 + 漏商品（15k 目录实测量出 4 重 4 漏）。
        const res = await this.pool.query(
          `select * from products ${where} order by sort_no asc, created_at desc, id desc
           limit $${params.length - 1} offset $${params.length}`,
          params,
        );
        return res.rows.map((row) => mapProduct(row as Row));
      },
      aggregateCategories: async () => {
        const res = await this.pool.query(
          `select category, category_name, count(*)::int as count
             from products where listed is not false group by category, category_name`,
        );
        return res.rows.map((row) => ({
          code: String(row['category']),
          name: (row['category_name'] as string | null) ?? String(row['category']),
          count: Number(row['count']),
        }));
      },
      listChildCategories: async (parentId: string | null) => {
        const res = await this.pool.query(
          `select id, code, name, level, product_count
             from catalog_categories
            where source = 'egluosi' and is_active and product_count > 0
              and ${parentId ? 'parent_id = $1' : 'level = 1'}
            order by sort_no asc, code asc`,
          parentId ? [parentId] : [],
        );
        return res.rows.map((row) => ({
          id: String(row['id']),
          code: String(row['code']),
          name: String(row['name']),
          level: Number(row['level']),
          count: Number(row['product_count']),
        }));
      },
      listSpecOptions: async (c3Id: string) => {
        const [dims, lens] = await Promise.all([
          this.pool.query(
            `select distinct spec_dims from products
              where c3_id = $1 and listed is not false and spec_dims is not null
              order by spec_dims`,
            [c3Id],
          ),
          this.pool.query(
            `select distinct spec_lens from products
              where c3_id = $1 and listed is not false and spec_lens is not null
              order by spec_lens`,
            [c3Id],
          ),
        ]);
        return {
          dims: dims.rows.map((row) => String(row['spec_dims'])),
          lens: lens.rows.map((row) => String(row['spec_lens'])),
        };
      },
      findById: async (id: string): Promise<ProductRecord | null> => {
        const res = await this.pool.query('select * from products where id = $1 limit 1', [id]);
        return res.rows[0] ? mapProduct(res.rows[0] as Row) : null;
      },
      upsert: async (
        product: ProductRecord,
      ): Promise<{ record: ProductRecord; action: 'inserted' | 'updated' }> => {
        const existing = await this.pool.query(
          'select * from products where source_key = $1 limit 1',
          [product.sourceKey],
        );
        if (!existing.rows[0]) {
          const res = await this.pool.query(
            `insert into products (id, title, subtitle, price_fen, original_price_fen, stock, category,
               cover, images, tags, description, sort_no, created_at,
               source_key, source_url, source_id, brand, category_path, category_name,
               specs, unit, pack_qty, price_source, price_captured_at, stock_source, import_batch)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
             returning *`,
            [
              product.id,
              product.title,
              product.subtitle,
              product.priceFen,
              product.originalPriceFen,
              product.stock,
              product.category,
              product.cover,
              JSON.stringify(product.images),
              JSON.stringify(product.tags),
              product.description,
              product.sortNo,
              product.createdAt,
              product.sourceKey,
              product.sourceUrl,
              product.sourceId,
              product.brand,
              (product.categoryPath ?? []).join('/'),
              product.categoryName,
              JSON.stringify(product.specs ?? {}),
              product.unit,
              product.packQty,
              product.priceSource,
              product.priceCapturedAt,
              product.stockSource,
              product.importBatch,
            ],
          );
          return { record: mapProduct(res.rows[0] as Row), action: 'inserted' };
        }

        const manual = (existing.rows[0]['import_batch'] as string | null) === 'manual';
        const res = await this.pool.query(
          `update products set
             subtitle = $2, price_fen = $3, original_price_fen = $4, cover = $5, images = $6,
             tags = $7, description = $8, source_url = $9, source_id = $10, brand = $11,
             category_path = $12, category_name = $13, specs = $14, unit = $15, pack_qty = $16,
             price_source = $17, price_captured_at = $18, stock_source = $19, import_batch = $20,
             title = case when $21 then title else $22 end,
             category = case when $21 then category else $23 end,
             stock = case when $21 then stock else $24 end,
             sort_no = case when $21 then sort_no else $25 end
           where source_key = $1 returning *`,
          [
            product.sourceKey,
            product.subtitle,
            product.priceFen,
            product.originalPriceFen,
            product.cover,
            JSON.stringify(product.images),
            JSON.stringify(product.tags),
            product.description,
            product.sourceUrl,
            product.sourceId,
            product.brand,
            (product.categoryPath ?? []).join('/'),
            product.categoryName,
            JSON.stringify(product.specs ?? {}),
            product.unit,
            product.packQty,
            product.priceSource,
            product.priceCapturedAt,
            product.stockSource,
            product.importBatch,
            manual,
            product.title,
            product.category,
            product.stock,
            product.sortNo,
          ],
        );
        return { record: mapProduct(res.rows[0] as Row), action: 'updated' };
      },
      decrementStock: async (id: string, quantity: number): Promise<boolean> => {
        const res = await this.pool.query(
          'update products set stock = stock - $2 where id = $1 and stock >= $2 returning id',
          [id, quantity],
        );
        return res.rowCount === 1;
      },
      restoreStock: async (id: string, quantity: number): Promise<void> => {
        await this.pool.query('update products set stock = stock + $2 where id = $1', [id, quantity]);
      },
    },
    carts: {
      listByUser: async (userId: string): Promise<CartItemRecord[]> => {
        const res = await this.pool.query(
          'select * from carts where user_id = $1 order by created_at asc',
          [userId],
        );
        return res.rows.map((row) => mapCart(row as Row));
      },
      find: async (userId: string, productId: string): Promise<CartItemRecord | null> => {
        const res = await this.pool.query(
          'select * from carts where user_id = $1 and product_id = $2 limit 1',
          [userId, productId],
        );
        return res.rows[0] ? mapCart(res.rows[0] as Row) : null;
      },
      upsert: async (item: CartItemRecord): Promise<CartItemRecord> => {
        const res = await this.pool.query(
          `insert into carts (id, user_id, product_id, quantity, pack_unit, pack_qty, created_at, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (user_id, product_id)
           do update set quantity = excluded.quantity, pack_unit = excluded.pack_unit,
             pack_qty = excluded.pack_qty, updated_at = excluded.updated_at
           returning *`,
          [
            item.id,
            item.userId,
            item.productId,
            item.quantity,
            item.packUnit ?? null,
            item.packQty ?? null,
            item.createdAt,
            item.updatedAt,
          ],
        );
        return mapCart(res.rows[0] as Row);
      },
      remove: async (userId: string, productId: string): Promise<void> => {
        await this.pool.query('delete from carts where user_id = $1 and product_id = $2', [
          userId,
          productId,
        ]);
      },
      clear: async (userId: string): Promise<void> => {
        await this.pool.query('delete from carts where user_id = $1', [userId]);
      },
      replaceAll: async (userId: string, items: CartItemRecord[]): Promise<void> => {
        await this.pool.query('delete from carts where user_id = $1', [userId]);
        for (const item of items) {
          await this.pool.query(
            `insert into carts (id, user_id, product_id, quantity, pack_unit, pack_qty, created_at, updated_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8)
             on conflict (user_id, product_id) do update set quantity = excluded.quantity,
               pack_unit = excluded.pack_unit, pack_qty = excluded.pack_qty,
               updated_at = excluded.updated_at`,
            [
              item.id,
              userId,
              item.productId,
              item.quantity,
              item.packUnit ?? null,
              item.packQty ?? null,
              item.createdAt,
              item.updatedAt,
            ],
          );
        }
      },
    },
    orders: {
      insert: async (order: OrderRecord, items: OrderItemRecord[]): Promise<OrderRecord> => {
        // 网关模式没有跨语句事务，订单与明细必须在单条语句里原子落库：
        // 走 0005_place_order.sql 里的 plpgsql 函数。
        if (!this.pool.connect) {
          await this.pool.query(
            `select place_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
            [
              order.id,
              order.orderNo,
              order.userId,
              order.status,
              order.totalFen,
              order.receiverName,
              order.receiverPhone,
              order.address,
              order.remark,
              order.createdAt,
              order.paidAt,
              JSON.stringify(
                items.map((item) => ({
                  id: item.id,
                  order_id: item.orderId,
                  product_id: item.productId,
                  title: item.title,
                  price_fen: item.priceFen,
                  quantity: item.quantity,
                  subtotal_fen: item.subtotalFen,
                  pack_unit: item.packUnit ?? null,
                  pack_qty: item.packQty ?? null,
                  price_li: item.priceLi ?? null,
                })),
              ),
            ],
          );
          return order;
        }

        const client = await this.pool.connect();
        try {
          await client.query('begin');
          await client.query(
            `insert into orders (id, order_no, user_id, status, total_fen, receiver_name,
               receiver_phone, address, remark, created_at, paid_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              order.id,
              order.orderNo,
              order.userId,
              order.status,
              order.totalFen,
              order.receiverName,
              order.receiverPhone,
              order.address,
              order.remark,
              order.createdAt,
              order.paidAt,
            ],
          );
          for (const item of items) {
            await client.query(
              `insert into order_items (id, order_id, product_id, title, price_fen, quantity, subtotal_fen,
                 pack_unit, pack_qty, price_li)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [
                item.id,
                item.orderId,
                item.productId,
                item.title,
                item.priceFen,
                item.quantity,
                item.subtotalFen,
                item.packUnit ?? null,
                item.packQty ?? null,
                item.priceLi ?? null,
              ],
            );
          }
          await client.query('commit');
        } catch (error) {
          await client.query('rollback');
          throw error;
        } finally {
          client.release();
        }
        return order;
      },
      findByOrderNo: async (orderNo: string): Promise<OrderRecord | null> => {
        const res = await this.pool.query('select * from orders where order_no = $1 limit 1', [orderNo]);
        return res.rows[0] ? mapOrder(res.rows[0] as Row) : null;
      },
      listByUser: async (userId: string): Promise<OrderRecord[]> => {
        const res = await this.pool.query(
          'select * from orders where user_id = $1 order by created_at desc limit 100',
          [userId],
        );
        return res.rows.map((row) => mapOrder(row as Row));
      },
      itemsByOrder: async (orderId: string): Promise<OrderItemRecord[]> => {
        const res = await this.pool.query('select * from order_items where order_id = $1', [orderId]);
        return res.rows.map((row) => mapOrderItem(row as Row));
      },
      move: async (ids: string[], userId: string): Promise<number> => {
        if (!ids.length) return 0;
        const res = await this.pool.query(
          'update orders set user_id = $1 where id = any($2::text[]) and user_id <> $1',
          [userId, ids],
        );
        return res.rowCount ?? 0;
      },
      listExpiredPending: async (before: Date): Promise<OrderRecord[]> => {
        const res = await this.pool.query(
          'select * from orders where status = $1 and created_at < $2 order by created_at asc limit 200',
          ['pending', before],
        );
        return res.rows.map((row) => mapOrder(row as Row));
      },
      transitionStatus: async (
        orderId: string,
        from: OrderRecord['status'],
        to: OrderRecord['status'],
      ): Promise<boolean> => {
        const res = await this.pool.query(
          'update orders set status = $3 where id = $1 and status = $2 returning id',
          [orderId, from, to],
        );
        return res.rowCount === 1;
      },
    },
    orderRequests: {
      claim: async (userId: string, key: string) => {
        try {
          await this.pool.query('insert into order_requests (user_id, key) values ($1, $2)', [userId, key]);
          return { claimed: true, orderNo: null };
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          const res = await this.pool.query(
            'select order_no from order_requests where user_id = $1 and key = $2 limit 1',
            [userId, key],
          );
          return { claimed: false, orderNo: (res.rows[0]?.['order_no'] as string | null) ?? null };
        }
      },
      attach: async (userId: string, key: string, orderNo: string): Promise<void> => {
        await this.pool.query(
          'update order_requests set order_no = $3, updated_at = now() where user_id = $1 and key = $2',
          [userId, key, orderNo],
        );
      },
      release: async (userId: string, key: string): Promise<void> => {
        await this.pool.query('delete from order_requests where user_id = $1 and key = $2', [userId, key]);
      },
      dropByUser: async (userId: string): Promise<void> => {
        await this.pool.query('delete from order_requests where user_id = $1', [userId]);
      },
    },
  };

  merges = {
    insert: async (record: AccountMergeRecord): Promise<AccountMergeRecord> => {
      const res = await this.pool.query(
        `insert into account_merges (id, merge_key, primary_user_id, secondary_user_id, reason,
           status, snapshot, moved, conflict_strategy, error, created_at, completed_at, rolled_back_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
        [
          record.id,
          record.mergeKey,
          record.primaryUserId,
          record.secondaryUserId,
          record.reason,
          record.status,
          record.snapshot,
          record.moved,
          record.conflictStrategy,
          record.error,
          record.createdAt,
          record.completedAt,
          record.rolledBackAt,
        ],
      );
      return mapMerge(res.rows[0] as Row);
    },
    findByKey: async (mergeKey: string): Promise<AccountMergeRecord | null> => {
      const res = await this.pool.query('select * from account_merges where merge_key = $1 limit 1', [
        mergeKey,
      ]);
      return res.rows[0] ? mapMerge(res.rows[0] as Row) : null;
    },
    findById: async (id: string): Promise<AccountMergeRecord | null> => {
      const res = await this.pool.query('select * from account_merges where id = $1 limit 1', [id]);
      return res.rows[0] ? mapMerge(res.rows[0] as Row) : null;
    },
    list: async (limit: number): Promise<AccountMergeRecord[]> => {
      const res = await this.pool.query(
        'select * from account_merges order by created_at desc limit $1',
        [limit],
      );
      return res.rows.map((row) => mapMerge(row as Row));
    },
    update: async (
      id: string,
      patch: Partial<AccountMergeRecord>,
    ): Promise<AccountMergeRecord | null> => {
      const columns: Record<string, string> = {
        status: 'status',
        moved: 'moved',
        error: 'error',
        completedAt: 'completed_at',
        rolledBackAt: 'rolled_back_at',
      };
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [key, column] of Object.entries(columns)) {
        if (!(key in patch)) continue;
        sets.push(`${column} = $${i}`);
        values.push(patch[key as keyof AccountMergeRecord]);
        i += 1;
      }
      if (!sets.length) return null;
      const res = await this.pool.query(
        `update account_merges set ${sets.join(', ')} where id = $${i} returning *`,
        [...values, id],
      );
      return res.rows[0] ? mapMerge(res.rows[0] as Row) : null;
    },
    findCandidates: async (): Promise<MergeCandidate[]> => {
      const res = await this.pool.query(
        `select union_id, array_agg(distinct user_id) as user_ids,
                array_agg(id) as binding_ids
           from bindings
          where union_id is not null
          group by union_id
         having count(distinct user_id) > 1`,
      );
      return res.rows.map((row) => {
        const r = row as Row;
        return {
          unionId: r['union_id'] as string,
          userIds: (r['user_ids'] as string[]) ?? [],
          bindingIds: (r['binding_ids'] as string[]) ?? [],
        };
      });
    },
  };
}

/** 唯一约束冲突（PG 23505）：并发抢占时用它区分「别人已经写了」和真失败 */
function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === '23505');
}

function mapMerge(row: Row): AccountMergeRecord {
  return {
    id: row['id'] as string,
    mergeKey: row['merge_key'] as string,
    primaryUserId: row['primary_user_id'] as string,
    secondaryUserId: row['secondary_user_id'] as string,
    reason: row['reason'] as AccountMergeRecord['reason'],
    status: row['status'] as AccountMergeRecord['status'],
    snapshot: (typeof row['snapshot'] === 'string'
      ? JSON.parse(row['snapshot'])
      : row['snapshot']) as AccountMergeRecord['snapshot'],
    moved: (typeof row['moved'] === 'string' ? JSON.parse(row['moved']) : row['moved'] ?? null) as
      | AccountMergeRecord['moved']
      | null,
    conflictStrategy:
      (typeof row['conflict_strategy'] === 'string'
        ? JSON.parse(row['conflict_strategy'])
        : row['conflict_strategy']) as Record<string, string>,
    error: (row['error'] as string | null) ?? null,
    createdAt: toDate(row['created_at']),
    completedAt: toDateOrNull(row['completed_at']),
    rolledBackAt: toDateOrNull(row['rolled_back_at']),
  };
}

function mapProduct(row: Row): ProductRecord {
  const categoryPathRaw = (row['category_path'] as string | null) ?? '';
  const capturedAt = row['price_captured_at'];
  return {
    // 主键恒为 text；网关/个别驱动可能把纯数字 id 以 number 回传，这里统一转回字符串，避免详情按 id 查询错位。
    id: String(row['id']),
    title: row['title'] as string,
    subtitle: (row['subtitle'] as string | null) ?? '',
    priceFen: Number(row['price_fen']),
    originalPriceFen: Number(row['original_price_fen'] ?? 0),
    stock: Number(row['stock']),
    category: row['category'] as string,
    cover: (row['cover'] as string | null) ?? '#0f9d8f',
    images: (row['images'] as string[] | null) ?? [],
    tags: (row['tags'] as string[] | null) ?? [],
    description: (row['description'] as string | null) ?? '',
    sortNo: Number(row['sort_no'] ?? 0),
    createdAt: toDate(row['created_at']),
    sourceKey: (row['source_key'] as string | null) ?? null,
    sourceUrl: (row['source_url'] as string | null) ?? null,
    sourceId: (row['source_id'] as string | null) ?? null,
    brand: (row['brand'] as string | null) ?? null,
    categoryPath: categoryPathRaw ? categoryPathRaw.split('/').filter(Boolean) : [],
    categoryName: (row['category_name'] as string | null) ?? null,
    specs: (row['specs'] as Record<string, string> | null) ?? {},
    unit: (row['unit'] as string | null) ?? null,
    packQty: row['pack_qty'] == null ? null : Number(row['pack_qty']),
    priceSource: (row['price_source'] as ProductRecord['priceSource']) ?? null,
    priceCapturedAt:
      capturedAt == null
        ? null
        : capturedAt instanceof Date
          ? capturedAt.toISOString()
          : String(capturedAt),
    stockSource: (row['stock_source'] as ProductRecord['stockSource']) ?? null,
    importBatch: (row['import_batch'] as string | null) ?? null,
    attributes: (row['attributes'] as Record<string, string> | null) ?? {},
    priceLi: row['price_li'] == null ? null : Number(row['price_li']),
    discountPct: row['discount_pct'] == null ? null : Number(row['discount_pct']),
    salePriceLi: row['sale_price_li'] == null ? null : Number(row['sale_price_li']),
    promotions:
      (row['promotions'] as ProductRecord['promotions'] | null) ?? [],
    packagingDesc: (row['packaging_desc'] as string | null) ?? null,
    unitOptions: (row['unit_options'] as ProductRecord['unitOptions'] | null) ?? [],
    unitConversions: (row['unit_conversions'] as Record<string, number> | null) ?? {},
    specImage: (row['spec_image'] as string | null) ?? null,
    sourceItemNo: (row['source_item_no'] as string | null) ?? null,
    minOrderQty: Number(row['min_order_qty'] ?? 1),
    qtyStep: Number(row['qty_step'] ?? 1),
    maxOrderQty: Number(row['max_order_qty'] ?? 1000000),
    listed: row['listed'] !== false,
  };
}

function mapCart(row: Row): CartItemRecord {
  return {
    id: row['id'] as string,
    userId: row['user_id'] as string,
    productId: row['product_id'] as string,
    quantity: Number(row['quantity']),
    packUnit: (row['pack_unit'] as string | null) ?? null,
    packQty: row['pack_qty'] == null ? null : Number(row['pack_qty']),
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

function mapOrder(row: Row): OrderRecord {
  return {
    id: row['id'] as string,
    orderNo: row['order_no'] as string,
    userId: row['user_id'] as string,
    status: row['status'] as OrderRecord['status'],
    totalFen: Number(row['total_fen']),
    receiverName: row['receiver_name'] as string,
    receiverPhone: row['receiver_phone'] as string,
    address: row['address'] as string,
    remark: (row['remark'] as string | null) ?? null,
    createdAt: toDate(row['created_at']),
    paidAt: toDateOrNull(row['paid_at']),
  };
}

function mapOrderItem(row: Row): OrderItemRecord {
  return {
    id: row['id'] as string,
    orderId: row['order_id'] as string,
    productId: row['product_id'] as string,
    title: row['title'] as string,
    priceFen: Number(row['price_fen']),
    quantity: Number(row['quantity']),
    subtotalFen: Number(row['subtotal_fen']),
    packUnit: (row['pack_unit'] as string | null) ?? null,
    packQty: row['pack_qty'] == null ? null : Number(row['pack_qty']),
    priceLi: row['price_li'] == null ? null : Number(row['price_li']),
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
