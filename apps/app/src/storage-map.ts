/**
 * 本机存储 key → 分类 集中映射表。
 *
 * 规矩：任何页面读写本机存储前，先在这里登记 key 与所属分类，避免 key 散落在各页面；
 * 「本机数据」自助面板（pages/settings/local-data.vue）只读本表，不另维护第二份清单。
 *
 * 通道：
 *  - uni：uni.setStorageSync / getStorageSync（H5 落到 localStorage，原生落到原生存储）
 *  - local：WebView localStorage 直写
 *  - preferences：Capacitor Preferences（原生 SharedPreferences，WebView 存储被清理时的兜底）
 */
import { PRIVACY_CONSENT_KEY } from './privacy';

export type StorageCategoryKey = 'auth' | 'consent' | 'search' | 'browse' | 'cartDraft' | 'other';

export type StorageChannel = 'uni' | 'local' | 'preferences';

export type StorageEntry = {
  /** 存储 key（uni / localStorage / Preferences 同键） */
  key: string;
  category: StorageCategoryKey;
  channels: StorageChannel[];
  /** 面板上展示的条目名 */
  label: string;
};

/** 分类元信息：标题、说明与清理后果，面板按此渲染。 */
export const STORAGE_CATEGORY_META: Record<
  StorageCategoryKey,
  { label: string; description: string; consequence: string }
> = {
  auth: {
    label: '登录态',
    description: '访问令牌、刷新令牌与本机缓存的账号资料。',
    consequence: '清理后需要重新登录；本机保存的会话与账号资料一并清除。',
  },
  consent: {
    label: '隐私同意记录',
    description: '隐私政策版本、同意时间与取得同意的环节。',
    consequence: '清理后，下次注册或相关流程会重新征得同意；旧版本同意记录不再视为有效。',
  },
  search: {
    label: '搜索历史',
    description: '在应用内搜索过的关键词。',
    consequence: '清理后仅移除本机搜索记录，不影响账号与服务端数据。',
  },
  browse: {
    label: '浏览记录',
    description: '浏览过的商品与页面轨迹。',
    consequence: '清理后仅移除本机浏览记录，不影响收藏与订单。',
  },
  cartDraft: {
    label: '购物车草稿',
    description: '本机暂存的购物车条目与未提交草稿。',
    consequence: '清理后需重新挑选商品；服务端购物车不受影响。',
  },
  other: {
    label: '其它本机数据',
    description: '设备标识、主题偏好、一次性跳转参数、上次启动信息与调试基址覆盖。',
    consequence: '清理后部分偏好回到默认；设备标识会在下次启动时重新生成。',
  },
};

/** 分类展示顺序（与规格第 3 节一致）。 */
export const STORAGE_CATEGORY_ORDER: StorageCategoryKey[] = [
  'auth',
  'consent',
  'search',
  'browse',
  'cartDraft',
  'other',
];

/**
 * 已登记的本机存储条目。
 * 搜索历史 / 浏览记录 / 购物车草稿三类当前还没有落本机的 key，先保留分类位，
 * 后续新增本机草稿时在这里补登记即可，面板自动出现对应条目。
 */
export const STORAGE_ENTRIES: StorageEntry[] = [
  { key: 'mixmapp:tokens', category: 'auth', channels: ['uni'], label: '登录凭证（访问 / 刷新令牌）' },
  { key: 'mixmapp:user', category: 'auth', channels: ['uni'], label: '本机缓存的账号资料' },
  { key: 'mixmapp:adminToken', category: 'auth', channels: ['uni'], label: '后台管理令牌' },
  { key: PRIVACY_CONSENT_KEY, category: 'consent', channels: ['local', 'preferences'], label: '隐私同意记录' },
  { key: 'mixmapp:device-id', category: 'other', channels: ['local', 'uni'], label: '设备标识' },
  { key: 'mixmapp:deviceId', category: 'other', channels: ['uni'], label: '游客设备标识' },
  { key: 'mixmapp:theme', category: 'other', channels: ['local'], label: '主题偏好' },
  { key: 'mixmapp:tabQuery', category: 'other', channels: ['uni'], label: '一次性跳转参数' },
  { key: 'mixmapp:lastLaunch', category: 'other', channels: ['uni'], label: '上次启动信息' },
  { key: 'mixmapp:apiBase', category: 'other', channels: ['uni'], label: '调试 API 基址覆盖' },
];

