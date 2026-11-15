import { existsSync } from 'node:fs';
import { mkdir, copyFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type {
  CartDto,
  CartLineDto,
  CartLineStatus,
  CartPricingDto,
  FavoriteFolderDto,
  FavoriteItemDto,
  HomeAdDto,
  HomeRecommendedCategoryDto,
  ImportProductInput,
  ManjianTierDto,
  OrderCreateInput,
  OrderDto,
  OrderItemDto,
  ProductDto,
  ProductQueryInput,
  SkippedCartLineDto,
} from '@mixmapp/contracts';
import { CART_LINE_STATUS_TEXT, importCatalogSchema, matchManjianTier } from '@mixmapp/contracts';
import { IdFactory } from '@mixmapp/ids';
import type { CatalogSource } from './catalog-source.js';
import { projectRoot, type Config } from '../config.js';
import type {
  CartItemRecord,
  FavoriteFolderRecord,
  FavoriteItemRecord,
  ManjianTierRecord,
  OrderItemRecord,
  OrderRecord,
  ProductRecord,
  Store,
} from '../db/types.js';
import { isSafeStorageKey } from '../adapters/storage.js';
import { AppError } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { assertDeliverySelection, checkReachability } from './address.js';

export type ImportCategoryCount = { code: string; name: string; count: number };
/** 分类树节点：level 1/2/3，id 形如 c1:002 / c2:002:007 / c3:007。 */
export type CategoryNode = { id: string; code: string; name: string; level: number; count: number };

/**
 * 演示分类码（精选/生活/数码/穿戴）：来自 db/demo-seed.ts 与 infra/sql/0002_mall.sql 的示例商品。
 * 公开类目列表不下发这一组，避免正式目录里混进演示分类。
 */
const DEMO_CATEGORY_CODES = new Set(['featured', 'life', 'digital', 'wear']);

/** 默认收藏夹名称（0019）：懒创建时使用，与迁移里 name 的 1–40 字符约束一致 */
const DEFAULT_FAVORITE_FOLDER_NAME = '默认收藏夹';

/**
 * 首页广告位（home/ggs）内置内容。
 *
 * 源站没有广告位接口（抓取笔记 api-notes.md 里首页只有 api/mall/newItem | newItemC3 | newPack，
 * 全站检索不到 ggs/rcs），所以这里不伪装成远端数据，由服务端统一内置一组运营位。
 * 将来接 CMS 只替换 listHomeAds() 的取数实现，路由与 DTO 契约不动，前端无需跟着改。
 * target 只给语义目标（mall / me / none），不下发页面路径 —— 路由表只有前端一份。
 */
const HOME_ADS: HomeAdDto[] = [
  {
    id: 'ad-catalog',
    title: '15,000+ 五金目录已就绪',
    subtitle: '按三级分类下钻 · 9 维规格筛选',
    image: '',
    target: 'mall',
    badge: '目录',
    sortNo: 10,
  },
  {
    id: 'ad-search',
    title: '搜规格、搜项目号，一次命中',
    subtitle: 'M6-1.0x8 ≡ M6x8 ≡ 6x8 · 12 位项目号',
    image: '',
    target: 'mall',
    badge: '检索',
    sortNo: 20,
  },
  {
    id: 'ad-pass',
    title: '一张通行证通行全部星域',
    subtitle: '登录即签发 · 唯一公民编号',
    image: '',
    target: 'me',
    badge: '通行证',
    sortNo: 30,
  },
];

/**
 * 推荐分类的默认色板：目录源没有分类配图，用固定色块保证视觉区分；
 * 取不到时回落到品牌青，绝不返回空字符串（前端会当背景色直接用）。
 */
const RECOMMEND_COVER_COLORS = ['#0f9d8f', '#1f6feb', '#c2410c', '#6d28d9', '#0e7490', '#b45309'];

/** 逗号分隔的多选参数（源站 ctgs/trts 形态）：去空白、去重、丢空；空数组表示不过滤。 */
function parseMultiValues(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((v) => v.trim()).filter(Boolean))];
}

/** 单行金额：有厘/支精确价时用它（1 分 = 10 厘），否则回落到旧的分/件口径。 */
function lineTotalFen(product: Pick<ProductRecord, 'priceFen' | 'priceLi'>, quantity: number): number {
  const li = product.priceLi;
  if (li != null && li > 0) return Math.round((li * quantity) / 10);
  return product.priceFen * quantity;
}

/** 购买方式回显，如「2箱」「3盒」。 */
function unitLabel(product: ProductRecord, packUnit: string, packQty: number): string {
  const name = product.unitOptions?.find((u) => u.code === packUnit)?.name ?? packUnit;
  return `${packQty}${name}`;
}

/**
 * 单行折扣额（整数分）。
 * 源站 disD2N2 / tejiaD2N2 是「折后价百分比」（85 表示按面价 85% 成交），
 * 因此减免比例 = 100 - percent。
 * 取整规则：Math.round 四舍五入到分 —— 面价以厘存储、换算到分可能带小数，
 * 这里只在成行折扣处取整一次，避免后续浮点累加。
 */
function discountFenOf(faceFen: number, percent: number): number {
  if (!(percent > 0) || percent >= 100) return 0;
  return Math.round((faceFen * (100 - percent)) / 100);
}

/** 金额（分）转展示用元字符串，仅用于满减提示文案，不参与计算。 */
function yuanText(fen: number): string {
  return (fen / 100).toFixed(2);
}

/**
 * 对外商品 DTO 剥离上游溯源字段（sourceUrl / priceSource / priceCapturedAt）：
 * 这三项只供内部采集链路与管理面核对，公开读接口不再下发。
 */
function stripUpstreamFields(dto: ProductDto): ProductDto {
  const publicDto: ProductDto = { ...dto };
  delete publicDto.sourceUrl;
  delete publicDto.priceSource;
  delete publicDto.priceCapturedAt;
  return publicDto;
}

export type ImportReport = {
  batch: string;
  source?: string;
  crawledAt?: string;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  /** 本次落到本地 /media/products/ 下、并挂到商品上的图片数 */
  imagesLocalized: number;
  byCategory: ImportCategoryCount[];
  failures: Array<{ sourceKey: string; reason: string }>;
};

/**
 * 商城域服务：商品 → 购物车 → 订单。
 * 库存扣减放在下单时做，扣减失败即整单失败，避免超卖。
 */
export class MallService {
  private readonly ids: IdFactory;

  constructor(
    private readonly config: Config,
    private readonly store: Store,
    /** 内嵌只读目录源；不传（如单元测试直接 new MallService）时一律走数据库路径。 */
    private readonly catalog?: CatalogSource,
  ) {
    this.ids = new IdFactory({ workerId: config.ids.workerId });
  }

  /** 目录源是否接管公开读：off / 未注入 / DB 已有真实目录数据时为 false。 */
  private async useCatalog(): Promise<boolean> {
    return this.catalog ? this.catalog.isActive() : false;
  }

  /**
   * 源站明确停售/下架/无货：这条信号可信，tier 模式下也硬拦。
   * `MALL_SOURCE_STOCK_GATE=false` 时一律不拦（一键回退到旧放行行为）。
   */
  private explicitUnavailable(product: ProductRecord): boolean {
    if (this.config.mall.sourceStockMode === 'off') return false;
    const status = product.sourceInvStatus?.trim();
    if (!status) return false;
    return /无货|下架|停售/.test(status);
  }

