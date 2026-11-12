import { buildApp } from './app.js';
import { loadConfig, loadDotEnv } from './config.js';
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
