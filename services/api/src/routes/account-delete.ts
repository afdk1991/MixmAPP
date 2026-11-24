import type { FastifyInstance } from 'fastify';
import { deleteAccountSchema } from '@mixmapp/contracts';
import { z } from 'zod';
import { parse } from '../lib/validate.js';
import { AppError } from '../lib/errors.js';

const challengeRequestSchema = z.object({
  deviceId: z.string().min(1).max(128),
});

/**
 * 账号注销三接口，统一 /me 前缀、均需登录：
 *  GET  /me/account/deletion-options   可用校验方式
 *  POST /me/account/delete-challenge    仅 device 方式，换取一次性挑战票据
 *  POST /me/account/delete              分级校验通过后执行级联注销
 */
export async function accountDeletionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me/account/deletion-options', { preHandler: app.requireAuth }, async (request) => ({
    data: await app.deletion.options(request.userId as string),
  }));

  app.post(
    '/me/account/delete-challenge',
    { preHandler: app.requireAuth },
    async (request) => {
      const body = parse(challengeRequestSchema, request.body);
      return {
        data: await app.deletion.issueDeviceChallenge(request.userId as string, body.deviceId),
      };
    },
  );

  app.post('/me/account/delete', { preHandler: app.requireAuth }, async (request) => {
    // 先做逐字确认文案检查，保证固定错误码 DELETE_CONFIRM_REQUIRED 优先于 zod 通用校验失败。
    const raw = request.body as { confirm?: unknown };
    if (raw?.confirm !== '注销') {
      throw new AppError('DELETE_CONFIRM_REQUIRED', '请逐字输入「注销」确认账号删除');
    }
    const body = parse(deleteAccountSchema, request.body);
    return {
      data: await app.deletion.deleteAccount(request.userId as string, body),
    };
  });
}
