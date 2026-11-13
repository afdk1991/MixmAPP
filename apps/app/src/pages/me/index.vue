<template>
  <view class="page">
    <mx-bar />
    <block v-if="user">
      <view class="pass">
        <view class="pass-foil" />
        <text class="pass-watermark mono">IF</text>
        <view class="pass-seal">
          <text class="pass-seal-text mono">FED</text>
        </view>

        <view class="pass-head">
          <view class="pass-brand">
            <text class="pass-kicker mono">INTERSTELLAR FEDERATION</text>
            <text class="pass-title">星际联邦通行证</text>
          </view>
          <view class="pass-state" :class="{ 'pass-state--guest': user.isGuest }">
            <text class="pass-state-text mono">{{ user.isGuest ? 'GUEST' : 'CITIZEN' }}</text>
          </view>
        </view>

        <text class="pass-label mono">MixmAPP 公民编号 / CITIZEN NO.</text>
        <text class="pass-no mono">{{ user.accountNo }}</text>
        <text class="pass-id mono">数字 ID · {{ user.id }}</text>

        <view class="pass-perf">
          <view class="notch notch--l" />
          <view class="notch notch--r" />
        </view>

        <view class="pass-meta">
          <view class="pass-cell">
            <text class="pass-k mono">持有人</text>
            <text class="pass-v">{{ user.nickname }}</text>
          </view>
          <view class="pass-cell">
            <text class="pass-k mono">签发星历</text>
            <text class="pass-v">{{ createdShort }}</text>
          </view>
          <view class="pass-cell">
            <text class="pass-k mono">通行终端</text>
            <text class="pass-v">6 ENDS</text>
          </view>
        </view>

        <view class="pass-actions">
          <view class="pass-btn" hover-class="is-press" @tap="copyId">
            <text class="pass-btn-text">复制编号</text>
          </view>
          <view class="pass-btn" hover-class="is-press" @tap="reload">
            <text class="pass-btn-text">刷新资料</text>
          </view>
        </view>
        <text class="pass-foot mono">该编号全局唯一，可直接作为登录账号使用</text>
      </view>

      <view class="sheet profile">
        <view class="profile-head">
          <text class="eyebrow">PROFILE</text>
          <text class="profile-title">账号资料</text>
        </view>
        <view class="row"><text class="k">昵称</text><text class="v">{{ user.nickname }}</text></view>
        <view class="row"><text class="k">用户名</text><text class="v">{{ user.username ?? '未设置' }}</text></view>
        <view class="row"><text class="k">MixmAPP 公民编号</text><text class="v v--mono mono">{{ user.accountNo }}</text></view>
        <view class="row"><text class="k">手机号</text><text class="v mono">{{ user.phone ?? '未绑定' }}</text></view>
        <view class="row"><text class="k">邮箱</text><text class="v">{{ user.email ?? '未绑定' }}</text></view>
        <view class="row"><text class="k">注册时间</text><text class="v mono">{{ createdText }}</text></view>
        <view class="row">
          <text class="k">第三方绑定</text>
          <text class="v">{{ bindingText }}</text>
        </view>
        <view class="row row--last">
          <text class="k">数字 ID</text>
          <text class="v v--mono mono">{{ user.id }}</text>
        </view>
      </view>

      <view v-if="user.isGuest" class="sheet upgrade">
        <text class="eyebrow">UPGRADE</text>
        <text class="upgrade-title">升级为正式账号</text>
        <text class="hint">补设用户名与密码后，换设备也能用「用户名 + 密码」登录。</text>
        <text class="label mt">用户名</text>
        <input
          class="field"
          type="text"
          maxlength="20"
          placeholder="用户名（2–20 个字符，中文/字母/数字/下划线）"
          placeholder-class="field-ph"
          v-model="upUsername"
        />
        <text class="label mt">密码</text>
        <input
          class="field"
          password
          placeholder="密码（至少 8 位，含字母与数字）"
          placeholder-class="field-ph"
          v-model="upPassword"
        />
        <text class="hint mt-s">不得使用管理员、官方、政府机关等名称。</text>
        <text v-if="upError" class="error">{{ upError }}</text>
        <view class="btn btn--deep btn--block mt-l" hover-class="is-press" @tap="upgradeGuest">
          <text class="btn-text">{{ upgrading ? '提交中…' : '设置用户名与密码' }}</text>
        </view>
      </view>

      <view class="sheet links">
        <text class="eyebrow">SHORTCUTS</text>
        <view class="link-row" hover-class="is-press" @tap="go(ROUTES.mall)">
          <text class="link-title">去商城</text>
          <text class="link-desc">商品 · 购物车 · 订单</text>
          <text class="link-arrow mono">→</text>
        </view>
        <view class="link-row" hover-class="is-press" @tap="go(ROUTES.cart)">
          <text class="link-title">购物车</text>
          <text class="link-desc">查看已选商品并结算</text>
          <text class="link-arrow mono">→</text>
        </view>
        <view class="link-row" hover-class="is-press" @tap="go(ROUTES.orders)">
          <text class="link-title">通行证订单</text>
          <text class="link-desc">下单后可查看进度</text>
          <text class="link-arrow mono">→</text>
        </view>
        <view class="link-row link-row--last" hover-class="is-press" @tap="go(ROUTES.about)">
          <text class="link-title">关于与能力</text>
          <text class="link-desc">能力矩阵与版本</text>
          <text class="link-arrow mono">→</text>
        </view>
      </view>

      <view class="logout" hover-class="is-press" @tap="doLogout">
        <text class="logout-text">退出登录</text>
      </view>
    </block>

    <block v-else>
      <view class="guest-hero">
        <text class="eyebrow eyebrow--light">NO CREDENTIAL</text>
        <text class="guest-title">登录 / 领取联邦通行证</text>
        <text class="guest-lede">登录已有通行证，或注册签发一张新的星际联邦通行证，并获得全局唯一的 MixmAPP 公民编号。</text>
      </view>

      <view class="guest-actions">
        <view class="btn btn--deep btn--block" hover-class="is-press" @tap="go(ROUTES.login)">
          <text class="btn-text">登录已有通行证</text>
        </view>
        <view class="btn btn--ghost btn--block mt-s" hover-class="is-press" @tap="go(ROUTES.register)">
          <text class="btn-text btn-text--dark">创建新的通行证</text>
        </view>
      </view>

      <view class="sheet links">
        <text class="eyebrow">BROWSE</text>
        <view class="link-row" hover-class="is-press" @tap="go(ROUTES.mall)">
          <text class="link-title">去商城</text>
          <text class="link-desc">商品 · 结算 · 订单</text>
          <text class="link-arrow mono">→</text>
        </view>
        <view class="link-row link-row--last" hover-class="is-press" @tap="go(ROUTES.about)">
          <text class="link-title">关于与能力</text>
          <text class="link-desc">能力矩阵与版本</text>
          <text class="link-arrow mono">→</text>
        </view>
      </view>
    </block>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { session, logout, refreshProfile } from '../../stores/session';
