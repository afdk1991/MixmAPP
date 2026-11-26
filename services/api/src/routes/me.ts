import type { FastifyInstance } from 'fastify';
import {
  bindEmailSchema,
  bindPhoneSchema,
  bindUsernameSchema,
  oauthLoginSchema,
  pushTokenSchema,
  updateProfileSchema,
} from '@mixmapp/contracts';
import { z } from 'zod';
import { parse } from '../lib/validate.js';
import { AppError } from '../lib/errors.js';
import { PushService } from '../modules/push.js';

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

  app.post('/me/bind/username', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(bindUsernameSchema, request.body);
    return {
      data: await app.auth.bindUsername(request.userId as string, body.username, body.password),
    };
  });

  app.post('/me/bind/oauth', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(oauthLoginSchema, request.body);
    // 渠道是否存在、是否可用由服务端注册表判定；这里不再维护第二份白名单。
    if (!app.providers.get(body.provider)) {
      throw new AppError('BAD_REQUEST', `不支持的登录渠道 ${body.provider}`);
    }
    return {
      data: await app.auth.linkOAuth(request.userId as string, body.provider, body.code),
    };
  });

  app.delete<{ Params: { provider: string } }>(
    '/me/bind/oauth/:provider',
    { preHandler: app.requireAuth },
    async (request) => {
      // 解绑按已存在的绑定关系处理：注册表渠道标识同样是普通字符串，
      // 不因某渠道后来被停用就解绑不了历史绑定。
      const provider = request.params.provider;
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(provider)) {
        throw new AppError('BAD_REQUEST', `不支持的登录渠道 ${provider}`);
      }
      return {
        data: await app.auth.unlinkOAuth(request.userId as string, provider),
      };
    },
  );

  app.post('/me/push-token', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(pushTokenSchema, request.body);
    const push = new PushService(app.cfg, app.store, app.push);
    return { data: await push.register(request.userId as string, body) };
  });

  // 退出登录 / 换机时注销 token：不做这一步，失效 token 会一直留到下次推送失败才被清理。
  app.delete('/me/push-token', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(z.object({ token: z.string().min(10).max(512) }), request.body);
    const push = new PushService(app.cfg, app.store, app.push);
    return { data: await push.unregister(request.userId as string, body.token) };
  });

  app.post('/me/push-test', { preHandler: app.requireAuth }, async (request) => {
    const push = new PushService(app.cfg, app.store, app.push);
    const result = await push.sendToUser(request.userId as string, {
      title: 'MixmAPP',
      body: '这是一条来自 MixmAPP 的测试推送',
      data: { scene: 'push-test' },
    });
    if (!result.total) throw AppError.notFound('尚未注册推送 token');
    return { data: result };
  });
}
