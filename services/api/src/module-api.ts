/**
 * 供外部 CLI / 脚本复用的服务端组装层（不触发 index.ts 的自动启动）。
 * HTTP 通道与 tools/egluosi-importer/import.mjs 共用这里导出的 Config、Store 与 MallService，
 * 导入规则只在 MallService.importCatalog 里实现一份。
 */
export { buildApp } from './app.js';
export { loadConfig, loadDotEnv, projectRoot } from './config.js';
export { createStoreSwitcher } from './db/switchable.js';
export { MallService } from './modules/mall.js';
export type { ImportReport, ImportCategoryCount } from './modules/mall.js';
