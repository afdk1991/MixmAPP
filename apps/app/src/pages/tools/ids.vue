<template>
  <view class="page">
    <view class="head">
      <text class="eyebrow">ID FORGE</text>
      <text class="title">ID 试算器</text>
      <text class="hint">同一个发号器同时产出主键、雪花数值、MixmAPP 号码、ULID 与 UUIDv7；主键形态由服务端 ID_STRATEGY 决定。</text>
    </view>

    <view class="seg">
      <view
        v-for="s in strategies"
        :key="s.key"
        class="seg-item"
        :class="{ 'seg-item--on': strategy === s.key }"
        hover-class="is-press"
        @tap="strategy = s.key"
      >
        <text class="seg-label">{{ s.name }}</text>
      </view>
    </view>

    <view class="sheet panel">
      <view class="gen-row">
        <view class="gen-text">
          <text class="gen-k mono">GENERATE</text>
          <text class="gen-title">发一个号</text>
        </view>
        <view
          class="gen-btn"
          :class="{ 'btn--disabled': loading }"
          hover-class="is-press"
          @tap="generate"
        >
          <text class="gen-btn-text mono">{{ loading ? '…' : '→' }}</text>
        </view>
      </view>
      <text class="gen-note mono">{{ loading ? '正在向服务端取号' : `当前策略 · ${strategy}` }}</text>

      <view v-if="error" class="error-row">
        <text class="error-mark mono">!</text>
        <text class="error-text">{{ error }}</text>
      </view>

      <block v-if="result">
        <view class="result">
          <view class="result-head">
            <text class="result-k mono">MIXMAPP 号码 / 对外展示</text>
            <view class="copy" hover-class="is-press" @tap="copy(result.accountNo)">
              <text class="copy-text mono">复制</text>
            </view>
          </view>
          <text class="account mono">{{ result.accountNo }}</text>
        </view>

        <view class="kv">
          <text class="kv-k mono">主键 · {{ strategy }}</text>
          <text class="kv-v mono">{{ result.id }}</text>
        </view>
        <view v-if="result.snowflake !== result.id" class="kv">
          <text class="kv-k mono">雪花数值 · 分片/排查</text>
          <text class="kv-v mono">{{ result.snowflake }}</text>
        </view>
        <view class="kv">
          <text class="kv-k mono">ULID</text>
          <text class="kv-v mono">{{ result.ulid }}</text>
        </view>
        <view class="kv kv--last">
          <text class="kv-k mono">UUIDv7</text>
          <text class="kv-v mono">{{ result.uuidV7 }}</text>
        </view>
      </block>

      <view v-else class="placeholder">
        <text class="placeholder-mark mono">∅</text>
        <text class="placeholder-text mono">NO OUTPUT YET</text>
        <text class="placeholder-hint">选择策略后点「发一个号」，结果会落在这里。</text>
      </view>
    </view>

    <view class="sheet explain">
      <text class="eyebrow">STRATEGIES</text>
      <text class="explain-title">三套策略怎么选</text>
      <view v-for="(s, i) in strategies" :key="s.key" class="explain-row" :class="{ 'explain-row--last': i === strategies.length - 1 }">
        <text class="explain-name">{{ s.name }}</text>
        <text class="explain-desc">{{ s.desc }}</text>
      </view>
    </view>

    <text class="foot mono">MIXMAPP · ID STRATEGY</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { idsApi, ApiError } from '../../api/client';

type Strategy = 'snowflake' | 'ulid' | 'uuidv7';

const strategy = ref<Strategy>('snowflake');
const loading = ref(false);
const error = ref('');
const result = ref<{
  id: string;
  snowflake: string;
  accountNo: string;
  ulid: string;
  uuidV7: string;
} | null>(null);

const strategies: Array<{ key: Strategy; name: string; desc: string }> = [
  {
    key: 'snowflake',
    name: '雪花',
    desc: '41 位时间 + 10 位机器 + 12 位序列，离线发号、单调递增，最适合自托管多实例。',
  },
  {
    key: 'ulid',
    name: 'ULID',
    desc: '26 位 Crockford Base32，时间前缀可排序，无中心依赖，适合多端并发注册。',
  },
  {
    key: 'uuidv7',
    name: 'UUIDv7',
    desc: '标准 UUID 格式且时间有序，适合对外 API 与第三方系统互操作。',
  },
];

async function generate(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  try {
    result.value = await idsApi.preview(strategy.value);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '生成失败';
  } finally {
    loading.value = false;
  }
}