  /**
   * 是否按源站状态拦截下单。
   * - off：不拦
   * - strict：旧口径，缺货/无货/下架/停售一律拦
   * - tier（默认）：只拦明确停售/下架/无货，「缺货」交给 inferredScarce 分级处理
   */
  private sourceUnavailable(product: ProductRecord): boolean {
    const mode = this.config.mall.sourceStockMode;
    if (mode === 'off') return false;
    if (mode === 'strict') {
      const status = product.sourceInvStatus?.trim();
      return !!status && /缺货|无货|下架|停售/.test(status);
    }
    return this.explicitUnavailable(product);
  }

  /**
   * 仅由匿名视图推断的缺货：库存为 0，或状态只写了「缺货」，但没有停售/下架这类
   * 明确信号。tier 模式下不硬拦，按「货源待确认」放行并打标，交由人工确认。
   */
  private inferredScarce(product: ProductRecord): boolean {
    if (this.config.mall.sourceStockMode !== 'tier') return false;
    if (this.sourceUnavailable(product)) return false;
    const status = product.sourceInvStatus?.trim() ?? '';
    return /缺货/.test(status) || product.stock <= 0;
  }

  /** 综合可售：明确停售不可售；tier 模式下推断缺货仍可售（打「货源待确认」标）。 */
  private isInStock(product: ProductRecord): boolean {
    if (this.sourceUnavailable(product)) return false;
    if (this.config.mall.sourceStockMode === 'tier') return true;
    return product.stock > 0;
  }

  /** 货源可信度标记：仅「推断缺货」时下发，前端据此显示「货源待确认」。 */
  private stockConfidence(product: ProductRecord): 'inferred' | undefined {
    return this.inferredScarce(product) ? 'inferred' : undefined;
  }

  /**
   * 数量上限校验：tier 模式下「推断缺货」商品的 stock 只是估算（或恒为 0），
   * 不做真实库存硬上限，只保留 maxOrderQty；其余仍按真实库存拦。
   */
  private assertStockEnough(product: ProductRecord, quantity: number): void {
    if (quantity > product.maxOrderQty!) throw AppError.conflict('单个商品数量超出上限');
    if (this.inferredScarce(product)) return;
    if (quantity > product.stock) throw AppError.conflict(`${product.title} 库存不足`);
  }

  /**
   * 源站目录商品判定：只有源站镜像商品（有 priceSource / sourceUrl / sourceKey）才存在
   * 「登录后可见」的价格与库存口径。本地自建商品保持旧契约，避免影响既有接口消费方。
   */
  private isSourceCatalogProduct(product: {
    priceSource?: ProductRecord['priceSource'];
    sourceUrl?: string | null;
    sourceKey?: string | null;
  }): boolean {
    return product.priceSource != null || product.sourceUrl != null || product.sourceKey != null;
  }

  /**
   * 源站登录可见门禁（对应 /b2b/ 列表 15 列规则）：
   * 未登录时 `disbasePrc`（折后千支价）、`bpInvQty`（库存）、`invStatus`（库存状态）
   * 在源站前端都渲染为「登录可见」，不暴露真实数值。
   * 这里只在下发前屏蔽敏感字段，`MALL_SOURCE_STOCK_GATE` 三档判定本身不受影响；
   * 面价 `basePrcD3N2`（priceLi）与商城折扣 `disD2N2`（discountPct）保持公开。
   */
  private maskForAnonymous(dto: ProductDto): ProductDto {
    // salePriceLi 是「面价 × 折扣」的折后价，与 disbasePrc 等价，匿名视角一并屏蔽
    const masked: ProductDto = { ...dto, stock: 0, loginVisibleRequired: true };
    delete masked.salePriceLi;
    delete masked.sourceInvStatus;
    delete masked.stockConfidence;
    delete masked.inStock;
    return masked;
  }

  /**
   * 按查看者登录态套用门禁：登录正常下发；匿名只对源站目录商品屏蔽。
   * `sourceCatalog` 由调用方按内部记录（含已被剥离的溯源字段）预先判定，
   * 避免对外 DTO 剥离 sourceUrl/priceSource 后判定失效。
   */
  private applyViewerGate(dto: ProductDto, loggedIn: boolean, sourceCatalog?: boolean): ProductDto {
    if (loggedIn) return dto;
    const isSource = sourceCatalog ?? this.isSourceCatalogProduct(dto);
    if (!isSource) return dto;
    return this.maskForAnonymous(dto);
  }

  private toProductDto(product: ProductRecord, loggedIn: boolean): ProductDto {
    const stockConfidence = this.stockConfidence(product);
    const dto: ProductDto = {
      id: product.id,
      title: product.title,
      subtitle: product.subtitle,
      priceFen: product.priceFen,
      originalPriceFen: product.originalPriceFen,
      stock: product.stock,
      category: product.category,
      cover: product.cover,
      images: product.images,
      tags: product.tags,
      description: product.description,
      createdAt: product.createdAt.toISOString(),
      ...(product.brand ? { brand: product.brand } : {}),
      ...(product.categoryPath?.length ? { categoryPath: product.categoryPath } : {}),
      ...(product.categoryName ? { categoryName: product.categoryName } : {}),
      ...(product.specs && Object.keys(product.specs).length ? { specs: product.specs } : {}),
      ...(product.unit ? { unit: product.unit } : {}),
      ...(product.packQty != null ? { packQty: product.packQty } : {}),
      ...(product.priceLi != null ? { priceLi: product.priceLi } : {}),
      ...(product.discountPct != null ? { discountPct: product.discountPct } : {}),
      ...(product.salePriceLi != null ? { salePriceLi: product.salePriceLi } : {}),
      // 源站 tejiaD2N2（特价折扣）：有值时前端把商城折扣划掉并展示特价折扣
      ...(product.tejiaDiscountPct != null && product.tejiaDiscountPct > 0
        ? { tejiaDiscountPct: product.tejiaDiscountPct }
        : {}),
      ...(product.attributes && Object.keys(product.attributes).length
        ? { attributes: product.attributes }
        : {}),
      ...(product.promotions?.length ? { promotions: product.promotions } : {}),
      ...(product.packagingDesc ? { packagingDesc: product.packagingDesc } : {}),
      ...(product.unitOptions?.length ? { unitOptions: product.unitOptions } : {}),
      ...(product.unitConversions && Object.keys(product.unitConversions).length
        ? { unitConversions: product.unitConversions }
        : {}),
      ...(product.specImage ? { specImage: product.specImage } : {}),
      ...(product.minOrderQty != null ? { minOrderQty: product.minOrderQty } : {}),
      ...(product.qtyStep != null ? { qtyStep: product.qtyStep } : {}),
      ...(product.maxOrderQty != null ? { maxOrderQty: product.maxOrderQty } : {}),
      ...(product.sourceInvStatus ? { sourceInvStatus: product.sourceInvStatus } : {}),
      ...(stockConfidence ? { stockConfidence } : {}),
      inStock: this.isInStock(product),
    };
    // 源站登录门禁：匿名视角屏蔽折后价 / 库存 / 库存状态；
    // 再用内部记录判定源站商品（对外 DTO 已不含溯源字段），最后剥离溯源字段下发。
    return stripUpstreamFields(
      this.applyViewerGate(dto, loggedIn, this.isSourceCatalogProduct(product)),
    );
  }

