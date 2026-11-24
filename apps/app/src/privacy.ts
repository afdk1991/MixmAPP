/**
 * 隐私政策与权限说明的展示时机开关。
 *
 *  - launch：启动即拦截（应用商店常见要求，审核最稳妥）
 *  - register：启动不拦，注册提交前必须勾选同意（当前默认，见 pages/auth/register.vue）
 *  - off：不做门禁，「关于 / 设置」里仍保留常驻入口
 *
 * 若下一版审核要求「首次运行即展示」，把这里改成 'launch' 即可回退，无需改页面。
 */
export type PrivacyGateMode = 'launch' | 'register' | 'off';
export const PRIVACY_GATE_MODE: PrivacyGateMode = 'register';

/**
 * 首启隐私政策与权限说明：同意状态保存在本机，同时随注册请求上报服务端落库审计。
 *
 * 双写两条通道，任一可用即可：
 *  1. WebView localStorage：同步、零延迟，冷启动首选（也是网页端唯一通道）。
 *  2. Capacitor Preferences：原生 SharedPreferences，WebView 存储被系统清理、
 *     进程被杀时写入未落盘等场景的兜底。
 * 记录里带政策版本号；政策实质变更时升级 PRIVACY_POLICY_VERSION，
 * 旧版本的同意记录随即失效。
 */
export const PRIVACY_POLICY_VERSION = '2026-11-24';
export const PRIVACY_CONSENT_KEY = 'mixmapp:privacy-consent';

export type ConsentRecord = {
  /** 同意时的政策版本 */
  version: string;
  /** 同意时间（ISO） */
  at: string;
  /** 写入通道，便于「关于」页与排查时确认兜底是否生效 */
  channel?: 'web' | 'native';
  /** 取得同意的环节，如 register:phone/android */
  source?: string;
};

type NativePreferences = {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
};

/** 兼容 uni storage 的 { type, data } 包装与直接 JSON 两种写法。 */
function parseRecord(raw: unknown): ConsentRecord | null {
  if (raw == null || raw === '') return null;
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || typeof value !== 'object') return null;
    const wrapped = value as { type?: string; data?: unknown };
    const record = wrapped.type && wrapped.data !== undefined ? wrapped.data : value;
    if (!record || typeof record !== 'object') return null;
    const version = (record as { version?: unknown }).version;
    if (typeof version !== 'string') return null;
    const at = (record as { at?: unknown }).at;
    const channel = (record as { channel?: unknown }).channel;
    return {
      version,
      at: typeof at === 'string' ? at : '',
      channel: channel === 'native' ? 'native' : 'web',
      ...(typeof (record as { source?: unknown }).source === 'string'
        ? { source: (record as { source: string }).source }
        : {}),
    };
  } catch {
    return null;
  }
}

function readWeb(): ConsentRecord | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return parseRecord(window.localStorage.getItem(PRIVACY_CONSENT_KEY));
  } catch {
    return null;
  }
}

function writeWeb(record: ConsentRecord): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.setItem(PRIVACY_CONSENT_KEY, JSON.stringify(record));
    return window.localStorage.getItem(PRIVACY_CONSENT_KEY) === JSON.stringify(record);
  } catch {
    return false;
  }
}

function nativePreferences(): NativePreferences | null {
  try {
    const capacitor = (globalThis as { Capacitor?: any }).Capacitor;
    if (!capacitor) return null;
    if (typeof capacitor.isNativePlatform === 'function' && !capacitor.isNativePlatform()) return null;
    const preferences = capacitor.Plugins?.Preferences;
    return preferences && typeof preferences.get === 'function' ? preferences : null;
  } catch {
    return null;
  }
}

async function readNative(): Promise<ConsentRecord | null> {
  const preferences = nativePreferences();
  if (!preferences) return null;
  try {
    const { value } = await preferences.get({ key: PRIVACY_CONSENT_KEY });
    return parseRecord(value);
  } catch {
    return null;
  }
}

async function writeNative(record: ConsentRecord): Promise<boolean> {
  const preferences = nativePreferences();
  if (!preferences) return false;
  try {
    await preferences.set({ key: PRIVACY_CONSENT_KEY, value: JSON.stringify(record) });
    return true;
  } catch {
    return false;
  }
}

/** 同步判定：只读 WebView 存储，用于首帧前快速放行。 */
export function hasPrivacyConsent(): boolean {
  const record = readWeb();
  return !!record && record.version === PRIVACY_POLICY_VERSION;
}

/**
 * 启动判定：先同步查 WebView，未命中再等原生 Preferences（毫秒级）。
 * 原生命中后回填 WebView，下次冷启动即走同步快路径，不再有任何等待。
 */
export async function resolvePrivacyConsent(): Promise<boolean> {
  if (hasPrivacyConsent()) return true;
  const native = await readNative();
  if (native && native.version === PRIVACY_POLICY_VERSION) {
    writeWeb({ ...native, channel: 'web' });
    return true;
  }
  return false;
}

/** 记录同意：先写 WebView（同步），再写原生（异步兜底）。source 标明取得同意的环节。 */
export async function recordPrivacyConsent(source = 'unknown'): Promise<void> {
  const record: ConsentRecord = {
    version: PRIVACY_POLICY_VERSION,
    at: new Date().toISOString(),
    source,
  };
  writeWeb(record);
  const saved = await writeNative(record);
  if (!saved) {
    // 原生通道不可用（网页端 / 插件缺失）时保持 WebView 记录即可
    return;
  }
  // 双写成功后标记 channel，排查时能看出兜底通道是否生效
  writeWeb({ ...record, channel: 'native' });
}

/**
 * 组装随注册请求上报的同意凭证（服务端写进用户记录）。
 * 与本地记录同一份时间与版本，保证两边可对账。
 */
export function buildPrivacyConsent(source: string): {
  version: string;
  acceptedAt: string;
  channel: 'web' | 'native';
  source: string;
} {
  return {
    version: PRIVACY_POLICY_VERSION,
    acceptedAt: new Date().toISOString(),
    channel: nativePreferences() ? 'native' : 'web',
    source,
  };
}

/** 读取当前记录（含旧版本），供「关于」页与排查使用。 */
export function currentPrivacyConsent(): ConsentRecord | null {
  return readWeb();
}
