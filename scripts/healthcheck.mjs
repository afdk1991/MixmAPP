#!/usr/bin/env node
/**
 * 线上健康巡检：读取 /api/v1/healthz，校验关键依赖，输出可读报表。
 * 用法：node scripts/healthcheck.mjs https://cloud.mixm.top/mixmapp/api/v1
 * 退出码：0 健康 / 1 降级或不可达（可直接接到监控告警）
 */
const base = (process.argv[2] ?? process.env.HEALTH_BASE_URL ?? 'http://127.0.0.1:8080').replace(
  /\/$/,
  '',
);
const timeoutMs = Number(process.env.HEALTH_TIMEOUT_MS ?? 8000);

async function main() {
  const url = `${base}/api/v1/healthz`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const body = await res.json();
    const checks = body.checks ?? {};
    console.info(`目标：${url}`);
    console.info(`状态：${body.status}  HTTP ${res.status}  版本 ${body.version}`);
    console.info(`运行时长：${body.uptimeSec}s`);
    for (const [key, value] of Object.entries(checks)) {
      console.info(`  - ${key.padEnd(10)} ${value}`);
    }
    const critical = ['db'];
    const bad = critical.filter((k) => checks[k] && checks[k] !== 'ok' && checks[k] !== 'memory');
    if (body.status !== 'ok' || bad.length) {
      console.error(`✗ 健康检查未通过：${bad.join(', ') || 'status 非 ok'}`);
      process.exit(1);
    }
    console.info('✓ 健康检查通过');
  } catch (error) {
    clearTimeout(timer);
    console.error(`✗ 无法访问 ${url}：${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

main();
