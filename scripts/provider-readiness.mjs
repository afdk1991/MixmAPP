#!/usr/bin/env node
/**
 * 支付 / 短信 / 地图 / 推送 生产就绪自检脚本（联调用）。
 *
 * 用法：
 *   node scripts/provider-readiness.mjs            # 打印自检表，始终退出 0
 *   node scripts/provider-readiness.mjs --strict   # 有阻断项时退出 1，可用于发版前置门禁
 *
 * 判定规则与 services/api/src/lib/provider-check.ts 保持一致（那份代码负责运行时门禁，
 * 本脚本负责「部署前提检 + 告诉运维还缺什么」，两边字段名必须同步维护）。
 * 只读取 .env 与环境变量，不发起任何外网请求，不打印任何密钥值。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** 读取仓库根目录 .env（进程环境变量优先），与 API 启动口径一致。 */
function loadEnv() {
  const env = { ...process.env };
  const file = resolve(ROOT, '.env');
  if (!existsSync(file)) return env;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined) env[key] = value;
  }
  return env;
}

const env = loadEnv();
const NODE_ENV = (env.NODE_ENV || 'development').trim();
const isProd = NODE_ENV === 'production';
const has = (key) => Boolean((env[key] || '').trim());
const value = (key) => (env[key] || '').trim();

const AMAP_KEY_PATTERN = /^[0-9a-f]{32}$/i;

function checkSms() {
  const provider = value('SMS_PROVIDER') === 'aliyun' ? 'aliyun' : 'console';
  const missing = [];
  if (provider !== 'aliyun' && isProd) {
    missing.push('SMS_PROVIDER=aliyun', 'ALIYUN_SMS_ACCESS_KEY_ID', 'ALIYUN_SMS_ACCESS_KEY_SECRET', 'ALIYUN_SMS_TEMPLATE_CODE');
  }
  if (provider === 'aliyun') {
    for (const key of ['ALIYUN_SMS_ACCESS_KEY_ID', 'ALIYUN_SMS_ACCESS_KEY_SECRET', 'ALIYUN_SMS_SIGN_NAME', 'ALIYUN_SMS_TEMPLATE_CODE']) {
      if (!has(key)) missing.push(key);
    }
  }
  return {
    provider,
    ready: provider === 'aliyun' && missing.length === 0,
    blocked: missing.length > 0,
    missing,
    action: [
      '1) 阿里云短信控制台申请签名 + 验证码模板（模板变量只放 ${code}）',
      '2) 配置 SMS_PROVIDER=aliyun、ALIYUN_SMS_ACCESS_KEY_ID/SECRET、ALIYUN_SMS_SIGN_NAME、ALIYUN_SMS_TEMPLATE_CODE',
      '3) 冒烟：POST /api/v1/auth/sms/code 后手机应收到短信，且响应里没有 devCode',
    ],
  };
}

function checkMap() {
  const provider = value('MAP_PROVIDER') === 'amap' ? 'amap' : 'dev';
  const missing = [];
  if (provider !== 'amap' && isProd) missing.push('MAP_PROVIDER=amap', 'AMAP_KEY');
  if (provider === 'amap') {
    if (!has('AMAP_KEY')) missing.push('AMAP_KEY');
    else if (!AMAP_KEY_PATTERN.test(value('AMAP_KEY'))) missing.push('AMAP_KEY（格式应为 32 位十六进制）');
  }
  return {
    provider,
    ready: provider === 'amap' && missing.length === 0,
    blocked: missing.length > 0,
    missing,
    action: [
      '1) 高德开放平台创建「Web 服务」Key（个人免费额度即可）',
      '2) 配置 MAP_PROVIDER=amap 与 AMAP_KEY',
      '3) 冒烟：POST /api/v1/map/regeo（需登录）返回真实地址而非「开发态坐标」',
    ],
  };
}

