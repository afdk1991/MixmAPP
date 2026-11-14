<template>
  <view class="page page--auth">
    <mx-bar compact />

    <view class="brand">
      <mx-logo size="md" tone="ink" sub="MIXMAPP ACCOUNT" />
      <text class="brand-note mono">SINGLE SIGN-ON · 多端通行同一账号</text>
    </view>

    <view class="head">
      <text class="eyebrow">SIGN IN</text>
      <text class="title">欢迎回来</text>
      <text class="hint">支持邮箱、用户名、MixmAPP 号码登录；也可用手机验证码或本机号码一键登录。</text>
    </view>

    <view class="mode">
      <view class="mode-tab" :class="{ 'mode-tab--on': mode === 'password' }" @tap="mode = 'password'">
        <text class="mode-label">密码</text>
        <view class="mode-line" />
      </view>
      <view class="mode-tab" :class="{ 'mode-tab--on': mode === 'sms' }" @tap="mode = 'sms'">
        <text class="mode-label">验证码</text>
        <view class="mode-line" />
      </view>
      <view class="mode-tab" :class="{ 'mode-tab--on': mode === 'onekey' }" @tap="mode = 'onekey'">
        <text class="mode-label">一键登录</text>
        <view class="mode-line" />
      </view>
    </view>

    <view class="sheet form">
      <block v-if="mode === 'password'">
        <view class="field-block">
          <text class="label">账号</text>
          <input
            class="field"
            type="text"
            placeholder="邮箱、用户名或 MixmAPP 号码"
            placeholder-class="field-ph"
            v-model="account"
          />
        </view>
        <view class="field-block">
          <text class="label">密码</text>
          <input
            class="field"
            password
            placeholder="请输入密码"
            placeholder-class="field-ph"
            v-model="password"
          />
        </view>
      </block>

      <block v-else-if="mode === 'sms'">
        <view class="field-block">
          <text class="label">手机号</text>
          <input
            class="field"
            type="number"
            maxlength="11"
            placeholder="请输入手机号"
            placeholder-class="field-ph"
            v-model="phone"
          />
        </view>
        <view class="field-block">
          <text class="label">验证码</text>
          <view class="code-row">
            <input
              class="field code-input"
              type="number"
              maxlength="6"
              placeholder="6 位验证码"
              placeholder-class="field-ph"
              v-model="code"
            />
            <view
              class="code-btn"
              :class="{ 'code-btn--off': counting || sending }"
              hover-class="is-press"
              @tap="sendCode"
            >
              <text class="code-btn-text mono">
                {{ counting ? `${countdown}s` : sending ? '发送中' : '获取验证码' }}
              </text>
            </view>
          </view>
        </view>
        <text v-if="devCode" class="dev-hint">开发态验证码：{{ devCode }}</text>
        <text class="hint note">未注册的手机号登录时将自动创建账号。</text>
      </block>

      <block v-else>
        <view class="field-block">
          <text class="label">本机号码</text>
          <text class="hint note">唤起本机号码认证后自动登录；未注册手机号会直接建号。</text>
          <input
            class="field"
            type="text"
            placeholder="本机号码认证凭证（开发态填 dev:手机号）"
            placeholder-class="field-ph"
            v-model="onekeyToken"
          />
        </view>
      </block>

      <view v-if="error" class="error-row">
        <text class="error-mark mono">!</text>
        <text class="error-text">{{ error }}</text>
      </view>

      <view
        class="btn btn--deep btn--block submit"
        :class="{ 'btn--disabled': submitting }"
        hover-class="is-press"
        @tap="submit"
      >
        <text class="submit-text">{{ submitting ? '登录中…' : '登录' }}</text>
      </view>

      <view class="secondary">
        <text class="secondary-text">还没有账号？</text>
        <text class="secondary-link" @tap="goRegister">立即注册</text>
      </view>
    </view>

    <view v-if="visibleProviders.length" class="sheet oauth">
      <text class="eyebrow">OAUTH</text>
      <text class="oauth-title">第三方登录</text>
      <text class="hint">仅展示已开通的渠道；未配置的渠道不会出现在这里。</text>
      <view class="oauth-grid">
        <view
          v-for="p in visibleProviders"
          :key="p.key"
          class="oauth-btn"
          hover-class="is-press"
          @tap="oauthLogin(p)"
        >
          <text class="oauth-name">{{ p.label }}</text>
          <text class="oauth-arrow mono">↗</text>
        </view>
      </view>
    </view>
    <text v-else-if="providersFailed" class="oauth-note">第三方登录服务暂不可达，请稍后重试</text>

    <text class="foot mono">MIXMAPP · SINGLE SIGN-ON</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import type { OAuthProviderKey } from '@mixmapp/contracts';
