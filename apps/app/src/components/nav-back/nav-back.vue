<template>
  <view class="nav-back" hover-class="is-press" @tap="goBack">
    <text class="nav-back-arrow">‹</text>
    <text class="nav-back-text">{{ label }}</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

/**
 * 页内返回控件。
 * 设计前提：不能依赖系统导航栏——深度链接进入、或页面自定义头部盖住导航栏时，
 * 导航栏的返回键要么不存在，要么点不到。
 * 行为：能回退就回退一层；栈里只有当前页（直接打开该页）就 reLaunch 回首页。
 */
const props = withDefaults(defineProps<{ home?: string }>(), { home: '/pages/index/index' });

const stackDepth = ref(1);
try {
  stackDepth.value = getCurrentPages().length;
} catch {
  stackDepth.value = 1;
}

const label = computed(() => (stackDepth.value > 1 ? '返回' : '首页'));

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
      fail: () => uni.reLaunch({ url: props.home }),
    });
    return;
  }
  uni.reLaunch({ url: props.home });
}
</script>

<style scoped>
/* 字面量样式：不依赖全局 SCSS 令牌，避免被其它分支的设计令牌牵连 */
.nav-back {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  margin: 4px 0 10px;
  padding: 6px 12px 6px 8px;
  border-radius: 999px;
  background: rgba(13, 25, 23, 0.06);
  border: 1px solid #dbe3df;
}

.nav-back-arrow {
  font-size: 15px;
  line-height: 1;
  margin-right: 2px;
  color: #33443f;
}

.nav-back-text {
  font-size: 12px;
  line-height: 1.2;
  letter-spacing: 0.5px;
  color: #0d1917;
}

.is-press {
  opacity: 0.72;
}
</style>
