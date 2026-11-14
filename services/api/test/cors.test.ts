import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryStore } from '../src/db/memory.js';
import { testConfig } from './helpers.js';

const BUILTIN = [
  'https://localhost',
  'capacitor://localhost',
  'http://localhost',
  'http://127.0.0.1',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

describe('CORS 白名单', () => {
  const prev = process.env.CORS_ORIGINS;
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (prev === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = prev;
  });

  it('恒定并入壳与本地调试源，trim 且去重，不夹带未授权源', () => {
    process.env.CORS_ORIGINS = 'https://mim.mixm.top, https://mim.mixm.top';
    const cfg = loadConfig();
    for (const origin of BUILTIN) expect(cfg.corsOrigins).toContain(origin);
    expect(cfg.corsOrigins).toContain('https://mim.mixm.top');
    expect(cfg.corsOrigins.filter((x) => x === 'https://mim.mixm.top')).toHaveLength(1);
    expect(cfg.corsOrigins).not.toContain('https://evil.example');
  });

  it('默认 * 时保留 * 标记，同时仍并入内置源', () => {
    delete process.env.CORS_ORIGINS;
    const cfg = loadConfig();
    expect(cfg.corsOrigins).toContain('*');
    for (const origin of BUILTIN) expect(cfg.corsOrigins).toContain(origin);
  });

  it('受限白名单下 https://localhost 回 ACAO，未授权源不回 ACAO', async () => {
    app = await buildApp({
      config: { ...testConfig, corsOrigins: ['https://mim.mixm.top', ...BUILTIN] },
      store: new MemoryStore(),
      logger: false,
    });

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/mall/products?pageSize=1',
      headers: { Origin: 'https://localhost' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://localhost');

    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/mall/products?pageSize=1',
      headers: { Origin: 'https://evil.example' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/mall/orders',
      headers: {
        Origin: 'https://localhost',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization',
      },
    });
    expect(preflight.headers['access-control-allow-origin']).toBe('https://localhost');

    const deniedPreflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/mall/orders',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization',
      },
    });
    expect(deniedPreflight.headers['access-control-allow-origin']).toBeUndefined();
  });
});
