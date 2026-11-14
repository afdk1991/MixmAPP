import { existsSync } from 'node:fs';
import { mkdir, copyFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type {
  CartDto,
  CartLineDto,
  ImportProductInput,
  OrderCreateInput,
  OrderDto,
  OrderItemDto,
  ProductDto,
  ProductQueryInput,
} from '@mixmapp/contracts';
import { importCatalogSchema } from '@mixmapp/contracts';
import { IdFactory } from '@mixmapp/ids';
import type { CatalogSource } from './catalog-source.js';
import { projectRoot, type Config } from '../config.js';
import type {
  CartItemRecord,
  OrderItemRecord,
  OrderRecord,
  ProductRecord,
  Store,
} from '../db/types.js';
import { isSafeStorageKey } from '../adapters/storage.js';
import { AppError } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

export type ImportCategoryCount = { code: string; name: string; count: number };
/** 分类树节点：level 1/2/3，id 形如 c1:002 / c2:002:007 / c3:007。 */
export type CategoryNode = { id: string; code: string; name: string; level: number; count: number };

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

  /** 按查看者登录态套用门禁：登录正常下发；匿名只对源站目录商品屏蔽。 */
  private applyViewerGate(dto: ProductDto, loggedIn: boolean): ProductDto {
    if (loggedIn) return dto;
    if (!this.isSourceCatalogProduct(dto)) return dto;
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
      ...(product.priceSource ? { priceSource: product.priceSource } : {}),
      ...(product.priceCapturedAt ? { priceCapturedAt: product.priceCapturedAt } : {}),
      ...(product.sourceUrl ? { sourceUrl: product.sourceUrl } : {}),
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
    // 源站登录门禁：匿名视角屏蔽折后价 / 库存 / 库存状态
    return this.applyViewerGate(dto, loggedIn);
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
    };
  }

  private toOrderDto(order: OrderRecord, items: OrderItemRecord[]): OrderDto {
    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      totalFen: order.totalFen,
      receiverName: order.receiverName,
      receiverPhone: order.receiverPhone,
      address: order.address,
      remark: order.remark,
      items: items.map((item) => this.toOrderItemDto(item)),
      createdAt: order.createdAt.toISOString(),
    };
  }

  async listProducts(query: ProductQueryInput, loggedIn: boolean): Promise<ProductDto[]> {
    if (await this.useCatalog()) {
      const rows = this.catalog!.listProducts(query);
      return rows.map((row) => this.applyViewerGate(row, loggedIn));
    }
    const rows = await this.store.mall.products.list({
      ...(query.category ? { category: query.category } : {}),
      ...(query.cat ? { cat: query.cat } : {}),
      ...(query.dims ? { dims: query.dims } : {}),
      ...(query.lens ? { lens: query.lens } : {}),
      ...(query.brand ? { brand: query.brand } : {}),
      ...(query.std ? { std: query.std } : {}),
      ...(query.grd ? { grd: query.grd } : {}),
      ...(query.mtl ? { mtl: query.mtl } : {}),
      ...(query.ttt ? { ttt: query.ttt } : {}),
      ...(query.keyword ? { keyword: query.keyword } : {}),
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    return rows.map((row) => this.toProductDto(row, loggedIn));
  }

  async getProduct(productId: string, loggedIn: boolean): Promise<ProductDto> {
    if (await this.useCatalog()) {
      const fromCatalog = this.catalog!.getProduct(productId);
      if (fromCatalog) return this.applyViewerGate(fromCatalog, loggedIn);
      // 目录源未命中时回退数据库，兼容仍指向库内旧商品的详情链接。
    }
    const product = await this.store.mall.products.findById(productId);
    if (!product) throw AppError.notFound('商品不存在或已下架');
    return this.toProductDto(product, loggedIn);
  }

  /** 公开分类聚合：目录源激活时只返回 6 个真实中文类目；否则走数据层全量聚合。 */
  async listCategories(): Promise<ImportCategoryCount[]> {
    if (await this.useCatalog()) return this.catalog!.listCategories();
    const rows = await this.store.mall.products.aggregateCategories();
    return [...rows].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
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

  async getCart(userId: string): Promise<CartDto> {
    const items = await this.store.mall.carts.listByUser(userId);
    const lines: CartLineDto[] = [];
    for (const item of items) {
      const product = await this.store.mall.products.findById(item.productId);
      if (!product) continue;
      const stockConfidence = this.stockConfidence(product);
      lines.push({
        productId: product.id,
        title: product.title,
        cover: product.cover,
        priceFen: product.priceFen,
        quantity: item.quantity,
        stock: product.stock,
        subtotalFen: lineTotalFen(product, item.quantity),
        ...(item.packUnit ? { packUnit: item.packUnit } : {}),
        ...(item.packQty != null ? { packQty: item.packQty } : {}),
        ...(product.priceLi != null ? { priceLi: product.priceLi } : {}),
        ...(product.unit ? { unitName: product.unit } : {}),
        ...(item.packUnit && item.packQty != null
          ? { packLabel: unitLabel(product, item.packUnit, item.packQty) }
          : {}),
        ...(product.sourceInvStatus ? { sourceInvStatus: product.sourceInvStatus } : {}),
        ...(stockConfidence ? { stockConfidence } : {}),
        inStock: this.isInStock(product),
      });
    }
    return {
      items: lines,
      totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
      totalFen: lines.reduce((sum, line) => sum + line.subtotalFen, 0),
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
    if (!product) throw AppError.notFound('商品不存在或已下架');
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
    const fromCart = !input.items;
    const requested =
      input.items ??
      (await this.store.mall.carts.listByUser(userId)).map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        ...(item.packUnit ? { packUnit: item.packUnit } : {}),
        ...(item.packQty != null ? { packQty: item.packQty } : {}),
      }));
    if (requested.length === 0) throw AppError.conflict('购物车是空的，无法下单');

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

    const totalFen = lines.reduce((sum, line) => sum + lineTotalFen(line.product, line.quantity), 0);
    const id = this.ids.next().id;
    const orderNo = `MO${Date.now().toString(36).toUpperCase()}${this.ids.next().snowflake.slice(-6)}`;
    const order: OrderRecord = {
      id,
      orderNo,
      userId,
      status: 'pending',
      totalFen,
      receiverName: input.receiverName,
      receiverPhone: input.receiverPhone,
      address: input.address,
      remark: input.remark ?? null,
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
    if (fromCart) await this.store.mall.carts.clear(userId);
    const unconfirmed = items.filter((item) => item.stockUnconfirmed);
    if (unconfirmed.length > 0) {
      // 可读摘要：运营按订单号核对货源，前端/管理端也可据 stockUnconfirmed 取同一批单
      console.warn(
        `[order] 货源待确认 ${orderNo}（${unconfirmed.length} 行）：${unconfirmed
          .map((item) => `${item.title}×${item.quantity}`)
          .join('、')}`,
      );
    }
    return this.toOrderDto(order, items);
  }

  /** 超时取消：待支付且超过 TTL 的订单转为 cancelled，并把库存还回去。 */
  async sweepExpiredOrders(ttlMinutes: number, now: Date = new Date()): Promise<string[]> {
    const before = new Date(now.getTime() - ttlMinutes * 60_000);
    const expired = await this.store.mall.orders.listExpiredPending(before);
    const cancelled: string[] = [];
    for (const order of expired) {
      // 条件流转：只有 still pending 的才改，避免和「刚好支付成功」抢
      const ok = await this.store.mall.orders.transitionStatus(order.id, 'pending', 'cancelled');
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
}
