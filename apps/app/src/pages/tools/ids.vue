<template>
  <view class="page">
    <view class="head">
      <text class="title">ID 试算器</text>
      <text class="hint">同一个发号器同时产出主键、雪花数值、MixmAPP 号码、ULID 与 UUIDv7；主键形态由服务端 ID_STRATEGY 决定。</text>
    </view>

    <view class="seg">
      <view
        v-for="s in strategies"
        :key="s.key"
        class="seg-item"
        :class="{ 'seg-item--on': strategy === s.key }"
        @tap="strategy = s.key"
      >
        {{ s.name }}
      </view>
    </view>

    <view class="card">
      <view class="btn btn--primary" :class="{ 'btn--disabled': loading }" @tap="generate">
        {{ loading ? '生成中…' : '生成一个 ID' }}
      </view>

      <view v-if="error" class="error">{{ error }}</view>

      <block v-if="result">
        <view class="result-block">
          <text class="result-label">MixmAPP 号码（对外展示）</text>
          <view class="row">
            <text class="result-mono mono">{{ result.accountNo }}</text>
            <text class="copy" @tap="copy(result.accountNo)">复制</text>
          </view>
        </view>
        <view class="result-block">
          <text class="result-label">主键（{{ strategy }}）</text>
          <text class="result-value mono">{{ result.id }}</text>
        </view>
        <view class="result-block">
          <text class="result-label">雪花数值（分片/排查用）</text>
          <text class="result-value mono">{{ result.snowflake }}</text>
        </view>
        <view class="result-block">
          <text class="result-label">ULID</text>
          <text class="result-value mono">{{ result.ulid }}</text>
        </view>
        <view class="result-block last">
          <text class="result-label">UUIDv7</text>
          <text class="result-value mono">{{ result.uuidV7 }}</text>
        </view>
      </block>
    </view>

    <view class="card explain">
      <text class="section">三套策略怎么选</text>
      <view v-for="s in strategies" :key="s.key" class="explain-row">
        <text class="explain-name">{{ s.name }}</text>
        <text class="explain-desc">{{ s.desc }}</text>
      </view>
    </view>
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
  padding: 32rpx;
}

.title {
  display: block;
  font-size: 44rpx;
  font-weight: 700;
}

.hint {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #94a3b8;
  line-height: 1.6;
}

.seg {
  display: flex;
  background: #eef1f5;
  border-radius: 999rpx;
  padding: 6rpx;
  margin: 28rpx 0 24rpx;
}

.seg-item {
  flex: 1;
  text-align: center;
  padding: 18rpx 0;
  font-size: 26rpx;
  color: #475569;
  border-radius: 999rpx;
}

.seg-item--on {
  background: #ffffff;
  color: #0b1220;
  font-weight: 600;
}

.error {
  margin-top: 20rpx;
  font-size: 24rpx;
  color: #dc2626;
}

.result-block {
  margin-top: 30rpx;
  padding-bottom: 22rpx;
  border-bottom: 1rpx solid #f1f5f9;
}

.result-block.last {
  border-bottom: none;
  padding-bottom: 0;
}

.result-label {
  display: block;
  font-size: 22rpx;
  color: #94a3b8;
  margin-bottom: 10rpx;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.result-mono {
  font-size: 38rpx;
  font-weight: 700;
  color: #0b1220;
  letter-spacing: 0.5rpx;
}

.result-value {
  display: block;
  font-size: 24rpx;
  color: #334155;
  word-break: break-all;
  line-height: 1.5;
}

.copy {
  font-size: 22rpx;
  color: #0f9d8f;
}

.section {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  margin-bottom: 18rpx;
}

.explain {
  margin-top: 24rpx;
}

.explain-row {
  padding: 16rpx 0;
  border-bottom: 1rpx dashed #e2e8f0;
}

.explain-row:last-child {
  border-bottom: none;
}

.explain-name {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  margin-bottom: 6rpx;
}

.explain-desc {
  display: block;
  font-size: 23rpx;
  color: #64748b;
  line-height: 1.6;
}
</style>
