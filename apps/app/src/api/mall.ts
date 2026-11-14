import type { ProductDto } from '@mixmapp/contracts';
import { apiRequest } from './client';

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
  /** 面价，厘/支（源站元/千支），有值时用它精确计价与展示 */
  priceLi?: number;
  /** 折扣百分比，100 = 无折扣（合法值，仍显示 100% 且折后价等于面价） */
  discountPct?: number;
  /** 特价，厘/支 */
  salePriceLi?: number;
  /** 源站特价折扣百分比（tejiaD2N2）：有值时商城折扣划掉，改展示特价折扣 */
  tejiaDiscountPct?: number;
  /** 登录可见门禁：true 表示匿名视角，折后价 / 库存 / 库存状态由服务端屏蔽 */
  loginVisibleRequired?: boolean;
  /** 类目属性（按类目实际存在形态，空值不入库） */
  attributes?: Record<string, string>;
  /** 优惠活动文案与有效期 */
  promotions?: Array<{ text: string; kind?: string; validFrom?: string; validTo?: string }>;
  /** 包装换算文案原文，如「1箱=16盒,1盒=2000支」 */
  packagingDesc?: string;
  /** 购买方式（箱/盒/袋…） */
  unitOptions?: Array<{ code: string; name: string }>;
  /** 单位换算：需求支数 = 包装数 × unitConversions[选中单位] */
  unitConversions?: Record<string, number>;
  /** 商品详图（按三级类目共享） */
  specImage?: string;
  minOrderQty?: number;
  qtyStep?: number;
  maxOrderQty?: number;
};

/** 分类 tab 接口返回项：code 稳定短码，count 为该分类商品数。 */
export type MallCategoryDto = {
  code: string;
  name: string;
  count: number;
};

/** 分类树节点：level 1/2/3，id 形如 c1:002 / c2:002:007 / c3:007。 */
export type MallCategoryNodeDto = {
  id: string;
  code: string;
  name: string;
  level: number;
  count: number;
};

