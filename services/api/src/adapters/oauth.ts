import { createPublicKey, createSign, createVerify, type KeyObject } from 'node:crypto';
import type { OAuthProviderKey } from '@mixmapp/contracts';
import type { Config, OAuthProviderConfig } from '../config.js';
import { AppError } from '../lib/errors.js';

/** 对外暴露的渠道名与 contracts 保持同一份清单，避免前后端枚举漂移。 */
export type OAuthProviderName = OAuthProviderKey;

export type OAuthProfile = {
  openId: string;
  unionId: string | null;
  nickname: string;
  avatarUrl: string | null;
  /**
   * 渠道返回并已验证的手机号（如微信小程序手机号快速验证）。
   * 只有 phoneVerified 为 true 时登录归并才会按手机号匹配，避免未验证号码被冒用。
   */
  phone?: string | null;
  phoneVerified?: boolean;
};

export type OAuthProvider = {
  readonly name: OAuthProviderName;
  readonly enabled: boolean;
  /** 客户端跳转型渠道（Apple）没有服务端授权页，返回 null 由前端走原生 SDK。 */
  authorizeUrl?(redirectUri: string, state: string): string | null;
  exchange(code: string, redirectUri?: string): Promise<OAuthProfile>;
};

export type OAuthProviderMeta = {
  label: string;
  region: 'cn' | 'intl';
  /** 说明该渠道必须真实凭证才能上线联调 */
  requiresCredentials: boolean;
};

/** 登录页渲染顺序与分组依据；未启用的渠道不会出现在 /auth/oauth/providers 响应里。 */
export const OAUTH_PROVIDER_META: Record<OAuthProviderName, OAuthProviderMeta> = {
  wechat: { label: '微信扫码', region: 'cn', requiresCredentials: true },
  wechat_mp: { label: '微信公众号', region: 'cn', requiresCredentials: true },
  qq: { label: 'QQ', region: 'cn', requiresCredentials: true },
  weibo: { label: '微博', region: 'cn', requiresCredentials: true },
  alipay: { label: '支付宝', region: 'cn', requiresCredentials: true },
  douyin: { label: '抖音', region: 'cn', requiresCredentials: true },
  dingtalk: { label: '钉钉', region: 'cn', requiresCredentials: true },
  wecom: { label: '企业微信', region: 'cn', requiresCredentials: true },
  apple: { label: 'Apple', region: 'intl', requiresCredentials: true },
  google: { label: 'Google', region: 'intl', requiresCredentials: true },
  facebook: { label: 'Facebook', region: 'intl', requiresCredentials: true },
  github: { label: 'GitHub', region: 'intl', requiresCredentials: true },
  gitee: { label: 'Gitee', region: 'intl', requiresCredentials: true },
  mock: { label: '本地 Mock', region: 'cn', requiresCredentials: false },
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type OAuthDeps = {
  fetch?: FetchLike;
  /** 测试替身：跳过 Apple JWKS 网络校验，直接返回 sub */
  verifyAppleIdentityToken?: (idToken: string, clientId: string) => Promise<{ sub: string }>;
};

type Impl = {
  authorize(config: OAuthProviderConfig, redirectUri: string, state: string): string;
  exchange(
    config: OAuthProviderConfig,
    code: string,
    redirectUri: string,
    http: FetchLike,
    deps: OAuthDeps,
  ): Promise<OAuthProfile>;
};

const form = (params: Record<string, string>): string =>
  Object.entries(params)
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

const withQuery = (base: string, params: Record<string, string>): string =>
  `${base}${base.includes('?') ? '&' : '?'}${form(params)}`;

const jsonHeaders = { 'content-type': 'application/json', accept: 'application/json' };

async function readJson(res: Response): Promise<Record<string, any>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return { raw: text };
  }
}

/** 仅暴露状态码，绝不把响应体（可能含 token）写进错误或日志。 */
async function expectOk(res: Response, label: string): Promise<Record<string, any>> {
  const body = await readJson(res);
  if (!res.ok) {
    throw new AppError('PROVIDER_ERROR', `${label} 接口返回 HTTP ${res.status}`);
  }
  return body;
}

const pick = (body: Record<string, any>, ...keys: string[]): string => {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number') return String(value);
  }
  return '';
};

