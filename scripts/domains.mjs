#!/usr/bin/env node
/**
 * 域名注册表校验（唯一数据源：deploy/domains.json）
 * ----------------------------------------------------------------------------
 * 用法：
 *   node scripts/domains.mjs show    # 查看注册表摘要（在用 / 共享 / 验证 / 规划 / 历史）
 *   node scripts/domains.mjs check   # 校验代码与配置是否和注册表一致
 *
 * 严格口径（2026-11-14 收紧）：
 *   - 注册表只允许出现 xls 表内域名（mixm.top / laal.top）的主机；
 *   - recordType / value 必须为 null——表内这三列为空，任何取值都是推测；
 *   - 功能路径不得出现表外域名与拼写域。
 *
 * 校验目标（防止 2026-11-13 的 `cloud.mix.top` 少一个 m 事故复发）：
 *   1. api-base.json 的 apiBase 与注册表一致（2026-11-14 起为 api.mixm.top）；
 *   2. Nginx server_name：www / api / 裸域 mixm.top 必须存在（cloud 已于 2026-11-15 退役，不再校验）；
 *   3. .env.example 的支付回调指向注册表 apiBase（api.mixm.top）；
 *   4. 功能路径内不出现禁止字符串（拼写域 / 表外域 / laal.top）；
 *   5. 规划主机不与在用/共享/验证记录重名；
 *   6. 每条记录都属于表内 zone，且未编造记录类型与记录值。
 *
 * 说明：`planned` 里的主机是 xls 命名模板，尚未建真实解析，只登记不阻断。
 * ----------------------------------------------------------------------------
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_FILE = join(ROOT, 'deploy', 'domains.json');

/** 读取注册表；缺失即视为阻塞（注册表是本轮域名适配的单一真源） */
function loadRegistry() {
  if (!existsSync(REGISTRY_FILE)) {
    console.error('✗ 缺少 deploy/domains.json，先运行 2026-11-14/dns-adaptation/work/build_registry_strict.mjs');
    process.exit(1);
  }
  return JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
}

