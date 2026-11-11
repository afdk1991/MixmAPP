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

export const oauthProviderSchema = z.enum(['wechat', 'qq', 'github']);

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
  /** 对外展示的 MIX 号码 */
  accountNo: string;
  nickname: string;
  avatarUrl: string | null;
  bio: string | null;
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
