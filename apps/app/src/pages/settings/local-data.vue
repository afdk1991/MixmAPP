<template>
  <view class="page">
    <mx-bar title="本机数据" />

    <view class="sheet block">
      <text class="eyebrow">LOCAL DATA</text>
      <text class="block-title">本机存储自助清理</text>
      <text class="block-lede">
        本页只读取与清理本机保存的数据，不请求网络；占用按字符串长度估算，与系统实际占用可能存在偏差。
      </text>
      <view class="rule" />
      <text class="hint note">清理「登录态」后需要重新登录；清理「隐私同意记录」后，下次注册或相关流程会重新征得同意。</text>
    </view>

    <view v-for="cat in categories" :key="cat.key" class="sheet block">
      <view class="cat-head">
        <view class="cat-head-left">
          <text class="cat-title">{{ cat.label }}</text>
          <text class="cat-desc">{{ cat.description }}</text>
        </view>
        <text class="cat-meta mono">{{ cat.count }} 项 · 估算 {{ formatBytes(cat.bytes) }}</text>
      </view>

      <view v-if="cat.items.length" class="item-list">
        <view v-for="item in cat.items" :key="`${cat.key}-${item.label}`" class="item">
          <view class="item-left">
            <text class="item-label">{{ item.label }}</text>
            <text class="item-channel mono">{{ channelLabel(item.channel) }}</text>
          </view>
          <text class="item-size mono">{{ formatBytes(item.bytes) }}</text>
        </view>
      </view>
      <text v-else class="hint empty">暂无本机记录。</text>

      <text class="cat-consequence">{{ cat.consequence }}</text>

      <view class="cat-actions">
        <view
          class="btn btn--ghost btn--sm"
          :class="{ 'btn--disabled': cat.count === 0 }"
          hover-class="is-press"
          @tap="askClearCategory(cat)"
        >
          <text class="btn-text">清理本类</text>
        </view>
      </view>
    </view>

    <view class="sheet block danger-block">
      <text class="block-title">一键清空本机数据</text>
      <text class="block-lede">清除上面全部分类在本机保存的记录；服务端账号与订单数据不受影响。</text>
      <view class="rule" />
      <view
        class="btn btn--deep btn--block"
        :class="{ 'btn--disabled': totalCount === 0 }"
        hover-class="is-press"
        @tap="askClearAll"
      >
        <text class="submit-text">一键清空</text>
      </view>
    </view>

    <text class="foot mono">© 2026 MIXMAPP</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import {
  STORAGE_CATEGORY_META,
  STORAGE_CATEGORY_ORDER,
  clearCategory,
  formatBytes,
  scanStorage,
  type StorageCategoryKey,
  type StorageChannel,
  type StorageItemStat,
} from '../../storage-map';
import { clearTokens } from '../../api/client';
import { session } from '../../stores/session';
import MxBar from '../../components/mx-bar/mx-bar.vue';

type CategoryView = {
  key: StorageCategoryKey;
  label: string;
  description: string;
  consequence: string;
  count: number;
  bytes: number;
  items: { label: string; channel: StorageChannel; bytes: number }[];
};

const stats = ref<StorageItemStat[]>([]);

const CHANNEL_LABEL: Record<StorageChannel, string> = {
  uni: '本机存储',
  local: '网页存储',
  preferences: '原生偏好',
};

function channelLabel(channel: StorageChannel): string {
  return CHANNEL_LABEL[channel];
}

/** 同一 key 在多通道落盘时按条目合并计数，避免一次记录重复累加。 */
const categories = computed<CategoryView[]>(() => {
  const byCategory = new Map<StorageCategoryKey, Map<string, { channel: StorageChannel; bytes: number }>>();
  for (const stat of stats.value) {
    if (!stat.exists) continue;
    const bucket = byCategory.get(stat.entry.category) ?? new Map();
    const prev = bucket.get(stat.entry.label) ?? { channel: stat.channel, bytes: 0 };
    prev.bytes += stat.bytes;
    bucket.set(stat.entry.label, prev);
    byCategory.set(stat.entry.category, bucket);
  }

  return STORAGE_CATEGORY_ORDER.map((key) => {
    const meta = STORAGE_CATEGORY_META[key];
    const bucket = byCategory.get(key) ?? new Map();
    const items = [...bucket.entries()].map(([label, item]) => ({ label, ...item }));
    const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
    return {
      key,
      label: meta.label,
      description: meta.description,
      consequence: meta.consequence,
      count: items.length,
      bytes,
      items,
    };
  });
});

