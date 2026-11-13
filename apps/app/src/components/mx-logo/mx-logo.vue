<template>
  <view class="mx-logo" :class="[`mx-logo--${size}`, `mx-logo--${tone}`]">
    <view class="mx-logo-mark">
      <text class="mx-logo-mono">MX</text>
      <view class="mx-logo-underline" />
    </view>

    <view v-if="word" class="mx-logo-text">
      <text class="mx-logo-word">{{ wordmark }}</text>
      <text v-if="sub" class="mx-logo-sub">{{ sub }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 尺寸：sm 顶栏 / md 页面头 / lg 首屏 */
    size?: 'sm' | 'md' | 'lg';
    /** 色调：ink 浅底 / light 深底 */
    tone?: 'ink' | 'light';
    /** 是否显示字标 */
    word?: boolean;
    /** 字标文案 */
    wordmark?: string;
    /** 字标下的等宽小字，如 MULTI-END IDENTITY */
    sub?: string;
  }>(),
  {
    size: 'md',
    tone: 'ink',
    word: true,
    wordmark: 'MixmAPP',
    sub: '',
  },
);
</script>

<style scoped lang="scss">
.mx-logo {
  display: inline-flex;
  align-items: center;
}

/* ---------- 标志：方框内 “MX” 连字 + 品牌色底线 ---------- */
.mx-logo-mark {
  position: relative;
  flex-shrink: 0;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1rpx solid $paper-3;
  background: $shell;
  overflow: hidden;
}

.mx-logo-mono {
  display: block;
  font-family: $font-display;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -2rpx;
  color: $ink;
}

.mx-logo-underline {
  position: absolute;
  left: 18%;
  right: 18%;
  bottom: 22%;
  height: 3rpx;
  background: $brand;
}

.mx-logo-text {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.mx-logo-word {
  display: block;
  font-family: $font-display;
  font-weight: 800;
  line-height: 1;
  letter-spacing: $ls-tight;
  color: $ink;
}

.mx-logo-sub {
  display: block;
  font-family: $font-mono;
  line-height: 1;
  letter-spacing: 2rpx;
  text-transform: uppercase;
  color: $ink-4;
}

/* ---------- 尺寸 ---------- */
.mx-logo--sm {
  .mx-logo-mark {
    width: 40rpx;
    height: 40rpx;
    border-radius: 8rpx;
  }

  .mx-logo-mono {
    font-size: 26rpx;
  }

  .mx-logo-text {
    margin-left: 12rpx;
  }

  .mx-logo-word {
    font-size: 28rpx;
  }

  .mx-logo-sub {
    font-size: 16rpx;
    margin-top: 5rpx;
  }
}

.mx-logo--md {
  .mx-logo-mark {
    width: 60rpx;
    height: 60rpx;
    border-radius: 10rpx;
  }

  .mx-logo-mono {
    font-size: 32rpx;
  }

  .mx-logo-text {
    margin-left: 16rpx;
  }

  .mx-logo-word {
    font-size: 36rpx;
  }

  .mx-logo-sub {
    font-size: 18rpx;
    margin-top: 6rpx;
  }
}

.mx-logo--lg {
  .mx-logo-mark {
    width: 92rpx;
    height: 92rpx;
    border-radius: 14rpx;
  }

  .mx-logo-mono {
    font-size: 46rpx;
  }

  .mx-logo-text {
    margin-left: 22rpx;
  }

  .mx-logo-word {
    font-size: 48rpx;
  }

  .mx-logo-sub {
    font-size: 26rpx;
    margin-top: 8rpx;
  }
}

/* ---------- 深底反白 ---------- */
.mx-logo--light {
  .mx-logo-mark {
    background: rgba(244, 244, 241, 0.05);
    border-color: rgba(244, 244, 241, 0.26);
  }

  .mx-logo-mono {
    color: #f4f4f1;
  }

  .mx-logo-word {
    color: #f4f4f1;
  }

  .mx-logo-sub {
    color: rgba(244, 244, 241, 0.5);
  }
}
</style>
