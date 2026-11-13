import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStore } from '../src/db/memory.js';
import { testConfig } from './helpers.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('管理面：数据库落点', () => {
  it('未配置 ADMIN_TOKEN 时整组管理路由 404，不暴露管理面', async () => {
    app = await buildApp({ config: { ...testConfig, adminToken: '' }, store: new MemoryStore(), logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/db' });
    expect(res.statusCode).toBe(404);
  });

  it('令牌错误同样 404', async () => {
    app = await buildApp({ config: { ...testConfig, adminToken: 'admin-secret' }, store: new MemoryStore(), logger: false });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/db',
      headers: { 'x-admin-token': 'wrong' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('带正确令牌可查看落点与两套库是否就绪', async () => {
    app = await buildApp({ config: { ...testConfig, adminToken: 'admin-secret' }, store: new MemoryStore(), logger: false });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/db',
      headers: { 'x-admin-token': 'admin-secret' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.target).toBe('server');
    expect(res.json().data.available.cloudbase.configured).toBe(false);
  });

  it('目标连接串未配置时拒绝切换（409），不会把服务切坏', async () => {
    app = await buildApp({ config: { ...testConfig, adminToken: 'admin-secret' }, store: new MemoryStore(), logger: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/db/switch',
      headers: { 'x-admin-token': 'admin-secret' },
      payload: { target: 'cloudbase' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('非法 target 返回 422', async () => {
    app = await buildApp({ config: { ...testConfig, adminToken: 'admin-secret' }, store: new MemoryStore(), logger: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/db/switch',
      headers: { 'x-admin-token': 'admin-secret' },
      payload: { target: 'mysql' },
    });
    expect(res.statusCode).toBe(422);
  });
});
