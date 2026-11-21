// 设备与网络快照（契约 docs/39）服务端测试：
// - 未登录 401；上报只接受非 ip/非 updatedAt 字段，伪造 ip 被服务端值覆盖；
// - 同一设备两次上报 deviceId 一致；GET 省略 deviceId 取最近一条，无记录返回 data.device=null；
// - 登录三路携带可选 device：会话行 + user_devices 落库；不带 device 行为与旧版一致；
// - 后台 sessions 仅会话可见，匿名 404，令牌只返哈希前 8 位。
// 内存驱动跑业务口径；PG 驱动集成测试由 postgres.integration.test.ts 在真库环境覆盖。

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStore } from '../src/db/memory.js';
import { testConfig } from './helpers.js';

const ADMIN_TOKEN = 'ops-device-test';
const BASE = '/api/v1';

let app: FastifyInstance | undefined;
let store: MemoryStore;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function setup(): Promise<void> {
  store = new MemoryStore();
  app = await buildApp({
    config: { ...testConfig, adminToken: ADMIN_TOKEN },
    store,
    logger: false,
  });
}

async function registerEmail(email: string, password: string): Promise<{ user: { id: string }; tokens: { accessToken: string } }> {
  const res = await app!.inject({
    method: 'POST',
    url: `${BASE}/auth/register/email`,
    payload: { email, password, nickname: '设备测试' },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data;
}

async function adminCookie(): Promise<string> {
  const res = await app!.inject({
    method: 'POST',
    url: `${BASE}/admin/console/session`,
    payload: { token: ADMIN_TOKEN },
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers['set-cookie'];
  const first = (Array.isArray(raw) ? raw[0] : raw) ?? '';
  return first.split(';')[0] ?? '';
}

describe('设备快照：鉴权与上报', () => {
  it('未登录访问 GET / POST 均返回 401', async () => {
    await setup();
    const get = await app!.inject({ method: 'GET', url: `${BASE}/device/context` });
    const post = await app!.inject({
      method: 'POST',
      url: `${BASE}/device/context`,
      payload: { deviceId: 'dev-anon' },
    });
    expect(get.statusCode).toBe(401);
    expect(post.statusCode).toBe(401);
  });

  it('伪造的 ip / updatedAt 被忽略，IP 取 XFF 首跳；同设备两次上报 deviceId 一致', async () => {
    await setup();
    const reg = await registerEmail('device-1@mixm.app', 'Passw0rd!x');
    const headers = {
      authorization: `Bearer ${reg.tokens.accessToken}`,
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
    };
    const payload = {
      deviceId: 'dev-android-0001',
      model: 'Pixel 8',
      osName: 'Android',
      osVersion: '14',
      networkType: 'wifi',
      carrier: 'China Mobile',
      // 以下两个字段属于服务端产生，客户端上报必须被剥离
      ip: '1.2.3.4',
      updatedAt: '2000-01-01T00:00:00Z',
    };

    const first = await app!.inject({ method: 'POST', url: `${BASE}/device/context`, headers, payload });
    expect(first.statusCode).toBe(200);
    const d1 = first.json().data;
    expect(d1.deviceId).toBe('dev-android-0001');
    expect(d1.ip).toBe('203.0.113.7');
    expect(d1.model).toBe('Pixel 8');
    expect(d1.osName).toBe('Android');
    expect(d1.osVersion).toBe('14');
    expect(d1.networkType).toBe('wifi');
    expect(d1.carrier).toBe('China Mobile');
    expect(Number.isFinite(Date.parse(d1.updatedAt))).toBe(true);

    const second = await app!.inject({ method: 'POST', url: `${BASE}/device/context`, headers, payload });
    expect(second.statusCode).toBe(200);
    const d2 = second.json().data;
    // 稳定性：同一设备两次调用返回同一 deviceId
    expect(d2.deviceId).toBe(d1.deviceId);
    expect(d2.ip).toBe('203.0.113.7');

    const latest = await app!.inject({ method: 'GET', url: `${BASE}/device/context`, headers });
    expect(latest.statusCode).toBe(200);
    expect(latest.json().data.device.deviceId).toBe(d1.deviceId);

    const byId = await app!.inject({
      method: 'GET',
      url: `${BASE}/device/context?deviceId=dev-android-0001`,
      headers,
    });
    expect(byId.json().data.device.ip).toBe('203.0.113.7');

    const missing = await app!.inject({
      method: 'GET',
      url: `${BASE}/device/context?deviceId=unknown-device`,
      headers,
    });
    expect(missing.statusCode).toBe(200);
    expect(missing.json().data.device).toBeNull();
  });

  it('未知网络类型降级 none，未知系统名降级 Web，缺字段留空串', async () => {
    await setup();
    const reg = await registerEmail('device-2@mixm.app', 'Passw0rd!x');
    const res = await app!.inject({
      method: 'POST',
      url: `${BASE}/device/context`,
      headers: { authorization: `Bearer ${reg.tokens.accessToken}` },
      payload: { deviceId: 'dev-odd', networkType: 'satellite', osName: 'Symbian' },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.networkType).toBe('none');
    expect(d.osName).toBe('Web');
    expect(d.model).toBe('');
    expect(d.osVersion).toBe('');
    expect(d.carrier).toBe('');
  });
});

describe('设备快照：登录写入与后台会话', () => {
  it('密码登录携带 device：会话行与 user_devices 落库，后台摘要可见', async () => {
    await setup();
    const email = 'device-login@mixm.app';
    await registerEmail(email, 'Passw0rd!x');

    const login = await app!.inject({
      method: 'POST',
      url: `${BASE}/auth/login/password`,
      headers: { 'x-forwarded-for': '198.51.100.22' },
      payload: {
        account: email,
        password: 'Passw0rd!x',
        device: {
          deviceId: 'dev-login-0002',
          model: 'Mi 14',
          osName: 'Android',
          osVersion: '15',
          networkType: 'cellular',
          carrier: 'China Unicom',
        },
      },
    });
    expect(login.statusCode).toBe(200);
    const userId = login.json().data.user.id as string;

    const devices = await store.userDevices.listByUser(userId);
    expect(devices).toHaveLength(1);
    expect(devices[0]?.deviceId).toBe('dev-login-0002');
    expect(devices[0]?.clientIp).toBe('198.51.100.22');

    const cookie = await adminCookie();
    const sessions = await app!.inject({
      method: 'GET',
      url: `${BASE}/admin/console/users/${userId}/sessions`,
      headers: { cookie },
    });
    expect(sessions.statusCode).toBe(200);
    const rows = sessions.json().data as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0]!;
    // 令牌只返哈希前 8 位，不返原文
    expect(String(row.id)).toHaveLength(8);
    expect(row.deviceId).toBe('dev-login-0002');
    expect(row.model).toBe('Mi 14');
    expect(row.osName).toBe('Android');
    expect(row.osVersion).toBe('15');
    expect(row.networkType).toBe('cellular');
    expect(row.carrier).toBe('China Unicom');
    expect(row.ip).toBe('198.51.100.22');
    expect(row.lastSeenAt).not.toBeNull();

    // 匿名访问后台会话 → 404（既有门禁口径，不泄露接口存在）
    const anon = await app!.inject({
      method: 'GET',
      url: `${BASE}/admin/console/users/${userId}/sessions`,
    });
    expect(anon.statusCode).toBe(404);
  });

  it('登录不传 device：行为与旧版一致，不写设备快照，会话行设备字段为 null', async () => {
    await setup();
    const email = 'device-plain@mixm.app';
    await registerEmail(email, 'Passw0rd!x');

    const login = await app!.inject({
      method: 'POST',
      url: `${BASE}/auth/login/password`,
      payload: { account: email, password: 'Passw0rd!x' },
    });
    expect(login.statusCode).toBe(200);
    const userId = login.json().data.user.id as string;

    expect(await store.userDevices.listByUser(userId)).toHaveLength(0);
    const tokens = await store.refreshTokens.listByUser(userId, 10);
    expect(tokens[0]?.deviceId).toBeNull();
    expect(tokens[0]?.deviceModel).toBeNull();
    expect(tokens[0]?.networkType).toBeNull();
    // 契约 §3.1：IP 无论有无 device 都写（会话视图用）；inject 直连回落 127.0.0.1
    expect(tokens[0]?.clientIp).toBe('127.0.0.1');
  });

  it('后台查询不存在的用户返回 404', async () => {
    await setup();
    const cookie = await adminCookie();
    const res = await app!.inject({
      method: 'GET',
      url: `${BASE}/admin/console/users/no-such-user/sessions`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
