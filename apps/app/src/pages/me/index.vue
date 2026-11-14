<template>
  <view class="page">
    <mx-bar />
    <block v-if="user">
      <!-- ---------- 深场通行证：页面唯一强视觉块，下沿直接切纸面 ---------- -->
      <view class="pass">
        <view class="pass-foil" />

        <view class="pass-head">
          <mx-logo size="md" tone="light" sub="INTERSTELLAR FEDERATION" />
          <view class="tag tag--dark pass-state" :class="{ 'pass-state--guest': user.isGuest }">
            <text class="pass-state-text mono">{{ user.isGuest ? 'GUEST' : 'CITIZEN' }}</text>
          </view>
        </view>

        <text class="pass-label mono">公民编号 / CITIZEN NO.</text>
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

      <!-- ---------- 身份 ---------- -->
      <view class="sec">
        <view class="sec-head">
          <text class="eyebrow">IDENTITY</text>
          <text class="sec-title">身份</text>
        </view>
        <view class="rule" />
        <view class="row">
          <text class="k">昵称</text>
          <text class="v">{{ user.nickname }}</text>
        </view>
        <view class="row">
          <text class="k">用户名</text>
          <text class="v">{{ user.username ?? '未设置' }}</text>
        </view>
        <view class="row">
          <text class="k">手机号</text>
          <text class="v mono">{{ user.phone ?? '未绑定' }}</text>
        </view>
        <view class="row">
          <text class="k">邮箱</text>
          <text class="v">{{ user.email ?? '未绑定' }}</text>
        </view>
        <view class="row" :class="{ 'row--last': !user.bindings.length }">
          <text class="k">第三方绑定</text>
          <text class="v">{{ bindingText }}</text>
        </view>
        <view v-if="user.bindings.length" class="bind-actions">
          <text
            v-for="b in user.bindings"
            :key="b"
            class="bind-chip mono"
            @tap="unbind(b)"
          >解绑 {{ bindingLabel(b) }}</text>
        </view>
      </view>

      <!-- ---------- 资产 ---------- -->
      <view class="sec">
        <view class="sec-head">
          <text class="eyebrow">ASSETS</text>
          <text class="sec-title">资产</text>
        </view>
        <view class="rule" />
        <view class="row">
          <text class="k">通行证公民编号</text>
          <text class="v v--mono mono">{{ user.accountNo }}</text>
        </view>
        <view class="row">
          <text class="k">数字 ID</text>
          <text class="v v--mono mono">{{ user.id }}</text>
        </view>
        <view class="row row--last">
          <text class="k">注册时间</text>
          <text class="v mono">{{ createdText }}</text>
        </view>
      </view>

      <!-- ---------- 游客升级 ---------- -->
      <view v-if="user.isGuest" class="sec upgrade">
        <view class="sec-head">
          <text class="eyebrow">UPGRADE</text>
          <text class="sec-title">升级为正式账号</text>
        </view>
        <view class="rule" />
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

      <!-- ---------- 入口 ---------- -->
      <view class="sec">
        <view class="sec-head">
          <text class="eyebrow">ENTRIES</text>
          <text class="sec-title">入口</text>
        </view>
        <view class="rule" />
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
        <view class="link-row" hover-class="is-press" @tap="go(ROUTES.legalPrivacy)">
          <text class="link-title">隐私政策与权限说明</text>
          <text class="link-desc">收集范围 · 权限用途 · 你的权利</text>
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
      <view class="guest">
        <text class="eyebrow">NO CREDENTIAL</text>
        <text class="guest-title">登录 / 领取联邦通行证</text>
        <text class="guest-lede">登录已有通行证，或注册即签发星际联邦通行证，并分配唯一的 MixmAPP 星际联邦通行证公民编号。</text>
      </view>

      <view class="guest-actions">
        <view class="btn btn--deep btn--block" hover-class="is-press" @tap="go(ROUTES.login)">
          <text class="btn-text">登录已有通行证</text>
        </view>
        <view class="btn btn--ghost btn--block mt-s" hover-class="is-press" @tap="go(ROUTES.register)">
          <text class="btn-text btn-text--dark">创建新的通行证</text>
        </view>
      </view>

      <view class="sec">
        <view class="sec-head">
          <text class="eyebrow">BROWSE</text>
        </view>
        <view class="rule" />
        <view class="link-row" hover-class="is-press" @tap="go(ROUTES.mall)">
          <text class="link-title">去商城</text>
          <text class="link-desc">商品 · 结算 · 订单</text>
          <text class="link-arrow mono">→</text>
        </view>
        <view class="link-row" hover-class="is-press" @tap="go(ROUTES.legalPrivacy)">
          <text class="link-title">隐私政策与权限说明</text>
          <text class="link-desc">收集范围 · 权限用途 · 你的权利</text>
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
import type { OAuthProviderKey } from '@mixmapp/contracts';
import { session, logout, refreshProfile } from '../../stores/session';
import { meApi, ApiError } from '../../api/client';
import { ROUTES } from '../../routes';
import { goTo } from '../../navigation';
import MxLogo from '../../components/mx-logo/mx-logo.vue';

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
  wechat: '微信',
  wechat_mp: '微信公众号',
  qq: 'QQ',
  weibo: '微博',
  alipay: '支付宝',
  douyin: '抖音',
  dingtalk: '钉钉',
  wecom: '企业微信',
  apple: 'Apple',
  google: 'Google',
  facebook: 'Facebook',
  github: 'GitHub',
  gitee: 'Gitee',
};

