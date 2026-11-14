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

  private toProductDto(product: ProductRecord): ProductDto {
    return {
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
    };
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

  async listProducts(query: ProductQueryInput): Promise<ProductDto[]> {
    if (await this.useCatalog()) return this.catalog!.listProducts(query);
    const rows = await this.store.mall.products.list({
      ...(query.category ? { category: query.category } : {}),
      ...(query.cat ? { cat: query.cat } : {}),
      ...(query.dims ? { dims: query.dims } : {}),
      ...(query.lens ? { lens: query.lens } : {}),
      ...(query.keyword ? { keyword: query.keyword } : {}),
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    return rows.map((row) => this.toProductDto(row));
  }

  async getProduct(productId: string): Promise<ProductDto> {
    if (await this.useCatalog()) {
      const fromCatalog = this.catalog!.getProduct(productId);
      if (fromCatalog) return fromCatalog;
      // 目录源未命中时回退数据库，兼容仍指向库内旧商品的详情链接。
    }
    const product = await this.store.mall.products.findById(productId);
    if (!product) throw AppError.notFound('商品不存在或已下架');
    return this.toProductDto(product);
  }

  /** 公开分类聚合：目录源激活时只返回 6 个真实中文类目；否则走数据层全量聚合。 */
  async listCategories(): Promise<ImportCategoryCount[]> {
    if (await this.useCatalog()) return this.catalog!.listCategories();
    const rows = await this.store.mall.products.aggregateCategories();
    return [...rows].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  }

  /** 分类树下一层：parent 为空取一级，否则取该节点直接子级（只返回有商品的活分类）。 */
  async listCategoryChildren(parent: string | null): Promise<CategoryNode[]> {
    return this.store.mall.products.listChildCategories(parent);
  }

  /** 三级类目下真实存在的规格候选（dims/lens），用于筛选条展示。 */
  async listSpecOptions(c3: string): Promise<{ dims: string[]; lens: string[] }> {
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
    if (nextQuantity > product.maxOrderQty!) throw AppError.conflict('单个商品数量超出上限');
    if (nextQuantity > product.stock) throw AppError.conflict(`${product.title} 库存不足`);

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
    if (nextQuantity > product.stock) throw AppError.conflict(`${product.title} 库存不足`);
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
      if (line.product.stock < line.quantity) {
        throw AppError.conflict(`库存不足：${line.product.title}`);
      }
    }

    // 先扣库存再落单：任一失败即整单失败；已扣的那几行必须归还，否则库存会凭空消失
    const deducted: typeof lines = [];
    try {
      for (const line of lines) {
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
