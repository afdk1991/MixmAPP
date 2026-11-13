<template>
  <view class="page">
    <mx-bar />
    <view class="head">
      <text class="eyebrow">BAG</text>
      <text class="title">购物车</text>
      <text class="sub mono">
        {{ cart.items.length ? `${cart.totalQuantity} 件 · ${cart.items.length} 个商品` : 'EMPTY' }}
      </text>
    </view>

    <view v-if="loading" class="loading">
      <view v-for="i in 2" :key="i" class="sheet line-sk">
        <view class="sk thumb-sk" />
        <view class="sk-col">
          <view class="sk line-w" />
          <view class="sk line-n" />
          <view class="sk line-s" />
        </view>
      </view>
    </view>

    <view v-else-if="error" class="empty">
      <view class="empty-mark mono">!</view>
      <text class="empty-title">购物车没打开</text>
      <text class="empty-sub">{{ error }}</text>
      <view class="btn btn--deep btn--sm retry" hover-class="is-press" @tap="load">重新加载</view>
    </view>

    <view v-else-if="cart.items.length === 0" class="empty">
      <view class="empty-mark">空</view>
      <text class="empty-title">购物车还是空的</text>
      <text class="empty-sub">去商城挑点喜欢的东西吧。</text>
      <view class="btn btn--deep empty-btn" hover-class="is-press" @tap="goMall">去逛逛</view>
    </view>

    <block v-else>
      <view class="list">
        <view v-for="line in cart.items" :key="line.productId" class="sheet line">
          <view class="cover" :style="{ backgroundColor: line.cover }">
            <view class="cover-scrim" />
            <text class="cover-char">{{ line.title.slice(0, 1) }}</text>
          </view>
          <view class="info">
            <view class="name-row">
              <text class="name">{{ line.title }}</text>
              <view class="remove" hover-class="is-press" @tap="remove(line.productId)">
                <text class="remove-text mono">移除</text>
              </view>
            </view>
            <view class="unit-row">
              <text class="unit mono">¥{{ price(line.priceFen) }} / 件</text>
              <text class="stock mono">库存 {{ line.stock }}</text>
            </view>
            <view class="line-foot">
              <view class="stepper">
                <view class="step" hover-class="is-press" @tap="changeQty(line.productId, line.quantity - 1)">
                  <text class="step-text mono">−</text>
                </view>
                <text class="count mono">{{ line.quantity }}</text>
                <view class="step" hover-class="is-press" @tap="changeQty(line.productId, line.quantity + 1)">
                  <text class="step-text mono">+</text>
                </view>
              </view>
              <view class="subtotal">
                <text class="subtotal-k mono">小计</text>
                <text class="subtotal-v mono">¥{{ price(line.subtotalFen) }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <view v-if="checkoutVisible" class="sheet checkout">
        <text class="eyebrow">CHECKOUT</text>
        <text class="checkout-title">收货信息</text>
        <text class="hint">提交后库存即扣减，可在订单页查看进度。</text>

        <text class="label mt">收货人</text>
        <input v-model="form.receiverName" class="field" placeholder="收货人姓名" placeholder-class="field-ph" />
        <text class="label mt">手机号</text>
        <input
          v-model="form.receiverPhone"
          class="field"
          type="number"
          maxlength="11"
          placeholder="手机号"
          placeholder-class="field-ph"
        />
        <text class="label mt">详细地址</text>
        <textarea
          v-model="form.address"
          class="field field--area"
          placeholder="省市区 + 门牌号"
          placeholder-class="field-ph"
        />
        <text class="label mt">备注（选填）</text>
        <input v-model="form.remark" class="field" placeholder="备注" placeholder-class="field-ph" />

        <view class="form-actions">
          <view class="btn btn--ghost form-btn" hover-class="is-press" @tap="checkoutVisible = false">
            <text class="form-btn-text">取消</text>
          </view>
          <view
            class="btn btn--deep form-btn"
            :class="{ 'btn--disabled': submitting }"
            hover-class="is-press"
            @tap="submitOrder"
          >
            <text class="form-btn-text form-btn-text--deep">{{ submitting ? '提交中…' : '提交订单' }}</text>
          </view>
        </view>
      </view>

      <view class="bar">
        <view class="bar-total">
          <text class="bar-label mono">共 {{ cart.totalQuantity }} 件</text>
          <text class="bar-price mono">¥{{ price(cart.totalFen) }}</text>
        </view>
        <view
          class="bar-btn"
          :class="{ 'bar-btn--busy': submitting }"
          hover-class="is-press"
          @tap="onBarAction"
        >
          <text class="bar-btn-text">{{ barLabel }}</text>
        </view>
      </view>
    </block>
  </view>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import type { CartDto } from '@mixmapp/contracts';
import { mallApi } from '../../api/client';
import { ROUTES } from '../../routes';

const cart = ref<CartDto>({ items: [], totalQuantity: 0, totalFen: 0 });
const loading = ref(false);
const error = ref('');
const checkoutVisible = ref(false);
const submitting = ref(false);
const form = ref({ receiverName: '', receiverPhone: '', address: '', remark: '' });
const barLabel = computed(() => {
  if (!checkoutVisible.value) return '去结算';
  return submitting.value ? '提交中…' : '提交订单';
});

function onBarAction(): void {
  if (checkoutVisible.value) {
    void submitOrder();
    return;
  }
  checkoutVisible.value = true;
  void nextTick(() => {
    uni.pageScrollTo({ selector: '.checkout', duration: 280, offsetTop: -72, fail: () => undefined });
  });
}

function price(fen: number): string {
  return (fen / 100).toFixed(2);
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    cart.value = await mallApi.getCart();
  } catch (e) {
    const message = e instanceof Error ? e.message : '购物车加载失败';
    if (message.includes('登录')) {
      uni.navigateTo({ url: ROUTES.login });
      return;
    }
    error.value = message;
  } finally {
    loading.value = false;
  }
}

