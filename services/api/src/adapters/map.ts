import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { AMAP_KEY_PATTERN } from '../lib/provider-check.js';

export type MapResultMeta = {
  /** 是否为降级结果：true 表示未拿到真实上游数据，调用方应改用手动填写 */
  degraded?: boolean;
  /** 降级/失败原因（给前端展示或日志用，不含密钥） */
  reason?: string;
};

export type MapProvider = {
  readonly name: string;
  reverseGeo(longitude: number, latitude: number): Promise<{
    address: string;
    province: string;
    city: string;
    district: string;
    adcode: string;
  } & MapResultMeta>;
  route(input: {
    from: { longitude: number; latitude: number };
    to: { longitude: number; latitude: number };
    mode: 'walking' | 'driving' | 'riding';
  }): Promise<{ distanceMeters: number; durationSec: number; steps: string[] } & MapResultMeta>;
};

/** 高德返回的「Key 本身不可用」错误码：这类错误重试无意义，直接告诉调用方去修配置。 */
const AMAP_KEY_ERRORS = new Set([
  'INVALID_USER_KEY',
  'USERKEY_PLAT_NOMATCH',
  'INVALID_USER_SCODE',
  'SERVICE_NOT_AVAILABLE',
]);

/** 逆地理/路径规划共用的请求封装：统一超时、统一错误分类，避免每个方法各写一份。 */
async function amapGet(
  key: string,
  url: URL,
  failureMessage: string,
): Promise<{ status: string; info?: string; body: Record<string, unknown> }> {
  // Key 缺失或格式错误时不发请求：高德必然拒绝，而且会把错误暴露成 502。
  if (!key) throw new AppError('PROVIDER_DISABLED', '高德 Key 未配置');
  if (!AMAP_KEY_PATTERN.test(key)) {
    throw new AppError('PROVIDER_DISABLED', '高德 Key 格式不正确（应为 32 位十六进制），请检查 AMAP_KEY');
  }
  url.searchParams.set('key', key);
  let res: Response;
  try {
    // 4 秒超时：地图是辅助能力，不能拖住结算/地址页面。
    res = await fetch(url, { signal: AbortSignal.timeout(4_000) });
  } catch {
    throw new AppError('PROVIDER_ERROR', `${failureMessage}：地图服务不可达，请改用手动填写地址`);
  }
  if (!res.ok) {
    throw new AppError('PROVIDER_ERROR', `${failureMessage}：地图服务返回 HTTP ${res.status}`);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    status?: string;
    info?: string;
  };
  if (body.status !== '1') {
    const info = String(body.info ?? '');
    // Key 失效与「服务暂时不可用」分开：前者要改配置，后者值得重试。
    if (AMAP_KEY_ERRORS.has(info)) {
      throw new AppError('PROVIDER_DISABLED', `高德 Key 不可用（${info}），请检查 AMAP_KEY 与配额`);
    }
    throw new AppError('PROVIDER_ERROR', `${failureMessage}：${info || '上游返回异常'}`);
  }
  return { status: body.status, info: body.info, body };
}

export class AmapProvider implements MapProvider {
  readonly name = 'amap';

  constructor(private readonly key: string) {}

  async reverseGeo(lon: number, lat: number) {
    const url = new URL('https://restapi.amap.com/v3/geocode/regeo');
    url.searchParams.set('location', `${lon},${lat}`);
    url.searchParams.set('extensions', 'base');
    const { body } = await amapGet(this.key, url, '高德逆地理失败');
    const regeocode = body['regeocode'] as
      | {
          formatted_address?: string;
          addressComponent?: {
            province?: string;
            city?: string | string[];
            district?: string;
            adcode?: string;
          };
        }
      | undefined;
    if (!regeocode) {
      // 高德理论上 status=1 就有 regeocode；真缺了按降级处理，不返回编造地址。
      return {
        address: '',
        province: '',
        city: '',
        district: '',
        adcode: '',
        degraded: true,
        reason: '上游未返回地址信息',
      };
    }
    const comp = regeocode.addressComponent ?? {};
    const city = Array.isArray(comp.city) ? '' : (comp.city ?? '');
    return {
      address: regeocode.formatted_address ?? '',
      province: comp.province ?? '',
      city,
      district: comp.district ?? '',
      adcode: comp.adcode ?? '',
    };
  }

  async route(input: {
    from: { longitude: number; latitude: number };
    to: { longitude: number; latitude: number };
    mode: 'walking' | 'driving' | 'riding';
  }) {
    const url = new URL(`https://restapi.amap.com/v3/direction/${input.mode}`);
    url.searchParams.set('origin', `${input.from.longitude},${input.from.latitude}`);
    url.searchParams.set('destination', `${input.to.longitude},${input.to.latitude}`);
    const { body } = await amapGet(this.key, url, '高德路径规划失败');
    const route = body['route'] as
      | {
          paths?: Array<{
            distance?: string;
            duration?: string;
            steps?: Array<{ instruction?: string }>;
          }>;
        }
      | undefined;
    const path = route?.paths?.[0];
    if (!path) {
      return {
        distanceMeters: 0,
        durationSec: 0,
        steps: [],
        degraded: true,
        reason: '上游未返回可用路线',
      };
    }
    return {
      distanceMeters: Number(path.distance ?? 0),
      durationSec: Number(path.duration ?? 0),
      steps: (path.steps ?? []).map((s) => s.instruction ?? '').filter(Boolean),
    };
  }
}

/** 开发态：不访问外网，返回可辨识的占位结果，方便前端联调。 */
export class DevMapProvider implements MapProvider {
  readonly name = 'dev';

  async reverseGeo(longitude: number, latitude: number) {
    return {
      address: `开发态坐标 ${longitude.toFixed(6)}, ${latitude.toFixed(6)}`,
      province: '',
      city: '',
      district: '',
      adcode: '',
      degraded: true,
      reason: '开发态地图未接入高德 Key',
    };
  }

  async route(input: {
    from: { longitude: number; latitude: number };
    to: { longitude: number; latitude: number };
    mode: 'walking' | 'driving' | 'riding';
  }) {
    const dLon = input.to.longitude - input.from.longitude;
    const dLat = input.to.latitude - input.from.latitude;
    const distanceMeters = Math.round(Math.sqrt(dLon * dLon + dLat * dLat) * 111_000);
    const speed = input.mode === 'driving' ? 40 : input.mode === 'riding' ? 12 : 5;
    return {
      distanceMeters,
      durationSec: Math.round((distanceMeters / 1000 / speed) * 3600),
      steps: ['开发态路径规划：未接入高德 Key'],
      degraded: true,
      reason: '开发态地图未接入高德 Key，距离与时长为估算值',
    };
  }
}

/** 生产环境误选 dev 地图时的占位实现：拒绝出假数据。 */
export class DisabledMapProvider implements MapProvider {
  readonly name = 'disabled';

  private fail(): never {
    throw new AppError(
      'PROVIDER_DISABLED',
      '地图服务未配置：请设置 MAP_PROVIDER=amap 与 AMAP_KEY，或由前端改用手动填写地址',
    );
  }

  async reverseGeo(): Promise<never> {
    return this.fail();
  }

  async route(): Promise<never> {
    return this.fail();
  }
}

export function createMapProvider(config: Config): MapProvider {
  if (config.map.provider === 'amap') return new AmapProvider(config.map.amapKey);
  if (config.env === 'production') return new DisabledMapProvider();
  return new DevMapProvider();
}
