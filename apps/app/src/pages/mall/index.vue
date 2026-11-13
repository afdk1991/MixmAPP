<template>
  <view class="page">
    <mx-bar />
    <view class="head">
      <view class="head-top">
        <view class="head-title">
          <text class="eyebrow">MIXMAPP STORE</text>
          <text class="title">商城</text>
          <text class="sub">单码多端周边 · 首发限定</text>
        </view>
        <view class="cart-btn" hover-class="is-press" @tap="goCart">
          <text class="cart-text">购物车</text>
          <text class="cart-arrow mono">→</text>
        </view>
      </view>

      <view class="search">
        <view class="search-mark">
          <view class="search-lens" />
          <view class="search-handle" />
        </view>
        <input
          v-model="keyword"
          class="search-input"
          placeholder="搜商品，如 通行证 / 支架"
          placeholder-class="field-ph"
          confirm-type="search"
          @confirm="load"
        />
        <view class="search-go" hover-class="is-press" @tap="load">
          <text class="search-go-text">搜索</text>
        </view>
      </view>

      <scroll-view :scroll-x="true" class="tabs" :show-scrollbar="false">
        <view
          v-for="item in categories"
          :key="item.key"
          class="tab"
          :class="{ 'tab--active': active === item.key }"
          @tap="switchCategory(item.key)"
        >
          <text class="tab-label">{{ item.label }}</text>
          <view class="tab-line" />
        </view>
      </scroll-view>
    </view>

    <view v-if="loading" class="grid wrap">
      <view v-for="i in 4" :key="i" class="product">
        <view class="sk cover-sk" />
        <view class="p-info">
          <view class="sk sk-line" />
          <view class="sk sk-line sk-line--short" />
          <view class="sk sk-price" />
        </view>
      </view>
    </view>

    <view v-else-if="error" class="empty">
      <view class="empty-mark mono">!</view>
      <text class="empty-title">没能取到商品</text>
      <text class="empty-sub">{{ error }}</text>
      <view class="btn btn--deep btn--sm retry" hover-class="is-press" @tap="load">重新加载</view>
    </view>

    <view v-else-if="products.length === 0" class="empty">
      <view class="empty-mark">空</view>
      <text class="empty-title">这个分类还没有商品</text>
      <text class="empty-sub">换个分类或清空关键词再试。</text>
    </view>

    <view v-else>
      <view class="list-head">
        <text class="micro mono">{{ products.length }} ITEMS</text>
        <text class="micro mono">按上架顺序</text>
      </view>
      <view class="grid wrap">
        <view
          v-for="product in products"
          :key="product.id"
          class="product"
          hover-class="is-press"
          @tap="openDetail(product)"
        >
          <view class="cover">
            <view class="cover-scrim" />
            <view class="cover-ring" />
            <text class="cover-tag mono">{{ product.category }}</text>
            <text class="cover-char">{{ product.title.slice(0, 1) }}</text>
            <view class="cover-add" hover-class="is-press" @tap.stop="addToCart(product)">
              <text class="cover-add-text mono">+</text>
            </view>
          </view>
          <view class="p-info">
            <text class="p-name">{{ product.title }}</text>
            <text class="p-sub">{{ product.subtitle }}</text>
            <view class="p-foot">
              <view class="p-price">
                <text class="p-cur mono">¥</text>
                <text class="p-amount mono">{{ price(product.priceFen) }}</text>
                <text v-if="product.originalPriceFen > 0" class="p-old mono">¥{{ price(product.originalPriceFen) }}</text>
              </view>
              <text class="p-stock mono">余 {{ product.stock }}</text>
            </view>
          </view>
        </view>
      </view>
      <view class="list-foot">
        <text class="mono foot-note">库存与价格以服务端实时数据为准</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import type { ProductDto } from '@mixmapp/contracts';
import { mallApi } from '../../api/client';
import { ROUTES } from '../../routes';

/** 分类由服务端商品数据推导，避免前端写死与后端不一致的分类。 */
const facets = ref<string[]>([]);
const categories = computed(() => [
  { key: '', label: '全部' },
  ...facets.value.map((name) => ({ key: name, label: name })),
]);

const active = ref('');
const keyword = ref('');
const products = ref<ProductDto[]>([]);
const loading = ref(false);
const error = ref('');

async function loadFacets(): Promise<void> {
  try {
    const all = await mallApi.listProducts({ pageSize: 50 });
    if (!Array.isArray(all)) return;
    const names = Array.from(new Set(all.map((p) => p.category).filter(Boolean)));
    facets.value = names.slice(0, 6);
  } catch {
    facets.value = [];
  }
}

function price(fen: number): string {
  return (fen / 100).toFixed(2);
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const list = await mallApi.listProducts({
      category: active.value || undefined,
      keyword: keyword.value.trim() || undefined,
      pageSize: 50,
    });
    // 接口异常或网关返回非 JSON 时保持空数组，避免模板读取 length 时报错白屏
    products.value = Array.isArray(list) ? list : [];
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
  uni.navigateTo({ url: `${ROUTES.mallDetail}?id=${encodeURIComponent(product.id)}` });
}

function goCart(): void {
  uni.navigateTo({ url: ROUTES.cart });
}

