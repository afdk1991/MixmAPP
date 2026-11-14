import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.js';
import { oauthCallbackUrl } from '../adapters/oauth.js';
import { bindPkceCode } from '../adapters/oauth-generic.js';

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
   * 登录页入口清单：只返回注册表里真正可用（凭证齐 + 开关开）的渠道，
   * 未配置/已停用/平台不具备条件的渠道完全不下发，前端不会渲染点了必报错的按钮。
   */
  app.get('/auth/oauth/providers', async () => {
    const states = new Map(app.providers.states().map((state) => [state.key, state]));
    return {
      data: {
        // 以实际装配的适配器为准：注册表状态负责解释原因，适配器 enabled 决定是否可用。
        // 表外但已注入的渠道（如本地 mock）同样按 enabled 参与，避免联调渠道被白名单误杀。
        providers: Object.entries(app.oauth)
          .filter(([key, adapter]) => {
            if (!adapter?.enabled) return false;
            return states.get(key)?.status !== 'unavailable';
          })
          .map(([key, adapter]) => {
            const state = states.get(key);
            return {
              key,
              label: state?.name ?? key,
              region: state?.category.startsWith('国际') ? ('intl' as const) : ('cn' as const),
              /** false 表示该渠道需要端侧 SDK 拿 code，H5 不提供跳转入口 */
              h5: Boolean(adapter.authorizeUrl),
              requiresCredentials: Boolean(state?.credentials.length),
            };
          }),
        onekey: { enabled: app.onekey.enabled },
      },
    };
  });

  /**
   * 发起授权：未配置渠道直接 503 + PROVIDER_DISABLED，
   * 已配置则 302 跳转到渠道授权页，redirect_uri 固定回本站 callback。
   */
  app.get<{ Params: { provider: string }; Querystring: { redirect?: string } }>(
    '/auth/oauth/:provider/start',
    async (request, reply) => {
      const { provider } = request.params;
      const providerState = app.providers.get(provider);
      const adapter = app.oauth[provider];
      // 注册表内外都认：表内渠道走状态解释，表外渠道（本地 mock/测试注入）只要有适配器即放行。
      if (!providerState && !adapter) throw new AppError('BAD_REQUEST', `不支持的登录渠道 ${provider}`);
      if (!adapter?.enabled) {
        throw new AppError(
          'PROVIDER_DISABLED',
          `${providerState?.name ?? provider} 未启用：${providerState?.reason ?? '缺少配置或已停用'}`,
        );
      }
      if (!adapter.authorizeUrl) {
        throw new AppError('PROVIDER_DISABLED', `${provider} 不支持 H5 服务端拉起授权`);
      }

      const redirect = safeRedirect(app, request.query.redirect, app.cfg.publicBaseUrl);
      const callback = oauthCallbackUrl(app.cfg, provider, providerState?.callbackPath ?? '');
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
      // 表外渠道（本地 mock/测试注入）只要有适配器就允许回跳，渠道是否可用由登录换码阶段判定。
      if (!app.providers.get(provider) && !app.oauth[provider]) {
        throw new AppError('BAD_REQUEST', `不支持的登录渠道 ${provider}`);
      }
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
        // PKCE 渠道：把 state 上的 code_verifier 绑到本次 code，换 token 时会一次取走。
        bindPkceCode(provider, request.query.code, state);
        target.searchParams.set('code', request.query.code);
      }
      target.searchParams.set('oauthProvider', provider);
      return reply.redirect(target.toString());
    },
  );
}
