import type { Config } from '../config.js';

/**
 * 支付 / 短信 / 地图 / 推送四类外部服务的启动自检。
 *
 * 为什么要有这一层：
 * - 过去缺凭据时适配器会静默落到 console / dev 实现，接口「成功」但事实上没发短信、
 *   没推送、没扣款，属于假通道，线上无法通过调用结果发现问题；
 * - 现在把「选了什么通道、缺哪些环境变量」在启动时集中判定一次，并对运行时能力做门禁
 *   （dev/console 在生产直接不可用），自检结果同时暴露到管理端健康检查里。
 */

export type ProviderKey = 'sms' | 'pay' | 'map' | 'push';

export type ProviderIssue = {
  provider: ProviderKey;
  /** error=阻断项（strict 模式下启动失败）；warn=提示项（功能未开通但不影响其它模块） */
  level: 'error' | 'warn';
  /** 给运维看的中文说明，含修复方向 */
  message: string;
  /** 缺失的环境变量名（不含任何密钥值） */
  missing: string[];
};

export type ProviderStatus = 'ready' | 'disabled' | 'unconfigured';

export type ProviderReadiness = {
  env: Config['env'];
  /** 是否 strict 门禁（读 PROVIDER_SELF_CHECK；warn 时只报错不阻断启动） */
  strict: boolean;
  issues: ProviderIssue[];
  errors: ProviderIssue[];
  warnings: ProviderIssue[];
  status: Record<ProviderKey, ProviderStatus>;
};

const filled = (value: string | undefined | null): boolean => Boolean(value && value.trim());

/** 高德 Web 服务 Key 是 32 位十六进制；格式不对时请求必然被高德拒绝，提前拦下。 */
export const AMAP_KEY_PATTERN = /^[0-9a-f]{32}$/i;

function missingOf(pairs: Array<[string, string]>): string[] {
  return pairs.filter(([, value]) => !filled(value)).map(([key]) => key);
}

/** 微信支付 v3 必需 7 项；APIv3 Key 还必须是 32 字节（AEAD_AES_256_GCM 的密钥长度）。 */
function checkWechatPay(config: Config, issues: ProviderIssue[]): ProviderStatus {
  const pay = config.pay.wechat;
  const pairs: Array<[string, string]> = [
    ['PAY_WECHAT_APP_ID', pay.appId],
    ['PAY_WECHAT_MCH_ID', pay.mchId],
    ['PAY_WECHAT_SERIAL_NO', pay.serialNo],
    ['PAY_WECHAT_PRIVATE_KEY', pay.privateKey],
    ['PAY_WECHAT_API_V3_KEY', pay.apiV3Key],
    ['PAY_WECHAT_PLATFORM_PUBLIC_KEY', pay.platformPublicKey],
    ['PAY_WECHAT_NOTIFY_URL', pay.notifyUrl],
  ];
  const missing = missingOf(pairs);
  const configuredCount = pairs.length - missing.length;
  if (configuredCount === 0) return 'disabled';
  if (missing.length) {
    issues.push({
      provider: 'pay',
      level: 'error',
      message: `微信支付只配置了一部分，缺 ${missing.join('、')}；补齐前不会发起任何真实下单`,
      missing,
    });
    return 'unconfigured';
  }
  if (Buffer.byteLength(pay.apiV3Key, 'utf8') !== 32) {
    issues.push({
      provider: 'pay',
      level: 'error',
      message: 'PAY_WECHAT_API_V3_KEY 必须正好 32 字节（回调解密密钥）',
      missing: [],
    });
    return 'unconfigured';
  }
  return 'ready';
}

