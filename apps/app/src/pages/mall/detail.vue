<template>
  <view class="page">
    <view v-if="loading" class="hint center">加载中…</view>
    <view v-else-if="error" class="hint center">
      <text>{{ error }}</text>
      <view class="retry" hover-class="pressed" @tap="load">重新加载</view>
    </view>

    <block v-else-if="product">
      <view class="hero" :style="{ backgroundColor: product.cover }">
        <text class="hero-char">{{ product.title.slice(0, 1) }}</text>
        <view class="hero-badge">{{ product.category }}</view>
      </view>

      <view class="body">
        <text class="title">{{ product.title }}</text>
        <text class="subtitle">{{ product.subtitle }}</text>

        <view class="price-row">
          <text class="price">¥{{ price(product.priceFen) }}</text>
          <text v-if="product.originalPriceFen > 0" class="price-old">¥{{ price(product.originalPriceFen) }}</text>
          <text class="stock">库存 {{ product.stock }}</text>
        </view>

        <view class="tags">
          <text v-for="tag in product.tags" :key="tag" class="tag">{{ tag }}</text>
        </view>

        <view class="card section">
          <text class="section-title">商品说明</text>
          <text class="desc">{{ product.description }}</text>
        </view>

        <view class="card section">
          <text class="section-title">购买数量</text>
          <view class="stepper">
            <view class="step" hover-class="pressed" @tap="dec">−</view>
            <text class="count">{{ quantity }}</text>
            <view class="step" hover-class="pressed" @tap="inc">+</view>
          </view>
        </view>
      </view>

      <view class="bar">
        <view class="bar-total">
          <text class="bar-label">合计</text>
          <text class="bar-price">¥{{ price(product.priceFen * quantity) }}</text>
        </view>
        <view class="bar-btn ghost" hover-class="pressed" @tap="addToCart">加入购物车</view>
        <view class="bar-btn" hover-class="pressed" @tap="buyNow">立即购买</view>
      </view>
    </block>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import type { ProductDto } from '@mixmapp/contracts';
import { mallApi } from '../../api/client';

const product = ref<ProductDto | null>(null);
const productId = ref('');
const quantity = ref(1);
const loading = ref(false);
const error = ref('');

function price(fen: number): string {
  return (fen / 100).toFixed(2);
}

async function load(): Promise<void> {
  if (!productId.value) return;
  loading.value = true;
  error.value = '';
  try {
    product.value = await mallApi.getProduct(productId.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '商品加载失败';
  } finally {
    loading.value = false;
  }
}

function inc(): void {
  if (!product.value) return;
  if (quantity.value >= Math.min(99, product.value.stock)) {
    uni.showToast({ title: '已达可购上限', icon: 'none' });
    return;
  }
  quantity.value += 1;
}

function dec(): void {
  if (quantity.value <= 1) return;
  quantity.value -= 1;
}

async function addToCart(): Promise<void> {
  try {
    await mallApi.addToCart(productId.value, quantity.value);
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

async function buyNow(): Promise<void> {
  try {
    await mallApi.addToCart(productId.value, quantity.value);
    uni.navigateTo({ url: '/pages/cart/index' });
  } catch (e) {
    const message = e instanceof Error ? e.message : '操作失败';
    if (message.includes('登录')) {
      uni.navigateTo({ url: '/pages/auth/login' });
      return;
    }
    uni.showToast({ title: message, icon: 'none' });
  }
}

onLoad((options) => {
  productId.value = (options?.['id'] as string | undefined) ?? '';
  void load();
});
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: #f6f7f9;
  padding-bottom: 180rpx;
}
.hero {
  height: 420rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.hero-char {
  color: #ffffff;
  font-size: 140rpx;
  font-weight: 700;
  opacity: 0.9;
}
.hero-badge {
  position: absolute;
  left: 32rpx;
  bottom: 28rpx;
  padding: 6rpx 20rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.2);
  color: #ffffff;
  font-size: 22rpx;
}
.body {
  padding: 28rpx 32rpx 0;
}
.title {
  display: block;
  font-size: 38rpx;
  font-weight: 700;
  color: #0f172a;
}
.subtitle {
  display: block;
  margin-top: 8rpx;
  font-size: 26rpx;
  color: #64748b;
}
.price-row {
  display: flex;
  align-items: baseline;
  margin-top: 18rpx;
}
.price {
  font-size: 44rpx;
  font-weight: 700;
  color: #d92d20;
}
.price-old {
  margin-left: 12rpx;
  font-size: 24rpx;
  color: #94a3b8;
  text-decoration: line-through;
}
.stock {
  margin-left: auto;
  font-size: 24rpx;
  color: #94a3b8;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  margin-top: 14rpx;
}
.tag {
  margin-right: 12rpx;
  padding: 4rpx 14rpx;
  border-radius: 8rpx;
  background: #eef6f4;
  color: #0b7a70;
  font-size: 22rpx;
}
.card {
  background: #ffffff;
  border-radius: 24rpx;
}
.section {
  margin-top: 24rpx;
  padding: 26rpx;
}
.section-title {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: #0f172a;
}
.desc {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  line-height: 1.7;
  color: #475569;
}
.stepper {
  display: flex;
  align-items: center;
  margin-top: 18rpx;
}
.step {
  width: 64rpx;
  height: 64rpx;
  border-radius: 16rpx;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  color: #0f172a;
}
.count {
  width: 96rpx;
  text-align: center;
  font-size: 28rpx;
  color: #0f172a;
}
.bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  padding: 18rpx 24rpx calc(18rpx + env(safe-area-inset-bottom));
  background: #ffffff;
  box-shadow: 0 -8rpx 24rpx rgba(15, 23, 42, 0.08);
}
.bar-total {
  flex: 1;
}
.bar-label {
  display: block;
  font-size: 20rpx;
  color: #94a3b8;
}
.bar-price {
  display: block;
  font-size: 34rpx;
  font-weight: 700;
  color: #d92d20;
}
.bar-btn {
  margin-left: 16rpx;
  padding: 18rpx 30rpx;
  border-radius: 999rpx;
  background: #0f9d8f;
  color: #ffffff;
  font-size: 26rpx;
}
.bar-btn.ghost {
  background: #e6f5f2;
  color: #0b7a70;
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
