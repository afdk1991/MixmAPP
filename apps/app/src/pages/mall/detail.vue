<template>
  <view class="page">
    <mx-bar />
    <view v-if="loading" class="loading">
      <view class="sk hero-sk" />
      <view class="loading-body">
        <view class="sk line-xl" />
        <view class="sk line" />
        <view class="sk line short" />
      </view>
    </view>

    <view v-else-if="error" class="empty">
      <view class="empty-mark mono">!</view>
      <text class="empty-title">商品没打开</text>
      <text class="empty-sub">{{ error }}</text>
      <view class="btn btn--deep btn--sm retry" hover-class="is-press" @tap="load">重新加载</view>
    </view>

    <block v-else-if="product">
      <view class="hero">
        <view class="hero-scrim" />
        <view class="hero-ring" />
        <view class="hero-ring hero-ring--sm" />
        <text class="hero-tag mono">{{ product.category }}</text>
        <text class="hero-char">{{ product.title.slice(0, 1) }}</text>
        <text class="hero-serial mono">NO. {{ product.id.slice(0, 8).toUpperCase() }}</text>
      </view>

      <view class="body">
        <text class="eyebrow">SPECIMEN</text>
        <text class="title">{{ product.title }}</text>
        <text class="subtitle">{{ product.subtitle }}</text>

        <view class="price-row">
          <view class="price-main">
            <text class="cur mono">¥</text>
            <text class="amount mono">{{ price(product.priceFen) }}</text>
            <text v-if="product.originalPriceFen > 0" class="price-old mono">¥{{ price(product.originalPriceFen) }}</text>
          </view>
          <text class="stock mono">余 {{ product.stock }}</text>
        </view>

        <view v-if="product.tags.length" class="tags">
          <text v-for="tag in product.tags" :key="tag" class="tag">{{ tag }}</text>
        </view>

        <view class="sheet section">
          <text class="sec-label mono">DETAIL</text>
          <text class="section-title">商品说明</text>
          <text class="desc">{{ product.description }}</text>
        </view>

        <view class="sheet section">
          <text class="sec-label mono">QUANTITY</text>
          <view class="qty-head">
            <text class="qty-title">购买数量</text>
            <view class="stepper">
              <view class="step" hover-class="is-press" @tap="dec">
                <text class="step-text mono">−</text>
              </view>
              <text class="count mono">{{ quantity }}</text>
              <view class="step" hover-class="is-press" @tap="inc">
                <text class="step-text mono">+</text>
              </view>
            </view>
          </view>
          <text class="hint">单笔最多 99 件，超出库存会提示。</text>
        </view>

        <view class="note">
          <text class="micro mono">MIXMAPP · 首发限定周边 · 数量有限</text>
        </view>
      </view>

      <view class="bar">
        <view class="bar-total">
          <text class="bar-label mono">合计</text>
          <text class="bar-price mono">¥{{ price(product.priceFen * quantity) }}</text>
        </view>
        <view class="bar-btn bar-btn--ghost" hover-class="is-press" @tap="addToCart">
          <text class="bar-btn-text bar-btn-text--ghost">加入购物车</text>
        </view>
        <view class="bar-btn bar-btn--primary" hover-class="is-press" @tap="buyNow">
          <text class="bar-btn-text">立即购买</text>
        </view>
      </view>
    </block>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import type { ProductDto } from '@mixmapp/contracts';
import { mallApi } from '../../api/client';
import { ROUTES } from '../../routes';

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
      uni.navigateTo({ url: ROUTES.login });
      return;
    }
    uni.showToast({ title: message, icon: 'none' });
  }
}