const totalCount = computed(() => categories.value.reduce((sum, cat) => sum + cat.count, 0));

async function refresh(): Promise<void> {
  stats.value = await scanStorage();
}

onShow(() => {
  void refresh();
});

/** 清理登录态后同步重置内存会话，避免页面仍持有已失效的账号资料。 */
function resetLocalSession(): void {
  clearTokens();
  uni.removeStorageSync('mixmapp:user');
  uni.removeStorageSync('mixmapp:adminToken');
  session.user = null;
  session.accessToken = null;
}

function askClearCategory(cat: CategoryView): void {
  if (cat.count === 0) return;
  uni.showModal({
    title: `清理「${cat.label}」`,
    content: cat.consequence,
    cancelText: '取消',
    confirmText: '清理',
    success: (res) => {
      if (!res.confirm) return;
      clearCategory(cat.key);
      if (cat.key === 'auth') resetLocalSession();
      void refresh();
      uni.showToast({ title: '已清理', icon: 'none' });
    },
  });
}

function askClearAll(): void {
  if (totalCount.value === 0) return;
  uni.showModal({
    title: '一键清空本机数据',
    content: '将清除登录态、隐私同意记录及其它本机保存的数据；清理后需要重新登录，服务端账号与订单不受影响。',
    cancelText: '取消',
    confirmText: '全部清空',
    success: (res) => {
      if (!res.confirm) return;
      for (const key of STORAGE_CATEGORY_ORDER) clearCategory(key);
      resetLocalSession();
      void refresh();
      uni.showToast({ title: '本机数据已清空', icon: 'none' });
    },
  });
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  padding: $sp-4 $sp-3 calc($sp-8 + var(--mx-safe-bottom));
}

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

.block-lede {
  display: block;
  margin-top: 10rpx;
  font-size: $fs-meta;
  line-height: 1.6;
  color: $ink-3;
}

.block .rule {
  margin-top: $sp-3;
}

.note {
  margin-top: 12rpx;
}

.cat-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $sp-3;
}

.cat-head-left {
  flex: 1;
  min-width: 0;
}

.cat-title {
  display: block;
  font-size: $fs-meta;
  font-weight: 600;
  color: $ink;
}

.cat-desc {
  display: block;
  margin-top: 8rpx;
  font-size: $fs-micro;
  line-height: 1.6;
  color: $ink-3;
}

.cat-meta {
  flex-shrink: 0;
  font-size: $fs-micro;
  color: $ink-3;
  text-align: right;
}

.item-list {
  margin-top: $sp-3;
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 0;
  border-bottom: 1rpx solid $paper-2;
}

.item:last-child {
  border-bottom: none;
}

.item-left {
  flex: 1;
  min-width: 0;
}

.item-label {
  display: block;
  font-size: $fs-micro;
  color: $ink-2;
}

.item-channel {
  display: block;
  margin-top: 4rpx;
  font-size: $fs-micro;
  color: $ink-4;
}

.item-size {
  flex-shrink: 0;
  margin-left: $sp-2;
  font-size: $fs-micro;
  color: $ink-3;
}

.empty {
  margin-top: $sp-3;
}

.cat-consequence {
  display: block;
  margin-top: $sp-2;
  font-size: $fs-micro;
  line-height: 1.6;
  color: $ink-3;
}

.cat-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: $sp-3;
}

.danger-block {
  margin-top: $sp-4;
}

.submit-text {
  font-size: $fs-body;
  font-weight: 800;
  letter-spacing: 2rpx;
  color: $on-solid;
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
