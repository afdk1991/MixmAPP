import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';

export type SmsPurpose = 'register' | 'login' | 'bind';

export type SmsProvider = {
  readonly name: string;
  send(phone: string, code: string, purpose: SmsPurpose): Promise<void>;
};

const maskPhone = (phone: string): string => `${phone.slice(0, 3)}****${phone.slice(7)}`;

function percentEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

/** 开发态：验证码直接打到服务端日志，便于本地联调与自动化测试。 */
export class ConsoleSms implements SmsProvider {
  readonly name = 'console';

  async send(phone: string, code: string, purpose: SmsPurpose): Promise<void> {
    console.info(`[sms:console] ${maskPhone(phone)} purpose=${purpose} code=${code}`);
  }
}

/** 阿里云短信（ dysmsapi RPC 签名，无需 SDK ）。 */
export class AliyunSms implements SmsProvider {
  readonly name = 'aliyun';

  constructor(private readonly config: Config['sms']['aliyun']) {}

  async send(phone: string, code: string, purpose: SmsPurpose): Promise<void> {
    const { accessKeyId, accessKeySecret, signName, templateCode } = this.config;
    if (!accessKeyId || !accessKeySecret || !templateCode) {
      throw new AppError('PROVIDER_DISABLED', '阿里云短信未配置完整（AK/SK/模板号）');
    }
    const params: Record<string, string> = {
      AccessKeyId: accessKeyId,
      Action: 'SendSms',
      Format: 'JSON',
      PhoneNumbers: phone,
      RegionId: 'cn-hangzhou',
      SignName: signName,
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      SignatureVersion: '1.0',
      TemplateCode: templateCode,
      TemplateParam: JSON.stringify({ code, purpose }),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      Version: '2017-05-25',
    };
    const canonical = Object.keys(params)
      .sort()
      .map((k) => `${percentEncode(k)}=${percentEncode(params[k] as string)}`)
      .join('&');
    const stringToSign = `GET&%2F&${percentEncode(canonical)}`;
    const { createHmac } = await import('node:crypto');
    const signature = createHmac('sha1', `${accessKeySecret}&`)
      .update(stringToSign)
      .digest('base64');
    const url = `https://dysmsapi.aliyuncs.com/?Signature=${percentEncode(signature)}&${canonical}`;

    const res = await fetch(url, { method: 'GET' });
    const body = (await res.json()) as { Code?: string; Message?: string };
    if (body.Code !== 'OK') {
      throw new AppError('PROVIDER_ERROR', `短信发送失败：${body.Message ?? 'unknown'}`);
    }
  }
}

export function createSmsProvider(config: Config): SmsProvider {
  return config.sms.provider === 'aliyun'
    ? new AliyunSms(config.sms.aliyun)
    : new ConsoleSms();
}
