import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProductDto, ProductQueryInput } from '@mixmapp/contracts';
import { projectRoot, type Config } from '../config.js';
import type { Store } from '../db/types.js';
import {
  buildSearchIndexRow,
  buildSearchTokens,
  matchesSearchTokens,
  type SearchIndexRow,
} from '../lib/search.js';

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

/** 分类树节点视图（与 MallService.CategoryNode 形状对齐）。 */
type CategoryNodeView = { id: string; code: string; name: string; level: number; count: number };

/** 筛选候选视图（与 DB listSpecOptions 返回形状对齐）。 */
type SpecOptionsView = {
  dims: string[];
  lens: string[];
  brands: string[];
  stds: string[];
  grds: string[];
  mtls: string[];
  ttts: string[];
  trts: string[];
};

/**
 * 不进入「6 个中文五金类目」展示口径的源站类目。
 * 这类商品本身保留在快照里、可搜可看可进详情，只是从分类计数与首页推荐口径中排除，
 * 避免把非五金女装类目混进中文类目统计（商品不删、口径不污染）。
 */
const HZN_DISPLAY_EXCLUDED_CODES = new Set(['hznzcn-apparel']);

/** 分类树节点 id（c1:/c2:/c3: 前缀）剥成类目 code；无前缀时原样返回。 */
function nodeCodeOf(nodeId?: string | null): string | null {
  if (!nodeId) return null;
  const i = nodeId.indexOf(':');
  return i >= 0 ? nodeId.slice(i + 1) : nodeId;
}

