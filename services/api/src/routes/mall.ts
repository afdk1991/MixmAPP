import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  cartAddSchema,
  cartUpdateSchema,
  orderCreateSchema,
  productQuerySchema,
} from '@mixmapp/contracts';
import { parse } from '../lib/validate.js';

/**
 * 商品读接口的可选登录态判定。
 * 源站规则：面价（basePrcD3N2）与商城折扣（disD2N2）公开；折后千支价（disbasePrc）、
 * 库存（bpInvQty）、库存状态（invStatus）只有登录后才展示真实值。
 * 未带令牌或令牌失效都按匿名处理，不阻断商品浏览。
 */
async function resolveLoggedIn(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  try {
    // 复用全局 requireAuth：校验通过会写入 request.userId 与账号响应头
    await app.requireAuth(request, reply);
    return true;
  } catch {
    // 令牌过期/非法：回落到匿名视角（显示「登录可见」占位）
    return false;
  }
}

/** 商城路由：商品公开读，购物车与订单需登录。 */
export async function mallRoutes(app: FastifyInstance): Promise<void> {
  // 无参：一级类目聚合（兼容旧页面）；?parent=root：分类树一级节点（带 id，供下钻）；
  // ?parent=c1:002：返回该节点下一层（分类树下钻）。
  // ?includeEmpty=1：连同 0 商品节点一起返回，「商品分类」抽屉按源站整棵树一比一展示。
  app.get('/mall/categories', async (request) => {
    const query = request.query as { parent?: string; includeEmpty?: string } | undefined;
    const parent = typeof query?.parent === 'string' && query.parent.trim() ? query.parent.trim() : null;
    const includeEmpty = query?.includeEmpty === '1' || query?.includeEmpty === 'true';
    if (!parent) return { data: await app.mall.listCategories() };
    if (parent === 'root') return { data: await app.mall.listCategoryChildren(null, { includeEmpty }) };
    return { data: await app.mall.listCategoryChildren(parent, { includeEmpty }) };
  });

  // 某个三级类目下可用的规格筛选项（dims/lens），只返回商品里真实出现的取值。
  app.get('/mall/specs', async (request) => {
    const query = request.query as { c3?: string } | undefined;
    const c3 = typeof query?.c3 === 'string' ? query.c3.trim() : '';
    if (!c3)
      return {
        data: { dims: [], lens: [], brands: [], stds: [], grds: [], mtls: [], ttts: [] },
      };
    return { data: await app.mall.listSpecOptions(c3) };
  });

  app.get('/mall/products', async (request, reply) => ({
    data: await app.mall.listProducts(
      parse(productQuerySchema, request.query ?? {}),
      await resolveLoggedIn(app, request, reply),
    ),
  }));

  app.get('/mall/products/:id', async (request, reply) => ({
    data: await app.mall.getProduct(
      (request.params as { id: string }).id,
      await resolveLoggedIn(app, request, reply),
    ),
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
