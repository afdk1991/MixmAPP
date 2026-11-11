import type { FastifyInstance } from 'fastify';
import {
  loginByPasswordSchema,
  loginBySmsSchema,
  oauthLoginSchema,
  refreshTokenSchema,
  registerByEmailSchema,
  registerByPhoneSchema,
} from '@mixmapp/contracts';
import { z } from 'zod';
import { parse } from '../lib/validate.js';

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

  app.post('/auth/login/password', async (request) => {
    const body = parse(loginByPasswordSchema, request.body);
    return { data: await app.auth.loginByPassword(body) };
  });

  app.post('/auth/login/sms', async (request) => {
    const body = parse(loginBySmsSchema, request.body);
    return { data: await app.auth.loginBySms(body) };
  });

  app.post('/auth/login/oauth', async (request) => {
    const body = parse(oauthLoginSchema, request.body);
    return { data: await app.auth.loginByOAuth({ provider: body.provider, code: body.code }) };
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
