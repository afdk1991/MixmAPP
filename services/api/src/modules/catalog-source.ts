import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProductDto, ProductQueryInput } from '@mixmapp/contracts';
import { projectRoot, type Config } from '../config.js';
import type { Store } from '../db/types.js';

/**
 * 内嵌只读商品目录源。
 *
 * 背景：真实目录（15,037 条五金商品）在开发机本机 PG 里，生产库只有 6 条演示品，
 * 且线上是旧构建、图片通道未通 —— 用户「导入了却看不到」的根因是数据不在生产库。
 * 本模块把随 API 一起分发的 catalog.json 快照一次性加载进内存索引，在 DB 没有真实
 * 目录商品（或按配置强制启用）时接管商城的公开读，让商品「立刻可见」，而不必等导库。
 *
 * 设计要点：
 * - 契约不变：对外只吐 ProductDto，字段形状与 MallService.toProductDto 完全一致，前端零改动。
 * - id 稳定：由 sourceKey 做 sha1 映射成字符串 id，重启不漂移，详情可查、分页不重不漏。
 * - 一次性懒加载：35MB JSON 只在首次请求（或 /healthz、/meta）时读一次并建索引，之后零 IO。
 * - 优雅降级：文件不存在 / 解析失败 / DB 探测异常时都不抛，退回 DB 读路径，服务不崩。
 * - 只读：不写库、不复制图片；图片 URL 指向 /media/products/<basename>，由 routes/media.ts 直出。
 */

export type CatalogMode = 'auto' | 'off' | 'force';

export type CatalogCategory = { code: string; name: string; count: number };

export type CatalogStatus = {
  mode: CatalogMode;
  /** 实际生效的商城商品读源 */
  source: 'catalog' | 'db' | 'off' | 'unavailable';
  active: boolean;
  /** 内嵌目录已加载的商品数（未加载为 0） */
  productCount: number;
  /** 实际命中的 catalog.json 绝对路径（未命中为 null） */
  file: string | null;
  reason: string;
};

type RawImage = { staged?: string | null; role?: string | null };
type RawProduct = {
  sourceKey: string;
  sourceId?: string | null;
  sourceUrl?: string | null;
  name: string;
  subtitle?: string | null;
  brand?: string | null;
  categoryPath?: string[] | null;
  categoryCode: string;
  specs?: Record<string, string> | null;
  unit?: string | null;
  packQty?: number | null;
  priceFen?: number | null;
  priceSource?: string | null;
  priceCapturedAt?: string | null;
  stock?: number | null;
  images?: RawImage[] | null;
  description?: string | null;
};
type RawCatalog = {
  meta?: { crawledAt?: string; source?: string } | null;
  categories?: Array<{ code: string; name: string }> | null;
  products: RawProduct[];
};

/** 稳定 id：字符串、URL 安全、无 JS 大整数精度问题；同一 sourceKey 永远得到同一 id。 */
export function stableCatalogId(sourceKey: string): string {
  return `p_${createHash('sha1').update(sourceKey).digest('hex').slice(0, 24)}`;
}

export class CatalogSource {
  private readonly mode: CatalogMode;
  private initPromise: Promise<void> | null = null;

  private state: CatalogStatus;
  private all: ProductDto[] = [];
  private byId = new Map<string, ProductDto>();
  private byCategory = new Map<string, ProductDto[]>();
  private search = new Map<string, string>();
  private categories: CatalogCategory[] = [];

  constructor(
    private readonly config: Config,
    private readonly store: Store,
  ) {
    this.mode = config.mall.catalogSource.mode;
    this.state = {
      mode: this.mode,
      source: this.mode === 'off' ? 'off' : 'db',
      active: false,
      productCount: 0,
      file: null,
      reason: '尚未初始化',
    };
  }

  /** 懒加载 + 决策，只跑一次；之后所有请求复用缓存的索引与状态。 */
  ensure(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.init();
    return this.initPromise;
  }

  async isActive(): Promise<boolean> {
    await this.ensure();
    return this.state.active;
  }

  async status(): Promise<CatalogStatus> {
    await this.ensure();
    return { ...this.state };
  }

