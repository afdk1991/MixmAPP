<template>
  <view class="page">
    <view class="hero">
      <view class="hero-top">
        <view class="logo-mark">MX</view>
        <view class="brand">
          <text class="brand-name">MixmAPP</text>
          <text class="brand-sub">uni-app · 单码多端</text>
        </view>
        <view class="version">{{ version }}</view>
      </view>

      <text class="headline">一个账号</text>
      <text class="headline">跑通所有端</text>
      <text class="lede">Web / Android / iOS / 鸿蒙 · 注册即自动分配 MixmAPP 号码</text>

      <view class="status-row">
        <view class="dot" :class="{ 'dot--down': !online }" />
        <text class="status-text">{{ statusText }}</text>
      </view>
    </view>

    <view class="container">
      <view class="grid">
        <view class="tile tile--wide" hover-class="tile-hover" @tap="go('/pages/auth/register')">
          <text class="tile-kicker">第一步</text>
          <text class="tile-title">创建账号</text>
          <text class="tile-desc">手机验证码 / 邮箱密码 / 第三方一键登录</text>
        </view>
        <view class="tile tile--wide" hover-class="tile-hover" @tap="go('/pages/mall/index')">
          <text class="tile-kicker">商城</text>
          <text class="tile-title">MixmAPP 商城</text>
          <text class="tile-desc">商品 · 购物车 · 订单</text>
        </view>
        <view class="tile" hover-class="tile-hover" @tap="go('/pages/auth/login')">
          <text class="tile-title">登录</text>
          <text class="tile-desc">密码 · 短信 · OAuth</text>
        </view>
        <view class="tile" hover-class="tile-hover" @tap="go('/pages/me/index')">
          <text class="tile-title">我的</text>
          <text class="tile-desc">MixmAPP 号码与绑定</text>
        </view>
        <view class="tile" hover-class="tile-hover" @tap="go('/pages/tools/ids')">
          <text class="tile-title">ID 试算器</text>
          <text class="tile-desc">雪花 / ULID / UUIDv7</text>
        </view>
        <view class="tile" hover-class="tile-hover" @tap="go('/pages/settings/about')">
          <text class="tile-title">关于</text>
          <text class="tile-desc">能力矩阵与版本</text>
        </view>
      </view>

      <view class="card platform-card">
        <text class="section-title">已接通的端</text>
        <text class="hint">同一套 Vue3 代码，按平台产出不同产物。</text>
        <view class="chips">
          <view v-for="p in platforms" :key="p" class="chip">{{ p }}</view>
        </view>
      </view>

      <view class="foot">
        <text class="hint">构建 · 测试 · 部署 · 运维 全链路自动化</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { metaApi } from '../../api/client';

const version = ref('0.0.0-preview');
const online = ref(false);
const env = ref('unknown');
const platforms = ['Web / H5', 'PWA', 'Android', 'iOS', '鸿蒙', '微信小程序'];

const statusText = computed(() =>
  online.value ? `服务在线 · ${env.value} 环境` : '未连上 API（先启动 services/api）',
);

function go(url: string): void {
  uni.navigateTo({ url });
}

onLoad(async () => {
  try {
    const meta = await metaApi.get();
    version.value = meta.version;
    env.value = meta.env;
    online.value = true;
  } catch {
    online.value = false;
  }
});
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f6f7f9;
}

.hero {
  padding: 96rpx 40rpx 56rpx;
  background: linear-gradient(150deg, #0b1220 0%, #12303a 62%, #0f9d8f 140%);
  border-bottom-left-radius: 48rpx;
  border-bottom-right-radius: 48rpx;
}

.hero-top {
  display: flex;
  align-items: center;
  margin-bottom: 56rpx;
}

.logo-mark {
  width: 76rpx;
  height: 76rpx;
  border-radius: 20rpx;
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1rpx solid rgba(255, 255, 255, 0.18);
}

.brand {
  flex: 1;
  margin-left: 20rpx;
  display: flex;
  flex-direction: column;
}

.brand-name {
  color: #ffffff;
  font-size: 34rpx;
  font-weight: 700;
}

.brand-sub {
  color: rgba(255, 255, 255, 0.62);
  font-size: 22rpx;
  margin-top: 4rpx;
}

.version {
  color: rgba(255, 255, 255, 0.72);
  font-size: 22rpx;
  padding: 8rpx 18rpx;
  border-radius: 999rpx;
  border: 1rpx solid rgba(255, 255, 255, 0.2);
}

.headline {
  display: block;
  color: #ffffff;
  font-size: 68rpx;
  line-height: 1.12;
  font-weight: 700;
  letter-spacing: -1rpx;
}

.lede {
  display: block;
  margin-top: 24rpx;
  color: rgba(255, 255, 255, 0.7);
  font-size: 26rpx;
  line-height: 1.6;
}

.status-row {
  margin-top: 40rpx;
  display: flex;
  align-items: center;
}

.dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: #34d399;
  margin-right: 14rpx;
}

.dot--down {
  background: #f59e0b;
}

.status-text {
  color: rgba(255, 255, 255, 0.8);
  font-size: 24rpx;
}

.container {
  padding: 32rpx 32rpx 64rpx;
}

.grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
}

.tile {
  width: 48.2%;
  background: #ffffff;
  border-radius: 24rpx;
  padding: 30rpx 28rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 8rpx 24rpx rgba(11, 18, 32, 0.06);
  box-sizing: border-box;
}

.tile--wide {
  width: 100%;
  background: #0b1220;
}

.tile--wide .tile-title {
  color: #ffffff;
  font-size: 40rpx;
}

.tile--wide .tile-desc {
  color: rgba(255, 255, 255, 0.62);
}

.tile-kicker {
  display: block;
  font-size: 22rpx;
  color: #0f9d8f;
  margin-bottom: 10rpx;
}

.tile-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: #0b1220;
}

.tile-desc {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #94a3b8;
}

.tile-hover {
  opacity: 0.85;
}

.platform-card {
  margin-top: 8rpx;
}

.section-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  margin-bottom: 12rpx;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  margin-top: 18rpx;
}

.chip {
  font-size: 22rpx;
  color: #0b7f74;
  background: #e6f6f4;
  padding: 10rpx 20rpx;
  border-radius: 999rpx;
  margin: 0 14rpx 14rpx 0;
}

.foot {
  margin-top: 40rpx;
  text-align: center;
}
</style>
