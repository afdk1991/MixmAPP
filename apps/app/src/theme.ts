/**
 * 主题偏好（H5）：跟随系统 / 浅色 / 深色。
 *
 * 实际换肤全部交给 styles/theme.scss 的 --mx-* 令牌完成，这里只负责在 <html> 上打标：
 *   - 跟随系统（auto）：不写 data-mx-theme，:root 在 @media (prefers-color-scheme: dark) 下取深色值；
 *   - 手动浅色（light）：data-mx-theme="light"，媒体查询里的深色块被 :not([data-mx-theme='light']) 排除；
 *   - 手动深色（dark）：data-mx-theme="dark"，无视系统设置直接命中深色令牌。
 * 首屏防闪白在 index.html 里有一份同步执行的内联版本（同一个 storage key），
 * 本模块负责运行期读写、持久化与订阅。
 */

export type ThemePref = 'auto' | 'light' | 'dark';
export type ThemeMode = 'light' | 'dark';

/** 与 index.html 首屏脚本里的 key 必须保持一致 */
export const THEME_STORAGE_KEY = 'mixmapp:theme';

const ATTR = 'data-mx-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

let pref: ThemePref = 'auto';
const prefListeners = new Set<(next: ThemePref) => void>();

function isPref(value: unknown): value is ThemePref {
  return value === 'auto' || value === 'light' || value === 'dark';
}

/** 当前会话内的偏好（未经持久化读取的默认值为 auto）。 */
export function getThemePref(): ThemePref {
  return pref;
}

/** 从 localStorage 读取偏好；无记录或读取失败一律回落到跟随系统。 */
export function readThemePref(): ThemePref {
  if (typeof window === 'undefined') return 'auto';
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPref(raw) ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

/** 系统当前的深浅色（非 H5 环境按浅色处理）。 */
export function getSystemTheme(): ThemeMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function applyPref(next: ThemePref): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (next === 'auto') root.removeAttribute(ATTR);
  else root.setAttribute(ATTR, next);
}

/** 立即换肤（不刷新页面）+ 持久化，并通知同页订阅者。 */
export function setThemePref(next: ThemePref): void {
  if (!isPref(next)) return;
  pref = next;
  applyPref(next);
  if (typeof window !== 'undefined') {
    try {
      if (next === 'auto') window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* 隐私模式禁写时忽略：本次会话仍然生效，只是不持久化 */
    }
  }
  prefListeners.forEach((fn) => fn(next));
}

export function subscribeThemePref(fn: (next: ThemePref) => void): () => void {
  prefListeners.add(fn);
  return () => {
    prefListeners.delete(fn);
  };
}

/** 订阅系统深浅色变化，用于「跟随系统」下的说明文案。 */
export function subscribeSystemTheme(fn: (next: ThemeMode) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(DARK_QUERY);
  const handler = (event: MediaQueryListEvent) => fn(event.matches ? 'dark' : 'light');
  query.addEventListener('change', handler);
  return () => {
    query.removeEventListener('change', handler);
  };
}

/**
 * 渲染前初始化：index.html 的内联脚本已提前打标，这里兜底同步一次，
 * 并把模块内的内存状态与 localStorage 对齐（供页面 UI 读取）。
 */
export function installTheme(): void {
  pref = readThemePref();
  applyPref(pref);
}
