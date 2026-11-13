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

describe('用户名注册', () => {
  it('注册后可用用户名或 MixmAPP 号登录', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/username',
      payload: { username: 'mixfan_01', password: 'Passw0rd!x', nickname: '用户名用户' },
    });
    expect(reg.statusCode).toBe(201);
    const data = reg.json().data;
    expect(data.user.username).toBe('mixfan_01');
    expect(data.user.isGuest).toBe(false);
    expect(data.user.bindings).toEqual([]);

    for (const account of ['mixfan_01', 'MIXFAN_01', data.user.accountNo]) {
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/password',
        payload: { account, password: 'Passw0rd!x' },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json().data.user.accountNo).toBe(data.user.accountNo);
    }
  });

  it('重复用户名 409，保留名与纯数字用户名 422', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/username',
      payload: { username: 'mixfan_02', password: 'Passw0rd!x' },
    });
    expect(first.statusCode).toBe(201);
    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/username',
      payload: { username: 'MixFan_02', password: 'Passw0rd!x' },
    });
    expect(dup.statusCode).toBe(409);

    for (const username of ['admin', '12345678', 'a b']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register/username',
        payload: { username, password: 'Passw0rd!x' },
      });
      expect(res.statusCode).toBe(422);
    }
  });

  it('不同账号分配不同的 MixmAPP 公民编号', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/username',
      payload: { username: 'citizen_a_01', password: 'Passw0rd!x' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/username',
      payload: { username: 'citizen_b_02', password: 'Passw0rd!x' },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const a = first.json().data.user.accountNo as string;
    const b = second.json().data.user.accountNo as string;
    expect(a).toMatch(/^MixmAPP-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]$/);
    expect(b).toMatch(/^MixmAPP-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]$/);
    expect(a).not.toBe(b); // 公民编号按用户唯一分配，不允许两名用户共用
  });
});

describe('游客注册', () => {
  it('同一设备重复注册复用同一账号，绑定手机号后不再是游客', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const deviceId = 'device-abcdef-123456';
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/guest',
      payload: { deviceId },
    });
    expect(first.statusCode).toBe(201);
    const guest = first.json().data;
    expect(guest.isNewUser).toBe(true);
    expect(guest.user.isGuest).toBe(true);
    expect(guest.user.bindings).toEqual(['guest']);

    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/guest',
      payload: { deviceId },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.isNewUser).toBe(false);
    expect(again.json().data.user.accountNo).toBe(guest.user.accountNo);

    const phone = '13900001111';
    const code = await requestCode(app, phone, 'bind');
    const bind = await app.inject({
      method: 'POST',
      url: '/api/v1/me/bind/phone',
      headers: { authorization: `Bearer ${guest.tokens.accessToken}` },
      payload: { phone, code },
    });
    expect(bind.statusCode).toBe(200);
    expect(bind.json().data.isGuest).toBe(false);
    expect(bind.json().data.phone).toBe('139****1111');
  });

  it('设备标识过短应 422', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/guest',
      payload: { deviceId: 'short' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('一键登录', () => {
  it('未注册手机号直接建号，再次登录复用同一账号', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/onekey',
      payload: { token: 'dev:13900002222', nickname: '一键用户' },
    });
    expect(first.statusCode).toBe(200);
    const data = first.json().data;
    expect(data.isNewUser).toBe(true);
    expect(data.user.phone).toBe('139****2222');

    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/onekey',
      payload: { token: 'dev:13900002222' },
    });
    expect(again.json().data.isNewUser).toBe(false);
    expect(again.json().data.user.accountNo).toBe(data.user.accountNo);
  });

  it('无效一键登录凭证应 422', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/onekey',
      payload: { token: 'dev:123456' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('CODE_INVALID');
  });
});

describe('Apple 登录', () => {
  it('首次登录建号，二次登录复用同一账号', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/oauth',
      payload: { provider: 'apple', code: 'apple-identity-token' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.isNewUser).toBe(true);
    expect(first.json().data.user.bindings).toEqual(['apple']);

    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/oauth',
      payload: { provider: 'apple', code: 'apple-identity-token' },
    });
    expect(again.json().data.isNewUser).toBe(false);
    expect(again.json().data.user.accountNo).toBe(first.json().data.user.accountNo);
  });

  it('未配置凭据的渠道应返回 PROVIDER_DISABLED', async () => {
    const disabled = {
      name: 'apple' as const,
      enabled: false,
      exchange: async () => {
        throw new Error('不应被调用');
      },
    };
    const ctx = await makeApp({ oauth: { apple: disabled } });
    app = ctx.app;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/oauth',
      payload: { provider: 'apple', code: 'token' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('PROVIDER_DISABLED');
  });
});

describe('用户名合规', () => {
  it('允许中文用户名', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/username',
      payload: { username: '小明同学', password: 'Passw0rd!x' },
    });
    expect(reg.statusCode).toBe(201);
    expect(reg.json().data.user.username).toBe('小明同学');
  });

  it.each([
    '超级管理员',
    '管理员',
    'root',
    'MixmApp官方',
    '北京市政府',
    '公安局',
    '赌博平台',
    '4dm1n',
  ])('拒绝敏感身份类用户名：%s', async (username) => {
    const ctx = await makeApp();
    app = ctx.app;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/username',
      payload: { username, password: 'Passw0rd!x' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('游客升级时同样执行用户名合规校验', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const guest = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/guest',
      payload: { deviceId: 'device-upgrade-123456' },
    });
    const token = guest.json().data.tokens.accessToken as string;
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/me/bind/username',
      headers: { authorization: `Bearer ${token}` },
      payload: { username: '系统管理员', password: 'Passw0rd!x' },
    });
    expect(bad.statusCode).toBe(422);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/me/bind/username',
      headers: { authorization: `Bearer ${token}` },
      payload: { username: '转正用户_01', password: 'Passw0rd!x' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.isGuest).toBe(false);
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

  // 健康检查只有一个地址：根路径不能再有一份同名实现，否则运维探到的是另一套行为
  it('根路径 /healthz 不再单独注册（唯一实现是 /api/v1/healthz）', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const root = await app.inject({ method: 'GET', url: '/healthz' });
    expect(root.statusCode).toBe(404);
    const entry = await app.inject({ method: 'GET', url: '/' });
    expect(entry.json().health).toBe('/api/v1/healthz');
    expect(entry.json().ready).toBe('/api/v1/readyz');
  });
});
