import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.js';
import type { OAuthProvider, OAuthProviderName } from '../adapters/oauth.js';

const PROVIDERS: readonly OAuthProviderName[] = ['wechat', 'qq', 'github', 'apple'];
/** state 有效期与上限：只用于防 CSRF，进程内存足够，重启即失效。 */
const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_MAX = 2000;

type StateRecord = { provider: OAuthProviderName; redirect: string; at: number };

const isProvider = (value: string): value is OAuthProviderName =>
  (PROVIDERS as readonly string[]).includes(value);

/** 只允许 http/https 的回跳地址，避免被当成开放重定向利用。 */
function safeRedirect(raw: unknown, fallback: string): string {
  const candidate = typeof raw === 'string' && raw ? raw : fallback;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {
    // 落到 fallback
  }
  return fallback;
}

/**
 * 回调基址：优先用配置里的 PUBLIC_BASE_URL；没配（仍是本地默认值）时按当前请求
 * 反推，兼容生产挂在 `https://cloud.mix.top/mixmapp/api/v1` 这类带前缀的部署。
 */
function callbackBase(app: FastifyInstance, request: { url: string; protocol: string; headers: Record<string, unknown> }): string {
  const configured = app.cfg.publicBaseUrl.replace(/\/+$/, '');
  if (!/localhost|127\.0\.0\.1/.test(configured)) return configured;
  const host = (request.headers['host'] as string | undefined) ?? '';
  if (!host) return configured;
  const prefix = request.url.split('/auth/oauth/')[0] || '/api/v1';
  return `${request.protocol}://${host}${prefix}`.replace(/\/+$/, '');
}

export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  const states = new Map<string, StateRecord>();

  const sweep = (now: number): void => {
    for (const [key, value] of states) {
      if (now - value.at > STATE_TTL_MS) states.delete(key);
    }
    while (states.size > STATE_MAX) {
      const oldest = states.keys().next().value;
      if (oldest === undefined) break;
      states.delete(oldest);
    }
  };

  /**
   * 发起授权：未配置渠道直接 503 + PROVIDER_DISABLED（前端据此显示「未启用」），
   * 已配置则 302 跳转到渠道授权页，redirect_uri 固定回本站 callback。
   */
  app.get<{ Params: { provider: string }; Querystring: { redirect?: string } }>(
    '/auth/oauth/:provider/start',
    async (request, reply) => {
      const { provider } = request.params;
      if (!isProvider(provider)) throw new AppError('BAD_REQUEST', `不支持的登录渠道 ${provider}`);
      const adapter = (app.oauth as Record<OAuthProviderName, OAuthProvider>)[provider];
      if (!adapter?.enabled) throw new AppError('PROVIDER_DISABLED', `${provider} 登录未配置`);
      const base = callbackBase(app, request);
      const redirect = safeRedirect(request.query.redirect, app.cfg.publicBaseUrl);
      if (!adapter.authorizeUrl) throw new AppError('PROVIDER_DISABLED', `${provider} 不支持 H5 服务端拉起授权`);

      const now = Date.now();
      sweep(now);
      const state = randomBytes(24).toString('hex');
      states.set(state, { provider, redirect, at: now });

      const callback = `${base}/auth/oauth/${provider}/callback`;
      const location = adapter.authorizeUrl(callback, state);
      if (!location) throw new AppError('PROVIDER_DISABLED', `${provider} 不支持 H5 服务端拉起授权`);
      return reply.redirect(location);
    },
  );

  /**
   * 授权回跳：校验 state 后把 code 原样带回前端页面，由前端走
   * `POST /auth/login/oauth` 完成换令牌与建号（与既有契约一致）。
   */
  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    '/auth/oauth/:provider/callback',
    async (request, reply) => {
      const { provider } = request.params;
      if (!isProvider(provider)) throw new AppError('BAD_REQUEST', `不支持的登录渠道 ${provider}`);
      const state = request.query.state ?? '';
      const record = states.get(state);
      if (!record || record.provider !== provider) {
        throw new AppError('CODE_INVALID', '授权状态已失效，请重新发起登录');
      }
      states.delete(state);

      const target = new URL(record.redirect);
      if (request.query.error) {
        target.searchParams.set('oauthError', request.query.error);
      } else if (request.query.code) {
        target.searchParams.set('code', request.query.code);
      }
      target.searchParams.set('oauthProvider', provider);
      return reply.redirect(target.toString());
    },
  );
}