function checkPush() {
  const provider = ['jpush', 'fcm'].includes(value('PUSH_PROVIDER')) ? value('PUSH_PROVIDER') : 'dev';
  const missing = [];
  if (provider === 'dev' && isProd) missing.push('PUSH_PROVIDER=jpush|fcm');
  if (provider === 'jpush') {
    if (!has('JPUSH_APP_KEY')) missing.push('JPUSH_APP_KEY');
    if (!has('JPUSH_MASTER_SECRET')) missing.push('JPUSH_MASTER_SECRET');
  }
  if (provider === 'fcm') {
    if (!has('FCM_SERVICE_ACCOUNT_JSON')) missing.push('FCM_SERVICE_ACCOUNT_JSON');
    else {
      try {
        const account = JSON.parse(value('FCM_SERVICE_ACCOUNT_JSON'));
        if (!account.client_email) missing.push('FCM_SERVICE_ACCOUNT_JSON.client_email');
        if (!account.private_key) missing.push('FCM_SERVICE_ACCOUNT_JSON.private_key');
        if (!has('FCM_PROJECT_ID') && !account.project_id) missing.push('FCM_PROJECT_ID');
      } catch {
        missing.push('FCM_SERVICE_ACCOUNT_JSON（不是合法 JSON）');
      }
    }
  }
  return {
    provider,
    ready: provider !== 'dev' && missing.length === 0,
    blocked: missing.length > 0,
    missing,
    action: [
      '1) 极光：控制台创建应用，取 AppKey / Master Secret；FCM：下载服务账号 JSON',
      '2) 配置 PUSH_PROVIDER 与对应凭据（JSON 建议单行写入 env）',
      '3) 冒烟：登录后 POST /api/v1/me/push-token 注册 token，再 POST /api/v1/me/push-test 应收到通知；失效 token 会被自动清理',
    ],
  };
}

function checkPay() {
  const wechatKeys = [
    'PAY_WECHAT_APP_ID',
    'PAY_WECHAT_MCH_ID',
    'PAY_WECHAT_SERIAL_NO',
    'PAY_WECHAT_PRIVATE_KEY',
    'PAY_WECHAT_API_V3_KEY',
    'PAY_WECHAT_PLATFORM_PUBLIC_KEY',
    'PAY_WECHAT_NOTIFY_URL',
  ];
  const alipayKeys = ['PAY_ALIPAY_APP_ID', 'PAY_ALIPAY_PRIVATE_KEY', 'PAY_ALIPAY_PUBLIC_KEY', 'PAY_ALIPAY_NOTIFY_URL'];
  const wechatMissing = wechatKeys.filter((key) => !has(key));
  const alipayMissing = alipayKeys.filter((key) => !has(key));
  const wechatTouched = wechatMissing.length < wechatKeys.length;
  const alipayTouched = alipayMissing.length < alipayKeys.length;
  const missing = [];
  if (wechatTouched && wechatMissing.length) missing.push(...wechatMissing);
  if (alipayTouched && alipayMissing.length) missing.push(...alipayMissing);
  if (has('PAY_WECHAT_API_V3_KEY') && Buffer.byteLength(value('PAY_WECHAT_API_V3_KEY'), 'utf8') !== 32) {
    missing.push('PAY_WECHAT_API_V3_KEY（必须 32 字节）');
  }
  const ready = (wechatMissing.length === 0 && wechatTouched) || (alipayMissing.length === 0 && alipayTouched);
  return {
    provider: [wechatTouched ? 'wechat' : null, alipayTouched ? 'alipay' : null].filter(Boolean).join('+') || 'none',
    ready,
    blocked: missing.length > 0,
    missing,
    action: [
      '1) 微信：商户平台开通 APP 支付，下载 API 证书（商户私钥+证书序列号），设置 APIv3 密钥，配置平台证书公钥',
      '2) 支付宝：开放平台创建应用并签约 APP 支付，配置应用私钥与支付宝公钥',
      '3) 回调地址必须是公网 HTTPS：/api/v1/pay/notify/wechat 与 /api/v1/pay/notify/alipay',
      '4) 冒烟：POST /api/v1/pay/orders 返回 mode=live 且带 prepay/orderString；用最小金额真实支付一笔，确认回调后订单置 paid，重放回调不重复入账',
    ],
  };
}

const rows = [
  ['短信', checkSms()],
  ['支付', checkPay()],
  ['地图', checkMap()],
  ['推送', checkPush()],
];

console.info(`MixmAPP 外部服务自检（NODE_ENV=${NODE_ENV}）`);
console.info('='.repeat(64));
let blocked = 0;
for (const [name, result] of rows) {
  if (result.blocked) blocked += 1;
  const status = result.blocked ? '✗ 有阻断项' : result.ready ? '✓ 就绪' : '○ 未启用（非生产可用）';
  console.info(`\n[${name}] provider=${result.provider}  ${status}`);
  if (result.missing.length) {
    console.info(`  缺失：${result.missing.join('、')}`);
  }
  for (const line of result.action) console.info(`  - ${line}`);
}
console.info('\n' + '='.repeat(64));
if (!isProd) {
  console.info('提示：当前不是 production，dev/console 通道仅用于本地联调；生产会强制禁用这些通道。');
}
console.info(`阻断项：${blocked} 个${blocked ? '（生产环境这些能力会返回 PROVIDER_DISABLED，不会静默假成功）' : ''}`);
if (process.argv.includes('--strict') && blocked > 0) {
  console.error('严格模式：存在阻断项，退出码 1');
  process.exit(1);
}
