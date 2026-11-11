import { buildApp } from './app.js';
import { loadConfig, loadDotEnv } from './config.js';
import { MemoryStore } from './db/memory.js';
import { runMigrations } from './db/migrate.js';
import { createStore } from './db/postgres.js';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();

  const store = config.databaseUrl ? createStore(config.databaseUrl) : new MemoryStore();
  if (!config.databaseUrl) {
    console.warn('[warn] 未配置 DATABASE_URL，使用内存存储（重启即丢数据，仅限本地开发）');
  }
  if (config.databaseUrl && process.env['RUN_MIGRATIONS'] === '1') {
    const applied = await runMigrations(config.databaseUrl);
    console.info(`[db] 迁移完成：${applied.length ? applied.join(', ') : '已是最新'}`);
  }

  const app = await buildApp({ config, store, logger: config.env !== 'test' });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`收到 ${signal}，开始优雅退出`);
    await app.close();
    await store.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`${config.appName} API 已启动：http://${config.host}:${config.port}`);
}

main().catch((error) => {
  console.error('启动失败', error);
  process.exit(1);
});
