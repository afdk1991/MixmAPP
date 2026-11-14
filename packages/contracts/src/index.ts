import { z } from 'zod';

export const phoneSchema = z
  .string()
  .regex(/^1[3-9]\d{9}$/, '手机号格式不正确');

export const emailSchema = z.string().email('邮箱格式不正确').max(254);

export const passwordSchema = z
  .string()
  .min(8, '密码至少 8 位')
  .max(72, '密码最多 72 位')
  .regex(/[a-zA-Z]/, '密码需包含字母')
  .regex(/\d/, '密码需包含数字');

export const smsCodeSchema = z.string().regex(/^\d{6}$/, '验证码为 6 位数字');

/**
 * 内置的第三方登录渠道（有专用/已实现的适配器）。
 * 通用 OAuth2/OIDC 渠道由服务端 `config/oauth-providers.json` 注册表驱动，
 * 标识是普通字符串，不再逐一写进这里，否则每接一家都要改代码。
 */
export const OAUTH_PROVIDER_KEYS = [
  'wechat',
  'wechat_mp',
  'qq',
  'weibo',
  'alipay',
  'douyin',
  'dingtalk',
  'wecom',
  'apple',
  'google',
  'facebook',
  'github',
  'gitee',
  'mock',
] as const;

export type OAuthProviderKey = (typeof OAUTH_PROVIDER_KEYS)[number];

/**
 * 渠道标识：内置渠道是上面的联合类型，通用适配器渠道是注册表里的任意 key。
 * 具体是否可用由服务端注册表与配置推导，前端不维护渠道白名单。
 */
export type OAuthProviderId = OAuthProviderKey | (string & {});

export const oauthProviderSchema = z.enum(OAUTH_PROVIDER_KEYS);

/** 登录/绑定入参：接受注册表里的任意渠道 key，最终由服务端注册表判定可用性。 */
export const oauthProviderIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, '渠道标识格式不合法');

/** 用户名：2–20 位（中文/字母/数字/下划线），不能纯数字，不与保留名冲突。 */
export const RESERVED_USERNAMES = [
  'admin',
  'root',
  'system',
  'support',
  'official',
  'guest',
  'mixm',
  'mixmapp',
] as const;

export const usernameSchema = z
  .string()
  .trim()
  .min(2, '用户名至少 2 个字符')
  .max(20, '用户名最多 20 个字符')
  .regex(/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/, '用户名仅支持中文、字母、数字与下划线')
  .refine((value) => !/^\d+$/.test(value), '用户名不能是纯数字')
  .refine(
    (value) => !RESERVED_USERNAMES.includes(value.toLowerCase() as (typeof RESERVED_USERNAMES)[number]),
    '该用户名为系统保留，请换一个',
  );

export const idStrategySchema = z.enum(['snowflake', 'ulid', 'uuidv7']);

export const registerByPhoneSchema = z.object({
  phone: phoneSchema,
  code: smsCodeSchema,
  nickname: z.string().trim().min(1).max(24).optional(),
  inviteCode: z.string().trim().max(32).optional(),
});

export const registerByEmailSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  nickname: z.string().trim().min(1).max(24).optional(),
  inviteCode: z.string().trim().max(32).optional(),
});

/** 用户名注册：不依赖手机号与邮箱，注册后可直接用用户名登录。 */
export const registerByUsernameSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  nickname: z.string().trim().min(1).max(24).optional(),
  inviteCode: z.string().trim().max(32).optional(),
});

/** 游客注册：同一设备重复提交返回同一账号，后续可绑定手机号/邮箱升级。 */
export const registerGuestSchema = z.object({
  deviceId: z.string().trim().min(8, '设备标识过短').max(128, '设备标识过长'),
  nickname: z.string().trim().min(1).max(24).optional(),
});

/** 一键登录：token 由运营商/本机号码认证 SDK 下发，服务端解析出手机号。 */
export const oneKeySchema = z.object({
  token: z.string().trim().min(8, '一键登录凭证过短').max(1024, '一键登录凭证过长'),
  nickname: z.string().trim().min(1).max(24).optional(),
});