async function changeQty(productId: string, quantity: number): Promise<void> {
  if (quantity < 1) {
    await remove(productId);
    return;
  }
  try {
    cart.value = await mallApi.updateCart(productId, quantity);
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '修改数量失败', icon: 'none' });
  }
}

async function remove(productId: string): Promise<void> {
  try {
    cart.value = await mallApi.removeCart(productId);
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '删除失败', icon: 'none' });
  }
}

async function submitOrder(): Promise<void> {
  const { receiverName, receiverPhone, address } = form.value;
  if (!receiverName.trim()) {
    uni.showToast({ title: '请填写收货人', icon: 'none' });
    return;
  }
  if (!/^1[3-9]\d{9}$/.test(receiverPhone.trim())) {
    uni.showToast({ title: '请填写正确的手机号', icon: 'none' });
    return;
  }
  if (address.trim().length < 4) {
    uni.showToast({ title: '请填写详细地址', icon: 'none' });
    return;
  }
  if (submitting.value) return;
  submitting.value = true;
  try {
    const order = await mallApi.createOrder({
      receiverName: receiverName.trim(),
      receiverPhone: receiverPhone.trim(),
      address: address.trim(),
      ...(form.value.remark.trim() ? { remark: form.value.remark.trim() } : {}),
    });
    checkoutVisible.value = false;
    cart.value = { items: [], totalQuantity: 0, totalFen: 0 };
    uni.showToast({ title: '下单成功', icon: 'success' });
    setTimeout(() => {
      uni.navigateTo({ url: `${ROUTES.orders}?orderNo=${encodeURIComponent(order.orderNo)}` });
    }, 600);
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '下单失败', icon: 'none' });
  } finally {
    submitting.value = false;
  }
}

function goMall(): void {
  uni.navigateTo({ url: ROUTES.mall });
}

onShow(() => {
  void load();
});
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  padding: 0 $sp-3 240rpx;
}

.head {
  padding: $sp-5 4rpx $sp-4;
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
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: $ink-3;
}

.list {
  margin-bottom: $sp-4;
}

.line {
  display: flex;
  padding: $sp-3;
  margin-bottom: $sp-3;
}

