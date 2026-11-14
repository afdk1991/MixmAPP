import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { projectRoot, type Config } from '../src/config.js';
import { MemoryStore } from '../src/db/memory.js';
import type { ProductRecord } from '../src/db/types.js';
import { stableCatalogId } from '../src/modules/catalog-source.js';
import { testConfig } from './helpers.js';

const fixture = join(projectRoot(), 'tools', 'egluosi-importer', 'source', 'fixture-catalog.json');
const realCatalog = join(projectRoot(), 'tools', 'egluosi-importer', 'source', 'catalog.json');

let apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps) await app.close();
  apps = [];
});

function cfg(mode: 'auto' | 'off' | 'force', file: string = fixture): Config {
  return { ...testConfig, mall: { catalogSource: { mode, file } } };
}

async function makeApp(config: Config, store = new MemoryStore()) {
  const app = await buildApp({ config, store, logger: false });
  apps.push(app);
  return { app, store };
}

function dbProduct(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: 'db-1',
    title: '数据库商品',
    subtitle: '',
    priceFen: 1000,
    originalPriceFen: 0,
    stock: 5,
    category: 'featured',
    cover: '#0f9d8f',
    images: [],
    tags: [],
    description: '',
    sortNo: 1,
    createdAt: new Date('2026-11-12T00:00:00.000Z'),
    ...overrides,
  };
}

type AnyProduct = Record<string, any> & { id: string };

