import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { createPrivateKey, sign as cryptoSign } from 'node:crypto';

export type PushInput = {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
};

export type PushResult = {
  /** 上游确认接收的设备数 */
  accepted: number;
  /** 明确失败的设备数（不含 invalidTokens，后者已单独列出） */
  failed: number;
  /** 上游判定失效、应当从库里清理的 token */
  invalidTokens: string[];
};

export type PushProvider = {
  readonly name: string;
  push(input: PushInput): Promise<PushResult>;
};

const EMPTY_RESULT: PushResult = { accepted: 0, failed: 0, invalidTokens: [] };

/** FCM 判定「这个 token 已经没有用了」的错误码，出现即应清理。 */
const FCM_INVALID_TOKEN_CODES = new Set([
  'UNREGISTERED',
  'INVALID_ARGUMENT',
  'SENDER_ID_MISMATCH',
  'NOT_FOUND',
]);

/** 极光推送（REST v3，Basic 认证）。 */
export class JPushProvider implements PushProvider {
  readonly name = 'jpush';

  constructor(private readonly config: Config['push']['jpush']) {}

  async push(input: PushInput): Promise<PushResult> {
    const { appKey, masterSecret } = this.config;
    if (!appKey || !masterSecret) throw new AppError('PROVIDER_DISABLED', '极光推送未配置');
    if (!input.tokens.length) return { ...EMPTY_RESULT };
    const res = await fetch('https://api.jpush.cn/v3/push', {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${appKey}:${masterSecret}`).toString('base64')}`,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({
        platform: 'all',
        audience: { registration_id: input.tokens },
        notification: {
          android: { alert: input.body, title: input.title, extras: input.data ?? {} },
          ios: { alert: input.body, sound: 'default', extras: input.data ?? {} },
        },
        options: { apns_production: process.env['NODE_ENV'] === 'production' },
      }),
    }).catch(() => {
      throw new AppError('PROVIDER_ERROR', '极光推送不可达，请稍后重试');
    });
    const payload = (await res.json().catch(() => ({}))) as {
      sendno?: string;
      error?: { code?: number; message?: string };
    };
    if (!res.ok) {
      // 1011 = 找不到该 audience（通常是 registration_id 全部失效），这类 token 应清理；
      // 其余错误（鉴权失败、参数错误）属于配置问题，直接抛出让调用方看到真实原因。
      if (payload.error?.code === 1011) {
        return { accepted: 0, failed: 0, invalidTokens: [...input.tokens] };
      }
      throw new AppError(
        'PROVIDER_ERROR',
        `极光推送失败：${payload.error?.message ?? `HTTP ${res.status}`}`,
      );
    }
    // 极光 v3 成功响应不逐条回执，无法区分单设备失败；按整批已受理计。
    return { accepted: input.tokens.length, failed: 0, invalidTokens: [] };
  }
}

/** Firebase Cloud Messaging HTTP v1（服务账号 JWT 换 token 后发送）。 */
export class FcmProvider implements PushProvider {
  readonly name = 'fcm';

  constructor(private readonly config: Config['push']['fcm']) {}

  async push(input: PushInput): Promise<PushResult> {
    if (!this.config.serviceAccountJson) throw new AppError('PROVIDER_DISABLED', 'FCM 未配置');
    if (!input.tokens.length) return { ...EMPTY_RESULT };
    const account = JSON.parse(this.config.serviceAccountJson) as {
      client_email: string;
      private_key: string;
      token_uri?: string;
      project_id?: string;
    };
    const projectId = this.config.projectId || account.project_id || '';
    if (!projectId) throw new AppError('PROVIDER_DISABLED', 'FCM 缺少项目号');
    const accessToken = await this.accessToken(account);
    const result: PushResult = { accepted: 0, failed: 0, invalidTokens: [] };
    // 逐条发送：单设备失败不能拖垮整批，失效 token 收集后由 PushService 清理。
    for (const token of input.tokens) {
      try {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
          method: 'POST',
          headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
          signal: AbortSignal.timeout(8_000),
          body: JSON.stringify({
            message: {
              token,
              notification: { title: input.title, body: input.body },
              data: input.data ?? {},
            },
          }),
        });
        if (res.ok) {
          result.accepted += 1;
          continue;
        }
        const error = (await res.json().catch(() => ({}))) as {
          error?: {
            status?: string;
            message?: string;
            details?: Array<{ errorCode?: string }>;
          };
        };
        const codes = new Set([
          ...(error.error?.details ?? []).map((detail) => detail.errorCode ?? ''),
          error.error?.status ?? '',
        ]);
        if ([...codes].some((code) => FCM_INVALID_TOKEN_CODES.has(code))) {
          result.invalidTokens.push(token);
        } else {
          result.failed += 1;
        }
      } catch {
        // 网络异常只记失败，保留 token 供下次重试。
        result.failed += 1;
      }
    }
    return result;
  }

  private async accessToken(account: {
    client_email: string;
    private_key: string;
    token_uri?: string;
  }): Promise<string> {
    const tokenUri = account.token_uri ?? 'https://oauth2.googleapis.com/token';
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: account.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: tokenUri,
        iat: now,
        exp: now + 3600,
      }),
    ).toString('base64url');
    const message = `${header}.${payload}`;
    const signature = cryptoSign('RSA-SHA256', Buffer.from(message), createPrivateKey(account.private_key)).toString('base64url');
    const assertion = `${message}.${signature}`;

    const res = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(8_000),
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    }).catch(() => {
      throw new AppError('PROVIDER_ERROR', 'FCM 鉴权服务不可达，请稍后重试');
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      error_description?: string;
    };
    if (!body.access_token) {
      throw new AppError('PROVIDER_ERROR', body.error_description ?? 'FCM 取 token 失败');
    }
    return body.access_token;
  }
}

export class DevPush implements PushProvider {
  readonly name = 'dev';

  async push(input: PushInput): Promise<PushResult> {
    console.info(`[push:dev] ${input.tokens.length} 台设备：${input.title}`);
    return { accepted: input.tokens.length, failed: 0, invalidTokens: [] };
  }
}

/** 生产环境误选 dev 推送时的占位实现：明确失败，不返回虚假的 accepted。 */
export class DisabledPush implements PushProvider {
  readonly name = 'disabled';

  async push(): Promise<PushResult> {
    throw new AppError(
      'PROVIDER_DISABLED',
      '推送服务未配置：请设置 PUSH_PROVIDER=jpush 或 fcm 并补齐凭据',
    );
  }
}

export function createPushProvider(config: Config): PushProvider {
  if (config.push.provider === 'jpush') return new JPushProvider(config.push.jpush);
  if (config.push.provider === 'fcm') return new FcmProvider(config.push.fcm);
  if (config.env === 'production') return new DisabledPush();
  return new DevPush();
}
