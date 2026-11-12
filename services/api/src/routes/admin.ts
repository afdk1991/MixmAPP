import type { FastifyInstance } from 'fastify';
import type { StoreSwitcher } from '../db/switchable.js';
import { hostOf } from '../db/switchable.js';
import { AppError } from '../lib/errors.js';

/**
 * 管理面：数据库落点查看与热切换。
 * - 未配置 ADMIN_TOKEN 时整组路由返回 404（不暴露管理面存在）
 * - 令牌用 `x-admin-token` 传递；GET 只读，POST 才切换
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const switcher = app.dbSwitcher;

  const guard = async (request: { headers: Record<string, unknown> }): Promise<void> => {
    const token = app.cfg.adminToken;
    if (!token) throw AppError.notFound('未找到路由');
    const provided = String(request.headers['x-admin-token'] ?? '');
    if (provided !== token) throw AppError.notFound('未找到路由');
  };

  const snapshot = () => ({
    target: app.cfg.dbTarget,
    driver: app.store.driver,
    host: hostOf(app.cfg.databaseUrl),
    source: app.cfg.databaseUrlSource,
    available: {
      cloudbase: { configured: Boolean(app.cfg.dbUrls.cloudbase), host: hostOf(app.cfg.dbUrls.cloudbase) },
      server: { configured: Boolean(app.cfg.dbUrls.server), host: hostOf(app.cfg.dbUrls.server) },
    },
  });

  app.get('/admin/db', async (request) => {
    await guard(request as unknown as { headers: Record<string, unknown> });
    return { data: snapshot() };
  });

  app.post('/admin/orders/sweep', async (request) => {
    await guard(request as unknown as { headers: Record<string, unknown> });
    const cancelled = await app.mall.sweepExpiredOrders(app.cfg.orderTtlMinutes);
    return { data: { ttlMinutes: app.cfg.orderTtlMinutes, cancelled, count: cancelled.length } };
  });

  app.post('/admin/db/switch', async (request, reply) => {
    await guard(request as unknown as { headers: Record<string, unknown> });
    const body = (request.body ?? {}) as { target?: string };
    const target = body.target === 'server' ? 'server' : body.target === 'cloudbase' ? 'cloudbase' : null;
    if (!target) throw AppError.validation('target 只能是 cloudbase 或 server');

    if (!app.cfg.dbUrls[target]) {
      throw AppError.conflict(`${target} 还没有配置连接串，先写入环境变量再切换`);
    }
    if (!switcher) throw AppError.conflict('当前进程不支持热切换（以内存存储启动）');

    const result = await switcher.switchTo(target);
    request.log.info({ from: result.from, to: result.to }, '数据库落点已切换');
    return reply.send({ data: { ...snapshot(), switched: result } });
  });
}
