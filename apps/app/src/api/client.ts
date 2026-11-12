import type {
  AuthResult,
  CartDto,
  OrderCreateInput,
  OrderDto,
  ProductDto,
  UserDto,
} from '@mixmapp/contracts';

/**
 * 统一 API 基址。优先级：
 * 1. 运行时注入 `window.__MIXMAPP_API_BASE__`（静态托管平台部署时写进 HTML，改地址不用重新构建）
 * 2. 本地存储 `mixmapp:apiBase`（调试/应急切换）
 * 3. 构建变量 `VITE_MIXMAPP_API_BASE`
 * 4. 开发态指向本机 8080，生产态同源 `/api/v1`
 *
 * 注意：静态平台只托管前端，没有 `/api/v1` 路由；部署到这类平台时必须给出 API 源，
 * 否则所有请求会落到托管域名上并返回 404。
 */
function readRuntimeApiBase(): string | undefined {
  const injected = (globalThis as { __MIXMAPP_API_BASE__?: unknown }).__MIXMAPP_API_BASE__;
  if (typeof injected === 'string' && injected.trim()) return injected.trim();
  try {
    const stored = uni.getStorageSync('mixmapp:apiBase');
    if (typeof stored === 'string' && stored.trim()) return stored.trim();
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
export const API_BASE: string = normalizeApiBase(
  readRuntimeApiBase() ?? (buildApiBase || undefined) ?? (env.DEV ? 'http://127.0.0.1:8080/api/v1' : '/api/v1'),
);

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
  return new Promise((resolve, reject) => {
    uni.request({
      url: options.url,
      method: options.method as UniApp.RequestOptions['method'],
      data: options.data as Record<string, unknown> | undefined,
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

export const authApi = {
  requestSmsCode: (phone: string, purpose: 'register' | 'login' | 'bind') =>
    apiRequest<{ ttlSec: number; devCode?: string }>('/auth/sms/code', {
      method: 'POST',
      data: { phone, purpose },
      auth: false,
    }),
  registerByPhone: (input: { phone: string; code: string; nickname?: string }) =>
    apiRequest<AuthResult>('/auth/register/phone', { method: 'POST', data: input, auth: false }),
  registerByEmail: (input: { email: string; password: string; nickname?: string }) =>
    apiRequest<AuthResult>('/auth/register/email', { method: 'POST', data: input, auth: false }),
  registerByUsername: (input: { username: string; password: string; nickname?: string }) =>
    apiRequest<AuthResult>('/auth/register/username', { method: 'POST', data: input, auth: false }),
  /** 游客注册：同一设备重复调用返回同一账号 */
  registerGuest: (input: { deviceId: string; nickname?: string }) =>
    apiRequest<AuthResult>('/auth/register/guest', { method: 'POST', data: input, auth: false }),
  /** 一键登录：已注册手机号即登录，未注册即建号 */
  oneKey: (input: { token: string; nickname?: string }) =>
    apiRequest<AuthResult>('/auth/onekey', { method: 'POST', data: input, auth: false }),
  loginByPassword: (input: { account: string; password: string }) =>
    apiRequest<AuthResult>('/auth/login/password', { method: 'POST', data: input, auth: false }),
  loginBySms: (input: { phone: string; code: string }) =>
    apiRequest<AuthResult>('/auth/login/sms', { method: 'POST', data: input, auth: false }),
  loginByOAuth: (provider: 'wechat' | 'qq' | 'github' | 'apple', code: string) =>
    apiRequest<AuthResult>('/auth/login/oauth', {
      method: 'POST',
      data: { provider, code },
      auth: false,
    }),
  logout: (refreshToken: string) =>
    apiRequest<{ ok: boolean }>('/auth/logout', { method: 'POST', data: { refreshToken }, auth: false }),
};

export const meApi = {
  get: () => apiRequest<UserDto>('/me'),
  update: (patch: { nickname?: string; avatarUrl?: string; bio?: string }) =>
    apiRequest<UserDto>('/me', { method: 'PATCH', data: patch }),
  bindPhone: (phone: string, code: string) =>
    apiRequest<UserDto>('/me/bind/phone', { method: 'POST', data: { phone, code } }),
  /** 给游客账号补设用户名密码，绑定后不再算游客 */
  bindUsername: (username: string, password: string) =>
    apiRequest<UserDto>('/me/bind/username', { method: 'POST', data: { username, password } }),
};

export const idsApi = {
  preview: (strategy: 'snowflake' | 'ulid' | 'uuidv7') =>
    apiRequest<{
      id: string;
      snowflake: string;
      accountNo: string;
      ulid: string;
      uuidV7: string;
    }>('/ids/preview', { method: 'POST', data: { strategy }, auth: false }),
};

export const metaApi = {
  get: () =>
    apiRequest<{
      appName: string;
      version: string;
      env: string;
      ids: { strategies: string[]; current: string };
      thirdParty: Record<string, string>;
      serverTime: string;
    }>('/meta', { auth: false }),
};

export type DbStatusDto = {
  target: 'cloudbase' | 'server';
  driver: string;
  host: string;
  source: string;
  available: Record<'cloudbase' | 'server', { configured: boolean; host: string }>;
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
};

export const mallApi = {
  listProducts: (query: { category?: string; keyword?: string; page?: number; pageSize?: number } = {}) => {
    const qs = Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');
    return apiRequest<ProductDto[]>(`/mall/products${qs ? `?${qs}` : ''}`, { auth: false });
  },
  getProduct: (productId: string) =>
    apiRequest<ProductDto>(`/mall/products/${encodeURIComponent(productId)}`, { auth: false }),
  getCart: () => apiRequest<CartDto>('/mall/cart'),
  addToCart: (productId: string, quantity = 1) =>
    apiRequest<CartDto>('/mall/cart', { method: 'POST', data: { productId, quantity } }),
  updateCart: (productId: string, quantity: number) =>
    apiRequest<CartDto>(`/mall/cart/${encodeURIComponent(productId)}`, {
      method: 'PATCH',
      data: { quantity },
    }),
  removeCart: (productId: string) =>
    apiRequest<CartDto>(`/mall/cart/${encodeURIComponent(productId)}`, { method: 'DELETE' }),
  clearCart: () => apiRequest<CartDto>('/mall/cart', { method: 'DELETE' }),
  createOrder: (input: OrderCreateInput) =>
    apiRequest<OrderDto>('/mall/orders', { method: 'POST', data: input }),
  listOrders: () => apiRequest<OrderDto[]>('/mall/orders'),
  getOrder: (orderNo: string) =>
    apiRequest<OrderDto>(`/mall/orders/${encodeURIComponent(orderNo)}`),
};
