import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import type { SuiteDomainId } from '@mixmapp/contracts';
import type { Config } from './config.js';
import type { Store } from './db/types.js';
import { AuthService } from './modules/auth.js';
import { AccountDeletionService } from './modules/account-deletion.js';
import { RetentionService } from './modules/retention.js';
import { DeviceContextService } from './modules/device.js';
import { AddressService } from './modules/address.js';
import { MallService } from './modules/mall.js';
import { CatalogSource } from './modules/catalog-source.js';
import { PayService } from './modules/pay.js';
import { createSmsProvider, type SmsProvider } from './adapters/sms.js';
import { createOAuthProviders, type OAuthProvider, type OAuthProviderName } from './adapters/oauth.js';
import { ProviderRegistry, gatedProvider } from './modules/provider-registry.js';
import { AdminConsoleService } from './modules/admin-console.js';
import { SuiteService } from './modules/suite/service.js';
import type { SuiteDomainModule } from './modules/suite/domain.js';
import { SUITE_MODULES } from './modules/domains/index.js';
import { createOneKeyProvider, type OneKeyProvider } from './adapters/onekey.js';
import { createMapProvider, type MapProvider } from './adapters/map.js';
import { createStorageProvider, type StorageProvider } from './adapters/storage.js';
import { createPushProvider, type PushProvider } from './adapters/push.js';
import { createAiProvider, type AiProvider } from './adapters/ai.js';
import { AppError } from './lib/errors.js';
import { maskIp } from './lib/device-context.js';
import { verifyAccessToken } from './lib/jwt.js';
import { authRoutes } from './routes/auth.js';
import { oauthRoutes } from './routes/oauth.js';
import { mallRoutes } from './routes/mall.js';
import { homeRoutes } from './routes/home.js';
import { addressRoutes } from './routes/address.js';
import { adminRoutes } from './routes/admin.js';
import { adminConsoleRoutes } from './routes/admin-console.js';
import { mediaRoutes } from './routes/media.js';
import { meRoutes } from './routes/me.js';
import { accountDeletionRoutes } from './routes/account-delete.js';
import { deviceRoutes } from './routes/device.js';
import { integrationRoutes } from './routes/integrations.js';
import { metaRoutes } from './routes/meta.js';
import { suiteRoutes } from './routes/suite.js';

export type AppDeps = {
  config: Config;
  store: Store;
  /** 有热切换能力时传入；仅内存模式启动时可不传 */
  dbSwitcher?: import('./db/switchable.js').StoreSwitcher;
  sms?: SmsProvider;
  oauth?: Partial<Record<OAuthProviderName, OAuthProvider>>;
  /** 测试可注入自带定义/开关文件的注册表 */
  providerRegistry?: ProviderRegistry;
  onekey?: OneKeyProvider;
  map?: MapProvider;
  storage?: StorageProvider;
  push?: PushProvider;
  ai?: AiProvider;
  logger?: boolean;
};