/** 读取仓库内文件；不存在返回 null（历史文件缺失只告警不阻断） */
function readMaybe(rel) {
  const abs = join(ROOT, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/** show：输出注册表分组摘要 */
function show(reg) {
  console.info(`主域：${reg.primaryZone}`);
  console.info(`数据源：${reg.source.file}（${reg.source.sheets.join(' / ')}）`);
  console.info(`API 基址：${reg.apiBase}`);
  console.info(`\n在用（${reg.active.length}）`);
  for (const r of reg.active) console.info(`  · ${r.fqdn} — ${r.role}（TTL ${r.ttl}，记录类型/值：空）`);
  console.info(`\n同根域其他项目（${reg.sharedZone.length}，未使用）`);
  for (const r of reg.sharedZone) console.info(`  · ${r.fqdn} — ${r.note}`);
  console.info(`\n平台验证（${reg.platformVerification.length}，未使用）`);
  for (const r of reg.platformVerification) console.info(`  · ${r.fqdn}`);
  console.info(`\n规划未接线（${reg.planned.length}）`);
  for (const r of reg.planned) console.info(`  · ${r.fqdn} [${r.role}] ${r.remark || ''}`.trimEnd());
  console.info(`\n历史域未使用（${reg.legacyUnused.length}）：${reg.legacyUnused[0]?.zone ?? '无'}`);
  console.info(`\n表内 CORS 来源：${reg.cors.tableDerived.join('、')}`);
  console.info(`表外待确认来源：${reg.cors.pendingOutsideTable.length} 条`);
  console.info(`禁止字符串：${reg.forbiddenStrings.map((f) => f.value).join('、')}`);
}

/** check：逐项校验功能路径与注册表一致 */
function check(reg) {
  const failures = [];
  const warnings = [];
  const fail = (msg) => failures.push(msg);

  // 1. 注册表自身：API 基址必须是 api.mixm.top
  if (reg.apiBase !== 'https://api.mixm.top/mixmapp/api/v1') {
    fail(`deploy/domains.json apiBase 不是生产基址：${reg.apiBase}`);
  }

  // 2. 移动壳 API 基址与注册表一致
  const apiBaseRaw = readMaybe('apps/mobile/api-base.json');
  if (apiBaseRaw === null) {
    warnings.push('缺少 apps/mobile/api-base.json');
  } else {
    const apiBase = JSON.parse(apiBaseRaw).apiBase;
    if (apiBase !== reg.apiBase) fail(`apps/mobile/api-base.json apiBase=${apiBase}，注册表=${reg.apiBase}`);
  }

  // 3. Nginx server_name：主入口、API 宿主与裸域 301 必须存在（cloud 已于 2026-11-15 退役，不再校验）
  const nginxTargets = [
    ['infra/nginx/www.mixm.top.conf', /server_name\s+www\.mixm\.top\s*;/],
    ['infra/nginx/api.mixm.top.conf', /server_name\s+api\.mixm\.top\s*;/],
    ['infra/nginx/mixm.top.conf', /server_name\s+mixm\.top\s*;/],
  ];
  for (const [rel, re] of nginxTargets) {
    const content = readMaybe(rel);
    if (content === null) fail(`缺少 ${rel}`);
    else if (!re.test(content)) fail(`${rel} 缺少预期的 server_name`);
  }

  // 4. .env.example 支付回调落在生产 API 入口
  const env = readMaybe('.env.example');
  if (env === null) {
    warnings.push('缺少 .env.example');
  } else {
    for (const tail of ['pay/notify/wechat', 'pay/notify/alipay']) {
      const expected = `${reg.apiBase}/${tail}`;
      if (!env.includes(expected)) fail(`.env.example 缺少回调地址 ${expected}`);
    }
  }

  // 5. 功能路径禁止拼写域 / 表外域 / laal.top（docs 属历史记录，不在扫描范围）
  const functionalFiles = [
    'apps/mobile/api-base.json',
    'infra/nginx/www.mixm.top.conf',
    'infra/nginx/api.mixm.top.conf',
    'infra/nginx/mixm.top.conf',
    'infra/nginx/img.mixm.top.conf',
    'infra/systemd/mixmapp-api.service',
    'cloudbase/functions/mixmapp-api-proxy/index.js',
    'cloudbase/functions/mixmapp-api-proxy/package.json',
    'deploy/catalog-verify.mjs',
    'deploy/atomic-release.sh',
    'deploy/catalog-import.sh',
    'scripts/build-h5.mjs',
    'scripts/serve-h5.mjs',
    'scripts/acceptance.mjs',
    'scripts/healthcheck.mjs',
    '.env.example',
  ];
  for (const rel of functionalFiles) {
    const content = readMaybe(rel);
    if (content === null) {
      warnings.push(`功能路径文件不存在，跳过：${rel}`);
      continue;
    }
    for (const { value } of reg.forbiddenStrings) {
      // 用词边界避免 cloud.mixm.top 被误判
      const re = new RegExp(`(^|[^a-z0-9.-])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9.-]|$)`, 'i');
      if (re.test(content)) fail(`${rel} 出现禁止字符串 ${value}`);
    }
  }

  // 6. 规划主机不得与在用/共享/验证记录重名
  const taken = new Set([
    ...reg.active.map((r) => r.fqdn),
    ...reg.sharedZone.map((r) => r.fqdn),
    ...reg.platformVerification.map((r) => r.fqdn),
  ]);
  for (const r of reg.planned) {
    if (taken.has(r.fqdn)) fail(`规划主机 ${r.fqdn} 与已启用记录重名`);
  }

  // 7. 严格口径：只允许表内 zone，且不得编造记录类型/值
  const zones = new Set(reg.source.sheets);
  const all = [
    ...reg.active,
    ...reg.sharedZone,
    ...reg.platformVerification,
    ...reg.planned,
    ...reg.legacyUnused,
  ];
  for (const r of all) {
    const zone = zones.has(r.zone) ? r.zone : [...zones].find((z) => r.fqdn === z || r.fqdn.endsWith(`.${z}`));
    if (!zone) fail(`记录 ${r.fqdn} 不属于表内 zone（${[...zones].join(' / ')}）`);
    if (r.recordType !== null || r.value !== null) {
      fail(`记录 ${r.fqdn} 的 recordType/value 必须为 null（xls 该列为空，不得推测）`);
    }
  }

  for (const w of warnings) console.warn(`⚠ ${w}`);
  if (failures.length > 0) {
    console.error(`✗ 域名校验失败，共 ${failures.length} 处：`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.info(
    `✓ 域名校验通过：在用 ${reg.active.length} + 共享 ${reg.sharedZone.length} + 验证 ${reg.platformVerification.length} + 规划 ${reg.planned.length} + 历史 ${reg.legacyUnused.length}`,
  );
}

const command = process.argv[2] ?? 'show';
const reg = loadRegistry();
if (command === 'show') show(reg);
else if (command === 'check') check(reg);
else {
  console.error(`未知命令：${command}（可用 show / check）`);
  process.exit(1);
}
