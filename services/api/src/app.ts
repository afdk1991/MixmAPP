import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Config } from './config.js';
import type { Store } from './db/types.js';
import { AuthService } from './modules/auth.js';
import { MallService } from './modules/mall.js';
import { PayService } from './modules/pay.js';
import { createSmsProvider, type SmsProvider } from './adapters/sms.js';
import { createOAuthProviders, type OAuthProvider, type OAuthProviderName } from './adapters/oauth.js';
import { createOneKeyProvider, type OneKeyProvider } from './adapters/onekey.js';
import { createMapProvider, type MapProvider } from './adapters/map.js';
import { createStorageProvider, type StorageProvider } from './adapters/storage.js';
import { createPushProvider, type PushProvider } from './adapters/push.js';
import { createAiProvider, type AiProvider } from './adapters/ai.js';
import { AppError } from './lib/errors.js';
import { verifyAccessToken } from './lib/jwt.js';
import { authRoutes } from './routes/auth.js';
import { oauthRoutes } from './routes/oauth.js';
import { mallRoutes } from './routes/mall.js';
import { adminRoutes } from './routes/admin.js';
import { mediaRoutes } from './routes/media.js';
import { meRoutes } from './routes/me.js';
import { integrationRoutes } from './routes/integrations.js';
import { metaRoutes } from './routes/meta.js';

export type AppDeps = {
  config: Config;
  store: Store;
  /** 有热切换能力时传入；仅内存模式启动时可不传 */
  dbSwitcher?: import('./db/switchable.js').StoreSwitcher;
  sms?: SmsProvider;
  oauth?: Record<OAuthProviderName, OAuthProvider>;
  onekey?: OneKeyProvider;
  map?: MapProvider;
  storage?: StorageProvider;
  push?: PushProvider;
  ai?: AiProvider;
  logger?: boolean;
};

/** 组装 Fastify 实例：路由、鉴权、限流、错误码统一在这里收口。 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? false,
    genReqId: () => randomUUID(),
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  // 本地上传通道：任意非 JSON 请求体按 Buffer 收，单文件上限 25MB（与 nginx client_max_body_size 对齐）。
  // 上传地址上的 content-type 由前端按文件类型给（image/png、text/plain 等），故用通配。
  app.addContentTypeParser(
    '*',
    { parseAs: 'buffer', bodyLimit: 25 * 1024 * 1024 },
    (_request, body, done) => done(null, body),
  );

  const origins = deps.config.corsOrigins;
  await app.register(cors, {
    origin: origins.includes('*') ? true : origins,
    credentials: true,
    maxAge: 86400,
  });

  app.decorate('cfg', deps.config);
  app.decorate('store', deps.store);
  if (deps.dbSwitcher) app.decorate('dbSwitcher', deps.dbSwitcher);
  app.decorate('sms', deps.sms ?? createSmsProvider(deps.config));
  app.decorate('oauth', deps.oauth ?? createOAuthProviders(deps.config));
  app.decorate('onekey', deps.onekey ?? createOneKeyProvider(deps.config));
  app.decorate('map', deps.map ?? createMapProvider(deps.config));
  app.decorate('storage', deps.storage ?? createStorageProvider(deps.config));
  app.decorate('push', deps.push ?? createPushProvider(deps.config));
  app.decorate('ai', deps.ai ?? createAiProvider(deps.config));

  app.decorate(
    'auth',
    new AuthService({
      config: deps.config,
      store: deps.store,
      sms: app.sms,
      oauth: app.oauth,
      onekey: app.onekey,
    }),
  );
  app.decorate('pay', new PayService(deps.config, deps.store));
  app.decorate('mall', new MallService(deps.config, deps.store));

  app.decorate('requireAuth', async (request, reply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw AppError.unauthorized();
    const claims = await verifyAccessToken(deps.config, header.slice(7).trim());
    request.userId = claims.sub;
    reply.header('x-account-no', claims.acc);
  });

  // 轻量固定窗口限流：单 IP 每分钟，健康检查与只读目录放行
  const buckets = new Map<string, { windowStart: number; count: number }>();
  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (path === '/api/v1/healthz' || path === '/api/v1/readyz') return;
    // 商品目录是 15k 量级的分页浏览，且每张封面图都算一次请求；
    // 只读 GET 若也计入 60/分，翻两屏就会被 429 掐断，等于商城不可用。
    if (
      request.method === 'GET' &&
      (path.startsWith('/api/v1/mall') || path.startsWith('/media/'))
    ) {
      return;
    }
    const now = Date.now();
    const entry = buckets.get(request.ip);
    if (!entry || now - entry.windowStart >= 60_000) {
      buckets.set(request.ip, { windowStart: now, count: 1 });
    } else {
      entry.count += 1;
      if (entry.count > deps.config.rateLimit.perMinute) {
        reply.header('retry-after', '60');
        throw new AppError('RATE_LIMITED', '请求过于频繁，请稍后再试');
      }
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      });
    }
    const status = (error as { statusCode?: number; message?: string }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({
        error: {
          code: 'BAD_REQUEST',
          message: (error as { message?: string }).message ?? '请求不合法',
          requestId: request.id,
        },
      });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'INTERNAL', message: '服务内部错误，请稍后重试', requestId: request.id },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `未找到路由 ${request.method} ${request.url}`, requestId: request.id },
    }),
  );

  // 健康检查只有一套：/api/v1/healthz（存活 + 能力快照）与 /api/v1/readyz（依赖就绪）。
  // 根路径不再另开一份同名路由，避免「探到的是另一套实现」这种假绿。
  app.get('/', async () => ({
    name: deps.config.appName,
    version: deps.config.version,
    docs: '/api/v1/meta',
    health: '/api/v1/healthz',
    ready: '/api/v1/readyz',
  }));

  // 本地磁盘存储的图片直出：仅 local provider 注册；s3/dev 走各自公网地址，不在此暴露目录。
  if (deps.config.storage.provider === 'local') {
    await app.register(mediaRoutes);
  }

  await app.register(
    async (scope) => {
      await metaRoutes(scope);
      await authRoutes(scope);
      await oauthRoutes(scope);
      await meRoutes(scope);
      await mallRoutes(scope);
      await integrationRoutes(scope);
      await adminRoutes(scope);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