const asProfile = (input: {
  openId: string;
  unionId?: string | null;
  nickname?: string | null;
  avatarUrl?: string | null;
  label: string;
}): OAuthProfile => {
  if (!input.openId) {
    throw new AppError('PROVIDER_ERROR', `${input.label} 未返回可用的用户标识`);
  }
  return {
    openId: input.openId,
    unionId: input.unionId ?? null,
    nickname: input.nickname?.trim() || `${input.label}用户`,
    avatarUrl: input.avatarUrl ?? null,
  };
};

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

const wechatImpl: Impl = {
  authorize: (config, redirectUri, state) =>
    withQuery('https://open.weixin.qq.com/connect/qrconnect', {
      appid: config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: config.scope || 'snsapi_login',
      state,
    }) + '#wechat_redirect',
  exchange: async (config, code, _redirectUri, http) => {
    const token = await expectOk(
      await http(
        withQuery('https://api.weixin.qq.com/sns/oauth2/access_token', {
          appid: config.clientId,
          secret: config.clientSecret,
          code,
          grant_type: 'authorization_code',
        }),
      ),
      '微信',
    );
    const accessToken = pick(token, 'access_token');
    const openId = pick(token, 'openid');
    if (!accessToken || !openId) throw new AppError('PROVIDER_ERROR', '微信未返回 access_token');
    const info = await expectOk(
      await http(
        withQuery('https://api.weixin.qq.com/sns/userinfo', {
          access_token: accessToken,
          openid: openId,
        }),
      ),
      '微信',
    );
    return asProfile({
      label: '微信',
      openId,
      unionId: pick(info, 'unionid') || pick(token, 'unionid') || null,
      nickname: pick(info, 'nickname'),
      avatarUrl: pick(info, 'headimgurl') || null,
    });
  },
};

const wechatMpImpl: Impl = {
  authorize: (config, redirectUri, state) =>
    withQuery('https://open.weixin.qq.com/connect/oauth2/authorize', {
      appid: config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: config.scope || 'snsapi_userinfo',
      state,
    }) + '#wechat_redirect',
  exchange: wechatImpl.exchange,
};

const qqImpl: Impl = {
  authorize: (config, redirectUri, state) =>
    withQuery('https://graph.qq.com/oauth2.0/authorize', {
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: redirectUri,
      state,
      scope: config.scope || 'get_user_info',
    }),
  exchange: async (config, code, redirectUri, http) => {
    const token = await expectOk(
      await http(
        withQuery('https://graph.qq.com/oauth2.0/token', {
          grant_type: 'authorization_code',
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: redirectUri,
          fmt: 'json',
        }),
      ),
      'QQ',
    );
    const accessToken = pick(token, 'access_token');
    if (!accessToken) throw new AppError('PROVIDER_ERROR', 'QQ 未返回 access_token');
    const me = await expectOk(
      await http(
        withQuery('https://graph.qq.com/oauth2.0/me', { access_token: accessToken, fmt: 'json' }),
      ),
      'QQ',
    );
    const openId = pick(me, 'openid');
    const info = await expectOk(
      await http(
        withQuery('https://graph.qq.com/user/get_user_info', {
          access_token: accessToken,
          oauth_consumer_key: config.clientId,
          openid: openId,
        }),
      ),
      'QQ',
    );
    return asProfile({
      label: 'QQ',
      openId,
      nickname: pick(info, 'nickname'),
      avatarUrl: pick(info, 'figureurl_qq_2') || pick(info, 'figureurl_qq_1') || null,
    });
  },
};

