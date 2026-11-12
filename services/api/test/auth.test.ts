import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp } from './helpers.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function requestCode(instance: FastifyInstance, phone: string, purpose: string) {
  const res = await instance.inject({
    method: 'POST',
    url: '/api/v1/auth/sms/code',
    payload: { phone, purpose },
  });
  expect(res.statusCode).toBe(200);
  return res.json().data.devCode as string;
}

describe('手机号注册 / 登录', () => {
  it('注册成功应返回 MixmAPP 号段、令牌与新用户标记', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const phone = '13800001111';
    const code = await requestCode(app, phone, 'register');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/phone',
      payload: { phone, code, nickname: '阿混' },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.isNewUser).toBe(true);
    expect(data.user.accountNo).toMatch(/^MixmAPP-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]$/);
    expect(data.user.nickname).toBe('阿混');
    expect(data.user.phone).toBe('138****1111');
    expect(data.tokens.accessToken).toBeTruthy();
    expect(data.tokens.refreshToken).toBeTruthy();

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${data.tokens.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.accountNo).toBe(data.user.accountNo);
  });

  it('同号重复注册应 409，且验证码只能消费一次', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const phone = '13800002222';
    const code = await requestCode(app, phone, 'register');
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/phone',
      payload: { phone, code },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/phone',
      payload: { phone, code },
    });
    expect(second.statusCode).toBe(409);
  });

  it('短信验证码错误应返回 CODE_INVALID', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const phone = '13800003333';
    await requestCode(app, phone, 'register');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/phone',
      payload: { phone, code: '000000' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('CODE_INVALID');
  });

  it('60 秒内重复获取验证码应被限流', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const phone = '13800004444';
    await requestCode(app, phone, 'login');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sms/code',
      payload: { phone, purpose: 'login' },
    });
    expect(res.statusCode).toBe(429);
  });
});

describe('邮箱注册与密码登录', () => {
  it('注册后可用邮箱或 MixmAPP 号登录（号段大小写不敏感）', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const email = 'tester@mixm.app';
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/email',
      payload: { email, password: 'Passw0rd!x', nickname: '邮箱用户' },
    });
    expect(reg.statusCode).toBe(201);
    const accountNo = reg.json().data.user.accountNo as string;

    for (const account of [email, accountNo, accountNo.toLowerCase()]) {
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/password',
        payload: { account, password: 'Passw0rd!x' },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json().data.user.accountNo).toBe(accountNo);
    }

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/password',
      payload: { account: email, password: 'bad-password' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('弱密码应被拒绝', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/email',
      payload: { email: 'weak@mixm.app', password: 'abcdefgh' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('第三方登录与绑定', () => {
  it('首次第三方登录自动建号，二次登录复用同一账号', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/oauth',
      payload: { provider: 'github', code: 'any-code' },
    });
    expect(login.statusCode).toBe(200);
    const first = login.json().data;
    expect(first.isNewUser).toBe(true);
    expect(first.user.bindings).toEqual(['github']);

    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/oauth',
      payload: { provider: 'github', code: 'any-code' },
    });
    expect(again.json().data.isNewUser).toBe(false);
    expect(again.json().data.user.accountNo).toBe(first.user.accountNo);
  });

  it('已登录用户可绑定第三方，冲突时返回 409', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/email',
      payload: { email: 'bind@mixm.app', password: 'Passw0rd!x' },
    });
    const token = reg.json().data.tokens.accessToken as string;

    const bind = await app.inject({
      method: 'POST',
      url: '/api/v1/me/bind/oauth',
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: 'wechat', code: 'wx' },
    });
    expect(bind.statusCode).toBe(200);
    expect(bind.json().data.bindings).toContain('wechat');
  });
});

describe('刷新令牌轮换', () => {
  it('刷新后旧令牌应失效', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/email',
      payload: { email: 'refresh@mixm.app', password: 'Passw0rd!x' },
    });
    const refreshToken = reg.json().data.tokens.refreshToken as string;

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.tokens.refreshToken).not.toBe(refreshToken);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(replay.statusCode).toBe(401);
  });
});

describe('鉴权与发号器', () => {
  it('无令牌访问 /me 应 401', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('/ids/preview 支持三套策略', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    for (const strategy of ['snowflake', 'ulid', 'uuidv7']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ids/preview',
        payload: { strategy },
      });
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data.accountNo).toMatch(/^MixmAPP-/);
      if (strategy === 'ulid') expect(data.id).toHaveLength(26);
      if (strategy === 'uuidv7') expect(data.id).toContain('-');
    }
  });

  it('/api/v1/meta 暴露能力快照但不泄露密钥', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const res = await app.inject({ method: 'GET', url: '/api/v1/meta' });
    const data = res.json().data;
    expect(data.ids.strategies).toEqual(['snowflake', 'ulid', 'uuidv7']);
    expect(data.thirdParty.sms).toBe('console');
    expect(JSON.stringify(data)).not.toContain('secret');
  });

  it('/healthz 返回 ok', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const res = await app.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });
});