function bindingLabel(key: string): string {
  return BINDING_LABEL[key] ?? key;
}
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
  goTo(url);
}

function copyId(): void {
  if (!user.value) return;
  uni.setClipboardData({
    data: user.value.accountNo,
    success: () => uni.showToast({ title: '已复制', icon: 'success' }),
  });
}

/** 解绑前二次确认；服务端会拒绝「解绑后没有任何登录方式」的操作。 */
function unbind(provider: string): void {
  uni.showModal({
    title: '解绑确认',
    content: `确定解绑 ${bindingLabel(provider)}？解绑后将不能用它登录。`,
    success: async (res) => {
      if (!res.confirm) return;
      try {
        await meApi.unbindOAuth(provider as OAuthProviderKey);
        await refreshProfile();
        uni.showToast({ title: '已解绑', icon: 'none' });
      } catch (e) {
        uni.showToast({ title: e instanceof ApiError ? e.message : '解绑失败', icon: 'none' });
      }
    },
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
  /* tabBar 页面：为原生底部标签栏留安全距离 */
  padding: $sp-4 $sp-3 calc(140rpx + env(safe-area-inset-bottom));
}

/* ---------- 深场通行证 ---------- */
.pass {
  position: relative;
  overflow: hidden;
  padding: $sp-4;
  background:
    radial-gradient(130% 100% at 92% -16%, rgba(15, 157, 143, 0.3), rgba(15, 157, 143, 0) 56%),
    radial-gradient(90% 80% at 0% 110%, rgba(244, 244, 241, 0.05), rgba(244, 244, 241, 0) 60%),
    linear-gradient(152deg, #0b0f0e 0%, #11201d 58%, #16302a 128%);
  border: 1rpx solid $on-deep-line;
  border-radius: $r-shell $r-shell 0 0;
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

.pass-head {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.pass-state {
  border-radius: $r-pill;
}

.pass-state--guest {
  border-color: rgba(224, 169, 99, 0.55);
}

.pass-state--guest .pass-state-text {
  color: $amber-on-deep;
}

.pass-state-text {
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $on-deep-2;
}

.pass-label {
  position: relative;
  z-index: 2;
  display: block;
  margin-top: $sp-6;
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $on-deep-3;
}

.pass-no {
  position: relative;
  z-index: 2;
  display: block;
  margin-top: 10rpx;
  font-size: 40rpx;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0;
  color: $on-deep;
  word-break: break-all;
}

.pass-id {
  position: relative;
  z-index: 2;
  display: block;
  margin-top: 6rpx;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $on-deep-3;
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
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $on-deep-3;
}

.pass-v {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  margin-top: 8rpx;
  font-size: $fs-meta;
  line-height: 1.35;
  color: $on-deep;
  overflow: hidden;
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
  border-radius: $r-control;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pass-btn-text {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $on-deep;
}

.pass-foot {
  position: relative;
  z-index: 2;
  display: block;
  max-width: 74%;
  margin-top: $sp-3;
  font-size: $fs-micro;
  letter-spacing: 0.5rpx;
  color: $on-deep-3;
}

/* ---------- 分节（身份 / 资产 / 入口） ---------- */
.sec {
  margin-top: $sp-5;
}

.sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: $sp-2;
}

.sec-title {
  display: block;
  margin-top: 10rpx;
  font-family: $font-display;
  font-size: $fs-h2;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
}

.rule {
  height: 1rpx;
  background: $paper-3;
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

.bind-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  padding: 0 0 18rpx;
}

.bind-chip {
  padding: 8rpx 18rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  font-size: $fs-micro;
  color: $ink-3;
  background: $shell;
}

.k {
  flex-shrink: 0;
  margin-right: $sp-3;
  font-size: $fs-micro;
  color: $ink-3;
}

.v {
  flex: 1;
  font-size: $fs-meta;
  line-height: 1.5;
  color: $ink;
  text-align: right;
  word-break: break-all;
}

.v--mono {
  font-size: $fs-micro;
  line-height: 1.45;
  letter-spacing: 0;
  color: $ink-3;
}

/* ---------- 升级 ---------- */
.upgrade {
  .hint {
    margin-top: 12rpx;
  }
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
  font-size: $fs-meta;
  font-weight: 600;
  letter-spacing: 2rpx;
  /* 只用于 .btn--deep（底色 $solid）：深色下底色变浅，文字必须跟着切到 $on-solid */
  color: $on-solid;
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

/* ---------- 入口行：发丝线分隔，不叠卡片 ---------- */
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
  font-size: $fs-h3;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
  flex-shrink: 0;
}

.link-desc {
  flex: 1;
  margin-left: $sp-3;
  font-size: $fs-micro;
  color: $ink-3;
  text-align: right;
}

.link-arrow {
  margin-left: 14rpx;
  font-size: $fs-micro;
  color: $ink-4;
}

/* ---------- 退出 ---------- */
.logout {
  margin-top: $sp-5;
  padding: $sp-3;
  text-align: center;
}

.logout-text {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $signal;
}

/* ---------- 未登录（纸面） ---------- */
.guest {
  padding: $sp-5 0 $sp-3;
}

.guest-title {
  display: block;
  margin-top: $sp-3;
  font-family: $font-display;
  font-size: $fs-h1;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: 1.25;
  color: $ink;
}

.guest-lede {
  display: block;
  margin-top: $sp-3;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-3;
}

.guest-actions {
  margin-top: $sp-4;
}

/* 窄屏通行证编号降一级，避免 24 位编号被折断 */
@media (max-width: 420px) {
  .pass-no {
    font-size: 36rpx;
  }
}
</style>
