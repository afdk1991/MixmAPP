<template>
  <view class="mx-bar-wrap">
    <view class="mx-bar" :class="{ 'mx-bar--compact': compact }">
      <view class="mx-bar-inner" :style="{ paddingTop: statusBarHeight + 'px' }">
        <view class="mx-bar-row" :class="{ 'mx-bar-row--compact': compact }">
          <view class="mx-back" hover-class="is-press" @tap="goBack">
            <text class="mx-back-chev">‹</text>
          </view>

          <view class="mx-brand" hover-class="is-press" @tap="goHome">
            <mx-logo size="sm" :word="true" />
          </view>

          <view class="mx-side"></view>
        </view>
      </view>
    </view>
    <view class="mx-bar-gap" :style="{ height: totalHeight + 'px' }"></view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ROUTES } from '../../routes';
import MxLogo from '../mx-logo/mx-logo.vue';

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });

/**
 * 全站品牌栏：左返回，中品牌标（点即回首页），右侧留白给小程序胶囊。
 * 用固定高度占位块顶住页面内容，页面本身不需要再补 padding。
 */
const statusBarHeight = ref(0);
try {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0;
} catch {
  statusBarHeight.value = 0;
}

const BAR_PX = 44;

const totalHeight = computed(() => statusBarHeight.value + BAR_PX);

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

.mx-bar-gap {
  width: 100%;
}

.is-press {
  opacity: 0.6;
}

@media (min-width: 768px) {
  .mx-bar {
    left: 50%;
    right: auto;
    width: 750px;
    transform: translateX(-50%);
  }

  .mx-bar--compact {
    width: 520px;
  }

  .mx-bar-row {
    max-width: 750px;
    margin: 0 auto;
    padding: 0;
  }

  .mx-bar-row--compact {
    max-width: 520px;
  }
}
</style>