/** 给游客账号补设用户名密码，补设后不再算游客。 */
export const bindUsernameSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export const loginByPasswordSchema = z.object({
  account: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(72),
});

export const loginBySmsSchema = z.object({
  phone: phoneSchema,
  code: smsCodeSchema,
});

export const oauthLoginSchema = z.object({
  provider: oauthProviderIdSchema,
  code: z.string().min(1).max(512),
  state: z.string().max(128).optional(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(20),
});

export const updateProfileSchema = z.object({
  nickname: z.string().trim().min(1).max(24).optional(),
  avatarUrl: z.string().url().max(512).optional(),
  bio: z.string().max(160).optional(),
});

export const bindPhoneSchema = z.object({
  phone: phoneSchema,
  code: smsCodeSchema,
});

export const bindEmailSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const createPaymentSchema = z.object({
  channel: z.enum(['wechat', 'alipay']),
  amountFen: z.number().int().positive().max(10_000_000),
  subject: z.string().trim().min(1).max(64),
  outTradeNo: z.string().trim().min(6).max(64).optional(),
});

export const reverseGeoSchema = z.object({
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
});

export const routeSchema = z.object({
  from: z.object({ longitude: z.number(), latitude: z.number() }),
  to: z.object({ longitude: z.number(), latitude: z.number() }),
  mode: z.enum(['walking', 'driving', 'riding']).default('walking'),
});

export const presignSchema = z.object({
  key: z.string().min(1).max(256).regex(/^[a-zA-Z0-9/_.-]+$/, 'key 仅允许字母数字与 / _ . -'),
  contentType: z.string().max(128).optional(),
  expiresIn: z.number().int().min(60).max(3600).optional(),
});

export const pushTokenSchema = z.object({
  token: z.string().min(10).max(512),
  platform: z.enum(['android', 'ios', 'harmony', 'web']),
  provider: z.enum(['fcm', 'jpush']).default('jpush'),
});

export const aiChatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(24),
  model: z.string().max(64).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export type RegisterByPhoneInput = z.infer<typeof registerByPhoneSchema>;
export type RegisterByEmailInput = z.infer<typeof registerByEmailSchema>;
export type RegisterByUsernameInput = z.infer<typeof registerByUsernameSchema>;
export type RegisterGuestInput = z.infer<typeof registerGuestSchema>;
export type OneKeyInput = z.infer<typeof oneKeySchema>;
export type BindUsernameInput = z.infer<typeof bindUsernameSchema>;
export type LoginByPasswordInput = z.infer<typeof loginByPasswordSchema>;
export type LoginBySmsInput = z.infer<typeof loginBySmsSchema>;
export type OAuthLoginInput = z.infer<typeof oauthLoginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type PresignInput = z.infer<typeof presignSchema>;
export type AiChatInput = z.infer<typeof aiChatSchema>;

export type UserDto = {
  /** 主键（形态取决于 ID 策略） */
  id: string;
  /** 对外展示的 MixmAPP 号码 */
  accountNo: string;
  nickname: string;
  avatarUrl: string | null;
  bio: string | null;
  /** 用户名（可空；有了它就能用「用户名 + 密码」登录） */
  username: string | null;
  /** 游客账号：尚未绑定手机号、邮箱或第三方渠道 */
  isGuest: boolean;
  phone: string | null;
  email: string | null;
  /** 已绑定的第三方登录渠道 */
  bindings: string[];
  createdAt: string;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  /** 秒 */
  expiresIn: number;
  tokenType: 'Bearer';
};

export type AuthResult = {
  user: UserDto;
  tokens: TokenPair;
  /** 新注册用户返回 true，前端可引导完善资料 */
  isNewUser: boolean;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
};

export type ApiOk<T> = { data: T };

export type HealthReport = {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSec: number;
  checks: Record<'db' | 'sms' | 'pay' | 'storage' | 'ai', string>;
  time: string;
};

// ===== 商城域（商品 / 购物车 / 订单） =====

export const productQuerySchema = z.object({
  category: z.string().trim().max(32).optional(),
  /** 分类树节点 id（c1:002 / c2:002:007 / c3:007）；c2、c3 会按子孙关系收敛商品 */
  cat: z.string().trim().max(32).optional(),
  /** 规格筛选：维度数 / 长度，取值只来自源站 ccc_filter 选项（空值表示不过滤） */
  dims: z.string().trim().max(16).optional(),
  lens: z.string().trim().max(16).optional(),
  keyword: z.string().trim().max(64).optional(),
  // 页上界放大到可覆盖全量目录（万级以上）；pageSize 上限保持 50，前端首屏/触底翻页不放大。
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

// ===== 目录导入（抓取端 catalog.json → 商城库） =====

export const importPriceSourceSchema = z.enum(['anonymous', 'login', 'inquiry']);
export const importStockSourceSchema = z.enum(['anonymous', 'unknown']);

/** §2.4 图片：staged 为 null 表示抓取端下载失败，导入端不得保留不可达 remote 热链。 */
export const importProductImageSchema = z.object({
  remote: z.string().trim().url().max(512),
  staged: z.string().trim().max(256).nullable(),
  role: z.enum(['cover', 'gallery']).default('gallery'),
});

/** §2.1 单条商品字段口径，宽度上限与契约一致。 */
export const importProductSchema = z.object({
  sourceKey: z.string().trim().min(1).max(128),
  sourceId: z.string().trim().max(64).nullable(),
  sourceUrl: z.string().trim().url().max(512),
  name: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(200).default(''),
  brand: z.string().trim().max(64).default(''),
  categoryPath: z.array(z.string().trim().min(1).max(64)).max(5),
  categoryCode: z.string().trim().min(1).max(32),
  specs: z
    .record(z.string().trim().max(64), z.string().trim().max(256))
    .refine((obj) => Object.keys(obj).length <= 32, 'specs 最多 32 项')
    .default({}),
  unit: z.string().trim().max(16).default(''),
  packQty: z.number().int().positive().nullable().optional(),
  priceFen: z.number().int().min(0).nullable(),
  priceSource: importPriceSourceSchema,
  priceCapturedAt: z.string().datetime(),
  stock: z.number().int().min(0).default(0),
  stockSource: importStockSourceSchema,
  images: z.array(importProductImageSchema).max(10).default([]),
  description: z.string().max(4000).default(''),
  rawName: z.string().trim().max(200).default(''),
});

export const importCatalogCategorySchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().max(64),
  siteValue: z.string().trim().max(64).optional(),
  path: z.array(z.string().trim().max(64)).max(5).optional(),
});

/** §2 catalog 顶层结构；meta/skipped/failed 等附加键在解析时剥离，不参与入库。 */
export const importCatalogSchema = z.object({
  source: z.string().trim().max(256).optional(),
  crawledAt: z.string().datetime().optional(),
  batch: z.string().trim().max(64).optional(),
  categories: z.array(importCatalogCategorySchema).optional(),
  // 单批 catalog 可含数万条；服务端 importCatalog 内部再按 5000/批分片落库，这里只设一个宽裕上界。
  products: z.array(importProductSchema).max(100000),
});

/**
 * 购物车行：quantity 统一为「支数」，packUnit/packQty 记录用户选的购买方式（箱/盒/袋…）
 * 与包装数，用于回显与对账；换算关系以商品 unitConversions 为准。
 */
export const cartAddSchema = z.object({
  productId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(100000000).default(1),
  packUnit: z.string().trim().max(8).optional(),
  packQty: z.number().int().min(1).max(1000000).optional(),
});

export const cartUpdateSchema = z.object({
  quantity: z.number().int().min(1).max(100000000),
  packUnit: z.string().trim().max(8).optional(),
  packQty: z.number().int().min(1).max(1000000).optional(),
});

export const orderCreateSchema = z.object({
  receiverName: z.string().trim().min(1).max(24),
  receiverPhone: phoneSchema,
  address: z.string().trim().min(4).max(160),
  remark: z.string().trim().max(120).optional(),
  /** 不传则用购物车全部商品下单；传了就是「立即购买」 */
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(64),
        quantity: z.number().int().min(1).max(100000000),
        packUnit: z.string().trim().max(8).optional(),
        packQty: z.number().int().min(1).max(1000000).optional(),
      }),
    )
    .min(1)
    .max(50)
    .optional(),
});