/** 支付宝必需 4 项；缺公钥时无法验签，必须视为未配置而不是「能下单但不验签」。 */
function checkAlipay(config: Config, issues: ProviderIssue[]): ProviderStatus {
  const pay = config.pay.alipay;
  const pairs: Array<[string, string]> = [
    ['PAY_ALIPAY_APP_ID', pay.appId],
    ['PAY_ALIPAY_PRIVATE_KEY', pay.privateKey],
    ['PAY_ALIPAY_PUBLIC_KEY', pay.alipayPublicKey],
    ['PAY_ALIPAY_NOTIFY_URL', pay.notifyUrl],
  ];
  const missing = missingOf(pairs);
  const configuredCount = pairs.length - missing.length;
  if (configuredCount === 0) return 'disabled';
  if (missing.length) {
    issues.push({
      provider: 'pay',
      level: 'error',
      message: `支付宝只配置了一部分，缺 ${missing.join('、')}；补齐前不会发起任何真实下单`,
      missing,
    });
    return 'unconfigured';
  }
  return 'ready';
}

function checkSms(config: Config, issues: ProviderIssue[]): ProviderStatus {
  if (config.sms.provider !== 'aliyun') {
    if (config.env === 'production') {
      issues.push({
        provider: 'sms',
        level: 'error',
        message:
          '生产环境禁止 console 短信通道（验证码只打日志，用户永远收不到）；请设置 SMS_PROVIDER=aliyun 并补齐阿里云短信凭据',
        missing: [
          'SMS_PROVIDER=aliyun',
          'ALIYUN_SMS_ACCESS_KEY_ID',
          'ALIYUN_SMS_ACCESS_KEY_SECRET',
          'ALIYUN_SMS_TEMPLATE_CODE',
        ],
      });
      return 'unconfigured';
    }
    return 'disabled';
  }
  const pairs: Array<[string, string]> = [
    ['ALIYUN_SMS_ACCESS_KEY_ID', config.sms.aliyun.accessKeyId],
    ['ALIYUN_SMS_ACCESS_KEY_SECRET', config.sms.aliyun.accessKeySecret],
    ['ALIYUN_SMS_SIGN_NAME', config.sms.aliyun.signName],
    ['ALIYUN_SMS_TEMPLATE_CODE', config.sms.aliyun.templateCode],
  ];
  const missing = missingOf(pairs);
  if (missing.length) {
    issues.push({
      provider: 'sms',
      level: 'error',
      message: `阿里云短信通道缺少 ${missing.join('、')}，发送验证码会直接失败`,
      missing,
    });
    return 'unconfigured';
  }
  return 'ready';
}

function checkMap(config: Config, issues: ProviderIssue[]): ProviderStatus {
  if (config.map.provider !== 'amap') {
    if (config.env === 'production') {
      issues.push({
        provider: 'map',
        level: 'error',
        message:
          '生产环境禁止 dev 地图通道（返回的是假坐标与假距离）；请设置 MAP_PROVIDER=amap 并配置 AMAP_KEY',
        missing: ['MAP_PROVIDER=amap', 'AMAP_KEY'],
      });
      return 'unconfigured';
    }
    return 'disabled';
  }
  if (!filled(config.map.amapKey)) {
    issues.push({
      provider: 'map',
      level: 'error',
      message: '已选择高德地图但缺少 AMAP_KEY，逆地理与路径规划会返回 PROVIDER_DISABLED',
      missing: ['AMAP_KEY'],
    });
    return 'unconfigured';
  }
  if (!AMAP_KEY_PATTERN.test(config.map.amapKey)) {
    issues.push({
      provider: 'map',
      level: 'error',
      message: 'AMAP_KEY 格式不正确：高德 Web 服务 Key 应为 32 位十六进制',
      missing: [],
    });
    return 'unconfigured';
  }
  return 'ready';
}

