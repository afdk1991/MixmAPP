import { createReadStream, existsSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { isSafeStorageKey } from '../adapters/storage.js';
import { AppError } from '../lib/errors.js';
import { projectRoot } from '../config.js';

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
 * 本地存储直出：仅在 storage.provider === 'local' 时注册（见 app.ts）。
 * 生产可由 nginx 直出 /media/，这里补齐 API 侧自带读图通道，保证不依赖 nginx 也能 200。
 *
 * key 一律过 isSafeStorageKey 校验，且每个候选都二次确认「解析后路径仍落在其根内」，防目录穿越。
 * 除主 STORAGE_DIR 外，额外提供兜底根：仓库 storage/、cwd/storage/、随包 catalog/images/，
 * 以及抓取端 source/images/<basename>，覆盖「STORAGE_DIR 指错或发布包没带 storage 目录」的情况。
 */
export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  const root = resolve(app.cfg.storage.localDir);
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = projectRoot();

  const storageFallbacks = [
    join(repoRoot, 'storage'),
    resolve(process.cwd(), 'storage'),
    join(here, '..', '..', '..', 'storage'),
    join(here, 'catalog', 'images'),
    join(here, 'images'),
  ];
  const imageSourceRoot = join(repoRoot, 'tools', 'egluosi-importer', 'source');

  app.get('/media/*', async (request, reply) => {
    const key = (request.params as { '*': string })['*'] ?? '';
    if (!isSafeStorageKey(key)) throw AppError.notFound('资源不存在');

    const candidates: Array<{ root: string; target: string }> = [
      { root, target: resolve(root, key) },
      ...storageFallbacks.map((dir) => ({ root: dir, target: resolve(dir, key) })),
    ];
    // 源图以 images/<sha1>.<ext> 存放，而公开 key 是 products/<sha1>.<ext>，这里补一条映射。
    if (key.startsWith('products/')) {
      candidates.push({
        root: imageSourceRoot,
        target: resolve(imageSourceRoot, 'images', basename(key)),
      });
    }

    for (const { root: candidateRoot, target } of candidates) {
      const base = resolve(candidateRoot);
      if (!target.startsWith(base + sep)) continue;
      if (!existsSync(target) || !statSync(target).isFile()) continue;
      reply.type(MIME_BY_EXT[extname(target).toLowerCase()] ?? 'application/octet-stream');
      return reply.send(createReadStream(target));
    }
    throw AppError.notFound('资源不存在');
  });
}
