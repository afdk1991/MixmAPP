import type { FastifyInstance } from 'fastify';
import { ID_STRATEGIES } from '@mixmapp/ids';
import { capabilitySnapshot, dbHostOf } from '../config.js';

export async function metaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/meta', async () => ({
    data: {
      appName: app.cfg.appName,
      version: app.cfg.version,
      env: app.cfg.env,
      ids: {
        strategies: ID_STRATEGIES,
        current: app.cfg.ids.strategy,
      },
      thirdParty: capabilitySnapshot(app.cfg),
      serverTime: new Date().toISOString(),
    },
  }));

  app.get('/healthz', async (_request, reply) => {
    let db = 'memory';
    let ok = true;
    if (app.store.driver === 'postgres') {
      try {
        ok = await app.store.ping();
        db = ok ? 'ok' : 'down';
      } catch {
        ok = false;
        db = 'down';
      }
    }
    const checks: Record<string, string> = {
      db,
      dbTarget: app.cfg.dbTarget,
      dbHost: dbHostOf(app.cfg.databaseUrl),
      dbSource: app.cfg.databaseUrlSource,
      sms: app.cfg.sms.provider,
      pay:
        capabilitySnapshot(app.cfg)['wechatPay'] === 'on' ||
        capabilitySnapshot(app.cfg)['alipay'] === 'on'
          ? 'live'
          : 'dev',
      storage: app.cfg.storage.provider,
      push: app.cfg.push.provider,
      ai: app.cfg.ai.provider,
    };
    const report = {
      status: ok ? ('ok' as const) : ('degraded' as const),
      version: app.cfg.version,
      uptimeSec: Math.round(process.uptime()),
      checks,
      time: new Date().toISOString(),
    };
    return reply.code(ok ? 200 : 503).send(report);
  });

  app.get('/readyz', async (_request, reply) => {
    if (app.store.driver !== 'postgres') return reply.code(200).send({ ready: true });
    try {
      const ok = await app.store.ping();
      return reply.code(ok ? 200 : 503).send({ ready: ok });
    } catch {
      return reply.code(503).send({ ready: false });
    }
  });
}
