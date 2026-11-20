<template>
  <view
    class="mx-bar-wrap"
    :class="{ 'mx-bar-wrap--desktop-only': desktopOnly }"
  >
    <view class="mx-app-head mx-bar" :class="{ 'mx-bar--compact': compact }">
      <view class="mx-app-head__inner mx-bar-row" :class="{ 'mx-bar-row--compact': compact }">
        <!-- Tab 根页不渲染返回钮：返回交给原生双击退出，避免组件 reLaunch 误清栈 -->
        <view
          v-if="!hideBack && !isTab"
          class="mx-app-head__back"
          hover-class="is-press"
          @tap="goBack"
        >
          <text class="mx-back-chev">‹</text>
        </view>

        <view class="mx-bar-brand" hover-class="is-press" @tap="goHome">
          <mx-logo size="sm" />
          <text v-if="title" class="mx-bar-title">{{ title }}</text>
        </view>

        <!-- 移动端右侧留白；桌面端换成一级导航（底部 tabBar 在宽屏隐藏） -->
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
    <view class="mx-app-head-gap mx-bar-gap"></view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ROUTES } from '../../routes';
import { goTo, isTabRoute } from '../../navigation';
import MxLogo from '../mx-logo/mx-logo.vue';

withDefaults(
  defineProps<{
    compact?: boolean;
    desktopOnly?: boolean;
    hideBack?: boolean;
    /** 二级页标题；不传则只显示品牌标 */
    title?: string;
  }>(),
  {
    compact: false,
    desktopOnly: false,
    hideBack: false,
    title: '',
  },
);

/**
 * 全站品牌栏：左返回，中品牌标（点即回首页），右侧留白给小程序胶囊。
 * 桌面端（≥1000px）同一根栏内换成一级导航，移动端仍由底部 tabBar 负责。
 * 安全区一律读 app-shell 注入的 var(--mx-safe-top)，不再取 statusBarHeight，
 * 也不直接读 env(safe-area-inset-*)（APK 内 WebView 两者都恒为 0）。
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

/** 是否落在 tabBar 根页：根页返回不在这里接管。 */
const isTab = computed(() => isTabRoute(`/${currentRoute.value}`));

function goHome(): void {
  uni.switchTab({ url: ROUTES.home });
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
      fail: () => uni.switchTab({ url: ROUTES.home }),
    });
    return;
  }
  // 一级栈（Tab 根页）：不 reLaunch 清栈，交原生双击退出；H5 兜底回首页 Tab。
  uni.switchTab({ url: ROUTES.home });
}

/** 桌面一级导航跳转：命中当前页直接返回；tab 页走 switchTab，保留 Tab 上下文。 */
function goTab(url: string): void {
  const route = url.replace(/^\//, '');
  if (route === currentRoute.value) return;
  goTo(url);
}
</script>

<style scoped lang="scss">
/* 头部骨架（固定定位 / 安全区占位 / 48px 行高）复用 app-shell 的 .mx-app-head 系列，
 * 这里只排品牌、留白槽与桌面导航。 */
.mx-bar-brand {
  flex: 1;
  min-width: 0;
  height: 44px;
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.mx-bar-title {
  min-width: 0;
  font-family: $font-body;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.2;
  color: $ink;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mx-back-chev {
  font-family: $font-body;
  font-size: 22px;
  line-height: 1;
  color: $ink-2;
}

.mx-side {
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
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

  .mx-bar-brand {
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