  private toOrderItemDto(item: OrderItemRecord): OrderItemDto {
    return {
      productId: item.productId,
      title: item.title,
      priceFen: item.priceFen,
      quantity: item.quantity,
      subtotalFen: item.subtotalFen,
      ...(item.packUnit ? { packUnit: item.packUnit } : {}),
      ...(item.packQty != null ? { packQty: item.packQty } : {}),
      ...(item.priceLi != null ? { priceLi: item.priceLi } : {}),
      ...(item.stockUnconfirmed ? { stockUnconfirmed: true } : {}),
      // 0017 行状态快照：下单时是 A，历史订单缺省也按 A 回显
      ...(item.lineStatus ? { lineStatus: item.lineStatus } : {}),
    };
  }

  private toOrderDto(
    order: OrderRecord,
    items: OrderItemRecord[],
    skippedLines?: SkippedCartLineDto[],
  ): OrderDto {
    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      totalFen: order.totalFen,
      // 0017 三层优惠快照；历史订单没有这些字段时按 0 回显
      subtotalFen: order.subtotalFen ?? 0,
      mallDiscountFen: order.mallDiscountFen ?? 0,
      tejiaDiscountFen: order.tejiaDiscountFen ?? 0,
      manjianDiscountFen: order.manjianDiscountFen ?? 0,
      discountTotalFen: order.discountTotalFen ?? 0,
      receiverName: order.receiverName,
      receiverPhone: order.receiverPhone,
      address: order.address,
      remark: order.remark,
      addressId: order.addressId,
      deliveryMethod: order.deliveryMethod,
      deliverySlot: order.deliverySlot,
      items: items.map((item) => this.toOrderItemDto(item)),
      // 失效行只在创建订单的响应里返回，列表/详情不带
      ...(skippedLines?.length ? { skippedLines } : {}),
      // 0018 六态流转时间与取消留痕：历史订单统一按 null 回显，前端据此判断能否取消
      pickingAt: order.pickingAt ? order.pickingAt.toISOString() : null,
      shippedAt: order.shippedAt ? order.shippedAt.toISOString() : null,
      completedAt: order.completedAt ? order.completedAt.toISOString() : null,
      cancelledAt: order.cancelledAt ? order.cancelledAt.toISOString() : null,
      cancelReason: order.cancelReason ?? null,
      cancelledBy: order.cancelledBy ?? null,
      createdAt: order.createdAt.toISOString(),
    };
  }

  async listProducts(query: ProductQueryInput, loggedIn: boolean): Promise<ProductDto[]> {
    if (await this.useCatalog()) {
      const rows = this.catalog!.listProducts(query);
      return rows.map((row) => stripUpstreamFields(this.applyViewerGate(row, loggedIn)));
    }
    // ctgs/trts 是源站 ccc_filter 的多选维度：逗号分隔，多值 OR；与其它维度 AND。
    const ctgs = parseMultiValues(query.ctgs);
    const trts = parseMultiValues(query.trts);
    const rows = await this.store.mall.products.list({
      ...(query.category ? { category: query.category } : {}),
      ...(query.cat ? { cat: query.cat } : {}),
      ...(ctgs.length ? { ctgs } : {}),
      ...(query.dims ? { dims: query.dims } : {}),
      ...(query.lens ? { lens: query.lens } : {}),
      ...(query.brand ? { brand: query.brand } : {}),
      ...(query.std ? { std: query.std } : {}),
      ...(query.grd ? { grd: query.grd } : {}),
      ...(query.mtl ? { mtl: query.mtl } : {}),
      ...(query.ttt ? { ttt: query.ttt } : {}),
      ...(trts.length ? { trts } : {}),
      ...(query.keyword ? { keyword: query.keyword } : {}),
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    return rows.map((row) => this.toProductDto(row, loggedIn));
  }

  async getProduct(productId: string, loggedIn: boolean): Promise<ProductDto> {
    if (await this.useCatalog()) {
      const fromCatalog = this.catalog!.getProduct(productId);
      if (fromCatalog) return stripUpstreamFields(this.applyViewerGate(fromCatalog, loggedIn));
      // 目录源未命中时回退数据库，兼容仍指向库内旧商品的详情链接。
    }
    const product = await this.store.mall.products.findById(productId);
    if (!product) throw AppError.notFound('商品不存在或已下架');
    return this.toProductDto(product, loggedIn);
  }

  /** 公开分类聚合：目录源激活时只返回 6 个真实中文类目；否则走数据层全量聚合并剔除演示分类。 */
  async listCategories(): Promise<ImportCategoryCount[]> {
    if (await this.useCatalog()) return this.catalog!.listCategories();
    const rows = await this.store.mall.products.aggregateCategories();
    const real = rows.filter((row) => !DEMO_CATEGORY_CODES.has(row.code));
    return [...real].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  }

  /** 首页广告位（home/ggs）：内置运营位按 sortNo 升序下发，返回副本避免调用方改到常量。 */
  async listHomeAds(): Promise<HomeAdDto[]> {
    return [...HOME_ADS].sort((a, b) => a.sortNo - b.sortNo).map((ad) => ({ ...ad }));
  }

  /**
   * 首页推荐分类（home/rcs）：取真实目录商品数最多的前 N 个一级分类。
   * 与 listCategories() 同源（目录源优先、演示类目已剔除），因此不会推荐出空类目。
   */
  async listRecommendedCategories(limit = 6): Promise<HomeRecommendedCategoryDto[]> {
    const categories = await this.listCategories();
    const size = Math.max(1, Math.floor(limit));
    return categories
      .filter((category) => category.count > 0)
      .slice(0, size)
      .map((category, index) => ({
        code: category.code,
        name: category.name,
        count: category.count,
        cover: RECOMMEND_COVER_COLORS[index % RECOMMEND_COVER_COLORS.length] ?? '#0f9d8f',
      }));
  }

  /** 分类树下一层：parent 为空取一级，否则取该节点直接子级；includeEmpty 连 0 商品节点一起返回。 */
  async listCategoryChildren(
    parent: string | null,
    opts?: { includeEmpty?: boolean },
  ): Promise<CategoryNode[]> {
    return this.store.mall.products.listChildCategories(parent, opts);
  }

  /** 分类节点（含子孙）下真实存在的筛选候选，用于筛选条展示。 */
  async listSpecOptions(c3: string) {
    return this.store.mall.products.listSpecOptions(c3);
  }

  /**
   * 目录导入：校验 catalog → 图片本地化 → 逐条按 sourceKey 幂等 upsert → 返回统计。
   * HTTP 通道与 CLI 复跑入口共用这一段逻辑，规则不在两处各写一份。
   */
  async importCatalog(
    raw: unknown,
    opts: { batch?: string; sourceImagesDir?: string } = {},
  ): Promise<ImportReport> {
    const catalog = parse(importCatalogSchema, raw);
    const batch = opts.batch ?? catalog.batch ?? `import-${Date.now().toString(36)}`;
    const categoryNames = new Map((catalog.categories ?? []).map((c) => [c.code, c.name]));

    // 命名去歧义：同一三级分类（categoryPath 末级）下原始 title 重复时追加可区分后缀，保证分类内 title 唯一。
    // 判重始终基于 catalog 原始名（item.name），不读库里已加过后缀的名字，重复导入不会叠加第二层后缀。
    const leafOf = (item: ImportProductInput): string =>
      item.categoryPath.length ? item.categoryPath[item.categoryPath.length - 1]! : item.categoryCode;
    const duplicateGroups = new Map<string, ImportProductInput[]>();
    for (const item of catalog.products) {
      const key = `${leafOf(item)}§${item.name}`;
      const members = duplicateGroups.get(key);
      if (members) members.push(item);
      else duplicateGroups.set(key, [item]);
    }
    const disambiguatedTitles = new Map<string, string>();
    for (const members of duplicateGroups.values()) {
      if (members.length === 1) continue;
      // 先统计组内包装取值出现次数：包装能区分（组内唯一）才用作后缀，否则整组退化到货号末 6 位。
      const packagingCount = new Map<string, number>();
      for (const item of members) {
        const packaging = item.specs?.['包装']?.trim() ?? '';
        packagingCount.set(packaging, (packagingCount.get(packaging) ?? 0) + 1);
      }
      const usedTitles = new Set<string>();
      for (const item of members) {
        const packaging = item.specs?.['包装']?.trim() ?? '';
        const tail = (item.sourceId ?? item.sourceKey ?? '').slice(-6);
        const packagingUnique = packaging !== '' && packagingCount.get(packaging) === 1;
        let title = packagingUnique ? `${item.name} · ${packaging}` : `${item.name} · 货号${tail}`;
        // 包装在组内仍相同（如同为「1箱=1支」）时退化到货号末 6 位；再撞则追加序号兜底。
        if (usedTitles.has(title)) title = `${item.name} · 货号${tail}`;
        if (usedTitles.has(title)) title = `${item.name} · 货号${tail}-${usedTitles.size + 1}`;
        usedTitles.add(title);
        disambiguatedTitles.set(item.sourceKey, title);
      }
    }

    const localRoot = resolve(this.config.storage.localDir);
    const productsDir = join(localRoot, 'products');
    // staged 形如 `images/<sha1>.<ext>`，相对抓取端 source/ 目录解析（source/images/ 下）。
    const sourceRoot = opts.sourceImagesDir
      ? resolve(opts.sourceImagesDir)
      : join(projectRoot(), 'tools', 'egluosi-importer', 'source');

    const report: ImportReport = {
      batch,
      ...(catalog.source ? { source: catalog.source } : {}),
      ...(catalog.crawledAt ? { crawledAt: catalog.crawledAt } : {}),
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      imagesLocalized: 0,
      byCategory: [],
      failures: [],
    };
    const runCategories = new Map<string, ImportCategoryCount>();
    // 单批 catalog 可能有数万条：内部按 5000/批分片循环，HTTP 与 CLI 共用同一逻辑；
    // 统计（inserted/updated/skipped/failed/imagesLocalized/byCategory）跨片累加。
    const BATCH_SIZE = 5000;

    for (let start = 0; start < catalog.products.length; start += BATCH_SIZE) {
      const slice = catalog.products.slice(start, start + BATCH_SIZE);
      for (const item of slice) {
      try {
        const localized = await this.localizeImages(item.images, sourceRoot, productsDir);
        report.imagesLocalized += localized.urls.length;
        const categoryName = categoryNames.get(item.categoryCode) ?? item.categoryPath[0] ?? null;
        const record: ProductRecord = {
          id: this.ids.next().id,
          title: disambiguatedTitles.get(item.sourceKey) ?? item.name,
          subtitle: item.subtitle,
          priceFen: item.priceFen ?? 0,
          originalPriceFen: 0,
          stock: item.stock,
          category: item.categoryCode,
          cover: localized.cover ?? '#0f9d8f',
          images: localized.urls,
          tags: item.brand ? [item.brand] : [],
          description: item.description,
          sortNo: 0,
          createdAt: new Date(),
          sourceKey: item.sourceKey,
          sourceUrl: item.sourceUrl,
          sourceId: item.sourceId,
          brand: item.brand || null,
          categoryPath: item.categoryPath,
          categoryName,
          specs: item.specs,
          unit: item.unit || null,
          packQty: item.packQty ?? null,
          priceSource: item.priceSource,
          priceCapturedAt: item.priceCapturedAt,
          stockSource: item.stockSource,
          importBatch: batch,
        };
        const { action } = await this.store.mall.products.upsert(record);
        if (action === 'inserted') report.inserted += 1;
        else report.updated += 1;

        const cat = runCategories.get(item.categoryCode);
        if (cat) cat.count += 1;
        else
          runCategories.set(item.categoryCode, {
            code: item.categoryCode,
            name: categoryName ?? item.categoryCode,
            count: 1,
          });
      } catch (error) {
        report.failed += 1;
        report.failures.push({
          sourceKey: item.sourceKey,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      }
    }

    report.byCategory = [...runCategories.values()].sort(
      (a, b) => b.count - a.count || a.code.localeCompare(b.code),
    );
    return report;
  }

  /**
   * 把 source/images 下已下载的图复制到本地存储 products/ 目录；已存在则跳过（幂等）。
   * 商品数据里只写 `/media/products/<文件名>`，绝不保留站点图床热链；staged 为空或源图缺失一律跳过。
   */
  private async localizeImages(
    images: ImportProductInput['images'],
    sourceRoot: string,
    productsDir: string,
  ): Promise<{ urls: string[]; cover?: string }> {
    const urls: string[] = [];
    let cover: string | undefined;
    for (const img of images) {
      if (!img.staged) continue;
      const base = basename(img.staged);
      const key = `products/${base}`;
      if (!isSafeStorageKey(key)) continue;
      const src = resolve(sourceRoot, img.staged);
      if (!src.startsWith(sourceRoot + sep)) continue;
      if (!existsSync(src)) continue;
      const dest = resolve(productsDir, base);
      if (!existsSync(dest)) {
        await mkdir(dirname(dest), { recursive: true });
        await copyFile(src, dest);
      }
      const publicUrl = `/media/products/${base}`;
      urls.push(publicUrl);
      if (img.role === 'cover' && !cover) cover = publicUrl;
    }
    if (!cover && urls.length) cover = urls[0];
    return { urls, cover };
  }

  /**
   * 源站行状态四态（购物车口径）：R 需求 / L 缺货 / A 到货 / X 下架。
   * 判定顺序固定为 X → R → L → A，且直接复用库存三档判定，保证既有行为不变：
   * 1) X：商品已下架，或源站状态明确写「下架/停售」——三档模式都硬拦；
   * 2) R：询价商品 / 0 元商品——需人工报价后才能下单；
   * 3) L：按当前库存三档口径不可售（strict 的缺货/无货、off 的 0 库存等）；
   * 4) A：其余可售。tier 模式下仅「匿名视图推断缺货」的行仍归 A，
   *    同时带 stockConfidence='inferred'，前端展示「货源待确认 · 可结算」。
   * 只有 A 可勾选结算，L/R/X 都属于失效行。
   */
  private cartLineStatus(product: ProductRecord): CartLineStatus {
    const status = product.sourceInvStatus?.trim() ?? '';
    if (product.listed === false || /下架|停售/.test(status)) return 'X';
    if (product.priceSource === 'inquiry' || product.priceFen <= 0) return 'R';
    if (!this.isInStock(product)) return 'L';
    return 'A';
  }

  /**
   * 单行三层优惠拆解（全部整数分）。
   * - faceFen：面价小计，沿用 lineTotalFen 的厘→分四舍五入口径；
   * - 商城优惠 vs 特价优惠：源站口径是替代关系（tejiaD2N2 出现时商城折扣被划掉），
   *   因此取减免更多的一层，不叠加；两层都记在各自字段里，便于并列展示。
   */
  private lineDiscounts(
    product: ProductRecord,
    quantity: number,
  ): { faceFen: number; mallDiscountFen: number; tejiaDiscountFen: number; netFen: number } {
    const faceFen = lineTotalFen(product, quantity);
    const mall = discountFenOf(faceFen, product.discountPct ?? 0);
    const tejia = discountFenOf(faceFen, product.tejiaDiscountPct ?? 0);
    const mallDiscountFen = mall >= tejia ? mall : 0;
    const tejiaDiscountFen = tejia > mall ? tejia : 0;
    return {
      faceFen,
      mallDiscountFen,
      tejiaDiscountFen,
      netFen: faceFen - mallDiscountFen - tejiaDiscountFen,
    };
  }

  /**
   * 三层优惠汇总：商城 + 特价 + 满减 → 优惠合计与应付总额。
   * 满减按 netFen（扣完商城/特价后）匹配档位 `min~max → percent%`，
   * 取整规则：Math.floor 向下取整到分 —— percent 是「最多减免」语义，
   * 向下取整保证减免额不超过档位比例，也不会把应付总额减成负数。
   */
  private buildPricing(
    rows: Array<{ faceFen: number; mallDiscountFen: number; tejiaDiscountFen: number; netFen: number }>,
    tiers: ManjianTierRecord[],
  ): CartPricingDto {
    const subtotalFen = rows.reduce((sum, row) => sum + row.faceFen, 0);
    const mallDiscountFen = rows.reduce((sum, row) => sum + row.mallDiscountFen, 0);
    const tejiaDiscountFen = rows.reduce((sum, row) => sum + row.tejiaDiscountFen, 0);
    const netFen = rows.reduce((sum, row) => sum + row.netFen, 0);
    const tierDtos: ManjianTierDto[] = tiers.map((tier) => ({
      minFen: tier.minFen,
      maxFen: tier.maxFen,
      percent: tier.percent,
      label: tier.label,
    }));
    const hit = matchManjianTier(netFen, tierDtos);
    const manjianDiscountFen = hit ? Math.floor((netFen * hit.percent) / 100) : 0;
    const discountTotalFen = mallDiscountFen + tejiaDiscountFen + manjianDiscountFen;
    // 命中档位提示：已是最高 percent 的档位时提示「已享受最高折扣」
    const topPercent = tierDtos.reduce((max, tier) => Math.max(max, tier.percent), 0);
    const manjianTip = hit
      ? hit.percent >= topPercent
        ? `已享受最高折扣 ${hit.percent}%，再减 ¥${yuanText(manjianDiscountFen)}`
        : `已享受满减 ${hit.percent}%，再减 ¥${yuanText(manjianDiscountFen)}`
      : '';
    return {
      subtotalFen,
      mallDiscountFen,
      tejiaDiscountFen,
      manjianDiscountFen,
      discountTotalFen,
      // 应付总额 = 面价小计 - 优惠合计；向下取整后仍兜底不小于 0
      payableFen: Math.max(0, subtotalFen - discountTotalFen),
      manjianTier: hit,
      manjianTip,
      tiers: tierDtos,
    };
  }

  async getCart(userId: string): Promise<CartDto> {
    const items = await this.store.mall.carts.listByUser(userId);
    const tiers = await this.store.mall.manjianTiers.listEnabled();
    const lines: CartLineDto[] = [];
    for (const item of items) {
      const product = await this.store.mall.products.findById(item.productId);
      if (!product) continue;
      const stockConfidence = this.stockConfidence(product);
      const lineStatus = this.cartLineStatus(product);
      const statusText = CART_LINE_STATUS_TEXT[lineStatus];
      const discounts = this.lineDiscounts(product, item.quantity);
      lines.push({
        productId: product.id,
        title: product.title,
        cover: product.cover,
        priceFen: product.priceFen,
        quantity: item.quantity,
        stock: product.stock,
        // 面价口径不变：小计仍是厘→分四舍五入后的面价
        subtotalFen: discounts.faceFen,
        ...(item.packUnit ? { packUnit: item.packUnit } : {}),
        ...(item.packQty != null ? { packQty: item.packQty } : {}),
        ...(product.priceLi != null ? { priceLi: product.priceLi } : {}),
        ...(product.unit ? { unitName: product.unit } : {}),
        ...(item.packUnit && item.packQty != null
          ? { packLabel: unitLabel(product, item.packUnit, item.packQty) }
          : {}),
        ...(product.sourceInvStatus ? { sourceInvStatus: product.sourceInvStatus } : {}),
        ...(stockConfidence ? { stockConfidence } : {}),
        // 四态与可勾选性：只有 A 可结算
        lineStatus,
        selectable: lineStatus === 'A',
        lineStatusText: statusText.label,
        lineStatusHint: statusText.hint,
        faceFen: discounts.faceFen,
        netFen: discounts.netFen,
        mallDiscountFen: discounts.mallDiscountFen,
        tejiaDiscountFen: discounts.tejiaDiscountFen,
        inStock: lineStatus === 'A',
      });
    }
    // 三层优惠只统计可结算的 A 态行；失效行不参与优惠与应付
    const pricing = this.buildPricing(
      lines.filter((line) => line.selectable).map((line) => ({
        faceFen: line.faceFen ?? 0,
        mallDiscountFen: line.mallDiscountFen ?? 0,
        tejiaDiscountFen: line.tejiaDiscountFen ?? 0,
        netFen: line.netFen ?? 0,
      })),
      tiers,
    );
    return {
      items: lines,
      totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
      totalFen: lines.reduce((sum, line) => sum + line.subtotalFen, 0),
      pricing,
    };
  }

  /** 箱/盒购买时，以商品换算表把包装数展开成支数；换算缺失时退回前端传来的数量。 */
  private resolveQuantity(
    product: ProductRecord,
    quantity: number,
    packUnit?: string,
    packQty?: number,
  ): number {
    if (!packUnit || packQty == null) return quantity;
    const conv = product.unitConversions?.[packUnit];
    return conv && conv > 0 ? conv * packQty : quantity;
  }

  /**
   * 询价商品（priceSource='inquiry'）或 0 元商品不允许加购/下单。
   * 前端已按 priceSource/priceFen 隐藏入口，这里是服务端二次兜底，避免 0 元单落地。
   */
  private assertOrderable(product: ProductRecord): void {
    if (product.listed === false) {
      throw AppError.conflict(`${product.title} 已下架，暂不可购买`);
    }
    if (this.sourceUnavailable(product)) {
      throw AppError.conflict(`${product.title} 源站显示${product.sourceInvStatus}，暂不可购买`);
    }
    if (product.priceSource === 'inquiry' || product.priceFen <= 0) {
      throw AppError.conflict(`${product.title} 需询价，暂不支持直接下单`);
    }
  }

  async addToCart(
    userId: string,
    productId: string,
    quantity: number,
    packUnit?: string,
    packQty?: number,
  ): Promise<CartDto> {
    const product = await this.store.mall.products.findById(productId);
    if (!product) {
      // 目录源命中但库里没有：商品尚未 catalog:sync 入库，属于「稍后重试」而非「已下架」，
      // 两种情况的下一步动作不同，文案必须分开（状态码保持 404，不改既有契约）。
      if (await this.useCatalog()) {
        const fromCatalog = this.catalog!.getProduct(productId);
        if (fromCatalog) throw AppError.notFound('该商品尚未同步到本地，请稍后');
      }
      throw AppError.notFound('商品不存在或已下架');
    }
    this.assertOrderable(product);
    const addQty = this.resolveQuantity(product, quantity, packUnit, packQty);
    const existing = await this.store.mall.carts.find(userId, productId);
    const nextQuantity = (existing?.quantity ?? 0) + addQty;
    this.assertStockEnough(product, nextQuantity);

    const now = new Date();
    const item: CartItemRecord = {
      id: existing?.id ?? this.ids.next().id,
      userId,
      productId,
      quantity: nextQuantity,
      packUnit: packUnit ?? existing?.packUnit ?? null,
      packQty: packQty ?? existing?.packQty ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.store.mall.carts.upsert(item);
    return this.getCart(userId);
  }

  async updateCartQuantity(
    userId: string,
    productId: string,
    quantity: number,
    packUnit?: string,
    packQty?: number,
  ): Promise<CartDto> {
    const existing = await this.store.mall.carts.find(userId, productId);
    if (!existing) throw AppError.notFound('购物车里没有该商品');
    const product = await this.store.mall.products.findById(productId);
    if (!product) throw AppError.notFound('商品不存在或已下架');
    this.assertOrderable(product);
    const nextQuantity = this.resolveQuantity(product, quantity, packUnit, packQty);
    this.assertStockEnough(product, nextQuantity);
    await this.store.mall.carts.upsert({
      ...existing,
      quantity: nextQuantity,
      packUnit: packUnit ?? existing.packUnit ?? null,
      packQty: packQty ?? existing.packQty ?? null,
      updatedAt: new Date(),
    });
    return this.getCart(userId);
  }

  async removeFromCart(userId: string, productId: string): Promise<CartDto> {
    await this.store.mall.carts.remove(userId, productId);
    return this.getCart(userId);
  }

  async clearCart(userId: string): Promise<CartDto> {
    await this.store.mall.carts.clear(userId);
    return this.getCart(userId);
  }

  async createOrder(userId: string, input: OrderCreateInput, idempotencyKey?: string): Promise<OrderDto> {
    // 幂等：先抢占键再落单，重试拿回同一张订单，不会重复扣库存
    if (idempotencyKey) {
      const claim = await this.store.mall.orderRequests.claim(userId, idempotencyKey);
      if (!claim.claimed) {
        if (!claim.orderNo) throw AppError.conflict('同一请求正在处理中，请稍后重试');
        return this.getOrder(userId, claim.orderNo);
      }
      try {
        const order = await this.placeOrder(userId, input);
        await this.store.mall.orderRequests.attach(userId, idempotencyKey, order.orderNo);
        return order;
      } catch (error) {
        await this.store.mall.orderRequests.release(userId, idempotencyKey);
        throw error;
      }
    }
    return this.placeOrder(userId, input);
  }

  private async placeOrder(userId: string, input: OrderCreateInput): Promise<OrderDto> {
    // 结算必填项（源站口径）：
    // 1) 选中地址簿地址时先查可达性，不可达在下单前拦住并返回原因；
    // 2) 配送方式 + 时间段必须属于源站可选组合。
    // 两者都只在「传了」时才校验，保证不带这些字段的旧下单调用行为不变。
    let receiverName = input.receiverName;
    let receiverPhone = input.receiverPhone;
    let addressText = input.address;
    let addressId: string | null = null;
    if (input.addressId) {
      const saved = await this.store.mall.addresses.findById(userId, input.addressId);
      if (!saved) throw AppError.notFound('收货地址不存在，请重新选择');
      const reach = checkReachability({ ...saved, deliveryMethod: input.deliveryMethod });
      if (!reach.reachable) {
        throw new AppError('BAD_REQUEST', reach.reason ?? '该收货地址暂不可达，请更换地址');
      }
      // 地址快照：写入订单行，之后地址簿被改动或删除都不影响历史订单
      receiverName = saved.receiverName;
      receiverPhone = saved.receiverPhone;
      addressText = `${saved.province}${saved.city}${saved.district}${saved.detail}`;
      addressId = saved.id;
    }
    if (input.deliveryMethod) {
      assertDeliverySelection(input.deliveryMethod, input.deliverySlot ?? '');
    }

    // 结算来源：优先用显式标记；未传时保持旧口径（没传 items 视为整车结算）。
    // 前端从购物车勾选结算也会传 items，因此不能用「有没有 items」反推来源。
    const fromCart = input.fromCart ?? !input.items;
    // 下单拆有效行（源站口径）：只有 A（到货）行能进单；
    // R 需求 / L 缺货 / X 下架 一律拆到 skippedLines，随响应返回给用户明确说明。
    const skippedLines: SkippedCartLineDto[] = [];
    let requested: Array<{
      productId: string;
      quantity: number;
      packUnit?: string;
      packQty?: number;
    }>;
    if (input.items) {
      requested = input.items;
    } else {
      const cartItems = await this.store.mall.carts.listByUser(userId);
      requested = [];
      for (const item of cartItems) {
        const product = await this.store.mall.products.findById(item.productId);
        if (!product) {
          skippedLines.push({
            productId: item.productId,
            title: '已下架商品',
            lineStatus: 'X',
            reason: '商品已下架，无法下单',
          });
          continue;
        }
        const status = this.cartLineStatus(product);
        if (status !== 'A') {
          const text = CART_LINE_STATUS_TEXT[status];
          skippedLines.push({
            productId: product.id,
            title: product.title,
            lineStatus: status,
            reason: `${text.label}：${text.hint}`,
          });
          continue;
        }
        requested.push({
          productId: item.productId,
          quantity: item.quantity,
          ...(item.packUnit ? { packUnit: item.packUnit } : {}),
          ...(item.packQty != null ? { packQty: item.packQty } : {}),
        });
      }
    }
    if (requested.length === 0) {
      const detail = skippedLines.length
        ? `：${skippedLines.map((line) => `${line.title}（${line.reason}）`).join('；')}`
        : '';
      throw AppError.conflict(`没有可结算的商品${detail}`);
    }

    const lines: Array<{
      product: ProductRecord;
      quantity: number;
      packUnit?: string | undefined;
      packQty?: number | undefined;
    }> = [];
    const merged = new Map<string, (typeof lines)[number]>();
    for (const line of requested) {
      const product = await this.store.mall.products.findById(line.productId);
      if (!product) throw AppError.notFound(`商品不存在或已下架：${line.productId}`);
      this.assertOrderable(product);
      const quantity = this.resolveQuantity(product, line.quantity, line.packUnit, line.packQty);
      // 同一商品多行（不同购买方式）合并成一行扣库存与计价，避免超卖判断被拆散
      const prev = merged.get(product.id);
      if (prev) prev.quantity += quantity;
      else {
        const entry = {
          product,
          quantity,
          ...(line.packUnit ? { packUnit: line.packUnit } : {}),
          ...(line.packQty != null ? { packQty: line.packQty } : {}),
        };
        merged.set(product.id, entry);
        lines.push(entry);
      }
    }
    for (const line of lines) {
      if (line.quantity > line.product.maxOrderQty!) {
        throw AppError.conflict(`单个商品数量超出上限：${line.product.title}`);
      }
      // 推断缺货：stock 只是估算（或恒为 0），不做硬上限，放行并打「货源待确认」标
      if (this.inferredScarce(line.product)) continue;
      if (line.product.stock < line.quantity) {
        throw AppError.conflict(`库存不足：${line.product.title}`);
      }
    }

    // 三层优惠汇总：商城 + 特价 + 满减，最终 totalFen 落「应付总额」
    const tiers = await this.store.mall.manjianTiers.listEnabled();
    const pricing = this.buildPricing(
      lines.map((line) => this.lineDiscounts(line.product, line.quantity)),
      tiers,
    );

    // 先扣库存再落单：任一失败即整单失败；已扣的那几行必须归还，否则库存会凭空消失。
    // 推断缺货的商品不扣估算库存，改为落单时打标、由人工确认货源。
    const deducted: typeof lines = [];
    try {
      for (const line of lines) {
        if (this.inferredScarce(line.product)) continue;
        const ok = await this.store.mall.products.decrementStock(line.product.id, line.quantity);
        if (!ok) throw AppError.conflict(`库存不足：${line.product.title}`);
        deducted.push(line);
      }
    } catch (error) {
      for (const line of deducted) {
        await this.store.mall.products.restoreStock(line.product.id, line.quantity);
      }
      throw error;
    }

    const totalFen = pricing.payableFen;
    const id = this.ids.next().id;
    const orderNo = `MO${Date.now().toString(36).toUpperCase()}${this.ids.next().snowflake.slice(-6)}`;
    const order: OrderRecord = {
      id,
      orderNo,
      userId,
      status: 'pending',
      totalFen,
      subtotalFen: pricing.subtotalFen,
      mallDiscountFen: pricing.mallDiscountFen,
      tejiaDiscountFen: pricing.tejiaDiscountFen,
      manjianDiscountFen: pricing.manjianDiscountFen,
      discountTotalFen: pricing.discountTotalFen,
      receiverName,
      receiverPhone,
      address: addressText,
      remark: input.remark ?? null,
      addressId,
      deliveryMethod: input.deliveryMethod ?? null,
      deliverySlot: input.deliverySlot ?? null,
      createdAt: new Date(),
      paidAt: null,
    };
    const items: OrderItemRecord[] = lines.map((line) => ({
      id: this.ids.next().id,
      orderId: id,
      productId: line.product.id,
      title: line.product.title,
      priceFen: line.product.priceFen,
      quantity: line.quantity,
      subtotalFen: lineTotalFen(line.product, line.quantity),
      packUnit: line.packUnit ?? null,
      packQty: line.packQty ?? null,
      priceLi: line.product.priceLi ?? null,
      stockUnconfirmed: this.inferredScarce(line.product),
      // 能进单的行一定是 A；状态快照便于历史订单追溯当时口径
      lineStatus: 'A',
    }));

    try {
      await this.store.mall.orders.insert(order, items);
    } catch (error) {
      // 订单落库失败：已扣的库存必须归还，否则库存会凭空消失。
      for (const line of deducted) {
        await this.store.mall.products.restoreStock(line.product.id, line.quantity);
      }
      throw error;
    }
    if (fromCart) {
      // 只清已结算的行：按「用户 + 已下单商品与数量」从购物车行里扣减数量，而不是按商品整行删除。
      // - 未勾选行、四态不可售行（R/L/X）不在 lines 里，自然保留；
      // - 同一商品在下单后又被加购时，多出来的数量必须留在购物车，不能被整行删掉。
      for (const line of lines) {
        const row = await this.store.mall.carts.find(userId, line.product.id);
        if (!row) continue;
        const remain = row.quantity - line.quantity;
        if (remain > 0) {
          await this.store.mall.carts.upsert({ ...row, quantity: remain, updatedAt: new Date() });
        } else {
          await this.store.mall.carts.remove(userId, line.product.id);
        }
      }
    }
    const unconfirmed = items.filter((item) => item.stockUnconfirmed);
    if (unconfirmed.length > 0) {
      // 可读摘要：运营按订单号核对货源，前端/管理端也可据 stockUnconfirmed 取同一批单
      console.warn(
        `[order] 货源待确认 ${orderNo}（${unconfirmed.length} 行）：${unconfirmed
          .map((item) => `${item.title}×${item.quantity}`)
          .join('、')}`,
      );
    }
    if (skippedLines.length > 0) {
      console.warn(
        `[order] 已拆出失效行 ${orderNo}（${skippedLines.length} 行）：${skippedLines
          .map((line) => `${line.title}[${line.lineStatus}]`)
          .join('、')}`,
      );
    }
    return this.toOrderDto(order, items, skippedLines);
  }

  /** 超时取消：待支付且超过 TTL 的订单转为 cancelled，并把库存还回去。 */
  async sweepExpiredOrders(ttlMinutes: number, now: Date = new Date()): Promise<string[]> {
    const before = new Date(now.getTime() - ttlMinutes * 60_000);
    const expired = await this.store.mall.orders.listExpiredPending(before);
    const cancelled: string[] = [];
    for (const order of expired) {
      // 条件取消：只有 still pending 且未进入拣货的才改，避免和「刚好支付成功」抢；
      // 0018 起统一走 cancel()，超时取消记 cancelled_by=system 并落取消原因。
      const ok = await this.store.mall.orders.cancel(order.id, ['pending'], '超时未支付，系统自动取消', 'system');
      if (!ok) continue;
      const items = await this.store.mall.orders.itemsByOrder(order.id);
      for (const item of items) {
        // 下单时未扣估算库存的「货源待确认」行，取消时也不归还，避免库存虚增
        if (item.stockUnconfirmed) continue;
        await this.store.mall.products.restoreStock(item.productId, item.quantity);
      }
      cancelled.push(order.orderNo);
    }
    return cancelled;
  }

  /**
   * 用户侧取消订单（0018 六态状态机）：
   * - pending / paid 可取消；已分配拣货（picking_at 非空）/ 已发货 / 已完成不可取消；
   * - 已取消直接幂等返回现状，不重复归还库存；
   * - 库存归还口径与超时取消完全一致（跳过「货源待确认」行），不改金额口径。
   */
  async cancelOrder(userId: string, orderNo: string, reason?: string): Promise<OrderDto> {
    const order = await this.store.mall.orders.findByOrderNo(orderNo);
    if (!order || order.userId !== userId) throw AppError.notFound('订单不存在');

    // 幂等：重复取消直接回显当前订单
    if (order.status === 'cancelled') {
      const items = await this.store.mall.orders.itemsByOrder(order.id);
      return this.toOrderDto(order, items);
    }
    // 已发货 / 已完成 / 已进入拣货（源站「已分配拣货不可取消」）：给出明确原因。
    // 判定顺序按流程由后往前，保证提示的是最接近当下的状态（shipped 行 picking_at 同样非空）。
    if (order.status === 'completed') throw AppError.conflict('订单已完成，无法取消');
    if (order.status === 'shipped') throw AppError.conflict('订单已发货，无法取消');
    if (order.pickingAt || order.status === 'picking') {
      throw AppError.conflict('订单已分配拣货，无法取消');
    }
    if (order.status !== 'pending' && order.status !== 'paid') {
      throw AppError.conflict('当前订单状态不可取消');
    }

    const text = reason?.trim() || '用户主动取消';
    const ok = await this.store.mall.orders.cancel(order.id, ['pending', 'paid'], text, 'user');

    if (ok) {
      const items = await this.store.mall.orders.itemsByOrder(order.id);
      for (const item of items) {
        // 与超时取消同口径：货源待确认行下单时没扣库存，取消也不归还
        if (item.stockUnconfirmed) continue;
        await this.store.mall.products.restoreStock(item.productId, item.quantity);
      }
    }

    // 并发下可能被别人抢先取消或推进状态：重新读一次，按真实结果决定回显还是报冲突
    const latest = await this.store.mall.orders.findByOrderNo(orderNo);
    if (!latest) throw AppError.notFound('订单不存在');
    if (latest.status !== 'cancelled' && !ok) throw AppError.conflict('订单状态已变化，请刷新后重试');
    const items = await this.store.mall.orders.itemsByOrder(latest.id);
    return this.toOrderDto(latest, items);
  }

  async listOrders(userId: string): Promise<OrderDto[]> {
    const orders = await this.store.mall.orders.listByUser(userId);
    const result: OrderDto[] = [];
    for (const order of orders) {
      const items = await this.store.mall.orders.itemsByOrder(order.id);
      result.push(this.toOrderDto(order, items));
    }
    return result;
  }

  async getOrder(userId: string, orderNo: string): Promise<OrderDto> {
    const order = await this.store.mall.orders.findByOrderNo(orderNo);
    if (!order || order.userId !== userId) throw AppError.notFound('订单不存在');
    const items = await this.store.mall.orders.itemsByOrder(order.id);
    return this.toOrderDto(order, items);
  }

  // ===== 收藏夹（0019）=====

  /** 收藏夹列表：首次访问时懒创建默认收藏夹，存量用户不需要批量补数据 */
  async listFavoriteFolders(userId: string): Promise<FavoriteFolderDto[]> {
    const folders = await this.ensureDefaultFavoriteFolder(userId);
    const counts = await Promise.all(folders.map((folder) => this.store.mall.favorites.countItems(folder.id)));
    return folders.map((folder, i) => this.toFavoriteFolderDto(folder, counts[i] ?? 0));
  }

  /** 条目列表：folderId 省略时取默认收藏夹；只存引用，标题/价格为读时快照 */
  async listFavoriteItems(userId: string, folderId?: string): Promise<FavoriteItemDto[]> {
    const folder = await this.resolveFavoriteFolder(userId, folderId);
    const items = await this.store.mall.favorites.listItems(folder.id);
    if (!items.length) return [];
    const products = await Promise.all(items.map((item) => this.store.mall.products.findById(item.productId)));
    return items.map((item, i) => this.toFavoriteItemDto(item, products[i] ?? null));
  }

  /** 加收藏：同夹内重复收藏按幂等处理（返回已有条目），folderId 省略时落到默认收藏夹 */
  async addFavoriteItem(userId: string, productId: string, folderId?: string): Promise<FavoriteItemDto> {
    const product = await this.store.mall.products.findById(productId);
    if (!product) throw AppError.notFound('商品不存在');
    const folder = await this.resolveFavoriteFolder(userId, folderId);
    const item = await this.store.mall.favorites.insertItem({
      id: this.ids.next().id,
      folderId: folder.id,
      userId,
      productId,
      createdAt: new Date(),
    });
    return this.toFavoriteItemDto(item, product);
  }

  /** 删收藏条目：不存在也按成功返回（幂等） */
  async removeFavoriteItem(userId: string, productId: string, folderId?: string): Promise<boolean> {
    const folder = await this.resolveFavoriteFolder(userId, folderId);
    return this.store.mall.favorites.deleteItem(folder.id, productId);
  }

  /** 清空收藏夹：返回删除条数，收藏夹本身保留 */
  async clearFavoriteFolder(userId: string, folderId: string): Promise<number> {
    const folder = await this.requireOwnFolder(userId, folderId);
    return this.store.mall.favorites.clearItems(folder.id);
  }

  /** 复制收藏夹：同名副本，新夹不抢默认位，条目逐条复制（同夹唯一约束不会重复） */
  async copyFavoriteFolder(userId: string, folderId: string, name?: string): Promise<FavoriteFolderDto> {
    const source = await this.requireOwnFolder(userId, folderId);
    const items = await this.store.mall.favorites.listItems(source.id);
    const now = new Date();
    // 名称上限 40 字符（与迁移里的 check 约束一致），超长直接截断
    const copyName = (name?.trim() || `${source.name} 的副本`).slice(0, 40);
    const copy: FavoriteFolderRecord = {
      id: this.ids.next().id,
      userId,
      name: copyName,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.mall.favorites.insertFolder(copy);
    for (const item of items) {
      await this.store.mall.favorites.insertItem({
        id: this.ids.next().id,
        folderId: copy.id,
        userId,
        productId: item.productId,
        createdAt: now,
      });
    }
    return this.toFavoriteFolderDto(copy, items.length);
  }

  /** 设默认收藏夹：同用户其它夹的默认位由存储层一并清掉 */
  async setDefaultFavoriteFolder(userId: string, folderId: string): Promise<FavoriteFolderDto> {
    const updated = await this.store.mall.favorites.setDefault(userId, folderId);
    if (!updated) throw AppError.notFound('收藏夹不存在');
    const count = await this.store.mall.favorites.countItems(updated.id);
    return this.toFavoriteFolderDto(updated, count);
  }

  private toFavoriteFolderDto(folder: FavoriteFolderRecord, itemCount: number): FavoriteFolderDto {
    return {
      id: folder.id,
      name: folder.name,
      isDefault: folder.isDefault,
      itemCount,
      createdAt: folder.createdAt.toISOString(),
    };
  }

  /** 商品删除后条目仍可能残留引用：此时按「已下架」回显，不抛错 */
  private toFavoriteItemDto(item: FavoriteItemRecord, product: ProductRecord | null): FavoriteItemDto {
    return {
      id: item.id,
      folderId: item.folderId,
      productId: item.productId,
      title: product?.title ?? '商品已下架',
      priceFen: product?.priceFen ?? 0,
      originalPriceFen: product?.originalPriceFen ?? 0,
      cover: product?.cover ?? '',
      images: product?.images ?? [],
      ...(product?.unit ? { unit: product.unit } : {}),
      available: !!product && product.stock > 0 && product.priceSource !== 'inquiry',
      createdAt: item.createdAt.toISOString(),
    };
  }

  /**
   * 懒创建默认收藏夹：
   * - 一个收藏夹都没有 → 建「默认收藏夹」并置默认；
   * - 有收藏夹但没有默认位（历史数据异常）→ 把最早创建的那个置默认。
   */
  private async ensureDefaultFavoriteFolder(userId: string): Promise<FavoriteFolderRecord[]> {
    let folders = await this.store.mall.favorites.listFolders(userId);
    if (folders.length === 0) {
      const now = new Date();
      await this.store.mall.favorites.insertFolder({
        id: this.ids.next().id,
        userId,
        name: DEFAULT_FAVORITE_FOLDER_NAME,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });
      folders = await this.store.mall.favorites.listFolders(userId);
      return folders;
    }
    if (!folders.some((folder) => folder.isDefault)) {
      const fallback = folders[0];
      if (!fallback) return folders;
      await this.store.mall.favorites.setDefault(userId, fallback.id);
      folders = await this.store.mall.favorites.listFolders(userId);
    }
    return folders;
  }

  /** 解析收藏夹：省略 folderId 时用默认夹；显式传入则必须属于该用户（越权按不存在处理） */
  private async resolveFavoriteFolder(userId: string, folderId?: string): Promise<FavoriteFolderRecord> {
    const folder = folderId
      ? await this.store.mall.favorites.findFolder(userId, folderId)
      : (await this.ensureDefaultFavoriteFolder(userId)).find((f) => f.isDefault) ?? null;
    if (!folder) throw AppError.notFound('收藏夹不存在');
    return folder;
  }

  /** 复制 / 设默认 / 清空等夹级操作：必须显式给夹且属于当前用户 */
  private async requireOwnFolder(userId: string, folderId: string): Promise<FavoriteFolderRecord> {
    const folder = await this.store.mall.favorites.findFolder(userId, folderId);
    if (!folder) throw AppError.notFound('收藏夹不存在');
    return folder;
  }
}
