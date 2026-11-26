import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { createSmsProvider } from '../src/adapters/sms.js';
import { AmapProvider, createMapProvider } from '../src/adapters/map.js';
import { createPushProvider } from '../src/adapters/push.js';

function makeConfig(patch: Partial<Config>): Config {
  return { ...loadConfig(), ...patch };
}

const validAmapKey = '0123456789abcdef0123456789abcdef';

describe('生产环境禁用 dev / console 适配器', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('console 短信在生产环境发送即 503', async () => {
    const sms = createSmsProvider(
      makeConfig({
        env: 'production',
        sms: {
          provider: 'console',
          echoCode: false,
          aliyun: { accessKeyId: '', accessKeySecret: '', signName: 'MixmAPP', templateCode: '' },
        },
      }),
    );
    await expect(sms.send('13800000001', '123456', 'login')).rejects.toMatchObject({
      code: 'PROVIDER_DISABLED',
    });
  });

  it('dev 地图在生产环境拒绝出假坐标', async () => {
    const map = createMapProvider(makeConfig({ env: 'production', map: { provider: 'dev', amapKey: '' } }));
    await expect(map.reverseGeo(120.1, 30.2)).rejects.toMatchObject({ code: 'PROVIDER_DISABLED' });
    await expect(
      map.route({ from: { longitude: 1, latitude: 1 }, to: { longitude: 2, latitude: 2 }, mode: 'walking' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_DISABLED' });
  });

  it('dev 推送在生产环境拒绝返回假成功', async () => {
    const push = createPushProvider(
      makeConfig({
        env: 'production',
        push: { provider: 'dev', jpush: { appKey: '', masterSecret: '' }, fcm: { serviceAccountJson: '', projectId: '' } },
      }),
    );
    await expect(push.push({ tokens: ['t1'], title: 't', body: 'b' })).rejects.toMatchObject({
      code: 'PROVIDER_DISABLED',
    });
  });

  it('开发环境仍保留 console / dev 通道用于本地联调', async () => {
    const sms = createSmsProvider(
      makeConfig({
        env: 'development',
        sms: {
          provider: 'console',
          echoCode: true,
          aliyun: { accessKeyId: '', accessKeySecret: '', signName: 'MixmAPP', templateCode: '' },
        },
      }),
    );
    await expect(sms.send('13800000001', '123456', 'login')).resolves.toBeUndefined();
    expect(sms.name).toBe('console');
  });
});

describe('地图 Key 校验与降级', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Key 格式不合法时直接拒绝，不发请求', async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    const provider = new AmapProvider('bad-key');
    await expect(provider.reverseGeo(120, 30)).rejects.toMatchObject({ code: 'PROVIDER_DISABLED' });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('上游报 Key 失效时给 PROVIDER_DISABLED（可定位到配置）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: '0', info: 'INVALID_USER_KEY' }), { status: 200 })),
    );
    const provider = new AmapProvider(validAmapKey);
    await expect(provider.reverseGeo(120, 30)).rejects.toMatchObject({ code: 'PROVIDER_DISABLED' });
  });

  it('上游不可达时给 PROVIDER_ERROR，提示改用手动填写', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const provider = new AmapProvider(validAmapKey);
    await expect(provider.route({ from: { longitude: 1, latitude: 1 }, to: { longitude: 2, latitude: 2 }, mode: 'driving' })).rejects.toMatchObject(
      { code: 'PROVIDER_ERROR' },
    );
  });

  it('上游缺少路线时返回 degraded 而不是伪造距离', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: '1', route: { paths: [] } }), { status: 200 })),
    );
    const provider = new AmapProvider(validAmapKey);
    const result = await provider.route({
      from: { longitude: 1, latitude: 1 },
      to: { longitude: 2, latitude: 2 },
      mode: 'driving',
    });
    expect(result).toMatchObject({ degraded: true, distanceMeters: 0 });
  });
});
