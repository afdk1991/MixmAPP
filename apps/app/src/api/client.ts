import type { AuthResult, UserDto } from '@mixmapp/contracts';

/** 统一 API 基址：H5 走同源 /api/v1（开发态由 vite 代理），原生端用 VITE_MIXMAPP_API_BASE。 */
export const API_BASE: string =
  (import.meta.env.VITE_MIXMAPP_API_BASE as string | undefined) ??
  (import.meta.env.DEV ? 'http://127.0.0.1:8080/api/v1' : '/api/v1');

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
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; data?: unknown; auth?: boolean } = {},
): Promise<T> {
  const execute = async (): Promise<RawResponse> => {
    const tokens = readTokens();
    const headers: Record<string, string> = {};
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
  loginByPassword: (input: { account: string; password: string }) =>
    apiRequest<AuthResult>('/auth/login/password', { method: 'POST', data: input, auth: false }),
  loginBySms: (input: { phone: string; code: string }) =>
    apiRequest<AuthResult>('/auth/login/sms', { method: 'POST', data: input, auth: false }),
  loginByOAuth: (provider: 'wechat' | 'qq' | 'github', code: string) =>
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
