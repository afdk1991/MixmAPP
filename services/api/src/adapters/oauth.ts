import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';

export type OAuthProfile = {
  openId: string;
  unionId: string | null;
  nickname: string;
  avatarUrl: string | null;
};

export type OAuthProviderName = 'wechat' | 'qq' | 'github' | 'apple';

export type OAuthProvider = {
  readonly name: OAuthProviderName;
  readonly enabled: boolean;
  exchange(code: string): Promise<OAuthProfile>;
  /** 生成授权页地址；该渠道在 H5 端不支持服务端拉起时返回 null（如 Apple）。 */
  authorizeUrl?(redirectUri: string, state: string): string | null;
};

const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) throw new AppError('PROVIDER_ERROR', `${res.status} ${res.statusText}`);
  return (await res.json()) as T;
};

export class GithubOAuth implements OAuthProvider {
  readonly name = 'github' as const;

  constructor(private readonly config: Config['oauth']['github']) {}

  get enabled(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  authorizeUrl(redirectUri: string, state: string): string {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'read:user');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchange(code: string): Promise<OAuthProfile> {
    if (!this.enabled) throw new AppError('PROVIDER_DISABLED', 'GitHub 登录未配置');
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
      }),
    });
    const tokenBody = await json<{ access_token?: string; error_description?: string }>(tokenRes);
    if (!tokenBody.access_token) {
      throw new AppError('PROVIDER_ERROR', tokenBody.error_description ?? 'GitHub 授权失败');
    }
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'MixmAPP',
      },
    });
    const profile = await json<{
      id: number;
      login: string;
      name: string | null;
      avatar_url: string | null;
    }>(userRes);
    return {
      openId: String(profile.id),
      unionId: profile.login,
      nickname: profile.name ?? profile.login,
      avatarUrl: profile.avatar_url,
    };
  }
}

export class WechatOAuth implements OAuthProvider {
  readonly name = 'wechat' as const;

  constructor(private readonly config: Config['oauth']['wechat']) {}

  get enabled(): boolean {
    return Boolean(this.config.appId && this.config.appSecret);
  }

  authorizeUrl(redirectUri: string, state: string): string {
    const url = new URL('https://open.weixin.qq.com/connect/qrconnect');
    url.searchParams.set('appid', this.config.appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'snsapi_login');
    url.searchParams.set('state', state);
    return `${url.toString()}#wechat_redirect`;
  }

  async exchange(code: string): Promise<OAuthProfile> {
    if (!this.enabled) throw new AppError('PROVIDER_DISABLED', '微信登录未配置');
    const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
    tokenUrl.searchParams.set('appid', this.config.appId);
    tokenUrl.searchParams.set('secret', this.config.appSecret);
    tokenUrl.searchParams.set('code', code);
    tokenUrl.searchParams.set('grant_type', 'authorization_code');
    const tokenBody = await json<{
      access_token?: string;
      openid?: string;
      unionid?: string;
      errmsg?: string;
    }>(await fetch(tokenUrl));
    if (!tokenBody.access_token || !tokenBody.openid) {
      throw new AppError('PROVIDER_ERROR', tokenBody.errmsg ?? '微信授权失败');
    }
    const infoUrl = new URL('https://api.weixin.qq.com/sns/userinfo');
    infoUrl.searchParams.set('access_token', tokenBody.access_token);
    infoUrl.searchParams.set('openid', tokenBody.openid);
    const info = await json<{ nickname?: string; headimgurl?: string; errmsg?: string }>(
      await fetch(infoUrl),
    );
    return {
      openId: tokenBody.openid,
      unionId: tokenBody.unionid ?? null,
      nickname: info.nickname ?? '微信用户',
      avatarUrl: info.headimgurl ?? null,
    };
  }
}

export class QqOAuth implements OAuthProvider {
  readonly name = 'qq' as const;

  constructor(private readonly config: Config['oauth']['qq']) {}

