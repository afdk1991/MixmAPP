import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ID_STRATEGIES } from '@mixmapp/ids';
import { capabilitySnapshot, dbHostOf } from '../config.js';

export async function metaRoutes(app: FastifyInstance): Promise<void> {
  /**
   * 运维详情只对管理面开放：配置了 ADMIN_TOKEN 且 x-admin-token 一致才返回
   * 落点 / 主机 / 目录同步 run_id 等信息；匿名一律只拿 {status}。
   */
  const isAdminCall = (request: FastifyRequest): boolean => {
    const token = app.cfg.adminToken;
    if (!token) return false;
    return String(request.headers['x-admin-token'] ?? '') === token;
  };

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
      catalogSource: await app.catalog.status(),
      serverTime: new Date().toISOString(),
    },
  }));

  app.get('/healthz', async (request, reply) => {
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
    const status = ok ? ('ok' as const) : ('degraded' as const);
    // 匿名探针只需要存活结论；主机名、库落点、run_id 等一律不下发。
    if (!isAdminCall(request)) return reply.code(ok ? 200 : 503).send({ status });

    const catalogSource = await app.catalog.status();
    const catalogSync = await app.store.ops.lastCatalogSyncRun().catch(() => null);
    const checks: Record<string, string> = {
      db,
      dbTarget: app.cfg.dbTarget,
      dbHost: dbHostOf(app.cfg.databaseUrl),
      dbSource: app.cfg.databaseUrlSource,
      catalogSource: catalogSource.source,
      catalogSync: catalogSync ? catalogSync.status : 'none',
      stockGate: app.cfg.mall.sourceStockMode,
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
      status,
      version: app.cfg.version,
      uptimeSec: Math.round(process.uptime()),
      checks,
      catalogSource,
      /** 最近一次目录同步：run_id / 起止时间 / 成败 / 失败摘要 / 统计 */
      catalogSync,
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
