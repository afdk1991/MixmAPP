<template>
  <view class="page page--auth">
    <mx-bar compact />

    <view class="brand">
      <mx-logo size="md" tone="ink" sub="MIXMAPP ACCOUNT" />
      <text class="brand-note mono">ISSUING DESK · 现场签发通行证</text>
    </view>

    <view class="head">
      <text class="eyebrow">NEW CITIZEN</text>
      <text class="title">创建 MixmAPP 账号</text>
      <text class="hint">注册即签发星际联邦通行证，并分配唯一的 MixmAPP 星际联邦通行证公民编号，可作为登录名与对外展示 ID。</text>
    </view>

    <view class="mode">
      <view class="mode-tab" :class="{ 'mode-tab--on': mode === 'phone' }" @tap="mode = 'phone'">
        <text class="mode-label">手机号</text>
        <view class="mode-line" />
      </view>
      <view class="mode-tab" :class="{ 'mode-tab--on': mode === 'email' }" @tap="mode = 'email'">
        <text class="mode-label">邮箱</text>
        <view class="mode-line" />
      </view>
      <view class="mode-tab" :class="{ 'mode-tab--on': mode === 'username' }" @tap="mode = 'username'">
        <text class="mode-label">用户名</text>
        <view class="mode-line" />
      </view>
      <view class="mode-tab" :class="{ 'mode-tab--on': mode === 'onekey' }" @tap="mode = 'onekey'">
        <text class="mode-label">一键</text>
        <view class="mode-line" />
      </view>
    </view>

    <view class="sheet form">
      <block v-if="mode === 'phone'">
        <view class="field-block">
          <text class="label">手机号</text>
          <input
            class="field"
            type="number"
            maxlength="11"
            placeholder="请输入 11 位手机号"
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
        <text v-if="devCode" class="dev-hint">开发态验证码：{{ devCode }}（正式环境不会显示）</text>
      </block>

      <block v-else-if="mode === 'email'">
        <view class="field-block">
          <text class="label">邮箱</text>
          <input
            class="field"
            type="text"
            placeholder="you@example.com"
            placeholder-class="field-ph"
            v-model="email"
          />
        </view>
        <view class="field-block">
          <text class="label">密码</text>
          <input
            class="field"
            password
            placeholder="至少 8 位，含字母与数字"
            placeholder-class="field-ph"
            v-model="password"
          />
        </view>
      </block>

      <block v-else-if="mode === 'username'">
        <view class="field-block">
          <text class="label">用户名</text>
          <input
            class="field"
            type="text"
            maxlength="20"
            placeholder="2–20 个字符，中文/字母/数字/下划线"
            placeholder-class="field-ph"
            v-model="username"
          />
        </view>
        <view class="field-block">
          <text class="label">密码</text>
          <input
            class="field"
            password
            placeholder="至少 8 位，含字母与数字"
            placeholder-class="field-ph"
            v-model="password"
          />
        </view>
        <text class="hint note">注册后可用「用户名 + 密码」直接登录，无需手机号。</text>
        <text class="hint note">不得使用管理员、官方、政府机关等名称，违者注册会被拒绝。</text>
      </block>

      <block v-else>
        <view class="field-block">
          <text class="label">本机号码</text>
          <text class="hint note">点下方按钮唤起本机号码认证，一次完成注册与登录。</text>
          <input
            class="field"
            type="text"
            placeholder="本机号码认证凭证（开发态填 dev:手机号）"
            placeholder-class="field-ph"
            v-model="onekeyToken"
          />
        </view>
        <text class="hint note">同一手机号已注册时直接登录，不会重复建号。</text>
      </block>

      <view class="field-block">
        <text class="label">昵称（选填）</text>
        <input
          class="field"
          type="text"
          maxlength="24"
          placeholder="不填则自动生成"
          placeholder-class="field-ph"
          v-model="nickname"
        />
      </view>

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
        <text class="submit-text">{{ submitting ? '提交中…' : '注册并登录' }}</text>
      </view>

      <view class="secondary">
        <text class="secondary-text">已有账号？</text>
        <text class="secondary-link" @tap="goLogin">去登录</text>
      </view>
    </view>

    <view class="guest">
      <view class="rule" />
      <text class="eyebrow">GUEST</text>
      <text class="guest-title">先逛逛</text>
      <text class="hint">游客账号在同一设备上直接可用，之后可在「星际联邦通行证」绑定手机号或补设用户名升级。</text>
      <view
        class="guest-btn"
        :class="{ 'btn--disabled': submitting }"
        hover-class="is-press"
        @tap="guestStart"
      >
        <text class="guest-btn-text">{{ submitting ? '创建中…' : '游客身份进入' }}</text>
        <text class="guest-btn-arrow mono">→</text>
      </view>
    </view>

    <view class="sheet oauth">
      <text class="eyebrow">OAUTH</text>
      <text class="oauth-title">第三方账号</text>
      <text class="hint">需在服务端配置对应 OAUTH_* 参数后启用；首次授权会自动建号并绑定。</text>
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

    <text class="foot mono">MIXMAPP · ISSUING DESK</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { authApi, ApiError } from '../../api/client';
