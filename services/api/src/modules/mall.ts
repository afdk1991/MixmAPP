import type {
  CartDto,
  CartLineDto,
  OrderCreateInput,
  OrderDto,
  OrderItemDto,
  ProductDto,
  ProductQueryInput,
} from '@mixmapp/contracts';
import { IdFactory } from '@mixmapp/ids';
import type { Config } from '../config.js';
import type {
  CartItemRecord,
  OrderItemRecord,
  OrderRecord,
  ProductRecord,
  Store,
} from '../db/types.js';
import { AppError } from '../lib/errors.js';

/**
 * 商城域服务：商品 → 购物车 → 订单。
 * 库存扣减放在下单时做，扣减失败即整单失败，避免超卖。
 */
export class MallService {
  private readonly ids: IdFactory;

  constructor(
    private readonly config: Config,
    private readonly store: Store,
  ) {
    this.ids = new IdFactory({ workerId: config.ids.workerId });
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
    };
  }

  private toOrderItemDto(item: OrderItemRecord): OrderItemDto {
    return {
      productId: item.productId,
      title: item.title,
      priceFen: item.priceFen,
      quantity: item.quantity,
      subtotalFen: item.subtotalFen,
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
    const rows = await this.store.mall.products.list({
      ...(query.category ? { category: query.category } : {}),
      ...(query.keyword ? { keyword: query.keyword } : {}),
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    return rows.map((row) => this.toProductDto(row));
  }

  async getProduct(productId: string): Promise<ProductDto> {
    const product = await this.store.mall.products.findById(productId);
    if (!product) throw AppError.notFound('商品不存在或已下架');
    return this.toProductDto(product);
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
        subtotalFen: product.priceFen * item.quantity,
      });
    }
    return {
      items: lines,
      totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
      totalFen: lines.reduce((sum, line) => sum + line.subtotalFen, 0),
    };
  }

  async addToCart(userId: string, productId: string, quantity: number): Promise<CartDto> {
    const product = await this.store.mall.products.findById(productId);
    if (!product) throw AppError.notFound('商品不存在或已下架');
    const existing = await this.store.mall.carts.find(userId, productId);
    const nextQuantity = (existing?.quantity ?? 0) + quantity;
    if (nextQuantity > 99) throw AppError.conflict('单个商品最多 99 件');
    if (nextQuantity > product.stock) throw AppError.conflict(`${product.title} 库存不足`);

    const now = new Date();
    const item: CartItemRecord = {
      id: existing?.id ?? this.ids.next().id,
      userId,
      productId,
      quantity: nextQuantity,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.store.mall.carts.upsert(item);
    return this.getCart(userId);
  }

  async updateCartQuantity(userId: string, productId: string, quantity: number): Promise<CartDto> {
    const existing = await this.store.mall.carts.find(userId, productId);
    if (!existing) throw AppError.notFound('购物车里没有该商品');
    const product = await this.store.mall.products.findById(productId);
    if (!product) throw AppError.notFound('商品不存在或已下架');
    if (quantity > product.stock) throw AppError.conflict(`${product.title} 库存不足`);
    await this.store.mall.carts.upsert({ ...existing, quantity, updatedAt: new Date() });
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

  async createOrder(userId: string, input: OrderCreateInput): Promise<OrderDto> {
    const fromCart = !input.items;
    const requested =
      input.items ??
      (await this.store.mall.carts.listByUser(userId)).map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      }));
    if (requested.length === 0) throw AppError.conflict('购物车是空的，无法下单');

    const lines: Array<{ product: ProductRecord; quantity: number }> = [];
    for (const line of requested) {
      const product = await this.store.mall.products.findById(line.productId);
      if (!product) throw AppError.notFound(`商品不存在或已下架：${line.productId}`);
      if (product.stock < line.quantity) throw AppError.conflict(`库存不足：${product.title}`);
      lines.push({ product, quantity: line.quantity });
    }

    // 先扣库存再落单：任一失败即整单失败
    for (const line of lines) {
      const ok = await this.store.mall.products.decrementStock(line.product.id, line.quantity);
      if (!ok) throw AppError.conflict(`库存不足：${line.product.title}`);
    }

    const totalFen = lines.reduce((sum, line) => sum + line.product.priceFen * line.quantity, 0);
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
      subtotalFen: line.product.priceFen * line.quantity,
    }));

    await this.store.mall.orders.insert(order, items);
    if (fromCart) await this.store.mall.carts.clear(userId);
    return this.toOrderDto(order, items);
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
