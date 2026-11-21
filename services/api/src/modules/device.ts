import type { Store, UserDeviceRecord } from '../db/types.js';
import {
  normalizeDeviceContext,
  type DeviceContextInput,
  type NormalizedDevice,
} from '../lib/device-context.js';

/** 对外下发的快照形状（camelCase；ip 与 updatedAt 由服务端产生）。 */
export type DeviceSnapshotDto = {
  deviceId: string;
  model: string;
  osName: string;
  osVersion: string;
  ip: string;
  networkType: string;
  carrier: string;
  updatedAt: string;
};

/**
 * 设备与网络快照服务（契约 docs/39 §3.2）。
 * 只做：归一化 → upsert user_devices → 回读快照；不触碰登录令牌本体。
 */
export class DeviceContextService {
  constructor(private readonly store: Store) {}

  /** 上报 / 刷新当前快照：服务端补 IP 与采集时间，覆盖该用户该设备的最近一条。 */
  async record(userId: string, input: DeviceContextInput, ip: string): Promise<UserDeviceRecord> {
    const normalized = normalizeDeviceContext(input);
    const record: UserDeviceRecord = {
      userId,
      deviceId: normalized.deviceId,
      deviceModel: normalized.model,
      osName: normalized.osName,
      osVersion: normalized.osVersion,
      networkType: normalized.networkType,
      carrier: normalized.carrier,
      clientIp: ip,
      updatedAt: new Date(),
    };
    await this.store.userDevices.upsert(record);
    return record;
  }

  /** 只读查询：指定 deviceId 取该设备；省略取最近一条；无记录返回 null（不报 404）。 */
  async latest(userId: string, deviceId?: string): Promise<UserDeviceRecord | null> {
    const wanted = deviceId?.trim();
    if (wanted) return this.store.userDevices.find(userId, wanted);
    return this.store.userDevices.latest(userId);
  }

  /** 落库记录 → 对外 DTO；ip 取自快照本体，不采信客户端。 */
  toDto(record: UserDeviceRecord): DeviceSnapshotDto {
    return {
      deviceId: record.deviceId,
      model: record.deviceModel,
      osName: record.osName,
      osVersion: record.osVersion,
      ip: record.clientIp,
      networkType: record.networkType,
      carrier: record.carrier,
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  /** 归一化透传（登录三路写令牌行时复用，避免第二套口径）。 */
  normalize(input: DeviceContextInput): NormalizedDevice {
    return normalizeDeviceContext(input);
  }
}