async function addToCart(product: ProductDto): Promise<void> {
  try {
    await mallApi.addToCart(product.id, 1);
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

onShow(() => {
  if (!facets.value.length) void loadFacets();
  void load();
});
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  padding: 0 $sp-3 $sp-8;
}

/* ---------- 页头 ---------- */
.head {
  padding: $sp-5 4rpx $sp-3;
}

.head-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.head-title {
  flex: 1;
}

.title {
  display: block;
  margin-top: 16rpx;
  font-family: $font-display;
  font-size: $fs-h1;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: 1.2;
  letter-spacing: 1rpx;
  color: $ink;
}

.sub {
  display: block;
  margin-top: 10rpx;
  font-size: $fs-meta;
  letter-spacing: 0.5rpx;
  color: $ink-3;
}

.cart-btn {
  margin-top: 20rpx;
  display: flex;
  align-items: center;
  height: 64rpx;
  padding: 0 22rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  background: $shell;
}

.cart-text {
  font-size: $fs-micro;
  letter-spacing: 0.5rpx;
  color: $ink-2;
}

.cart-arrow {
  margin-left: 8rpx;
  font-size: $fs-micro;
  color: $ink-4;
}

.search {
  display: flex;
  align-items: center;
  margin-top: $sp-4;
  height: 96rpx;
  padding: 0 8rpx 0 26rpx;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  box-shadow: $shadow-card;
}

.search-mark {
  position: relative;
  width: 36rpx;
  height: 36rpx;
  margin-right: 12rpx;
  flex-shrink: 0;
}

.search-lens {
  position: absolute;
  left: 0;
  top: 0;
  width: 24rpx;
  height: 24rpx;
  border: 2rpx solid $ink-4;
  border-radius: 50%;
}

.search-handle {
  position: absolute;
  right: 0;
  bottom: 2rpx;
  width: 16rpx;
  height: 2rpx;
  background: $ink-4;
  transform: rotate(45deg);
}

.search-input {
  flex: 1;
  height: 96rpx;
  font-size: 30rpx;
  color: $ink;
}

.search-go {
  height: 72rpx;
  padding: 0 28rpx;
  border-radius: $r-control;
  background: $ink;
  display: flex;
  align-items: center;
  justify-content: center;
}

.search-go-text {
  font-size: $fs-meta;
  letter-spacing: 1rpx;
  color: #f4f8f6;
}

.tabs {
  margin-top: $sp-4;
  white-space: nowrap;
}

.tab {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 12rpx 0 0;
  margin-right: 40rpx;
}

.tab-label {
  font-size: 30rpx;
  letter-spacing: 0.5rpx;
  color: $ink-3;
  padding-bottom: 12rpx;
}

.tab--active .tab-label {
  color: $ink;
  font-weight: 600;
}

.tab-line {
  width: 100%;
  height: 3rpx;
  border-radius: 3rpx;
  background: transparent;
}

.tab--active .tab-line {
  background: $brand;
}

/* ---------- 商品网格 ---------- */
.list-head {
  display: flex;
  justify-content: space-between;
  padding: $sp-2 4rpx $sp-3;
}

.wrap {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
}

.product {
  width: 48.6%;
  margin-bottom: $sp-3;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-card;
  box-shadow: $shadow-card;
  overflow: hidden;
  transition: transform 0.16s ease;
}

.cover {
  position: relative;
  height: 280rpx;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $paper-2;
  border-bottom: 1rpx solid $paper-3;
}

.cover-scrim {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: linear-gradient(150deg, rgba(17, 20, 19, 0.02) 12%, rgba(17, 20, 19, 0.08) 100%);
}

.cover-ring {
  position: absolute;
  width: 210rpx;
  height: 210rpx;
  border-radius: 50%;
  border: 1rpx solid rgba(17, 20, 19, 0.12);
  top: 46rpx;
  left: 50%;
  margin-left: -105rpx;
}

.cover-tag {
  position: absolute;
  left: 20rpx;
  top: 20rpx;
  font-size: 26rpx;
  letter-spacing: 2rpx;
  text-transform: uppercase;
  color: $ink-3;
  border: 1rpx solid rgba(17, 20, 19, 0.18);
  border-radius: 6rpx;
  padding: 4rpx 10rpx;
  z-index: 2;
}

.cover-char {
  position: relative;
  z-index: 2;
  font-family: $font-display;
  font-size: 84rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: 1;
  color: $ink;
}

.cover-add {
  position: absolute;
  right: 16rpx;
  bottom: 16rpx;
  z-index: 3;
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.94);
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-add-text {
  font-size: 40rpx;
  line-height: 1;
  color: $ink;
}

.p-info {
  padding: 20rpx 22rpx 22rpx;
  display: flex;
  flex-direction: column;
  min-height: 168rpx;
}

.p-name {
  font-family: $font-display;
  font-size: 30rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: 1.4;
  color: $ink;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.p-sub {
  display: block;
  margin-top: 6rpx;
  font-size: 26rpx;
  color: $ink-3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.p-foot {
  display: block;
  margin-top: auto;
  padding-top: 16rpx;
}

.p-price {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
}

.p-cur {
  font-size: 26rpx;
  color: $ink-2;
  margin-right: 2rpx;
}

.p-amount {
  font-size: 40rpx;
  font-weight: 700;
  color: $ink;
}

.p-old {
  margin-left: 8rpx;
  font-size: 26rpx;
  color: $ink-4;
  text-decoration: line-through;
}

.p-stock {
  display: block;
  margin-top: 4rpx;
  font-size: 26rpx;
  color: $ink-4;
}

.cover-sk {
  height: 300rpx;
  border-radius: 0;
}

.sk-line {
  height: 28rpx;
  margin-top: 14rpx;
  width: 82%;
}

.sk-line--short {
  width: 54%;
}

.sk-price {
  height: 32rpx;
  margin-top: 20rpx;
  width: 40%;
}

.list-foot {
  padding: $sp-3 4rpx $sp-6;
  text-align: center;
}

.foot-note {
  font-size: 26rpx;
  letter-spacing: 1rpx;
  color: $ink-4;
}

.retry {
  margin-top: $sp-4;
  padding: 0 40rpx;
}
</style>
