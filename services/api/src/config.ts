import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIdStrategy, type IdStrategy } from '@mixmapp/ids';

const here = dirname(fileURLToPath(import.meta.url));

/** 从仓库根读取 .env（存在才读），已存在的进程环境变量优先。 */
export function loadDotEnv(): void {
  const candidates = [
    resolve(here, '../../../.env'),
    resolve(here, '../../.env'),
    resolve(process.cwd(), '.env'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
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
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

const str = (key: string, fallback = ''): string => (process.env[key] ?? fallback).trim();
const num = (key: string, fallback: number): number => {
  const raw = str(key);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (key: string, fallback = false): boolean => {
  const raw = str(key).toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes';
};

export type DbTarget = 'cloudbase' | 'local';

export type Config = {
  env: 'development' | 'test' | 'production';
  appName: string;
  version: string;
  host: string;
  port: number;
  publicBaseUrl: string;
  /**
   * 数据库落点开关：cloudbase = 权威库（CloudBase 云 PG），local = 云服务器本机 PG。
   * 用 DB_TARGET 切换，两个连接串可同时存在，切换不需要改 secrets。
   */
  dbTarget: DbTarget;
  databaseUrl: string;
  /** 实际取到连接串的环境变量名，便于确认「现在到底连的哪一个」。 */
  databaseUrlSource: string;
  /** 仅当显式设置 ALLOW_MEMORY_STORE=1 时才允许无 DATABASE_URL 启动，默认拒绝。 */
  allowMemoryStore: boolean;
  jwt: { secret: string; accessTtlSec: number; refreshTtlDays: number };
  ids: { strategy: IdStrategy; workerId: number };
  corsOrigins: string[];
  sms: {
    provider: 'console' | 'aliyun';
    echoCode: boolean;
    aliyun: { accessKeyId: string; accessKeySecret: string; signName: string; templateCode: string };
  };
  oauth: {
    wechat: { appId: string; appSecret: string };
    qq: { appId: string; appKey: string };
    github: { clientId: string; clientSecret: string };
    apple: { clientId: string };
  };
  /** 一键登录（本机号码认证）网关 */
  onekey: {
    provider: 'dev' | 'http';
    endpoint: string;
    appId: string;
    appSecret: string;
  };
  pay: {
    wechat: {
      appId: string;
      mchId: string;
      serialNo: string;
      privateKey: string;
      apiV3Key: string;
      platformPublicKey: string;
      notifyUrl: string;
    };
    alipay: { appId: string; privateKey: string; alipayPublicKey: string; notifyUrl: string };
  };
  map: { provider: 'dev' | 'amap'; amapKey: string };
  storage: {
    provider: 'dev' | 's3';
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicBaseUrl: string;
  };
  push: {
    provider: 'dev' | 'jpush' | 'fcm';
    jpush: { appKey: string; masterSecret: string };
    fcm: { serviceAccountJson: string; projectId: string };
  };
  ai: {
    provider: 'dev' | 'openai' | 'doubao';
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  rateLimit: { perMinute: number };
  /** 用户名合规词库：运营方按监管要求补充，逗号/空白分隔 */
  usernameDenylist: string[];
};

function pem(value: string): string {
  return value.replace(/\\n/g, '\n');
}

export function loadConfig(): Config {
  const env = (str('NODE_ENV', 'development') as Config['env']) ?? 'development';
  const jwtSecret = str('JWT_SECRET', env === 'production' ? '' : 'mixmapp-dev-secret-change-me-0123456789');
  if (!jwtSecret) {
    throw new Error('生产环境必须设置 JWT_SECRET（至少 32 字节随机串）');
  }
  // 数据库落点：默认 cloudbase（权威库），DB_TARGET=local 时切到云服务器本机 PG。
  const dbTarget: DbTarget = str('DB_TARGET', 'cloudbase') === 'local' ? 'local' : 'cloudbase';
  const cloudUrl = str('DATABASE_URL_CLOUDBASE');
  const localUrl = str('DATABASE_URL_LOCAL');
  const genericUrl = str('DATABASE_URL');
  const primary = dbTarget === 'cloudbase' ? cloudUrl : localUrl;
  const databaseUrl = primary || genericUrl;
  const databaseUrlSource = primary
    ? dbTarget === 'cloudbase'
      ? 'DATABASE_URL_CLOUDBASE'
      : 'DATABASE_URL_LOCAL'
    : 'DATABASE_URL';
  return {
    env,
    appName: str('APP_NAME', 'MixmAPP'),
    version: str('APP_VERSION', '0.0.0-preview'),
    host: str('HOST', '0.0.0.0'),
    port: num('PORT', 8080),
    publicBaseUrl: str('PUBLIC_BASE_URL', 'http://localhost:8080'),
    dbTarget,
    databaseUrl,
    databaseUrlSource,
    allowMemoryStore: bool('ALLOW_MEMORY_STORE'),
    jwt: {
      secret: jwtSecret,
      accessTtlSec: num('JWT_ACCESS_TTL_SEC', 900),
      refreshTtlDays: num('JWT_REFRESH_TTL_DAYS', 30),
    },
    ids: {
      strategy: parseIdStrategy(str('ID_STRATEGY'), 'snowflake'),
      workerId: num('SNOWFLAKE_WORKER_ID', 0),
    },
    corsOrigins: str('CORS_ORIGINS', '*')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    sms: {
      provider: str('SMS_PROVIDER', 'console') === 'aliyun' ? 'aliyun' : 'console',
      echoCode: bool('DEV_ECHO_SMS_CODE', env !== 'production'),
      aliyun: {
        accessKeyId: str('ALIYUN_SMS_ACCESS_KEY_ID'),
        accessKeySecret: str('ALIYUN_SMS_ACCESS_KEY_SECRET'),
        signName: str('ALIYUN_SMS_SIGN_NAME', 'MixmAPP'),
        templateCode: str('ALIYUN_SMS_TEMPLATE_CODE'),
      },
    },
    oauth: {
      wechat: { appId: str('OAUTH_WECHAT_APP_ID'), appSecret: str('OAUTH_WECHAT_APP_SECRET') },
      qq: { appId: str('OAUTH_QQ_APP_ID'), appKey: str('OAUTH_QQ_APP_KEY') },
      github: {
        clientId: str('OAUTH_GITHUB_CLIENT_ID'),
        clientSecret: str('OAUTH_GITHUB_CLIENT_SECRET'),
      },
      apple: { clientId: str('OAUTH_APPLE_CLIENT_ID') },
    },
    onekey: {
      provider: str('ONEKEY_PROVIDER', 'dev') === 'http' ? 'http' : 'dev',
      endpoint: str('ONEKEY_ENDPOINT'),
      appId: str('ONEKEY_APP_ID'),
      appSecret: str('ONEKEY_APP_SECRET'),
    },
    pay: {
      wechat: {
        appId: str('PAY_WECHAT_APP_ID'),
        mchId: str('PAY_WECHAT_MCH_ID'),
        serialNo: str('PAY_WECHAT_SERIAL_NO'),
        privateKey: pem(str('PAY_WECHAT_PRIVATE_KEY')),
        apiV3Key: str('PAY_WECHAT_API_V3_KEY'),
        platformPublicKey: pem(str('PAY_WECHAT_PLATFORM_PUBLIC_KEY')),
        notifyUrl: str('PAY_WECHAT_NOTIFY_URL'),
      },
      alipay: {
        appId: str('PAY_ALIPAY_APP_ID'),
        privateKey: pem(str('PAY_ALIPAY_PRIVATE_KEY')),
        alipayPublicKey: pem(str('PAY_ALIPAY_PUBLIC_KEY')),
        notifyUrl: str('PAY_ALIPAY_NOTIFY_URL'),
      },
    },
    map: {
      provider: str('MAP_PROVIDER', 'dev') === 'amap' ? 'amap' : 'dev',
      amapKey: str('AMAP_KEY'),
    },
    storage: {
      provider: str('STORAGE_PROVIDER', 'dev') === 's3' ? 's3' : 'dev',
      endpoint: str('S3_ENDPOINT', 'https://s3.amazonaws.com'),
      region: str('S3_REGION', 'auto'),
      bucket: str('S3_BUCKET'),
      accessKeyId: str('S3_ACCESS_KEY_ID'),
      secretAccessKey: str('S3_SECRET_ACCESS_KEY'),
      publicBaseUrl: str('S3_PUBLIC_BASE_URL'),
    },
    push: {
      provider: (str('PUSH_PROVIDER', 'dev') as Config['push']['provider']) || 'dev',
      jpush: { appKey: str('JPUSH_APP_KEY'), masterSecret: str('JPUSH_MASTER_SECRET') },
      fcm: {
        serviceAccountJson: str('FCM_SERVICE_ACCOUNT_JSON'),
        projectId: str('FCM_PROJECT_ID'),
      },
    },
    ai: {
      provider: (str('AI_PROVIDER', 'dev') as Config['ai']['provider']) || 'dev',
      baseUrl: str('AI_BASE_URL', 'https://ark.cn-beijing.volces.com/api/v3'),
      apiKey: str('AI_API_KEY'),
      model: str('AI_MODEL', 'doubao-pro-32k'),
    },
    rateLimit: { perMinute: num('RATE_LIMIT_PER_MINUTE', 60) },
    usernameDenylist: str('USERNAME_DENYLIST')
      .split(/[,，、\s]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

/** 健康检查展示用：只给出连接串里的 host:port，绝不带账号密码。 */
export function dbHostOf(url: string): string {
  if (!url) return 'none';
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}`;
  } catch {
    return 'unparsable';
  }
}

/** 给健康检查用的能力快照，绝不外泄密钥。 */
export function capabilitySnapshot(config: Config): Record<string, string> {
  return {
    sms: config.sms.provider,
    wechatOauth: config.oauth.wechat.appId ? 'on' : 'off',
    qqOauth: config.oauth.qq.appId ? 'on' : 'off',
    githubOauth: config.oauth.github.clientId ? 'on' : 'off',
    appleOauth: config.oauth.apple.clientId ? 'on' : 'off',
    onekey: config.onekey.provider,
    wechatPay: config.pay.wechat.mchId ? 'on' : 'off',
    alipay: config.pay.alipay.appId ? 'on' : 'off',
    map: config.map.provider,
    storage: config.storage.provider,
    push: config.push.provider,
    ai: config.ai.provider,
  };
}

export function projectRoot(): string {
  return resolve(here, '../../..');
}

/** 迁移 SQL 目录：兼容仓库内运行、dist 运行与线上 release 布局。 */
export function sqlDir(): string {
  const candidates = [
    process.env.SQL_DIR?.trim(),
    join(projectRoot(), 'infra', 'sql'),
    resolve(here, '..', 'infra', 'sql'),
    resolve(process.cwd(), 'infra', 'sql'),
  ].filter((item): item is string => Boolean(item));
  const found = candidates.find((dir) => existsSync(dir));
  return found ?? candidates[1] ?? join(projectRoot(), 'infra', 'sql');
}
