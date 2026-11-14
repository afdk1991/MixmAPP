import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { isSafeStorageKey } from '../adapters/storage.js';
import { AppError } from '../lib/errors.js';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
};

/**
 * 本地存储直出：仅在 storage.provider === 'local' 时注册。
 * 生产由 nginx 直出 /media/，这里补齐本地开发/内存联调时的读图通道。
 * key 一律过 isSafeStorageKey 校验，并二次确认解析后路径仍落在 localDir 内，防目录穿越。
 */
export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  const root = resolve(app.cfg.storage.localDir);

  app.get('/media/*', async (request, reply) => {
    const key = (request.params as { '*': string })['*'] ?? '';
    if (!isSafeStorageKey(key)) throw AppError.notFound('资源不存在');
    const target = resolve(root, key);
    if (!target.startsWith(root + sep)) throw AppError.notFound('资源不存在');
    if (!existsSync(target) || !statSync(target).isFile()) throw AppError.notFound('资源不存在');

    reply.type(MIME_BY_EXT[extname(target).toLowerCase()] ?? 'application/octet-stream');
    return reply.send(createReadStream(target));
  });
}
