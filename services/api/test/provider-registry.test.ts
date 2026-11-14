import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryStore } from '../src/db/memory.js';
import {
  loadProviderDefinitions,
  ProviderRegistry,
  type ProviderDefinition,
} from '../src/modules/provider-registry.js';
import { createGenericOAuthProvider } from '../src/adapters/oauth-generic.js';
import { FakeOAuth, testConfig } from './helpers.js';

const definitions: ProviderDefinition[] = loadProviderDefinitions();
const tempDirs: string[] = [];

function makeRegistry(extraEnv: Record<string, string> = {}): ProviderRegistry {
  const dir = mkdtempSync(join(tmpdir(), 'mixm-oauth-'));
  tempDirs.push(dir);
  return new ProviderRegistry({
    config: testConfig,
    definitions,
    switchFile: join(dir, 'switches.json'),
    env: { ...process.env, ...extraEnv },
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('渠道注册表（config/oauth-providers.json）', () => {
  it('登记 92 条，A/B/C 分别为 22/15/55', () => {
    const registry = makeRegistry();
    const summary = registry.summary();
    expect(summary.total).toBe(92);
    expect(summary.byGroup).toEqual({ A: 22, B: 15, C: 55 });
    expect(registry.states().every((state) => state.key && state.name && state.category)).toBe(true);
  });

  it('没有密钥时没有任何 OAuth 渠道可用，并列出缺失配置项', () => {
    const registry = makeRegistry({ SMS_PROVIDER: 'console', ONEKEY_PROVIDER: 'dev' });
    const wechat = registry.get('wechat');
    expect(wechat?.status).toBe('unconfigured');
    expect(wechat?.enabled).toBe(false);
    expect(wechat?.missing).toContain('OAUTH_WECHAT_APP_ID');
    expect(wechat?.reason).toContain('缺少配置');

    // 不使用「缺配置也标成可用」的假数据：A/B 组未配凭证的真实可用数为 0。
    const oauthStates = registry
      .states()
      .filter((state) => state.kind === undefined && state.group !== 'C');
    expect(oauthStates.filter((state) => state.enabled)).toHaveLength(0);
  });

  it('按凭证配置推导为可用，且通用适配器渠道来自 A 组', () => {
    const generic = definitions.find(
      (def) => def.group === 'A' && def.adapter === 'generic' && def.credentials.length >= 2,
    );
    expect(generic).toBeTruthy();
    const [idKey, secretKey] = generic!.credentials;
    const registry = makeRegistry({ [idKey!]: 'demo-id', [secretKey!]: 'demo-secret' });
    expect(registry.get(generic!.key)?.status).toBe('ready');
    expect(registry.genericProviders()[generic!.key]).toBeTruthy();
  });

  it('C 类平台如实标为不可用且不允许开启', () => {
    const registry = makeRegistry();
    const unavailable = registry.states().filter((state) => state.group === 'C');
    expect(unavailable).toHaveLength(55);
    expect(unavailable.every((state) => state.status === 'unavailable')).toBe(true);
    expect(unavailable.every((state) => Boolean(state.reason))).toBe(true);
    expect(() => registry.setEnabled(unavailable[0]!.key, true)).toThrowError(/暂不具备接入条件/);
  });
});

describe('通用 OAuth2 适配器', () => {
  it('按配置拼授权地址，并按字段映射解析用户信息', async () => {
    const def = definitions.find(
      (item) => item.group === 'A' && item.adapter === 'generic' && item.generic,
    )!;
    const spec = def.generic!;
    const tokens: string[] = [];
    const fetchMock = (async (input: unknown) => {
      const url = String(input);
      tokens.push(url);
      if (url === spec.tokenUrl) {
        return new Response(JSON.stringify({ access_token: 'at-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      const body: Record<string, unknown> = {};
      const set = (path: string, value: unknown): void => {
        const parts = path.split('.');
        let cursor = body;
        parts.forEach((part, index) => {
          if (index === parts.length - 1) cursor[part] = value;
          else cursor = (cursor[part] ??= {}) as Record<string, unknown>;
        });
      };
      set(spec.fieldMap.openId, 'uid-1');
      if (spec.fieldMap.nickname) set(spec.fieldMap.nickname, '测试用户');
      if (spec.fieldMap.unionId) set(spec.fieldMap.unionId, 'union-1');
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;

    const adapter = createGenericOAuthProvider({
      key: def.key,
      clientId: 'client-1',
      clientSecret: 'secret-1',
      spec,
      fetch: fetchMock,
    });
    const location = adapter.authorizeUrl?.('https://app.example.com/callback', 'state-1') ?? '';
    expect(location).toContain('client_id=client-1');
    expect(location).toContain('state=state-1');

    const profile = await adapter.exchange('code-1', 'https://app.example.com/callback');
    expect(profile.openId).toBe('uid-1');
    expect(profile.nickname).toBe('测试用户');
    expect(tokens).toHaveLength(2);
  });
});

describe('渠道开关（热生效）', () => {
  it('关闭后登录页入口消失、start 被拒，已绑定用户仍可用手机号登录', async () => {
    const registry = makeRegistry({ SMS_PROVIDER: 'console' });
    const app = await buildApp({
      config: { ...testConfig, adminToken: 'admin-secret' },
      store: new MemoryStore(),
      oauth: {
        wechat: new FakeOAuth('wechat', {
          openId: 'wx-open-1',
          unionId: 'un-1',
          nickname: '微信测试',
          avatarUrl: null,
        }),
      },
      providerRegistry: registry,
      logger: false,
    });

    const before = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/providers' });
    expect(before.json().data.providers.map((item: { key: string }) => item.key)).toContain('wechat');

    // 先有一个用手机号注册的用户（模拟已绑定微信的老用户）。
    const phone = '13800000009';
    const code = await app.auth.requestSmsCode(phone, 'register');
    const registered = await app.auth.registerByPhone({ phone, code: code.devCode as string });
    await app.auth.linkOAuth(registered.user.id, 'wechat', 'any');

    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/oauth/providers/wechat',
      headers: { 'x-admin-token': 'admin-secret' },
      payload: { enabled: false },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.status).toBe('disabled');

    const after = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/providers' });
    expect(after.json().data.providers.map((item: { key: string }) => item.key)).not.toContain('wechat');

    await expect(app.auth.loginByOAuth({ provider: 'wechat', code: 'any' })).rejects.toThrowError(
      /已停用|未配置|未启用/,
    );

    // 老用户仍可用手机号登录，绑定关系不因渠道停用被删除。
    const loginCode = await app.auth.requestSmsCode(phone, 'login');
    const loggedIn = await app.auth.loginBySms({ phone, code: loginCode.devCode as string });
    expect(loggedIn.user.id).toBe(registered.user.id);
    expect(loggedIn.user.bindings).toContain('wechat');
  });

  it('缺配置的渠道不允许在管理端强行开启', async () => {
    const registry = makeRegistry({ SMS_PROVIDER: 'console' });
    const app = await buildApp({
      config: { ...testConfig, adminToken: 'admin-secret' },
      store: new MemoryStore(),
      providerRegistry: registry,
      logger: false,
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/oauth/providers/wechat',
      headers: { 'x-admin-token': 'admin-secret' },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(409);
  });

  it('管理端能看到全量状态与缺失项', async () => {
    const registry = makeRegistry({ SMS_PROVIDER: 'console' });
    const app = await buildApp({
      config: { ...testConfig, adminToken: 'admin-secret' },
      store: new MemoryStore(),
      providerRegistry: registry,
      logger: false,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/oauth/providers',
      headers: { 'x-admin-token': 'admin-secret' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.summary.total).toBe(92);
    const wechat = body.providers.find((item: { key: string }) => item.key === 'wechat');
    expect(wechat.status).toBe('unconfigured');
    expect(wechat.missing).toContain('OAUTH_WECHAT_APP_ID');
  });
});
