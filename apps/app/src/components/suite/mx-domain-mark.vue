<template>
  <view
    class="mx-domain-mark"
    :class="[`mx-domain-mark--acc-${accent}`, `mx-domain-mark--${size}`]"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
  >
    <text class="mx-domain-mark__text">{{ text }}</text>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';

/**
 * 领域徽标：色块 + 两字标记。
 *
 * 13 个领域共用同一套几何形（圆角方块 + 单字），靠 accent 槽位区分颜色，
 * 不为每个领域单独画一套图标 —— 既保持视觉语言一致，也省掉一整套图标几何。
 */
const props = withDefaults(
  defineProps<{
    /** 领域标记文字，一般是领域名的前 1–2 个字 */
    text: string;
    /** 1..6 对应主题六个彩色前景槽位 */
    accent?: 1 | 2 | 3 | 4 | 5 | 6;
    /** sm 小 / md 中 / lg 大 */
    size?: 'sm' | 'md' | 'lg';
    /** 独立表意标签；给定时暴露给辅助技术 */
    label?: string;
  }>(),
  {
    accent: 1,
    size: 'md',
    label: '',
  },
);

const resolvedText = computed(() => props.text.slice(0, 2));
</script>

<style scoped lang="scss">
.mx-domain-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: $r-control;
  background: $deep-2;
  color: $on-deep;
  font-family: $font-display;
  font-weight: 800;
  letter-spacing: 0;
  line-height: 1;
}

.mx-domain-mark__text {
  font-size: $fs-body;
}

/* 六个彩色槽位：底色用深场 + 彩色前景字，保证两套主题下对比度都够。 */
.mx-domain-mark--acc-1 {
  color: $acc-on-deep-1;
}
.mx-domain-mark--acc-2 {
  color: $acc-on-deep-2;
}
.mx-domain-mark--acc-3 {
  color: $acc-on-deep-3;
}
.mx-domain-mark--acc-4 {
  color: $fav;
}
.mx-domain-mark--acc-5 {
  color: $amber-on-deep;
}
.mx-domain-mark--acc-6 {
  color: $acc-on-deep-1;
}

.mx-domain-mark--sm {
  width: 48rpx;
  height: 48rpx;
  border-radius: $r-xs;

  .mx-domain-mark__text {
    font-size: $fs-micro;
  }
}

.mx-domain-mark--md {
  width: 72rpx;
  height: 72rpx;

  .mx-domain-mark__text {
    font-size: $fs-meta;
  }
}

.mx-domain-mark--lg {
  width: 104rpx;
  height: 104rpx;
  border-radius: $r-card;

  .mx-domain-mark__text {
    font-size: $fs-h3;
  }
}
</style>
