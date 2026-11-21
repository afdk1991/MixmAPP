// 后台运营台路由（/api/v1/admin/console/*）。
// 门禁策略与既有 /admin/* 一致：未配置 ADMIN_TOKEN、无会话、会话过期，一律 404，不暴露管理面存在。
// 额外约束：
// - 登录成功后只通过 HttpOnly Cookie 下发短期会话，前端 JS 拿不到令牌，也不允许用 URL 传递；
// - 所有写操作要求自定义请求头 x-mixm-console: 1（配合 SameSite=Strict 做 CSRF 防护）；
// - 所有响应 no-store，避免被浏览器/中间层缓存。

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';
import {
  ADMIN_SESSION_COOKIE,
  type AdminRequestContext,
} from '../modules/admin-console.js';

/** 从 Cookie 头里取单个值；解析失败按不存在处理。 */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      return null;
    }
  }
  return null;
}

/** 判断当前请求是否走 https（含反代场景），用于决定 Cookie 是否加 Secure。 */
function isSecure(request: FastifyRequest): boolean {
  const proto = request.headers['x-forwarded-proto'];
  const value = Array.isArray(proto) ? proto[0] : proto;
  if (value && value.split(',')[0]?.trim() === 'https') return true;
  return request.protocol === 'https';
}

/** 审计上下文：来源 IP 优先取反代首段。 */
function contextOf(request: FastifyRequest): AdminRequestContext {
  const forward = request.headers['x-forwarded-for'];
  const raw = Array.isArray(forward) ? forward[0] : forward;
  const ip = raw?.split(',')[0]?.trim() || request.ip;
  return {
    ip,
    userAgent: String(request.headers['user-agent'] ?? ''),
    requestId: request.id,
  };
}

/** 写入会话 Cookie。Path=/ 是为了兼容线上 /mixmapp 前缀反代（Cookie 路径按浏览器地址匹配）。 */
function setSessionCookie(reply: FastifyReply, request: FastifyRequest, token: string, ttlSec: number): void {
  const attrs = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    // SameSite=Strict：跨站请求一律不带会话 Cookie，配合自定义头形成双保险。
    'SameSite=Strict',
    `Max-Age=${ttlSec}`,
  ];
  if (isSecure(request)) attrs.push('Secure');
  reply.header('set-cookie', attrs.join('; '));
}

