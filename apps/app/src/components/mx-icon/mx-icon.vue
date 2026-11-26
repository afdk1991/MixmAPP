<template>
  <view class="mx-icon" :class="[`mx-icon--${name}`, `mx-icon--tone-${tone}`]" :style="rootStyle">
    <view class="mx-icon__p mx-icon__p1" />
    <view class="mx-icon__p mx-icon__p2" />
    <view class="mx-icon__p mx-icon__p3" />
    <view class="mx-icon__p mx-icon__p4" />
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';

/**
 * 自有线性图标：几何描边、单一颜色、无第三方图标库。
 * 用 view + 边框拼出形状，颜色走 currentColor，所以深/浅主题与任意底色都能直接套。
 * 尺寸以 rpx 传入，内部全部按百分比定位，缩放不掉线。
 */
const props = withDefaults(
  defineProps<{
    /** bag 商城 / cart 购物车 / receipt 订单 / bookmark 收藏 / box 无图商品 / user 通行证 / grid 业务套件 */
    name: 'bag' | 'cart' | 'receipt' | 'bookmark' | 'box' | 'user' | 'grid';
    size?: number;
    tone?: 'ink' | 'ink2' | 'brand' | 'on' | 'ondeep';
    /** 传入占位底色时按亮度自动取墨色或深场反白，避免浅底白图标 / 深底黑图标 */
    onTint?: string;
  }>(),
  {
    size: 40,
    tone: 'ink',
    onTint: '',
  },
);

function isLightHex(hex: string): boolean {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  let h = m[1] ?? '';
  if (h.length === 3) h = h.split('').map((c) => `${c}${c}`).join('');
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
}

const rootStyle = computed(() => {
  const style: Record<string, string> = {
    width: `${props.size}rpx`,
    height: `${props.size}rpx`,
  };
  if (props.onTint) {
    // 用主题变量而不是写死色值：浅色底取墨色，深色底取深场反白
    style.color = isLightHex(props.onTint) ? 'var(--mx-ink)' : 'var(--mx-on-deep)';
  }
  return style;
});
</script>

<style scoped lang="scss">
.mx-icon {
  position: relative;
  flex: 0 0 auto;
  display: block;
  color: $ink;
}

.mx-icon--tone-ink2 {
  color: $ink-2;
}

.mx-icon--tone-brand {
  color: $brand-deep;
}

.mx-icon--tone-on {
  color: $on-solid;
}

/* 彩色封面底（cover 存色值）用深场文字色，两套主题都不变 */
.mx-icon--tone-ondeep {
  color: $on-deep;
}

.mx-icon__p {
  position: absolute;
  display: none;
  box-sizing: border-box;
}

/* 商城：提袋 —— 宽而扁的袋身 + 宽提手，小尺寸下才不会和挂锁混淆 */
.mx-icon--bag .mx-icon__p1 {
  display: block;
  left: 12%;
  top: 46%;
  width: 76%;
  height: 40%;
  border: 2rpx solid currentColor;
  border-radius: 5rpx 5rpx 14rpx 14rpx;
}

.mx-icon--bag .mx-icon__p2 {
  display: block;
  left: 30%;
  top: 18%;
  width: 40%;
  height: 28%;
  border: 2rpx solid currentColor;
  border-bottom: none;
  border-radius: 999rpx 999rpx 0 0;
}

/* 购物车：车斗 + 推杆 + 两轮 */
.mx-icon--cart .mx-icon__p1 {
  display: block;
  left: 16%;
  top: 38%;
  width: 68%;
  height: 34%;
  border: 2rpx solid currentColor;
  border-radius: 4rpx 4rpx 6rpx 6rpx;
}

.mx-icon--cart .mx-icon__p2 {
  display: block;
  left: 6%;
  top: 24%;
  width: 26%;
  height: 2rpx;
  background: currentColor;
  transform: rotate(16deg);
  transform-origin: 100% 50%;
}

.mx-icon--cart .mx-icon__p3 {
  display: block;
  left: 26%;
  bottom: 8%;
  width: 13%;
  height: 13%;
  border: 2rpx solid currentColor;
  border-radius: 50%;
}

.mx-icon--cart .mx-icon__p4 {
  display: block;
  right: 26%;
  bottom: 8%;
  width: 13%;
  height: 13%;
  border: 2rpx solid currentColor;
  border-radius: 50%;
}

/* 订单：票据 + 三行文字 */
.mx-icon--receipt .mx-icon__p1 {
  display: block;
  left: 24%;
  top: 8%;
  width: 52%;
  height: 84%;
  border: 2rpx solid currentColor;
  border-radius: 4rpx;
}

.mx-icon--receipt .mx-icon__p2 {
  display: block;
  left: 34%;
  top: 30%;
  width: 32%;
  height: 2rpx;
  background: currentColor;
}

.mx-icon--receipt .mx-icon__p3 {
  display: block;
  left: 34%;
  top: 46%;
  width: 32%;
  height: 2rpx;
  background: currentColor;
}

.mx-icon--receipt .mx-icon__p4 {
  display: block;
  left: 34%;
  top: 62%;
  width: 20%;
  height: 2rpx;
  background: currentColor;
}

/* 收藏：书签剪影，缺口靠 clip-path，不支持时退化成竖签 */
.mx-icon--bookmark .mx-icon__p1 {
  display: block;
  left: 30%;
  top: 8%;
  width: 40%;
  height: 84%;
  background: currentColor;
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%);
  border-radius: 3rpx 3rpx 0 0;
}

/* 无图商品：包装盒 + 封条 */
.mx-icon--box .mx-icon__p1 {
  display: block;
  left: 22%;
  top: 22%;
  width: 56%;
  height: 56%;
  border: 2rpx solid currentColor;
  border-radius: 4rpx;
}

.mx-icon--box .mx-icon__p2 {
  display: block;
  left: 22%;
  top: 40%;
  width: 56%;
  height: 2rpx;
  background: currentColor;
}

.mx-icon--box .mx-icon__p3 {
  display: block;
  left: 48%;
  top: 22%;
  width: 4%;
  height: 24%;
  background: currentColor;
}

/* 通行证：头像 + 肩线 */
.mx-icon--user .mx-icon__p1 {
  display: block;
  left: 33%;
  top: 12%;
  width: 34%;
  height: 34%;
  border: 2rpx solid currentColor;
  border-radius: 50%;
}

.mx-icon--user .mx-icon__p2 {
  display: block;
  left: 18%;
  top: 56%;
  width: 64%;
  height: 34%;
  border: 2rpx solid currentColor;
  border-bottom: none;
  border-radius: 999rpx 999rpx 0 0;
}
/* 业务套件：2×2 四宫格，代表多行业模块的统一入口 */
.mx-icon--grid .mx-icon__p {
  display: block;
  width: 32%;
  height: 32%;
  border: 2rpx solid currentColor;
  border-radius: 4rpx;
}

.mx-icon--grid .mx-icon__p1 {
  left: 12%;
  top: 12%;
}

.mx-icon--grid .mx-icon__p2 {
  right: 12%;
  top: 12%;
}

.mx-icon--grid .mx-icon__p3 {
  left: 12%;
  bottom: 12%;
}

.mx-icon--grid .mx-icon__p4 {
  right: 12%;
  bottom: 12%;
}
</style>
