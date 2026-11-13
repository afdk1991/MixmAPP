import type { FastifyInstance } from 'fastify';
import {
  aiChatSchema,
  createPaymentSchema,
  presignSchema,
  reverseGeoSchema,
  routeSchema,
} from '@mixmapp/contracts';
import { z } from 'zod';
import { parse } from '../lib/validate.js';
import { AppError } from '../lib/errors.js';

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  // ---- 支付 ----
  app.post('/pay/orders', { preHandler: app.requireAuth }, async (request, reply) => {
    const body = parse(createPaymentSchema, request.body);
    const order = await app.pay.createOrder(request.userId as string, body);
    return reply.code(201).send({ data: order });
  });

  app.get('/pay/orders/:outTradeNo', { preHandler: app.requireAuth }, async (request) => {
    const params = parse(z.object({ outTradeNo: z.string().min(1) }), request.params);
    return { data: await app.pay.getOrder(request.userId as string, params.outTradeNo) };
  });

  // 微信支付回调：需要原文验签，单独作用域内保留 raw body
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_req, body, done) => done(null, body),
    );
    scope.post('/pay/notify/wechat', async (request, reply) => {
      try {
        const result = await app.pay.handleWechatNotify(
          request.headers as Record<string, string | string[] | undefined>,
          String(request.body ?? ''),
        );
        return reply.code(200).send({ code: 'SUCCESS', message: '成功', ...result });
      } catch (error) {
        const message = error instanceof AppError ? error.message : '处理失败';
        return reply.code(error instanceof AppError ? error.status : 500).send({
          code: 'FAIL',
          message,
        });
      }
    });
  });

  app.post('/pay/notify/alipay', async (request, reply) => {
    const form = request.body as Record<string, string>;
    try {
      const result = await app.pay.handleAlipayNotify(form);
      return reply.type('text/plain').send(result.status === 'paid' ? 'success' : 'fail');
    } catch (error) {
      const message = error instanceof AppError ? error.message : '处理失败';
      return reply.code(error instanceof AppError ? error.status : 500).type('text/plain').send('fail');
    }
  });

  // ---- 定位 / 导航 ----
  app.post('/map/regeo', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(reverseGeoSchema, request.body);
    return { data: await app.map.reverseGeo(body.longitude, body.latitude) };
  });

  app.post('/map/route', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(routeSchema, request.body);
    return { data: await app.map.route(body) };
  });

  // ---- 对象存储 ----
  app.post('/storage/presign', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(presignSchema, request.body);
    const key = `u/${request.userId}/${body.key}`;
    const upload = await app.storage.presignUpload(key, body.contentType, body.expiresIn);
    return { data: { ...upload, key, publicUrl: app.storage.publicUrl(key) } };
  });

  // ---- AI ----
  app.post('/ai/chat', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(aiChatSchema, request.body);
    return {
      data: await app.ai.chat({
        messages: body.messages,
        ...(body.model ? { model: body.model } : {}),
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
      }),
    };
  });
}