import { meApi, ApiError } from '../../api/client';
import { ROUTES } from '../../routes';

const user = computed(() => session.user);
const createdShort = computed(() => {
  if (!user.value) return '';
  const d = new Date(user.value.createdAt);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
});
const createdText = computed(() =>
  user.value ? new Date(user.value.createdAt).toLocaleString() : '',
);
const BINDING_LABEL: Record<string, string> = {
  github: 'GitHub',
  wechat: '微信',
  qq: 'QQ',
  apple: 'Apple',
  google: 'Google',
};
const bindingText = computed(() => {
  if (!user.value) return '';
  const list = user.value.bindings;
  if (!list.length) return '暂无';
  return list.map((b) => BINDING_LABEL[b] ?? b).join(' / ');
});
const upUsername = ref('');
const upPassword = ref('');
const upError = ref('');
const upgrading = ref(false);

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

async function upgradeGuest(): Promise<void> {
  if (upgrading.value) return;
  upError.value = '';
  upgrading.value = true;
  try {
    await meApi.bindUsername(upUsername.value.trim(), upPassword.value);
    await refreshProfile();
    uni.showToast({ title: '已升级为正式账号', icon: 'none' });
  } catch (e) {
    upError.value = e instanceof ApiError ? e.message : '设置失败，请稍后重试';
  } finally {
    upgrading.value = false;
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
  min-height: 100vh;
  background: $paper;
  padding: $sp-4 $sp-3 $sp-8;
}

/* ---------- 通行证 ---------- */
.pass {
  position: relative;
  overflow: hidden;
  padding: $sp-4;
  background:
    radial-gradient(130% 100% at 92% -16%, rgba(15, 157, 143, 0.3), rgba(15, 157, 143, 0) 56%),
    radial-gradient(90% 80% at 0% 110%, rgba(244, 244, 241, 0.05), rgba(244, 244, 241, 0) 60%),
    linear-gradient(152deg, #0b0f0e 0%, #11201d 58%, #16302a 128%);
  border: 1rpx solid rgba(244, 244, 241, 0.16);
  border-radius: $r-shell;
  box-shadow: 0 24rpx 56rpx -28rpx rgba(11, 15, 14, 0.5);
}

.pass-foil {
  position: absolute;
  top: -40%;
  left: 0;
  width: 30%;
  height: 180%;
  background: linear-gradient(90deg, rgba(143, 233, 221, 0), rgba(143, 233, 221, 0.1), rgba(143, 233, 221, 0));
  animation: foil 9s ease-in-out 1s infinite;
  pointer-events: none;
}

.pass-watermark {
  position: absolute;
  right: -10rpx;
  bottom: -26rpx;
  font-size: 130rpx;
  line-height: 1;
  letter-spacing: 6rpx;
  color: rgba(244, 244, 241, 0.06);
}

.pass-seal {
  position: absolute;
  right: -56rpx;
  bottom: 44rpx;
  z-index: 1;
  width: 220rpx;
  height: 220rpx;
  border: 2rpx solid rgba(244, 244, 241, 0.14);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.pass-seal-text {
  font-size: 56rpx;
  letter-spacing: 6rpx;
  color: rgba(244, 244, 241, 0.14);
}

.pass-head {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.pass-kicker {
  display: block;
  font-size: 24rpx;
  letter-spacing: 2.4rpx;
  color: rgba(244, 244, 241, 0.55);
}

.pass-title {
  display: block;
  margin-top: 10rpx;
  font-family: $font-display;
  font-size: 44rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: #f4f4f1;
}

.pass-state {
  padding: 6rpx 16rpx;
  border: 1rpx solid rgba(244, 244, 241, 0.2);
  border-radius: $r-pill;
}

.pass-state--guest {
  border-color: rgba(224, 169, 99, 0.55);
}

.pass-state--guest .pass-state-text {
  color: #e0a963;
}

.pass-state-text {
  font-size: 24rpx;
  letter-spacing: 2rpx;
  color: rgba(244, 244, 241, 0.8);
}

.pass-label {
  position: relative;
  z-index: 2;
  display: block;
  margin-top: $sp-6;
  font-size: 24rpx;
  letter-spacing: 2rpx;
  color: rgba(196, 219, 255, 0.48);
}

.pass-no {
  position: relative;
  z-index: 2;
  display: block;
  margin-top: 10rpx;
  font-size: 36rpx;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0;
  color: #f3f8ff;
  word-break: break-all;
}

.pass-id {
  position: relative;
  z-index: 2;
  display: block;
  margin-top: 6rpx;
  font-size: 24rpx;
  letter-spacing: 1rpx;
  color: rgba(196, 219, 255, 0.56);
  word-break: break-all;
}

.pass-perf {
  position: relative;
  height: 1rpx;
  margin: $sp-4 (-$sp-4) $sp-3;
  border-top: 1rpx dashed rgba(226, 213, 180, 0.22);
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

.pass-meta {
  position: relative;
  z-index: 2;
  display: flex;
}

.pass-cell {
  flex: 1;
  min-width: 0;
}

.pass-k {
  display: block;
  font-size: 24rpx;
  letter-spacing: 2rpx;
  color: rgba(196, 219, 255, 0.44);
}

.pass-v {
  display: block;
  margin-top: 8rpx;
  font-size: 28rpx;
  color: rgba(240, 247, 255, 0.92);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pass-actions {
  position: relative;
  z-index: 2;
  display: flex;
  margin-top: $sp-4;
}

.pass-btn {
  height: 68rpx;
  padding: 0 26rpx;
  margin-right: 14rpx;
  border: 1rpx solid rgba(240, 201, 124, 0.32);
  border-radius: $r-pill;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pass-btn-text {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: #f4f4f1;
}

.pass-foot {
  position: relative;
  z-index: 2;
  display: block;
  max-width: 74%;
  margin-top: $sp-3;
  font-size: 24rpx;
  letter-spacing: 0.5rpx;
  color: rgba(196, 219, 255, 0.46);
}

/* ---------- 资料 ---------- */
.profile {
  margin-top: $sp-4;
  padding: $sp-4 $sp-4 8rpx;
}

.profile-head {
  padding-bottom: $sp-3;
  border-bottom: 1rpx solid $paper-2;
}

.profile-title {
  display: block;
  margin-top: 10rpx;
  font-family: $font-display;
  font-size: $fs-h2;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
}

.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 22rpx 0;
  border-bottom: 1rpx solid $paper-2;
}

.row--last {
  border-bottom: none;
}

.k {
  flex-shrink: 0;
  margin-right: $sp-3;
  font-size: 24rpx;
  color: $ink-3;
}

.v {
  flex: 1;
  font-size: 28rpx;
  line-height: 1.5;
  color: $ink;
  text-align: right;
  word-break: break-all;
}

.v--mono {
  font-size: 24rpx;
  color: $ink-3;
}

/* ---------- 升级 ---------- */
.upgrade {
  margin-top: $sp-3;
  padding: $sp-4;
}

.upgrade-title {
  display: block;
  margin-top: 12rpx;
  font-family: $font-display;
  font-size: $fs-h2;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
}

.upgrade .hint {
  margin-top: 10rpx;
}

.mt {
  margin-top: $sp-3;
}

.mt-s {
  margin-top: 16rpx;
}

.mt-l {
  margin-top: $sp-4;
}

.btn-text {
  font-size: 28rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
  color: #f4f8f6;
}

.btn-text--dark {
  color: $ink;
}

.error {
  display: block;
  margin-top: 16rpx;
  font-size: $fs-meta;
  color: $signal;
}

/* ---------- 快捷入口 ---------- */
.links {
  margin-top: $sp-3;
  padding: $sp-4 $sp-4 8rpx;
}

.link-row {
  display: flex;
  align-items: center;
  padding: $sp-3 0;
  border-bottom: 1rpx solid $paper-2;
}

.link-row--last {
  border-bottom: none;
}

.link-title {
  font-family: $font-display;
  font-size: 32rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
  flex-shrink: 0;
}

.link-desc {
  flex: 1;
  margin-left: $sp-3;
  font-size: 24rpx;
  color: $ink-3;
  text-align: right;
}

.link-arrow {
  margin-left: 14rpx;
  font-size: 24rpx;
  color: $ink-4;
}

/* ---------- 退出 ---------- */
.logout {
  margin-top: $sp-5;
  padding: $sp-3;
  text-align: center;
}

.logout-text {
  font-size: 24rpx;
  letter-spacing: 1rpx;
  color: $signal;
}

/* ---------- 未登录 ---------- */
.guest-hero {
  padding: $sp-6 $sp-5;
  background:
    radial-gradient(120% 90% at 88% -14%, rgba(15, 157, 143, 0.24), rgba(15, 157, 143, 0) 58%),
    linear-gradient(158deg, #08110f 0%, #0e2925 100%);
  border-radius: $r-shell;
}

.eyebrow--light {
  color: rgba(242, 245, 243, 0.6);
}

.guest-title {
  display: block;
  margin-top: $sp-4;
  font-family: $font-display;
  font-size: 56rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: 1.25;
  letter-spacing: 2rpx;
  color: #f4f8f6;
}

.guest-lede {
  display: block;
  margin-top: $sp-3;
  font-size: 28rpx;
  line-height: 1.7;
  color: rgba(242, 245, 243, 0.66);
}

.guest-actions {
  margin-top: $sp-4;
}
</style>