const weiboImpl: Impl = {
  authorize: (config, redirectUri, state) =>
    withQuery('https://api.weibo.com/oauth2/authorize', {
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    }),
  exchange: async (config, code, redirectUri, http) => {
    const token = await expectOk(
      await http('https://api.weibo.com/oauth2/access_token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: form({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      }),
      '微博',
    );
    const accessToken = pick(token, 'access_token');
    const uid = pick(token, 'uid');
    if (!accessToken || !uid) throw new AppError('PROVIDER_ERROR', '微博未返回 access_token');
    const info = await expectOk(
      await http(
        withQuery('https://api.weibo.com/2/users/show.json', { access_token: accessToken, uid }),
      ),
      '微博',
    );
    return asProfile({
      label: '微博',
      openId: uid,
      nickname: pick(info, 'screen_name') || pick(info, 'name'),
      avatarUrl: pick(info, 'avatar_large') || pick(info, 'profile_image_url') || null,
    });
  },
};

const douyinImpl: Impl = {
  authorize: (config, redirectUri, state) =>
    withQuery('https://open.douyin.com/platform/oauth/connect', {
      client_key: config.clientId,
      response_type: 'code',
      scope: config.scope || 'user_info',
      redirect_uri: redirectUri,
      state,
    }),
  exchange: async (config, code, _redirectUri, http) => {
    const raw = await expectOk(
      await http('https://open.douyin.com/oauth/access_token/', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          client_key: config.clientId,
          client_secret: config.clientSecret,
          code,
          grant_type: 'authorization_code',
        }),
      }),
      '抖音',
    );
    const token = (raw.data ?? raw) as Record<string, any>;
    const accessToken = pick(token, 'access_token');
    const openId = pick(token, 'open_id');
    if (!accessToken || !openId) throw new AppError('PROVIDER_ERROR', '抖音未返回 access_token');
    const infoRaw = await expectOk(
      await http(
        withQuery('https://open.douyin.com/oauth/userinfo/', {
          access_token: accessToken,
          open_id: openId,
        }),
      ),
      '抖音',
    );
    const info = (infoRaw.data ?? infoRaw) as Record<string, any>;
    return asProfile({
      label: '抖音',
      openId,
      unionId: pick(info, 'union_id') || pick(token, 'union_id') || null,
      nickname: pick(info, 'nickname'),
      avatarUrl: pick(info, 'avatar') || null,
    });
  },
};

const dingtalkImpl: Impl = {
  authorize: (config, redirectUri, state) =>
    withQuery('https://login.dingtalk.com/oauth2/auth', {
      redirect_uri: redirectUri,
      response_type: 'code',
      client_id: config.clientId,
      scope: config.scope || 'openid',
      state,
      prompt: 'consent',
    }),
  exchange: async (config, code, _redirectUri, http) => {
    const token = await expectOk(
      await http('https://api.dingtalk.com/v1.0/oauth2/userAccessToken', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          code,
          grantType: 'authorization_code',
        }),
      }),
      '钉钉',
    );
    const accessToken = pick(token, 'accessToken');
    if (!accessToken) throw new AppError('PROVIDER_ERROR', '钉钉未返回 accessToken');
    const info = await expectOk(
      await http('https://api.dingtalk.com/v1.0/contact/users/me', {
        headers: { 'x-acs-dingtalk-access-token': accessToken },
      }),
      '钉钉',
    );
    return asProfile({
      label: '钉钉',
      openId: pick(info, 'openId') || pick(info, 'unionId'),
      unionId: pick(info, 'unionId') || null,
      nickname: pick(info, 'nick'),
      avatarUrl: pick(info, 'avatarUrl') || null,
    });
  },
};

/** 企业微信 gettoken 是服务端票据，做进程内缓存避免每次登录都打接口。 */
const wecomTokenCache = new Map<string, { token: string; expiresAt: number }>();