import { applyAuth, loginByOAuth } from '../../stores/session';
import { ROUTES } from '../../routes';
import MxLogo from '../../components/mx-logo/mx-logo.vue';

const mode = ref<'phone' | 'email' | 'username' | 'onekey'>('phone');
const phone = ref('');
const code = ref('');
const email = ref('');
const username = ref('');
const password = ref('');
const onekeyToken = ref('');
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
  { key: 'apple' as const, name: 'Apple' },
];

/** 设备标识：游客账号按设备复用，避免同一台机器每次进来都新建号。 */
function getDeviceId(): string {
  const key = 'mixmapp:deviceId';
  const cached = uni.getStorageSync(key) as string | '';
  if (cached) return cached;
  const next = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  uni.setStorageSync(key, next);
  return next;
}

function goLogin(): void {
  uni.redirectTo({ url: ROUTES.login });
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
        : mode.value === 'email'
          ? await authApi.registerByEmail({
              email: email.value,
              password: password.value,
              ...(nickname.value ? { nickname: nickname.value } : {}),
            })
          : mode.value === 'username'
            ? await authApi.registerByUsername({
                username: username.value,
                password: password.value,
                ...(nickname.value ? { nickname: nickname.value } : {}),
              })
            : await authApi.oneKey({
                token: onekeyToken.value,
                ...(nickname.value ? { nickname: nickname.value } : {}),
              });
    await applyAuth(data);
    uni.showToast({
      title: data.isNewUser ? `注册成功 ${data.user.accountNo}` : `登录成功 ${data.user.accountNo}`,
      icon: 'none',
      duration: 2500,
    });
    setTimeout(() => uni.switchTab({ url: ROUTES.me }), 800);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '注册失败，请稍后重试';
  } finally {
    submitting.value = false;
  }
}

/** 游客入口：不填任何资料，用设备号建号（同设备重复点会恢复原账号）。 */
async function guestStart(): Promise<void> {
  if (submitting.value) return;
  error.value = '';
  submitting.value = true;
  try {
    const data = await authApi.registerGuest({ deviceId: getDeviceId() });
    await applyAuth(data);
    uni.showToast({
      title: data.isNewUser ? `游客账号 ${data.user.accountNo}` : '已恢复游客账号',
      icon: 'none',
      duration: 2500,
    });
    setTimeout(() => uni.switchTab({ url: ROUTES.me }), 800);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '游客账号创建失败，请稍后重试';
  } finally {
    submitting.value = false;
  }
}

async function oauthLogin(provider: 'wechat' | 'qq' | 'github' | 'apple'): Promise<void> {
  try {
    const result = await loginByOAuth(provider);
    await applyAuth(result);
    toast('登录成功', 'success');
    setTimeout(() => uni.switchTab({ url: ROUTES.me }), 600);
  } catch (e) {
    toast(e instanceof Error ? e.message : '第三方登录不可用');
  }
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
  width: 56rpx;
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

/* ---------- 游客侧门：发丝线分节 + 文本按钮 ---------- */
.guest {
  margin-top: $sp-4;
  padding: $sp-4 $sp-1 0;

  .rule {
    margin-bottom: $sp-4;
  }
}

.guest-title {
  display: block;
  margin-top: 12rpx;
  font-family: $font-display;
  font-size: $fs-h2;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
}

.guest .hint {
  margin-top: 10rpx;
}

.guest-btn {
  display: flex;
  align-items: center;
  margin-top: $sp-3;
  height: 72rpx;
  padding: 0 $sp-1;
}

.guest-btn-text {
  font-size: $fs-meta;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: $brand-deep;
}

.guest-btn-arrow {
  margin-left: 12rpx;
  font-size: $fs-meta;
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

.foot {
  display: block;
  margin-top: $sp-6;
  text-align: center;
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $ink-4;
}
</style>
