import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { OAuthProfile, OAuthProvider, OAuthProviderName } from '../src/adapters/oauth.js';
import { makeApp } from './helpers.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const profile: OAuthProfile = { openId: 'gh-1', unionId: null, nickname: 'Octocat', avatarUrl: null };

/** 带 authorizeUrl 的假渠道：模拟已配置渠道的服务端拉起能力。 */
class RedirectOAuth implements OAuthProvider {
  readonly enabled = true;

  constructor(
    readonly name: OAuthProviderName,
    private readonly authorizeBase: string,
    private readonly support = true,
  ) {}

  async exchange(): Promise<OAuthProfile> {
    return profile;
  }

  authorizeUrl(redirectUri: string, state: string): string | null {
    if (!this.support) return null;
    const url = new URL(this.authorizeBase);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }
}

async function startAndGetState(instance: FastifyInstance, provider: string, redirect?: string): Promise<string> {
  const res = await instance.inject({
    method: 'GET',
    url: `/api/v1/auth/oauth/${provider}/start${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`,
    headers: { host: 'localhost:8080' },
  });
  expect(res.statusCode).toBe(302);
  const location = res.headers['location'] as string;
  expect(location).toContain('authorize.example.com');
  const state = new URL(location).searchParams.get('state');
  expect(state).toBeTruthy();
  return state as string;
}

describe('第三方登录发起 / 回跳', () => {
  it('渠道未启用时返回 PROVIDER_DISABLED，不做假跳转', async () => {
    const built = await makeApp();
    app = built.app;
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/github/start' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('PROVIDER_DISABLED');
  });

  it('渠道不支持服务端拉起（如 Apple H5）时同样返回 PROVIDER_DISABLED', async () => {
    const built = await makeApp({
      oauth: { apple: new RedirectOAuth('apple', 'https://authorize.example.com/apple', false) },
    });
    app = built.app;
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/apple/start' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('PROVIDER_DISABLED');
  });

  it('已配置渠道 302 到授权页，redirect_uri 指回本站 callback', async () => {
    const built = await makeApp({
      oauth: { github: new RedirectOAuth('github', 'https://authorize.example.com/github') },
    });
    app = built.app;
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/oauth/github/start',
      headers: { host: 'localhost:8080' },
    });
    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers['location'] as string);
    expect(location.origin).toBe('https://authorize.example.com');
    expect(location.searchParams.get('redirect_uri')).toBe(
      `${built.app.cfg.publicBaseUrl.replace(/\/$/, '')}/api/v1/auth/oauth/github/callback`,
    );
    expect(location.searchParams.get('state')).toMatch(/^[0-9a-f]{48}$/);
  });

  it('回跳校验 state 后把 code 带回原页面', async () => {
    const built = await makeApp({
      oauth: { github: new RedirectOAuth('github', 'https://authorize.example.com/github') },
    });
    app = built.app;
    const redirect = 'https://afdk1991.github.io/MixmAPP/pages/auth/login';
    const state = await startAndGetState(app, 'github', redirect);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/oauth/github/callback?code=abc123&state=${state}`,
    });
    expect(res.statusCode).toBe(302);
    const target = new URL(res.headers['location'] as string);
    expect(target.origin + target.pathname).toBe(redirect);
    expect(target.searchParams.get('code')).toBe('abc123');
    expect(target.searchParams.get('oauthProvider')).toBe('github');

    // state 一次性：重复使用必须被拒
    const replay = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/oauth/github/callback?code=abc123&state=${state}`,
    });
    expect(replay.statusCode).toBe(422);
    expect(replay.json().error.code).toBe('CODE_INVALID');
  });

  it('伪造 state 与非法 redirect 都被挡住', async () => {
    const built = await makeApp({
      oauth: { github: new RedirectOAuth('github', 'https://authorize.example.com/github') },
    });
    app = built.app;
    const bad = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/oauth/github/callback?code=abc123&state=deadbeef',
    });
    expect(bad.statusCode).toBe(422);

    const state = await startAndGetState(app, 'github', 'javascript:alert(1)');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/oauth/github/callback?code=abc123&state=${state}`,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain(built.app.cfg.publicBaseUrl.replace(/\/$/, ''));
    expect(res.headers['location']).not.toContain('javascript:');
  });

  it('渠道回传 error 时把 oauthError 带回页面', async () => {
    const built = await makeApp({
      oauth: { github: new RedirectOAuth('github', 'https://authorize.example.com/github') },
    });
    app = built.app;
    const state = await startAndGetState(app, 'github', 'https://example.com/back');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/oauth/github/callback?error=access_denied&state=${state}`,
    });
    expect(res.statusCode).toBe(302);
    const target = new URL(res.headers['location'] as string);
    expect(target.searchParams.get('oauthError')).toBe('access_denied');
    expect(target.searchParams.get('code')).toBeNull();
  });

  it('渠道换码网络失败时收敛为 PROVIDER_ERROR 而不是 500', async () => {
    const built = await makeApp({
      oauth: {
        github: {
          name: 'github',
          enabled: true,
          async exchange(): Promise<OAuthProfile> {
            throw new TypeError('fetch failed');
          },
        },
      },
    });
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/oauth',
      payload: { provider: 'github', code: 'any' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('PROVIDER_ERROR');
  });
});