/* ---------- 读取 / 清理辅助 ---------- */

function readUniKeys(): string[] {
  try {
    const info = uni.getStorageInfoSync();
    return Array.isArray(info.keys) ? info.keys : [];
  } catch {
    return [];
  }
}

function readLocalKeys(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  return Object.keys(window.localStorage);
}

type PreferencesBridge = {
  get: (options: { key: string }) => Promise<{ value: string | null }>;
  set: (options: { key: string; value: string }) => Promise<void>;
  remove?: (options: { key: string }) => Promise<void>;
};

function preferencesBridge(): PreferencesBridge | null {
  try {
    const capacitor = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { Preferences?: PreferencesBridge } } }).Capacitor;
    if (!capacitor) return null;
    if (typeof capacitor.isNativePlatform === 'function' && !capacitor.isNativePlatform()) return null;
    const preferences = capacitor.Plugins?.Preferences;
    return preferences && typeof preferences.get === 'function' ? preferences : null;
  } catch {
    return null;
  }
}

/** 按 UTF-8 字节估算：ASCII 1 字节，常见中文 2–3 字节；仅用于面板展示，标明为估算值。 */
export function estimateBytes(raw: unknown): number {
  if (raw == null) return 0;
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (!text) return 0;
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
  }
  return bytes;
}

export type StorageItemStat = {
  entry: StorageEntry;
  channel: StorageChannel;
  exists: boolean;
  bytes: number;
};

function readUniValue(key: string): unknown {
  try {
    return uni.getStorageSync(key);
  } catch {
    return null;
  }
}

function readLocalValue(key: string): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage.getItem(key);
}

/** 扫描全部已登记条目；preferences 通道异步读取，读不到不阻断面板。 */
export async function scanStorage(): Promise<StorageItemStat[]> {
  const uniKeys = new Set(readUniKeys());
  const localKeys = new Set(readLocalKeys());
  const preferences = preferencesBridge();
  const stats: StorageItemStat[] = [];

  for (const entry of STORAGE_ENTRIES) {
    for (const channel of entry.channels) {
      if (channel === 'uni') {
        const exists = uniKeys.has(entry.key);
        stats.push({ entry, channel, exists, bytes: exists ? estimateBytes(readUniValue(entry.key)) : 0 });
      } else if (channel === 'local') {
        const exists = localKeys.has(entry.key);
        stats.push({ entry, channel, exists, bytes: exists ? estimateBytes(readLocalValue(entry.key)) : 0 });
      } else {
        let exists = false;
        let bytes = 0;
        if (preferences) {
          try {
            const { value } = await preferences.get({ key: entry.key });
            exists = typeof value === 'string' && value !== '';
            bytes = exists ? estimateBytes(value) : 0;
          } catch {
            exists = false;
          }
        }
        stats.push({ entry, channel, exists, bytes });
      }
    }
  }
  return stats;
}

function removeUni(key: string): void {
  try {
    uni.removeStorageSync(key);
  } catch {
    /* 存储不可用时忽略 */
  }
}

function removeLocal(key: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* 隐私模式禁写时忽略 */
  }
}

function removePreferences(key: string): void {
  const preferences = preferencesBridge();
  if (!preferences) return;
  try {
    if (typeof preferences.remove === 'function') void preferences.remove({ key });
    else void preferences.set({ key, value: '' });
  } catch {
    /* 原生通道不可用时忽略 */
  }
}

/** 清理单个条目在全部通道上的记录。 */
export function clearEntry(entry: StorageEntry): void {
  for (const channel of entry.channels) {
    if (channel === 'uni') removeUni(entry.key);
    else if (channel === 'local') removeLocal(entry.key);
    else removePreferences(entry.key);
  }
}

/** 清理某个分类下的全部已登记条目。 */
export function clearCategory(category: StorageCategoryKey): void {
  for (const entry of STORAGE_ENTRIES.filter((item) => item.category === category)) {
    clearEntry(entry);
  }
}

/** 占用展示：B / KB / MB，估算口径见 estimateBytes。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
