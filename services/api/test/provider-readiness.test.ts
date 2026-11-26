import { describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { checkProviders, summarizeReadiness } from '../src/lib/provider-check.js';

/** 基于当前环境配置派生测试配置：只覆盖被测字段，避免手写整份 Config。 */
function makeConfig(patch: Partial<Config>): Config {
  return { ...loadConfig(), ...patch };
}

const aliyunSms = {
  accessKeyId: 'ak',
  accessKeySecret: 'sk',
  signName: 'MixmAPP',
  templateCode: 'SMS_0001',
};

describe('第三方服务启动自检', () => {
  it('生产环境使用 console 短信 / dev 地图 / dev 推送时全部报 error', () => {
    const config = makeConfig({ env: 'production' });
    const readiness = checkProviders(config);
    const providers = readiness.errors.map((issue) => issue.provider);
    expect(providers).toContain('sms');
    expect(providers).toContain('map');
    expect(providers).toContain('push');
    expect(readiness.status.sms).toBe('unconfigured');
    expect(readiness.status.map).toBe('unconfigured');
    expect(readiness.status.push).toBe('unconfigured');
    expect(summarizeReadiness(readiness)).toContain('errors=');
  });

  it('阿里云短信缺模板号时给出具体缺失项', () => {
    const config = makeConfig({
      env: 'production',
      sms: {
        provider: 'aliyun',
        echoCode: false,
        aliyun: { ...aliyunSms, templateCode: '' },
      },
    });
    const readiness = checkProviders(config);
    const issue = readiness.errors.find((item) => item.provider === 'sms');
    expect(issue?.missing).toContain('ALIYUN_SMS_TEMPLATE_CODE');
  });

  it('高德 Key 格式不合法时报错（不是启动后等上游拒绝）', () => {
    const config = makeConfig({
      env: 'production',
      map: { provider: 'amap', amapKey: 'not-a-32-hex-key' },
    });
    const readiness = checkProviders(config);
    expect(readiness.errors.some((item) => item.provider === 'map')).toBe(true);
    expect(readiness.status.map).toBe('unconfigured');
  });

  it('极光 / FCM 缺凭据时分别报错', () => {
    const jpush = checkProviders(
      makeConfig({ push: { provider: 'jpush', jpush: { appKey: '', masterSecret: '' }, fcm: { serviceAccountJson: '', projectId: '' } } }),
    );
    expect(jpush.errors.find((item) => item.provider === 'push')?.missing).toContain('JPUSH_APP_KEY');

    const fcm = checkProviders(
      makeConfig({ push: { provider: 'fcm', jpush: { appKey: '', masterSecret: '' }, fcm: { serviceAccountJson: '{bad json', projectId: '' } } }),
    );
    expect(fcm.errors.some((item) => item.provider === 'push')).toBe(true);
  });

  it('支付只配一半时报错，完全未配置时仅提示不阻断', () => {
    const partial = checkProviders(
      makeConfig({
        env: 'production',
        pay: {
          wechat: {
            appId: 'wx-app',
            mchId: 'mch',
            serialNo: '',
            privateKey: '',
            apiV3Key: '',
            platformPublicKey: '',
            notifyUrl: '',
          },
          alipay: { appId: '', privateKey: '', alipayPublicKey: '', notifyUrl: '' },
        },
      }),
    );
    expect(partial.errors.some((item) => item.provider === 'pay')).toBe(true);
    expect(partial.status.pay).toBe('unconfigured');

    const none = checkProviders(makeConfig({ env: 'production' }));
    expect(none.errors.some((item) => item.provider === 'pay')).toBe(false);
    expect(none.warnings.some((item) => item.provider === 'pay')).toBe(true);
    expect(none.status.pay).toBe('disabled');
  });

  it('凭据齐全时对应能力判为 ready', () => {
    const config = makeConfig({
      env: 'production',
      sms: { provider: 'aliyun', echoCode: false, aliyun: aliyunSms },
      map: { provider: 'amap', amapKey: '0123456789abcdef0123456789abcdef' },
      push: { provider: 'jpush', jpush: { appKey: 'k', masterSecret: 's' }, fcm: { serviceAccountJson: '', projectId: '' } },
      pay: {
        wechat: {
          appId: 'wx-app',
          mchId: 'mch',
          serialNo: 'SN',
          privateKey: 'test-merchant-key-placeholder',
          apiV3Key: 'a'.repeat(32),
          platformPublicKey: 'test-platform-key-placeholder',
          notifyUrl: 'https://example.com/notify/wechat',
        },
        alipay: { appId: '', privateKey: '', alipayPublicKey: '', notifyUrl: '' },
      },
    });
    const readiness = checkProviders(config);
    expect(readiness.status.sms).toBe('ready');
    expect(readiness.status.map).toBe('ready');
    expect(readiness.status.push).toBe('ready');
    expect(readiness.status.pay).toBe('ready');
    expect(readiness.errors.filter((item) => item.provider !== 'pay')).toHaveLength(0);
  });
});