const wecomImpl: Impl = {
  authorize: (config, redirectUri, state) =>
    withQuery('https://open.work.weixin.qq.com/wwopen/sso/qrConnect', {
      appid: config.clientId,
      agentid: config.extra.agentId ?? '',
      redirect_uri: redirectUri,
      state,
    }),
  exchange: async (config, code, _redirectUri, http) => {
    const cacheKey = `${config.clientId}:${config.clientSecret}`;
    const cached = wecomTokenCache.get(cacheKey);
    let accessToken = cached && cached.expiresAt > Date.now() ? cached.token : '';
    if (!accessToken) {
      const token = await expectOk(
        await http(
          withQuery('https://qyapi.weixin.qq.com/cgi-bin/gettoken', {
            corpid: config.clientId,
            corpsecret: config.clientSecret,
          }),
        ),
        '企业微信',
      );
      accessToken = pick(token, 'access_token');
      if (!accessToken) throw new AppError('PROVIDER_ERROR', '企业微信未返回 access_token');
      wecomTokenCache.set(cacheKey, {
        token: accessToken,
        expiresAt: Date.now() + Math.max(60, Number(token.expires_in ?? 7200) - 120) * 1000,
      });
    }
    const identity = await expectOk(
      await http(
        withQuery('https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo', {
          access_token: accessToken,
          code,
        }),
      ),
      '企业微信',
    );
    const userId = pick(identity, 'userid');
    const openId = pick(identity, 'openid');
    if (!userId && !openId) throw new AppError('PROVIDER_ERROR', '企业微信未识别用户身份');
    let nickname = '';
    let avatarUrl = '';
    if (userId) {
      const info = await expectOk(
        await http(
          withQuery('https://qyapi.weixin.qq.com/cgi-bin/user/get', {
            access_token: accessToken,
            userid: userId,
          }),
        ),
        '企业微信',
      );
      nickname = pick(info, 'name');
      avatarUrl = pick(info, 'avatar');
    }
    return asProfile({
      label: '企业微信',
      openId: userId || openId,
      unionId: userId && openId ? openId : null,
      nickname,
      avatarUrl: avatarUrl || null,
    });
  },
};

const githubImpl: Impl = {
  authorize: (config, redirectUri, state) =>
    withQuery('https://github.com/login/oauth/authorize', {
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: config.scope || 'read:user',
      state,
    }),
  exchange: async (config, code, redirectUri, http) => {
    const token = await expectOk(
      await http('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      }),
      'GitHub',
    );
    const accessToken = pick(token, 'access_token');
    if (!accessToken) throw new AppError('PROVIDER_ERROR', 'GitHub 未返回 access_token');
    const info = await expectOk(
      await http('https://api.github.com/user', {
        headers: { ...bearer(accessToken), 'user-agent': 'MixmAPP', accept: 'application/vnd.github+json' },
      }),
      'GitHub',
    );
    return asProfile({
      label: 'GitHub',
      openId: pick(info, 'id'),
      nickname: pick(info, 'name') || pick(info, 'login'),
      avatarUrl: pick(info, 'avatar_url') || null,
    });
  },
};

const giteeImpl: Impl = {
  authorize: (config, redirectUri, state) =>
    withQuery('https://gitee.com/oauth/authorize', {
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: config.scope || 'user_info',
      state,
    }),
  exchange: async (config, code, redirectUri, http) => {
    const token = await expectOk(
      await http('https://gitee.com/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: form({
          grant_type: 'authorization_code',
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: redirectUri,
        }),
      }),
      'Gitee',
    );
    const accessToken = pick(token, 'access_token');
    if (!accessToken) throw new AppError('PROVIDER_ERROR', 'Gitee 未返回 access_token');
    const info = await expectOk(
      await http(withQuery('https://gitee.com/api/v5/user', { access_token: accessToken })),
      'Gitee',
    );
    return asProfile({
      label: 'Gitee',
      openId: pick(info, 'id'),
      nickname: pick(info, 'name') || pick(info, 'login'),
      avatarUrl: pick(info, 'avatar_url') || null,
    });
  },
};

