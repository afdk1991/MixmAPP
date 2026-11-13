<template>
  <view class="page">
    <nav-back />
    <view class="brand">
      <text class="brand-watermark mono">MixmAPP</text>
      <view class="brand-mark mono">MX</view>
      <text class="brand-name">{{ appName }}</text>
      <text class="brand-ver mono">v{{ version }} · {{ env }}</text>
      <text class="brand-lede">uni-app 单码多端 · 自动发号 · 全链路自动化</text>
      <view class="brand-tags">
        <text class="tag tag--dark">内置发号</text>
        <text class="tag tag--dark">多端构建</text>
        <text class="tag tag--dark">一键回滚</text>
      </view>
    </view>

    <view class="sheet block">
      <text class="eyebrow">CAPABILITIES</text>
      <text class="block-title">服务端能力</text>
      <text v-if="!meta" class="hint">{{ error || '正在读取 /api/v1/meta …' }}</text>
      <view v-else class="cap-list">
        <view v-for="(value, key) in meta.thirdParty" :key="key" class="cap">
          <view class="cap-left">
            <view class="cap-dot" :class="{ 'cap-dot--off': value === 'off' }" />
            <text class="cap-key mono">{{ key }}</text>
          </view>
          <text class="cap-val mono" :class="{ 'cap-val--off': value === 'off' }">{{ value }}</text>
        </view>
      </view>
      <text v-if="meta" class="cap-note">发号策略：{{ meta.ids.current }} ｜ 可用：{{ meta.ids.strategies.join(' / ') }}</text>
    </view>

    <view class="sheet block">
      <text class="eyebrow">RUNTIME</text>
      <text class="block-title">运行环境</text>
      <view class="row"><text class="k">当前平台</text><text class="v">{{ platform }}</text></view>
      <view class="row"><text class="k">API 基址</text><text class="v v--mono mono">{{ apiBase }}</text></view>
      <view class="row row--last"><text class="k">上次启动</text><text class="v mono">{{ lastLaunch }}</text></view>
    </view>

    <view class="sheet block">
      <text class="eyebrow">ADMIN</text>
      <text class="block-title">管理后台</text>
      <text class="hint">查看数据库落点、在云 PG 与服务器 PG 之间热切换，并手动触发超时订单扫描。</text>
      <button class="admin-btn" @click="openAdmin">进入管理后台</button>
    </view>

    <view class="sheet block">
      <text class="eyebrow">DELIVERY</text>
      <text class="block-title">交付链路</text>
      <view class="flow">
        <view v-for="(step, i) in flow" :key="step.no" class="flow-item">
          <view class="flow-no-wrap">
            <view class="flow-no mono">{{ step.no }}</view>
            <view v-if="i < flow.length - 1" class="flow-line" />
          </view>
          <text class="flow-text">{{ step.text }}</text>
        </view>
      </view>
    </view>

    <text class="foot mono">© 2026 MIXMAPP · INTERNAL BUILD</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { API_BASE, metaApi, ApiError } from '../../api/client';
import { APP_VERSION } from '../../version';

const appName = ref('MixmAPP');
const version = ref(APP_VERSION);
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

const flow = [
  { no: '01', text: '提交代码' },
  { no: '02', text: '门禁：类型 + 单测 + 契约' },
  { no: '03', text: '多端构建（H5 / App / 鸿蒙 / 小程序）' },
  { no: '04', text: '静态端与 API 自动发布' },
  { no: '05', text: '健康检查 + 一键回滚' },
];

function openAdmin(): void {
  uni.navigateTo({ url: '/pages/admin/index' });
}

onLoad(async () => {
  const info = uni.getSystemInfoSync();
  platform.value = `${info.uniPlatform} · ${info.osName ?? info.platform}`;
  const stored = uni.getStorageSync('mixmapp:lastLaunch') as { at?: string } | '';
  if (stored && stored.at) lastLaunch.value = new Date(stored.at).toLocaleString();
  try {
    meta.value = await metaApi.get();
    appName.value = meta.value.appName || 'MixmAPP';
    version.value = meta.value.version;
    env.value = meta.value.env;
  } catch (e) {
    error.value = e instanceof ApiError ? `无法连接 API：${e.message}` : '无法连接 API';
  }
});
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  padding: $sp-4 $sp-3 $sp-8;
}