function copy(text: string): void {
  uni.setClipboardData({
    data: text,
    success: () => uni.showToast({ title: '已复制', icon: 'success' }),
  });
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  padding: $sp-5 $sp-4 $sp-8;
}

.head {
  margin-bottom: $sp-4;
}

.title {
  display: block;
  margin-top: 16rpx;
  font-family: $font-display;
  font-size: $fs-h1;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 1rpx;
  color: $ink;
}

.head .hint {
  margin-top: 14rpx;
}

/* ---------- 策略切换 ---------- */
.seg {
  display: flex;
  padding: 8rpx;
  background: $paper-2;
  border-radius: $r-pill;
  margin-bottom: $sp-4;
}

.seg-item {
  flex: 1;
  height: 76rpx;
  border-radius: $r-pill;
  display: flex;
  align-items: center;
  justify-content: center;
}

.seg-item--on {
  background: $ink;
  box-shadow: 0 10rpx 24rpx -14rpx rgba(13, 25, 23, 0.5);
}

.seg-label {
  font-size: 26rpx;
  letter-spacing: 0.5rpx;
  color: $ink-2;
}

.seg-item--on .seg-label {
  color: #f4f8f6;
  font-weight: 600;
}

/* ---------- 发号台 ---------- */
.panel {
  padding: $sp-4;
}

.gen-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.gen-k {
  display: block;
  font-size: 20rpx;
  letter-spacing: 3rpx;
  color: $ink-4;
}

.gen-title {
  display: block;
  margin-top: 8rpx;
  font-family: $font-display;
  font-size: 40rpx;
  font-weight: 600;
  color: $ink;
}

.gen-btn {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: $ink;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 12rpx 28rpx -12rpx rgba(13, 25, 23, 0.55);
}

.gen-btn-text {
  font-size: 34rpx;
  color: #f4f8f6;
}

.gen-note {
  display: block;
  margin-top: 12rpx;
  font-size: 20rpx;
  letter-spacing: 1rpx;
  color: $ink-4;
}

.error-row {
  display: flex;
  align-items: flex-start;
  margin-top: $sp-3;
}

.error-mark {
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  background: $signal;
  color: #ffffff;
  font-size: 20rpx;
  line-height: 32rpx;
  text-align: center;
  margin-right: 12rpx;
}

.error-text {
  flex: 1;
  font-size: $fs-meta;
  color: $signal;
}

/* ---------- 结果 ---------- */
.result {
  margin-top: $sp-4;
  padding: $sp-4;
  background: #f7faf8;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
}

.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.result-k {
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: $ink-3;
}

.copy {
  height: 48rpx;
  padding: 0 18rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-pill;
  display: flex;
  align-items: center;
}

.copy-text {
  font-size: 20rpx;
  color: $brand-deep;
}

.account {
  display: block;
  margin-top: 12rpx;
  font-size: 32rpx;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0;
  color: $ink;
  word-break: break-all;
}

.kv {
  padding: $sp-3 0;
  border-top: 1rpx solid $paper-2;
}

.kv--last {
  padding-bottom: 0;
}

.kv-k {
  display: block;
  font-size: 20rpx;
  letter-spacing: 1rpx;
  color: $ink-4;
}

.kv-v {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: $ink-2;
  word-break: break-all;
}

.placeholder {
  margin-top: $sp-4;
  padding: $sp-6 $sp-3;
  border: 1rpx dashed $paper-3;
  border-radius: $r-control;
  text-align: center;
}

.placeholder-mark {
  display: block;
  font-size: 40rpx;
  color: $ink-4;
}

.placeholder-text {
  display: block;
  margin-top: 10rpx;
  font-size: 20rpx;
  letter-spacing: 3rpx;
  color: $ink-4;
}

.placeholder-hint {
  display: block;
  margin-top: 12rpx;
  font-size: $fs-micro;
  color: $ink-3;
}

/* ---------- 说明 ---------- */
.explain {
  margin-top: $sp-3;
  padding: $sp-4;
}

.explain-title {
  display: block;
  margin-top: 12rpx;
  font-family: $font-display;
  font-size: $fs-h2;
  font-weight: 600;
  color: $ink;
}

.explain-row {
  padding: $sp-3 0;
  border-bottom: 1rpx solid $paper-2;
}

.explain-row--last {
  border-bottom: none;
  padding-bottom: 0;
}

.explain-name {
  display: block;
  font-family: $font-display;
  font-size: 30rpx;
  font-weight: 600;
  color: $ink;
}

.explain-desc {
  display: block;
  margin-top: 8rpx;
  font-size: $fs-micro;
  line-height: 1.7;
  color: $ink-3;
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
