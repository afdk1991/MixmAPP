<template>
  <view class="page">
    <view class="head">
      <text class="title">创建 MixmAPP 账号</text>
      <text class="hint">注册成功后自动分配一个全局唯一的 MixmAPP 号码，可作为登录名与对外展示 ID。</text>
    </view>

    <view class="tabs">
      <view class="tab" :class="{ 'tab--on': mode === 'phone' }" @tap="mode = 'phone'">手机号</view>
      <view class="tab" :class="{ 'tab--on': mode === 'email' }" @tap="mode = 'email'">邮箱</view>
    </view>

    <view class="card form">
      <block v-if="mode === 'phone'">
        <text class="label">手机号</text>
        <input
          class="field"
          type="number"
          maxlength="11"
          placeholder="请输入 11 位手机号"
          v-model="phone"
        />
        <view class="code-row">
          <input
            class="field code-input"
            type="number"
            maxlength="6"
            placeholder="6 位验证码"
            v-model="code"
          />
          <view
            class="code-btn"
            :class="{ 'code-btn--off': counting || sending }"
            @tap="sendCode"
          >
            {{ counting ? `${countdown}s` : sending ? '发送中' : '获取验证码' }}
          </view>
        </view>
        <text v-if="devCode" class="dev-hint">开发态验证码：{{ devCode }}（正式环境不会显示）</text>
      </block>

      <block v-else>
        <text class="label">邮箱</text>
        <input class="field" type="text" placeholder="you@example.com" v-model="email" />
        <text class="label mt">密码</text>
        <input class="field" password placeholder="至少 8 位，含字母与数字" v-model="password" />
      </block>

      <text class="label mt">昵称（选填）</text>
      <input class="field" type="text" maxlength="24" placeholder="不填则自动生成" v-model="nickname" />

      <text v-if="error" class="error">{{ error }}</text>

      <view class="btn btn--primary submit" :class="{ 'btn--disabled': submitting }" @tap="submit">
        {{ submitting ? '提交中…' : '注册并登录' }}
      </view>

      <view class="switch">
        <text class="hint">已有账号？</text>
        <text class="link" @tap="goLogin">去登录</text>
      </view>
    </view>

    <view class="card oauth">
      <text class="section">第三方账号</text>
      <text class="hint">需在服务端配置对应 OAUTH_* 参数后启用；首次授权会自动建号并绑定。</text>
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
import { applyAuth, loginByOAuth } from '../../stores/session';

const mode = ref<'phone' | 'email'>('phone');
const phone = ref('');
const code = ref('');
const email = ref('');
const password = ref('');
const nickname = ref('');
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

function goLogin(): void {
  uni.redirectTo({ url: '/pages/auth/login' });
}

function toast(title: string, icon: 'none' | 'success' = 'none'): void {
  uni.showToast({ title, icon, duration: 2200 });
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
    const res = await authApi.requestSmsCode(phone.value, 'register');
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
    toast('验证码已发送');
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
    const data =
      mode.value === 'phone'
        ? await authApi.registerByPhone({
            phone: phone.value,
            code: code.value,
            ...(nickname.value ? { nickname: nickname.value } : {}),
          })
        : await authApi.registerByEmail({
            email: email.value,
            password: password.value,
            ...(nickname.value ? { nickname: nickname.value } : {}),
          });
    await applyAuth(data);
    uni.showToast({ title: `注册成功 ${data.user.accountNo}`, icon: 'none', duration: 2500 });
    setTimeout(() => uni.redirectTo({ url: '/pages/me/index' }), 800);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '注册失败，请稍后重试';
  } finally {
    submitting.value = false;
  }
}

async function oauthLogin(provider: 'wechat' | 'qq' | 'github'): Promise<void> {
  try {
    const result = await loginByOAuth(provider);
    await applyAuth(result);
    toast('登录成功', 'success');
    setTimeout(() => uni.redirectTo({ url: '/pages/me/index' }), 600);
  } catch (e) {
    toast(e instanceof Error ? e.message : '第三方登录不可用');
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
  letter-spacing: -0.5rpx;
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
  box-shadow: 0 4rpx 12rpx rgba(11, 18, 32, 0.08);
}

.form {
  padding: 32rpx;
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
  color: #0b1220;
}
</style>
