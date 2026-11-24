import pg from 'pg';
import type { Queryable } from './gateway.js';
import {
  buildSearchTokens,
  escapeLikePattern,
  FULLWIDTH_TRANSLATE_FROM,
  FULLWIDTH_TRANSLATE_TO,
} from '../lib/search.js';
import type {
  AccountMergeRecord,
  AdminAuditRecord,
  AdminCounts,
  AdminFavoriteFolderRow,
  AdminOrderFilter,
  AdminProductFilter,
  AdminUserFilter,
  AdminUserSessionSummary,
  AdminUserSummary,
  BindingRecord,
  CartItemRecord,
  CatalogSyncRunRecord,
  AddressRecord,
  DeletionChallengeRecord,
  DeletionCascadeCounts,
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
  UserDeviceRecord,
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
    privacyConsent: row['privacy_consent_version']
      ? {
          version: row['privacy_consent_version'] as string,
          acceptedAt: toDate(row['privacy_consent_at']),
          channel: row['privacy_consent_channel'] === 'native' ? 'native' : 'web',
          source: (row['privacy_consent_source'] as string | null) ?? 'unknown',
        }
      : null,
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

function mapRefreshToken(row: Row): RefreshTokenRecord {
  return {
    tokenHash: row['token_hash'] as string,
    userId: row['user_id'] as string,
    expiresAt: toDate(row['expires_at']),
    revokedAt: toDateOrNull(row['revoked_at']),
    replacedBy: (row['replaced_by'] as string | null) ?? null,
    createdAt: toDate(row['created_at']),
    deviceId: (row['device_id'] as string | null) ?? null,
    deviceModel: (row['device_model'] as string | null) ?? null,
    osName: (row['os_name'] as string | null) ?? null,
    osVersion: (row['os_version'] as string | null) ?? null,
    networkType: (row['network_type'] as string | null) ?? null,
    carrier: (row['carrier'] as string | null) ?? null,
    clientIp: (row['client_ip'] as string | null) ?? null,
  };
}

function mapUserDevice(row: Row): UserDeviceRecord {
  return {
    userId: row['user_id'] as string,
    deviceId: row['device_id'] as string,
    deviceModel: (row['device_model'] as string) ?? '',
    osName: (row['os_name'] as string) ?? 'Web',
    osVersion: (row['os_version'] as string) ?? '',
    networkType: (row['network_type'] as string) ?? 'none',
    carrier: (row['carrier'] as string) ?? '',
    clientIp: (row['client_ip'] as string) ?? '',
    updatedAt: toDate(row['updated_at']),
  };
}

/**
 * SQL 字符串字面量：单引号成对转义。
 * 全角→半角译表的「半角」一侧包含 ASCII 单引号（0x27），直接内插会提前闭合字面量，
 * 使整条搜索 SQL 变成语法错误（生产 500 的真实成因），所以译表一律走这里。
 */
const sqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** 搜索 SQL 片段：与 lib/search 的 TS 归一口径逐字对应，避免两条读路径行为漂移。 */
const normSql = (expr: string): string =>
  `lower(translate(coalesce(${expr}, ''), ${sqlLiteral(FULLWIDTH_TRANSLATE_FROM)}, ${sqlLiteral(FULLWIDTH_TRANSLATE_TO)}))`;

/** 规格键：去空白 → 去 M 前缀 → 分隔符归一 → 去默认粗牙 1.0 → 合并连续 x。 */
function specKeySql(expr: string): string {
  return [
    'regexp_replace(',
    'regexp_replace(',
    'regexp_replace(',
    'regexp_replace(',
    'regexp_replace(',
    `regexp_replace(${normSql(expr)}, '\\s+', '', 'g'),`,
    `'^m', '', 'g'),`,
    `'[-*×]', 'x', 'g'),`,
    `'([-x])1(\\.0+)?([-x]|$)', '\\1\\3', 'g'),`,
    `'-', 'x', 'g'),`,
    `'x{2,}', 'x', 'g')`,
  ].join(' ');
}

const SQL_SEARCH_TEXT = normSql(
  `concat_ws(' ', title, subtitle, coalesce(brand, ''), coalesce(source_id, ''), coalesce(source_item_no, ''), coalesce(specs::text, ''))`,
);

const SQL_SPEC_KEY = specKeySql(`specs->>'规格'`);

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

  ops = {
    lastCatalogSyncRun: async (): Promise<CatalogSyncRunRecord | null> => {
      try {
        const res = await this.pool.query(
          `select run_id, started_at, finished_at, status, stats, report_path, error
             from catalog_sync_runs
            order by started_at desc
            limit 1`,
        );
        const row = res.rows[0];
        if (!row) return null;
        const iso = (value: unknown): string =>
          value instanceof Date ? value.toISOString() : String(value ?? '');
        return {
          runId: String(row['run_id']),
          startedAt: iso(row['started_at']),
          finishedAt: row['finished_at'] == null ? null : iso(row['finished_at']),
          status: String(row['status'] ?? 'unknown'),
          stats: (row['stats'] as Record<string, unknown> | null) ?? null,
          reportPath: (row['report_path'] as string | null) ?? null,
          error: (row['error'] as string | null) ?? null,
        };
      } catch {
        // 表未建 / 老库 / 权限不足：不参与业务，健康检查保持可用
        return null;
      }
    },
  };

  users = {
    insert: async (user: UserRecord): Promise<UserRecord> => {
      const res = await this.pool.query(
        `insert into users (id, account_no, snowflake, ulid, uuid_v7, nickname, avatar_url, bio,
           username, guest, phone, email, password_hash, status, privacy_consent_version,
           privacy_consent_at, privacy_consent_channel, privacy_consent_source, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning *`,
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
          user.privacyConsent?.version ?? null,
          user.privacyConsent?.acceptedAt ?? null,
          user.privacyConsent?.channel ?? null,
          user.privacyConsent?.source ?? null,
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
        privacyConsent: 'privacy_consent_version',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      };
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [key, column] of Object.entries(columns)) {
        if (key === 'id' || key === 'createdAt' || key === 'updatedAt') continue;
        if (!(key in patch)) continue;
        // 同意记录是一个对象，落成 4 个列，不能按单列直传。
        if (key === 'privacyConsent') {
          const consent = patch.privacyConsent;
          if (!consent) continue;
          sets.push(
            `privacy_consent_version = $${i}, privacy_consent_at = $${i + 1}, ` +
              `privacy_consent_channel = $${i + 2}, privacy_consent_source = $${i + 3}`,
          );
          values.push(consent.version, consent.acceptedAt, consent.channel, consent.source);
          i += 4;
          continue;
        }
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

  accountChallenges = {
    insert: async (record: DeletionChallengeRecord): Promise<void> => {
      await this.pool.query(
        `insert into deletion_challenges
           (challenge, user_id, device_id, expires_at, consumed_at, created_at)
         values ($1,$2,$3,$4,$5, now())`,
        [record.challenge, record.userId, record.deviceId, record.expiresAt, record.consumedAt],
      );
    },
    // 单条 UPDATE 完成「校验 + 消费」：并发回放只有一个请求能拿到行，重复调用返回 null。
    consume: async (challenge: string): Promise<DeletionChallengeRecord | null> => {
      const res = await this.pool.query(
        `update deletion_challenges set consumed_at = now()
         where challenge = $1 and consumed_at is null and expires_at > now()
         returning *`,
        [challenge],
      );
      return res.rows[0] ? mapChallenge(res.rows[0] as Row) : null;
    },
    purgeStale: async (before: Date): Promise<number> => {
      const res = await this.pool.query(
        `delete from deletion_challenges
         where coalesce(consumed_at, expires_at) <= $1`,
        [before],
      );
      return res.rowCount ?? 0;
    },
  };

  accountDeletion = {
    /**
     * 级联删除 + 订单/支付脱敏走 0022 的 delete_account 单函数：
     * 函数体在 PG 内单事务提交；经 CloudBase 网关时一次 mix_exec 调用即一个事务，
     * 规避多语句桥接下的中间态。返回各类清除/脱敏条数。
     */
    erase: async (userId: string): Promise<DeletionCascadeCounts> => {
      const res = await this.pool.query('select delete_account($1) as result', [userId]);
      const candidate = res.rows[0]?.['result'];
      let raw: Row = {};
      if (typeof candidate === 'string') {
        try {
          raw = JSON.parse(candidate) as Row;
        } catch {
          raw = {};
        }
      } else if (candidate && typeof candidate === 'object') {
        raw = candidate as Row;
      }
      const num = (v: unknown): number => Number(v ?? 0);
      return {
        binds: num(raw['binds']),
        devices: num(raw['devices']),
        addresses: num(raw['addresses']),
        favorites: num(raw['favorites']),
        carts: num(raw['carts']),
        pushTokens: num(raw['pushTokens']),
        ordersAnonymized: num(raw['ordersAnonymized']),
        paymentsAnonymized: num(raw['paymentsAnonymized']),
        revokedSessions: num(raw['revokedSessions']),
      };
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
    deleteByUser: async (userId: string): Promise<number> => {
      const res = await this.pool.query('delete from bindings where user_id = $1', [userId]);
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
    purgeStale: async (before: Date): Promise<number> => {
      const res = await this.pool.query(
        `delete from oauth_states
         where coalesce(consumed_at, expires_at) <= $1`,
        [before],
      );
      return res.rowCount ?? 0;
    },
  };

  refreshTokens = {
    insert: async (token: RefreshTokenRecord): Promise<void> => {
      await this.pool.query(
        `insert into refresh_tokens
           (token_hash, user_id, expires_at, revoked_at, replaced_by, created_at,
            device_id, device_model, os_name, os_version, network_type, carrier, client_ip)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          token.tokenHash,
          token.userId,
          token.expiresAt,
          token.revokedAt,
          token.replacedBy,
          token.createdAt,
          token.deviceId,
          token.deviceModel,
          token.osName,
          token.osVersion,
          token.networkType,
          token.carrier,
          token.clientIp,
        ],
      );
    },
    findByHash: async (hash: string): Promise<RefreshTokenRecord | null> => {
      const res = await this.pool.query('select * from refresh_tokens where token_hash = $1 limit 1', [
        hash,
      ]);
      return res.rows[0] ? mapRefreshToken(res.rows[0] as Row) : null;
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
      return res.rows.map((row) => mapRefreshToken(row as Row));
    },
    listByUser: async (userId: string, limit: number): Promise<RefreshTokenRecord[]> => {
      const res = await this.pool.query(
        'select * from refresh_tokens where user_id = $1 order by created_at desc limit $2',
        [userId, limit],
      );
      return res.rows.map((row) => mapRefreshToken(row as Row));
    },
    revokeByUser: async (userId: string): Promise<number> => {
      const res = await this.pool.query(
        'update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null',
        [userId],
      );
      return res.rowCount ?? 0;
    },
    deleteByUser: async (userId: string): Promise<number> => {
      const res = await this.pool.query('delete from refresh_tokens where user_id = $1', [userId]);
      return res.rowCount ?? 0;
    },
    purgeExpired: async (before: Date): Promise<number> => {
      const res = await this.pool.query(
        'delete from refresh_tokens where coalesce(revoked_at, expires_at) <= $1',
        [before],
      );
      return res.rowCount ?? 0;
    },
  };

  userDevices = {
    upsert: async (record: UserDeviceRecord): Promise<void> => {
      await this.pool.query(
        `insert into user_devices
           (user_id, device_id, device_model, os_name, os_version, network_type, carrier, client_ip, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (user_id, device_id) do update set
           device_model  = excluded.device_model,
           os_name       = excluded.os_name,
           os_version    = excluded.os_version,
           network_type  = excluded.network_type,
           carrier       = excluded.carrier,
           client_ip     = excluded.client_ip,
           updated_at    = excluded.updated_at`,
        [
          record.userId,
          record.deviceId,
          record.deviceModel,
          record.osName,
          record.osVersion,
          record.networkType,
          record.carrier,
          record.clientIp,
          record.updatedAt,
        ],
      );
    },
    find: async (userId: string, deviceId: string): Promise<UserDeviceRecord | null> => {
      const res = await this.pool.query(
        'select * from user_devices where user_id = $1 and device_id = $2 limit 1',
        [userId, deviceId],
      );
      return res.rows[0] ? mapUserDevice(res.rows[0] as Row) : null;
    },
    latest: async (userId: string): Promise<UserDeviceRecord | null> => {
      const res = await this.pool.query(
        'select * from user_devices where user_id = $1 order by updated_at desc limit 1',
        [userId],
      );
      return res.rows[0] ? mapUserDevice(res.rows[0] as Row) : null;
    },
    listByUser: async (userId: string): Promise<UserDeviceRecord[]> => {
      const res = await this.pool.query(
        'select * from user_devices where user_id = $1 order by updated_at desc',
        [userId],
      );
      return res.rows.map((row) => mapUserDevice(row as Row));
    },
    deleteByUser: async (userId: string): Promise<number> => {
      const res = await this.pool.query('delete from user_devices where user_id = $1', [userId]);
      return res.rowCount ?? 0;
    },
    purgeStale: async (before: Date): Promise<number> => {
      const res = await this.pool.query(
        `delete from user_devices ud
         where ud.updated_at <= $1
           and not exists (
             select 1 from refresh_tokens rt
              where rt.user_id = ud.user_id
                and rt.device_id = ud.device_id
                and rt.revoked_at is null
                and rt.expires_at > now()
           )`,
        [before],
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
    purgeStale: async (before: Date): Promise<number> => {
      const res = await this.pool.query(
        'delete from sms_codes where coalesce(consumed_at, expires_at) <= $1',
        [before],
      );
      return res.rowCount ?? 0;
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
    anonymizeByUser: async (userId: string): Promise<number> => {
      const res = await this.pool.query(
        'update payments set user_id = null where user_id = $1',
        [userId],
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
    deleteByUser: async (userId: string): Promise<number> => {
      const res = await this.pool.query('delete from push_tokens where user_id = $1', [userId]);
      return res.rowCount ?? 0;
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
        ctgs?: string[];
        dims?: string;
        lens?: string;
        brand?: string;
        std?: string;
        grd?: string;
        mtl?: string;
        ttt?: string;
        trts?: string[];
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
        // 分类多选（源站 ctgs）：多值 OR；每个节点仍按子孙三级类目收敛，与 cat 完全同口径。
        if (filter.ctgs?.length) {
          params.push(filter.ctgs);
          const i = params.length;
          conditions.push(
            `c3_id in (select id from catalog_categories where id = any($${i}::text[]) or parent_id = any($${i}::text[])
                        or parent_id in (select id from catalog_categories where parent_id = any($${i}::text[])))`,
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
        // 属性筛选：品牌落列，标准/等级/材质/表面处理落在 specs（源站中文键）里。
        if (filter.brand) {
          params.push(filter.brand);
          conditions.push(`brand = $${params.length}`);
        }
        for (const [key, column] of [
          ['std', '标准'],
          ['grd', '等级'],
          ['mtl', '材质'],
          ['ttt', '表面处理'],
        ] as const) {
          const value = filter[key];
          if (!value) continue;
          params.push(value);
          conditions.push(`specs->>'${column}' = $${params.length}`);
        }
        // 牙别多选（源站 trts）：取值来自 specs.牙别，多值 OR；单独成维，不与表面处理（ttt）合并。
        if (filter.trts?.length) {
          params.push(filter.trts);
          conditions.push(`specs->>'牙别' = any($${params.length}::text[])`);
        }
        if (filter.keyword) {
          // 搜索口径统一走 lib/search：多词 AND、项目号 12/6 位、规格等价、全半角/大小写归一。
          // 落点在 SQL：用 translate 做全半角归一（不新增列、不要求回填），15k 目录上为顺序扫描，
          // 现有索引无法覆盖 `%kw%`，这是有意的取舍（见里程碑报告）。
          const tokens = buildSearchTokens(filter.keyword);
          for (const token of tokens) {
            if (token.kind === 'itemNoMiss') {
              // 7~11 位中间片段源站不匹配，保持一致：整条查询直接不命中
              conditions.push('false');
              continue;
            }
            if (token.kind === 'itemNo12') {
              params.push(token.raw);
              const i = params.length;
              conditions.push(`(coalesce(source_id, '') = $${i} or coalesce(source_item_no, '') = $${i})`);
              continue;
            }
            if (token.kind === 'itemNo6') {
              params.push(`${escapeLikePattern(token.raw)}%`);
              const i = params.length;
              conditions.push(
                `(coalesce(source_id, '') like $${i} escape '\\' or coalesce(source_item_no, '') like $${i} escape '\\')`,
              );
              continue;
            }
            params.push(`%${escapeLikePattern(token.raw)}%`);
            const pattern = params.length;
            if (token.kind === 'spec') {
              params.push(token.canonical);
              // 有「规格」键时只做等价比对（避免 M12x1 命中 M12x1.5）；缺规格字段才回落到文本子串。
              conditions.push(
                `((coalesce(specs->>'规格', '') <> '' and ${SQL_SPEC_KEY} = $${params.length})
                  or (coalesce(specs->>'规格', '') = '' and ${SQL_SEARCH_TEXT} like $${pattern} escape '\\'))`,
              );
            } else {
              conditions.push(`${SQL_SEARCH_TEXT} like $${pattern} escape '\\'`);
            }
          }
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
      listChildCategories: async (parentId: string | null, opts?: { includeEmpty?: boolean }) => {
        const res = await this.pool.query(
          `select id, code, name, level, product_count
             from catalog_categories
            where source in ('egluosi', 'hznzcn') and is_active
              ${opts?.includeEmpty ? '' : 'and product_count > 0'}
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
      // 任意节点（一级/二级/三级）都按其子孙三级类目收敛，筛选条在每一层都有值。
      listSpecOptions: async (nodeId: string) => {
        const scope = `c3_id in (select id from catalog_categories
                        where id = $1 or parent_id = $1
                           or parent_id in (select id from catalog_categories where parent_id = $1))
                       and listed is not false`;
        const [dims, lens, brands, stds, grds, mtls, ttts, trts] = await Promise.all([
          this.pool.query(
            `select distinct spec_dims as v from products where ${scope} and spec_dims is not null order by v`,
            [nodeId],
          ),
          this.pool.query(
            `select distinct spec_lens as v from products where ${scope} and spec_lens is not null order by v`,
            [nodeId],
          ),
          this.pool.query(
            `select distinct brand as v from products where ${scope} and coalesce(brand, '') <> '' order by v`,
            [nodeId],
          ),
          ...(['标准', '等级', '材质', '表面处理', '牙别'] as const).map((column) =>
            this.pool.query(
              `select distinct specs->>'${column}' as v from products
                where ${scope} and coalesce(specs->>'${column}', '') <> '' order by v`,
              [nodeId],
            ),
          ),
        ]);
        const values = (res: { rows: unknown[] }): string[] =>
          res.rows.map((row) => String((row as Record<string, unknown>)['v']));
        return {
          dims: values(dims!),
          lens: values(lens!),
          brands: values(brands!),
          stds: values(stds!),
          grds: values(grds!),
          mtls: values(mtls!),
          ttts: values(ttts!),
          trts: values(trts!),
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
      deleteByUser: async (userId: string): Promise<number> => {
        const res = await this.pool.query('delete from carts where user_id = $1', [userId]);
        return res.rowCount ?? 0;
      },
      purgeStale: async (before: Date): Promise<number> => {
        const res = await this.pool.query('delete from carts where updated_at <= $1', [before]);
        return res.rowCount ?? 0;
      },
    },
    addresses: {
      listByUser: async (userId: string): Promise<AddressRecord[]> => {
        const res = await this.pool.query(
          `select * from mall_addresses where user_id = $1
           order by is_default desc, created_at desc`,
          [userId],
        );
        return res.rows.map((row) => mapAddress(row as Row));
      },
      findById: async (userId: string, id: string): Promise<AddressRecord | null> => {
        const res = await this.pool.query(
          'select * from mall_addresses where user_id = $1 and id = $2',
          [userId, id],
        );
        return res.rows[0] ? mapAddress(res.rows[0] as Row) : null;
      },
      insert: async (address: AddressRecord): Promise<AddressRecord> => {
        await this.pool.query(
          `insert into mall_addresses (id, user_id, receiver_name, receiver_phone,
             province, city, district, detail, is_default, created_at, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            address.id,
            address.userId,
            address.receiverName,
            address.receiverPhone,
            address.province,
            address.city,
            address.district,
            address.detail,
            address.isDefault,
            address.createdAt,
            address.updatedAt,
          ],
        );
        return address;
      },
      update: async (
        userId: string,
        id: string,
        patch: Partial<AddressRecord>,
      ): Promise<AddressRecord | null> => {
        const fields: string[] = [];
        const values: unknown[] = [];
        const push = (column: string, value: unknown): void => {
          values.push(value);
          fields.push(`${column} = $${values.length}`);
        };
        if (patch.receiverName !== undefined) push('receiver_name', patch.receiverName);
        if (patch.receiverPhone !== undefined) push('receiver_phone', patch.receiverPhone);
        if (patch.province !== undefined) push('province', patch.province);
        if (patch.city !== undefined) push('city', patch.city);
        if (patch.district !== undefined) push('district', patch.district);
        if (patch.detail !== undefined) push('detail', patch.detail);
        if (patch.isDefault !== undefined) push('is_default', patch.isDefault);
        if (fields.length === 0) {
          const res = await this.pool.query(
            'select * from mall_addresses where user_id = $1 and id = $2',
            [userId, id],
          );
          return res.rows[0] ? mapAddress(res.rows[0] as Row) : null;
        }
        push('updated_at', new Date());
        values.push(userId, id);
        const res = await this.pool.query(
          `update mall_addresses set ${fields.join(', ')}
           where user_id = $${values.length - 1} and id = $${values.length}
           returning *`,
          values,
        );
        return res.rows[0] ? mapAddress(res.rows[0] as Row) : null;
      },
      remove: async (userId: string, id: string): Promise<void> => {
        await this.pool.query('delete from mall_addresses where user_id = $1 and id = $2', [
          userId,
          id,
        ]);
      },
      setDefault: async (userId: string, id: string): Promise<AddressRecord | null> => {
        // 单条 update 一次性改写该用户全部地址的 is_default：只有命中 id 的那条为 true。
        // 网关无事务时也不会出现「先清后设」中间态导致没有默认地址。
        const res = await this.pool.query(
          `update mall_addresses
             set is_default = (id = $2), updated_at = now()
           where user_id = $1
           returning *`,
          [userId, id],
        );
        const rows = res.rows.map((row) => mapAddress(row as Row));
        return rows.find((row) => row.id === id) ?? null;
      },
      deleteByUser: async (userId: string): Promise<number> => {
        const res = await this.pool.query('delete from mall_addresses where user_id = $1', [userId]);
        return res.rowCount ?? 0;
      },
    },
    /** 满减档位（0017）：只读启用档位，按 sort_no / min_fen 排序。 */
    manjianTiers: {
      listEnabled: async (): Promise<ManjianTierRecord[]> => {
        const res = await this.pool.query(
          'select * from mall_manjian_tiers where enabled = true order by sort_no asc, min_fen asc',
        );
        return res.rows.map((row) => mapManjianTier(row as Row));
      },
    },
    orders: {
      insert: async (order: OrderRecord, items: OrderItemRecord[]): Promise<OrderRecord> => {
        // 网关模式没有跨语句事务，订单与明细必须在单条语句里原子落库：
        // 走 0005_place_order.sql 里的 plpgsql 函数。
        if (!this.pool.connect) {
          await this.pool.query(
            `select place_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16::jsonb)`,
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
                  line_status: item.lineStatus ?? 'A',
                })),
              ),
              order.addressId,
              order.deliveryMethod,
              order.deliverySlot,
              // 三层优惠快照（0017），金额均为整数分
              JSON.stringify({
                subtotalFen: order.subtotalFen ?? 0,
                mallDiscountFen: order.mallDiscountFen ?? 0,
                tejiaDiscountFen: order.tejiaDiscountFen ?? 0,
                manjianDiscountFen: order.manjianDiscountFen ?? 0,
                discountTotalFen: order.discountTotalFen ?? 0,
              }),
            ],
          );
          return order;
        }

        const client = await this.pool.connect();
        try {
          await client.query('begin');
          await client.query(
            `insert into orders (id, order_no, user_id, status, total_fen, receiver_name,
               receiver_phone, address, remark, created_at, paid_at,
               address_id, delivery_method, delivery_slot,
               subtotal_fen, mall_discount_fen, tejia_discount_fen,
               manjian_discount_fen, discount_total_fen)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
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
              order.addressId,
              order.deliveryMethod,
              order.deliverySlot,
              order.subtotalFen ?? 0,
              order.mallDiscountFen ?? 0,
              order.tejiaDiscountFen ?? 0,
              order.manjianDiscountFen ?? 0,
              order.discountTotalFen ?? 0,
            ],
          );
          for (const item of items) {
            await client.query(
              `insert into order_items (id, order_id, product_id, title, price_fen, quantity, subtotal_fen,
                 pack_unit, pack_qty, price_li, stock_unconfirmed, line_status)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
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
                item.stockUnconfirmed ?? false,
                item.lineStatus ?? 'A',
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
      cancel: async (
        orderId: string,
        fromStatuses: OrderRecord['status'][],
        reason: string,
        by: NonNullable<OrderRecord['cancelledBy']>,
      ): Promise<boolean> => {
        // 与源站「已分配拣货不可取消」同口径：picking_at 非空的行任何情况都不允许再取消
        const res = await this.pool.query(
          `update orders
              set status = 'cancelled',
                  cancelled_at = now(),
                  cancel_reason = $3,
                  cancelled_by = $4
            where id = $1
              and status = any($2::text[])
              and picking_at is null
            returning id`,
          [orderId, fromStatuses, reason, by],
        );
        return res.rowCount === 1;
      },
      markStatusAt: async (
        orderId: string,
        from: OrderRecord['status'],
        to: OrderRecord['status'],
        at: Date,
      ): Promise<boolean> => {
        // 时间戳列与状态一一对应；只有 picking/shipped/completed 会写，其它状态只改状态
        const column =
          to === 'picking' ? 'picking_at' : to === 'shipped' ? 'shipped_at' : to === 'completed' ? 'completed_at' : null;
        const res = column
          ? await this.pool.query(
              `update orders set status = $3, ${column} = $4 where id = $1 and status = $2 returning id`,
              [orderId, from, to, at],
            )
          : await this.pool.query(
              'update orders set status = $3 where id = $1 and status = $2 returning id',
              [orderId, from, to],
            );
        return res.rowCount === 1;
      },
      anonymizeByUser: async (userId: string): Promise<number> => {
        const res = await this.pool.query(
          `update orders
             set user_id = null, receiver_name = '', receiver_phone = '', address = '',
                 remark = null, address_id = null
           where user_id = $1`,
          [userId],
        );
        return res.rowCount ?? 0;
      },
      anonymizeStaleCompleted: async (before: Date): Promise<number> => {
        const res = await this.pool.query(
          `update orders
             set receiver_name = '', receiver_phone = '', address = '',
                 remark = null, address_id = null
           where user_id is not null
             and status in ('completed', 'cancelled')
             and coalesce(completed_at, cancelled_at) <= $1
             and (receiver_name <> '' or receiver_phone <> '' or address <> '')`,
          [before],
        );
        return res.rowCount ?? 0;
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
      deleteByUser: async (userId: string): Promise<number> => {
        const res = await this.pool.query('delete from order_requests where user_id = $1', [userId]);
        return res.rowCount ?? 0;
      },
    },
    favorites: {
      listFolders: async (userId: string): Promise<FavoriteFolderRecord[]> => {
        const res = await this.pool.query(
          'select * from mall_favorite_folders where user_id = $1 order by created_at asc',
          [userId],
        );
        return res.rows.map(mapFavoriteFolder);
      },
      findFolder: async (userId: string, folderId: string): Promise<FavoriteFolderRecord | null> => {
        const res = await this.pool.query(
          'select * from mall_favorite_folders where id = $1 and user_id = $2 limit 1',
          [folderId, userId],
        );
        return res.rows[0] ? mapFavoriteFolder(res.rows[0]) : null;
      },
      insertFolder: async (folder: FavoriteFolderRecord): Promise<FavoriteFolderRecord> => {
        const res = await this.pool.query(
          `insert into mall_favorite_folders (id, user_id, name, is_default, created_at, updated_at)
           values ($1,$2,$3,$4,$5,$5) returning *`,
          [folder.id, folder.userId, folder.name, folder.isDefault, folder.createdAt],
        );
        const row = res.rows[0];
        if (!row) throw new Error('收藏夹写入失败');
        return mapFavoriteFolder(row);
      },
      updateFolder: async (
        userId: string,
        folderId: string,
        patch: { name?: string; isDefault?: boolean },
      ): Promise<FavoriteFolderRecord | null> => {
        // 置默认走事务内「先清旧默认、再置新默认」，避免部分唯一索引被中间态撞到
        if (patch.isDefault === true) {
          if (!this.pool.connect) throw new Error('当前存储驱动不支持事务');
          const client = await this.pool.connect();
          try {
            await client.query('begin');
            await client.query(
              'update mall_favorite_folders set is_default = false, updated_at = now() where user_id = $1 and is_default',
              [userId],
            );
            // 改名与设默认可能同时传，合并到同一条 update
            const res = await client.query(
              `update mall_favorite_folders
                  set is_default = true,
                      name = coalesce($3, name),
                      updated_at = now()
                where id = $1 and user_id = $2
                returning *`,
              [folderId, userId, patch.name ?? null],
            );
            await client.query('commit');
            return res.rows[0] ? mapFavoriteFolder(res.rows[0]) : null;
          } catch (error) {
            await client.query('rollback');
            throw error;
          } finally {
            client.release();
          }
        }
        const res = await this.pool.query(
          `update mall_favorite_folders
              set name = coalesce($3, name), updated_at = now()
            where id = $1 and user_id = $2
            returning *`,
          [folderId, userId, patch.name ?? null],
        );
        return res.rows[0] ? mapFavoriteFolder(res.rows[0]) : null;
      },
      setDefault: async (userId: string, folderId: string): Promise<FavoriteFolderRecord | null> => {
        if (!this.pool.connect) throw new Error('当前存储驱动不支持事务');
        const client = await this.pool.connect();
        try {
          await client.query('begin');
          await client.query(
            'update mall_favorite_folders set is_default = false, updated_at = now() where user_id = $1 and is_default',
            [userId],
          );
          const res = await client.query(
            `update mall_favorite_folders
                set is_default = true, updated_at = now()
              where id = $1 and user_id = $2
              returning *`,
            [folderId, userId],
          );
          await client.query('commit');
          return res.rows[0] ? mapFavoriteFolder(res.rows[0]) : null;
        } catch (error) {
          await client.query('rollback');
          throw error;
        } finally {
          client.release();
        }
      },
      listItems: async (folderId: string): Promise<FavoriteItemRecord[]> => {
        const res = await this.pool.query(
          'select * from mall_favorite_items where folder_id = $1 order by created_at desc',
          [folderId],
        );
        return res.rows.map(mapFavoriteItem);
      },
      insertItem: async (item: FavoriteItemRecord): Promise<FavoriteItemRecord> => {
        // on conflict do nothing：同夹内重复收藏按幂等处理，再回查既有行
        const res = await this.pool.query(
          `insert into mall_favorite_items (id, folder_id, user_id, product_id, created_at)
           values ($1,$2,$3,$4,$5)
           on conflict (folder_id, product_id) do nothing
           returning *`,
          [item.id, item.folderId, item.userId, item.productId, item.createdAt],
        );
        if (res.rows[0]) return mapFavoriteItem(res.rows[0]);
        const existing = await this.pool.query(
          'select * from mall_favorite_items where folder_id = $1 and product_id = $2 limit 1',
          [item.folderId, item.productId],
        );
        const existingRow = existing.rows[0];
        if (!existingRow) throw new Error('收藏条目写入失败');
        return mapFavoriteItem(existingRow);
      },
      deleteItem: async (folderId: string, productId: string): Promise<boolean> => {
        const res = await this.pool.query(
          'delete from mall_favorite_items where folder_id = $1 and product_id = $2',
          [folderId, productId],
        );
        return (res.rowCount ?? 0) > 0;
      },
      clearItems: async (folderId: string): Promise<number> => {
        const res = await this.pool.query('delete from mall_favorite_items where folder_id = $1', [folderId]);
        return res.rowCount ?? 0;
      },
      countItems: async (folderId: string): Promise<number> => {
        const res = await this.pool.query(
          'select count(*)::int as n from mall_favorite_items where folder_id = $1',
          [folderId],
        );
        return (res.rows[0]?.['n'] as number) ?? 0;
      },
      deleteByUser: async (userId: string): Promise<number> => {
        const items = await this.pool.query(
          'delete from mall_favorite_items where user_id = $1',
          [userId],
        );
        await this.pool.query('delete from mall_favorite_folders where user_id = $1', [userId]);
        return items.rowCount ?? 0;
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

  /**
   * 后台运营台数据面（PostgreSQL 实现）。
   * 与 MemoryStore 同口径：关键字大小写不敏感（ilike）、按创建时间倒序、total 为筛选后总数。
   * 额外约束：这里的查询只读取，不改动用户侧读路径；唯一的写操作是商品上下架。
   */
  admin = {
    counts: async (): Promise<AdminCounts> => {
      // 商品、用户、订单、收藏、购物车各一条聚合查询，避免逐表多次往返。
      const productRes = await this.pool.query(
        `select count(*)::int as total,
                count(*) filter (where listed is not false)::int as listed,
                count(*) filter (where listed is false)::int as unlisted,
                count(*) filter (where coalesce(source_key, '') <> '')::int as catalog
           from products`,
      );
      const userRes = await this.pool.query(
        `select count(*)::int as total,
                count(*) filter (where status = 'active')::int as active,
                count(*) filter (where guest)::int as guests,
                count(*) filter (where status = 'frozen')::int as frozen
           from users`,
      );
      const orderRes = await this.pool.query(
        'select status, count(*)::int as c from orders group by status',
      );
      const favoriteRes = await this.pool.query(
        `select (select count(*)::int from mall_favorite_folders) as folders,
                (select count(*)::int from mall_favorite_items) as items`,
      );
      // 购物车实体表名是 carts（不是 cart_items）。写错表名在生产会直接抛 42P01，
      // 让整个概览接口 500，所以这里与 infra/sql 里的建表语句保持逐字一致。
      const cartRes = await this.pool.query(
        'select count(*)::int as items, count(distinct user_id)::int as users from carts',
      );
      // 六态固定补齐，库里没有的状态也返回 0，前端不用做缺省判断。
      const byStatus: AdminCounts['orders']['byStatus'] = {
        pending: 0,
        paid: 0,
        picking: 0,
        shipped: 0,
        completed: 0,
        cancelled: 0,
      };
      for (const row of orderRes.rows) {
        byStatus[row['status'] as keyof typeof byStatus] = Number(row['c'] ?? 0);
      }
      const p = (productRes.rows[0] ?? {}) as Row;
      const u = (userRes.rows[0] ?? {}) as Row;
      const f = (favoriteRes.rows[0] ?? {}) as Row;
      const c = (cartRes.rows[0] ?? {}) as Row;
      return {
        products: {
          total: Number(p['total'] ?? 0),
          listed: Number(p['listed'] ?? 0),
          unlisted: Number(p['unlisted'] ?? 0),
          catalog: Number(p['catalog'] ?? 0),
        },
        users: {
          total: Number(u['total'] ?? 0),
          active: Number(u['active'] ?? 0),
          guests: Number(u['guests'] ?? 0),
          frozen: Number(u['frozen'] ?? 0),
        },
        orders: {
          total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
          byStatus,
        },
        favorites: { folders: Number(f['folders'] ?? 0), items: Number(f['items'] ?? 0) },
        carts: { items: Number(c['items'] ?? 0), users: Number(c['users'] ?? 0) },
      };
    },
    listProducts: async (
      filter: AdminProductFilter,
    ): Promise<{ rows: ProductRecord[]; total: number }> => {
      const params: unknown[] = [];
      const where: string[] = [];
      // listed 未传即不过滤；用户侧把 listed=false 视为下架，这里保持一致口径。
      if (filter.listed !== undefined) {
        where.push(filter.listed ? 'listed is not false' : 'listed is false');
      }
      if (filter.category) {
        params.push(filter.category);
        where.push(`category = $${params.length}`);
      }
      const keyword = (filter.keyword ?? '').trim();
      if (keyword) {
        params.push(`%${escapeLikePattern(keyword)}%`);
        const p = `$${params.length}`;
        where.push(
          `(title ilike ${p} or coalesce(source_item_no, '') ilike ${p} ` +
            `or coalesce(brand, '') ilike ${p} or coalesce(source_id, '') ilike ${p} or id ilike ${p})`,
        );
      }
      const whereSql = where.length ? `where ${where.join(' and ')}` : '';
      const totalRes = await this.pool.query(
        `select count(*)::int as total from products ${whereSql}`,
        params,
      );
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;
      const res = await this.pool.query(
        `select * from products ${whereSql} order by created_at desc, id limit $${limitIdx} offset $${offsetIdx}`,
        [...params, filter.limit, filter.offset],
      );
      return {
        rows: res.rows.map((row) => mapProduct(row as Row)),
        total: Number((totalRes.rows[0] as Row | undefined)?.['total'] ?? 0),
      };
    },
    setProductsListed: async (ids: string[], listed: boolean): Promise<number> => {
      if (!ids.length) return 0;
      // `is distinct from` 保证只更新状态确实变化的行，返回行数即实际变更条数。
      const res = await this.pool.query(
        `update products set listed = $1
          where id = any($2::text[]) and (listed is distinct from $1)
          returning id`,
        [listed, ids],
      );
      return res.rows.length;
    },
    listOrders: async (
      filter: AdminOrderFilter,
    ): Promise<{ rows: OrderRecord[]; total: number }> => {
      const params: unknown[] = [];
      const where: string[] = [];
      if (filter.status) {
        params.push(filter.status);
        where.push(`status = $${params.length}`);
      }
      const keyword = (filter.keyword ?? '').trim();
      if (keyword) {
        params.push(`%${escapeLikePattern(keyword)}%`);
        const p = `$${params.length}`;
        where.push(
          `(order_no ilike ${p} or receiver_name ilike ${p} or receiver_phone ilike ${p} ` +
            `or user_id ilike ${p} or id ilike ${p})`,
        );
      }
      const whereSql = where.length ? `where ${where.join(' and ')}` : '';
      const totalRes = await this.pool.query(
        `select count(*)::int as total from orders ${whereSql}`,
        params,
      );
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;
      const res = await this.pool.query(
        `select * from orders ${whereSql} order by created_at desc, id limit $${limitIdx} offset $${offsetIdx}`,
        [...params, filter.limit, filter.offset],
      );
      return {
        rows: res.rows.map((row) => mapOrder(row as Row)),
        total: Number((totalRes.rows[0] as Row | undefined)?.['total'] ?? 0),
      };
    },
    getOrder: async (orderId: string): Promise<OrderRecord | null> => {
      const res = await this.pool.query('select * from orders where id = $1 limit 1', [orderId]);
      return res.rows[0] ? mapOrder(res.rows[0] as Row) : null;
    },
    listUsers: async (
      filter: AdminUserFilter,
    ): Promise<{ rows: UserRecord[]; total: number }> => {
      const params: unknown[] = [];
      const where: string[] = [];
      const keyword = (filter.keyword ?? '').trim();
      if (keyword) {
        params.push(`%${escapeLikePattern(keyword)}%`);
        const p = `$${params.length}`;
        where.push(
          `(account_no ilike ${p} or nickname ilike ${p} or coalesce(username, '') ilike ${p} ` +
            `or coalesce(phone, '') ilike ${p} or coalesce(email, '') ilike ${p} or id ilike ${p})`,
        );
      }
      const whereSql = where.length ? `where ${where.join(' and ')}` : '';
      const totalRes = await this.pool.query(
        `select count(*)::int as total from users ${whereSql}`,
        params,
      );
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;
      const res = await this.pool.query(
        `select * from users ${whereSql} order by created_at desc, id limit $${limitIdx} offset $${offsetIdx}`,
        [...params, filter.limit, filter.offset],
      );
      return {
        rows: res.rows.map((row) => mapUser(row as Row)),
        total: Number((totalRes.rows[0] as Row | undefined)?.['total'] ?? 0),
      };
    },
    userSummary: async (userId: string): Promise<AdminUserSummary | null> => {
      const exists = await this.pool.query('select id from users where id = $1 limit 1', [userId]);
      if (!exists.rows[0]) return null;
      // 五条聚合可以并行，缩短详情页首屏时间。
      const [bindingRes, orderRes, folderRes, itemRes, cartRes] = await Promise.all([
        this.pool.query('select * from bindings where user_id = $1 order by created_at asc', [userId]),
        this.pool.query('select count(*)::int as c from orders where user_id = $1', [userId]),
        this.pool.query('select count(*)::int as c from mall_favorite_folders where user_id = $1', [
          userId,
        ]),
        this.pool.query('select count(*)::int as c from mall_favorite_items where user_id = $1', [
          userId,
        ]),
        // 同上：购物车表是 carts。
        this.pool.query('select count(*)::int as c from carts where user_id = $1', [userId]),
      ]);
      const countOf = (res: { rows: Row[] }): number =>
        Number((res.rows[0] as Row | undefined)?.['c'] ?? 0);
      return {
        bindings: bindingRes.rows.map((row) => mapBinding(row as Row)),
        orders: countOf(orderRes),
        favoriteFolders: countOf(folderRes),
        favoriteItems: countOf(itemRes),
        cartItems: countOf(cartRes),
      };
    },
    listUserSessions: async (
      userId: string,
      limit: number,
    ): Promise<AdminUserSessionSummary[]> => {
      const res = await this.pool.query(
        `select r.*, d.updated_at as device_updated_at
           from refresh_tokens r
           left join user_devices d
             on d.user_id = r.user_id and d.device_id = r.device_id
          where r.user_id = $1
          order by r.created_at desc
          limit $2`,
        [userId, limit],
      );
      return res.rows.map((row) => {
        const r = row as Row;
        const token = mapRefreshToken(r);
        return {
          id: token.tokenHash.slice(0, 8),
          createdAt: token.createdAt,
          revokedAt: token.revokedAt,
          deviceId: token.deviceId,
          model: token.deviceModel ?? '',
          osName: token.osName,
          osVersion: token.osVersion ?? '',
          networkType: token.networkType,
          carrier: token.carrier ?? '',
          ip: token.clientIp,
          lastSeenAt: r['device_updated_at'] ? toDate(r['device_updated_at']) : token.createdAt,
        };
      });
    },
    listFavoriteFolders: async (filter: {
      limit: number;
      offset: number;
    }): Promise<{ rows: AdminFavoriteFolderRow[]; total: number }> => {
      const totalRes = await this.pool.query(
        'select count(*)::int as total from mall_favorite_folders',
      );
      const res = await this.pool.query(
        `select f.*, u.nickname as user_nickname, u.account_no as user_account_no,
                (select count(*)::int from mall_favorite_items i where i.folder_id = f.id) as item_count
           from mall_favorite_folders f
           left join users u on u.id = f.user_id
          order by f.created_at desc, f.id
          limit $1 offset $2`,
        [filter.limit, filter.offset],
      );
      return {
        rows: res.rows.map((row) => {
          const r = row as Row;
          return {
            ...mapFavoriteFolder(r),
            itemCount: Number(r['item_count'] ?? 0),
            userNickname: (r['user_nickname'] as string | null) ?? null,
            userAccountNo: (r['user_account_no'] as string | null) ?? null,
          };
        }),
        total: Number((totalRes.rows[0] as Row | undefined)?.['total'] ?? 0),
      };
    },
    listManjianTiers: async (): Promise<ManjianTierRecord[]> => {
      const res = await this.pool.query('select * from mall_manjian_tiers order by sort_no asc, id');
      return res.rows.map((row) => mapManjianTier(row as Row));
    },
    audit: {
      append: async (entry: AdminAuditRecord): Promise<void> => {
        // before/after 以 jsonb 落库；node-postgres 会把对象序列化成 JSON 文本。
        await this.pool.query(
          `insert into admin_audit_logs
             (id, action, target_type, target_id, summary, before, after, actor, ip,
              user_agent, request_id, batch_id, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            entry.id,
            entry.action,
            entry.targetType,
            entry.targetId,
            entry.summary,
            entry.before ?? null,
            entry.after ?? null,
            entry.actor,
            entry.ip,
            entry.userAgent,
            entry.requestId,
            entry.batchId,
            entry.createdAt,
          ],
        );
      },
      list: async (limit: number, offset = 0): Promise<AdminAuditRecord[]> => {
        const res = await this.pool.query(
          'select * from admin_audit_logs order by created_at desc, id limit $1 offset $2',
          [limit, offset],
        );
        return res.rows.map((row) => mapAdminAudit(row as Row));
      },
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
    tejiaDiscountPct:
      row['tejia_discount_pct'] == null ? null : Number(row['tejia_discount_pct']),
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
    sourceOnSale: row['source_on_sale'] == null ? null : row['source_on_sale'] === true,
    sourceInvStatus: (row['source_inv_status'] as string | null) ?? null,
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

function mapAddress(row: Row): AddressRecord {
  return {
    id: row['id'] as string,
    userId: row['user_id'] as string,
    receiverName: row['receiver_name'] as string,
    receiverPhone: row['receiver_phone'] as string,
    province: row['province'] as string,
    city: row['city'] as string,
    district: row['district'] as string,
    detail: row['detail'] as string,
    isDefault: row['is_default'] === true,
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

function mapOrder(row: Row): OrderRecord {
  return {
    id: row['id'] as string,
    orderNo: row['order_no'] as string,
    userId: (row['user_id'] as string | null) ?? null,
    status: row['status'] as OrderRecord['status'],
    totalFen: Number(row['total_fen']),
    receiverName: row['receiver_name'] as string,
    receiverPhone: row['receiver_phone'] as string,
    address: row['address'] as string,
    addressId: (row['address_id'] as string | null) ?? null,
    deliveryMethod: (row['delivery_method'] as string | null) ?? null,
    deliverySlot: (row['delivery_slot'] as string | null) ?? null,
    remark: (row['remark'] as string | null) ?? null,
    // 0017 三层优惠快照：历史订单列为 default 0，这里统一转数字
    subtotalFen: row['subtotal_fen'] == null ? 0 : Number(row['subtotal_fen']),
    mallDiscountFen: row['mall_discount_fen'] == null ? 0 : Number(row['mall_discount_fen']),
    tejiaDiscountFen: row['tejia_discount_fen'] == null ? 0 : Number(row['tejia_discount_fen']),
    manjianDiscountFen: row['manjian_discount_fen'] == null ? 0 : Number(row['manjian_discount_fen']),
    discountTotalFen: row['discount_total_fen'] == null ? 0 : Number(row['discount_total_fen']),
    createdAt: toDate(row['created_at']),
    paidAt: toDateOrNull(row['paid_at']),
    // 0018 六态流转时间与取消留痕：历史订单全部为 null
    pickingAt: toDateOrNull(row['picking_at']),
    shippedAt: toDateOrNull(row['shipped_at']),
    completedAt: toDateOrNull(row['completed_at']),
    cancelledAt: toDateOrNull(row['cancelled_at']),
    cancelReason: (row['cancel_reason'] as string | null) ?? null,
    cancelledBy: (row['cancelled_by'] as OrderRecord['cancelledBy']) ?? null,
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
    stockUnconfirmed: row['stock_unconfirmed'] === true,
    // 0017 行状态快照；历史订单列缺失时按 A（到货）处理
    lineStatus: ((row['line_status'] as string | null) ?? 'A') as OrderItemRecord['lineStatus'],
  };
}

/** 收藏夹映射（0019）。 */
function mapFavoriteFolder(row: Row): FavoriteFolderRecord {
  return {
    id: String(row['id']),
    userId: String(row['user_id']),
    name: String(row['name']),
    isDefault: row['is_default'] === true,
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

/** 收藏条目映射（0019）：只存商品引用，不落价格快照。 */
function mapFavoriteItem(row: Row): FavoriteItemRecord {
  return {
    id: String(row['id']),
    folderId: String(row['folder_id']),
    userId: String(row['user_id']),
    productId: String(row['product_id']),
    createdAt: toDate(row['created_at']),
  };
}

/** 满减档位映射（0017）。 */
function mapManjianTier(row: Row): ManjianTierRecord {
  return {
    id: String(row['id']),
    minFen: Number(row['min_fen']),
    maxFen: row['max_fen'] == null ? null : Number(row['max_fen']),
    percent: Number(row['percent']),
    label: String(row['label'] ?? ''),
    enabled: row['enabled'] === true,
    sortNo: row['sort_no'] == null ? 0 : Number(row['sort_no']),
  };
}

/** 后台审计记录映射（0020）：before/after 为 jsonb，驱动已反序列化为对象。 */
function mapAdminAudit(row: Row): AdminAuditRecord {
  return {
    id: String(row['id']),
    action: String(row['action'] ?? ''),
    targetType: row['target_type'] as AdminAuditRecord['targetType'],
    targetId: String(row['target_id'] ?? ''),
    summary: String(row['summary'] ?? ''),
    before: row['before'] ?? null,
    after: row['after'] ?? null,
    actor: String(row['actor'] ?? 'admin'),
    ip: String(row['ip'] ?? ''),
    userAgent: String(row['user_agent'] ?? ''),
    requestId: String(row['request_id'] ?? ''),
    batchId: (row['batch_id'] as string | null) ?? null,
    createdAt: toDate(row['created_at']),
  };
}

function mapPayment(row: Row): PaymentRecord {
  return {
    id: row['id'] as string,
    outTradeNo: row['out_trade_no'] as string,
    userId: (row['user_id'] as string | null) ?? null,
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

function mapChallenge(row: Row): DeletionChallengeRecord {
  return {
    challenge: row['challenge'] as string,
    userId: row['user_id'] as string,
    deviceId: row['device_id'] as string,
    expiresAt: toDate(row['expires_at']),
    consumedAt: toDateOrNull(row['consumed_at']),
  };
}
