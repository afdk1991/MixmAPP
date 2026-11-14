import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { OAUTH_PROVIDER_KEYS, type OAuthProviderKey } from '@mixmapp/contracts';
import { AppError } from '../lib/errors.js';
import { OAUTH_PROVIDER_META, oauthCallbackUrl } from '../adapters/oauth.js';

const isProvider = (value: string): value is OAuthProviderKey =>
  (OAUTH_PROVIDER_KEYS as readonly string[]).includes(value);

/**
 * 只允许 http/https 且命中白名单的回跳地址，避免被当成开放重定向利用。
 * 白名单为空时不放行任何外部地址，统一落回默认页。
 */
function safeRedirect(app: FastifyInstance, raw: unknown, fallback: string): string {
  const candidate = typeof raw === 'string' && raw ? raw : fallback;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
    const whitelist = app.cfg.oauth.redirectWhitelist;
    if (whitelist.includes('*')) return url.toString();
    const allowed = whitelist.some((entry) => {
      if (entry === url.origin) return true;
      try {
        const base = new URL(entry);
        if (base.origin !== url.origin) return false;
        const prefix = base.pathname.replace(/\/+$/, '');
        return prefix === '' || url.pathname.startsWith(prefix);
      } catch {
        return false;
      }
    });
    return allowed ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * 登录页入口清单：只返回已配置的渠道，未启用的渠道完全不下发，
   * 前端因此不会渲染「点了必报错」的按钮。
   */
  app.get('/auth/oauth/providers', async () => ({
    data: {
      providers: OAUTH_PROVIDER_KEYS.filter((key) => app.oauth[key]?.enabled).map((key) => ({
        key,
        label: OAUTH_PROVIDER_META[key].label,
        region: OAUTH_PROVIDER_META[key].region,
        /** false 表示该渠道需要端侧 SDK 拿 code，H5 不提供跳转入口 */
        h5: Boolean(app.oauth[key]?.authorizeUrl),
        requiresCredentials: OAUTH_PROVIDER_META[key].requiresCredentials,
      })),
      onekey: { enabled: app.onekey.enabled },
    },
  }));

  /**
   * 发起授权：未配置渠道直接 503 + PROVIDER_DISABLED，
   * 已配置则 302 跳转到渠道授权页，redirect_uri 固定回本站 callback。
   */
  app.get<{ Params: { provider: string }; Querystring: { redirect?: string } }>(
    '/auth/oauth/:provider/start',
    async (request, reply) => {
      const { provider } = request.params;
      if (!isProvider(provider)) throw new AppError('BAD_REQUEST', `不支持的登录渠道 ${provider}`);
      const adapter = app.oauth[provider];
      if (!adapter?.enabled) throw new AppError('PROVIDER_DISABLED', `${provider} 登录未配置`);
      if (!adapter.authorizeUrl) {
        throw new AppError('PROVIDER_DISABLED', `${provider} 不支持 H5 服务端拉起授权`);
      }

      const redirect = safeRedirect(app, request.query.redirect, app.cfg.publicBaseUrl);
      const callback = oauthCallbackUrl(app.cfg, provider);
      const state = randomBytes(24).toString('hex');
      const now = new Date();
      await app.store.oauthStates.insert({
        state,
        provider,
        redirect,
        redirectUri: callback,
        createdAt: now,
        expiresAt: new Date(now.getTime() + app.cfg.oauth.stateTtlSec * 1000),
        consumedAt: null,
      });

      const location = adapter.authorizeUrl(callback, state);
      if (!location) throw new AppError('PROVIDER_DISABLED', `${provider} 不支持 H5 服务端拉起授权`);
      return reply.redirect(location);
    },
  );

  /**
   * 授权回跳：一次性消费 state 后把 code 原样带回前端页面，由前端走
   * `POST /auth/login/oauth` 完成换令牌与建号（与既有契约一致）。
   */
  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    '/auth/oauth/:provider/callback',
    async (request, reply) => {
      const { provider } = request.params;
      if (!isProvider(provider)) throw new AppError('BAD_REQUEST', `不支持的登录渠道 ${provider}`);
      const state = request.query.state ?? '';
      const record = await app.store.oauthStates.claim(state);
      // 未命中、已消费、已过期、或渠道不匹配都视为失效，避免 state 被串用。
      if (!record || record.provider !== provider) {
        throw new AppError('CODE_INVALID', '授权状态已失效，请重新发起登录');
      }

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
