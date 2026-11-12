<template>
  <view class="page page--auth">
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
        <text class="label">账号</text>
        <input
          class="field"
          type="text"
          placeholder="邮箱、用户名或 MixmAPP 号码"
          placeholder-class="field-ph"
          v-model="account"
        />
        <text class="label mt">密码</text>
        <input
          class="field"
          password
          placeholder="请输入密码"
          placeholder-class="field-ph"
          v-model="password"
        />
      </block>

      <block v-else-if="mode === 'sms'">
        <text class="label">手机号</text>
        <input
          class="field"
          type="number"
          maxlength="11"
          placeholder="请输入手机号"
          placeholder-class="field-ph"
          v-model="phone"
        />
        <text class="label mt">验证码</text>
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
        <text v-if="devCode" class="dev-hint">开发态验证码：{{ devCode }}</text>
        <text class="hint mt-s">未注册的手机号登录时将自动创建账号。</text>
      </block>

      <block v-else>
        <text class="label">本机号码</text>
        <text class="hint">唤起本机号码认证后自动登录；未注册手机号会直接建号。</text>
        <input
          class="field mt"
          type="text"
          placeholder="本机号码认证凭证（开发态填 dev:手机号）"
          placeholder-class="field-ph"
          v-model="onekeyToken"
        />
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

      <view class="switch">
        <text class="switch-text">还没有账号？</text>
        <text class="link" @tap="goRegister">立即注册</text>
      </view>
    </view>

    <view class="sheet oauth">
      <text class="eyebrow">OAUTH</text>
      <text class="oauth-title">第三方登录</text>
      <text class="hint">H5 端授权回跳后自动携带 code；原生端需先配置对应 SDK。</text>
      <view class="oauth-grid">
        <view
          v-for="p in providers"
          :key="p.key"
          class="oauth-btn"
          hover-class="is-press"
          @tap="oauthLogin(p.key)"
        >
          <text class="oauth-name">{{ p.name }}</text>
          <text class="oauth-arrow mono">↗</text>
        </view>
      </view>
    </view>

    <text class="foot mono">MIXMAPP · SINGLE SIGN-ON</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { authApi, ApiError } from '../../api/client';
import { applyAuth, loginByOAuth, loginByPassword, loginBySms } from '../../stores/session';

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

const providers = [
  { key: 'github' as const, name: 'GitHub' },
  { key: 'wechat' as const, name: '微信' },
  { key: 'qq' as const, name: 'QQ' },
  { key: 'apple' as const, name: 'Apple' },
];

function goRegister(): void {
  uni.redirectTo({ url: '/pages/auth/register' });
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
    setTimeout(() => uni.redirectTo({ url: '/pages/me/index' }), 600);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '登录失败，请稍后重试';
  } finally {
    submitting.value = false;
  }
}

async function oauthLogin(provider: 'wechat' | 'qq' | 'github' | 'apple'): Promise<void> {
  try {
    const result = await loginByOAuth(provider);
    await applyAuth(result);
    uni.showToast({ title: '登录成功', icon: 'success' });
    setTimeout(() => uni.redirectTo({ url: '/pages/me/index' }), 600);
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '第三方登录不可用', icon: 'none' });
  }
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  padding: $sp-5 $sp-4 $sp-8;
}

.head {
  margin-bottom: $sp-4;
}

.title {
  display: block;
  margin-top: 16rpx;
  font-family: $font-display;
  font-size: 56rpx;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 1rpx;
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
  font-size: 26rpx;
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

.mt {
  margin-top: $sp-3;
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
  background: $ink;
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
  color: #f4f8f6;
}

.dev-hint {
  display: block;
  margin-top: 14rpx;
  font-size: $fs-micro;
  color: $amber;
}

.mt-s {
  margin-top: 16rpx;
}

.error-row {
  display: flex;
  align-items: flex-start;
  margin-top: $sp-3;
}

.error-mark {
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  background: $signal;
  color: #ffffff;
  font-size: 20rpx;
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

.submit {
  margin-top: $sp-5;
}

.submit-text {
  font-size: 30rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
  color: #f4f8f6;
}

.switch {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: $sp-3;
}

.switch-text {
  font-size: $fs-meta;
  color: $ink-3;
}

.link {
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
  font-weight: 600;
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
  background: #f7faf8;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.oauth-name {
  font-size: 26rpx;
  color: $ink;
}

.oauth-arrow {
  font-size: 22rpx;
  color: $ink-4;
}

.foot {
  display: block;
  margin-top: $sp-6;
  text-align: center;
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: $ink-4;
}
</style>
