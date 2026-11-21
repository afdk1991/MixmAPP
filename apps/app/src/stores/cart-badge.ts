import { computed, ref } from 'vue';
import { mallApi } from '../api/client';

/**
 * 全局购物车件数与角标状态。
 * 计数权威来源：`GET /mall/cart` 返回的 `totalQuantity`；
 * 加购 / 改量 / 删除 / 清空后页面手里已有最新 CartDto，直接 `syncCartBadge`；
 * 进页面（onShow）或重新进应用时 `refreshCartBadge` 拉一次自恢复，不依赖上一次会话内存。
 */

/** Tab 栏下标（pages.json tabBar 顺序：首页 0 / 商城 1 / 购物车 2 / 我的 3）。 */
const CART_TAB_INDEX = 2;

/** 当前购物车件数（服务端 totalQuantity 口径，含不可结算行）。 */
export const cartCount = ref(0);

/**
 * 角标文案规则：
 * - 0：不显示；
 * - 1–99：显示数字；
 * - ≥100：显示 `99+`。
 */
export const cartBadgeText = computed(() => {
  const n = Math.max(0, Math.round(cartCount.value));
  if (n <= 0) return '';
  return n >= 100 ? '99+' : String(n);
});

/** 把角标同步到原生 Tab 栏；接口在非 tab 页不生效，静默失败不阻断页面。 */
function applyTabBadge(): void {
  const text = cartBadgeText.value;
  if (text) {
    uni.setTabBarBadge({ index: CART_TAB_INDEX, text, fail: () => undefined });
  } else {
    uni.removeTabBarBadge({ index: CART_TAB_INDEX, fail: () => undefined });
  }
}

/** 用最新购物车响应直接同步（加购 / 改量 / 删除 / 清空成功后调用）。 */
export function syncCartBadge(cart: { totalQuantity?: number } | null | undefined): void {
  cartCount.value = Math.max(0, Math.round(cart?.totalQuantity ?? 0));
  applyTabBadge();
}

/**
 * 重新拉取购物车总数并刷新角标。
 * 拉取失败（未登录 / 离线 / 网关异常）时归零隐藏，避免把过期件数留在角标上；
 * 下次进页面 onShow 会再次拉取自恢复。
 */
export async function refreshCartBadge(): Promise<void> {
  try {
    const cart = await mallApi.getCart();
    syncCartBadge(cart);
  } catch {
    cartCount.value = 0;
    applyTabBadge();
  }
}

/** 退出登录 / 清空场景复位角标。 */
export function clearCartBadge(): void {
  cartCount.value = 0;
  applyTabBadge();
}
