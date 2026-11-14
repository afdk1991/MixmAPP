import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryStore } from '../src/db/memory.js';
import { testConfig } from './helpers.js';
import {
  createOAuthProviders,
  oauthCallbackUrl,
  type OAuthProviderName,
} from '../src/adapters/oauth.js';
import { OAUTH_PROVIDER_KEYS } from '@mixmapp/contracts';
import type { Config } from '../src/config.js';

type Json = Record<string, unknown>;

const json = (body: Json, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** 统一替换 fetch：按 host + path 命中一条假响应，绝不访问外网。 */
function fakeFetch(routes: Record<string, Json | string>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const key = `${url.host}${url.pathname}`;
    const hit = routes[key];
    if (hit === undefined) {
      throw new Error(`测试未铺排的请求: ${key}`);
    }
    if (typeof hit === 'string') return new Response(hit, { status: 200 });
    return json(hit);
  }) as unknown as typeof fetch;
}

/** 生成一份「所有渠道均已配置」的测试配置。 */
function configWithAllProviders(extra: Partial<Record<OAuthProviderName, Json>> = {}): Config {
  const providers = Object.fromEntries(
    OAUTH_PROVIDER_KEYS.map((key) => [
      key,
      {
        enabled: true,
        clientId: `id-${key}`,
        clientSecret: `secret-${key}`,
        redirectUri: '',
        scope: '',
        extra: {},
      },
    ]),
  ) as Config['oauth']['providers'];
  for (const [key, patch] of Object.entries(extra)) {
    providers[key as OAuthProviderName] = {
      ...providers[key as OAuthProviderName],
      ...patch,
    } as Config['oauth']['providers'][OAuthProviderName];
  }
  return { ...testConfig, oauth: { ...testConfig.oauth, providers } };
}

const profileOf = async (
  key: OAuthProviderName,
  routes: Record<string, Json | string>,
  code = 'test-code',
) => {
  const config = configWithAllProviders();
  const provider = createOAuthProviders(config, {
    fetch: fakeFetch(routes),
    verifyAppleIdentityToken: async () => ({ sub: 'apple-sub' }),
  })[key];
  return provider.exchange(code, `https://api.example.com/cb/${key}`);
};

