<template>
  <view
    class="mx-bar-wrap"
    :class="{ 'mx-bar-wrap--desktop-only': desktopOnly }"
    :style="{ '--status-h': statusBarHeight + 'px' }"
  >
    <view class="mx-bar" :class="{ 'mx-bar--compact': compact }">
      <view class="mx-bar-inner">
        <view class="mx-bar-row" :class="{ 'mx-bar-row--compact': compact }">
          <view v-if="!hideBack" class="mx-back" hover-class="is-press" @tap="goBack">
            <text class="mx-back-chev">‹</text>
          </view>

          <view class="mx-brand" hover-class="is-press" @tap="goHome">
            <mx-logo size="sm" />
          </view>

          <!-- 移动端右侧留白给小程序胶囊；桌面端换成一级导航（底部 tabBar 在宽屏隐藏） -->
          <view class="mx-side"></view>
          <view class="mx-nav">
            <view
              v-for="item in NAV_ITEMS"
              :key="item.url"
              class="mx-nav-item"
              :class="{ 'mx-nav-item--on': currentRoute === item.route }"
              hover-class="is-press"
              @tap="goTab(item.url)"
            >
              <text class="mx-nav-text">{{ item.label }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>
    <view class="mx-bar-gap"></view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ROUTES } from '../../routes';
import MxLogo from '../mx-logo/mx-logo.vue';

withDefaults(defineProps<{ compact?: boolean; desktopOnly?: boolean; hideBack?: boolean }>(), {
  compact: false,
  desktopOnly: false,
  hideBack: false,
});

/**
 * 全站品牌栏：左返回，中品牌标（点即回首页），右侧留白给小程序胶囊。
 * 桌面端（≥1000px）同一根栏内换成一级导航，移动端仍由底部 tabBar 负责。
 * 用固定高度占位块顶住页面内容，页面本身不需要再补 padding。
 */
const NAV_ITEMS = [
  { label: '首页', route: 'pages/index/index', url: ROUTES.home },
  { label: '商城', route: 'pages/mall/index', url: ROUTES.mall },
  { label: '购物车', route: 'pages/cart/index', url: ROUTES.cart },
  { label: '通行证', route: 'pages/me/index', url: ROUTES.me },
] as const;

/** 当前栈顶路由，用于桌面导航高亮；取不到时不高亮，不抛错。 */
const currentRoute = ref('');
try {
  const stack = getCurrentPages();
  currentRoute.value = stack[stack.length - 1]?.route || '';
} catch {
  currentRoute.value = '';
}

const statusBarHeight = ref(0);
// #ifndef H5
try {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0;
} catch {
  statusBarHeight.value = 0;
}
// #endif

function goHome(): void {
  uni.reLaunch({ url: ROUTES.home });
}

function goBack(): void {
  let depth = 1;
  try {
    depth = getCurrentPages().length;
  } catch {
    depth = 1;
  }
  if (depth > 1) {
    uni.navigateBack({
      delta: 1,
      fail: () => uni.reLaunch({ url: ROUTES.home }),
    });
    return;
  }
  uni.reLaunch({ url: ROUTES.home });
}

/** 桌面一级导航跳转：命中当前页直接返回，避免重复 reLaunch 造成无谓重载。 */
function goTab(url: string): void {
  const route = url.replace(/^\//, '');
  if (route === currentRoute.value) return;
  uni.reLaunch({ url });
}
</script>

<style scoped lang="scss">
.mx-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 900;
  background: $paper;
  border-bottom: 1rpx solid rgba(13, 25, 23, 0.07);
}

.mx-bar-inner {
  width: 100%;
  box-sizing: border-box;
  padding-top: var(--status-h, 0px);
  padding-top: calc(var(--status-h, 0px) + env(safe-area-inset-top));
}

.mx-bar-row {
  height: 44px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  box-sizing: border-box;
}

.mx-back {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mx-back-chev {
  font-family: $font-body;
  font-size: 22px;
  line-height: 1;
  color: $ink-2;
}

.mx-brand {
  flex: 1;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mx-side {
  width: 44px;
  height: 44px;
}

/* 桌面一级导航：移动端不渲染规则（display:none），避免与底部 tabBar 互相顶替 */
.mx-nav {
  display: none;
}

.mx-nav-item {
  height: 32px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  border-radius: $r-control;
}

.mx-nav-item--on {
  background: $ink;
}

.mx-nav-text {
  font-family: $font-body;
  font-size: 14px;
  line-height: 1;
  color: $ink-3;
}

.mx-nav-item--on .mx-nav-text {
  color: $on-solid;
}

.mx-bar-gap {
  width: 100%;
  height: calc(var(--status-h, 0px) + 44px);
  height: calc(var(--status-h, 0px) + 44px + env(safe-area-inset-top));
}

.is-press {
  opacity: 0.6;
}

@media (min-width: 768px) {
  .mx-bar {
    left: 50%;
    right: auto;
    /* 跟随页面版心：大屏双栏页会把 --shell-w 提到 1000px */
    width: var(--shell-w, 750px);
    transform: translateX(-50%);
  }

  .mx-bar--compact {
    width: 520px;
  }

  .mx-bar-row {
    max-width: var(--shell-w, 750px);
    margin: 0 auto;
    padding: 0;
  }

  .mx-bar-row--compact {
    max-width: 520px;
  }
}

/* 桌面：整条栏通栏铺开、版心居中；品牌靠左，右侧换成一级导航 */
@media (min-width: 1000px) {
  .mx-bar {
    left: 0;
    right: 0;
    width: auto;
    transform: none;
  }

  .mx-bar-row {
    padding: 0 4px;
  }

  .mx-brand {
    justify-content: flex-start;
    padding-left: 8px;
  }

  .mx-side {
    display: none;
  }

  .mx-nav {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  /* 认证等紧凑栏不放导航，避免与居中窄卡抢宽度 */
  .mx-bar-row--compact .mx-nav {
    display: none;
  }
}

/* 首页只在桌面出现的品牌栏：移动端完全不占位，保持原有首屏 */
@media (max-width: 999px) {
  .mx-bar-wrap--desktop-only {
    display: none;
  }
}
</style>
