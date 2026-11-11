<template>
  <view class="page">
    <view class="card brand-card">
      <view class="logo">MX</view>
      <text class="name">MixmAPP</text>
      <text class="ver">v{{ version }} · {{ env }}</text>
      <text class="hint mt">uni-app 单码多端 · 自动发号 · 全链路自动化</text>
    </view>

    <view class="card">
      <text class="section">服务端能力</text>
      <text v-if="!meta" class="hint">{{ error || '正在读取 /api/v1/meta …' }}</text>
      <view v-else class="caps">
        <view v-for="(value, key) in meta.thirdParty" :key="key" class="cap">
          <text class="cap-key">{{ key }}</text>
          <text class="cap-val" :class="{ 'cap-val--off': value === 'off' }">{{ value }}</text>
        </view>
      </view>
      <text v-if="meta" class="hint mt">发号策略：{{ meta.ids.current }} ｜ 可用：{{ meta.ids.strategies.join(' / ') }}</text>
    </view>

    <view class="card">
      <text class="section">运行环境</text>
      <view class="row"><text class="k">当前平台</text><text class="v">{{ platform }}</text></view>
      <view class="row"><text class="k">API 基址</text><text class="v mono break">{{ apiBase }}</text></view>
      <view class="row"><text class="k">上次启动</text><text class="v">{{ lastLaunch }}</text></view>
    </view>

    <view class="card">
      <text class="section">交付链路</text>
      <view class="flow">
        <view class="flow-item"><text class="step">01</text><text class="flow-text">提交代码</text></view>
        <view class="flow-item"><text class="step">02</text><text class="flow-text">门禁：类型 + 单测 + 契约</text></view>
        <view class="flow-item"><text class="step">03</text><text class="flow-text">多端构建（H5 / App / 鸿蒙 / 小程序）</text></view>
        <view class="flow-item"><text class="step">04</text><text class="flow-text">静态端与 API 自动发布</text></view>
        <view class="flow-item"><text class="step">05</text><text class="flow-text">健康检查 + 一键回滚</text></view>
      </view>
    </view>

    <text class="foot">© 2026 MixmAPP · 内部构建版本</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { API_BASE, metaApi, ApiError } from '../../api/client';

const version = ref('0.1.0');
const env = ref('unknown');
const meta = ref<{
  appName: string;
  version: string;
  env: string;
  ids: { strategies: string[]; current: string };
  thirdParty: Record<string, string>;
  serverTime: string;
} | null>(null);
const error = ref('');
const platform = ref('');
const apiBase = ref(API_BASE);
const lastLaunch = ref('—');

onLoad(async () => {
  const info = uni.getSystemInfoSync();
  platform.value = `${info.uniPlatform} · ${info.osName ?? info.platform}`;
  const stored = uni.getStorageSync('mixmapp:lastLaunch') as { at?: string } | '';
  if (stored && stored.at) lastLaunch.value = new Date(stored.at).toLocaleString();
  try {
    meta.value = await metaApi.get();
    version.value = meta.value.version;
    env.value = meta.value.env;
  } catch (e) {
    error.value = e instanceof ApiError ? `无法连接 API：${e.message}` : '无法连接 API';
  }
});
</script>

<style scoped lang="scss">
.page {
  padding: 32rpx 32rpx 64rpx;
}

.brand-card {
  text-align: center;
  padding: 48rpx 32rpx;
}

.logo {
  width: 108rpx;
  height: 108rpx;
  margin: 0 auto 20rpx;
  border-radius: 28rpx;
  background: linear-gradient(140deg, #0b1220, #0f9d8f);
  color: #ffffff;
  font-weight: 700;
  font-size: 34rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.name {
  display: block;
  font-size: 38rpx;
  font-weight: 700;
}

.ver {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #94a3b8;
}

.mt {
  margin-top: 16rpx;
}

.section {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  margin-bottom: 18rpx;
}

.caps {
  display: flex;
  flex-wrap: wrap;
}

.cap {
  width: 48%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14rpx 0;
}

.cap-key {
  font-size: 23rpx;
  color: #64748b;
}

.cap-val {
  font-size: 22rpx;
  color: #0b7f74;
  background: #e6f6f4;
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
}

.cap-val--off {
  color: #94a3b8;
  background: #f1f5f9;
}

.hint {
  display: block;
  font-size: 24rpx;
  color: #94a3b8;
  line-height: 1.6;
}

.row {
  display: flex;
  justify-content: space-between;
  padding: 16rpx 0;
  border-bottom: 1rpx solid #f1f5f9;
}

.row:last-child {
  border-bottom: none;
}

.k {
  font-size: 25rpx;
  color: #64748b;
}

.v {
  font-size: 25rpx;
  color: #0b1220;
  text-align: right;
  max-width: 60%;
  word-break: break-all;
}

.break {
  font-size: 21rpx;
  color: #475569;
}

.flow-item {
  display: flex;
  align-items: center;
  padding: 14rpx 0;
}

.step {
  width: 56rpx;
  font-size: 22rpx;
  color: #0f9d8f;
  font-weight: 700;
}

.flow-text {
  font-size: 24rpx;
  color: #334155;
}

.foot {
  display: block;
  margin-top: 48rpx;
  text-align: center;
  font-size: 22rpx;
  color: #94a3b8;
}
</style>
