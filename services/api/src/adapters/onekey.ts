import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';

export type OneKeyProvider = {
  readonly name: 'dev' | 'http';
  readonly enabled: boolean;
  /** 把端侧 SDK 下发的 token 换成手机号 */
  resolvePhone(token: string): Promise<string>;
};

const PHONE_RE = /^1[3-9]\d{9}$/;

/**
 * 开发态：token 形如 `dev:13800001234`，仅非生产环境可用，
 * 让本地与自动化测试不接运营商也能跑通整条一键登录链路。
 */
export class DevOneKeyProvider implements OneKeyProvider {
  readonly name = 'dev' as const;

  constructor(private readonly env: Config['env']) {}

  get enabled(): boolean {
    return this.env !== 'production';
  }

  async resolvePhone(token: string): Promise<string> {
    if (!this.enabled) {
      throw new AppError('PROVIDER_DISABLED', '生产环境不允许使用开发态一键登录');
    }
    const phone = token.startsWith('dev:') ? token.slice(4).trim() : '';
    if (!PHONE_RE.test(phone)) throw new AppError('CODE_INVALID', '一键登录凭证无效');
    return phone;
  }
}

/**
 * 生产态：把 token 交给运营商/本机号码认证网关换成手机号。
 * 网关只需返回 `{ "phone": "13800001234" }`，其余鉴权字段按网关约定传。
 */
export class HttpOneKeyProvider implements OneKeyProvider {
  readonly name = 'http' as const;

  constructor(private readonly config: Config['onekey']) {}

  get enabled(): boolean {
    return Boolean(this.config.endpoint);
  }

  async resolvePhone(token: string): Promise<string> {
    if (!this.enabled) throw new AppError('PROVIDER_DISABLED', '一键登录网关未配置');
    let res: Response;
    try {
      res = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.appId ? { 'x-app-id': this.config.appId } : {}),
          ...(this.config.appSecret ? { 'x-app-secret': this.config.appSecret } : {}),
        },
        body: JSON.stringify({ token }),
      });
    } catch {
      throw new AppError('PROVIDER_ERROR', '一键登录网关不可达');
    }
    if (!res.ok) throw new AppError('PROVIDER_ERROR', `一键登录网关返回 ${res.status}`);
    const body = (await res.json().catch(() => null)) as
      | { phone?: string; message?: string }
      | null;
    const phone = body?.phone ?? '';
    if (!PHONE_RE.test(phone)) {
      throw new AppError('CODE_INVALID', body?.message ?? '一键登录凭证无效');
    }
    return phone;
  }
}

export function createOneKeyProvider(config: Config): OneKeyProvider {
  return config.onekey.provider === 'http'
    ? new HttpOneKeyProvider(config.onekey)
    : new DevOneKeyProvider(config.env);
}
