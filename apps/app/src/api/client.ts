import type {
  AuthResult,
  CartDto,
  CreatePaymentInput,
  FavoriteFolderDto,
  FavoriteItemDto,
  HomeAdDto,
  HomeRecommendedCategoryDto,
  OAuthProviderId,
  OrderCreateInput,
  OrderDto,
  PrivacyConsentInput,
  TokenPair,
  UserDto,
} from '@mixmapp/contracts';
import { APP_CHANNEL } from '../version';
import { getDeviceSnapshot, type DeviceSnapshot } from '../device';
import type {
  MallCategoryDto,
  MallCategoryNodeDto,
  MallProductDto,
  MallSpecOptionsDto,
} from './mall';

/**
 * 统一 API 基址。优先级：
 * 1. 运行时注入 `window.__MIXMAPP_API_BASE__`（静态托管平台部署时写进 HTML，改地址不用重新构建）
 * 2. 本地存储 `mixmapp:apiBase`（仅 preview / dev 有效；正式版忽略并清除该键）
 * 3. 构建变量 `VITE_MIXMAPP_API_BASE`
 * 4. 开发态指向本机 8080，生产态同源 `/api/v1`
 *
 * 注意：静态平台只托管前端，没有 `/api/v1` 路由；部署到这类平台时必须给出 API 源，
 * 否则所有请求会落到托管域名上并返回 404。
 */
type RuntimeApiBaseSource = 'runtime' | 'storage';

/** 渠道来自 version.json（随版本同步写入 version.ts），不再从版本号后缀反推。 */
const IS_RELEASE_CHANNEL = APP_CHANNEL === 'release';

/** 正式版不接受本地覆盖：旧调试值读到即清掉，避免同一包在不同设备指向不同基址。 */
function clearLegacyStorageApiBase(): void {
  try {
    if (uni.getStorageSync('mixmapp:apiBase')) uni.removeStorageSync('mixmapp:apiBase');
  } catch {
    // 无 storage 能力的端直接忽略
  }
}

function readRuntimeApiBase(): { value: string; source: RuntimeApiBaseSource } | undefined {
  if (IS_RELEASE_CHANNEL) clearLegacyStorageApiBase();
  const injected = (globalThis as { __MIXMAPP_API_BASE__?: unknown }).__MIXMAPP_API_BASE__;
  if (typeof injected === 'string' && injected.trim()) {
    return { value: injected.trim(), source: 'runtime' };
  }
  if (IS_RELEASE_CHANNEL) return undefined;
  try {
    const stored = uni.getStorageSync('mixmapp:apiBase');
    if (typeof stored === 'string' && stored.trim()) return { value: stored.trim(), source: 'storage' };
  } catch {
    // 无 storage 能力的端直接忽略
  }
  return undefined;
}

/** 只给域名时补 `/api/v1`；已经是完整路径的原样保留（去掉尾部斜杠）。 */
export function normalizeApiBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '/api/v1';
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname === '/' || parsed.pathname === '') return `${trimmed}/api/v1`;
    return trimmed;
  } catch {
    return trimmed;
  }
}

/** 由 vite.config 的 define 注入，覆盖 H5 / 小程序 / App / Harmony 所有构建端。 */
declare const __MIXMAPP_API_BASE__: string;
const buildApiBase = typeof __MIXMAPP_API_BASE__ === 'undefined' ? '' : __MIXMAPP_API_BASE__.trim();

const env = import.meta.env as unknown as Record<string, string | boolean | undefined>;
const runtimeApiBase = readRuntimeApiBase();

/** 基址取值来源：排查「显示值与预期注入值不一致」时用来区分是被本地存储覆盖还是旧产物。 */
export type ApiBaseSource = 'runtime' | 'storage' | 'build' | 'default';

export const API_BASE_SOURCE: ApiBaseSource =
  runtimeApiBase?.source ?? (buildApiBase ? 'build' : 'default');

export const API_BASE: string = normalizeApiBase(
  runtimeApiBase?.value ?? (buildApiBase || undefined) ?? (env.DEV ? 'http://127.0.0.1:8080/api/v1' : '/api/v1'),
);

/**
 * 媒体（图片 / 静态资源）基址：构建时注入 `window.__MIXMAPP_MEDIA_BASE__`（如 https://img.mixm.top）。
 * 未注入时回落到 API 源 origin，保持旧行为；同域相对部署则不拼接，交给浏览器按当前站点解析。
 */
const MEDIA_BASE: string = (() => {
  const injected = (globalThis as { __MIXMAPP_MEDIA_BASE__?: unknown }).__MIXMAPP_MEDIA_BASE__;
  return typeof injected === 'string' ? injected.trim().replace(/\/+$/, '') : '';
})();