/* ---------- 品牌板 ---------- */
.brand {
  position: relative;
  overflow: hidden;
  padding: $sp-6 $sp-5 $sp-5;
  background:
    radial-gradient(120% 90% at 88% -14%, rgba(15, 157, 143, 0.26), rgba(15, 157, 143, 0) 58%),
    linear-gradient(158deg, #08110f 0%, #0e2925 62%, #14453c 120%);
  border-radius: $r-shell;
}

.brand-watermark {
  position: absolute;
  right: -8rpx;
  bottom: -18rpx;
  font-size: 84rpx;
  line-height: 1;
  letter-spacing: 3rpx;
  color: rgba(242, 245, 243, 0.06);
}

.brand-mark {
  width: 96rpx;
  height: 96rpx;
  border: 1rpx solid rgba(242, 245, 243, 0.24);
  border-radius: 22rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
  font-weight: 700;
  letter-spacing: 3rpx;
  color: #f4f8f6;
}

.brand-name {
  display: block;
  margin-top: $sp-4;
  font-family: $font-display;
  font-size: 48rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
  color: #f6faf8;
}

.brand-ver {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  letter-spacing: 1rpx;
  color: rgba(242, 245, 243, 0.62);
}

.brand-lede {
  display: block;
  margin-top: $sp-3;
  font-size: 26rpx;
  line-height: 1.7;
  color: rgba(242, 245, 243, 0.66);
}

.brand-tags {
  display: flex;
  flex-wrap: wrap;
  margin-top: $sp-4;
}

.brand-tags .tag {
  margin: 0 12rpx 12rpx 0;
}

/* ---------- 内容块 ---------- */
.block {
  margin-top: $sp-3;
  padding: $sp-4;
}

.block-title {
  display: block;
  margin-top: 12rpx;
  font-family: $font-display;
  font-size: $fs-h2;
  font-weight: 600;
  color: $ink;
}

.block .hint {
  margin-top: 12rpx;
}

/* ---------- 能力 ---------- */
.cap-list {
  margin-top: $sp-3;
}

.cap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18rpx 0;
  border-bottom: 1rpx solid $paper-2;
}

.cap:last-child {
  border-bottom: none;
}

.cap-left {
  display: flex;
  align-items: center;
  min-width: 0;
}

.cap-dot {
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
  background: $brand;
  margin-right: 14rpx;
  flex-shrink: 0;
}

.cap-dot--off {
  background: $ink-4;
}

.cap-key {
  font-size: 22rpx;
  color: $ink-2;
}

.cap-val {
  margin-left: $sp-2;
  font-size: 20rpx;
  letter-spacing: 0.5rpx;
  color: $brand-deep;
  flex-shrink: 0;
}

.cap-val--off {
  color: $ink-4;
}

.cap-note {
  display: block;
  margin-top: $sp-3;
  padding-top: $sp-3;
  border-top: 1rpx solid $paper-2;
  font-size: 22rpx;
  line-height: 1.6;
  color: $ink-3;
}

/* ---------- 运行环境 ---------- */
.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20rpx 0;
  border-bottom: 1rpx solid $paper-2;
}

.row--last {
  border-bottom: none;
  padding-bottom: 0;
}

.k {
  flex-shrink: 0;
  margin-right: $sp-3;
  font-size: 24rpx;
  color: $ink-3;
}

.v {
  flex: 1;
  font-size: 24rpx;
  line-height: 1.5;
  color: $ink;
  text-align: right;
  word-break: break-all;
}

.v--mono {
  font-size: 20rpx;
  color: $ink-3;
}

.admin-btn {
  margin-top: $sp-3;
  padding: 22rpx 0;
  border-radius: $r-card;
  background: $brand;
  font-size: 24rpx;
  color: #f6faf8;
}

/* ---------- 交付链路 ---------- */
.flow {
  margin-top: $sp-3;
}

.flow-item {
  display: flex;
  align-items: flex-start;
}

.flow-no-wrap {
  width: 56rpx;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.flow-no {
  font-size: 20rpx;
  letter-spacing: 1rpx;
  color: $brand-deep;
  line-height: 1.4;
}

.flow-line {
  width: 1rpx;
  height: 40rpx;
  margin: 8rpx 0 0 4rpx;
  background: $paper-3;
}

.flow-text {
  flex: 1;
  padding: 0 0 32rpx 12rpx;
  font-size: 26rpx;
  line-height: 1.4;
  color: $ink-2;
}

.foot {
  display: block;
  margin-top: $sp-6;
  text-align: center;
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: $ink-4;
}
</style>