export type ProductQueryInput = z.infer<typeof productQuerySchema>;
export type ImportProductImageInput = z.infer<typeof importProductImageSchema>;
export type ImportProductInput = z.infer<typeof importProductSchema>;
export type ImportCatalogInput = z.infer<typeof importCatalogSchema>;
export type CartAddInput = z.infer<typeof cartAddSchema>;
export type CartUpdateInput = z.infer<typeof cartUpdateSchema>;
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

export type ProductDto = {
  id: string;
  title: string;
  subtitle: string;
  /**
   * 现价（分）。询价商品没有公开价，落库/下发时 null 归一为 0。
   * 判断能否下单/展示价格必须同时看 priceSource：`priceSource === 'inquiry'` 或 `priceFen <= 0`
   * 都视为不可直接购买，不能只凭 priceFen === 0 下结论（0 也可能是异常缺价）。
   */
  priceFen: number;
  /** 划线价（分），0 表示无 */
  originalPriceFen: number;
  stock: number;
  category: string;
  /** 封面用色，前端据此渲染纯色封面，避免依赖外部图床 */
  cover: string;
  images: string[];
  tags: string[];
  description: string;
  createdAt: string;
  /** 以下为导入目录商品增补的可选字段，旧数据零影响 */
  brand?: string;
  categoryPath?: string[];
  /** 一级分类中文名 */
  categoryName?: string;
  specs?: Record<string, string>;
  unit?: string;
  packQty?: number;
  priceSource?: 'anonymous' | 'login' | 'inquiry';
  /** ISO 时间，价格抓取时刻 */
  priceCapturedAt?: string;
  sourceUrl?: string;
  /** ===== 详情页结构化字段（2026-11-14 第二轮抓取） ===== */
  /** 面价，厘/支（源站元/千支）。与 priceFen 并存：priceLi 精确，priceFen 是四舍五入后的兼容值。 */
  priceLi?: number;
  /** 折扣百分比，100 = 无折扣 */
  discountPct?: number;
  /** 特价，厘/支 */
  salePriceLi?: number;
  /** 类目属性（品牌/等级/材质/标准/牙别/表面处理/品名…按类目实际存在形态下发） */
  attributes?: Record<string, string>;
  /** 优惠活动：源站按促销展示时的文案与有效期 */
  promotions?: Array<{ text: string; kind?: string; validFrom?: string; validTo?: string }>;
  /** 包装换算文案原文，如「1箱=16盒,1盒=2000支」 */
  packagingDesc?: string;
  /** 购买方式（箱/盒/袋…），顺序与源站一致 */
  unitOptions?: Array<{ code: string; name: string }>;
  /** 单位换算：需求支数 = 包装数 × unitConversions[选中单位] */
  unitConversions?: Record<string, number>;
  /** 商品详图（按三级类目共享） */
  specImage?: string;
  /** 需求包装数规则：默认值 / 步长 / 上限 */
  minOrderQty?: number;
  qtyStep?: number;
  maxOrderQty?: number;
};

export type CartLineDto = {
  productId: string;
  title: string;
  cover: string;
  priceFen: number;
  quantity: number;
  stock: number;
  subtotalFen: number;
  /** 购买方式与包装数回显（旧数据为 undefined） */
  packUnit?: string;
  packQty?: number;
  /** 精确单价（厘/支），有值时前端用它展示单价、忽略 priceFen 的四舍五入误差 */
  priceLi?: number;
  unitName?: string;
  packLabel?: string;
};

export type CartDto = {
  items: CartLineDto[];
  totalQuantity: number;
  totalFen: number;
};

export type OrderItemDto = {
  productId: string;
  title: string;
  priceFen: number;
  quantity: number;
  subtotalFen: number;
  /** 购买方式与精确单价（厘/支） */
  packUnit?: string;
  packQty?: number;
  priceLi?: number;
};

export type OrderDto = {
  id: string;
  orderNo: string;
  status: 'pending' | 'paid' | 'cancelled';
  totalFen: number;
  receiverName: string;
  receiverPhone: string;
  address: string;
  remark: string | null;
  items: OrderItemDto[];
  createdAt: string;
};