/** 组装 Fastify 实例：路由、鉴权、限流、错误码统一在这里收口。 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const loggerOption = deps.logger ?? false;
  const app = Fastify({
    // 访问日志里的直连地址按契约 §6 脱敏；XFF 头不进日志，避免完整 IP 落盘。
    logger: loggerOption
      ? {
          serializers: {
            req: (req: FastifyRequest) => ({
              method: req.method,
              url: req.url,
              host: req.hostname,
              remoteAddress: req.ip ? maskIp(req.ip) : req.ip,
              remotePort: req.socket?.remotePort,
            }),
          },
        }
      : false,
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
  // 支付宝异步通知是 application/x-www-form-urlencoded：通配 * parser 会把它收成 Buffer，
  // /pay/notify/alipay 取不到 sign / out_trade_no，验签必然失败。这里补一个专用参数表解析。
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 1024 * 1024 },
    (_request, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  const origins = deps.config.corsOrigins;
  await app.register(cors, {
    origin: origins.includes('*') ? true : origins,
    credentials: true,
    maxAge: 86400,
  });

  app.decorate('cfg', deps.config);
  app.decorate('store', deps.store);
  // 内嵌只读商品目录源：随 API 分发的 catalog.json 快照，DB 无真实目录数据时接管商城公开读。
  const catalog = new CatalogSource(deps.config, deps.store);
  app.decorate('catalog', catalog);
  if (deps.dbSwitcher) app.decorate('dbSwitcher', deps.dbSwitcher);
  app.decorate('sms', deps.sms ?? createSmsProvider(deps.config));
  // 渠道注册表：92 条提供方来自 config/oauth-providers.json，状态与开关都由它推导。
  const registry = deps.providerRegistry ?? new ProviderRegistry({ config: deps.config });
  app.decorate('providers', registry);
  // 启动自检：缺 AppID/AppSecret 的渠道直接判未启用并给出缺失项，不等运行期报 500。
  const providerSummary = registry.summary();
  app.log.info(
    {
      total: providerSummary.total,
      byGroup: providerSummary.byGroup,
      byStatus: providerSummary.byStatus,
      ready: providerSummary.ready,
    },
    '第三方登录渠道注册表自检完成',
  );
  // 测试可只注入部分渠道，其余仍由配置表补全，避免因新增渠道导致测试桩不完整。
  // 通用适配器渠道按注册表组装；所有渠道都套一层运行时开关（热生效）。
  const builtinOauth: Record<string, OAuthProvider> = {
    ...createOAuthProviders(deps.config),
    ...registry.genericProviders(),
    ...deps.oauth,
  };
  const oauth: Record<string, OAuthProvider> = {};
  for (const [key, adapter] of Object.entries(builtinOauth)) {
    oauth[key] = registry.get(key) ? gatedProvider(registry, key, adapter) : adapter;
  }
  app.decorate('oauth', oauth);
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
  app.decorate('deviceContext', new DeviceContextService(deps.store));
  // 账号注销：分级校验 + 级联清除/脱敏；短信校验复用 AuthService 的 delete 用途验证码口径。
  app.decorate(
    'deletion',
    new AccountDeletionService({
      store: deps.store,
      verifySms: (phone, code) => app.auth.verifySmsCode(phone, 'delete', code),
    }),
  );
  // 个人数据留存清理：独立于订单超时扫描，由 index.ts 另起定时器驱动。
  app.decorate('retention', new RetentionService(deps.store, deps.config.retention));
  app.decorate('pay', new PayService(deps.config, deps.store));
  app.decorate('address', new AddressService(deps.config, deps.store));
  app.decorate('mall', new MallService(deps.config, deps.store, catalog));
  // 后台运营台：只读复用 mall 的运营位/推荐分类，其余全部走 Store.admin。
  app.decorate('adminConsole', new AdminConsoleService(deps.config, deps.store, app.mall));
  // 业务套件：13 个领域共用通用台账（交互 / 进度 / 看板 / 事件），
  // 领域特有逻辑由 SUITE_MODULES 里的领域模块提供。
  app.decorate(
    'suite',
    new SuiteService({
      config: deps.config,
      store: deps.store,
      modules: SUITE_MODULES as Map<SuiteDomainId, SuiteDomainModule>,
    }),
  );

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
    const path = request.url.split('?')[0] ?? '';
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
      await accountDeletionRoutes(scope);
      await deviceRoutes(scope);
      await mallRoutes(scope);
      await homeRoutes(scope);
      await addressRoutes(scope);
      await integrationRoutes(scope);
      await adminRoutes(scope);
      // 业务套件（13 个领域）：目录公开读，动态台账要求登录态。
      await suiteRoutes(scope);
      // 后台运营台独立子路由：与 /admin/* 同为 404 门禁，但认证走短期会话 Cookie。
      await adminConsoleRoutes(scope);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
