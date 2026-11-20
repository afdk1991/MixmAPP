<template>
  <view class="page">
    <mx-bar />

    <view class="brand">
      <mx-logo size="lg" tone="light" sub="MIXMAPP ACCOUNT" />
      <view class="brand-meta">
        <text class="brand-ver mono">V{{ APP_VERSION }}</text>
        <text class="brand-env mono">ENV · {{ envText }}</text>
      </view>
      <text class="brand-lede">uni-app 单码多端 · 内置发号中心</text>
    </view>

    <view class="sheet block">
      <text class="eyebrow">CAPABILITIES</text>
      <text class="block-title">服务端能力</text>
      <view class="rule" />
      <text v-if="!meta" class="hint">{{ error || '正在读取服务端能力…' }}</text>
      <view v-else class="cap-list">
        <view v-for="cap in capabilities" :key="cap.key" class="cap">
          <view class="cap-left">
            <view class="cap-dot" :class="{ 'cap-dot--off': !cap.on }" />
            <text class="cap-key">{{ cap.label }}</text>
          </view>
          <text class="cap-val" :class="{ 'cap-val--off': !cap.on }">{{ cap.value }}</text>
        </view>
      </view>
      <text v-if="meta" class="cap-note">发号策略：{{ meta.ids.current }}</text>
    </view>

    <view class="sheet block">
      <text class="eyebrow">RUNTIME</text>
      <text class="block-title">运行环境</text>
      <view class="rule" />
      <view class="row"><text class="k">当前平台</text><text class="v">{{ platform }}</text></view>
      <view class="row"><text class="k">API 基址 · {{ apiBaseSource }}</text><text class="v v--mono mono">{{ apiBase }}</text></view>
      <view class="row row--last"><text class="k">上次启动</text><text class="v mono">{{ lastLaunch }}</text></view>
    </view>

    <text class="foot mono">© 2026 MIXMAPP</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { API_BASE, API_BASE_SOURCE, metaApi, ApiError, applyMetaFlags, applyMetaThirdParty } from '../../api/client';
import { APP_VERSION } from '../../version';
import MxLogo from '../../components/mx-logo/mx-logo.vue';

type MetaInfo = {
  env: string;
  ids: { strategies: string[]; current: string };
  thirdParty: Record<string, string>;
};

const env = ref('');
const meta = ref<MetaInfo | null>(null);
const error = ref('');
const platform = ref('');
const apiBase = ref(API_BASE);
const API_BASE_SOURCE_TEXT: Record<string, string> = {
  runtime: '运行时注入',
  storage: '本地覆盖',
  build: '构建注入',
  default: '默认同源',
};
const apiBaseSource = ref(API_BASE_SOURCE_TEXT[API_BASE_SOURCE] ?? API_BASE_SOURCE);
const lastLaunch = ref('—');

/** 对外展示的能力项与中文名；顺序即展示顺序，未在 meta 中出现的项自动跳过。 */
const CAP_LABELS: Record<string, string> = {
  sms: '短信验证码',
  wechatOauth: '微信登录',
  qqOauth: 'QQ 登录',
  githubOauth: 'GitHub 登录',
  appleOauth: 'Apple 登录',
  onekey: '一键登录',
  wechatPay: '微信支付',
  alipay: '支付宝',
  map: '地图服务',
  storage: '对象存储',
  push: '消息推送',
  ai: 'AI 能力',
};

const CAP_VALUE_TEXT: Record<string, string> = {
  off: '未启用',
  dev: '开发态',
  local: '本地',
  console: '控制台',
};

const ENV_TEXT: Record<string, string> = {
  production: '生产',
  staging: '预发布',
  development: '开发',
  test: '测试',
};

const envText = computed(() => (env.value ? (ENV_TEXT[env.value] ?? env.value) : '—'));

/** oauthProviders 是聚合调试串，不对外展示。 */
const capabilities = computed(() => {
  const third = meta.value?.thirdParty ?? {};
  return Object.keys(CAP_LABELS)
    .filter((key) => key in third)
    .map((key) => {
      const raw = third[key] ?? 'off';
      return {
        key,
        label: CAP_LABELS[key] ?? key,
        on: raw !== 'off',
        value: CAP_VALUE_TEXT[raw] ?? raw,
      };
    });
});

onLoad(async () => {
  const info = uni.getSystemInfoSync();
  platform.value = `${info.uniPlatform} · ${info.osName ?? info.platform}`;
  const stored = uni.getStorageSync('mixmapp:lastLaunch') as { at?: string } | '';
  if (stored && stored.at) lastLaunch.value = new Date(stored.at).toLocaleString();
  try {
    const data = await metaApi.get();
    applyMetaFlags(data);
    applyMetaThirdParty(data);
    meta.value = data;
    // 版本只认构建期 APP_VERSION，不读服务端 meta.version，避免显示旧版串。
    env.value = data.env;
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
    linear-gradient(158deg, #0b0f0e 0%, #152622 62%, #17322c 120%);
  border-radius: $r-shell;
}

.brand-meta {
  display: flex;
  align-items: center;
  gap: $sp-3;
  margin-top: $sp-4;
}

.brand-ver {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $on-deep;
}

.brand-env {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $acc-on-deep-2;
}

.brand-lede {
  display: block;
  margin-top: $sp-3;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $on-deep-2;
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
  font-weight: 800;
  letter-spacing: $ls-tight;
  @include mx-gradient-text;
}

.block .rule {
  margin-top: $sp-3;
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
  font-size: $fs-micro;
  color: $ink-2;
}

.cap-val {
  margin-left: $sp-2;
  font-size: $fs-micro;
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
  font-size: $fs-micro;
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
  font-size: $fs-micro;
  color: $ink-3;
}

.v {
  flex: 1;
  font-size: $fs-micro;
  line-height: 1.5;
  color: $ink;
  text-align: right;
  word-break: break-all;
}

.v--mono {
  color: $ink-3;
}

.foot {
  display: block;
  margin-top: $sp-6;
  text-align: center;
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $ink-4;
}
</style>
