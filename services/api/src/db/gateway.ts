/**
 * CloudBase PostgreSQL 访问网关。
 *
 * 线上 PG 没有可直连的 TCP 连接串：
 * - `POST /v1/rdb/exec-pgsql`（SQL HTTP 接口）在本环境是只读会话，不能写；
 * - `POST /v1/rdb/rest/*` 走 PostgREST，service_role（API Key）可以读写 public schema；
 * - 我们的表在 `mixmapp` schema，PostgREST 只暴露 public，且 exec-pgsql 无法切 schema。
 *
 * 因此线上统一走 public.mix_exec(p_sql, p_params) 这个受控 SQL 桥：
 * 函数以定义者身份执行参数化 SQL，返回 JSON 行数组，读写都在一个事务里完成。
 * 桥只授权给 service_role，API Key 仅存在服务端，不下发前端。
 */

type Row = Record<string, unknown>;

export type QueryResult = { rows: Row[]; rowCount: number };

export type Queryable = {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
};

const TABLES = [
  'users',
  'bindings',
  'refresh_tokens',
  'sms_codes',
  'payments',
  'push_tokens',
  'products',
  'carts',
  'orders',
  'order_items',
  'order_requests',
] as const;

/** 网关会话默认 search_path=public，必须给自有表补 schema 前缀。 */
export function qualifySql(sql: string, schema = 'mixmapp'): string {
  const names = TABLES.join('|');
  let out = sql
    .replace(new RegExp(`\\b(from|into|update|join)\\s+(${names})\\b`, 'gi'), `$1 ${schema}.$2`)
    .replace(new RegExp(`\\bdelete\\s+from\\s+(${names})\\b`, 'gi'), `delete from ${schema}.$1`);
  out = out.replace(/\bselect\s+place_order\s*\(/gi, `select ${schema}.place_order(`);
  return out;
}

function sqlStateOf(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const matched = /^DATABASE_([0-9A-Z]{5})$/.exec(code);
  return matched?.[1];
}

function toParam(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

export class CloudBasePgGateway implements Queryable {
  readonly kind = 'cloudbase-pg-gateway' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly schema = 'mixmapp',
    private readonly timeoutMs = 20_000,
  ) {}

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/v1/rdb/rest/rpc/mix_exec`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_sql: qualifySql(sql, this.schema),
          p_params: params.map(toParam),
        }),
        signal: controller.signal,
      });
      const text = await response.text();
      const parsed: unknown = text ? JSON.parse(text) : [];
      if (!response.ok) {
        const error = parsed as { code?: string; message?: string; details?: string };
        throw Object.assign(new Error(error.message ?? `网关返回 ${response.status}`), {
          code: sqlStateOf(error.code),
          gatewayCode: error.code,
          details: error.details,
        });
      }
      const rows = (Array.isArray(parsed) ? parsed : [parsed]) as Row[];
      return { rows, rowCount: rows.length };
    } finally {
      clearTimeout(timer);
    }
  }

  async end(): Promise<void> {
    // 无连接池可关；保留方法让 PgStore.close() 不必分支
  }
}

export function createGatewayPool(baseUrl: string, apiKey: string, schema = 'mixmapp'): CloudBasePgGateway {
  return new CloudBasePgGateway(baseUrl, apiKey, schema);
}
