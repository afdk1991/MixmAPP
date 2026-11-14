/**
 * catalog 采集器配置：命令行参数优先，其次环境变量，最后默认值。
 *
 * 参数一览（`pnpm catalog:sync --help` 也会打印）：
 *   --base-url <url>      站点基址，默认 https://eg.egluosi.com
 *   --concurrency <n>     详情抓取并发，默认 1（限频由 delay 控制，不会真正并发轰炸）
 *   --delay-ms <n>        详情请求最小间隔，默认 250
 *   --list-delay-ms <n>   列表/树请求最小间隔，默认 400
 *   --no-images           不下载图片（只对账/调试用）
 *   --no-filters          不抓规格筛选项
 *   --dry-run             只对账不写库
 *   --resume              断点续跑上一次未完成的运行
 *   --limit <n>           只抓前 n 个三级类目 / n 条商品（调试）
 *   --state-dir <dir>     状态、日志、报告目录
 *   --storage-dir <dir>   图片落盘根目录
 *   --filters-only        只抓目录树与规格筛选项，不抓商品
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

function readArgs(argv) {
  const args = argv.slice(2);
  const has = (name) => args.includes(name);
  const value = (name, fallback) => {
    const i = args.indexOf(name);
    if (i < 0) return fallback;
    const next = args[i + 1];
    return next && !next.startsWith('--') ? next : fallback;
  };
  const number = (name, fallback, { min = 1 } = {}) => {
    const raw = value(name, '');
    if (raw === '' || raw === undefined || raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min ? n : fallback;
  };
  const bool = (name, envKey, fallback) => {
    if (has(name)) return true;
    const raw = process.env[envKey];
    if (raw === undefined || raw === '') return fallback;
    return !/^(0|false|no|off)$/i.test(raw);
  };
  const command = args[0] && !args[0].startsWith('--') ? args[0] : 'sync';
  return { args, has, value, number, bool, command };
}

export function loadConfig(argv = process.argv) {
  const { args, has, value, number, bool, command } = readArgs(argv);
  const env = process.env;

  const stateDir = path.resolve(
    value('--state-dir', env.SYNC_STATE_DIR || env.CATALOG_STATE_DIR || path.join(REPO_ROOT, '.catalog-sync'))
  );
  const storageDir = path.resolve(value('--storage-dir', env.STORAGE_DIR || path.join(REPO_ROOT, '.catalog-storage')));

  return {
    command,
    help: has('--help') || has('-h'),
    baseUrl: value('--base-url', env.CATALOG_BASE_URL || 'https://eg.egluosi.com').replace(/\/+$/, ''),
    concurrency: number('--concurrency', Number(env.CATALOG_CONCURRENCY) || 1),
    delayMs: number('--delay-ms', Number(env.DETAIL_DELAY_MS) || 250, { min: 0 }),
    listDelayMs: number('--list-delay-ms', Number(env.CATALOG_DELAY_MS) || 400, { min: 0 }),
    timeoutMs: number('--timeout-ms', 20000),
    maxRetries: number('--retries', 3, { min: 0 }),
    downloadImages: !has('--no-images') && bool('', 'CATALOG_DOWNLOAD_IMAGES', true),
    withFilters: !has('--no-filters'),
    dryRun: has('--dry-run') || bool('', 'CATALOG_DRY_RUN', false),
    resume: has('--resume'),
    filtersOnly: has('--filters-only'),
    limit: number('--limit', 0, { min: 0 }),
    itemNo: value('--item-no', ''),
    brand: value('--brand', ''),
    spec: value('--spec', ''),
    dims: value('--dims', ''),
    lens: value('--lens', ''),
    stateDir,
    storageDir,
    logFile: path.join(stateDir, 'sync.log'),
    logMaxBytes: number('--log-max-bytes', 5 * 1024 * 1024),
    reportDir: path.join(stateDir, 'reports'),
    imageDir: path.join(storageDir, 'products'),
    raw: args,
  };
}

export function usage() {
  return [
    'catalog 采集器（egluosi B2B）',
    '',
    '  pnpm catalog:sync     [选项]   全量抓取 → 比对 → 幂等入库',
    '  pnpm catalog:inspect  [选项]   只读对账：单件/按品牌规格查源站，不写库',
    '',
    '  --base-url <url>     站点基址（默认 https://eg.egluosi.com）',
    '  --concurrency <n>    详情并发（默认 1）',
    '  --delay-ms <n>       详情请求间隔毫秒（默认 250）',
    '  --list-delay-ms <n>  列表请求间隔毫秒（默认 400）',
    '  --no-images          不下载图片',
    '  --no-filters         不抓规格筛选项',
    '  --filters-only       只抓目录树与筛选项',
    '  --dry-run            只对账不写库',
    '  --resume             断点续跑上一次未完成的运行',
    '  --limit <n>          只处理前 n 个三级类目',
    '  --state-dir <dir>    状态/日志/报告目录（默认 <repo>/.catalog-sync）',
    '  --storage-dir <dir>  图片根目录（默认 <repo>/.catalog-storage）',
    '',
    'inspect 专用：',
    '  --item-no <no>       直接查某一货号',
    '  --brand <品牌> --spec <规格>   按品牌+规格在目录里定位（如 EGM / M6-1.0x8）',
    '  --dims <n> --lens <n>          列表接口的规格筛选参数',
    '  --limit <n>          最多输出几件（默认 5）',
  ].join('\n');
}