  get enabled(): boolean {
    return Boolean(this.config.appId && this.config.appKey);
  }

  authorizeUrl(redirectUri: string, state: string): string {
    const url = new URL('https://graph.qq.com/oauth2.0/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchange(code: string): Promise<OAuthProfile> {
    if (!this.enabled) throw new AppError('PROVIDER_DISABLED', 'QQ 登录未配置');
    const tokenUrl = new URL('https://graph.qq.com/oauth2.0/token');
    tokenUrl.searchParams.set('grant_type', 'authorization_code');
    tokenUrl.searchParams.set('client_id', this.config.appId);
    tokenUrl.searchParams.set('client_secret', this.config.appKey);
    tokenUrl.searchParams.set('code', code);
    tokenUrl.searchParams.set('fmt', 'json');
    const tokenBody = await json<{ access_token?: string; error_description?: string }>(
      await fetch(tokenUrl),
    );
    if (!tokenBody.access_token) {
      throw new AppError('PROVIDER_ERROR', tokenBody.error_description ?? 'QQ 授权失败');
    }
    const meUrl = new URL('https://graph.qq.com/oauth2.0/me');
    meUrl.searchParams.set('access_token', tokenBody.access_token);
    meUrl.searchParams.set('fmt', 'json');
    const me = await json<{ openid?: string; error_description?: string }>(await fetch(meUrl));
    if (!me.openid) throw new AppError('PROVIDER_ERROR', me.error_description ?? 'QQ 获取 openid 失败');

    const infoUrl = new URL('https://graph.qq.com/user/get_user_info');
    infoUrl.searchParams.set('access_token', tokenBody.access_token);
    infoUrl.searchParams.set('oauth_consumer_key', this.config.appId);
    infoUrl.searchParams.set('openid', me.openid);
    infoUrl.searchParams.set('fmt', 'json');
    const info = await json<{ nickname?: string; figureurl_qq_1?: string }>(await fetch(infoUrl));
    return {
      openId: me.openid,
      unionId: null,
      nickname: info.nickname ?? 'QQ 用户',
      avatarUrl: info.figureurl_qq_1 ?? null,
    };
  }
}

const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

/**
 * Apple 登录：端侧（Sign in with Apple）拿到的是 identityToken（JWT），
 * 服务端用 Apple 公钥验签并校验 issuer/audience，再取 sub 作为用户标识。
 * `code` 参数在这里承载 identityToken。
 */
export class AppleOAuth implements OAuthProvider {
  readonly name = 'apple' as const;

  constructor(private readonly config: Config['oauth']['apple']) {}

  get enabled(): boolean {
    return Boolean(this.config.clientId);
  }

  /** Apple 在 H5 端只能由 Apple JS 在端侧拉起，服务端不提供 authorize 地址。 */
  authorizeUrl(): string | null {
    return null;
  }

  async exchange(identityToken: string): Promise<OAuthProfile> {
    if (!this.enabled) throw new AppError('PROVIDER_DISABLED', 'Apple 登录未配置');
    try {
      const { payload } = await jwtVerify(identityToken, appleJwks, {
        issuer: 'https://appleid.apple.com',
        audience: this.config.clientId,
      });
      const openId = typeof payload.sub === 'string' ? payload.sub : '';
      if (!openId) throw new AppError('PROVIDER_ERROR', 'Apple 身份令牌缺少用户标识');
      return { openId, unionId: null, nickname: 'Apple 用户', avatarUrl: null };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('PROVIDER_ERROR', 'Apple 身份令牌校验失败');
    }
  }
}

export function createOAuthProviders(config: Config): Record<OAuthProviderName, OAuthProvider> {
  return {
    wechat: new WechatOAuth(config.oauth.wechat),
    qq: new QqOAuth(config.oauth.qq),
    github: new GithubOAuth(config.oauth.github),
    apple: new AppleOAuth(config.oauth.apple),
  };
}
