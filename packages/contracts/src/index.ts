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

export const oauthProviderSchema = z.enum(['wechat', 'qq', 'github', 'apple']);

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
  provider: oauthProviderSchema,
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
  keyword: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).max(100).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const cartAddSchema = z.object({
  productId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(99).default(1),
});

export const cartUpdateSchema = z.object({
  quantity: z.number().int().min(1).max(99),
});

export const orderCreateSchema = z.object({
  receiverName: z.string().trim().min(1).max(24),
  receiverPhone: phoneSchema,
  address: z.string().trim().min(4).max(160),
  remark: z.string().trim().max(120).optional(),
  /** 不传则用购物车全部商品下单；传了就是「立即购买」 */
  items: z
    .array(z.object({ productId: z.string().min(1).max(64), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(50)
    .optional(),
});

export type ProductQueryInput = z.infer<typeof productQuerySchema>;
export type CartAddInput = z.infer<typeof cartAddSchema>;
export type CartUpdateInput = z.infer<typeof cartUpdateSchema>;
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

export type ProductDto = {
  id: string;
  title: string;
  subtitle: string;
  /** 现价（分） */
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
};

export type CartLineDto = {
  productId: string;
  title: string;
  cover: string;
  priceFen: number;
  quantity: number;
  stock: number;
  subtotalFen: number;
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

