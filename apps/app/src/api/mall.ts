import type { ProductDto } from '@mixmapp/contracts';

/**
 * 商城导入商品的前端本地类型。
 *
 * 契约口径见 tools/egluosi-importer/CONTRACT.md §4：以下字段为 ProductDto 的可选增补，
 * 后端 DTO 落地前先在前端按这套形状兜底；后端补齐后类型天然兼容，无需改这里的消费侧。
 */
export type MallProductDto = ProductDto & {
  /** 品牌原文，如 EGM / EG / OSG */
  brand?: string;
  /** 完整分类路径，一级到三级 */
  categoryPath?: string[];
  /** 一级分类中文名 */
  categoryName?: string;
  /** 结构化规格：键用中文短名，值为规格值 */
  specs?: Record<string, string>;
  /** 计量单位：支 / 个 / 套 / 盒 */
  unit?: string;
  /** 包装量（每包/盒数量），未知为 null */
  packQty?: number | null;
  /** 价格来源：匿名可见 / 需登录 / 只能询价 */
  priceSource?: 'anonymous' | 'login' | 'inquiry';
  /** 价格抓取时刻（ISO） */
  priceCapturedAt?: string;
  /** 来源站点详情页完整 URL */
  sourceUrl?: string;
};

/** 分类 tab 接口返回项：code 稳定短码，count 为该分类商品数。 */
export type MallCategoryDto = {
  code: string;
  name: string;
  count: number;
};

/**
 * 询价判定：`priceSource === 'inquiry'`、价格缺失或 0 元都按询价处理，
 * 不展示 ¥0.00，也不允许进购物车 / 下单（避免 0 元订单）。
 */
export function isInquiryProduct(
  product: Pick<MallProductDto, 'priceFen' | 'priceSource'>,
): boolean {
  return product.priceSource === 'inquiry' || product.priceFen == null || product.priceFen === 0;
}

/**
 * 缺货判定：库存缺失或 `stock <= 0`。目录商品的真实库存需登录源站才可见，
 * 前端落库一律存 0，因此 0 视为缺货，不允许加购 / 下单（否则服务端必判 409 库存不足）。
 * 注意与询价区分：询价看 `priceSource / priceFen`，缺货看 `stock`，两者互不覆盖。
 */
export function isOutOfStock(
  product: Pick<MallProductDto, 'stock'>,
): boolean {
  return product.stock == null || product.stock <= 0;
}

/** 缺货商品的统一说明文案：详情按钮 / 列表角标 / 购物车拦截共用。 */
export const OUT_OF_STOCK_NOTICE =
  '该商品源站显示缺货，或库存需登录后确认，请联系询价后再下单。';

/** 分值 → 展示金额（元，两位小数）。 */
export function priceText(fen: number | null | undefined): string {
  if (fen == null || Number.isNaN(fen)) return '0.00';
  return (fen / 100).toFixed(2);
}

/** 价格旁的单位后缀：有单位时返回 `元/支`，否则空串。 */
export function priceUnitLabel(product: Pick<MallProductDto, 'unit'>): string {
  return product.unit ? `元/${product.unit}` : '';
}

/** 包装量文案：有数量与单位时返回 `100 支/包`，否则空串。 */
export function packLabel(product: Pick<MallProductDto, 'unit' | 'packQty'>): string {
  const qty = product.packQty;
  if (!qty || qty <= 0 || !product.unit) return '';
  return `${qty} ${product.unit}/包`;
}

/** specs 键值对转可渲染行，过滤空值；无有效规格返回空数组。 */
export function specEntries(specs?: Record<string, string>): Array<[string, string]> {
  if (!specs || typeof specs !== 'object') return [];
  return Object.entries(specs).filter(
    (entry): entry is [string, string] => {
      const value = entry[1];
      return typeof value === 'string' && value.trim() !== '';
    },
  );
}

/** 分类路径面包屑：`' / '` 连接，过滤空段。 */
export function breadcrumbLabel(path?: string[]): string {
  return (path ?? []).filter((segment) => typeof segment === 'string' && segment.trim() !== '').join(' / ');
}

/** ISO 时间 → `YYYY-MM-DD`，无法解析时返回空串。 */
export function formatCapturedAt(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 询价商品的统一说明文案：详情弹窗 / 加购拦截共用。 */
export const INQUIRY_NOTICE = '该商品为目录选品，价格需联系报价确认，暂不支持直接加入购物车或下单。';
