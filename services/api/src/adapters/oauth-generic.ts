import { createHash, randomBytes } from 'node:crypto';
import type { OAuthProfile, OAuthProvider } from './oauth.js';
import { AppError } from '../lib/errors.js';

/** 通用 OAuth2/OIDC 渠道的端点与字段映射：全部来自 config/oauth-providers.json。 */
export type GenericOAuthSpec = {
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scope?: string;
  fieldMap: {
    openId: string;
    unionId?: string;
    nickname?: string;
    avatarUrl?: string;
    phone?: string;
    phoneVerified?: string;
  };
  /** token 请求凭证位置：basic = Authorization: Basic，post = 放在表单体里 */
  tokenAuth?: 'basic' | 'post';
  /** 追加到 token 请求体的固定参数 */
  tokenBody?: Record<string, string>;
  /** token 请求体格式：form（默认）或 json */
  tokenFormat?: 'form' | 'json';
  userinfoAuth?: 'bearer' | 'query';
  userinfoMethod?: 'GET' | 'POST';
  /** 附加请求头，支持 {clientId} 插值 */
  userinfoHeaders?: Record<string, string>;
  extraAuthorizeParams?: Record<string, string>;
  /** 头像只有相对路径时补齐前缀 */
  avatarPrefix?: string;
  /**
   * 是否强制 PKCE（X / Twitter 等公共客户端必须开）。
   * 开启后在授权地址带 code_challenge(S256)，换 token 时回传 code_verifier。
   */
  pkce?: boolean;
};

export type GenericOAuthOptions = {
  key: string;
  clientId: string;
  clientSecret: string;
  spec: GenericOAuthSpec;
  fetch?: typeof globalThis.fetch;
};

/**
 * 按点号路径取值：支持 `data.items[0].name` 这类嵌套结构，
 * 有些渠道（如飞书）真实字段在 data.* 里，不需要为每家写一遍取数代码。
 */
function getPath(input: unknown, path: string): unknown {
  let current: unknown = input;
  for (const raw of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    const match = /^(.*?)((?:\[\d+\])*)$/.exec(raw);
    const name = match?.[1] ?? raw;
    const indexes = match?.[2] ?? '';
    if (name) current = (current as Record<string, unknown>)[name];
    for (const idx of indexes.match(/\d+/g) ?? []) {
      if (!Array.isArray(current)) return undefined;
      current = current[Number(idx)];
    }
  }
  return current;
}

const asString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
};

const form = (params: Record<string, string>): string =>
  Object.entries(params)
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

const withQuery = (base: string, params: Record<string, string>): string =>
  `${base}${base.includes('?') ? '&' : '?'}${form(params)}`;

// ===== PKCE（RFC 7636，S256）=====

const PKCE_TTL_MS = 10 * 60 * 1000;

type PkceTicket = { verifier: string; expiresAt: number };

/** 授权发起时按 state 暂存 verifier（state 一次性，天然防串用）。 */
const pkceByState = new Map<string, PkceTicket>();
/** 回跳时转存到 code 上：换 token 阶段只拿得到 code。 */
const pkceByCode = new Map<string, PkceTicket>();

const pkceKey = (provider: string, value: string): string => `${provider}:${value}`;

const sweepPkce = (): void => {
  const now = Date.now();
  for (const map of [pkceByState, pkceByCode]) {
    for (const [key, ticket] of map) if (ticket.expiresAt <= now) map.delete(key);
  }
};

/**
 * 回跳时把 state 上的 verifier 绑到本次 authorization code。
 * 未开启 PKCE 的渠道没有对应票据，直接返回（幂等，可无条件调用）。
 */
export function bindPkceCode(provider: string, code: string, state: string): void {
  if (!code || !state) return;
  const fromState = pkceKey(provider, state);
  const ticket = pkceByState.get(fromState);
  if (!ticket) return;
  pkceByState.delete(fromState);
  pkceByCode.set(pkceKey(provider, code), ticket);
  sweepPkce();
}

const takeVerifier = (provider: string, code: string): string => {
  const key = pkceKey(provider, code);
  const ticket = pkceByCode.get(key);
  pkceByCode.delete(key);
  return ticket && ticket.expiresAt > Date.now() ? ticket.verifier : '';
};

/** 只暴露状态码，避免把含 token 的响应体写进错误信息。 */
async function readJson(res: Response, label: string): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!res.ok) throw new AppError('PROVIDER_ERROR', `${label} 接口返回 HTTP ${res.status}`);
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

/**
 * 标准 OAuth2/OIDC 适配器：授权地址、token 地址、用户信息端点、字段映射、
 * scope、token 凭证位置、userinfo 鉴权方式全部配置化，新增渠道只加配置不写代码。
 */
