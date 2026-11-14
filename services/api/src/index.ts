import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { buildApp } from './app.js';
import { loadConfig, loadDotEnv, projectRoot } from './config.js';
import { runMigrations } from './db/migrate.js';
import { createStoreSwitcher } from './db/switchable.js';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();

  // 生产路径只认 PostgreSQL：既没有连接串、也没有 CloudBase PG 网关就拒绝启动，
  // 避免「以为在跑真库、其实在跑内存」。
  // 内存实现只用于单元测试与显式声明的临时联调（ALLOW_MEMORY_STORE=1）。
  const hasGateway = Boolean(config.pgGateway.url && config.pgGateway.apiKey);
  if (!config.databaseUrl && !hasGateway && !config.allowMemoryStore) {
    throw new Error(
      '缺少数据库配置：MixmAPP 的持久化只认 PostgreSQL。请配置 DATABASE_URL，或配置 ' +
        'CLOUDBASE_PG_GATEWAY + CLOUDBASE_PG_API_KEY（CloudBase PG 网关），' +
        '或显式设置 ALLOW_MEMORY_STORE=1 做临时联调（数据重启即失）。',
    );
  }

  const switcher = createStoreSwitcher(config);
  const store = switcher.store;
  if (!config.databaseUrl && !hasGateway) {
    console.warn('[warn] ALLOW_MEMORY_STORE=1：使用内存存储，重启即丢数据，禁止用于任何验证或演示环境');
  }
  // 启动期目录导入文件一旦配置，内存库就不再注入演示商品，避免示例商品污染真实目录。
  const startupCatalog = process.env['MALL_IMPORT_CATALOG']?.trim();
  if (process.env['SEED_DEMO_PRODUCTS'] === '1' && store.driver === 'memory' && !startupCatalog) {
    const { seedDemoProducts } = await import('./db/demo-seed.js');
    const added = await seedDemoProducts(store as unknown as import('./db/memory.js').MemoryStore);
    console.info(`[seed] 内存驱动注入示例商品：${added} 件（与 infra/sql/0002_mall.sql 同源）`);
  }
  if (config.databaseUrl && process.env['RUN_MIGRATIONS'] === '1') {
    const applied = await runMigrations(config.databaseUrl);
    console.info(`[db] 迁移完成：${applied.length ? applied.join(', ') : '已是最新'}`);
  } else if (hasGateway) {
    console.info('[db] 使用 CloudBase PG 网关（public.mix_exec SQL 桥），迁移由管理面执行');
  }

  const app = await buildApp({ config, store, dbSwitcher: switcher, logger: config.env !== 'test' });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`收到 ${signal}，开始优雅退出`);
    await app.close();
    await switcher.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`${config.appName} API 已启动：http://${config.host}:${config.port}`);

  // 启动期自动导入一次目录（env MALL_IMPORT_CATALOG 指向相对/绝对 catalog.json）。
  // 路径同样限制在仓库根内；导入走服务内 MallService.importCatalog，与 HTTP/CLI 同一套规则。
  if (startupCatalog) {
    const repoRoot = projectRoot();
    const resolved = resolve(process.cwd(), startupCatalog);
    if (resolved !== repoRoot && !resolved.startsWith(repoRoot + sep)) {
      throw new Error('MALL_IMPORT_CATALOG 路径越出仓库根目录');
    }
    if (!existsSync(resolved)) throw new Error(`MALL_IMPORT_CATALOG 文件不存在：${resolved}`);
    const raw = JSON.parse(readFileSync(resolved, 'utf8')) as unknown;
    const report = await app.mall.importCatalog(raw);
    app.log.info(
      { inserted: report.inserted, updated: report.updated, failed: report.failed },
      '启动期目录导入完成',
    );
  }

  // 待支付超时取消：每分钟扫一次；ORDER_TTL_MINUTES=0 可关闭
  if (config.orderTtlMinutes > 0) {
    const timer = setInterval(() => {
      void app.mall
        .sweepExpiredOrders(config.orderTtlMinutes)
        .then((cancelled) => {
          if (cancelled.length) app.log.info({ count: cancelled.length }, '超时订单已取消并归还库存');
        })
        .catch((error) => app.log.error({ err: error }, '超时取消扫描失败'));
    }, 60_000);
    timer.unref();
  }
}

main().catch((error) => {
  console.error('启动失败', error);
  process.exit(1);
});
