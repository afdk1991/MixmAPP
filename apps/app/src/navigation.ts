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

/**
 * 统一页面跳转：目标是 tabBar 页且不带查询参数时用 switchTab，其余用 navigateTo。
 * 带查询参数时一律走 navigateTo（避免 switchTab 丢参数；tabBar 页本身不接受带参跳转）。
 */
export function goTo(url: string): void {
  const path = url.split('?')[0] ?? url;
  if (TAB_PATHS.has(path) && path === url) {
    uni.switchTab({ url: path });
    return;
  }
  uni.navigateTo({ url });
}
