<template>
  <view class="page">
    <view class="head">
      <view class="head-row">
        <view>
          <text class="title">MixmAPP 商城</text>
          <text class="sub">单码多端周边 · 首发限定</text>
        </view>
        <view class="cart-btn" hover-class="pressed" @tap="goCart">
          <text class="cart-icon">🛒</text>
          <text class="cart-text">购物车</text>
        </view>
      </view>

      <view class="search">
        <input
          v-model="keyword"
          class="search-input"
          placeholder="搜商品，如 充电器 / 礼盒"
          confirm-type="search"
          @confirm="load"
        />
        <view class="search-go" hover-class="pressed" @tap="load">搜索</view>
      </view>

      <scroll-view scroll-x class="tabs">
        <view
          v-for="item in categories"
          :key="item.key"
          class="tab"
          :class="{ 'tab--active': active === item.key }"
          @tap="switchCategory(item.key)"
        >
          {{ item.label }}
        </view>
      </scroll-view>
    </view>

    <view v-if="loading" class="hint center">加载中…</view>
    <view v-else-if="error" class="hint center">
      <text>{{ error }}</text>
      <view class="retry" hover-class="pressed" @tap="load">重新加载</view>
    </view>
    <view v-else-if="products.length === 0" class="hint center">暂无商品</view>

    <view v-else class="list">
      <view
        v-for="product in products"
        :key="product.id"
        class="card product"
        hover-class="pressed"
        @tap="openDetail(product)"
      >
        <view class="cover" :style="{ backgroundColor: product.cover }">
          <text class="cover-char">{{ product.title.slice(0, 1) }}</text>
        </view>
        <view class="info">
          <text class="name">{{ product.title }}</text>
          <text class="desc">{{ product.subtitle }}</text>
          <view class="tags">
            <text v-for="tag in product.tags" :key="tag" class="tag">{{ tag }}</text>
          </view>
          <view class="price-row">
            <text class="price">¥{{ price(product.priceFen) }}</text>
            <text v-if="product.originalPriceFen > 0" class="price-old">¥{{ price(product.originalPriceFen) }}</text>
            <text class="stock">库存 {{ product.stock }}</text>
          </view>
        </view>
        <view class="add" hover-class="pressed" @tap.stop="addToCart(product)">加购</view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import type { ProductDto } from '@mixmapp/contracts';
import { mallApi } from '../../api/client';

const categories = [
  { key: '', label: '全部' },
  { key: 'featured', label: '精选' },
  { key: 'digital', label: '数码' },
  { key: 'life', label: '生活' },
  { key: 'wear', label: '穿搭' },
];

const active = ref('');
const keyword = ref('');
const products = ref<ProductDto[]>([]);
const loading = ref(false);
const error = ref('');

function price(fen: number): string {
  return (fen / 100).toFixed(2);
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    products.value = await mallApi.listProducts({
      category: active.value || undefined,
      keyword: keyword.value.trim() || undefined,
      pageSize: 50,
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '商品加载失败';
  } finally {
    loading.value = false;
  }
}

function switchCategory(key: string): void {
  active.value = key;
  void load();
}

function openDetail(product: ProductDto): void {
  uni.navigateTo({ url: `/pages/mall/detail?id=${encodeURIComponent(product.id)}` });
}

function goCart(): void {
  uni.navigateTo({ url: '/pages/cart/index' });
}

async function addToCart(product: ProductDto): Promise<void> {
  try {
    await mallApi.addToCart(product.id, 1);
    uni.showToast({ title: '已加入购物车', icon: 'success' });
  } catch (e) {
    const message = e instanceof Error ? e.message : '加入购物车失败';
    if (message.includes('登录')) {
      uni.navigateTo({ url: '/pages/auth/login' });
      return;
    }
    uni.showToast({ title: message, icon: 'none' });
  }
}

onShow(() => {
  void load();
});
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: #f6f7f9;
  padding-bottom: 40rpx;
}
.head {
  padding: 32rpx 32rpx 8rpx;
  background: linear-gradient(160deg, #0f9d8f 0%, #0b7a70 100%);
  border-bottom-left-radius: 32rpx;
  border-bottom-right-radius: 32rpx;
}
.head-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.title {
  display: block;
  font-size: 40rpx;
  font-weight: 700;
  color: #ffffff;
}
.sub {
  display: block;
  margin-top: 6rpx;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.82);
}
.cart-btn {
  display: flex;
  align-items: center;
  padding: 10rpx 18rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.16);
}
.cart-text {
  margin-left: 8rpx;
  font-size: 24rpx;
  color: #ffffff;
}
.cart-icon {
  font-size: 28rpx;
}
.search {
  display: flex;
  align-items: center;
  margin-top: 24rpx;
  background: #ffffff;
  border-radius: 999rpx;
  padding: 8rpx 8rpx 8rpx 24rpx;
}
.search-input {
  flex: 1;
  font-size: 26rpx;
  height: 56rpx;
}
.search-go {
  padding: 10rpx 28rpx;
  border-radius: 999rpx;
  background: #0f9d8f;
  color: #ffffff;
  font-size: 24rpx;
}
.tabs {
  margin-top: 22rpx;
  white-space: nowrap;
}
.tab {
  display: inline-block;
  padding: 10rpx 24rpx;
  margin-right: 14rpx;
  border-radius: 999rpx;
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.14);
}
.tab--active {
  background: #ffffff;
  color: #0b7a70;
  font-weight: 600;
}
.list {
  padding: 24rpx 24rpx 0;
}
.card {
  background: #ffffff;
  border-radius: 24rpx;
  box-shadow: 0 8rpx 24rpx rgba(15, 23, 42, 0.06);
}
.product {
  display: flex;
  padding: 24rpx;
  margin-bottom: 22rpx;
  align-items: center;
}
.cover {
  width: 168rpx;
  height: 168rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.cover-char {
  color: #ffffff;
  font-size: 56rpx;
  font-weight: 700;
  opacity: 0.9;
}
.info {
  flex: 1;
  margin-left: 22rpx;
}
.name {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: #0f172a;
}
.desc {
  display: block;
  margin-top: 6rpx;
  font-size: 24rpx;
  color: #64748b;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  margin-top: 10rpx;
}
.tag {
  margin-right: 10rpx;
  padding: 2rpx 12rpx;
  border-radius: 8rpx;
  background: #eef6f4;
  color: #0b7a70;
  font-size: 20rpx;
}
.price-row {
  display: flex;
  align-items: baseline;
  margin-top: 12rpx;
}
.price {
  font-size: 32rpx;
  font-weight: 700;
  color: #d92d20;
}
.price-old {
  margin-left: 10rpx;
  font-size: 22rpx;
  color: #94a3b8;
  text-decoration: line-through;
}
.stock {
  margin-left: auto;
  font-size: 22rpx;
  color: #94a3b8;
}
.add {
  margin-left: 16rpx;
  padding: 14rpx 22rpx;
  border-radius: 999rpx;
  background: #0f9d8f;
  color: #ffffff;
  font-size: 24rpx;
  flex-shrink: 0;
}
.hint {
  display: block;
  padding: 60rpx 32rpx;
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