describe('OAuth 渠道适配器（本地 fetch 替身）', () => {
  it('微信网页扫码 / 公众号：换 token 后拉取用户资料', async () => {
    const routes = {
      'api.weixin.qq.com/sns/oauth2/access_token': {
        access_token: 'wx-token',
        openid: 'wx-open',
        unionid: 'wx-union',
      },
      'api.weixin.qq.com/sns/userinfo': {
        nickname: '微信用户',
        headimgurl: 'https://img.example.com/wx.png',
        unionid: 'wx-union',
      },
    };
    for (const key of ['wechat', 'wechat_mp'] as const) {
      const profile = await profileOf(key, routes);
      expect(profile).toMatchObject({
        openId: 'wx-open',
        unionId: 'wx-union',
        nickname: '微信用户',
        avatarUrl: 'https://img.example.com/wx.png',
      });
    }
  });

  it('QQ：token → me → get_user_info', async () => {
    const profile = await profileOf('qq', {
      'graph.qq.com/oauth2.0/token': { access_token: 'qq-token' },
      'graph.qq.com/oauth2.0/me': { openid: 'qq-open' },
      'graph.qq.com/user/get_user_info': {
        nickname: 'QQ用户',
        figureurl_qq_2: 'https://img.example.com/qq.png',
      },
    });
    expect(profile.openId).toBe('qq-open');
    expect(profile.nickname).toBe('QQ用户');
  });

  it('微博：POST 换 token 后拉取 show.json', async () => {
    const profile = await profileOf('weibo', {
      'api.weibo.com/oauth2/access_token': { access_token: 'wb-token', uid: 'wb-1' },
      'api.weibo.com/2/users/show.json': { screen_name: '微博用户', avatar_large: 'https://img.example.com/wb.png' },
    });
    expect(profile.openId).toBe('wb-1');
    expect(profile.nickname).toBe('微博用户');
  });

  it('抖音：oauth 换 token 与 userinfo 的 data 包裹', async () => {
    const profile = await profileOf('douyin', {
      'open.douyin.com/oauth/access_token/': {
        data: { access_token: 'dy-token', open_id: 'dy-open', union_id: 'dy-union' },
      },
      'open.douyin.com/oauth/userinfo/': {
        data: { nickname: '抖音用户', avatar: 'https://img.example.com/dy.png', union_id: 'dy-union' },
      },
    });
    expect(profile).toMatchObject({ openId: 'dy-open', unionId: 'dy-union', nickname: '抖音用户' });
  });

  it('钉钉：userAccessToken + contact/users/me', async () => {
    const profile = await profileOf('dingtalk', {
      'api.dingtalk.com/v1.0/oauth2/userAccessToken': { accessToken: 'dt-token' },
      'api.dingtalk.com/v1.0/contact/users/me': {
        openId: 'dt-open',
        unionId: 'dt-union',
        nick: '钉钉用户',
        avatarUrl: 'https://img.example.com/dt.png',
      },
    });
    expect(profile).toMatchObject({ openId: 'dt-open', unionId: 'dt-union', nickname: '钉钉用户' });
  });

  it('企业微信：gettoken 票据 + getuserinfo + user/get', async () => {
    const profile = await profileOf('wecom', {
      'qyapi.weixin.qq.com/cgi-bin/gettoken': { access_token: 'wc-token', expires_in: 7200 },
      'qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo': { userid: 'wc-user', openid: 'wc-open' },
      'qyapi.weixin.qq.com/cgi-bin/user/get': { name: '企微用户', avatar: 'https://img.example.com/wc.png' },
    });
    expect(profile).toMatchObject({ openId: 'wc-user', unionId: 'wc-open', nickname: '企微用户' });
  });

  it('GitHub / Gitee：OAuth App 授权码换 token', async () => {
    const github = await profileOf('github', {
      'github.com/login/oauth/access_token': { access_token: 'gh-token' },
      'api.github.com/user': { id: 1001, login: 'octocat', name: 'Octo', avatar_url: 'https://img.example.com/gh.png' },
    });
    expect(github.openId).toBe('1001');
    expect(github.nickname).toBe('Octo');

    const gitee = await profileOf('gitee', {
      'gitee.com/oauth/token': { access_token: 'gitee-token' },
      'gitee.com/api/v5/user': { id: 2002, name: '码云用户', avatar_url: 'https://img.example.com/gitee.png' },
    });
    expect(gitee.openId).toBe('2002');
    expect(gitee.nickname).toBe('码云用户');
  });

  it('Google / Facebook：OIDC 与 Graph 用户资料', async () => {
    const google = await profileOf('google', {
      'oauth2.googleapis.com/token': { access_token: 'g-token' },
      'openidconnect.googleapis.com/v1/userinfo': {
        sub: 'g-sub',
        name: 'Google 用户',
        picture: 'https://img.example.com/g.png',
      },
    });
    expect(google).toMatchObject({ openId: 'g-sub', nickname: 'Google 用户' });

    const facebook = await profileOf('facebook', {
      'graph.facebook.com/v19.0/oauth/access_token': { access_token: 'f-token' },
      'graph.facebook.com/me': {
        id: 'f-1',
        name: 'Facebook 用户',
        picture: { data: { url: 'https://img.example.com/f.png' } },
      },
    });
    expect(facebook).toMatchObject({ openId: 'f-1', nickname: 'Facebook 用户' });
  });

  it('Apple：原生 identityToken 直接验签，不访问 token 端点', async () => {
    const profile = await profileOf('apple', {}, 'header.payload.signature');
    expect(profile.openId).toBe('apple-sub');
  });

  it('支付宝：RSA2 回包验签通过后取用户信息', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const signNode = (node: Json): string => {
      const content = Object.keys(node)
        .filter((key) => node[key] !== '')
        .sort()
        .map((key) => `${key}=${String(node[key])}`)
        .join('&');
      const signer = createSign('RSA-SHA256');
      signer.update(content, 'utf8');
      return signer.sign(privateKey, 'base64');
    };
    const routes = {
      'openapi.alipay.com/gateway.do': '', // 占位，下面按调用顺序覆盖
    };
    void routes;
    const config = configWithAllProviders({
      alipay: { clientSecret: privateKey, extra: { alipayPublicKey: publicKey } },
    });
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      calls.push(url.host + url.pathname);
      const node =
        calls.length === 1
          ? { code: '10000', access_token: 'ali-token', open_id: 'ali-open' }
          : { code: '10000', nick_name: '支付宝用户', avatar: 'https://img.example.com/ali.png' };
      return json({ [`alipay_${calls.length === 1 ? 'system_oauth_token' : 'user_info_share'}_response`]: node, sign: signNode(node), sign_type: 'RSA2' });
    }) as unknown as typeof fetch;
    const provider = createOAuthProviders(config, { fetch: fetchImpl }).alipay;
    const profile = await provider.exchange('ali-code', 'https://api.example.com/cb/alipay');
    expect(profile).toMatchObject({ openId: 'ali-open', nickname: '支付宝用户' });
    expect(calls.every((item) => item === 'openapi.alipay.com/gateway.do')).toBe(true);
  });

  it('未配置渠道直接拒绝，不发任何请求', async () => {
    const config = configWithAllProviders({ github: { enabled: false } });
    const fetchSpy = vi.fn();
    const provider = createOAuthProviders(config, { fetch: fetchSpy as unknown as typeof fetch }).github;
    await expect(provider.exchange('code')).rejects.toMatchObject({ code: 'PROVIDER_DISABLED' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('登录页渠道清单与 state 防重放', () => {
  it('只下发已启用的渠道', async () => {
    const config = configWithAllProviders();
    const app = await buildApp({ config, store: new MemoryStore(), logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/providers' });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    const keys = body.providers.map((item: { key: string }) => item.key);
    expect(keys).toContain('wechat');
    expect(keys).toContain('mock');
    expect(keys).not.toContain('twitter');
  });

  it('mock 渠道端到端：start → callback → 换登录态 → 重复登录复用一个账号', async () => {
    const config = configWithAllProviders();
    const app = await buildApp({ config, store: new MemoryStore(), logger: false });

    const start = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/oauth/mock/start?redirect=https%3A%2F%2Fapp.example.com%2Fafter%3Fx%3D1',
    });
    expect(start.statusCode).toBe(302);
    const authorize = new URL(start.headers.location as string);
    expect(authorize.origin + authorize.pathname).toBe(oauthCallbackUrl(config, 'mock'));
    const state = authorize.searchParams.get('state') ?? '';
    expect(state).toMatch(/^[0-9a-f]{48}$/);

    const callback = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/oauth/mock/callback?code=mock-user&state=${state}`,
    });
    expect(callback.statusCode).toBe(302);
    const back = new URL(callback.headers.location as string);
    expect(back.origin + back.pathname).toBe('https://app.example.com/after');
    expect(back.searchParams.get('oauthProvider')).toBe('mock');
    expect(back.searchParams.get('code')).toBe('mock-user');
    expect(back.searchParams.get('x')).toBe('1');

    // 同一个 state 第二次回调必须失效（防重放）。
    const replay = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/oauth/mock/callback?code=mock-user&state=${state}`,
    });
    expect(replay.statusCode).toBe(422);
    expect(replay.json().error.code).toBe('CODE_INVALID');

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/oauth',
      payload: { provider: 'mock', code: 'mock-user' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.isNewUser).toBe(true);
    const userId = first.json().data.user.id;

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/oauth',
      payload: { provider: 'mock', code: 'mock-user' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.isNewUser).toBe(false);
    expect(second.json().data.user.id).toBe(userId);
  });

  it('回调地址不在白名单时落回默认页', async () => {
    const base = configWithAllProviders();
    const config: Config = {
      ...base,
      oauth: { ...base.oauth, redirectWhitelist: ['https://app.example.com'] },
    };
    const app = await buildApp({ config, store: new MemoryStore(), logger: false });
    const start = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/oauth/mock/start?redirect=https%3A%2F%2Fevil.example.net%2Fsteal',
    });
    const state = new URL(start.headers.location as string).searchParams.get('state') ?? '';
    const callback = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/oauth/mock/callback?code=mock-user&state=${state}`,
    });
    const back = callback.headers.location as string;
    expect(back.startsWith(config.publicBaseUrl)).toBe(true);
    expect(back).not.toContain('evil.example.net');
  });

  it('过期 state 不可用', async () => {
    const config = configWithAllProviders();
    const store = new MemoryStore();
    const app = await buildApp({ config, store, logger: false });
    await store.oauthStates.insert({
      state: 'expired-state',
      provider: 'mock',
      redirect: 'https://app.example.com/after',
      redirectUri: oauthCallbackUrl(config, 'mock'),
      createdAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/oauth/mock/callback?code=mock-user&state=expired-state',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('CODE_INVALID');
  });
});

describe('绑定与解绑', () => {
  it('解绑唯一登录方式被拒绝，绑定其他渠道后可解绑', async () => {
    const config = configWithAllProviders();
    const store = new MemoryStore();
    const app = await buildApp({ config, store, logger: false });

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/oauth',
      payload: { provider: 'mock', code: 'bind-user' },
    });
    expect(login.statusCode).toBe(200);
    const token = login.json().data.tokens.accessToken as string;
    const userId = login.json().data.user.id as string;
    expect(login.json().data.user.bindings).toEqual(['mock']);

    const blocked = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me/bind/oauth/mock',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(blocked.statusCode).toBe(409);

    await store.bindings.insert({
      id: 'binding-qq',
      userId,
      provider: 'qq',
      openId: 'qq-second',
      unionId: null,
      nickname: null,
      avatarUrl: null,
      createdAt: new Date(),
    });

    const ok = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me/bind/oauth/mock',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.bindings).toEqual(['qq']);
  });
});
