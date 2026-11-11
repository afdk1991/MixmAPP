import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';

export type MapProvider = {
  readonly name: string;
  reverseGeo(longitude: number, latitude: number): Promise<{
    address: string;
    province: string;
    city: string;
    district: string;
    adcode: string;
  }>;
  route(input: {
    from: { longitude: number; latitude: number };
    to: { longitude: number; latitude: number };
    mode: 'walking' | 'driving' | 'riding';
  }): Promise<{ distanceMeters: number; durationSec: number; steps: string[] }>;
};

export class AmapProvider implements MapProvider {
  readonly name = 'amap';

  constructor(private readonly key: string) {}

  async reverseGeo(lon: number, lat: number) {
    if (!this.key) throw new AppError('PROVIDER_DISABLED', '高德 Key 未配置');
    const url = new URL('https://restapi.amap.com/v3/geocode/regeo');
    url.searchParams.set('key', this.key);
    url.searchParams.set('location', `${lon},${lat}`);
    url.searchParams.set('extensions', 'base');
    const res = await fetch(url);
    const body = (await res.json()) as {
      status: string;
      info?: string;
      regeocode?: {
        formatted_address?: string;
        addressComponent?: {
          province?: string;
          city?: string | string[];
          district?: string;
          adcode?: string;
        };
      };
    };
    if (body.status !== '1' || !body.regeocode) {
      throw new AppError('PROVIDER_ERROR', body.info ?? '高德逆地理失败');
    }
    const comp = body.regeocode.addressComponent ?? {};
    const city = Array.isArray(comp.city) ? '' : (comp.city ?? '');
    return {
      address: body.regeocode.formatted_address ?? '',
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
    if (!this.key) throw new AppError('PROVIDER_DISABLED', '高德 Key 未配置');
    const url = new URL(`https://restapi.amap.com/v3/direction/${input.mode}`);
    url.searchParams.set('key', this.key);
    url.searchParams.set('origin', `${input.from.longitude},${input.from.latitude}`);
    url.searchParams.set('destination', `${input.to.longitude},${input.to.latitude}`);
    const res = await fetch(url);
    const body = (await res.json()) as {
      status: string;
      info?: string;
      route?: {
        paths?: Array<{ distance?: string; duration?: string; steps?: Array<{ instruction?: string }> }>;
      };
    };
    if (body.status !== '1') throw new AppError('PROVIDER_ERROR', body.info ?? '高德路径规划失败');
    const path = body.route?.paths?.[0];
    return {
      distanceMeters: Number(path?.distance ?? 0),
      durationSec: Number(path?.duration ?? 0),
      steps: (path?.steps ?? []).map((s) => s.instruction ?? '').filter(Boolean),
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
    };
  }
}

export function createMapProvider(config: Config): MapProvider {
  return config.map.provider === 'amap' ? new AmapProvider(config.map.amapKey) : new DevMapProvider();
}
