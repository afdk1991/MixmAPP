import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OAUTH_PROVIDER_KEYS, type OAuthProviderKey } from '@mixmapp/contracts';
import { createOAuthProviders } from '../src/adapters/oauth.js';
import { bindPkceCode, createGenericOAuthProvider } from '../src/adapters/oauth-generic.js';
import type { Config, OAuthProviderConfig } from '../src/config.js';
import { ProviderRegistry } from '../src/modules/provider-registry.js';
import { FakeOAuth, makeApp } from './helpers.js';

let app: FastifyInstance | undefined;
const tempDirs: string[] = [];

afterEach(async () => {
  await app?.close();
  app = undefined;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const emptyProvider = (): OAuthProviderConfig => ({
  enabled: false,
  clientId: '',
  clientSecret: '',
  redirectUri: '',
  scope: '',
  extra: {},
});

/** 只组装 oauth.providers，其它字段对适配器无用。 */
function makeConfig(creds: Partial<Record<OAuthProviderKey, [string, string]>>): Config {
  const providers = {} as Record<OAuthProviderKey, OAuthProviderConfig>;
  for (const key of OAUTH_PROVIDER_KEYS) {
    const [clientId, clientSecret] = creds[key] ?? ['', ''];
    providers[key] = {
      ...emptyProvider(),
      clientId,
      clientSecret,
      enabled: Boolean(clientId && clientSecret),
    };
  }
  return { oauth: { providers } } as unknown as Config;
}

type Call = { url: string; init?: RequestInit };

function fakeFetch(handler: (url: string) => unknown): { fetch: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    return new Response(JSON.stringify(handler(url)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fn as unknown as typeof globalThis.fetch, calls };
}

const bodyOf = (call: Call | undefined): string => String(call?.init?.body ?? '');
const headerOf = (call: Call | undefined, name: string): string => {
  const headers = (call?.init?.headers ?? {}) as Record<string, string>;
  return headers[name] ?? '';
};

describe('微信小程序：jscode2session', () => {
  it('正常换 token：返回 openid/unionid，且请求带 appid/secret/js_code', async () => {
    const http = fakeFetch(() => ({ openid: 'mini-open-1', unionid: 'mini-union-1', session_key: 'sk' }));
    const providers = createOAuthProviders(makeConfig({ wechat_mini: ['mini-id', 'mini-secret'] }), {
      fetch: http.fetch,
    });

    const profile = await providers.wechat_mini.exchange('code-mini-1');

    expect(profile.openId).toBe('mini-open-1');
    expect(profile.unionId).toBe('mini-union-1');
    // session_key 不应出现在对外 profile 里（只给端侧解密用）。
    expect(Object.values(profile)).not.toContain('sk');
    expect(http.calls[0]?.url).toContain('jscode2session');
    expect(http.calls[0]?.url).toContain('appid=mini-id');
    expect(http.calls[0]?.url).toContain('js_code=code-mini-1');
    expect(http.calls[0]?.url).toContain('secret=mini-secret');
  });

  it('失败分支：微信 HTTP 200 但带 errcode 时必须报错，不能当成登录成功', async () => {
    const http = fakeFetch(() => ({ errcode: 40029, errmsg: 'invalid code' }));
    const providers = createOAuthProviders(makeConfig({ wechat_mini: ['mini-id', 'mini-secret'] }), {
      fetch: http.fetch,
    });

    await expect(providers.wechat_mini.exchange('bad-code')).rejects.toThrow(/40029/);
  });
});

describe('微信移动应用：端侧 code 换 token', () => {
  it('正常换 token：换 access_token 后拉 userinfo，unionid 可回落自 token 响应', async () => {
    const http = fakeFetch((url) =>
      url.includes('/sns/oauth2/access_token')
        ? { access_token: 'app-at', openid: 'app-open-1', unionid: 'app-union-1' }
        : { openid: 'app-open-1', nickname: '移动端用户', headimgurl: 'https://cdn/avatar.png' },
    );
    const providers = createOAuthProviders(makeConfig({ wechat_app: ['app-id', 'app-secret'] }), {
      fetch: http.fetch,
    });

    const profile = await providers.wechat_app.exchange('code-app-1');

    expect(profile.openId).toBe('app-open-1');
    expect(profile.unionId).toBe('app-union-1');
    expect(profile.nickname).toBe('移动端用户');
    expect(http.calls.map((call) => call.url)).toEqual([
      expect.stringContaining('sns/oauth2/access_token'),
      expect.stringContaining('sns/userinfo'),
    ]);
    expect(http.calls[0]?.url).toContain('appid=app-id');
  });

  it('失败分支：缺少 access_token 时抛错', async () => {
    const http = fakeFetch(() => ({ openid: 'app-open-1' }));
    const providers = createOAuthProviders(makeConfig({ wechat_app: ['app-id', 'app-secret'] }), {
      fetch: http.fetch,
    });

    await expect(providers.wechat_app.exchange('code')).rejects.toThrow(/未返回 access_token/);
  });
});

describe('华为账号：AGC token + userinfo 校验', () => {
  it('正常换 token：unionid 与已验证手机号都进入 profile', async () => {
    const http = fakeFetch((url) =>
      url.includes('/oauth2/v3/token')
        ? { access_token: 'hw-at' }
        : {
            openid: 'hw-open-1',
            unionid: 'hw-union-1',
            nickname: '华为用户',
            picture: 'https://cdn/hw.png',
            phone_number: '13800001234',
            phone_number_verified: true,
          },
    );
    const providers = createOAuthProviders(makeConfig({ huawei: ['hw-id', 'hw-secret'] }), {
      fetch: http.fetch,
    });

    const profile = await providers.huawei.exchange('code-hw-1', 'https://app/cb');

    expect(profile.openId).toBe('hw-open-1');
    expect(profile.unionId).toBe('hw-union-1');
    expect(profile.phone).toBe('13800001234');
    expect(profile.phoneVerified).toBe(true);
    expect(headerOf(http.calls[1], 'authorization')).toBe('Bearer hw-at');
    expect(bodyOf(http.calls[0])).toContain('client_secret=hw-secret');
  });

  it('失败分支：token 接口没有 access_token 时抛错', async () => {
    const http = fakeFetch(() => ({ error: 'invalid_grant' }));
    const providers = createOAuthProviders(makeConfig({ huawei: ['hw-id', 'hw-secret'] }), {
      fetch: http.fetch,
    });

    await expect(providers.huawei.exchange('code')).rejects.toThrow(/未返回 access_token/);
  });
});

describe('飞书：JSON token + data.* 嵌套 user_info', () => {
  it('正常换 token：token 走 JSON，用户信息从 data 里解包', async () => {
    const http = fakeFetch((url) =>
      url.includes('/authen/v2/oauth/token')
        ? { code: 0, access_token: 'fs-at' }
        : { code: 0, data: { open_id: 'fs-open-1', union_id: 'fs-union-1', name: '飞书用户' } },
    );
    const providers = createOAuthProviders(makeConfig({ feishu: ['fs-id', 'fs-secret'] }), {
      fetch: http.fetch,
    });

    const profile = await providers.feishu.exchange('code-fs-1', 'https://app/cb');

    expect(profile.openId).toBe('fs-open-1');
    expect(profile.unionId).toBe('fs-union-1');
    expect(profile.nickname).toBe('飞书用户');
    expect(headerOf(http.calls[0], 'content-type')).toContain('application/json');
    const tokenBody = JSON.parse(bodyOf(http.calls[0])) as Record<string, string>;
    expect(tokenBody.client_id).toBe('fs-id');
    expect(tokenBody.grant_type).toBe('authorization_code');
  });

  it('失败分支：业务错误码非 0 时抛错', async () => {
    const http = fakeFetch(() => ({ code: 20003, error_description: 'invalid code' }));
    const providers = createOAuthProviders(makeConfig({ feishu: ['fs-id', 'fs-secret'] }), {
      fetch: http.fetch,
    });

    await expect(providers.feishu.exchange('code')).rejects.toThrow(/20003/);
  });
});

describe('X / Twitter：通用适配器 + PKCE', () => {
  const spec = {
    pkce: true,
    authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    userinfoUrl: 'https://api.twitter.com/2/users/me',
    scope: 'users.read',
    tokenAuth: 'basic' as const,
    fieldMap: { openId: 'data.id', nickname: 'data.name' },
  };

  it('授权地址带 S256 challenge，换 token 回传匹配的 verifier', async () => {
    const http = fakeFetch((url) =>
      url.includes('/oauth2/token')
        ? { access_token: 'x-at' }
        : { data: { id: '42', name: 'X 用户' } },
    );
    const provider = createGenericOAuthProvider({
      key: 'x_twitter',
      clientId: 'x-id',
      clientSecret: 'x-secret',
      spec,
      fetch: http.fetch,
    });

    const location = provider.authorizeUrl?.('https://app/cb', 'state-x-1') ?? '';
    const authorize = new URL(location);
    const challenge = authorize.searchParams.get('code_challenge') ?? '';
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(challenge.length).toBeGreaterThan(20);

    bindPkceCode('x_twitter', 'code-x-1', 'state-x-1');
    const profile = await provider.exchange('code-x-1', 'https://app/cb');

    expect(profile.openId).toBe('42');
    expect(profile.nickname).toBe('X 用户');
    const tokenBody = bodyOf(http.calls[0]);
    const verifier = new URLSearchParams(tokenBody).get('code_verifier') ?? '';
    expect(verifier).not.toBe('');
    // 关键校验：token 阶段回传的 verifier 必须与授权阶段的 challenge 对应。
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge);
    expect(headerOf(http.calls[0], 'authorization')).toBe(
      `Basic ${Buffer.from('x-id:x-secret').toString('base64')}`,
    );
  });

  it('失败分支：没有绑定 verifier 时拒绝换 token，不回退成假成功', async () => {
    const http = fakeFetch(() => ({ access_token: 'x-at' }));
    const provider = createGenericOAuthProvider({
      key: 'x_twitter',
      clientId: 'x-id',
      clientSecret: 'x-secret',
      spec,
      fetch: http.fetch,
    });

    await expect(provider.exchange('code-never-authorized')).rejects.toThrow(/code_verifier/);
  });
});

describe('合并接线：union_id 优先、手机号其次', () => {
  it('小程序 union_id 与公众号共用合并逻辑：同一 union 落到同一账号', async () => {
    const unionId = 'union-shared-1';
    const ctx = await makeApp({
      oauth: {
        wechat_mini: new FakeOAuth('wechat_mini', {
          openId: 'mini-open-9',
          unionId,
          nickname: '小程序',
          avatarUrl: null,
        }),
        wechat_mp: new FakeOAuth('wechat_mp', {
          openId: 'mp-open-9',
          unionId,
          nickname: '公众号',
          avatarUrl: null,
        }),
      },
    });
    app = ctx.app;

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/oauth',
      payload: { provider: 'wechat_mini', code: 'mini-code' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.isNewUser).toBe(true);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/oauth',
      payload: { provider: 'wechat_mp', code: 'mp-code' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.isNewUser).toBe(false);
    expect(second.json().data.user.id).toBe(first.json().data.user.id);
  });

  it('华为账号返回已验证手机号时，合并到既有手机号账号', async () => {
    const phone = '13800009999';
    const ctx = await makeApp({
      oauth: {
        huawei: new FakeOAuth('huawei', {
          openId: 'hw-open-9',
          unionId: null,
          nickname: '华为',
          avatarUrl: null,
          phone,
          phoneVerified: true,
        }),
      },
    });
    app = ctx.app;

    const sms = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sms/code',
      payload: { phone, purpose: 'register' },
    });
    expect(sms.statusCode).toBe(200);
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/phone',
      payload: { phone, code: sms.json().data.devCode, nickname: '手机号用户' },
    });
    expect(registered.statusCode).toBe(201);

    const huawei = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/oauth',
      payload: { provider: 'huawei', code: 'hw-code' },
    });
    expect(huawei.statusCode).toBe(200);
    expect(huawei.json().data.isNewUser).toBe(false);
    expect(huawei.json().data.user.id).toBe(registered.json().data.user.id);
  });
});