function mediaOrigin(): string {
  const source = /^https?:\/\//i.test(MEDIA_BASE) ? MEDIA_BASE : API_BASE;
  if (!/^https?:\/\//i.test(source)) return '';
  try {
    return new URL(source).origin;
  } catch {
    return '';
  }
}

/**
 * 商品图片地址归一。
 * - 已是 http(s)/data/blob 完整地址：原样返回（契约要求库里只落 `/media/...` 本地地址，不热链外部图床）；
 * - 本地相对 `/media/...`：优先拼到媒体基址（`__MIXMAPP_MEDIA_BASE__`，生产为 img.mixm.top），
 *   未配置时拼到 API 源 origin，**不带入 `/api/v1` 段**；
 *   API_BASE 同源相对（生产 `/api/v1`）时保留相对路径，由浏览器按当前站点 origin 解析。
 * - 空值返回空串，调用方据此渲染占位块，避免破图。
 */
export function mediaUrl(src?: string | null): string {
  if (src == null) return '';
  const trimmed = String(src).trim();
  if (!trimmed) return '';
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  if (!trimmed.startsWith('/')) return trimmed;
  const origin = mediaOrigin();
  if (!origin) return trimmed;
  return `${origin}${trimmed}`;
}

/** 形如 `#0f9d8f` 的 16 进制色值：后端给无图商品（mix-p-* 自有商品）的 cover 存的就是它。 */
function isTint(src?: string | null): boolean {
  const value = src == null ? '' : String(src).trim();
  return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
}

/** 该值能否当作图片地址使用（排除空值、色值、纯文本）。 */
function isMediaRef(src?: string | null): boolean {
  const value = src == null ? '' : String(src).trim();
  if (!value || isTint(value)) return false;
  return /^(https?:|data:|blob:)/i.test(value) || value.startsWith('/');
}

/**
 * 商品封面地址：`images[0]` 优先，退回 `cover`。
 * 后端把无图商品的 `cover` 存成 16 进制色值，直接塞进 <image> 必然触发 @error 变成破图，
 * 所以这里过滤掉非图片值并返回空串，由调用方渲染占位块（底色取 coverTint）。
 */
export function productCover(product: {
  images?: string[] | null;
  cover?: string | null;
}): string {
  const images = Array.isArray(product.images) ? product.images : [];
  const first = images.find((item) => isMediaRef(item));
  if (first) return mediaUrl(first);
  return isMediaRef(product.cover) ? mediaUrl(product.cover) : '';
}

/** 无图商品的占位底色（`#0f9d8f` 这类色值），没有则返回空串沿用默认纸色。 */
export function coverTint(product: { images?: string[] | null; cover?: string | null }): string {
  const images = Array.isArray(product.images) ? product.images : [];
  if (images.some((item) => isMediaRef(item))) return '';
  return isTint(product.cover) ? String(product.cover).trim() : '';
}

/* ---------- 本地矢量高清占位图 ----------
 * 无真实商品图时，按 cover 色值 / 类目派生一张 1024×1024 的 SVG 矢量封面。
 * 矢量在任意分辨率下都不失真（高清 / 超高清缩放不糊），离线可用、不依赖外部图库。
 * 后续接入 AI 生成 / 免费可商用图库 / 用户原图时，只要把真实地址写进 images[0]，
 * 本占位会被 productCover 自动让位，无需改页面。 */

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m || m[1] == null) return null;
  let h: string = m[1];
  if (h.length === 3 || h.length === 4) {
    h = h
      .split('')
      .map((c) => `${c}${c}`)
      .join('');
  }
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(hex: string, amt: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const target = amt < 0 ? 0 : 255;
  const p = Math.abs(amt) / 100;
  const out = rgb.map((v: number) => Math.round(v + (target - v) * p));
  return `#${out.map((v: number) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** 类目 → 占位主色（自有演示商品无 cover 图时按类目取色）。 */
const CATEGORY_PLACEHOLDER: Record<string, string> = {
  featured: '#0f9d8f',
  life: '#334155',
  digital: '#0b1220',
  wear: '#1f2937',
  home: '#0e7490',
  beauty: '#a21caf',
  food: '#92400e',
  sports: '#16a34a',
};

/**
 * 无图商品的矢量占位封面（data URI SVG）。
 * 有真实图时返回空串，由调用方走 <image> 真实图路径。
 */
export function placeholderArt(product: {
  images?: string[] | null;
  cover?: string | null;
  category?: string | null;
}): string {
  if (productCover(product)) return '';
  const tint = coverTint(product);
  const base = tint || CATEGORY_PLACEHOLDER[product.category ?? ''] || '#0f9d8f';
  const top = shade(base, 18);
  const bottom = shade(base, -22);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#g)"/><circle cx="760" cy="260" r="360" fill="rgba(255,255,255,0.10)"/><circle cx="760" cy="260" r="240" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2"/><circle cx="240" cy="800" r="300" fill="rgba(255,255,255,0.07)"/><path d="M0 760 L1024 360" stroke="rgba(255,255,255,0.10)" stroke-width="2"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RawResponse = { statusCode: number; data: unknown };

function rawRequest(options: {
  url: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  data?: unknown;
  headers?: Record<string, string>;
}): Promise<RawResponse> {
  // uni 的 H5 适配层会给所有非 GET 请求强制补 JSON content-type，空 body 会被服务端按非法 JSON 拒掉（400）；
  // 因此无 body 的写请求统一补一个空对象。
  const data = options.data === undefined && options.method !== 'GET' ? {} : options.data;
  return new Promise((resolve, reject) => {
    uni.request({
      url: options.url,
      method: options.method as UniApp.RequestOptions['method'],
      data: data as Record<string, unknown> | undefined,
      header: { 'content-type': 'application/json', ...(options.headers ?? {}) },
      timeout: 15000,
      success: (res) => resolve({ statusCode: res.statusCode, data: res.data }),
      fail: (err) => reject(new ApiError('NETWORK', err.errMsg || '网络异常', 0)),
    });
  });
}

const TOKEN_KEY = 'mixmapp:tokens';
const ADMIN_TOKEN_KEY = 'mixmapp:adminToken';

/** 管理令牌只存本机，页面刷新后自动复用；服务端令牌才是权威 */
export function readAdminToken(): string {
  try {
    const value = uni.getStorageSync(ADMIN_TOKEN_KEY) as string | '';
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

export function writeAdminToken(token: string): void {
  uni.setStorageSync(ADMIN_TOKEN_KEY, token);
}

export type StoredTokens = { accessToken: string; refreshToken: string; expiresAt: number };

export function readTokens(): StoredTokens | null {
  try {
    const raw = uni.getStorageSync(TOKEN_KEY) as StoredTokens | '';
    return raw && raw.accessToken ? raw : null;
  } catch {
    return null;
  }
}

export function writeTokens(tokens: { accessToken: string; refreshToken: string; expiresIn: number }): void {
  uni.setStorageSync(TOKEN_KEY, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
  } satisfies StoredTokens);
}

export function clearTokens(): void {
  uni.removeStorageSync(TOKEN_KEY);
}

let refreshing: Promise<boolean> | null = null;

/** 401 时用刷新令牌换新 access token，只允许并发一次。 */
async function ensureRefreshed(): Promise<boolean> {
  const tokens = readTokens();
  if (!tokens?.refreshToken) return false;
  if (!refreshing) {
    refreshing = (async () => {
      const res = await rawRequest({
        url: `${API_BASE}/auth/refresh`,
        method: 'POST',
        data: { refreshToken: tokens.refreshToken },
      });
      if (res.statusCode !== 200) {
        clearTokens();
        return false;
      }
      const auth = (res.data as { data: AuthResult }).data;
      writeTokens(auth.tokens);
      uni.setStorageSync('mixmapp:user', auth.user);
      return true;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    data?: unknown;
    auth?: boolean;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const execute = async (): Promise<RawResponse> => {
    const tokens = readTokens();
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.auth !== false && tokens?.accessToken) {
      headers.authorization = `Bearer ${tokens.accessToken}`;
    }
    return rawRequest({
      url: `${API_BASE}${path}`,
      method: options.method ?? 'GET',
      data: options.data,
      headers,
    });
  };

  let res = await execute();
  if (res.statusCode === 401 && options.auth !== false && (await ensureRefreshed())) {
    res = await execute();
  }
  const body = res.data as { data?: T; error?: { code: string; message: string } };
  if (res.statusCode >= 200 && res.statusCode < 300) return body.data as T;
  throw new ApiError(
    body.error?.code ?? 'INTERNAL',
    body.error?.message ?? `请求失败(${res.statusCode})`,
    res.statusCode,
  );
}

/**
 * 第三方登录发起地址。由浏览器整页跳转到服务端 `/auth/oauth/:provider/start`，
 * 服务端 302 到渠道授权页，回跳后再带 `code` 回到当前页面。
 * 未配置的渠道不要调用，服务端会返回 `PROVIDER_DISABLED`。
 */
export function oauthStartUrl(provider: OAuthProviderId, redirect?: string): string {
  const base = API_BASE.replace(/\/+$/, '');
  const back = redirect ?? (typeof window !== 'undefined' ? window.location.href : '');
  return `${base}/auth/oauth/${provider}/start${back ? `?redirect=${encodeURIComponent(back)}` : ''}`;
}

export type OAuthProviderOption = {
  key: OAuthProviderId;
  label: string;
  region: 'cn' | 'intl';
  /** 是否支持 H5 服务端跳转授权；false 表示需要端侧 SDK */
  h5: boolean;
  requiresCredentials: boolean;
};

/** 登录页入口清单：服务端只下发已配置渠道。 */
export const oauthApi = {
  providers: () =>
    apiRequest<{ providers: OAuthProviderOption[]; onekey: { enabled: boolean } }>(
      '/auth/oauth/providers',
      { auth: false },
    ),
};

/** 登录入参里的可选设备快照（契约 docs/39 §3.1）；缺省时服务端行为与既有链路完全一致。 */
export type DeviceLoginInput = {
  deviceId: string;
  model?: string;
  osName?: string;
  osVersion?: string;
  networkType?: string;
  carrier?: string;
};

/**
 * 组装登录请求携带的设备字段：调用方显式传入优先；未传时取本地快照。
 * 快照不含 ip（ip 只由服务端产生），与 `/device/context` 上报口径一致。
 */
function loginDevicePayload(input?: DeviceLoginInput): DeviceLoginInput {
  if (input) return input;
  const snapshot = getDeviceSnapshot();
  return {
    deviceId: snapshot.deviceId,
    model: snapshot.model,
    osName: snapshot.osName,
    osVersion: snapshot.osVersion,
    networkType: snapshot.networkType,
    carrier: snapshot.carrier,
  };
}

export const authApi = {
  requestSmsCode: (phone: string, purpose: 'register' | 'login' | 'bind') =>
    apiRequest<{ ttlSec: number; devCode?: string }>('/auth/sms/code', {
      method: 'POST',
      data: { phone, purpose },
      auth: false,
    }),
  registerByPhone: (input: {
    phone: string;
    code: string;
    nickname?: string;
    privacyConsent?: PrivacyConsentInput;
  }) => apiRequest<AuthResult>('/auth/register/phone', { method: 'POST', data: input, auth: false }),
  registerByEmail: (input: {
    email: string;
    password: string;
    nickname?: string;
    privacyConsent?: PrivacyConsentInput;
  }) => apiRequest<AuthResult>('/auth/register/email', { method: 'POST', data: input, auth: false }),
  registerByUsername: (input: {
    username: string;
    password: string;
    nickname?: string;
    privacyConsent?: PrivacyConsentInput;
  }) =>
    apiRequest<AuthResult>('/auth/register/username', { method: 'POST', data: input, auth: false }),
  /** 游客注册：同一设备重复调用返回同一账号 */
  registerGuest: (input: {
    deviceId: string;
    nickname?: string;
    privacyConsent?: PrivacyConsentInput;
  }) => apiRequest<AuthResult>('/auth/register/guest', { method: 'POST', data: input, auth: false }),
  /** 一键登录：已注册手机号即登录，未注册即建号 */
  oneKey: (input: { token: string; nickname?: string; privacyConsent?: PrivacyConsentInput }) =>
    apiRequest<AuthResult>('/auth/onekey', { method: 'POST', data: input, auth: false }),
  loginByPassword: (input: { account: string; password: string; device?: DeviceLoginInput }) =>
    apiRequest<AuthResult>('/auth/login/password', {
      method: 'POST',
      data: { account: input.account, password: input.password, device: loginDevicePayload(input.device) },
      auth: false,
    }),
  loginBySms: (input: { phone: string; code: string; device?: DeviceLoginInput }) =>
    apiRequest<AuthResult>('/auth/login/sms', {
      method: 'POST',
      data: { phone: input.phone, code: input.code, device: loginDevicePayload(input.device) },
      auth: false,
    }),
  loginByOAuth: (provider: OAuthProviderId, code: string, device?: DeviceLoginInput) =>
    apiRequest<AuthResult>('/auth/login/oauth', {
      method: 'POST',
      data: { provider, code, device: loginDevicePayload(device) },
      auth: false,
    }),
  logout: (refreshToken: string) =>
    apiRequest<{ ok: boolean }>('/auth/logout', { method: 'POST', data: { refreshToken }, auth: false }),
};

/** 手机补绑结果：发生账号合并时返回主账号资料与新令牌，调用方必须换用新令牌。 */
export type BindPhoneResult = {
  user: UserDto;
  tokens: TokenPair;
  merged?: {
    mergeId: string;
    replayed: boolean;
    moved: unknown;
    conflictStrategy: Record<string, string>;
  } | null;
};

/** 设备推送注册入参；provider 缺省 jpush。 */
export type PushTokenInput = {
  token: string;
  platform: 'android' | 'ios' | 'harmony' | 'web';
  provider?: 'fcm' | 'jpush';
};

export const meApi = {
  get: () => apiRequest<UserDto>('/me'),
  update: (patch: { nickname?: string; avatarUrl?: string; bio?: string }) =>
    apiRequest<UserDto>('/me', { method: 'PATCH', data: patch }),
  bindPhone: (phone: string, code: string) =>
    apiRequest<BindPhoneResult>('/me/bind/phone', { method: 'POST', data: { phone, code } }),
  /** 邮箱补绑：需校验当前账号密码；绑定后可用邮箱 + 密码登录。 */
  bindEmail: (email: string, password: string) =>
    apiRequest<UserDto>('/me/bind/email', { method: 'POST', data: { email, password } }),
  /** 给游客账号补设用户名密码，绑定后不再算游客 */
  bindUsername: (username: string, password: string) =>
    apiRequest<UserDto>('/me/bind/username', { method: 'POST', data: { username, password } }),
  /** 把已授权的第三方身份绑定到当前账号（回跳 code 换绑）。 */
  linkOAuth: (provider: OAuthProviderId, code: string) =>
    apiRequest<UserDto>('/me/bind/oauth', { method: 'POST', data: { provider, code } }),
  /** 解绑第三方渠道；仅剩一种登录方式时服务端会返回 409 */
  unbindOAuth: (provider: OAuthProviderId) =>
    apiRequest<UserDto>(`/me/bind/oauth/${provider}`, { method: 'DELETE' }),
  /** 上报设备推送令牌；推送未配置时服务端回退 dev，不阻断。 */
  pushToken: (input: PushTokenInput) =>
    apiRequest<{ ok: boolean }>('/me/push-token', { method: 'POST', data: input }),
  /** 向已注册设备发一条测试推送；尚未注册令牌时服务端返回 404。 */
  pushTest: () => apiRequest<{ accepted: number }>('/me/push-test', { method: 'POST' }),
};

/** 服务端落库并回写的设备快照（含服务端产生的 ip 与采集时间）。 */
export type DeviceContextDto = {
  deviceId: string;
  model: string;
  osName: string;
  osVersion: string;
  ip: string;
  networkType: string;
  carrier: string;
  updatedAt: string;
};

/** GET /device/context 无记录时 data.device = null（不报 404）。 */
export type DeviceContextQueryResult = { device: DeviceContextDto | null };

export const deviceApi = {
  /** 上报 / 刷新当前快照（需登录）；body 不带 ip / updatedAt，由服务端写入后回传。 */
  reportContext: (snapshot: DeviceSnapshot) =>
    apiRequest<DeviceContextDto>('/device/context', {
      method: 'POST',
      data: {
        deviceId: snapshot.deviceId,
        model: snapshot.model,
        osName: snapshot.osName,
        osVersion: snapshot.osVersion,
        networkType: snapshot.networkType,
        carrier: snapshot.carrier,
      },
    }),
  /** 只读查询；不传 deviceId 返回该用户最近一条，无记录返回 device = null。 */
  getContext: (deviceId?: string) =>
    apiRequest<DeviceContextQueryResult>(
      `/device/context${deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ''}`,
    ),
};

export const metaApi = {
  get: () =>
    apiRequest<{
      appName: string;
      version: string;
      env: string;
      ids: { strategies: string[]; current: string };
      thirdParty: Record<string, string>;
      mall?: { demoMode?: boolean };
      serverTime: string;
    }>('/meta', { auth: false }),
};

/**
 * 演示沙箱标记缓存：后端 `MALL_DEMO_MODE` 控制。
 * true = 下单只做流程预览，不产生真实订单 / 扣款；false = 真实链路。
 * meta 未下发时默认 true（保守，防误提交）。
 */
let demoModeCache: boolean | null = null;

/** 读取演示沙箱标记；先取缓存，缺省按演示模式处理。 */
export function isDemoOrderMode(): boolean {
  return demoModeCache ?? true;
}

/** 由 meta 响应回填演示标记。 */
export function applyMetaFlags(meta: { mall?: { demoMode?: boolean } } | null | undefined): void {
  demoModeCache = meta?.mall?.demoMode !== false;
}

/** 第三方能力快照（meta.thirdParty）：键为渠道域，值为 provider 名或 on/off。 */
let metaThirdParty: Record<string, string> = {};

/** 回填第三方能力快照；与演示标记同源，页面据此条件渲染入口。 */
export function applyMetaThirdParty(meta: { thirdParty?: Record<string, string> } | null | undefined): void {
  metaThirdParty = meta?.thirdParty ?? {};
}

/** 读取某能力在服务端的装配状态（off / dev / console / local / jpush / fcm / amap / on…）。 */
export function providerState(key: string): string {
  return metaThirdParty[key] ?? 'off';
}

/**
 * 能力是否已装配：与「关于与能力」页同一口径，非 off 即视为已配置回退态。
 * dev/console/local 表示有安全回退、可走通链路；真正调外部渠道仍以 provider 名为准。
 */
export function providerLive(key: string): boolean {
  return providerState(key) !== 'off';
}

export type DbStatusDto = {
  target: 'cloudbase' | 'server';
  driver: string;
  host: string;
  source: string;
  available: Record<'cloudbase' | 'server', { configured: boolean; host: string }>;
};

export type MergeCandidateDto = {
  unionId: string;
  userIds: string[];
  bindingIds: string[];
};

export type AccountMergeDto = {
  id: string;
  mergeKey: string;
  primaryUserId: string;
  secondaryUserId: string;
  reason: string;
  status: string;
  moved: unknown;
  conflictStrategy: Record<string, string>;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  rolledBackAt: string | null;
};

export type ProviderStateDto = {
  key: string;
  name: string;
  group: 'A' | 'B' | 'C';
  status: 'ready' | 'unconfigured' | 'disabled' | 'unavailable';
  enabled: boolean;
  missing: string[];
  reason: string | null;
};

export type ProviderSummaryDto = {
  total: number;
  byGroup: Record<string, number>;
  byStatus: Record<string, number>;
  ready: string[];
  unavailable: string[];
};

/** 后台会话摘要（契约 docs/39 §3.3）：会话 id 只返哈希前缀 8 位，不返原文。 */
export type AdminUserSessionDto = {
  id: string;
  createdAt: string;
  revokedAt: string | null;
  deviceId: string;
  model: string;
  osName: string;
  osVersion: string;
  networkType: string;
  carrier: string;
  ip: string;
  lastSeenAt: string;
};

/** 目录导入报告：字段由 mall.importCatalog 决定，这里保留宽松索引便于展示计数。 */
export type ImportReportDto = {
  imported?: number;
  skipped?: number;
  failed?: number;
  [key: string]: unknown;
};

/** 管理面：需要 x-admin-token；未在服务端设置 ADMIN_TOKEN 时这些接口整体 404 */
export const adminApi = {
  db: (token: string) => apiRequest<DbStatusDto>('/admin/db', { auth: false, headers: { 'x-admin-token': token } }),
  switchDb: (token: string, target: 'cloudbase' | 'server') =>
    apiRequest<DbStatusDto & { switched: { from: string; to: string; host: string } }>(
      '/admin/db/switch',
      { method: 'POST', data: { target }, auth: false, headers: { 'x-admin-token': token } },
    ),
  sweepOrders: (token: string) =>
    apiRequest<{ ttlMinutes: number; cancelled: string[]; count: number }>('/admin/orders/sweep', {
      method: 'POST',
      auth: false,
      headers: { 'x-admin-token': token },
    }),
  // ===== 账号合并审计 =====
  /** 历史重复账号候选：同一 union_id 落在多个账号上。 */
  mergesCandidates: (token: string) =>
    apiRequest<{ count: number; candidates: MergeCandidateDto[] }>('/admin/merges/candidates', {
      auth: false,
      headers: { 'x-admin-token': token },
    }),
  /** 最近的合并记录列表。 */
  merges: (token: string, limit = 50) =>
    apiRequest<AccountMergeDto[]>(`/admin/merges?limit=${encodeURIComponent(String(limit))}`, {
      auth: false,
      headers: { 'x-admin-token': token },
    }),
  /** 单条合并记录详情。 */
  mergeDetail: (token: string, id: string) =>
    apiRequest<AccountMergeDto>(`/admin/merges/${encodeURIComponent(id)}`, {
      auth: false,
      headers: { 'x-admin-token': token },
    }),
  /** 按合并前快照回滚（仅 completed 可回滚；刷新令牌无法复活）。 */
  rollbackMerge: (token: string, id: string) =>
    apiRequest<{ merge: AccountMergeDto; primary: UserDto }>(
      `/admin/merges/${encodeURIComponent(id)}/rollback`,
      { method: 'POST', auth: false, headers: { 'x-admin-token': token } },
    ),
  // ===== 第三方登录渠道注册表 =====
  /** 全量渠道：状态、缺失配置、不可用原因、运行时开关。 */
  oauthProviders: (token: string) =>
    apiRequest<{ summary: ProviderSummaryDto; providers: ProviderStateDto[] }>('/admin/oauth/providers', {
      auth: false,
      headers: { 'x-admin-token': token },
    }),
  /** 单独启停某渠道：热生效；C 类或缺配置渠道服务端拒绝开启。 */
  toggleOAuthProvider: (token: string, key: string, enabled: boolean) =>
    apiRequest<ProviderStateDto>(`/admin/oauth/providers/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      data: { enabled },
      auth: false,
      headers: { 'x-admin-token': token },
    }),
  // ===== 目录导入 =====
  /** 按仓库内 catalog.json 文件路径（或直接给 catalog 对象）触发导入。 */
  mallImport: (token: string, payload: { file?: string; batch?: string; catalog?: unknown }) =>
    apiRequest<ImportReportDto>('/admin/mall/import', {
      method: 'POST',
      data: payload,
      auth: false,
      headers: { 'x-admin-token': token },
    }),
  /**
   * 某用户最近 N 条登录会话摘要；走 /admin/console/* Cookie 会话（与 x-admin-token 面不同）。
   * GET 只读，不带 x-mixm-console 写头；未登录 / 无会话服务端按既有口径 404。
   */
  userSessions: (userId: string) =>
    apiRequest<AdminUserSessionDto[]>(`/admin/console/users/${encodeURIComponent(userId)}/sessions`, {
      auth: false,
    }),
};