/** 清除会话 Cookie。 */
function clearSessionCookie(reply: FastifyReply, request: FastifyRequest): void {
  const attrs = [
    `${ADMIN_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
  ];
  if (isSecure(request)) attrs.push('Secure');
  reply.header('set-cookie', attrs.join('; '));
}

/**
 * 后台运营台路由。
 * 用嵌套 register 包一层，确保 no-store 钩子只作用于后台路由，不影响用户侧响应缓存。
 */
export async function adminConsoleRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (scope) => {
    // 后台数据一律不缓存：避免运营改完状态后仍看到旧值。
    scope.addHook('onSend', async (_request, reply) => {
      reply.header('cache-control', 'no-store');
    });

    /** 校验会话；无效直接 404。返回原始会话令牌，供登出使用。 */
    const requireSession = (request: FastifyRequest): string => {
      const token = readCookie(request.headers.cookie, ADMIN_SESSION_COOKIE);
      scope.adminConsole.verify(token);
      return token as string;
    };

    /** 写操作 CSRF 校验：没有自定义头一律按不存在处理。 */
    const requireWriteHeader = (request: FastifyRequest): void => {
      if (String(request.headers['x-mixm-console'] ?? '') !== '1') throw AppError.notFound();
    };

    // ===== 认证 =====
    // 用 ADMIN_TOKEN 换短期会话；失败一律 404（不区分未配置/口令错误/被限速）。
    scope.post('/admin/console/session', async (request, reply) => {
      const body = (request.body ?? {}) as { token?: unknown };
      // 非字符串输入按错误口令处理，不返回校验细节。
      const token = typeof body.token === 'string' ? body.token : '';
      const session = scope.adminConsole.login(token, contextOf(request));
      setSessionCookie(reply, request, session.token, session.expiresIn);
      return { data: { ok: true, expiresIn: session.expiresIn } };
    });

    // 会话自检：控制台刷新页面后用它判断是否仍登录。
    scope.get('/admin/console/session', async (request) => {
      const token = readCookie(request.headers.cookie, ADMIN_SESSION_COOKIE);
      return { data: { ok: true, ...scope.adminConsole.describeSession(token) } };
    });

    // 主动登出：删会话 + 清 Cookie。
    scope.post('/admin/console/session/logout', async (request, reply) => {
      requireWriteHeader(request);
      const token = readCookie(request.headers.cookie, ADMIN_SESSION_COOKIE);
      scope.adminConsole.verify(token);
      scope.adminConsole.logout(token);
      clearSessionCookie(reply, request);
      return { data: { ok: true } };
    });

    // ===== 概览 =====
    scope.get('/admin/console/overview', async (request) => {
      requireSession(request);
      return { data: await scope.adminConsole.overview() };
    });

    // ===== 商品 =====
    scope.get('/admin/console/products', async (request) => {
      requireSession(request);
      const query = (request.query ?? {}) as Record<string, string | undefined>;
      const data = await scope.adminConsole.listProducts({
        keyword: query.keyword,
        category: query.category,
        listed: query.listed,
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      });
      return { data };
    });

    // 批量上下架：必须带 confirm=true（前端二次确认后再发）。
    scope.post('/admin/console/products/listing', async (request) => {
      requireSession(request);
      requireWriteHeader(request);
      const body = (request.body ?? {}) as { ids?: unknown; listed?: unknown; confirm?: unknown };
      if (typeof body.listed !== 'boolean') throw AppError.validation('listed 必须是布尔值');
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((value): value is string => typeof value === 'string')
        : [];
      return {
        data: await scope.adminConsole.setProductsListed({
          ids,
          listed: body.listed,
          confirm: body.confirm === true,
          ctx: contextOf(request),
        }),
      };
    });

    // ===== 订单 =====
    scope.get('/admin/console/orders', async (request) => {
      requireSession(request);
      const query = (request.query ?? {}) as Record<string, string | undefined>;
      const data = await scope.adminConsole.listOrders({
        status: query.status,
        keyword: query.keyword,
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      });
      return { data };
    });

    scope.get('/admin/console/orders/:id', async (request) => {
      requireSession(request);
      const params = request.params as { id: string };
      return { data: await scope.adminConsole.orderDetail(params.id) };
    });

    // 状态推进：只允许 paid→picking→shipped→completed。
    scope.post('/admin/console/orders/:id/transition', async (request) => {
      requireSession(request);
      requireWriteHeader(request);
      const params = request.params as { id: string };
      const body = (request.body ?? {}) as { to?: unknown };
      const to = typeof body.to === 'string' ? body.to : '';
      return { data: await scope.adminConsole.advanceOrder(params.id, to, contextOf(request)) };
    });

    // 取消订单：危险操作，必须带原因与 confirm=true。
    scope.post('/admin/console/orders/:id/cancel', async (request) => {
      requireSession(request);
      requireWriteHeader(request);
      const params = request.params as { id: string };
      const body = (request.body ?? {}) as { reason?: unknown; confirm?: unknown };
      const data = await scope.adminConsole.cancelOrder(params.id, {
        reason: typeof body.reason === 'string' ? body.reason : '',
        confirm: body.confirm === true,
        ctx: contextOf(request),
      });
      return { data };
    });

    // ===== 用户 =====
    scope.get('/admin/console/users', async (request) => {
      requireSession(request);
      const query = (request.query ?? {}) as Record<string, string | undefined>;
      const data = await scope.adminConsole.listUsers({
        keyword: query.keyword,
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      });
      return { data };
    });

    scope.get('/admin/console/users/:id', async (request) => {
      requireSession(request);
      const params = request.params as { id: string };
      return { data: await scope.adminConsole.userDetail(params.id) };
    });

    // 用户最近会话摘要：设备号 / IP / 网络 / 系统 / 采集时间，仅后台会话可见。
    scope.get('/admin/console/users/:id/sessions', async (request) => {
      requireSession(request);
      const params = request.params as { id: string };
      return { data: await scope.adminConsole.userSessions(params.id) };
    });

    // ===== 运营位与推荐分类（只读） =====
    scope.get('/admin/console/content', async (request) => {
      requireSession(request);
      return { data: await scope.adminConsole.content() };
    });

    // ===== 收藏夹与满减（只读） =====
    scope.get('/admin/console/favorites', async (request) => {
      requireSession(request);
      const query = (request.query ?? {}) as Record<string, string | undefined>;
      const data = await scope.adminConsole.favorites({
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      });
      return { data };
    });

    scope.get('/admin/console/manjian', async (request) => {
      requireSession(request);
      return { data: await scope.adminConsole.manjian() };
    });

    // ===== 审计 =====
    scope.get('/admin/console/audit', async (request) => {
      requireSession(request);
      const query = (request.query ?? {}) as Record<string, string | undefined>;
      const data = await scope.adminConsole.audit(
        query.limit ? Number(query.limit) : undefined,
        query.offset ? Number(query.offset) : undefined,
      );
      return { data };
    });
  });
}
