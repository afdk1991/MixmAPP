import type { FastifyInstance } from 'fastify';
import {
  cartAddSchema,
  cartUpdateSchema,
  orderCreateSchema,
  productQuerySchema,
} from '@mixmapp/contracts';
import { parse } from '../lib/validate.js';

/** 商城路由：商品公开读，购物车与订单需登录。 */
export async function mallRoutes(app: FastifyInstance): Promise<void> {
  app.get('/mall/categories', async () => ({
    data: await app.mall.listCategories(),
  }));

  app.get('/mall/products', async (request) => ({
    data: await app.mall.listProducts(parse(productQuerySchema, request.query ?? {})),
  }));

  app.get('/mall/products/:id', async (request) => ({
    data: await app.mall.getProduct((request.params as { id: string }).id),
  }));

  app.get('/mall/cart', { preHandler: app.requireAuth }, async (request) => ({
    data: await app.mall.getCart(request.userId as string),
  }));

  app.post('/mall/cart', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(cartAddSchema, request.body);
    return { data: await app.mall.addToCart(request.userId as string, body.productId, body.quantity) };
  });

  app.patch('/mall/cart/:productId', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(cartUpdateSchema, request.body);
    return {
      data: await app.mall.updateCartQuantity(
        request.userId as string,
        (request.params as { productId: string }).productId,
        body.quantity,
      ),
    };
  });

  app.delete('/mall/cart/:productId', { preHandler: app.requireAuth }, async (request) => ({
    data: await app.mall.removeFromCart(
      request.userId as string,
      (request.params as { productId: string }).productId,
    ),
  }));

  app.delete('/mall/cart', { preHandler: app.requireAuth }, async (request) => ({
    data: await app.mall.clearCart(request.userId as string),
  }));

  app.post('/mall/orders', { preHandler: app.requireAuth }, async (request, reply) => {
    const body = parse(orderCreateSchema, request.body);
    const rawKey = request.headers['idempotency-key'];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    const order = await app.mall.createOrder(
      request.userId as string,
      body,
      key && key.trim() ? key.trim().slice(0, 128) : undefined,
    );
    return reply.status(201).send({ data: order });
  });

  app.get('/mall/orders', { preHandler: app.requireAuth }, async (request) => ({
    data: await app.mall.listOrders(request.userId as string),
  }));

  app.get('/mall/orders/:orderNo', { preHandler: app.requireAuth }, async (request) => ({
    data: await app.mall.getOrder(request.userId as string, (request.params as { orderNo: string }).orderNo),
  }));
}