export const mallApi = {
  listProducts: (
    query: {
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
    } = {},
  ) => {
    const qs = Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');
    return apiRequest<MallProductDto[]>(`/mall/products${qs ? `?${qs}` : ''}`, { auth: false });
  },
  getProduct: (productId: string) =>
    apiRequest<MallProductDto>(`/mall/products/${encodeURIComponent(productId)}`, { auth: false }),
  /** 一级分类 + 商品计数；后端未就绪时前端兜底只留「全部」。 */
  listCategories: () => apiRequest<MallCategoryDto[]>('/mall/categories', { auth: false }),
  /**
   * 分类树下一层：不传 parent 取树的一级（?parent=root），传节点 id（c1:/c2:）取其直接子级。
   * includeEmpty=true 时连同 0 商品节点一起返回，用于「商品分类」抽屉按源站整棵树一比一展示。
   */
  listCategoryChildren: (parent?: string, includeEmpty?: boolean) =>
    apiRequest<MallCategoryNodeDto[]>(
      `/mall/categories?parent=${encodeURIComponent(parent || 'root')}${includeEmpty ? '&includeEmpty=1' : ''}`,
      { auth: false },
    ),
  /** 三级类目下可用的规格筛选值（dims/lens）。 */
  listSpecOptions: (c3: string) =>
    apiRequest<MallSpecOptionsDto>(`/mall/specs?c3=${encodeURIComponent(c3)}`, { auth: false }),
  getCart: () => apiRequest<CartDto>('/mall/cart'),
  addToCart: (productId: string, quantity = 1, packUnit?: string, packQty?: number) =>
    apiRequest<CartDto>('/mall/cart', {
      method: 'POST',
      data: {
        productId,
        quantity,
        ...(packUnit ? { packUnit } : {}),
        ...(packQty != null ? { packQty } : {}),
      },
    }),
  updateCart: (productId: string, quantity: number, packUnit?: string, packQty?: number) =>
    apiRequest<CartDto>(`/mall/cart/${encodeURIComponent(productId)}`, {
      method: 'PATCH',
      data: {
        quantity,
        ...(packUnit ? { packUnit } : {}),
        ...(packQty != null ? { packQty } : {}),
      },
    }),
  removeCart: (productId: string) =>
    apiRequest<CartDto>(`/mall/cart/${encodeURIComponent(productId)}`, { method: 'DELETE' }),
  clearCart: () => apiRequest<CartDto>('/mall/cart', { method: 'DELETE' }),
  createOrder: (input: OrderCreateInput) =>
    apiRequest<OrderDto>('/mall/orders', { method: 'POST', data: input }),
  listOrders: () => apiRequest<OrderDto[]>('/mall/orders'),
  getOrder: (orderNo: string) =>
    apiRequest<OrderDto>(`/mall/orders/${encodeURIComponent(orderNo)}`),
  /** 用户侧取消订单（0018）：已分配拣货/已发货/已完成不可取消；重复取消服务端幂等返回当前订单 */
  cancelOrder: (orderNo: string, reason?: string) =>
    apiRequest<OrderDto>(`/mall/orders/${encodeURIComponent(orderNo)}/cancel`, {
      method: 'POST',
      data: reason ? { reason } : {},
    }),
  // ===== 收藏夹（0019） =====
  /** 收藏夹列表：服务端首次访问会懒创建「默认收藏夹」 */
  listFavoriteFolders: () => apiRequest<FavoriteFolderDto[]>('/mall/favorites/folders'),
  /** 收藏条目：folderId 省略取默认收藏夹 */
  listFavoriteItems: (folderId?: string) =>
    apiRequest<FavoriteItemDto[]>(
      `/mall/favorites/items${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`,
    ),
  /** 加收藏：同夹重复收藏幂等返回原有条目 */
  addFavorite: (productId: string, folderId?: string) =>
    apiRequest<FavoriteItemDto>('/mall/favorites/items', {
      method: 'POST',
      data: { productId, ...(folderId ? { folderId } : {}) },
    }),
  /** 删收藏条目：不存在也算成功 */
  removeFavorite: (productId: string, folderId?: string) =>
    apiRequest<{ removed: boolean }>(
      `/mall/favorites/items/${encodeURIComponent(productId)}${
        folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''
      }`,
      { method: 'DELETE' },
    ),
  /** 复制收藏夹：name 省略时服务端生成「<原名> 的副本」 */
  copyFavoriteFolder: (folderId: string, name?: string) =>
    apiRequest<FavoriteFolderDto>(`/mall/favorites/folders/${encodeURIComponent(folderId)}/copy`, {
      method: 'POST',
      data: name ? { name } : {},
    }),
  /** 设默认收藏夹 */
  setDefaultFavoriteFolder: (folderId: string) =>
    apiRequest<FavoriteFolderDto>(`/mall/favorites/folders/${encodeURIComponent(folderId)}/default`, {
      method: 'POST',
    }),
  /** 清空收藏夹（收藏夹本身保留） */
  clearFavoriteFolder: (folderId: string) =>
    apiRequest<{ removed: number }>(
      `/mall/favorites/folders/${encodeURIComponent(folderId)}/items`,
      { method: 'DELETE' },
    ),
};