  private async init(): Promise<void> {
    try {
      await this.initialize();
    } catch (error) {
      // 兜底：初始化任何异常都退回 DB，绝不让健康检查/商品读把服务拖垮。
      this.state = {
        mode: this.mode,
        source: 'unavailable',
        active: false,
        productCount: 0,
        file: null,
        reason: `目录源初始化失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async initialize(): Promise<void> {
    if (this.mode === 'off') {
      this.state = {
        mode: this.mode,
        source: 'off',
        active: false,
        productCount: 0,
        file: null,
        reason: '已由 MALL_CATALOG_SOURCE=off 显式禁用，商城读走数据库',
      };
      return;
    }

    // auto：DB 里已经有真实目录商品时不必接管，继续用 DB（导入完成后自动让位）。
    if (this.mode === 'auto') {
      let hasReal = false;
      try {
        hasReal = await this.store.mall.products.hasCatalogProducts();
      } catch {
        hasReal = false;
      }
      if (hasReal) {
        this.state = {
          mode: this.mode,
          source: 'db',
          active: false,
          productCount: 0,
          file: null,
          reason: '数据库已含真实目录商品（source_key 非空），auto 让位给数据库',
        };
        return;
      }
    }

    const file = this.resolveFile();
    if (!file) {
      this.state = {
        mode: this.mode,
        source: 'unavailable',
        active: false,
        productCount: 0,
        file: null,
        reason: '未找到 catalog.json（MALL_CATALOG_FILE 或随包/仓库默认路径），优雅降级到数据库',
      };
      return;
    }

    let raw: RawCatalog;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8')) as RawCatalog;
    } catch (error) {
      this.state = {
        mode: this.mode,
        source: 'unavailable',
        active: false,
        productCount: 0,
        file,
        reason: `catalog.json 解析失败：${error instanceof Error ? error.message : String(error)}`,
      };
      return;
    }
    if (!raw || !Array.isArray(raw.products) || raw.products.length === 0) {
      this.state = {
        mode: this.mode,
        source: 'unavailable',
        active: false,
        productCount: 0,
        file,
        reason: 'catalog.json 缺少 products 数组或为空，优雅降级到数据库',
      };
      return;
    }

    this.buildIndex(raw);
    this.state = {
      mode: this.mode,
      source: 'catalog',
      active: true,
      productCount: this.all.length,
      file,
      reason:
        this.mode === 'force'
          ? 'MALL_CATALOG_SOURCE=force 强制启用内嵌只读目录源'
          : 'auto：数据库无真实目录商品，内嵌只读目录源接管公开读',
    };
  }

  /**
   * 定位随 API 分发的 catalog.json，按优先级取第一个真实存在的文件：
   * 1) MALL_CATALOG_FILE（相对 cwd 或绝对）；
   * 2) 与 API 产物同目录 / 同级 catalog 目录（线上发布包把数据放这里即可随包分发）；
   * 3) 仓库内默认位置 tools/egluosi-importer/source/catalog.json；
   * 4) release/prod-catalog/catalog.json 与 cwd 下的同名位置。
   */
  private resolveFile(): string | null {
    const here = dirname(fileURLToPath(import.meta.url));
    const cwd = process.cwd();
    const root = projectRoot();
    const override = this.config.mall.catalogSource.file;
    // 显式覆盖时不回退默认路径：写了 MALL_CATALOG_FILE 就得为该文件负责，
    // 文件不存在即优雅降级到数据库，避免「以为用了指定文件、其实读了另一份」。
    if (override) {
      const chosen = resolve(cwd, override);
      try {
        return existsSync(chosen) && statSync(chosen).isFile() ? chosen : null;
      } catch {
        return null;
      }
    }
    const candidates: string[] = [
      join(here, 'catalog.json'),
      join(here, 'catalog', 'catalog.json'),
      join(here, '..', 'catalog', 'catalog.json'),
      join(here, '..', '..', 'catalog', 'catalog.json'),
      join(root, 'tools', 'egluosi-importer', 'source', 'catalog.json'),
      join(root, 'release', 'prod-catalog', 'catalog.json'),
      resolve(cwd, 'tools', 'egluosi-importer', 'source', 'catalog.json'),
      resolve(cwd, 'release', 'prod-catalog', 'catalog.json'),
    ];
    for (const candidate of new Set(candidates)) {
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      } catch {
        // 无权限 / 竞态删除都跳过，继续尝试下一个候选
      }
    }
    return null;
  }

  private buildIndex(raw: RawCatalog): void {
    const categoryNames = new Map((raw.categories ?? []).map((c) => [c.code, c.name]));
    const crawledAt = raw.meta?.crawledAt ?? new Date(0).toISOString();
    const byCode = new Map<string, number>();
    const items: ProductDto[] = [];
    const search = new Map<string, string>();
    const usedIds = new Set<string>();

    for (const p of raw.products) {
      if (!p || typeof p !== 'object' || !p.sourceKey || !p.name || !p.categoryCode) continue;
      let id = stableCatalogId(p.sourceKey);
      while (usedIds.has(id)) id = `${id}x`; // 极端哈希冲突兜底，保证全量分页 0 重复
      usedIds.add(id);

      // 询价语义：priceSource='inquiry' 或 priceFen 缺失/<=0 → 0 元 + inquiry（前端显示「询价」并禁用加购）
      const priceFen = typeof p.priceFen === 'number' ? p.priceFen : 0;
      const inquiry = p.priceSource === 'inquiry' || priceFen <= 0;
      const priceSource: 'anonymous' | 'login' | 'inquiry' = inquiry
        ? 'inquiry'
        : p.priceSource === 'login'
          ? 'login'
          : 'anonymous';

      // 图片：staged 形如 images/<sha1>.<ext>，只取文件名映射到已本地化的 /media/products/。
      // staged 为空（抓取端下载失败）一律跳过，绝不保留站点热链。
      const images: string[] = [];
      let cover: string | undefined;
      for (const img of p.images ?? []) {
        if (!img?.staged) continue;
        const url = `/media/products/${basename(img.staged)}`;
        images.push(url);
        if (img.role === 'cover' && !cover) cover = url;
      }
      if (!cover && images.length) cover = images[0];

      const brand = p.brand ?? '';
      const categoryPath = p.categoryPath ?? [];
      const categoryName = categoryNames.get(p.categoryCode) ?? categoryPath[0] ?? p.categoryCode;
      const specs = p.specs ?? {};

      const dto: ProductDto = {
        id,
        title: p.name,
        subtitle: p.subtitle ?? '',
        priceFen: inquiry ? 0 : priceFen,
        originalPriceFen: 0,
        // 目录库存需登录源站才可见，快照一律按 0（缺货）下发，前端据此禁用加购。
        stock: 0,
        category: p.categoryCode,
        cover: cover ?? '#0f9d8f',
        images,
        tags: brand ? [brand] : [],
        description: p.description ?? '',
        createdAt: crawledAt,
        ...(brand ? { brand } : {}),
        ...(categoryPath.length ? { categoryPath } : {}),
        ...(categoryName ? { categoryName } : {}),
        ...(Object.keys(specs).length ? { specs } : {}),
        ...(p.unit ? { unit: p.unit } : {}),
        ...(p.packQty != null ? { packQty: p.packQty } : {}),
        ...(priceSource ? { priceSource } : {}),
        ...(p.priceCapturedAt ? { priceCapturedAt: p.priceCapturedAt } : {}),
        ...(p.sourceUrl ? { sourceUrl: p.sourceUrl } : {}),
      };
      items.push(dto);

      const parts: string[] = [p.name, p.subtitle ?? '', brand, p.sourceId ?? ''];
      for (const [key, value] of Object.entries(specs)) parts.push(key, value);
      search.set(id, parts.join(' ').toLowerCase());

      byCode.set(p.categoryCode, (byCode.get(p.categoryCode) ?? 0) + 1);
    }

    // 稳定排序：以 id 为唯一键字典序，全量翻页不因排序漂移而重复/漏商品。
    items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const byCategory = new Map<string, ProductDto[]>();
    for (const item of items) {
      const bucket = byCategory.get(item.category);
      if (bucket) bucket.push(item);
      else byCategory.set(item.category, [item]);
    }

    this.all = items;
    this.byId = new Map(items.map((item) => [item.id, item]));
    this.search = search;
    this.byCategory = byCategory;
    this.categories = [...byCode.entries()]
      .map(([code, count]) => ({ code, name: categoryNames.get(code) ?? code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  }

  /** 公开读：category（一级 code）、keyword（name/subtitle/brand/specs/sourceId）、page/pageSize。 */
  listProducts(query: ProductQueryInput): ProductDto[] {
    const base = query.category ? (this.byCategory.get(query.category) ?? []) : this.all;
    const keyword = query.keyword?.toLowerCase();
    const offset = (query.page - 1) * query.pageSize;
    const matched: ProductDto[] = [];
    for (const item of base) {
      if (keyword && !this.search.get(item.id)?.includes(keyword)) continue;
      matched.push(item);
    }
    return matched.slice(offset, offset + query.pageSize);
  }

  getProduct(id: string): ProductDto | undefined {
    return this.byId.get(id);
  }

  /** 分类聚合：只来自 catalog.products 的 6 个真实中文类目，绝不混入 4 个英文演示分类。 */
  listCategories(): CatalogCategory[] {
    return this.categories.map((c) => ({ ...c }));
  }
}