export function createGenericOAuthProvider(options: GenericOAuthOptions): OAuthProvider {
  const { key, clientId, clientSecret, spec } = options;
  const http = options.fetch ?? globalThis.fetch;
  const configured = Boolean(clientId && clientSecret);

  return {
    name: key,
    get enabled(): boolean {
      return configured;
    },
    authorizeUrl(redirectUri: string, state: string): string | null {
      if (!configured) return null;
      const params: Record<string, string> = {
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        state,
        ...(spec.scope ? { scope: spec.scope } : {}),
        ...(spec.extraAuthorizeParams ?? {}),
      };
      if (spec.pkce) {
        const verifier = randomBytes(32).toString('base64url');
        sweepPkce();
        pkceByState.set(pkceKey(key, state), { verifier, expiresAt: Date.now() + PKCE_TTL_MS });
        params['code_challenge'] = createHash('sha256').update(verifier).digest('base64url');
        params['code_challenge_method'] = 'S256';
      }
      return withQuery(spec.authorizeUrl, params);
    },
    async exchange(code: string, redirectUri?: string): Promise<OAuthProfile> {
      if (!configured) throw new AppError('PROVIDER_DISABLED', `${key} 未配置 AppID/AppSecret`);

      const tokenParams: Record<string, string> = {
        grant_type: 'authorization_code',
        code,
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
        ...(spec.tokenAuth === 'basic' ? {} : { client_id: clientId, client_secret: clientSecret }),
        ...(spec.tokenBody ?? {}),
      };
      if (spec.pkce) {
        const verifier = takeVerifier(key, code);
        if (!verifier) {
          throw new AppError('PROVIDER_ERROR', `${key} 缺少 PKCE code_verifier，请重新发起登录`);
        }
        tokenParams['code_verifier'] = verifier;
      }
      const headers: Record<string, string> = {
        accept: 'application/json',
        ...(spec.tokenFormat === 'json'
          ? { 'content-type': 'application/json' }
          : { 'content-type': 'application/x-www-form-urlencoded' }),
        ...(spec.tokenAuth === 'basic'
          ? { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` }
          : {}),
      };
      const token = await readJson(
        await http(spec.tokenUrl, {
          method: 'POST',
          headers,
          body: spec.tokenFormat === 'json' ? JSON.stringify(tokenParams) : form(tokenParams),
        }),
        key,
      );

      const accessToken =
        asString(getPath(token, 'access_token')) || asString(getPath(token, 'accessToken'));
      if (!accessToken) throw new AppError('PROVIDER_ERROR', `${key} 未返回 access_token`);

      const infoUrl =
        spec.userinfoAuth === 'query' ? withQuery(spec.userinfoUrl, { access_token: accessToken }) : spec.userinfoUrl;
      const infoHeaders: Record<string, string> = {
        accept: 'application/json',
        ...Object.fromEntries(
          Object.entries(spec.userinfoHeaders ?? {}).map(([name, value]) => [
            name,
            value.replace(/\{clientId\}/g, clientId),
          ]),
        ),
        ...(spec.userinfoAuth === 'query' ? {} : { authorization: `Bearer ${accessToken}` }),
      };
      if (spec.userinfoMethod === 'POST') infoHeaders['content-type'] = 'application/json';
      const body = await readJson(
        await http(infoUrl, {
          method: spec.userinfoMethod ?? 'GET',
          headers: infoHeaders,
          ...(spec.userinfoMethod === 'POST' ? { body: '{}' } : {}),
        }),
        key,
      );

      const openId = asString(getPath(body, spec.fieldMap.openId));
      if (!openId) throw new AppError('PROVIDER_ERROR', `${key} 用户信息缺少唯一标识 ${spec.fieldMap.openId}`);
      const unionId = spec.fieldMap.unionId ? asString(getPath(body, spec.fieldMap.unionId)) : '';
      const nickname = spec.fieldMap.nickname ? asString(getPath(body, spec.fieldMap.nickname)) : '';
      const rawAvatar = spec.fieldMap.avatarUrl ? asString(getPath(body, spec.fieldMap.avatarUrl)) : '';
      const avatarUrl = rawAvatar
        ? /^https?:\/\//i.test(rawAvatar)
          ? rawAvatar
          : `${spec.avatarPrefix ?? ''}${rawAvatar}`
        : null;
      const phone = spec.fieldMap.phone ? asString(getPath(body, spec.fieldMap.phone)) : '';

      return {
        openId,
        unionId: unionId || null,
        nickname: nickname || `${key} 用户`,
        avatarUrl,
        ...(phone ? { phone, phoneVerified: true } : {}),
      };
    },
  };
}