function checkPush(config: Config, issues: ProviderIssue[]): ProviderStatus {
  if (config.push.provider === 'dev') {
    if (config.env === 'production') {
      issues.push({
        provider: 'push',
        level: 'error',
        message:
          '生产环境禁止 dev 推送通道（只打日志、不会真的下发）；请设置 PUSH_PROVIDER=jpush 或 fcm 并补齐凭据',
        missing: ['PUSH_PROVIDER=jpush|fcm'],
      });
      return 'unconfigured';
    }
    return 'disabled';
  }
  if (config.push.provider === 'jpush') {
    const missing = missingOf([
      ['JPUSH_APP_KEY', config.push.jpush.appKey],
      ['JPUSH_MASTER_SECRET', config.push.jpush.masterSecret],
    ]);
    if (missing.length) {
      issues.push({
        provider: 'push',
        level: 'error',
        message: `极光推送缺少 ${missing.join('、')}，推送会被拒绝而不是静默成功`,
        missing,
      });
      return 'unconfigured';
    }
    return 'ready';
  }
  // FCM：服务账号 JSON 必须可解析且含 client_email / private_key，项目号可来自 JSON 或 env。
  const raw = config.push.fcm.serviceAccountJson;
  if (!filled(raw)) {
    issues.push({
      provider: 'push',
      level: 'error',
      message: 'FCM 缺少 FCM_SERVICE_ACCOUNT_JSON（服务账号 JSON），推送会被拒绝',
      missing: ['FCM_SERVICE_ACCOUNT_JSON'],
    });
    return 'unconfigured';
  }
  let account: { client_email?: string; private_key?: string; project_id?: string };
  try {
    account = JSON.parse(raw) as { client_email?: string; private_key?: string; project_id?: string };
  } catch {
    issues.push({
      provider: 'push',
      level: 'error',
      message: 'FCM_SERVICE_ACCOUNT_JSON 不是合法 JSON，无法换取访问令牌',
      missing: [],
    });
    return 'unconfigured';
  }
  const missing = [
    ...(account.client_email ? [] : ['FCM_SERVICE_ACCOUNT_JSON.client_email']),
    ...(account.private_key ? [] : ['FCM_SERVICE_ACCOUNT_JSON.private_key']),
    ...(filled(config.push.fcm.projectId) || account.project_id ? [] : ['FCM_PROJECT_ID']),
  ];
  if (missing.length) {
    issues.push({
      provider: 'push',
      level: 'error',
      message: `FCM 服务账号 JSON 字段不全：${missing.join('、')}`,
      missing,
    });
    return 'unconfigured';
  }
  return 'ready';
}

/**
 * 汇总四类服务的自检结果。
 * 返回结构与健康检查共用，调用方不需要再自行判断「有没有凭据」。
 */
export function checkProviders(config: Config): ProviderReadiness {
  const issues: ProviderIssue[] = [];
  const wechat = checkWechatPay(config, issues);
  const alipay = checkAlipay(config, issues);
  const pay: ProviderStatus =
    wechat === 'ready' || alipay === 'ready'
      ? 'ready'
      : wechat === 'unconfigured' || alipay === 'unconfigured'
        ? 'unconfigured'
        : 'disabled';
  // 两个支付渠道都没开：这只是「尚未开通」，不是配置错误，避免每次启动都当成故障。
  if (pay === 'disabled') {
    issues.push({
      provider: 'pay',
      level: 'warn',
      message: '未配置微信支付 / 支付宝商户凭据，/pay/orders 会明确返回 PROVIDER_DISABLED（不会产生扣款）',
      missing: [],
    });
  }
  const sms = checkSms(config, issues);
  const map = checkMap(config, issues);
  const push = checkPush(config, issues);
  // 注意：必须先跑完全部单项检查再汇总 errors，否则短信/地图/推送的问题不会进入 strict 判定。
  const errors = issues.filter((issue) => issue.level === 'error');
  return {
    env: config.env,
    strict: (process.env['PROVIDER_SELF_CHECK'] ?? '').toLowerCase() === 'strict',
    issues,
    errors,
    warnings: issues.filter((issue) => issue.level === 'warn'),
    status: { sms, pay, map, push },
  };
}

/**
 * 启动日志用的单行摘要（不含任何密钥值）：
 * 例：sms=ready pay=disabled map=unconfigured push=ready errors=1
 */
export function summarizeReadiness(readiness: ProviderReadiness): string {
  const parts = Object.entries(readiness.status).map(([key, value]) => `${key}=${value}`);
  return `${parts.join(' ')} errors=${readiness.errors.length}`;
}
