<template>
  <view class="page">
    <view class="head">
      <text class="eyebrow">ORDERS</text>
      <text class="title">我的订单</text>
      <text class="sub mono">{{ orders.length ? `${orders.length} RECORDS` : 'NO RECORDS' }}</text>
    </view>

    <view v-if="loading" class="loading">
      <view v-for="i in 2" :key="i" class="sheet ticket-sk">
        <view class="sk tk-head" />
        <view class="sk tk-line" />
        <view class="sk tk-line tk-short" />
      </view>
    </view>

    <view v-else-if="error" class="empty">
      <view class="empty-mark mono">!</view>
      <text class="empty-title">订单没打开</text>
      <text class="empty-sub">{{ error }}</text>
      <view class="btn btn--deep btn--sm retry" hover-class="is-press" @tap="load">重新加载</view>
    </view>

    <view v-else-if="orders.length === 0" class="empty">
      <view class="empty-mark">0</view>
      <text class="empty-title">还没有订单</text>
      <text class="empty-sub">下单后可在这里查看进度。</text>
      <view class="btn btn--deep empty-btn" hover-class="is-press" @tap="goMall">去商城</view>
    </view>

    <view v-else class="list">
      <view
        v-for="order in orders"
        :key="order.id"
        class="sheet ticket"
        :class="{ 'ticket--active': order.orderNo === highlight }"
      >
        <view class="ticket-head">
          <view class="tk-no-wrap">
            <text class="tk-no mono">{{ order.orderNo }}</text>
            <view class="tk-sub">
              <text class="tk-date mono">{{ dateText(order.createdAt) }}</text>
              <view v-if="order.orderNo === highlight" class="active-flag">
                <text class="active-flag-text mono">本次下单</text>
              </view>
            </view>
          </view>
          <text class="stamp tk-status" :class="`tk-status--${order.status}`">{{ statusText(order.status) }}</text>
        </view>

        <view class="perf">
          <view class="notch notch--l" />
          <view class="notch notch--r" />
        </view>

        <view class="items">
          <view v-for="item in order.items" :key="item.productId + item.title" class="item">
            <text class="item-title">{{ item.title }}</text>
            <text class="item-qty mono">×{{ item.quantity }}</text>
            <text class="item-price mono">¥{{ price(item.subtotalFen) }}</text>
          </view>
        </view>

        <view class="ticket-foot">
          <view class="receiver">
            <text class="receiver-name">{{ order.receiverName }}</text>
            <text class="receiver-phone mono">{{ maskPhone(order.receiverPhone) }}</text>
          </view>
          <view class="total-wrap">
            <text class="total-k mono">合计</text>
            <text class="total-v mono">¥{{ price(order.totalFen) }}</text>
          </view>
        </view>

        <text class="address">{{ order.address }}</text>
      </view>
    </view>

    <view v-if="orders.length" class="foot">
      <text class="micro mono">订单与库存以服务端为准 · 下拉刷新可重新加载</text>
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

function dateText(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  padding: 0 $sp-3 $sp-8;
}

.head {
  padding: $sp-5 4rpx $sp-4;
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

.sub {
  display: block;
  margin-top: 10rpx;
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: $ink-3;
}

/* ---------- 票据 ---------- */
.ticket {
  position: relative;
  overflow: hidden;
  padding: $sp-4 $sp-4 0;
  margin-bottom: $sp-3;
}

.ticket--active {
  border-color: rgba(15, 157, 143, 0.5);
}

.ticket-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.tk-no-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.tk-no {
  font-size: 24rpx;
  letter-spacing: 1rpx;
  color: $ink;
}

.tk-date {
  font-size: 20rpx;
  color: $ink-4;
}

.tk-sub {
  display: flex;
  align-items: center;
  margin-top: 6rpx;
}

.active-flag {
  margin-left: 12rpx;
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
  background: $brand;
}

.active-flag-text {
  font-size: 18rpx;
  letter-spacing: 1rpx;
  color: #ffffff;
}

.tk-status {
  margin-left: $sp-2;
  flex-shrink: 0;
}

.tk-status--pending {
  color: $amber;
}

.tk-status--paid {
  color: $brand-deep;
}

.tk-status--cancelled {
  color: $ink-4;
}

.perf {
  position: relative;
  height: 1rpx;
  margin: $sp-3 (-$sp-4);
  border-top: 1rpx dashed $paper-3;
}

.notch {
  position: absolute;
  top: -13rpx;
  width: 26rpx;
  height: 26rpx;
  border-radius: 50%;
  background: $paper;
}

.notch--l {
  left: -13rpx;
}

.notch--r {
  right: -13rpx;
}

.items {
  padding: 2rpx 0 $sp-2;
}

.item {
  display: flex;
  align-items: center;
  padding: 10rpx 0;
}

.item-title {
  flex: 1;
  font-size: 26rpx;
  color: $ink;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-qty {
  width: 80rpx;
  text-align: right;
  font-size: 20rpx;
  color: $ink-4;
}

.item-price {
  width: 140rpx;
  text-align: right;
  font-size: 26rpx;
  color: $ink-2;
}

.ticket-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-top: $sp-2;
  padding-top: $sp-3;
  border-top: 1rpx solid $paper-2;
}

.receiver {
  display: flex;
  flex-direction: column;
}

.receiver-name {
  font-size: 26rpx;
  color: $ink-2;
}

.receiver-phone {
  margin-top: 6rpx;
  font-size: 20rpx;
  color: $ink-4;
}

.total-wrap {
  display: flex;
  align-items: baseline;
}

.total-k {
  font-size: 20rpx;
  letter-spacing: 1rpx;
  color: $ink-4;
  margin-right: 8rpx;
}

.total-v {
  font-size: 32rpx;
  font-weight: 700;
  color: $ink;
}

.address {
  display: block;
  margin-top: $sp-2;
  padding-bottom: $sp-4;
  font-size: 22rpx;
  line-height: 1.6;
  color: $ink-3;
}

.active-flag {
  position: absolute;
  left: 0;
  top: 0;
  background: $brand;
  padding: 6rpx 16rpx;
  border-bottom-right-radius: 12rpx;
}

.active-flag-text {
  font-size: 18rpx;
  letter-spacing: 1rpx;
  color: #ffffff;
}

/* ---------- 骨架 / 空态 ---------- */
.ticket-sk {
  padding: $sp-4;
  margin-bottom: $sp-3;
  border-radius: $r-card;
}

.tk-head {
  height: 30rpx;
  width: 52%;
}

.tk-line {
  height: 24rpx;
  width: 82%;
  margin-top: 22rpx;
}

.tk-short {
  width: 40%;
  margin-top: 14rpx;
}

.retry {
  margin-top: $sp-4;
  padding: 0 40rpx;
}

.empty-btn {
  margin-top: $sp-5;
  width: 300rpx;
}

.foot {
  padding: $sp-3 0 $sp-6;
  text-align: center;
}
</style>