import {
  authApi,
  ApiError,
  oauthApi,
  oauthStartUrl,
  type OAuthProviderOption,
} from '../../api/client';
import {
  applyAuth,
  getOAuthError,
  getOAuthProvider,
  getPostLoginTarget,
  loginByOAuth,
  loginByPassword,
  loginBySms,
} from '../../stores/session';
import { ROUTES } from '../../routes';
import MxLogo from '../../components/mx-logo/mx-logo.vue';

const H5 = typeof window !== 'undefined';
const TAB_ROUTES = new Set<string>([ROUTES.home, ROUTES.mall, ROUTES.cart, ROUTES.me]);

const mode = ref<'password' | 'sms' | 'onekey'>('password');
const account = ref('');
const password = ref('');
const phone = ref('');
const code = ref('');
const onekeyToken = ref('');
const devCode = ref('');
const error = ref('');
const submitting = ref(false);
const sending = ref(false);
const counting = ref(false);
const countdown = ref(0);

/** 服务端只下发已配置渠道；前端不再维护静态渠道表或「未启用」占位按钮。 */
const providers = ref<OAuthProviderOption[]>([]);
const providersFailed = ref(false);

/** 微信内才展示公众号授权入口，普通浏览器走扫码渠道。 */
function isWechatBrowser(): boolean {
  return H5 && /MicroMessenger/i.test(navigator.userAgent);
}

const visibleProviders = computed(() =>
  H5
    ? providers.value.filter((p) => p.h5 && (p.key !== 'wechat_mp' || isWechatBrowser()))
    : [],
);

async function loadProviders(): Promise<void> {
  try {
    const res = await oauthApi.providers();
    providers.value = res.providers;
    providersFailed.value = false;
  } catch {
    providers.value = [];
    providersFailed.value = true;
  }
}

function readOAuthReturn(): void {
  if (!H5) return;
  const oauthError = getOAuthError();
  if (oauthError) {
    error.value = `第三方授权被取消或失败：${oauthError}`;
    return;
  }
  const provider = getOAuthProvider();
  if (provider && new URLSearchParams(window.location.search).get('code')) {
    void completeOAuth(provider);
  }
}

onMounted(() => {
  void loadProviders();
  readOAuthReturn();
});

function goRegister(): void {
  uni.redirectTo({ url: ROUTES.register });
}

/** 登录成功后回到发起登录前的目标页；只接受站内路径。 */
function goAfterLogin(): void {
  const target = getPostLoginTarget();
  if (!target) {
    uni.switchTab({ url: ROUTES.me });
    return;
  }
  const path = target.split('?')[0] ?? '';
  if (TAB_ROUTES.has(path)) uni.switchTab({ url: path });
  else uni.reLaunch({ url: target });
}

async function completeOAuth(provider: OAuthProviderKey): Promise<void> {
  try {
    const result = await loginByOAuth(provider);
    uni.showToast({ title: result.isNewUser ? '已创建账号' : '登录成功', icon: 'none' });
    setTimeout(goAfterLogin, 600);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '第三方登录失败，请稍后重试';
  }
}

async function sendCode(): Promise<void> {
  if (counting.value || sending.value) return;
  if (!/^1[3-9]\d{9}$/.test(phone.value)) {
    error.value = '请输入正确的手机号';
    return;
  }
  sending.value = true;
  error.value = '';
  try {
    const res = await authApi.requestSmsCode(phone.value, 'login');
    if (res.devCode) devCode.value = res.devCode;
    counting.value = true;
    countdown.value = 60;
    const timer = setInterval(() => {
      countdown.value -= 1;
      if (countdown.value <= 0) {
        clearInterval(timer);
        counting.value = false;
      }
    }, 1000);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '发送失败';
  } finally {
    sending.value = false;
  }
}

async function submit(): Promise<void> {
  if (submitting.value) return;
  error.value = '';
  submitting.value = true;
  try {
    const result =
      mode.value === 'password'
        ? await loginByPassword(account.value.trim(), password.value)
        : mode.value === 'sms'
          ? await loginBySms(phone.value, code.value)
          : await authApi.oneKey({ token: onekeyToken.value }).then(async (data) => {
              await applyAuth(data);
              return data;
            });
    uni.showToast({ title: result.user.accountNo, icon: 'none' });
    setTimeout(goAfterLogin, 600);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '登录失败，请稍后重试';
  } finally {
    submitting.value = false;
  }
}

