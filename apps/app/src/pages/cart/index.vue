<template>
  <view class="page">
    <view v-if="loading" class="hint center">加载中…</view>
    <view v-else-if="error" class="hint center">
      <text>{{ error }}</text>
      <view class="retry" hover-class="pressed" @tap="load">重新加载</view>
    </view>
    <view v-else-if="cart.items.length === 0" class="empty">
      <text class="empty-title">购物车还是空的</text>
      <text class="empty-sub">去商城挑点喜欢的东西吧</text>
      <view class="empty-btn" hover-class="pressed" @tap="goMall">去逛逛</view>
    </view>

    <block v-else>
      <view class="list">
        <view v-for="line in cart.items" :key="line.productId" class="card line">
          <view class="cover" :style="{ backgroundColor: line.cover }">
            <text class="cover-char">{{ line.title.slice(0, 1) }}</text>
          </view>
          <view class="info">
            <text class="name">{{ line.title }}</text>
            <text class="price">¥{{ price(line.priceFen) }}</text>
            <view class="row">
              <view class="stepper">
                <view class="step" hover-class="pressed" @tap="changeQty(line.productId, line.quantity - 1)">−</view>
                <text class="count">{{ line.quantity }}</text>
                <view class="step" hover-class="pressed" @tap="changeQty(line.productId, line.quantity + 1)">+</view>
              </view>
              <text class="subtotal">小计 ¥{{ price(line.subtotalFen) }}</text>
            </view>
            <text class="stock">库存 {{ line.stock }}</text>
          </view>
          <view class="remove" hover-class="pressed" @tap="remove(line.productId)">删除</view>
        </view>
      </view>

      <view v-if="checkoutVisible" class="card form">
        <text class="form-title">收货信息</text>
        <input v-model="form.receiverName" class="field" placeholder="收货人姓名" />
        <input v-model="form.receiverPhone" class="field" type="number" maxlength="11" placeholder="手机号" />
        <textarea v-model="form.address" class="field field--area" placeholder="详细地址（省市区 + 门牌号）" />
        <input v-model="form.remark" class="field" placeholder="备注（选填）" />
        <view class="form-actions">
          <view class="form-btn ghost" hover-class="pressed" @tap="checkoutVisible = false">取消</view>
          <view class="form-btn" hover-class="pressed" @tap="submitOrder">提交订单</view>
        </view>
      </view>

      <view class="bar">
        <view class="bar-total">
          <text class="bar-label">共 {{ cart.totalQuantity }} 件</text>
          <text class="bar-price">¥{{ price(cart.totalFen) }}</text>
        </view>
        <view class="bar-btn" hover-class="pressed" @tap="checkoutVisible = true">去结算</view>
      </view>
    </block>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import type { CartDto } from '@mixmapp/contracts';
import { mallApi } from '../../api/client';

const cart = ref<CartDto>({ items: [], totalQuantity: 0, totalFen: 0 });
const loading = ref(false);
const error = ref('');
const checkoutVisible = ref(false);
const submitting = ref(false);
const form = ref({ receiverName: '', receiverPhone: '', address: '', remark: '' });

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
      uni.navigateTo({ url: '/pages/auth/login' });
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
      uni.navigateTo({ url: `/pages/orders/index?orderNo=${encodeURIComponent(order.orderNo)}` });
    }, 600);
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '下单失败', icon: 'none' });
  } finally {
    submitting.value = false;
  }
}

function goMall(): void {
  uni.navigateTo({ url: '/pages/mall/index' });
}

onShow(() => {
  void load();
});
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: #f6f7f9;
  padding: 24rpx 24rpx 200rpx;
}
.list {
  margin-bottom: 20rpx;
}
.card {
  background: #ffffff;
  border-radius: 24rpx;
  box-shadow: 0 8rpx 24rpx rgba(15, 23, 42, 0.06);
}
.line {
  display: flex;
  padding: 24rpx;
  margin-bottom: 20rpx;
  position: relative;
}
.cover {
  width: 152rpx;
  height: 152rpx;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.cover-char {
  color: #ffffff;
  font-size: 52rpx;
  font-weight: 700;
}
.info {
  flex: 1;
  margin-left: 20rpx;
}
.name {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: #0f172a;
  padding-right: 80rpx;
}
.price {
  display: block;
  margin-top: 8rpx;
  font-size: 30rpx;
  font-weight: 700;
  color: #d92d20;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14rpx;
}
.stepper {
  display: flex;
  align-items: center;
}
.step {
  width: 56rpx;
  height: 56rpx;
  border-radius: 14rpx;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  color: #0f172a;
}
.count {
  width: 72rpx;
  text-align: center;
  font-size: 26rpx;
}
.subtotal {
  font-size: 24rpx;
  color: #475569;
}
.stock {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #94a3b8;
}
.remove {
  position: absolute;
  right: 24rpx;
  top: 24rpx;
  font-size: 22rpx;
  color: #94a3b8;
}
.form {
  margin-top: 12rpx;
  padding: 26rpx;
}
.form-title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 14rpx;
}
.field {
  width: 100%;
  box-sizing: border-box;
  padding: 18rpx 20rpx;
  margin-bottom: 14rpx;
  border-radius: 16rpx;
  background: #f1f5f9;
  font-size: 26rpx;
  color: #0f172a;
}
.field--area {
  height: 140rpx;
}
.form-actions {
  display: flex;
  margin-top: 8rpx;
}
.form-btn {
  flex: 1;
  margin-left: 16rpx;
  padding: 18rpx 0;
  border-radius: 999rpx;
  text-align: center;
  background: #0f9d8f;
  color: #ffffff;
  font-size: 26rpx;
}
.form-btn.ghost {
  margin-left: 0;
  background: #e6f5f2;
  color: #0b7a70;
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
  padding: 18rpx 44rpx;
  border-radius: 999rpx;
  background: #0f9d8f;
  color: #ffffff;
  font-size: 28rpx;
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