.cover {
  position: relative;
  width: 148rpx;
  height: 148rpx;
  border-radius: $r-control;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.cover-scrim {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: linear-gradient(150deg, rgba(8, 17, 15, 0.04), rgba(8, 17, 15, 0.4));
}

.cover-char {
  position: relative;
  z-index: 2;
  font-family: $font-display;
  font-size: 52rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: rgba(255, 255, 255, 0.95);
}

.info {
  flex: 1;
  margin-left: $sp-3;
  min-width: 0;
}

.name-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.name {
  flex: 1;
  padding-right: $sp-2;
  font-family: $font-display;
  font-size: 32rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: 1.35;
  color: $ink;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remove {
  height: 48rpx;
  padding: 0 4rpx;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.remove-text {
  font-size: 20rpx;
  letter-spacing: 1rpx;
  color: $ink-3;
}

.unit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8rpx;
}

.unit {
  font-size: 22rpx;
  color: $ink-3;
}

.line-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-top: $sp-2;
}

.stepper {
  display: flex;
  align-items: center;
}

.step {
  width: 64rpx;
  height: 64rpx;
  border: 1rpx solid $paper-3;
  border-radius: 12rpx;
  background: #f7faf8;
  display: flex;
  align-items: center;
  justify-content: center;
}

.step-text {
  font-size: 28rpx;
  color: $ink;
}

.count {
  width: 76rpx;
  text-align: center;
  font-size: 28rpx;
  color: $ink;
}

.subtotal {
  display: flex;
  align-items: baseline;
}

.subtotal-k {
  font-size: 20rpx;
  color: $ink-4;
  margin-right: 6rpx;
}

.subtotal-v {
  font-size: 28rpx;
  font-weight: 700;
  color: $ink;
}

.stock {
  font-size: 20rpx;
  color: $ink-4;
}

/* ---------- 结算表单 ---------- */
.checkout {
  padding: $sp-4;
  margin-bottom: $sp-4;
  animation: rise 0.35s ease both;
}

.checkout-title {
  display: block;
  margin-top: 12rpx;
  font-family: $font-display;
  font-size: 40rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
}

.checkout .hint {
  margin-top: 8rpx;
}

.mt {
  margin-top: $sp-3;
}

.form-actions {
  display: flex;
  margin-top: $sp-4;
}

.form-btn {
  flex: 1;
  height: 88rpx;
}

.form-btn:first-child {
  margin-right: $sp-2;
}

.form-btn-text {
  font-size: 26rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: $ink;
}

.form-btn-text--deep {
  color: #f4f8f6;
}

/* ---------- 底栏 ---------- */
.bar-total {
  flex: 1;
}

.bar-label {
  display: block;
  font-size: 20rpx;
  letter-spacing: 1rpx;
  color: $ink-4;
}

.bar-price {
  display: block;
  margin-top: 4rpx;
  font-size: 36rpx;
  font-weight: 700;
  line-height: 1.1;
  color: $ink;
}

.bar-btn {
  height: 88rpx;
  padding: 0 48rpx;
  border-radius: $r-pill;
  background: $ink;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 12rpx 28rpx -16rpx rgba(13, 25, 23, 0.5);
}

.bar-btn--busy {
  opacity: 0.72;
}

.bar-btn-text {
  font-size: 28rpx;  font-weight: 600;
  letter-spacing: 1rpx;
  color: #f4f8f6;
}

/* ---------- 骨架 ---------- */
.line-sk {
  display: flex;
  padding: $sp-3;
  margin-bottom: $sp-3;
  border-radius: $r-card;
}

.thumb-sk {
  width: 148rpx;
  height: 148rpx;
  flex-shrink: 0;
}

.sk-col {
  flex: 1;
  margin-left: $sp-3;
  padding-top: 8rpx;
}

.line-w {
  height: 30rpx;
  width: 70%;
}

.line-n {
  height: 22rpx;
  width: 34%;
  margin-top: 16rpx;
}

.line-s {
  height: 56rpx;
  width: 100%;
  margin-top: 22rpx;
}

.retry {
  margin-top: $sp-4;
  padding: 0 40rpx;
}

.empty-btn {
  margin-top: $sp-5;
  width: 300rpx;
}
</style>
