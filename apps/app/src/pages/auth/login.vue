<template>
  <view class="page">
    <view class="head">
      <text class="title">欢迎回来</text>
      <text class="hint">支持邮箱、MIX 号码登录；也可用手机验证码免密登录。</text>
    </view>

    <view class="tabs">
      <view class="tab" :class="{ 'tab--on': mode === 'password' }" @tap="mode = 'password'">密码</view>
      <view class="tab" :class="{ 'tab--on': mode === 'sms' }" @tap="mode = 'sms'">验证码</view>
    </view>

    <view class="card form">
      <block v-if="mode === 'password'">
        <text class="label">账号</text>
        <input class="field" type="text" placeholder="邮箱或 MIX-XXXX-XXXX-XXXX-X" v-model="account" />
        <text class="label mt">密码</text>
        <input class="field" password placeholder="请输入密码" v-model="password" />
      </block>

      <block v-else>
        <text class="label">手机号</text>
        <input class="field" type="number" maxlength="11" placeholder="请输入手机号" v-model="phone" />
        <view class="code-row">
          <input class="field code-input" type="number" maxlength="6" placeholder="验证码" v-model="code" />
          <view class="code-btn" :class="{ 'code-btn--off': counting || sending }" @tap="sendCode">
            {{ counting ? `${countdown}s` : sending ? '发送中' : '获取验证码' }}
          </view>
        </view>
        <text v-if="devCode" class="dev-hint">开发态验证码：{{ devCode }}</text>
        <text class="hint mt-inline">未注册的手机号登录时将自动创建账号。</text>
      </block>

      <text v-if="error" class="error">{{ error }}</text>

      <view class="btn btn--primary submit" :class="{ 'btn--disabled': submitting }" @tap="submit">
        {{ submitting ? '登录中…' : '登录' }}
      </view>

      <view class="switch">
        <text class="hint">还没有账号？</text>
        <text class="link" @tap="goRegister">立即注册</text>
      </view>
    </view>

    <view class="card oauth">
      <text class="section">第三方登录</text>
      <text class="hint">H5 端授权回跳后自动携带 code；原生端需先配置对应 SDK。</text>
      <view class="oauth-row">
        <view v-for="p in providers" :key="p.key" class="oauth-btn" @tap="oauthLogin(p.key)">
          <text class="oauth-name">{{ p.name }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { authApi, ApiError } from '../../api/client';
import { applyAuth, loginByOAuth, loginByPassword, loginBySms } from '../../stores/session';

const mode = ref<'password' | 'sms'>('password');
const account = ref('');
const password = ref('');
const phone = ref('');
const code = ref('');
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
        : await loginBySms(phone.value, code.value);
    uni.showToast({ title: result.user.accountNo, icon: 'none' });
    setTimeout(() => uni.redirectTo({ url: '/pages/me/index' }), 600);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '登录失败，请稍后重试';
  } finally {
    submitting.value = false;
  }
}

async function oauthLogin(provider: 'wechat' | 'qq' | 'github'): Promise<void> {
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
  padding: 40rpx 32rpx 80rpx;
}

.head {
  margin-bottom: 28rpx;
}

.title {
  display: block;
  font-size: 44rpx;
  font-weight: 700;
}

.hint {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #94a3b8;
  line-height: 1.6;
}

.tabs {
  display: flex;
  background: #eef1f5;
  border-radius: 999rpx;
  padding: 6rpx;
  margin-bottom: 24rpx;
}

.tab {
  flex: 1;
  text-align: center;
  font-size: 26rpx;
  color: #475569;
  padding: 18rpx 0;
  border-radius: 999rpx;
}

.tab--on {
  background: #ffffff;
  color: #0b1220;
  font-weight: 600;
}

.mt {
  margin-top: 24rpx;
}

.code-row {
  display: flex;
  align-items: center;
  margin-top: 20rpx;
}

.code-input {
  flex: 1;
}

.code-btn {
  margin-left: 16rpx;
  padding: 0 28rpx;
  height: 84rpx;
  line-height: 84rpx;
  background: #0b1220;
  color: #ffffff;
  border-radius: 16rpx;
  font-size: 24rpx;
}

.code-btn--off {
  opacity: 0.5;
}

.dev-hint {
  display: block;
  margin-top: 14rpx;
  font-size: 22rpx;
  color: #b45309;
}

.mt-inline {
  margin-top: 14rpx;
}

.error {
  display: block;
  margin-top: 20rpx;
  font-size: 24rpx;
  color: #dc2626;
}

.submit {
  margin-top: 36rpx;
}

.switch {
  margin-top: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.link {
  color: #0f9d8f;
  font-size: 24rpx;
  margin-left: 8rpx;
}

.oauth {
  margin-top: 24rpx;
}

.section {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  margin-bottom: 10rpx;
}

.oauth-row {
  display: flex;
  margin-top: 20rpx;
}

.oauth-btn {
  flex: 1;
  margin-right: 16rpx;
  height: 84rpx;
  border-radius: 16rpx;
  background: #f4f6f8;
  border: 1rpx solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.oauth-btn:last-child {
  margin-right: 0;
}

.oauth-name {
  font-size: 24rpx;
}
</style>
