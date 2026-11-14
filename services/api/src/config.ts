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
/**
 * 壳与本地调试源恒定并入 CORS 白名单：
 * - Android/iOS WebView 壳从 https://localhost、capacitor://localhost 加载本地 H5；
 * - 本地 H5 调试 dev server 走 http://localhost / 127.0.0.1（含 5173 端口）。
 * 这些源不依赖环境变量配置，避免线上漏配导致壳内全站离线。
 */
const BUILTIN_CORS_ORIGINS = [
  'https://localhost',
  'capacitor://localhost',
  'http://localhost',
  'http://127.0.0.1',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const bool = (key: string, fallback = false): boolean => {
  const raw = str(key).toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes';
};

export type DbTarget = 'cloudbase' | 'server';

export type Config = {
  env: 'development' | 'test' | 'production';
  appName: string;
  version: string;
  host: string;
  port: number;
  publicBaseUrl: string;
  /**
   * 数据库落点：cloudbase = 权威库（CloudBase 云 PG），server = 云服务器自建 PG。
   * 旧值 local 会被当成 server 处理，避免线上 env 立刻失效。
   */
  dbTarget: DbTarget;
  databaseUrl: string;
  /** 实际取到连接串的环境变量名，便于确认「现在到底连的哪一个」。 */
  databaseUrlSource: string;
  /** 两套库的连接串（可同时存在），后台切换时从这里取。 */
  dbUrls: { cloudbase: string; server: string };
  /**
   * CloudBase PG 的 HTTP 网关（线上默认落点）：没有 TCP 连接串时用
   * `CLOUDBASE_PG_GATEWAY` + `CLOUDBASE_PG_API_KEY` 调 public.mix_exec SQL 桥。
   */
  pgGateway: { url: string; apiKey: string; schema: string };
  /** 管理接口令牌；未设置时 /admin/* 一律 404，不暴露管理面。 */
  adminToken: string;
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
    provider: 'dev' | 's3' | 'local';
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicBaseUrl: string;
    /** 本地磁盘存储根目录（provider=local 时生效） */
    localDir: string;
    /** 前端可访问的 API 前缀，用于拼上传地址 */
    apiBase: string;
    /** 本地上传地址的签名密钥，默认复用 JWT_SECRET */
    signSecret: string;
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
  /**
   * 内嵌只读商品目录源（随 API 一起发布的 catalog.json 快照）。
   * auto：DB 里没有真实目录商品时由该源接管商城公开读；off：禁用；force：强制启用。
   * 测试环境默认 off，保证 DB 路径既有测试可预测、且不加载 35MB 文件。
   */
  mall: {
    catalogSource: {
      mode: 'auto' | 'off' | 'force';
      /** MALL_CATALOG_FILE：覆盖默认 catalog.json 路径（相对 cwd 或绝对路径） */
      file: string;
    };
  };
  /** 待支付订单超时分钟数：超过就取消并归还库存（0 表示关闭自动取消） */
  orderTtlMinutes: number;
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
  // 数据库落点：默认 server（云服务器自建 PG，项目唯一权威库）。
  // DB_TARGET=cloudbase 时切到 CloudBase 云 PG（仅作为可选备援保留）。
  // 兼容旧值 local（等价于 server），避免线上 env 立刻失效。
  const rawTarget = str('DB_TARGET', 'server');
  const dbTarget: DbTarget = rawTarget === 'server' || rawTarget === 'local' ? 'server' : 'cloudbase';
  const cloudUrl = str('DATABASE_URL_CLOUDBASE');
  const serverUrl = str('DATABASE_URL_LOCAL') || str('DATABASE_URL_SERVER');
  const genericUrl = str('DATABASE_URL');
  const primary = dbTarget === 'cloudbase' ? cloudUrl : serverUrl;
  const databaseUrl = primary || genericUrl;
  const databaseUrlSource = primary
    ? dbTarget === 'cloudbase'
      ? 'DATABASE_URL_CLOUDBASE'
      : str('DATABASE_URL_LOCAL')
        ? 'DATABASE_URL_LOCAL'
        : 'DATABASE_URL_SERVER'
    : 'DATABASE_URL';
  return {
    env,
    appName: str('APP_NAME', 'MixmAPP'),
    version: str('APP_VERSION', '0.0.0'),
    host: str('HOST', '0.0.0.0'),
    port: num('PORT', 8080),
    publicBaseUrl: str('PUBLIC_BASE_URL', 'http://localhost:8080'),
    dbTarget,
    databaseUrl,
    databaseUrlSource,
    dbUrls: { cloudbase: cloudUrl, server: serverUrl },
    pgGateway: {
      url: str('CLOUDBASE_PG_GATEWAY'),
      apiKey: str('CLOUDBASE_PG_API_KEY'),
      schema: str('CLOUDBASE_PG_SCHEMA') || 'mixmapp',
    },
    adminToken: str('ADMIN_TOKEN'),
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
    corsOrigins: [
      ...new Set([
        ...str('CORS_ORIGINS', '*')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        ...BUILTIN_CORS_ORIGINS,
      ]),
    ],
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
      provider: (() => {
        const raw = str('STORAGE_PROVIDER', 'local');
        return raw === 's3' || raw === 'dev' ? raw : 'local';
      })() as Config['storage']['provider'],
      endpoint: str('S3_ENDPOINT', 'https://s3.amazonaws.com'),
      region: str('S3_REGION', 'auto'),
      bucket: str('S3_BUCKET'),
      accessKeyId: str('S3_ACCESS_KEY_ID'),
      secretAccessKey: str('S3_SECRET_ACCESS_KEY'),
      publicBaseUrl: str('S3_PUBLIC_BASE_URL'),
      localDir: str('STORAGE_DIR', env === 'production' ? '/var/lib/mixmapp/storage' : './storage'),
      apiBase: str('STORAGE_API_BASE', '/mixmapp/api/v1'),
      signSecret: str('STORAGE_SIGN_SECRET', jwtSecret),
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
    mall: {
      catalogSource: {
        mode: ((): 'auto' | 'off' | 'force' => {
          const raw = str('MALL_CATALOG_SOURCE', env === 'test' ? 'off' : 'auto').toLowerCase();
          if (raw === 'force') return 'force';
          if (raw === 'off') return 'off';
          return 'auto';
        })(),
        file: str('MALL_CATALOG_FILE'),
      },
    },
    orderTtlMinutes: num('ORDER_TTL_MINUTES', 30),
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