describe('注册表状态：从 unavailable 变成 unconfigured，不伪造可用', () => {
  const keys = ['wechat_mini', 'wechat_app', 'huawei', 'feishu', 'x_twitter'];

  const makeRegistry = (env: NodeJS.ProcessEnv, creds: Partial<Record<OAuthProviderKey, [string, string]>> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'mixm-extra-'));
    tempDirs.push(dir);
    return new ProviderRegistry({
      config: makeConfig(creds),
      env,
      switchFile: join(dir, 'switches.json'),
    });
  };

  it('五条都已换成真实适配器，缺密钥时是 unconfigured 且列出缺失项', () => {
    const registry = makeRegistry({});

    for (const key of keys) {
      const state = registry.get(key);
      expect(state, key).not.toBeNull();
      expect(state!.adapter, key).not.toBe('pending');
      expect(state!.status, key).toBe('unconfigured');
      expect(state!.enabled, key).toBe(false);
      expect(state!.missing.length, key).toBeGreaterThan(0);
      expect(state!.reason, key).toMatch(/缺少配置/);
    }
    expect(registry.get('x_twitter')!.adapter).toBe('generic');
  });

  it('缺配置时管理端开启会 409 并点名缺的环境变量', () => {
    const registry = makeRegistry({});
    expect(() => registry.setEnabled('wechat_mini', true)).toThrow(/OAUTH_WECHAT_MINI_APP_ID/);
    expect(() => registry.setEnabled('x_twitter', true)).toThrow(/OAUTH_X_CLIENT_ID/);
  });

  it('凭证齐全后状态变为 ready（尚未调用真实网络，仅验证状态推导）', () => {
    const registry = makeRegistry(
      {
        OAUTH_WECHAT_MINI_APP_ID: 'id',
        OAUTH_WECHAT_MINI_APP_SECRET: 'secret',
        OAUTH_WECHAT_MOBILE_APP_ID: 'mid',
        OAUTH_WECHAT_MOBILE_APP_SECRET: 'msecret',
        OAUTH_HUAWEI_CLIENT_ID: 'hid',
        OAUTH_HUAWEI_CLIENT_SECRET: 'hsecret',
        OAUTH_FEISHU_APP_ID: 'fid',
        OAUTH_FEISHU_APP_SECRET: 'fsecret',
        OAUTH_X_CLIENT_ID: 'xid',
        OAUTH_X_CLIENT_SECRET: 'xsecret',
      },
      {
        wechat_mini: ['id', 'secret'],
        wechat_app: ['mid', 'msecret'],
        huawei: ['hid', 'hsecret'],
        feishu: ['fid', 'fsecret'],
      },
    );

    for (const key of keys) {
      const state = registry.get(key);
      expect(state!.status, key).toBe('ready');
      expect(state!.missing, key).toEqual([]);
    }
  });
});