const googleImpl: Impl = {
  authorize: (config, redirectUri, state) =>
    withQuery('https://accounts.google.com/o/oauth2/v2/auth', {
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: config.scope || 'openid email profile',
      state,
      access_type: 'online',
      prompt: 'select_account',
    }),
  exchange: async (config, code, redirectUri, http) => {
    const token = await expectOk(
      await http('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: form({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      }),
      'Google',
    );
    const accessToken = pick(token, 'access_token');
    if (!accessToken) throw new AppError('PROVIDER_ERROR', 'Google 未返回 access_token');
    const info = await expectOk(
      await http('https://openidconnect.googleapis.com/v1/userinfo', { headers: bearer(accessToken) }),
      'Google',
    );
    return asProfile({
      label: 'Google',
      openId: pick(info, 'sub'),
      nickname: pick(info, 'name'),
      avatarUrl: pick(info, 'picture') || null,
    });
  },
};

const facebookImpl: Impl = {
  authorize: (config, redirectUri, state) =>
    withQuery('https://www.facebook.com/v19.0/dialog/oauth', {
      client_id: config.clientId,
      redirect_uri: redirectUri,
      state,
      scope: config.scope || 'public_profile',
      response_type: 'code',
    }),
  exchange: async (config, code, redirectUri, http) => {
    const token = await expectOk(
      await http(
        withQuery('https://graph.facebook.com/v19.0/oauth/access_token', {
          client_id: config.clientId,
          redirect_uri: redirectUri,
          client_secret: config.clientSecret,
          code,
        }),
      ),
      'Facebook',
    );
    const accessToken = pick(token, 'access_token');
    if (!accessToken) throw new AppError('PROVIDER_ERROR', 'Facebook 未返回 access_token');
    const info = await expectOk(
      await http(
        withQuery('https://graph.facebook.com/me', {
          fields: 'id,name,picture.type(large)',
          access_token: accessToken,
        }),
      ),
      'Facebook',
    );
    const picture = (info.picture?.data?.url as string | undefined) ?? null;
    return asProfile({
      label: 'Facebook',
      openId: pick(info, 'id'),
      nickname: pick(info, 'name'),
      avatarUrl: picture,
    });
  },
};

// ===== 支付宝：RSA2 签名与回包验签 =====

const alipaySignContent = (params: Record<string, string>): string =>
  Object.keys(params)
    .filter((key) => key !== 'sign' && params[key] !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

const alipayTimestamp = (): string =>
  new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');

/** 从原始 JSON 文本里截取某个节点的原文，支付宝验签针对的是这段原文。 */
function extractJsonNode(raw: string, key: string): string | null {
  const marker = `"${key}"`;
  const at = raw.indexOf(marker);
  if (at < 0) return null;
  const colon = raw.indexOf(':', at + marker.length);
  if (colon < 0) return null;
  let start = colon + 1;
  while (start < raw.length && /\s/.test(raw.charAt(start))) start += 1;
  if (raw[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

function alipaySign(params: Record<string, string>, privateKey: string): string {
  const signer = createSign('RSA-SHA256');
  signer.update(alipaySignContent(params), 'utf8');
  return signer.sign(privateKey, 'base64');
}

function alipayVerify(params: Record<string, string>, sign: string, publicKey: string): boolean {
  const verifier = createVerify('RSA-SHA256');
  verifier.update(alipaySignContent(params), 'utf8');
  return verifier.verify(publicKey, sign, 'base64');
}

async function alipayCall(
  config: OAuthProviderConfig,
  method: string,
  biz: Record<string, string>,
  http: FetchLike,
): Promise<Record<string, string>> {
  const params: Record<string, string> = {
    app_id: config.clientId,
    method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: alipayTimestamp(),
    version: '1.0',
    ...biz,
  };
  params.sign = alipaySign(params, config.clientSecret);
  const res = await http('https://openapi.alipay.com/gateway.do?charset=utf-8', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form(params),
  });
  const text = await res.text();
  if (!res.ok) throw new AppError('PROVIDER_ERROR', `支付宝接口返回 HTTP ${res.status}`);
  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(text) as Record<string, any>;
  } catch {
    throw new AppError('PROVIDER_ERROR', '支付宝返回了无法解析的响应');
  }
  const nodeKey = `${method.replace(/\./g, '_')}_response`;
  const node = parsed[nodeKey] as Record<string, string> | undefined;
  if (!node) throw new AppError('PROVIDER_ERROR', '支付宝响应缺少业务节点');
  const nodeText = extractJsonNode(text, nodeKey) ?? JSON.stringify(node);
  const publicKey = config.extra.alipayPublicKey ?? '';
  if (!publicKey || !alipayVerify(node, parsed.sign ?? '', publicKey)) {
    // 验签失败一律拒绝，消息里不含任何票据内容。
    throw new AppError('PROVIDER_ERROR', '支付宝响应验签失败');
  }
  if (node.code && node.code !== '10000') {
    throw new AppError('PROVIDER_ERROR', `支付宝返回错误码 ${node.code}`);
  }
  // 发电商节点原文仅用于调试比对时不落日志；这里直接丢弃。
  void nodeText;
  return node;
}

const alipayImpl: Impl = {
  authorize: (config, redirectUri, state) =>
    withQuery('https://openauth.alipay.com/oauth2/publicAppAuthorize.htm', {
      app_id: config.clientId,
      scope: config.scope || 'auth_user',
      redirect_uri: redirectUri,
      state,
    }),
  exchange: async (config, code, _redirectUri, http) => {
    const token = await alipayCall(
      config,
      'alipay.system.oauth.token',
      { grant_type: 'authorization_code', code },
      http,
    );
    const accessToken = pick(token, 'access_token');
    const openId = pick(token, 'open_id') || pick(token, 'user_id');
    if (!accessToken || !openId) throw new AppError('PROVIDER_ERROR', '支付宝未返回 access_token');
    const info = await alipayCall(
      config,
      'alipay.user.info.share',
      { auth_token: accessToken },
      http,
    );
    return asProfile({
      label: '支付宝',
      openId,
      nickname: pick(info, 'nick_name'),
      avatarUrl: pick(info, 'avatar') || null,
    });
  },
};

// ===== Apple：identityToken 校验 + 授权码换 token =====

const b64urlDecode = (input: string): Buffer =>
  Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

class AppleJwtVerifier {
  private keys: Array<{ kid: string; key: KeyObject }> = [];
  private fetchedAt = 0;

  constructor(private readonly http: FetchLike) {}

  private async loadKeys(): Promise<void> {
    if (Date.now() - this.fetchedAt < 3600_000 && this.keys.length > 0) return;
    const res = await this.http('https://appleid.apple.com/auth/keys');
    const body = await expectOk(res, 'Apple');
    const keys = Array.isArray(body.keys) ? (body.keys as Array<Record<string, string>>) : [];
    this.keys = keys.flatMap((jwk) =>
      jwk.kid
        ? [{ kid: jwk.kid, key: createPublicKey({ key: jwk as any, format: 'jwk' }) }]
        : [],
    );
    this.fetchedAt = Date.now();
  }

  async verify(idToken: string, clientId: string): Promise<{ sub: string }> {
    const [headerPart, payloadPart, signaturePart] = idToken.split('.');
    if (!headerPart || !payloadPart || !signaturePart) {
      throw new AppError('PROVIDER_ERROR', 'Apple identityToken 格式不正确');
    }
    const header = JSON.parse(b64urlDecode(headerPart).toString('utf8')) as Record<string, any>;
    const payload = JSON.parse(b64urlDecode(payloadPart).toString('utf8')) as Record<string, any>;
    await this.loadKeys();
    const key = this.keys.find((item) => item.kid === header.kid);
    if (!key) throw new AppError('PROVIDER_ERROR', 'Apple identityToken 签名密钥不匹配');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${headerPart}.${payloadPart}`);
    if (!verifier.verify(key.key, b64urlDecode(signaturePart))) {
      throw new AppError('PROVIDER_ERROR', 'Apple identityToken 验签失败');
    }
    if (payload.iss !== 'https://appleid.apple.com') {
      throw new AppError('PROVIDER_ERROR', 'Apple identityToken 签发方不正确');
    }
    if (clientId && payload.aud !== clientId) {
      throw new AppError('PROVIDER_ERROR', 'Apple identityToken 受众不匹配');
    }
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
      throw new AppError('PROVIDER_ERROR', 'Apple identityToken 已过期');
    }
    if (!payload.sub) throw new AppError('PROVIDER_ERROR', 'Apple identityToken 缺少 sub');
    return { sub: String(payload.sub) };
  }
}

/** Apple 网页授权码换 token 需要 ES256 签名的 client_secret。 */
function appleClientSecret(config: OAuthProviderConfig): string {
  if (config.clientSecret) return config.clientSecret;
  const teamId = config.extra.teamId ?? '';
  const keyId = config.extra.keyId ?? '';
  const privateKey = config.extra.privateKey ?? '';
  if (!teamId || !keyId || !privateKey) {
    throw new AppError('PROVIDER_DISABLED', 'Apple 需要配置 client_secret 或 teamId/keyId/私钥');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: teamId,
      iat: now,
      exp: now + 300,
      aud: 'https://appleid.apple.com',
      sub: config.clientId,
    }),
  ).toString('base64url');
  const signer = createSign('sha256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }, 'base64url');
  return `${header}.${payload}.${signature}`;
}

const appleImpl: Impl = {
  // Apple 网页登录没有服务端可拼接的 authorize 地址时由前端走 Apple JS；
  // 此处返回 null 让路由给出明确提示，而不是拼一个必然报错的按钮。
  authorize: () => '',
  exchange: async (config, code, redirectUri, http, deps) => {
    const verify = async (token: string) =>
      deps.verifyAppleIdentityToken
        ? deps.verifyAppleIdentityToken(token, config.clientId)
        : new AppleJwtVerifier(http).verify(token, config.clientId);

    // 原生 SDK 直接回传 identityToken（JWT），无需再换 token。
    if (code.split('.').length === 3) {
      const payload = await verify(code);
      return asProfile({ label: 'Apple', openId: payload.sub, nickname: 'Apple用户' });
    }
    const token = await expectOk(
      await http('https://appleid.apple.com/auth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: form({
          client_id: config.clientId,
          client_secret: appleClientSecret(config),
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      }),
      'Apple',
    );
    const idToken = pick(token, 'id_token');
    if (!idToken) throw new AppError('PROVIDER_ERROR', 'Apple 未返回 id_token');
    const payload = await verify(idToken);
    return asProfile({ label: 'Apple', openId: payload.sub, nickname: 'Apple用户' });
  },
};

/** 本地 mock：不访问外网，直接把 code 当作稳定用户标识，用于无凭证联调。 */
const mockImpl: Impl = {
  authorize: (config, redirectUri, state) =>
    withQuery(redirectUri, { code: 'mock-user', state }),
  exchange: async (_config, code) =>
    asProfile({
      label: '本地 Mock',
      openId: code === 'mock-user' ? 'mock-user' : `mock-${code}`,
      nickname: '本地 Mock 用户',
      avatarUrl: null,
    }),
};

const IMPLS: Record<OAuthProviderName, Impl> = {
  wechat: wechatImpl,
  wechat_mp: wechatMpImpl,
  qq: qqImpl,
  weibo: weiboImpl,
  alipay: alipayImpl,
  douyin: douyinImpl,
  dingtalk: dingtalkImpl,
  wecom: wecomImpl,
  apple: appleImpl,
  google: googleImpl,
  facebook: facebookImpl,
  github: githubImpl,
  gitee: giteeImpl,
  mock: mockImpl,
};

class ConfiguredOAuthProvider implements OAuthProvider {
  private readonly impl: Impl;

  constructor(
    readonly name: OAuthProviderName,
    private readonly config: OAuthProviderConfig,
    private readonly deps: OAuthDeps,
  ) {
    this.impl = IMPLS[name];
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  authorizeUrl(redirectUri: string, state: string): string | null {
    if (!this.config.enabled) return null;
    const url = this.impl.authorize(this.config, redirectUri, state);
    return url || null;
  }

  async exchange(code: string, redirectUri?: string): Promise<OAuthProfile> {
    const label = OAUTH_PROVIDER_META[this.name].label;
    if (!this.config.enabled) throw new AppError('PROVIDER_DISABLED', `${label} 未配置`);
    try {
      return await this.impl.exchange(
        this.config,
        code,
        redirectUri ?? this.config.redirectUri,
        this.deps.fetch ?? globalThis.fetch,
        this.deps,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      // 原始错误可能带请求参数，统一转成不含票据的稳定错误码。
      throw new AppError('PROVIDER_ERROR', `${label} 登录失败，请稍后重试`);
    }
  }
}

/** 回调地址：优先渠道自定义，否则按 PUBLIC_BASE_URL 拼装；发起与换 token 必须完全一致。 */
export function oauthCallbackUrl(config: Config, provider: OAuthProviderName): string {
  const configured = config.oauth.providers[provider]?.redirectUri?.trim();
  if (configured) return configured;
  const base = config.publicBaseUrl.replace(/\/+$/, '');
  return `${base}/api/v1/auth/oauth/${provider}/callback`;
}

export function createOAuthProviders(
  config: Config,
  deps: OAuthDeps = {},
): Record<OAuthProviderName, OAuthProvider> {
  const providers = {} as Record<OAuthProviderName, OAuthProvider>;
  for (const key of Object.keys(OAUTH_PROVIDER_META) as OAuthProviderName[]) {
    providers[key] = new ConfiguredOAuthProvider(key, config.oauth.providers[key], deps);
  }
  return providers;
}
