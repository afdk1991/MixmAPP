import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';

export type SmsPurpose = 'register' | 'login' | 'bind' | 'delete';

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

/**
 * 生产环境误选 console 通道时的占位实现：
 * 明确抛 PROVIDER_DISABLED，而不是打一行日志后返回成功（后者会让「收不到验证码」无法被察觉）。
 */
export class DisabledSms implements SmsProvider {
  readonly name = 'disabled';

  constructor(private readonly reason: string) {}

  async send(): Promise<void> {
    throw new AppError('PROVIDER_DISABLED', this.reason);
  }
}

/** 阿里云短信（ dysmsapi RPC 签名，无需 SDK ）。 */
export class AliyunSms implements SmsProvider {
  readonly name = 'aliyun';

  constructor(private readonly config: Config['sms']['aliyun']) {}

  /** 发送前先做一次完整配置核对：缺签名/模板时直接报配置错误，不发半截请求。 */
  private assertConfigured(): void {
    const { accessKeyId, accessKeySecret, signName, templateCode } = this.config;
    const missing = [
      ...(accessKeyId ? [] : ['ALIYUN_SMS_ACCESS_KEY_ID']),
      ...(accessKeySecret ? [] : ['ALIYUN_SMS_ACCESS_KEY_SECRET']),
      ...(signName ? [] : ['ALIYUN_SMS_SIGN_NAME']),
      ...(templateCode ? [] : ['ALIYUN_SMS_TEMPLATE_CODE']),
    ];
    if (missing.length) {
      throw new AppError(
        'PROVIDER_DISABLED',
        `阿里云短信未配置完整：缺少 ${missing.join('、')}，验证码不会下发`,
      );
    }
  }

  async send(phone: string, code: string, purpose: SmsPurpose): Promise<void> {
    this.assertConfigured();
    const { accessKeyId, accessKeySecret, signName, templateCode } = this.config;
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
      // 模板变量必须与阿里云控制台审核通过的模板一一对应；本模板只含 ${code}，
      // 多传 purpose 在严格模板下会被判参数不匹配，故只传 code。
      TemplateParam: JSON.stringify({ code }),
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

    // 5 秒超时：短信网关卡住时不能把登录请求一起拖死。
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5_000) }).catch(() => {
      throw new AppError('PROVIDER_ERROR', '短信网关不可达，请稍后重试');
    });
    const body = (await res.json().catch(() => ({}))) as { Code?: string; Message?: string };
    if (!res.ok || body.Code !== 'OK') {
      // 错误信息只回传阿里云给的 Code/Message，不含 AK/SK 与验证码本体。
      throw new AppError(
        'PROVIDER_ERROR',
        `短信发送失败：${body.Code ?? `HTTP ${res.status}`}${body.Message ? ` ${body.Message}` : ''}`,
      );
    }
  }
}

export function createSmsProvider(config: Config): SmsProvider {
  if (config.sms.provider === 'aliyun') return new AliyunSms(config.sms.aliyun);
  if (config.env === 'production') {
    return new DisabledSms(
      '生产环境禁止 console 短信通道：请配置 SMS_PROVIDER=aliyun 及阿里云短信凭据后重启',
    );
  }
  return new ConsoleSms();
}
