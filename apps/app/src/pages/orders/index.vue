<template>
  <view class="page">
    <view v-if="loading" class="hint center">加载中…</view>
    <view v-else-if="error" class="hint center">
      <text>{{ error }}</text>
      <view class="retry" hover-class="pressed" @tap="load">重新加载</view>
    </view>
    <view v-else-if="orders.length === 0" class="empty">
      <text class="empty-title">还没有订单</text>
      <text class="empty-sub">下单后可在这里查看进度</text>
      <view class="empty-btn" hover-class="pressed" @tap="goMall">去商城</view>
    </view>

    <view v-else class="list">
      <view
        v-for="order in orders"
        :key="order.id"
        class="card order"
        :class="{ 'order--active': order.orderNo === highlight }"
      >
        <view class="order-head">
          <text class="order-no">{{ order.orderNo }}</text>
          <text class="status" :class="`status--${order.status}`">{{ statusText(order.status) }}</text>
        </view>
        <view class="items">
          <view v-for="item in order.items" :key="item.productId + item.title" class="item">
            <text class="item-title">{{ item.title }}</text>
            <text class="item-meta">× {{ item.quantity }}</text>
            <text class="item-price">¥{{ price(item.subtotalFen) }}</text>
          </view>
        </view>
        <view class="order-foot">
          <text class="receiver">{{ order.receiverName }} · {{ maskPhone(order.receiverPhone) }}</text>
          <text class="total">合计 ¥{{ price(order.totalFen) }}</text>
        </view>
        <text class="address">{{ order.address }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import type { OrderDto } from '@mixmapp/contracts';
import { mallApi } from '../../api/client';

const orders = ref<OrderDto[]>([]);
const loading = ref(false);
const error = ref('');
const highlight = ref('');

function price(fen: number): string {
  return (fen / 100).toFixed(2);
}

function maskPhone(phone: string): string {
  return phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone;
}

function statusText(status: OrderDto['status']): string {
  return { pending: '待支付', paid: '已支付', cancelled: '已取消' }[status];
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    orders.value = await mallApi.listOrders();
  } catch (e) {
    const message = e instanceof Error ? e.message : '订单加载失败';
    if (message.includes('登录')) {
      uni.navigateTo({ url: '/pages/auth/login' });
      return;
    }
    error.value = message;
  } finally {
    loading.value = false;
  }
}

function goMall(): void {
  uni.navigateTo({ url: '/pages/mall/index' });
}

onLoad((options) => {
  highlight.value = (options?.['orderNo'] as string | undefined) ?? '';
  void load();
});
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: #f6f7f9;
  padding: 24rpx;
}
.card {
  background: #ffffff;
  border-radius: 24rpx;
  box-shadow: 0 8rpx 24rpx rgba(15, 23, 42, 0.06);
}
.order {
  padding: 26rpx;
  margin-bottom: 22rpx;
  border: 2rpx solid transparent;
}
.order--active {
  border-color: #0f9d8f;
}
.order-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.order-no {
  font-size: 24rpx;
  color: #64748b;
  font-family: monospace;
}
.status {
  font-size: 24rpx;
  font-weight: 600;
}
.status--pending {
  color: #d97706;
}
.status--paid {
  color: #0f9d8f;
}
.status--cancelled {
  color: #94a3b8;
}
.items {
  margin-top: 16rpx;
  border-top: 1rpx solid #eef2f6;
  border-bottom: 1rpx solid #eef2f6;
  padding: 12rpx 0;
}
.item {
  display: flex;
  align-items: center;
  padding: 8rpx 0;
}
.item-title {
  flex: 1;
  font-size: 26rpx;
  color: #0f172a;
}
.item-meta {
  width: 90rpx;
  text-align: right;
  font-size: 22rpx;
  color: #94a3b8;
}
.item-price {
  width: 150rpx;
  text-align: right;
  font-size: 26rpx;
  color: #475569;
}
.order-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 16rpx;
}
.receiver {
  font-size: 24rpx;
  color: #64748b;
}
.total {
  font-size: 28rpx;
  font-weight: 700;
  color: #d92d20;
}
.address {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #94a3b8;
}
.empty {
  padding: 140rpx 40rpx;
  text-align: center;
}
.empty-title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: #0f172a;
}
.empty-sub {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  color: #94a3b8;
}
.empty-btn {
  margin: 32rpx auto 0;
  width: 240rpx;
  padding: 16rpx 0;
  border-radius: 999rpx;
  background: #0f9d8f;
  color: #ffffff;
  font-size: 26rpx;
}
.hint {
  display: block;
  padding: 120rpx 32rpx;
  color: #64748b;
  font-size: 26rpx;
}
.center {
  text-align: center;
}
.retry {
  margin: 24rpx auto 0;
  width: 220rpx;
  padding: 14rpx 0;
  border-radius: 999rpx;
  background: #0f9d8f;
  color: #ffffff;
  font-size: 26rpx;
}
.pressed {
  opacity: 0.82;
}
</style>
