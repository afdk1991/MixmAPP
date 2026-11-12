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
import { createMapProvider, type MapProvider } from './adapters/map.js';
import { createStorageProvider, type StorageProvider } from './adapters/storage.js';
import { createPushProvider, type PushProvider } from './adapters/push.js';
import { createAiProvider, type AiProvider } from './adapters/ai.js';
import { AppError } from './lib/errors.js';
import { verifyAccessToken } from './lib/jwt.js';
import { authRoutes } from './routes/auth.js';
import { mallRoutes } from './routes/mall.js';
import { meRoutes } from './routes/me.js';
import { integrationRoutes } from './routes/integrations.js';
import { metaRoutes } from './routes/meta.js';

export type AppDeps = {
  config: Config;
  store: Store;
  sms?: SmsProvider;
  oauth?: Record<OAuthProviderName, OAuthProvider>;
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

  const origins = deps.config.corsOrigins;
  await app.register(cors, {
    origin: origins.includes('*') ? true : origins,
    credentials: true,
    maxAge: 86400,
  });

  app.decorate('cfg', deps.config);
  app.decorate('store', deps.store);
  app.decorate('sms', deps.sms ?? createSmsProvider(deps.config));
  app.decorate('oauth', deps.oauth ?? createOAuthProviders(deps.config));
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

  // 轻量固定窗口限流：单 IP 每分钟，健康检查放行
  const buckets = new Map<string, { windowStart: number; count: number }>();
  app.addHook('preHandler', async (request, reply) => {
    if (request.url === '/healthz' || request.url === '/readyz') return;
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

  app.get('/', async () => ({
    name: deps.config.appName,
    version: deps.config.version,
    docs: '/api/v1/meta',
    health: '/healthz',
  }));
  app.get('/healthz', async (_request, reply) => {
    const checks: Record<string, string> = { db: deps.store.driver };
    return reply.send({
      status: 'ok',
      version: deps.config.version,
      uptimeSec: Math.round(process.uptime()),
      checks,
      time: new Date().toISOString(),
    });
  });

  await app.register(
    async (scope) => {
      await metaRoutes(scope);
      await authRoutes(scope);
      await meRoutes(scope);
      await mallRoutes(scope);
      await integrationRoutes(scope);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
