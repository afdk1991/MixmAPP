import { ROUTES } from './routes';

/**
 * pages.json 里 tabBar 注册的页面路径。
 * uni-app 规定：跳 tabBar 页只能用 switchTab，navigateTo / redirectTo 都不可跳，
 * 且 switchTab 不能带查询参数。把这层差异收敛在这里，页面仍只引用 ROUTES 常量。
 */
const TAB_PATHS: ReadonlySet<string> = new Set<string>([
  ROUTES.home,
  ROUTES.mall,
  ROUTES.cart,
  ROUTES.me,
]);

/** 判断路径是否为 tabBar 根页（供头部组件收敛返回行为：根页返回交给原生双击退出）。 */
export function isTabRoute(path: string): boolean {
  return TAB_PATHS.has(path);
}

/**
 * tab 页不接受 URL 查询参数（switchTab 会丢弃），这里用一次性本地缓存做临时通道：
 * 跳转前把 query 按目标路径存起来，目标页 onShow 读取后立即清除。
 * 避免对 tab 页误用 navigateTo 造成返回栈错乱、无法回到首页。
 */
const TAB_QUERY_KEY = 'mixmapp:tabQuery';

function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!qs) return out;
  for (const pair of qs.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = eq === -1 ? pair : pair.slice(0, eq);
    const v = eq === -1 ? '' : pair.slice(eq + 1);
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return out;
}

function readTabQueryBag(): Record<string, Record<string, string>> {
  try {
    const raw = uni.getStorageSync(TAB_QUERY_KEY);
    return raw && typeof raw === 'object' ? (raw as Record<string, Record<string, string>>) : {};
  } catch {
    return {};
  }
}

/** 目标页 onShow 调用：取出并清除该路径的一次性 query，没有则返回空对象。 */
export function consumeTabQuery(path: string): Record<string, string> {
  const bag = readTabQueryBag();
  const q = bag[path] ?? {};
  if (bag[path]) {
    delete bag[path];
    try {
      uni.setStorageSync(TAB_QUERY_KEY, bag);
    } catch {
      /* 存储不可用时静默，不阻断跳转 */
    }
  }
  return q;
}

/**
 * 统一页面跳转：
 * - 目标是 tabBar 页：无论是否带参都走 switchTab（带参先经临时通道转交），
 *   绝不 navigateTo 到 tab 页；
 * - 其余页面走 navigateTo，查询参数原样保留。
 */
export function goTo(url: string): void {
  const qIndex = url.indexOf('?');
  const path = qIndex === -1 ? url : url.slice(0, qIndex);
  const qs = qIndex === -1 ? '' : url.slice(qIndex + 1);

  if (TAB_PATHS.has(path)) {
    if (qs) {
      const params = parseQuery(qs);
      const bag = readTabQueryBag();
      bag[path] = params;
      try {
        uni.setStorageSync(TAB_QUERY_KEY, bag);
      } catch {
        /* 存储不可用时静默 */
      }
    }
    uni.switchTab({ url: path });
    return;
  }
  uni.navigateTo({ url });
}
