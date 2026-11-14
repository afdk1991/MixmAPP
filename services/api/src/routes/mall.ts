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
  // 无参：一级类目聚合（兼容旧页面）；?parent=root：分类树一级节点（带 id，供下钻）；
  // ?parent=c1:002：返回该节点下一层（分类树下钻）。
  app.get('/mall/categories', async (request) => {
    const query = request.query as { parent?: string } | undefined;
    const parent = typeof query?.parent === 'string' && query.parent.trim() ? query.parent.trim() : null;
    if (!parent) return { data: await app.mall.listCategories() };
    if (parent === 'root') return { data: await app.mall.listCategoryChildren(null) };
    return { data: await app.mall.listCategoryChildren(parent) };
  });

  // 某个三级类目下可用的规格筛选项（dims/lens），只返回商品里真实出现的取值。
  app.get('/mall/specs', async (request) => {
    const query = request.query as { c3?: string } | undefined;
    const c3 = typeof query?.c3 === 'string' ? query.c3.trim() : '';
    if (!c3) return { data: { dims: [], lens: [] } };
    return { data: await app.mall.listSpecOptions(c3) };
  });

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
    return {
      data: await app.mall.addToCart(
        request.userId as string,
        body.productId,
        body.quantity,
        body.packUnit,
        body.packQty,
      ),
    };
  });

  app.patch('/mall/cart/:productId', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(cartUpdateSchema, request.body);
    return {
      data: await app.mall.updateCartQuantity(
        request.userId as string,
        (request.params as { productId: string }).productId,
        body.quantity,
        body.packUnit,
        body.packQty,
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