/** 逗号分隔多选参数：去空白、去重、丢空。 */
function splitMulti(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((v) => v.trim()).filter(Boolean))];
}

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
  /** 源站库存状态原文，如「缺货」「下架」 */
  sourceInvStatus?: string | null;
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
  private search = new Map<string, SearchIndexRow>();
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
    const search = new Map<string, SearchIndexRow>();
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
        ...(p.sourceInvStatus ? { sourceInvStatus: p.sourceInvStatus } : {}),
        // 快照库存恒为 0（需登录才可见），因此目录源一律不可售
        inStock: false,
      };
      items.push(dto);

      // 搜索索引与 DB 读路径共用 lib/search 的归一口径：
      // 全半角/大小写归一、AND 分词、项目号 12/6 位规则、规格等价（M6-1.0x8 ≡ M6x8 ≡ 6*8）。
      search.set(
        id,
        buildSearchIndexRow({
          title: p.name,
          subtitle: p.subtitle ?? '',
          brand,
          specs,
          sourceId: p.sourceId ?? null,
          sourceKey: p.sourceKey,
        }),
      );

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

  private specText(p: ProductDto, key: string): string {
    return p.specs?.[key]?.trim() ?? '';
  }

  /**
   * 与 DB 读路径同构的过滤条件，list / count / 规格候选共用，保证「筛选后条数」与分页结果不漂移。
   * 快照商品只挂一级类目 code：cat / ctgs 节点剥掉 c1:/c2:/c3: 前缀后按 categoryCode 比对；
   * 快照无二级/三级树节点，更深层级按无商品处理，与 DB 内存实现口径一致。
   */
  private matchProducts(query: ProductQueryInput): ProductDto[] {
    const catCode = nodeCodeOf(query.cat);
    const ctgCodes = splitMulti(query.ctgs).map(nodeCodeOf).filter((v): v is string => Boolean(v));
    const trts = splitMulti(query.trts);
    const tokens = buildSearchTokens(query.keyword);
    return this.all.filter((p) => {
      if (query.category && p.category !== query.category) return false;
      if (catCode && p.category !== catCode) return false;
      if (ctgCodes.length && !ctgCodes.includes(p.category)) return false;
      const specs = p.specs ?? {};
      // 快照规格维度统一落在「规格」键上：dims/lens 做子串包含，与 DB 规格候选口径对齐。
      const dimText = String(specs['规格'] ?? '');
      if (query.dims && !dimText.includes(query.dims)) return false;
      if (query.lens && !dimText.includes(query.lens)) return false;
      const brand = (p.brand ?? String(specs['品牌'] ?? '')).trim();
      if (query.brand && brand !== query.brand) return false;
      if (query.std && this.specText(p, '标准') !== query.std) return false;
      if (query.grd && this.specText(p, '等级') !== query.grd) return false;
      if (query.mtl && this.specText(p, '材质') !== query.mtl) return false;
      if (query.ttt && this.specText(p, '表面处理') !== query.ttt) return false;
      if (trts.length && !trts.includes(this.specText(p, '牙别'))) return false;
      if (tokens.length) {
        const index = this.search.get(p.id);
        if (!index || !matchesSearchTokens(index, tokens)) return false;
      }
      return true;
    });
  }

  private sortProducts(rows: ProductDto[], sort: ProductQueryInput['sort']): ProductDto[] {
    const priceOf = (p: ProductDto): number => p.priceLi ?? p.priceFen ?? 0;
    if (sort === 'priceAsc') return [...rows].sort((a, b) => priceOf(a) - priceOf(b) || a.id.localeCompare(b.id));
    if (sort === 'priceDesc') return [...rows].sort((a, b) => priceOf(b) - priceOf(a) || a.id.localeCompare(b.id));
    // createdDesc：快照按 id 字典序稳定排序，等价于稳定的上架时间倒序兜底。
    return rows;
  }

  /**
   * 公开读：先按同一次遍历算出 matched（total 与分页无关），再切片。
   * keyword 口径见 lib/search：多词 AND（顺序无关）、项目号 12/6 位、规格等价、全半角/大小写归一。
   */
  listProducts(query: ProductQueryInput): ProductDto[] {
    const matched = this.sortProducts(this.matchProducts(query), query.sort);
    const offset = (query.page - 1) * query.pageSize;
    return matched.slice(offset, offset + query.pageSize);
  }

  /** 过滤后命中总数：与 listProducts 同一次过滤口径，不做切片。 */
  countProducts(query: ProductQueryInput): number {
    return this.matchProducts(query).length;
  }

  getProduct(id: string): ProductDto | undefined {
    return this.byId.get(id);
  }

  /**
   * 分类聚合：来自快照一级类目；排除 HZN 展示口径类目（商品仍可搜可看），
   * 与 listCategoryChildren / 首页推荐同源。
   */
  listCategories(): CatalogCategory[] {
    return this.categories
      .filter((c) => !HZN_DISPLAY_EXCLUDED_CODES.has(c.code))
      .map((c) => ({ ...c }));
  }

  /** 分类树下一层：快照只有一级类目，parent 为空返回一级，否则为空数组（无更深层级）。 */
  listCategoryChildren(parent: string | null): CategoryNodeView[] {
    if (parent) return [];
    return this.categories
      .filter((c) => !HZN_DISPLAY_EXCLUDED_CODES.has(c.code))
      .map((c) => ({ id: `c1:${c.code}`, code: c.code, name: c.name, level: 1, count: c.count }));
  }

  /**
   * 分类节点（含子孙）下真实存在的筛选候选；目录源从快照聚合，不再回 DB，与列表同源。
   * nodeId 省略时全量聚合；快照规格统一落在 specs 中文键上。
   */
  listSpecOptions(nodeId?: string | null): SpecOptionsView {
    const scope = this.all.filter((p) => {
      const code = nodeCodeOf(nodeId);
      return code ? p.category === code : true;
    });
    const distinct = (values: Array<string | undefined>): string[] =>
      [...new Set(values.map((v) => v?.trim()).filter((v): v is string => Boolean(v)))].sort();
    return {
      dims: distinct(scope.map((p) => p.specs?.['规格'])),
      lens: distinct(scope.map((p) => p.specs?.['规格'])),
      brands: distinct(scope.map((p) => p.brand ?? p.specs?.['品牌'])),
      stds: distinct(scope.map((p) => p.specs?.['标准'])),
      grds: distinct(scope.map((p) => p.specs?.['等级'])),
      mtls: distinct(scope.map((p) => p.specs?.['材质'])),
      ttts: distinct(scope.map((p) => p.specs?.['表面处理'])),
      trts: distinct(scope.map((p) => p.specs?.['牙别'])),
    };
  }
}
