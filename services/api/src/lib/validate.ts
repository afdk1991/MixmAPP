import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodSchema } from 'zod';
import { AppError } from './errors.js';

export function parse<S extends ZodSchema>(schema: S, data: unknown): S['_output'] {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw AppError.validation(
      '参数校验失败',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
  interface FastifyInstance {
    cfg: import('../config.js').Config;
    store: import('../db/types.js').Store;
    sms: import('../adapters/sms.js').SmsProvider;
    oauth: Record<string, import('../adapters/oauth.js').OAuthProvider>;
    auth: import('../modules/auth.js').AuthService;
    pay: import('../modules/pay.js').PayService;
    map: import('../adapters/map.js').MapProvider;
    storage: import('../adapters/storage.js').StorageProvider;
    push: import('../adapters/push.js').PushProvider;
    ai: import('../adapters/ai.js').AiProvider;
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