describe('内嵌只读目录源（fixture 夹具）', () => {
  it('force：目录源接管公开读，DTO 形状与询价/缺货语义正确', async () => {
    const { app } = await makeApp(cfg('force'));
    const list = await app.inject({ method: 'GET', url: '/api/v1/mall/products?pageSize=50' });
    expect(list.statusCode).toBe(200);
    const data = list.json().data as AnyProduct[];
    expect(data).toHaveLength(3);

    for (const p of data) {
      expect(typeof p.id).toBe('string');
      expect(p.id).toMatch(/^p_[0-9a-f]{24}$/);
      expect(p.sourceUrl).toMatch(/^https:\/\//);
      expect(Array.isArray(p.categoryPath)).toBe(true);
      expect(p.categoryName).toBeTruthy();
      expect(typeof p.specs).toBe('object');
      expect(p.unit).toBeTruthy();
      expect(p.priceSource).toBeTruthy();
      expect(p.priceCapturedAt).toBeTruthy();
      // 目录库存需登录源站才可见，快照一律按 0（缺货）下发
      expect(p.stock).toBe(0);
      expect(p.createdAt).toBe('2026-11-14T04:00:00.000Z');
    }
    const inquiry = data.filter((p) => p.priceSource === 'inquiry');
    expect(inquiry).toHaveLength(2);
    for (const p of inquiry) expect(p.priceFen).toBe(0);
    expect(data.find((p) => p.priceSource === 'anonymous')?.priceFen).toBe(68);

    const cats = await app.inject({ method: 'GET', url: '/api/v1/mall/categories' });
    const catData = cats.json().data as Array<{ code: string; name: string; count: number }>;
    expect(catData).toHaveLength(3);
    expect(catData.reduce((sum, c) => sum + c.count, 0)).toBe(3);
    expect(catData.some((c) => ['featured', 'life', 'digital', 'wear'].includes(c.code))).toBe(false);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/mall/products/${data[0]!.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.id).toBe(data[0]!.id);
    const missing = await app.inject({ method: 'GET', url: '/api/v1/mall/products/p_not-exist' });
    expect(missing.statusCode).toBe(404);
  });

  it('keyword / category 过滤与稳定分页', async () => {
    const { app } = await makeApp(cfg('force'));
    const kw = await app.inject({ method: 'GET', url: '/api/v1/mall/products?keyword=OSG&pageSize=50' });
    expect(kw.json().data).toHaveLength(1);
    expect(kw.json().data[0].brand).toBe('OSG');

    const cat = await app.inject({ method: 'GET', url: '/api/v1/mall/products?category=eg-screw&pageSize=50' });
    expect(cat.json().data).toHaveLength(1);
    expect(cat.json().data[0].category).toBe('eg-screw');

    // 逐页取（含越界页），顺序稳定、不重不漏
    const ids: string[] = [];
    for (let page = 1; page <= 4; page += 1) {
      const r = await app.inject({ method: 'GET', url: `/api/v1/mall/products?page=${page}&pageSize=1` });
      ids.push(...(r.json().data as AnyProduct[]).map((p) => p.id));
    }
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('id 由 sourceKey 稳定派生（字符串、URL 安全、重启不变）', () => {
    expect(stableCatalogId('sku:A')).toBe(stableCatalogId('sku:A'));
    expect(stableCatalogId('sku:A')).not.toBe(stableCatalogId('sku:B'));
    expect(stableCatalogId('url:https://eg.egluosi.com/b2b/x')).toMatch(/^p_[0-9a-f]{24}$/);
  });

  it('off：显式禁用，读走数据库', async () => {
    const store = new MemoryStore();
    await store.mall.products.insert(dbProduct());
    const { app } = await makeApp(cfg('off'), store);
    const list = await app.inject({ method: 'GET', url: '/api/v1/mall/products' });
    expect((list.json().data as AnyProduct[]).map((p) => p.id)).toEqual(['db-1']);
    const health = await app.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(health.json().checks.catalogSource).toBe('off');
  });

  it('auto：DB 无真实目录商品 → 内嵌目录源接管，并在 healthz/meta 暴露', async () => {
    const { app } = await makeApp(cfg('auto'));
    const health = await app.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(health.json().checks.catalogSource).toBe('catalog');
    expect(health.json().catalogSource.active).toBe(true);
    expect(health.json().catalogSource.productCount).toBe(3);
    const meta = await app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(meta.json().data.catalogSource.source).toBe('catalog');
  });

  it('auto：DB 已有 sourceKey 商品 → 让位数据库', async () => {
    const store = new MemoryStore();
    await store.mall.products.insert(dbProduct({ id: 'db-real', sourceKey: 'sku:REAL' }));
    const { app } = await makeApp(cfg('auto'), store);
    const health = await app.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(health.json().checks.catalogSource).toBe('db');
    const list = await app.inject({ method: 'GET', url: '/api/v1/mall/products' });
    expect((list.json().data as AnyProduct[]).map((p) => p.id)).toEqual(['db-real']);
  });

  it('catalog 文件不存在 → 优雅降级数据库，服务不崩', async () => {
    const store = new MemoryStore();
    await store.mall.products.insert(dbProduct());
    const { app } = await makeApp(cfg('force', join(projectRoot(), 'no-such-catalog.json')), store);
    const health = await app.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(health.statusCode).toBe(200);
    expect(health.json().checks.catalogSource).toBe('unavailable');
    const list = await app.inject({ method: 'GET', url: '/api/v1/mall/products' });
    expect((list.json().data as AnyProduct[]).map((p) => p.id)).toEqual(['db-1']);
  });
});

describe('/media 本地直出兜底', () => {
  // storage/products 被 .gitignore 排除，CI checkout 里没有图片；
  // 无样例时跳过，避免把「本机有图、CI 无图」误判成回归。
  const repoMediaSample = join(
    projectRoot(),
    'storage/products/000518191826ddfe69815af4ffe2513f1ca0de08.jpg',
  );
  const run = existsSync(repoMediaSample) ? it : it.skip;
  run('STORAGE_DIR 指错时，仍从仓库 storage/products 兜底返回 200 图片', async () => {
    const app = await buildApp({
      config: {
        ...testConfig,
        storage: { ...testConfig.storage, provider: 'local', localDir: join(projectRoot(), 'no-such-storage') },
      },
      store: new MemoryStore(),
      logger: false,
    });
    apps.push(app);
    const res = await app.inject({
      method: 'GET',
      url: '/media/products/000518191826ddfe69815af4ffe2513f1ca0de08.jpg',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
  });
});

describe('内嵌目录源（真实 15,037 条 catalog.json）', () => {
  const run = existsSync(realCatalog) ? it : it.skip;
  run(
    '全量索引：6 个中文类目计数正确、301 页翻页 0 重复、UTOOL 命中、图片 URL 与详情可用',
    async () => {
      const { app } = await makeApp(cfg('force', realCatalog));
      const health = await app.inject({ method: 'GET', url: '/api/v1/healthz' });
      expect(health.json().catalogSource.productCount).toBe(15037);

      const cats = await app.inject({ method: 'GET', url: '/api/v1/mall/categories' });
      const byCode = Object.fromEntries(
        (cats.json().data as Array<{ code: string; count: number }>).map((c) => [c.code, c.count]),
      ) as Record<string, number>;
      expect(cats.json().data).toHaveLength(6);
      expect(byCode).toMatchObject({
        'eg-screw': 6160,
        'cutting-tool': 5947,
        'egm-screw': 2251,
        'hand-tool': 253,
        expansion: 249,
        'auto-screw': 177,
      });

      // 全量翻页（pageSize=50，301 页）唯一 id ≥15037 且 0 重复
      const seen = new Set<string>();
      for (let page = 1; page <= 301; page += 1) {
        const r = await app.inject({ method: 'GET', url: `/api/v1/mall/products?page=${page}&pageSize=50` });
        expect(r.statusCode).toBe(200);
        for (const p of r.json().data as AnyProduct[]) seen.add(p.id);
      }
      expect(seen.size).toBe(15037);

      const kw = await app.inject({ method: 'GET', url: '/api/v1/mall/products?keyword=UTOOL&pageSize=3' });
      expect((kw.json().data as AnyProduct[]).some((p) => p.brand === 'UTOOL')).toBe(true);

      const first = await app.inject({ method: 'GET', url: '/api/v1/mall/products?page=1&pageSize=3' });
      const products = first.json().data as AnyProduct[];
      expect(products).toHaveLength(3);
      const p = products[0]!;
      expect(p.sourceUrl).toMatch(/^https:\/\//);
      expect(p.brand).toBeTruthy();
      expect(p.specs).toBeTruthy();
      expect(p.priceSource).toBeTruthy();
      const withImg = products.find((x) => Array.isArray(x.images) && x.images.length > 0);
      if (withImg) expect(withImg.images[0]).toMatch(/^\/media\/products\/[0-9a-f]+\.(jpg|jpeg|png|webp|gif)$/);

      const detail = await app.inject({ method: 'GET', url: `/api/v1/mall/products/${p.id}` });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.id).toBe(p.id);
    },
    30_000,
  );
});
