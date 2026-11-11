import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { loadConfig, loadDotEnv, sqlDir } from '../config.js';

/**
 * 幂等迁移：按文件名顺序执行 infra/sql/*.sql，并用 schema_migrations 记录。
 * 每个文件内部的语句需自带 if not exists / 幂等写法。
 */
export async function runMigrations(connectionString: string, dir = sqlDir()): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const existing = await client.query('select 1 from schema_migrations where name = $1', [file]);
      if (existing.rowCount) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`迁移 ${file} 失败: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  if (!config.databaseUrl) {
    console.error('未配置 DATABASE_URL，无法执行迁移');
    process.exit(1);
  }
  const applied = await runMigrations(config.databaseUrl);
  console.info(applied.length ? `已应用: ${applied.join(', ')}` : '数据库已是最新');
}

const invoked = process.argv[1] ?? '';
if (/migrate\.(ts|js)$/.test(invoked)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
