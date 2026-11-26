import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
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
import { isSafeStorageKey, verifyLocalUpload } from '../adapters/storage.js';

/**
 * 上传白名单：扩展名 → 允许的 MIME。
 * 刻意不收 svg / html / js / json：这些类型由 /media 或对象存储直出时会在浏览器里执行脚本，
 * 等于给同域存储开了一个存储型 XSS 入口。视频只收 mp4 / webm / quicktime。
 */
const UPLOAD_TYPES: Record<string, readonly string[]> = {
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
  gif: ['image/gif'],
  avif: ['image/avif'],
  mp4: ['video/mp4'],
  webm: ['video/webm'],
  mov: ['video/quicktime'],
};

/**
 * 校验「扩展名 + 声明类型」组合：两者必须同时命中白名单且相互匹配。
 * 返回归一化后的 MIME（去掉 charset 等参数），供预签名与落盘共用。
 */
function assertUploadContentType(key: string, contentType: string | undefined): string {
  const ext = /\.([a-z0-9]+)$/i.exec(key)?.[1]?.toLowerCase() ?? '';
  const allowed = UPLOAD_TYPES[ext];
  if (!allowed) throw new AppError('BAD_REQUEST', '不支持的文件类型');
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!type) throw new AppError('BAD_REQUEST', '缺少文件类型');
  if (!allowed.includes(type)) throw new AppError('BAD_REQUEST', '文件类型与扩展名不匹配');
  return type;
}

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  // ---- 支付 ----
  /**
   * 幂等单号：客户端带 Idempotency-Key 且未显式给商户单号时，用「用户 + 键」推导确定性单号。
   * 同一键重试必然落到同一 outTradeNo，不会因为网络抖动 / 重复点击建出多张待支付单。
   */
  const deriveOutTradeNo = (userId: string, key: string): string =>
    `MXID${createHash('sha256').update(`${userId}|${key}`).digest('hex').slice(0, 24).toUpperCase()}`;

  app.post('/pay/orders', { preHandler: app.requireAuth }, async (request, reply) => {
    const body = parse(createPaymentSchema, request.body);
    const userId = request.userId as string;
    const rawKey = request.headers['idempotency-key'];
    const idempotencyKey = (Array.isArray(rawKey) ? rawKey[0] : rawKey)?.trim().slice(0, 128) || '';
    const outTradeNo = body.outTradeNo ?? (idempotencyKey ? deriveOutTradeNo(userId, idempotencyKey) : undefined);

    // 归属隔离 + 幂等回放：
    // - 单号已属于其他账号 → 按「不存在」处理，不暴露该单号是否被占用；
    // - 同一账号、同渠道同金额的重试 → 回放原调起参数（重复点击不再报「商户订单号重复」）；
    // - 同一账号但金额/渠道不同 → 仍是冲突，防止单号被复用到另一笔业务。
    if (outTradeNo) {
      const existing = await app.store.payments.findByOutTradeNo(outTradeNo);
      if (existing) {
        if (existing.userId !== userId) throw AppError.notFound('支付单不存在');
        if (existing.channel === body.channel && existing.amountFen === body.amountFen) {
          const prepay = (existing.prepay ?? {}) as Record<string, unknown>;
          return reply.code(201).send({
            data: {
              outTradeNo,
              channel: existing.channel,
              amountFen: existing.amountFen,
              status: 'pending',
              payload: prepay,
              mode: prepay['mock'] === true ? 'dev' : 'live',
              replayed: true,
            },
          });
        }
        throw AppError.conflict('商户订单号重复');
      }
    }

    const order = await app.pay.createOrder(userId, {
      ...body,
      ...(outTradeNo ? { outTradeNo } : {}),
    });
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
    // 拼上用户前缀后再校验：schema 允许 / 与点号，必须挡住 .. 与越权前缀。
    if (!isSafeStorageKey(key)) throw new AppError('BAD_REQUEST', '存储 key 非法');
    const contentType = assertUploadContentType(key, body.contentType);
    const upload = await app.storage.presignUpload(key, contentType, body.expiresIn);
    return { data: { ...upload, key, publicUrl: app.storage.publicUrl(key) } };
  });

  // 本地上传落盘（provider=local）：签名在 URL 上，不依赖登录 token，便于前端直接 PUT。
  app.put('/storage/upload', async (request, reply) => {
    const query = parse(
      z.object({ key: z.string().min(1), exp: z.coerce.number(), sig: z.string().min(16) }),
      request.query,
    );
    const check = verifyLocalUpload(app.cfg.storage.signSecret, query.key, query.exp, query.sig);
    if (!check.ok) throw new AppError('FORBIDDEN', check.reason);
    if (!isSafeStorageKey(query.key)) throw new AppError('BAD_REQUEST', '存储 key 非法');
    // 落盘前再校验一次类型：预签名签发后仍可能被改成别的内容类型上传。
    assertUploadContentType(query.key, request.headers['content-type'] as string | undefined);

    const root = resolve(app.cfg.storage.localDir);
    const target = resolve(join(root, query.key));
    if (!target.startsWith(`${root}${sep}`)) throw new AppError('BAD_REQUEST', '存储路径越界');

    const body = request.body;
    const payload = Buffer.isBuffer(body)
      ? body
      : typeof body === 'string'
        ? Buffer.from(body)
        : null;
    if (!payload) throw new AppError('BAD_REQUEST', '需要二进制请求体');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, payload);
    return reply.code(204).send();
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
