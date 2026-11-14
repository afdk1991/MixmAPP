#!/usr/bin/env node
/**
 * 目录导入 CLI（内存库之外的复跑入口）。
 *
 * 与 HTTP 通道 POST /admin/mall/import 共用同一段业务逻辑：
 * 两者都调用 MallService.importCatalog（校验 → 图片本地化 → 按 sourceKey 幂等 upsert → 统计），
 * 规则不在脚本里另写一份。
 *
 * 用法：
 *   node tools/egluosi-importer/import.mjs [catalog.json 路径]
 * 默认读取 tools/egluosi-importer/source/catalog.json；路径限制在仓库根目录内。
 * 落点由服务端配置决定（CloudBase PG 网关 / 自建 PG / 显式 ALLOW_MEMORY_STORE=1 的内存库）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const apiDist = join(repoRoot, 'services', 'api', 'dist', 'module-api.js');

if (!existsSync(apiDist)) {
  console.error('未找到 services/api/dist，请先执行 pnpm build:api');
  process.exit(1);
}

const { loadDotEnv, loadConfig, createStoreSwitcher, MallService } = await import(pathToFileURL(apiDist).href);

loadDotEnv();
const config = loadConfig();

const hasGateway = Boolean(config.pgGateway.url && config.pgGateway.apiKey);
if (!config.databaseUrl && !hasGateway && !config.allowMemoryStore) {
  console.error('未配置数据库连接串/网关，且未开启 ALLOW_MEMORY_STORE；CLI 复跑需要 PG 落点');
  process.exit(1);
}

const switcher = createStoreSwitcher(config);
const store = switcher.store;

const catalogArg = process.argv[2];
const catalogPath = resolve(
  process.cwd(),
  catalogArg ?? join('tools', 'egluosi-importer', 'source', 'catalog.json'),
);
if (catalogPath !== repoRoot && !catalogPath.startsWith(repoRoot + sep)) {
  console.error('catalog 路径越出仓库根目录，拒绝读取');
  process.exit(1);
}
if (!existsSync(catalogPath)) {
  console.error(`catalog 文件不存在：${catalogPath}`);
  process.exit(1);
}

let catalog;
try {
  catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
} catch (error) {
  console.error(`catalog 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const mall = new MallService(config, store);
const report = await mall.importCatalog(catalog, {
  sourceImagesDir: join(repoRoot, 'tools', 'egluosi-importer', 'source'),
});

const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'import-report.json');
const payload = {
  ...report,
  catalogPath: catalogPath.slice(repoRoot.length + 1).replaceAll('\\', '/'),
  driver: store.driver,
  ranAt: new Date().toISOString(),
};
writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

console.info(
  `导入完成：inserted=${report.inserted} updated=${report.updated} skipped=${report.skipped} ` +
    `failed=${report.failed} imagesLocalized=${report.imagesLocalized}，报告已写入 ${outFile}`,
);

await switcher.close();
process.exit(report.failed > 0 ? 1 : 0);
