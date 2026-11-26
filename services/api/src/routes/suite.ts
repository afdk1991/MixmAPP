import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  suiteActionInputSchema,
  suiteBoardInputSchema,
  suiteBoardPatchSchema,
  suiteEventStatusSchema,
  suiteInteractionInputSchema,
  suiteInteractionKindSchema,
  suiteProgressInputSchema,
} from '@mixmapp/contracts';
import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { parse } from '../lib/validate.js';

/**
 * 业务套件路由。
 *
 * 分层：
 * - 目录 / 领域元信息：公开读（套件中心要在未登录时也能完整展示）。
 * - 领域动态条目与统计：公开读但只对登录用户返回数据（个人台账必须鉴权）。
 * - 交互、进度、看板、台账事件：全部要求登录态。
 *
 * 速率限制沿用 app.ts 的全局固定窗口；本文件的写操作另受 zod 入参校验约束。
 */
export async function suiteRoutes(app: FastifyInstance): Promise<void> {
  /**
   * 可选鉴权：带了合法 Bearer 就解析出用户，没带或无效就当游客。
   * 只用于「登录后有更多内容」的读接口，不用于任何写接口。
   */
  const optionalUserId = async (request: FastifyRequest): Promise<string | null> => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try {
      const claims = await verifyAccessToken(app.cfg, header.slice(7).trim());
      return claims.sub;
    } catch {
      return null;
    }
  };

  /* ---------------- 目录 ---------------- */

  app.get('/suite/domains', async () => ({ data: app.suite.listDomains() }));

  app.get<{ Params: { domainId: string } }>('/suite/domains/:domainId', async (request) => ({
    data: app.suite.domainMeta(request.params.domainId),
  }));

  /* ---------------- 领域动态能力 ---------------- */

  app.get<{ Params: { domainId: string } }>('/suite/domains/:domainId/items', async (request) => {
    const userId = await optionalUserId(request);
    return { data: await app.suite.domainItems(request.params.domainId, userId) };
  });

  app.get<{ Params: { domainId: string } }>('/suite/domains/:domainId/stats', async (request) => {
    const userId = await optionalUserId(request);
    return { data: await app.suite.domainStats(request.params.domainId, userId) };
  });

  app.post<{ Params: { domainId: string } }>(
    '/suite/domains/:domainId/actions',
    { preHandler: app.requireAuth },
    async (request) => {
      const body = parse(suiteActionInputSchema, request.body);
      return {
        data: await app.suite.domainAct(request.params.domainId, body, request.userId as string),
      };
    },
  );

  /* ---------------- 交互 ---------------- */

  app.get<{
    Querystring: { domainId?: string; entryId?: string; kind?: string; limit?: string; offset?: string };
  }>('/suite/interactions', async (request) => {
    const { domainId, entryId } = request.query;
    if (!domainId || !entryId) {
      throw AppError.validation('需要 domainId 与 entryId 两个查询参数');
    }
    const kindRaw = request.query.kind;
    const kind = kindRaw ? parse(suiteInteractionKindSchema, kindRaw) : undefined;
    const limitRaw = Number(request.query.limit);
    const offsetRaw = Number(request.query.offset);
    const userId = await optionalUserId(request);
    return {
      data: await app.suite.listInteractions(domainId, entryId, userId, {
        ...(kind ? { kind } : {}),
        ...(Number.isFinite(limitRaw) && limitRaw > 0 ? { limit: Math.floor(limitRaw) } : {}),
        ...(Number.isFinite(offsetRaw) && offsetRaw > 0 ? { offset: Math.floor(offsetRaw) } : {}),
      }),
    };
  });

  app.post('/suite/interactions', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(suiteInteractionInputSchema, request.body);
    return { data: await app.suite.addInteraction(body, request.userId as string) };
  });

  app.post('/suite/interactions/toggle', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(suiteInteractionInputSchema, request.body);
    if (body.kind !== 'like' && body.kind !== 'save') {
      throw AppError.validation('切换接口只支持点赞与收藏');
    }
    return {
      data: await app.suite.toggleInteraction(
        body.domainId,
        body.entryId,
        body.kind,
        request.userId as string,
      ),
    };
  });

  app.delete<{ Params: { id: string } }>(
    '/suite/interactions/:id',
    { preHandler: app.requireAuth },
    async (request) => {
      const removed = await app.suite.removeInteraction(request.params.id, request.userId as string);
      return { data: { removed } };
    },
  );

  /* ---------------- 进度 ---------------- */

  app.get<{ Querystring: { domainId?: string; status?: string } }>(
    '/suite/progress',
    { preHandler: app.requireAuth },
    async (request) => {
      const statusRaw = request.query.status;
      const status = statusRaw ? parse(suiteProgressInputSchema.shape.status, statusRaw) : undefined;
      return {
        data: await app.suite.listProgress(request.userId as string, {
          ...(request.query.domainId ? { domainId: request.query.domainId } : {}),
          ...(status ? { status } : {}),
        }),
      };
    },
  );

  app.put('/suite/progress', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(suiteProgressInputSchema, request.body);
    return { data: await app.suite.upsertProgress(body, request.userId as string) };
  });

  /* ---------------- 看板 ---------------- */

  app.get<{ Querystring: { domainId?: string; stage?: string } }>(
    '/suite/boards',
    { preHandler: app.requireAuth },
    async (request) => ({
      data: await app.suite.listBoards(request.userId as string, {
        ...(request.query.domainId ? { domainId: request.query.domainId } : {}),
        ...(request.query.stage ? { stage: request.query.stage } : {}),
      }),
    }),
  );

  app.post('/suite/boards', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(suiteBoardInputSchema, request.body);
    return { data: await app.suite.createBoard(body, request.userId as string) };
  });

  app.patch<{ Params: { id: string } }>(
    '/suite/boards/:id',
    { preHandler: app.requireAuth },
    async (request) => {
      const body = parse(suiteBoardPatchSchema, request.body);
      const updated = await app.suite.updateBoard(request.params.id, request.userId as string, body);
      if (!updated) throw AppError.notFound('条目不存在或不属于你');
      return { data: updated };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/suite/boards/:id',
    { preHandler: app.requireAuth },
    async (request) => {
      const removed = await app.suite.removeBoard(request.params.id, request.userId as string);
      return { data: { removed } };
    },
  );

  /* ---------------- 台账事件 ---------------- */

  app.get<{ Querystring: { domainId?: string; kind?: string; status?: string } }>(
    '/suite/events',
    { preHandler: app.requireAuth },
    async (request) => {
      const statusRaw = request.query.status;
      const status = statusRaw ? parse(suiteEventStatusSchema, statusRaw) : undefined;
      return {
        data: await app.suite.listEvents(request.userId as string, {
          ...(request.query.domainId ? { domainId: request.query.domainId } : {}),
          ...(request.query.kind ? { kind: request.query.kind } : {}),
          ...(status ? { status } : {}),
        }),
      };
    },
  );

  app.post('/suite/events', { preHandler: app.requireAuth }, async (request) => {
    const body = request.body as {
      domainId?: string;
      kind?: string;
      subject?: string;
      amountFen?: number;
      status?: string;
      outTradeNo?: string;
      payload?: Record<string, unknown>;
    };
    if (!body.domainId || !body.kind || !body.subject) {
      throw AppError.validation('需要 domainId、kind 与 subject');
    }
    const status = body.status ? parse(suiteEventStatusSchema, body.status) : undefined;
    return {
      data: await app.suite.createEvent(
        {
          domainId: body.domainId,
          kind: body.kind,
          subject: body.subject,
          ...(typeof body.amountFen === 'number' ? { amountFen: body.amountFen } : {}),
          ...(status ? { status } : {}),
          ...(body.outTradeNo ? { outTradeNo: body.outTradeNo } : {}),
          ...(body.payload ? { payload: body.payload } : {}),
        },
        request.userId as string,
      ),
    };
  });

  app.patch<{ Params: { id: string } }>(
    '/suite/events/:id',
    { preHandler: app.requireAuth },
    async (request) => {
      const body = request.body as { status?: string };
      if (!body.status) throw AppError.validation('需要 status');
      const status = parse(suiteEventStatusSchema, body.status);
      const updated = await app.suite.updateEventStatus(
        request.params.id,
        status,
        request.userId as string,
      );
      if (!updated) throw AppError.notFound('事件不存在或不属于你');
      return { data: updated };
    },
  );
}
