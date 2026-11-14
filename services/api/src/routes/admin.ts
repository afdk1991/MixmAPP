import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { StoreSwitcher } from '../db/switchable.js';
import { hostOf } from '../db/switchable.js';
import { projectRoot } from '../config.js';
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

  // 目录导入：body ① 直接给 catalog 对象；② 给 { file: "tools/.../catalog.json" }，
  // 服务端按 process.cwd() 解析并限制在仓库根目录内，防路径穿越。
  app.post('/admin/mall/import', { bodyLimit: 64 * 1024 * 1024 }, async (request) => {
    await guard(request as unknown as { headers: Record<string, unknown> });
    const rawBody = (request.body ?? {}) as Record<string, unknown>;
    let catalogRaw: unknown = rawBody;
    const file = typeof rawBody.file === 'string' ? rawBody.file : undefined;
    const batch = typeof rawBody.batch === 'string' ? rawBody.batch : undefined;

    if (file) {
      const repoRoot = projectRoot();
      const resolved = resolve(process.cwd(), file);
      if (resolved !== repoRoot && !resolved.startsWith(repoRoot + sep)) {
        throw new AppError('BAD_REQUEST', '导入文件路径越出仓库根目录');
      }
      if (!existsSync(resolved)) throw AppError.notFound('导入文件不存在');
      let text: string;
      try {
        text = readFileSync(resolved, 'utf8');
      } catch {
        throw AppError.notFound('导入文件不存在或不可读');
      }
      try {
        catalogRaw = JSON.parse(text) as unknown;
      } catch {
        throw AppError.validation('导入文件不是合法 JSON');
      }
    }

    const report = await app.mall.importCatalog(catalogRaw, batch ? { batch } : {});
    return { data: report };
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
