import type { FastifyInstance } from 'fastify';
import {
  loginByPasswordSchema,
  loginBySmsSchema,
  oauthLoginSchema,
  oneKeySchema,
  refreshTokenSchema,
  registerByEmailSchema,
  registerByPhoneSchema,
  registerByUsernameSchema,
  registerGuestSchema,
} from '@mixmapp/contracts';
import { z } from 'zod';
import { parse } from '../lib/validate.js';
import { AppError } from '../lib/errors.js';
import { clientIpOf } from '../lib/device-context.js';

const codeRequestSchema = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/),
  purpose: z.enum(['register', 'login', 'bind']),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/sms/code', async (request, reply) => {
    const body = parse(codeRequestSchema, request.body);
    const result = await app.auth.requestSmsCode(body.phone, body.purpose);
    return reply.code(200).send({ data: result });
  });

  app.post('/auth/register/phone', async (request, reply) => {
    const body = parse(registerByPhoneSchema, request.body);
    const result = await app.auth.registerByPhone(body);
    return reply.code(201).send({ data: result });
  });

  app.post('/auth/register/email', async (request, reply) => {
    const body = parse(registerByEmailSchema, request.body);
    const result = await app.auth.registerByEmail(body);
    return reply.code(201).send({ data: result });
  });

  app.post('/auth/register/username', async (request, reply) => {
    const body = parse(registerByUsernameSchema, request.body);
    const result = await app.auth.registerByUsername(body);
    return reply.code(201).send({ data: result });
  });

  /** 游客注册：同一设备重复调用返回同一账号，可后续绑定手机号/邮箱/用户名升级。 */
  app.post('/auth/register/guest', async (request, reply) => {
    const body = parse(registerGuestSchema, request.body);
    const result = await app.auth.registerGuest(body);
    return reply.code(result.isNewUser ? 201 : 200).send({ data: result });
  });

  /** 一键登录：手机号已注册即登录，未注册即建号。 */
  app.post('/auth/onekey', async (request) => {
    const body = parse(oneKeySchema, request.body);
    return { data: await app.auth.oneKeyLogin(body) };
  });

  app.post('/auth/login/password', async (request) => {
    const body = parse(loginByPasswordSchema, request.body);
    // IP 只取服务端看到的首跳；device 为可选快照，缺省行为与旧版一致。
    return { data: await app.auth.loginByPassword({ ...body, ip: clientIpOf(request) }) };
  });

  app.post('/auth/login/sms', async (request) => {
    const body = parse(loginBySmsSchema, request.body);
    return { data: await app.auth.loginBySms({ ...body, ip: clientIpOf(request) }) };
  });

  app.post('/auth/login/oauth', async (request) => {
    const body = parse(oauthLoginSchema, request.body);
    // 内置渠道与注册表里的通用渠道都认：只要存在适配器或注册项就放行，实际可用性交给状态判定。
    if (!app.oauth[body.provider] && !app.providers.get(body.provider)) {
      throw new AppError('BAD_REQUEST', `不支持的登录渠道 ${body.provider}`);
    }
    return {
      data: await app.auth.loginByOAuth({
        provider: body.provider,
        code: body.code,
        device: body.device ?? null,
        ip: clientIpOf(request),
      }),
    };
  });

  app.post('/auth/refresh', async (request) => {
    const body = parse(refreshTokenSchema, request.body);
    return { data: await app.auth.refresh(body.refreshToken) };
  });

  app.post('/auth/logout', async (request) => {
    const body = parse(refreshTokenSchema, request.body);
    await app.auth.logout(body.refreshToken);
    return { data: { ok: true } };
  });
}
