import type { FastifyRequest } from 'fastify';

/**
 * 设备与网络快照的服务端口径（契约 docs/39 §1 / §6）。
 * - IP 只在服务端产生：取 X-Forwarded-For 首跳，缺失回落直连地址；客户端上报的 ip 一律不采信；
 * - 字符串字段裁剪到 64 字符以内；取不到留空串 / none，不填假值；
 * - 日志脱敏：IPv4 保留前两段、IPv6 保留前两组，设备号只打前 6 位。
 */

export const NETWORK_TYPES = ['wifi', 'cellular', 'ethernet', 'none'] as const;
export type NetworkType = (typeof NETWORK_TYPES)[number];

const OS_NAMES = ['Android', 'iOS', 'Web'] as const;
type OsName = (typeof OS_NAMES)[number];

/** 客户端可上报的设备快照字段（不含 ip / updatedAt，这两个由服务端产生）。 */
export type DeviceContextInput = {
  deviceId: string;
  model?: string;
  osName?: string;
  osVersion?: string;
  networkType?: string;
  carrier?: string;
};

/** 归一化后的快照字段，落库与下发都用这个形状。 */
export type NormalizedDevice = {
  deviceId: string;
  model: string;
  osName: OsName;
  osVersion: string;
  networkType: NetworkType;
  carrier: string;
};

const MAX_FIELD_LEN = 64;

/** 裁剪到 64 字符；空值归一为空串。 */
function trimCell(value: unknown): string {
  if (value == null) return '';
  return String(value).trim().slice(0, MAX_FIELD_LEN);
}

/** 网络类型归一：未知按 none，不在枚举里不编造。 */
function normalizeNetworkType(value: unknown): NetworkType {
  const raw = trimCell(value).toLowerCase();
  return (NETWORK_TYPES as readonly string[]).includes(raw)
    ? (raw as NetworkType)
    : 'none';
}

/** 系统名归一：只认 Android / iOS / Web，其余降级 Web。 */
function normalizeOsName(value: unknown): OsName {
  const raw = trimCell(value);
  return (OS_NAMES as readonly string[]).includes(raw) ? (raw as OsName) : 'Web';
}

/** 把客户端上报的设备字段归一化为服务端内部形状；deviceId 由上层 schema 保证非空。 */
export function normalizeDeviceContext(input: DeviceContextInput): NormalizedDevice {
  return {
    deviceId: trimCell(input.deviceId).slice(0, MAX_FIELD_LEN),
    model: trimCell(input.model),
    osName: normalizeOsName(input.osName),
    osVersion: trimCell(input.osVersion),
    networkType: normalizeNetworkType(input.networkType),
    carrier: trimCell(input.carrier),
  };
}

/** 来源 IP：XFF 首跳优先（Nginx 反代已注入），缺失回落 request.ip；取不到为空串。 */
export function clientIpOf(request: FastifyRequest): string {
  const forward = request.headers['x-forwarded-for'];
  const raw = Array.isArray(forward) ? forward[0] : forward;
  const fromForwarded = raw?.split(',')[0]?.trim();
  return fromForwarded || request.ip || '';
}

/** IPv4 保留前两段：1.2.3.4 → 1.2.*.*；IPv6 保留前两组；无法识别则整串打码。 */
export function maskIp(ip: string): string {
  if (!ip) return '';
  if (ip.includes(':')) {
    const groups = ip.split(':').filter((group) => group !== '');
    const kept = groups.slice(0, 2).join(':');
    return kept ? `${kept}:****` : '****:****';
  }
  const parts = ip.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
  return '*.*.*.*';
}

/** 设备号日志脱敏：只保留前 6 位，其余打码。 */
export function maskDeviceId(deviceId: string): string {
  if (!deviceId) return '';
  return deviceId.length <= 6 ? `${deviceId}****` : `${deviceId.slice(0, 6)}****`;
}
