import { buildApp } from './app.js';
import { loadConfig, loadDotEnv } from './config.js';
import { MemoryStore } from './db/memory.js';
import { runMigrations } from './db/migrate.js';
import { createStore } from './db/postgres.js';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();

  // 生产路径只认 PostgreSQL：没有连接串就拒绝启动，避免「以为在跑真库、其实在跑内存」。
  // 内存实现只用于单元测试与显式声明的临时联调（ALLOW_MEMORY_STORE=1）。
  if (!config.databaseUrl && !config.allowMemoryStore) {
    throw new Error(
      '缺少 DATABASE_URL：MixmAPP 的持久化只认 PostgreSQL。请配置连接串（免费云端可用 Neon / Supabase），' +
        '或显式设置 ALLOW_MEMORY_STORE=1 做临时联调（数据重启即失）。',
    );
  }

  const store = config.databaseUrl ? createStore(config.databaseUrl) : new MemoryStore();
  if (!config.databaseUrl) {
    console.warn('[warn] ALLOW_MEMORY_STORE=1：使用内存存储，重启即丢数据，禁止用于任何验证或演示环境');
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