async function buyNow(): Promise<void> {
  try {
    await mallApi.addToCart(productId.value, quantity.value);
    uni.navigateTo({ url: ROUTES.cart });
  } catch (e) {
    const message = e instanceof Error ? e.message : '操作失败';
    if (message.includes('登录')) {
      uni.navigateTo({ url: ROUTES.login });
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

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  padding-bottom: 240rpx;
}

/* ---------- 主视觉 ---------- */
.hero {
  position: relative;
  height: 440rpx;
  background:
    radial-gradient(120% 120% at 18% 0%, rgba(15, 157, 143, 0.3), rgba(15, 157, 143, 0) 58%),
    linear-gradient(160deg, #0b0f0e 0%, #152622 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.hero-scrim {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: linear-gradient(160deg, rgba(244, 244, 241, 0.02) 10%, rgba(244, 244, 241, 0.08) 100%);
}

.hero-ring {
  position: absolute;
  width: 400rpx;
  height: 400rpx;
  border: 1rpx solid rgba(244, 244, 241, 0.18);
  border-radius: 50%;
}

.hero-ring--sm {
  width: 280rpx;
  height: 280rpx;
  border-color: rgba(244, 244, 241, 0.1);
}

.hero-tag {
  position: absolute;
  left: $sp-4;
  top: $sp-4;
  z-index: 2;
  font-size: 26rpx;
  letter-spacing: 3rpx;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.8);
  padding: 6rpx 14rpx;
  border: 1rpx solid rgba(255, 255, 255, 0.32);
  border-radius: 8rpx;
}

.hero-char {
  position: relative;
  z-index: 2;
  font-family: $font-display;
  font-size: 140rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: 1;
  color: #f4f4f1;
}

.hero-serial {
  position: absolute;
  right: $sp-4;
  bottom: $sp-6;
  z-index: 2;
  font-size: 26rpx;
  letter-spacing: 2rpx;
  color: rgba(244, 244, 241, 0.55);
}

/* ---------- 正文层 ---------- */
.body {
  position: relative;
  z-index: 3;
  margin-top: -44rpx;
  padding: $sp-5 $sp-4 0;
  background: $paper;
  border-top-left-radius: 44rpx;
  border-top-right-radius: 44rpx;
}

.title {
  display: block;
  margin-top: 14rpx;
  font-family: $font-display;
  font-size: 48rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: 1.28;
  color: $ink;
}

.subtitle {
  display: block;
  margin-top: 10rpx;
  font-size: 30rpx;
  line-height: 1.6;
  color: $ink-3;
}

.price-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-top: $sp-4;
  padding-bottom: $sp-3;
  border-bottom: 1rpx solid $paper-3;
}

.price-main {
  display: flex;
  align-items: baseline;
}

.cur {
  font-size: 26rpx;
  color: $ink-2;
  margin-right: 4rpx;
}

.amount {
  font-size: 56rpx;
  font-weight: 700;
  line-height: 1;
  color: $ink;
}

.price-old {
  margin-left: 14rpx;
  font-size: 26rpx;
  color: $ink-4;
  text-decoration: line-through;
}

.stock {
  font-size: 26rpx;
  letter-spacing: 0.5rpx;
  color: $ink-3;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  margin-top: $sp-3;
}

.tag {
  margin: 0 12rpx 12rpx 0;
}

.section {
  margin-top: $sp-4;
  padding: $sp-4;
}

.sec-label {
  display: block;
  font-size: 26rpx;
  letter-spacing: 3rpx;
  color: $ink-4;
}

.section-title {
  display: block;
  margin-top: 8rpx;
  font-family: $font-display;
  font-size: $fs-h2;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
}

.desc {
  display: block;
  margin-top: 14rpx;
  font-size: 30rpx;
  line-height: 1.8;
  color: $ink-2;
}

.qty-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10rpx;
}

.qty-title {
  font-family: $font-display;
  font-size: $fs-h2;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
}

.hint {
  margin-top: 10rpx;
}

.stepper {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.step {
  width: 72rpx;
  height: 72rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  background: #f7faf8;
  display: flex;
  align-items: center;
  justify-content: center;
}

.step-text {
  font-size: 34rpx;
  color: $ink;
}

.count {
  width: 84rpx;
  text-align: center;
  font-size: 34rpx;
  color: $ink;
}

.note {
  margin: $sp-5 0 0;
  padding-top: $sp-4;
  border-top: 1rpx solid $paper-3;
  text-align: center;
}

/* ---------- 底部购买条 ---------- */
.bar-total {
  flex: 1;
}

.bar-label {
  display: block;
  font-size: 26rpx;
  letter-spacing: 2rpx;
  color: $ink-4;
}

.bar-price {
  display: block;
  margin-top: 4rpx;
  font-size: 40rpx;
  font-weight: 700;
  line-height: 1.1;
  color: $ink;
}

.bar-btn {
  height: 84rpx;
  padding: 0 30rpx;
  border-radius: $r-control;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 14rpx;
}

.bar-btn--ghost {
  background: $shell;
  border: 1rpx solid $paper-3;
}

.bar-btn--primary {
  background: $ink;
  box-shadow: 0 12rpx 28rpx -16rpx rgba(13, 25, 23, 0.5);
}

.bar-btn-text {
  font-size: 30rpx;
  font-weight: 600;
  letter-spacing: 0.5rpx;
  color: #f4f8f6;
}

.bar-btn-text--ghost {
  color: $ink;
}

/* ---------- 骨架 / 空态 ---------- */
.loading {
  padding-bottom: 40rpx;
}

.hero-sk {
  height: 470rpx;
  border-radius: 0;
}

.loading-body {
  padding: $sp-5 $sp-4 0;
  margin-top: -44rpx;
  background: $paper;
  border-top-left-radius: 44rpx;
  border-top-right-radius: 44rpx;
}

.line-xl {
  height: 56rpx;
  width: 70%;
  margin-bottom: 22rpx;
}

.line {
  height: 26rpx;
  width: 50%;
  margin-bottom: 16rpx;
}

.short {
  width: 32%;
}

.retry {
  margin-top: $sp-4;
  padding: 0 40rpx;
}
</style>