/** 分类节点下的筛选项，取值只来自商品实际落库的真实值。 */
export type MallSpecOptionsDto = {
  dims: string[];
  lens: string[];
  brands: string[];
  stds: string[];
  grds: string[];
  mtls: string[];
  ttts: string[];
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
 * 缺货判定：**源站状态优先**，其次才看假设库存。
 * - 登录门禁（匿名视角）：库存被服务端隐藏，不能据此判缺货，先放行给「登录可见」占位。
 * - `inStock === false`：源站明确缺货/下架，直接判缺货，禁止加购 / 下单。
 * - `inStock === true`：源站有货，`stock` 只表示可售上限，不再据此判缺货。
 * - 后端没给 `inStock` 时退回旧口径：库存缺失或 `stock <= 0` 视为缺货。
 * 注意与询价区分：询价看 `priceSource / priceFen`，缺货看 `inStock / stock`，两者互不覆盖。
 */
export function isOutOfStock(
  product: Pick<MallProductDto, 'stock' | 'inStock' | 'loginVisibleRequired'>,
): boolean {
  if (product.loginVisibleRequired) return false;
  if (typeof product.inStock === 'boolean') return !product.inStock;
  return product.stock == null || product.stock <= 0;
}

/** 缺货商品的统一说明文案：详情按钮 / 列表角标 / 购物车拦截共用。 */
export const OUT_OF_STOCK_NOTICE =
  '该商品源站显示缺货，或库存需登录后确认，请联系询价后再下单。';

/**
 * 货源待确认：后端分级判定后放行（仅匿名视图推断缺货，无停售/下架信号）。
 * 与「缺货」严格区分：可加购 / 可结算，但要提示需人工确认货源。
 */
export function isStockUnconfirmed(
  product: Pick<MallProductDto, 'stockConfidence'>,
): boolean {
  return product.stockConfidence === 'inferred';
}

/** 货源待确认的统一说明文案：列表角标 / 详情 / 购物车共用。 */
export const STOCK_UNCONFIRMED_NOTICE =
  '货源待确认：当前库存来自源站匿名视图推断，可正常下单，客服会在发货前与您确认货源。';

/**
 * 库存展示阈值：严格大于该值即视为「大库存」，列表 / 详情 / 购物车只显示
 * 「现货」「在售」，不暴露具体数字（避免 9999999 这类占位值误导用户）。
 * 三处展示统一引用这里，不要在页面里各写一份。
 */
export const STOCK_DISPLAY_THRESHOLD = 10000;

/** 库存是否超过展示阈值（超过则只显示状态词，不显示数字）。 */
export function isBulkStock(stock: number | null | undefined): boolean {
  return stock != null && stock > STOCK_DISPLAY_THRESHOLD;
}

/** 分值 → 展示金额（元，两位小数）。 */
export function priceText(fen: number | null | undefined): string {
  if (fen == null || Number.isNaN(fen)) return '0.00';
  return (fen / 100).toFixed(2);
}

/** 价格旁的单位后缀：有单位时返回 `/支`。价格前已经带 ¥，不再重复「元」。 */
export function priceUnitLabel(product: Pick<MallProductDto, 'unit'>): string {
  return product.unit ? `/${product.unit}` : '';
}

/**
 * 列表 / 首页卡片单价：优先用厘/支精确价（85 → 0.085），
 * 只有旧数据缺 priceLi 时才回落到四舍五入到分的 priceFen（9 → 0.09）。
 * 详情页与购物车一直走 unitPriceText，这里补齐列表口径，避免同一商品两处价格不一致。
 */
export function listPriceText(product: Pick<MallProductDto, 'priceFen' | 'priceLi'>): string {
  const li = product.priceLi;
  if (li != null && li > 0) {
    const exact = unitPriceText(li);
    if (exact) return exact;
  }
  return priceText(product.priceFen);
}

/**
 * 厘/支 → 展示单价（元/支）。源站面价按「元/千支」给，85 即 0.085 元/支；
 * 保留到 4 位小数并去掉多余的 0，避免 0.085 被四舍五入成 0.09 的错觉。
 */
export function unitPriceText(priceLi?: number | null): string {
  if (priceLi == null || !Number.isFinite(priceLi)) return '';
  if (priceLi % 1000 === 0) return String(priceLi / 1000);
  let text = (priceLi / 1000).toFixed(4).replace(/0+$/, '');
  if (text.endsWith('.')) text = `${text}00`;
  else if (/\.\d$/.test(text)) text = `${text}0`;
  return text;
}

/** 金额：有厘/支精确价时按支数算（1 分 = 10 厘），否则回落到旧的分/件口径。 */
export function lineTotalFen(
  product: Pick<MallProductDto, 'priceFen' | 'priceLi'>,
  quantity: number,
): number {
  const li = product.priceLi;
  if (li != null && li > 0) return Math.round((li * quantity) / 10);
  return (product.priceFen ?? 0) * quantity;
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

/** 源站未登录时的统一占位文案（disbasePrc / bpInvQty / invStatus 三列同文案）。 */
export const LOGIN_VISIBLE_TEXT = '登录可见';

/**
 * 登录可见门禁判定（源站 /b2b/ 规则）：未登录时 disbasePrc（折后千支价）、
 * bpInvQty（库存）、invStatus（库存状态）都显示「登录可见」，不暴露真实数值。
 * 服务端已在匿名视角把 stock 归 0 并下发该标记，前端据此渲染占位。
 */
export function isLoginGated(
  product: Pick<MallProductDto, 'loginVisibleRequired'>,
): boolean {
  return product.loginVisibleRequired === true;
}

/**
 * 千支面价（元/千支），对应源站列表列 `basePrcD3N2`。
 * priceLi 是「厘/支」：1 元 = 1000 厘，1000 支合计正好等于 priceLi 元，故数值与源站一致；
 * 旧数据没有 priceLi 时用 priceFen（分/支）×10 回落（1000 支 = priceFen×1000 分 = priceFen×10 元）。
 */
export function perThousandBaseYuan(
  product: Pick<MallProductDto, 'priceLi' | 'priceFen'>,
): number | null {
  const li = product.priceLi;
  if (li != null && li > 0) return li;
  const fen = product.priceFen;
  if (fen == null || fen <= 0) return null;
  return fen * 10;
}

/**
 * 折后千支价（元/千支），对应源站列 `disbasePrc` = basePrcD3N2 × disD2N2 / 100。
 * 有 salePriceLi（面价×折扣）时直接换算，避免二次四舍五入。
 */
export function perThousandDiscountYuan(
  product: Pick<MallProductDto, 'priceLi' | 'priceFen' | 'discountPct' | 'salePriceLi'>,
): number | null {
  const sale = product.salePriceLi;
  if (sale != null && sale > 0) return sale;
  const base = perThousandBaseYuan(product);
  const pct = product.discountPct;
  if (base == null || pct == null || pct <= 0) return null;
  return (base * pct) / 100;
}

/** 千支价格文案：整数不带小数（源站 basePrcD3N2 多为整数），非整数保留两位。 */
export function yuanText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** 商品列表查询参数（与 /mall/products 契约一致）。 */
export type MallProductQuery = {
  category?: string;
  cat?: string;
  dims?: string;
  lens?: string;
  brand?: string;
  std?: string;
  grd?: string;
  mtl?: string;
  ttt?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
};

/**
 * 商品列表（可选登录态）：与 mallApi.listProducts 的 `auth: false` 不同，
 * 这里会带上 accessToken，服务端才能按登录视角下发折后千支价与库存；
 * 未登录时不带令牌，仍可浏览，只是 disbasePrc / bpInvQty / invStatus 显示「登录可见」。
 */
export function fetchMallProducts(query: MallProductQuery = {}): Promise<MallProductDto[]> {
  const qs = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return apiRequest<MallProductDto[]>(`/mall/products${qs ? `?${qs}` : ''}`);
}

/** 商品详情（可选登录态），门禁口径同 fetchMallProducts。 */
export function fetchMallProduct(productId: string): Promise<MallProductDto> {
  return apiRequest<MallProductDto>(`/mall/products/${encodeURIComponent(productId)}`);
}
