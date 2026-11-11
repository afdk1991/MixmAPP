import type { FastifyInstance } from 'fastify';
import {
  bindEmailSchema,
  bindPhoneSchema,
  oauthLoginSchema,
  pushTokenSchema,
  updateProfileSchema,
} from '@mixmapp/contracts';
import { IdFactory } from '@mixmapp/ids';
import { parse } from '../lib/validate.js';
import { AppError } from '../lib/errors.js';

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me', { preHandler: app.requireAuth }, async (request) => ({
    data: await app.auth.getUser(request.userId as string),
  }));

  app.patch('/me', { preHandler: app.requireAuth }, async (request) => {
    const patch = parse(updateProfileSchema, request.body);
    return { data: await app.auth.updateProfile(request.userId as string, patch) };
  });

  app.post('/me/bind/phone', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(bindPhoneSchema, request.body);
    return {
      data: await app.auth.bindPhone(request.userId as string, body.phone, body.code),
    };
  });

  app.post('/me/bind/email', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(bindEmailSchema, request.body);
    return {
      data: await app.auth.bindEmail(request.userId as string, body.email, body.password),
    };
  });

  app.post('/me/bind/oauth', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(oauthLoginSchema, request.body);
    return {
      data: await app.auth.linkOAuth(request.userId as string, body.provider, body.code),
    };
  });

  app.post('/me/push-token', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(pushTokenSchema, request.body);
    const ids = new IdFactory({ workerId: app.cfg.ids.workerId });
    await app.store.pushTokens.upsert({
      id: ids.next().id,
      userId: request.userId as string,
      provider: body.provider,
      platform: body.platform,
      token: body.token,
      createdAt: new Date(),
    });
    return { data: { ok: true } };
  });

  app.post('/me/push-test', { preHandler: app.requireAuth }, async (request) => {
    const tokens = await app.store.pushTokens.listByUser(request.userId as string);
    if (!tokens.length) throw AppError.notFound('尚未注册推送 token');
    const result = await app.push.push({
      tokens: tokens.map((t) => t.token),
      title: 'MixmAPP',
      body: '这是一条来自 MixmAPP 的测试推送',
      data: { scene: 'push-test' },
    });
    return { data: result };
  });
}
