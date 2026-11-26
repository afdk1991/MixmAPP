<template>
  <view class="mx-logo" :class="[`mx-logo--${size}`, `mx-logo--${tone}`]">
    <view class="mx-logo-mark">
      <text class="mx-logo-mono">MixmAPP</text>
      <view class="mx-logo-underline" />
    </view>

    <text v-if="sub" class="mx-logo-sub">{{ sub }}</text>
  </view>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 尺寸：sm 顶栏 / md 页面头 / lg 首屏 */
    size?: 'sm' | 'md' | 'lg';
    /** 色调：ink 浅底 / light 深底 */
    tone?: 'ink' | 'light';
    /** 胶囊右侧的等宽小字，如 MIXMAPP ACCOUNT */
    sub?: string;
  }>(),
  {
    size: 'md',
    tone: 'ink',
    sub: '',
  },
);
</script>

<style scoped lang="scss">
.mx-logo {
  display: inline-flex;
  align-items: center;
}

/* ---------- 标志：白底圆角胶囊内 “MixmAPP” 字标 + 品牌青底线 ---------- */
/* 规格对齐 branding/mixm-logo.svg：胶囊圆角 = 高 × 0.29，字标宽 = 胶囊宽 × 0.86 */
.mx-logo-mark {
  position: relative;
  flex-shrink: 0;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1rpx solid $paper-3;
  background: #fff;
}

.mx-logo-mono {
  display: block;
  font-family: $font-display;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.03em;
  /* 字标跟随全站彩色正文体系：用深青品牌色，避免整站只剩 logo 一处近黑文字 */
  color: $brand-deep;
}

.mx-logo-underline {
  position: absolute;
  left: 9%;
  right: 9%;
  bottom: 14%;
  height: 3rpx;
  background: $brand;
}

.mx-logo-sub {
  font-family: $font-mono;
  line-height: 1;
  letter-spacing: 2rpx;
  text-transform: uppercase;
  color: $ink-4;
}

/* ---------- 尺寸 ---------- */
.mx-logo--sm {
  .mx-logo-mark {
    height: 44rpx;
    padding: 0 14rpx;
    border-radius: 13rpx;
  }

  .mx-logo-mono {
    font-size: 22rpx;
  }

  .mx-logo-sub {
    margin-left: 12rpx;
    font-size: 16rpx;
  }
}

.mx-logo--md {
  .mx-logo-mark {
    height: 64rpx;
    padding: 0 20rpx;
    border-radius: 19rpx;
  }

  .mx-logo-mono {
    font-size: 30rpx;
  }

  .mx-logo-sub {
    margin-left: 16rpx;
    font-size: 18rpx;
  }
}

.mx-logo--lg {
  .mx-logo-mark {
    height: 96rpx;
    padding: 0 30rpx;
    border-radius: 28rpx;
  }

  .mx-logo-mono {
    font-size: 44rpx;
  }

  .mx-logo-sub {
    margin-left: 22rpx;
    font-size: 24rpx;
  }
}

/* ---------- 深底：胶囊仍为白底黑字（参考图口径），仅副标反白 ---------- */
.mx-logo--light {
  .mx-logo-mark {
    border-color: rgba(17, 17, 17, 0.07);
  }

  .mx-logo-sub {
    color: rgba(244, 244, 241, 0.5);
  }
}
</style>