/**
 * 首页运营位（home/ggs 广告位、home/rcs 推荐分类）：公开读，不需要登录态。
 * 内容由服务端下发，前端只负责排版；接口失败时首页照常展示搜索与目录，不做阻断。
 */
export const homeApi = {
  /** 首页广告位：服务端按 sortNo 排好序 */
  getAds: () => apiRequest<HomeAdDto[]>('/home/ggs', { auth: false }),
  /** 首页推荐分类：默认取商品数最多的 6 个一级分类 */
  getRecommendedCategories: (limit?: number) =>
    apiRequest<HomeRecommendedCategoryDto[]>(
      `/home/rcs${limit ? `?limit=${encodeURIComponent(String(limit))}` : ''}`,
      { auth: false },
    ),
};

/* ---------- 第三方集成（地图 / 对象存储 / 支付 / AI） ---------- */

export type RegeoResult = {
  address: string;
  province: string;
  city: string;
  district: string;
  adcode: string;
};

export type RouteResult = {
  distanceMeters: number;
  durationSec: number;
  steps: string[];
};

export type PresignUploadResult = {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
  key: string;
  publicUrl: string;
};

export type PayOrderDto = {
  id: string;
  outTradeNo: string;
  channel: 'wechat' | 'alipay';
  amountFen: number;
  subject: string;
  status: 'pending' | 'paid' | 'failed' | 'closed';
  prepay: Record<string, unknown> | null;
  transactionId: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type PayOrderResult = {
  outTradeNo: string;
  channel: 'wechat' | 'alipay';
  amountFen: number;
  status: 'pending';
  payload: Record<string, unknown>;
  /** live = 已接真实商户；dev = 仅走通下单链路，不真实扣款 */
  mode: 'live' | 'dev';
};

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type AiChatResult = {
  content: string;
  usage?: { promptTokens: number; completionTokens: number };
};

export const integrationsApi = {
  map: {
    /** 逆地理编码：坐标 → 省市区与结构化地址。 */
    regeo: (longitude: number, latitude: number) =>
      apiRequest<RegeoResult>('/map/regeo', { method: 'POST', data: { longitude, latitude } }),
    /** 路径规划：步行 / 驾车 / 骑行。 */
    route: (
      from: { longitude: number; latitude: number },
      to: { longitude: number; latitude: number },
      mode: 'walking' | 'driving' | 'riding' = 'walking',
    ) => apiRequest<RouteResult>('/map/route', { method: 'POST', data: { from, to, mode } }),
  },
  storage: {
    /** 预签名上传地址；拿到 url 后由前端直接 PUT 文件二进制。 */
    presign: (key: string, contentType?: string, expiresIn?: number) =>
      apiRequest<PresignUploadResult>('/storage/presign', {
        method: 'POST',
        data: { key, ...(contentType ? { contentType } : {}), ...(expiresIn ? { expiresIn } : {}) },
      }),
  },
  pay: {
    /** 发起支付：未配置商户时服务端返回 dev 模式占位参数，不真实扣款。 */
    createOrder: (input: CreatePaymentInput) =>
      apiRequest<PayOrderResult>('/pay/orders', { method: 'POST', data: input }),
    /** 按商户订单号查询支付状态。 */
    getOrder: (outTradeNo: string) =>
      apiRequest<PayOrderDto>(`/pay/orders/${encodeURIComponent(outTradeNo)}`),
  },
  ai: {
    /** 通用对话；未配置 AI Key 时服务端回退开发态回显。 */
    chat: (messages: ChatMessage[], model?: string, temperature?: number) =>
      apiRequest<AiChatResult>('/ai/chat', {
        method: 'POST',
        data: { messages, ...(model ? { model } : {}), ...(temperature != null ? { temperature } : {}) },
      }),
  },
};

/** 图片直传结果：publicUrl 为落库地址（local 存储为 `/media/<key>` 站内相对路径）。 */
export type UploadImageResult = { publicUrl: string; key: string };

const IMAGE_EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

function extFromContentType(contentType: string): string {
  return IMAGE_EXT_BY_CONTENT_TYPE[contentType.toLowerCase()] ?? 'jpg';
}

/** 二进制 PUT 直传；uni.request 的 data 支持 ArrayBuffer，跨端复用。 */
function putBinary(url: string, body: ArrayBuffer, headers: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method: 'PUT',
      data: body,
      header: { ...headers },
      timeout: 30000,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new ApiError('UPLOAD', `上传失败(${res.statusCode})`, res.statusCode));
      },
      fail: (err) => reject(new ApiError('NETWORK', err.errMsg || '网络异常', 0)),
    });
  });
}

/** 把相对预签名地址补成绝对地址；绝对地址（local / s3）原样返回。 */
function absoluteUploadUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const origin = (() => {
    try {
      return new URL(API_BASE).origin;
    } catch {
      return '';
    }
  })();
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * 图片直传：先取预签名地址，再把二进制 PUT 上去。
 * - local 存储：落到服务器磁盘，读回走 `/media/<key>`；
 * - s3 兼容存储：走预签名直传；
 * - dev 回退：占位地址，未配置真实存储时由调用方兜底提示。
 * 选图（File/Blob）在调用端完成，本函数只负责上传与返回落库地址。
 */
export async function uploadImageBlob(
  blob: Blob,
  kind: 'avatar' | 'image' = 'image',
): Promise<UploadImageResult> {
  const contentType = blob.type || 'image/jpeg';
  const ext = extFromContentType(contentType);
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const key = `${kind}/${stamp}.${ext}`;
  const presigned = await integrationsApi.storage.presign(key, contentType);
  const body = await blob.arrayBuffer();
  await putBinary(absoluteUploadUrl(presigned.url), body, presigned.headers);
  return { publicUrl: presigned.publicUrl, key: presigned.key };
}
