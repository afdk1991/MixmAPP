import { reactive } from 'vue';
import type { AuthResult, UserDto } from '@mixmapp/contracts';
import { authApi, clearTokens, meApi, readTokens, writeTokens } from '../api/client';

type SessionState = {
  user: UserDto | null;
  ready: boolean;
  accessToken: string | null;
};

export const session = reactive<SessionState>({
  user: null,
  ready: false,
  accessToken: null,
});

export function restore(): void {
  const tokens = readTokens();
  const cached = uni.getStorageSync('mixmapp:user') as UserDto | '';
  if (tokens && cached && cached.id) {
    session.accessToken = tokens.accessToken;
    session.user = cached;
  }
  session.ready = true;
}

export async function applyAuth(result: AuthResult): Promise<void> {
  writeTokens(result.tokens);
  session.accessToken = result.tokens.accessToken;
  session.user = result.user;
  uni.setStorageSync('mixmapp:user', result.user);
}

export async function loginByPassword(account: string, password: string): Promise<AuthResult> {
  const result = await authApi.loginByPassword({ account, password });
  await applyAuth(result);
  return result;
}

export async function loginBySms(phone: string, code: string): Promise<AuthResult> {
  const result = await authApi.loginBySms({ phone, code });
  await applyAuth(result);
  return result;
}

export async function loginByOAuth(
  provider: 'wechat' | 'qq' | 'github' | 'apple',
): Promise<AuthResult> {
  const code = getOAuthCode();
  if (!code) throw new Error('未获取到第三方授权 code：H5 需从授权回跳携带，原生端需先配置 SDK');
  const result = await authApi.loginByOAuth(provider, code);
  await applyAuth(result);
  return result;
}

/** H5 端从授权回跳 URL 取 code；原生端由 SDK 回调注入（当前返回空）。 */
function getOAuthCode(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('code') ?? '';
}

export async function refreshProfile(): Promise<void> {
  const user = await meApi.get();
  session.user = user;
  uni.setStorageSync('mixmapp:user', user);
}

export async function logout(): Promise<void> {
  const tokens = readTokens();
  if (tokens?.refreshToken) {
    try {
      await authApi.logout(tokens.refreshToken);
    } catch {
      // 令牌已失效也要清本地
    }
  }
  clearTokens();
  uni.removeStorageSync('mixmapp:user');
  session.user = null;
  session.accessToken = null;
}

export function isLoggedIn(): boolean {
  return Boolean(session.user && readTokens());
}
