/**
 * 设备与网络快照统一读取（契约 docs/39 §5）。
 *
 * - 同步、纯本地、**不含 ip**：ip 只由服务端在 `/device/context` 响应里下发，前端不得编造；
 * - 读取顺序：原生壳 `MixmShell.getDeviceInfo()` → UA 解析降级 → localStorage 持久 UUID；
 * - 无原生壳环境必须照常返回值；禁止引入 Capacitor 插件。
 */

export type DeviceNetworkType = 'wifi' | 'cellular' | 'ethernet' | 'none';

export type DeviceOsName = 'Android' | 'iOS' | 'Web';

export type DeviceSnapshot = {
  deviceId: string;
  model: string;
  osName: DeviceOsName;
  osVersion: string;
  networkType: DeviceNetworkType;
  carrier: string;
};

const DEVICE_ID_KEY = 'mixmapp:device-id';
const MAX_FIELD_LEN = 64;

type ShellDeviceInfo = {
  deviceId?: unknown;
  model?: unknown;
  osName?: unknown;
  osVersion?: unknown;
  networkType?: unknown;
  carrier?: unknown;
};

interface MixmShellBridge {
  getDeviceInfo?: () => string;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_FIELD_LEN) : '';
}

function normalizeNetworkType(value: unknown): DeviceNetworkType | null {
  if (value === 'wifi' || value === 'cellular' || value === 'ethernet' || value === 'none') return value;
  return null;
}

function normalizeOsName(value: unknown): DeviceOsName | null {
  if (value === 'Android' || value === 'iOS' || value === 'Web') return value;
  return null;
}

/** 读原生桥返回的 JSON 字符串；任何解析异常都按无壳处理，不抛穿到页面。 */
function readShellInfo(): ShellDeviceInfo {
  if (typeof window === 'undefined') return {};
  const shell = (window as unknown as { MixmShell?: MixmShellBridge }).MixmShell;
  const raw = shell?.getDeviceInfo?.();
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as ShellDeviceInfo;
  } catch {
    // 桥返回非法 JSON：忽略该结果，走 UA 降级
  }
  return {};
}

function userAgent(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent : '';
}

/** 清理 UA 里截到的机型片段；泛用词（Build 等）不作为机型展示。 */
function cleanUaToken(raw: string): string {
  const token = raw.trim();
  if (!token || /^build$/i.test(token)) return '';
  return token.slice(0, MAX_FIELD_LEN);
}

/** UA 降级解析：osName 判 Android / iOS / Web，osVersion 取版本号，model 尽力取。 */
function parseUa(ua: string): { osName: DeviceOsName; osVersion: string; model: string } {
  if (/android/i.test(ua)) {
    const version = /Android\s+([0-9]+(?:\.[0-9.]*))/i.exec(ua)?.[1] ?? '';
    const model = /Android\s+[0-9.]+;\s*([^);/]+)/i.exec(ua)?.[1] ?? '';
    return { osName: 'Android', osVersion: version, model: cleanUaToken(model) };
  }
  if (/iphone|ipad|ipod/i.test(ua)) {
    const version =
      /iPhone\s+OS\s+([0-9_]+)/i.exec(ua)?.[1]?.replace(/_/g, '.') ?? '';
    const model = /(iPhone\s*\d*,?\d*|iPad\s*\d*,?\d*)/i.exec(ua)?.[1] ?? '';
    return { osName: 'iOS', osVersion: version, model: cleanUaToken(model) };
  }
  return { osName: 'Web', osVersion: '', model: '' };
}

type ConnectionLike = { type?: string };

/** H5 网络类型：navigator.connection.type 映射到契约枚举；取不到一律 none，不编造。 */
function readNetworkType(): DeviceNetworkType {
  if (typeof navigator === 'undefined') return 'none';
  const connection = (navigator as Navigator & { connection?: ConnectionLike }).connection;
  switch (connection?.type) {
    case 'wifi':
      return 'wifi';
    case 'cellular':
      return 'cellular';
    case 'ethernet':
      return 'ethernet';
    default:
      return 'none';
  }
}

function readStoredDeviceId(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(DEVICE_ID_KEY);
      if (typeof stored === 'string' && stored.trim()) return stored.trim().slice(0, MAX_FIELD_LEN);
    }
  } catch {
    // 隐私模式 / 存储不可用：忽略，继续走 uni 存储兜底
  }
  try {
    const stored = uni.getStorageSync(DEVICE_ID_KEY);
    if (typeof stored === 'string' && stored.trim()) return stored.trim().slice(0, MAX_FIELD_LEN);
  } catch {
    // 无 storage 能力的端直接忽略
  }
  return '';
}

function writeStoredDeviceId(id: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(DEVICE_ID_KEY, id);
      return;
    }
  } catch {
    // 隐私模式禁写：落到 uni 存储兜底
  }
  try {
    uni.setStorageSync(DEVICE_ID_KEY, id);
  } catch {
    // 存储不可用：本次会话仍持有内存值，不阻断
  }
}

/** crypto.randomUUID 不可用时退化为时间戳 + 随机串；同一设备后续以持久化值为准。 */
function generateDeviceId(): string {
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : null;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand}`;
}

/** 读取当前设备与网络快照；任何环节缺失都返回空串 / none，不填假值、不抛错。 */
export function getDeviceSnapshot(): DeviceSnapshot {
  const shell = readShellInfo();
  const ua = parseUa(userAgent());

  const osName = normalizeOsName(shell.osName) ?? ua.osName;
  const osVersion = asString(shell.osVersion) || ua.osVersion;
  const model = asString(shell.model) || ua.model;
  const carrier = asString(shell.carrier);
  const networkType = normalizeNetworkType(shell.networkType) ?? readNetworkType();

  let deviceId = asString(shell.deviceId);
  if (!deviceId) {
    deviceId = readStoredDeviceId() || generateDeviceId();
    writeStoredDeviceId(deviceId);
  }

  return {
    deviceId: deviceId.slice(0, MAX_FIELD_LEN),
    model,
    osName,
    osVersion,
    networkType,
    carrier,
  };
}

/** 网络类型中文标签；未连接 / 未知统一显示「未连接」。 */
export function networkTypeLabel(type: string): string {
  switch (type) {
    case 'wifi':
      return 'Wi-Fi';
    case 'cellular':
      return '移动网络';
    case 'ethernet':
      return '以太网';
    default:
      return '未连接';
  }
}
