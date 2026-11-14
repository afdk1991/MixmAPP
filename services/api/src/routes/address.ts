import type { FastifyInstance } from 'fastify';
import { addressCheckSchema, addressCreateSchema, addressUpdateSchema } from '@mixmapp/contracts';
import { parse } from '../lib/validate.js';

/**
 * 结算必填项路由（0014 / 0015）：
 * - 地址簿增删改查、设默认；
 * - 下单前可达性校验（源站口径，不可达直接返回原因）；
 * - 配送方式与按方式给出的可选时间段。
 * 全部需要登录：地址簿是账号私有数据。
 */
export async function addressRoutes(app: FastifyInstance): Promise<void> {
  // 配送方式与时间段：公开只读，结算页进入时即可拉取
  app.get('/mall/delivery-options', async () => ({ data: app.address.deliveryOptions() }));

  app.get('/mall/addresses', { preHandler: app.requireAuth }, async (request) => ({
    data: await app.address.list(request.userId as string),
  }));

  app.post('/mall/addresses', { preHandler: app.requireAuth }, async (request, reply) => {
    const body = parse(addressCreateSchema, request.body);
    const address = await app.address.create(request.userId as string, body);
    return reply.status(201).send({ data: address });
  });

  // 下单前预校验：结算页选完地址先调一次，不可达立即提示并禁用提交
  app.post('/mall/addresses/check', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(addressCheckSchema, request.body);
    return { data: app.address.check(body) };
  });

  app.patch('/mall/addresses/:id', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(addressUpdateSchema, request.body);
    return {
      data: await app.address.update(
        request.userId as string,
        (request.params as { id: string }).id,
        body,
      ),
    };
  });

  app.delete('/mall/addresses/:id', { preHandler: app.requireAuth }, async (request) => {
    await app.address.remove(request.userId as string, (request.params as { id: string }).id);
    return { data: { ok: true } };
  });

  app.post('/mall/addresses/:id/default', { preHandler: app.requireAuth }, async (request) => ({
    data: await app.address.setDefault(
      request.userId as string,
      (request.params as { id: string }).id,
    ),
  }));
}
