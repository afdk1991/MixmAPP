<template>
  <view class="page">
    <block v-if="user">
      <view class="id-card">
        <view class="id-top">
          <text class="id-label">我的 MixmAPP 号码</text>
          <view class="pill">自动分配</view>
        </view>
        <text class="id-value mono">{{ user.accountNo }}</text>
        <view class="id-actions">
          <view class="btn btn--ghost small" @tap="copyId">复制号码</view>
          <view class="btn btn--ghost small" @tap="reload">刷新资料</view>
        </view>
        <text class="id-foot">该号码全局唯一，可直接作为登录账号使用</text>
      </view>

      <view class="card">
        <text class="section">账号资料</text>
        <view class="row"><text class="k">昵称</text><text class="v">{{ user.nickname }}</text></view>
        <view class="row"><text class="k">手机号</text><text class="v">{{ user.phone ?? '未绑定' }}</text></view>
        <view class="row"><text class="k">邮箱</text><text class="v">{{ user.email ?? '未绑定' }}</text></view>
        <view class="row"><text class="k">注册时间</text><text class="v">{{ createdText }}</text></view>
        <view class="row">
          <text class="k">第三方绑定</text>
          <text class="v">{{ user.bindings.length ? user.bindings.join(' / ') : '暂无' }}</text>
        </view>
        <view class="row"><text class="k">主键样例</text><text class="v mono break">{{ user.id }}</text></view>
      </view>

      <view class="card">
        <text class="section">我的商城</text>
        <view class="quick">
          <view class="btn btn--ghost" @tap="go('/pages/mall/index')">去商城</view>
          <view class="btn btn--ghost" @tap="go('/pages/cart/index')">购物车</view>
          <view class="btn btn--ghost" @tap="go('/pages/orders/index')">我的订单</view>
        </view>
      </view>

      <view class="card">
        <text class="section">快捷入口</text>
        <view class="quick">
          <view class="btn btn--ghost" @tap="go('/pages/tools/ids')">ID 试算器</view>
          <view class="btn btn--ghost" @tap="go('/pages/settings/about')">关于与能力</view>
        </view>
      </view>

      <view class="danger" @tap="doLogout">退出登录</view>
    </block>

    <block v-else>
      <view class="empty">
        <text class="empty-title">还没有登录</text>
        <text class="hint">注册后即可获得一个专属 MixmAPP 号码，用于全端统一身份。</text>
        <view class="btn btn--primary mt" @tap="go('/pages/auth/register')">创建账号</view>
        <view class="btn btn--ghost mt" @tap="go('/pages/auth/login')">已有账号，去登录</view>
      </view>
    </block>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { session, logout, refreshProfile } from '../../stores/session';

const user = computed(() => session.user);
const createdText = computed(() =>
  user.value ? new Date(user.value.createdAt).toLocaleString() : '',
);

function go(url: string): void {
  uni.navigateTo({ url });
}

function copyId(): void {
  if (!user.value) return;
  uni.setClipboardData({
    data: user.value.accountNo,
    success: () => uni.showToast({ title: '已复制', icon: 'success' }),
  });
}

async function reload(): Promise<void> {
  try {
    await refreshProfile();
    uni.showToast({ title: '已刷新', icon: 'none' });
  } catch {
    uni.showToast({ title: '刷新失败，请重新登录', icon: 'none' });
  }
}

async function doLogout(): Promise<void> {
  await logout();
  uni.showToast({ title: '已退出', icon: 'none' });
}

onShow(() => {
  if (session.user) {
    void refreshProfile().catch(() => undefined);
  }
});
</script>

<style scoped lang="scss">
.page {
  padding: 32rpx;
}

.id-card {
  background: linear-gradient(140deg, #0b1220 0%, #16414a 70%, #0f9d8f 160%);
  border-radius: 32rpx;
  padding: 40rpx;
  box-shadow: 0 16rpx 40rpx rgba(11, 18, 32, 0.18);
}

.id-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.id-label {
  color: rgba(255, 255, 255, 0.66);
  font-size: 24rpx;
}

.pill {
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.85);
}

.id-value {
  display: block;
  margin-top: 22rpx;
  color: #ffffff;
  font-size: 40rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
  word-break: break-all;
}

.id-actions {
  display: flex;
  margin-top: 32rpx;
}

.small {
  height: 72rpx;
  padding: 0 28rpx;
  margin-right: 16rpx;
  font-size: 24rpx;
  background: rgba(255, 255, 255, 0.08);
  border: 1rpx solid rgba(255, 255, 255, 0.18);
  color: #ffffff;
}

.id-foot {
  display: block;
  margin-top: 24rpx;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.6);
}

.card {
  margin-top: 24rpx;
}

.section {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  margin-bottom: 18rpx;
}

.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18rpx 0;
  border-bottom: 1rpx solid #f1f5f9;
}

.row:last-child {
  border-bottom: none;
}

.k {
  font-size: 26rpx;
  color: #64748b;
  flex-shrink: 0;
  margin-right: 24rpx;
}

.v {
  font-size: 26rpx;
  color: #0b1220;
  text-align: right;
  flex: 1;
  word-break: break-all;
}

.break {
  font-size: 22rpx;
  color: #475569;
}

.quick {
  display: flex;
}

.quick .btn {
  flex: 1;
  margin-right: 16rpx;
  height: 80rpx;
  font-size: 26rpx;
}

.quick .btn:last-child {
  margin-right: 0;
}

.danger {
  margin-top: 40rpx;
  text-align: center;
  font-size: 26rpx;
  color: #dc2626;
  padding: 24rpx;
}

.empty {
  margin-top: 120rpx;
  text-align: center;
}

.empty-title {
  display: block;
  font-size: 40rpx;
  font-weight: 700;
}

.hint {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #94a3b8;
  line-height: 1.6;
}

.mt {
  margin-top: 32rpx;
}
</style>
