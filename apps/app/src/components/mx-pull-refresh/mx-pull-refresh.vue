<template>
  <view
    class="mx-pull"
    @touchstart="onStart"
    @touchmove="onMove"
    @touchend="onEnd"
    @touchcancel="onEnd"
  >
    <!-- 指示轨：在内容上方的正常流里占据被推开的空隙，不覆盖任何控件 -->
    <view
      class="mx-pull__indicator"
      :class="{ 'mx-pull__indicator--rest': !dragging }"
      :style="indicatorStyle"
    >
      <view class="mx-pull__inner">
        <view
          class="mx-pull__ring"
          :class="{
            'mx-pull__ring--spin': refreshing,
            'mx-pull__ring--reached': reached && !refreshing,
          }"
        />
        <text class="mx-pull__label mono">{{ label }}</text>
      </view>
    </view>
    <view class="mx-pull__content">
      <slot />
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

/**
 * 壳层下拉刷新（SwipeRefreshLayout 形态）。
 *
 * uni-app H5 自带的下拉刷新把触摸监听绑在 uni-page-wrapper 上，并依赖页面处于
 * document 顶部、触摸可 cancelable；在 Capacitor WebView（edge-to-edge +
 * OVER_SCROLL_NEVER）里，原生层会先消费顶部下拉手势，自带指示器经常收不到
 * touchmove。本组件把触摸序列挂在自己的根节点上：
 *  - 下拉时内容被指示轨整体推开（指示轨在正常流里占住空隙，绝不浮层压住控件）；
 *  - 越过阈值松手后进入固定小位移的刷新态，指示环在空隙里居中旋转；
 *  - 刷新落定由父级把 refreshing 置回 false，指示轨平滑归位。
 *
 * 不伪造动画：refresh 事件发出后必须由父级完成真实请求并复位 refreshing。
 *
 * 跨端约束：组件不访问 document/window（mp-weixin、app-harmony 无 DOM）。
 * 页面是否在顶部由父级经 onPageScroll 把 scrollTop 经 prop 传入。
 */
const props = withDefaults(
  defineProps<{
    /** 父级刷新中：锁定手势、保持固定空隙与旋转环，结束后置 false 收起 */
    refreshing?: boolean;
    /** 页面当前纵向滚动距离（px），由父级 onPageScroll 写入；<=0 才视为在顶部 */
    scrollTop?: number;
    /** 触发阈值（px），越过才在松手时回调 */
    threshold?: number;
    /** 下拉阻尼后的最大跟随距离（px） */
    maxPull?: number;
  }>(),
  { refreshing: false, scrollTop: 0, threshold: 72, maxPull: 104 },
);

const emit = defineEmits<{ refresh: [] }>();

/** 刷新态保持的固定空隙（px），对应原生 SwipeRefresh 的静止偏移 */
const HOLD_GAP = 52;

const started = ref(false);
const dragging = ref(false);
const reached = ref(false);
const distance = ref(0);
const startY = ref(0);
const startX = ref(0);

/** 当前指示轨占据的空隙：刷新中取固定值，其余跟随下拉距离 */
const gap = computed(() => (props.refreshing ? HOLD_GAP : distance.value));

const indicatorStyle = computed(() => ({
  height: `${gap.value}px`,
}));

const label = computed(() => {
  if (props.refreshing) return '正在刷新…';
  return reached.value ? '松开刷新' : '下拉刷新';
});

/** 仅当页面已回到顶部才接管下拉；页面在中部时手势交还给页面滚动。 */
function atTop(): boolean {
  return props.scrollTop <= 0.5;
}

function onStart(e: TouchEvent): void {
  if (props.refreshing) return;
  if (!atTop()) return;
  const touch = e.changedTouches[0];
  if (!touch) return;
  startY.value = touch.clientY;
  startX.value = touch.clientX;
  started.value = true;
  dragging.value = false;
  reached.value = false;
  distance.value = 0;
}

function onMove(e: TouchEvent): void {
  if (props.refreshing || !started.value) return;
  // 手势中途页面被滚离顶部：放弃接管，把事件还给页面滚动
  if (!atTop()) {
    started.value = false;
    dragging.value = false;
    distance.value = 0;
    reached.value = false;
    return;
  }
  const touch = e.changedTouches[0];
  if (!touch) return;
  const dy = touch.clientY - startY.value;
  const dx = touch.clientX - startX.value;
  // 先确认是纵向下拉，避免抢走横向 chips / 抽屉的滑动
  if (!dragging.value) {
    if (dy > 8 && Math.abs(dy) > Math.abs(dx)) dragging.value = true;
    else return;
  }
  if (dy <= 0) {
    distance.value = 0;
    reached.value = false;
    return;
  }
  const damped = Math.min(dy * 0.55, props.maxPull);
  distance.value = damped;
  reached.value = damped >= props.threshold;
}

function onEnd(): void {
  if (!started.value) return;
  started.value = false;
  dragging.value = false;
  if (reached.value && !props.refreshing) {
    distance.value = HOLD_GAP;
    emit('refresh');
  } else {
    distance.value = 0;
    reached.value = false;
  }
}

watch(
  () => props.refreshing,
  (v) => {
    if (!v) {
      distance.value = 0;
      reached.value = false;
      dragging.value = false;
    }
  },
);
</script>

<style scoped lang="scss">
.mx-pull {
  position: relative;
}

/* 指示轨：正常流内的空隙，横向居中；收起时高度归零并隐藏内部 */
.mx-pull__indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  box-sizing: border-box;
  padding-top: var(--mx-safe-top, 0px);
  overflow: hidden;
  transition: height 0.25s ease, opacity 0.25s ease;
}

/* 拖拽跟手时不加过渡；松手 / 归位 / 刷新切换才走平滑动画 */
.mx-pull__indicator--rest {
  transition: height 0.25s ease, opacity 0.25s ease;
}

.mx-pull__inner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-shrink: 0;
}

/* 纯 CSS 细环：三端（H5 / mp-weixin / 鸿蒙）都能渲染，不依赖 svg 元素 */
.mx-pull__ring {
  width: 28px;
  height: 28px;
  box-sizing: border-box;
  flex-shrink: 0;
  border: 3rpx solid $paper-3;
  border-top-color: $brand;
  border-radius: 50%;
}

/* 越过阈值未松手：再多亮右侧一段 */
.mx-pull__ring--reached {
  border-right-color: $brand;
}

.mx-pull__ring--spin {
  animation: mx-pull-spin 0.8s linear infinite;
}

.mx-pull__label {
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  color: $ink-2;
}

@keyframes mx-pull-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .mx-pull__ring--spin {
    animation-duration: 2.4s;
  }
}
</style>