function oauthLogin(provider: OAuthProviderOption): void {
  if (!H5) {
    uni.showToast({ title: '该端请在对应 App 内接入 SDK 后使用', icon: 'none' });
    return;
  }
  window.location.assign(oauthStartUrl(provider.key));
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  padding: $sp-5 $sp-4 $sp-8;
}

/* ---------- 品牌区 ---------- */
.brand {
  display: flex;
  flex-direction: column;
  gap: $sp-2;
  margin-bottom: $sp-5;
}

.brand-note {
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  color: $ink-4;
}

/* ---------- 页眉 ---------- */
.head {
  margin-bottom: $sp-4;
}

.title {
  display: block;
  margin-top: 18rpx;
  font-family: $font-display;
  font-size: $fs-h1;
  font-weight: 800;
  line-height: $lh-tight;
  letter-spacing: $ls-tight;
  color: $ink;
}

.head .hint {
  margin-top: 14rpx;
}

/* ---------- 模式切换 ---------- */
.mode {
  display: flex;
  margin-bottom: $sp-4;
  border-bottom: 1rpx solid $paper-3;
}

.mode-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.mode-label {
  padding: 20rpx 0 16rpx;
  font-family: $font-mono;
  font-size: $fs-meta;
  letter-spacing: 0.5rpx;
  color: $ink-3;
}

.mode-tab--on .mode-label {
  color: $ink;
  font-weight: 600;
}

.mode-line {
  width: 64rpx;
  height: 3rpx;
  border-radius: 3rpx;
  background: transparent;
}

.mode-tab--on .mode-line {
  background: $brand;
}

/* ---------- 表单 ---------- */
.form {
  padding: $sp-4;
}

.field-block {
  & + .field-block {
    margin-top: $sp-3;
  }
}

.note {
  margin-top: 12rpx;
}

.code-row {
  display: flex;
  align-items: center;
}

.code-input {
  flex: 1;
}

.code-btn {
  margin-left: 14rpx;
  height: 96rpx;
  padding: 0 24rpx;
  border-radius: $r-control;
  background: $solid;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.code-btn--off {
  opacity: 0.45;
}

.code-btn-text {
  font-size: $fs-micro;
  letter-spacing: 0.5rpx;
  color: $on-solid;
}

.dev-hint {
  display: block;
  margin-top: 14rpx;
  font-size: $fs-micro;
  color: $amber;
}

/* ---------- 错误提示：字段下方就近显示 ---------- */
.error-row {
  display: flex;
  align-items: flex-start;
  margin-top: $sp-3;
  padding: 16rpx 18rpx;
  border: 1rpx solid rgba(179, 55, 42, 0.28);
  border-radius: $r-control;
  background: $shell;
}

.error-mark {
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  background: $signal;
  color: $shell;
  font-size: 26rpx;
  line-height: 32rpx;
  text-align: center;
  margin-right: 12rpx;
  flex-shrink: 0;
}

.error-text {
  flex: 1;
  font-size: $fs-meta;
  line-height: 1.5;
  color: $signal;
}

/* ---------- 主按钮 + 次要操作 ---------- */
.submit {
  margin-top: $sp-4;
}

.submit-text {
  font-size: $fs-body;
  font-weight: 800;
  letter-spacing: 2rpx;
  /* .submit 是 .btn--deep（底色 $solid）：深色下底色变浅，文字必须用 $on-solid */
  color: $on-solid;
}

.secondary {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: $sp-4;
}

.secondary-text {
  font-size: $fs-meta;
  color: $ink-3;
}

.secondary-link {
  margin-left: 8rpx;
  font-size: $fs-meta;
  font-weight: 600;
  color: $brand-deep;
}

/* ---------- 第三方 ---------- */
.oauth {
  margin-top: $sp-3;
  padding: $sp-4;
}

.oauth-title {
  display: block;
  margin-top: 12rpx;
  font-family: $font-display;
  font-size: $fs-h2;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
}

.oauth .hint {
  margin-top: 10rpx;
}

.oauth-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  margin-top: $sp-3;
}

.oauth-btn {
  width: 48.5%;
  height: 88rpx;
  margin-bottom: 14rpx;
  padding: 0 24rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  background: $shell;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.oauth-name {
  font-size: $fs-meta;
  color: $ink;
}

.oauth-arrow {
  font-size: $fs-micro;
  color: $ink-4;
}

.oauth-btn--off {
  opacity: 0.55;
}

.oauth-off {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-4;
}

.oauth-note {
  display: block;
  margin-top: 8rpx;
  font-size: $fs-micro;
  color: $ink-4;
}

.foot {
  display: block;
  margin-top: $sp-6;
  text-align: center;
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $ink-4;
}
</style>
