import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { createPrivateKey, sign as cryptoSign } from 'node:crypto';

export type PushProvider = {
  readonly name: string;
  push(input: {
    tokens: string[];
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<{ accepted: number }>;
};

/** 极光推送（REST v3，Basic 认证）。 */
export class JPushProvider implements PushProvider {
  readonly name = 'jpush';

  constructor(private readonly config: Config['push']['jpush']) {}

  async push(input: {
    tokens: string[];
    title: string;
    body: string;
    data?: Record<string, string>;
  }) {
    const { appKey, masterSecret } = this.config;
    if (!appKey || !masterSecret) throw new AppError('PROVIDER_DISABLED', '极光推送未配置');
    if (!input.tokens.length) return { accepted: 0 };
    const res = await fetch('https://api.jpush.cn/v3/push', {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${appKey}:${masterSecret}`).toString('base64')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        platform: 'all',
        audience: { registration_id: input.tokens },
        notification: {
          android: { alert: input.body, title: input.title, extras: input.data ?? {} },
          ios: { alert: input.body, sound: 'default', extras: input.data ?? {} },
        },
      }),
    });
    const payload = (await res.json()) as { sendno?: string; error?: { message?: string } };
    if (!res.ok) throw new AppError('PROVIDER_ERROR', payload.error?.message ?? '极光推送失败');
    return { accepted: input.tokens.length };
  }
}

/** Firebase Cloud Messaging HTTP v1（服务账号 JWT 换 token 后发送）。 */
export class FcmProvider implements PushProvider {
  readonly name = 'fcm';

  constructor(private readonly config: Config['push']['fcm']) {}

  async push(input: {
    tokens: string[];
    title: string;
    body: string;
    data?: Record<string, string>;
  }) {
    if (!this.config.serviceAccountJson) throw new AppError('PROVIDER_DISABLED', 'FCM 未配置');
    const account = JSON.parse(this.config.serviceAccountJson) as {
      client_email: string;
      private_key: string;
      token_uri?: string;
      project_id?: string;
    };
    const projectId = this.config.projectId || account.project_id || '';
    const accessToken = await this.accessToken(account);
    let accepted = 0;
    for (const token of input.tokens) {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: input.title, body: input.body },
            data: input.data ?? {},
          },
        }),
      });
      if (res.ok) accepted += 1;
    }
    return { accepted };
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
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    const body = (await res.json()) as { access_token?: string; error_description?: string };
    if (!body.access_token) throw new AppError('PROVIDER_ERROR', body.error_description ?? 'FCM 取 token 失败');
    return body.access_token;
  }
}

export class DevPush implements PushProvider {
  readonly name = 'dev';

  async push(input: { tokens: string[]; title: string; body: string }) {
    console.info(`[push:dev] ${input.tokens.length} 台设备：${input.title}`);
    return { accepted: input.tokens.length };
  }
}

export function createPushProvider(config: Config): PushProvider {
  if (config.push.provider === 'jpush') return new JPushProvider(config.push.jpush);
  if (config.push.provider === 'fcm') return new FcmProvider(config.push.fcm);
  return new DevPush();
}
