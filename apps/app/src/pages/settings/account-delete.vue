<template>
  <view class="page page--danger mx-ime-pad">
    <mx-bar title="注销账号" />

    <view class="head">
      <text class="eyebrow">DELETE ACCOUNT</text>
      <text class="title">永久注销账号</text>
      <text class="hint">注销操作不可恢复，请先仔细阅读以下后果与订单保留范围。</text>
    </view>

    <!-- 风险与后果 -->
    <view class="sheet block">
      <text class="block-title">注销后会发生什么</text>
      <view class="rule" />
      <view class="consequence">
        <text class="consequence-dot mono">!</text>
        <text class="consequence-text">服务端账号及个人数据将被永久删除，不可恢复，也无法找回。</text>
      </view>
      <view class="consequence">
        <text class="consequence-dot mono">!</text>
        <text class="consequence-text">全部登录会话立即失效，包括其它设备上的登录，注销后需重新登录。</text>
      </view>
      <view class="consequence">
        <text class="consequence-dot mono">!</text>
        <text class="consequence-text">订单仅保留交易凭证必需字段；收货人姓名、电话、地址、备注等可识别信息将不可逆清除。</text>
      </view>
      <view class="consequence">
        <text class="consequence-dot mono">!</text>
        <text class="consequence-text">本机保存的登录态与账号相关缓存将在注销完成后清空。</text>
      </view>
    </view>

    <!-- 服务端仍保留什么 -->
    <view class="sheet block">
      <text class="block-title">服务端仍保留的订单凭证</text>
      <text class="block-lede">为履约、售后与对账需要，订单不会删行，仅保留以下最小字段：</text>
      <view class="rule" />
      <view class="keep-row"><text class="keep-k mono">保留</text><text class="keep-v">订单号、金额（含优惠与实付）、商品快照（商品、标题、数量、单价）</text></view>
      <view class="keep-row"><text class="keep-k mono">保留</text><text class="keep-v">下单 / 支付 / 发货 / 完成时间、订单状态、支付流水号与金额</text></view>
      <view class="keep-row keep-row--last"><text class="keep-k mono">清除</text><text class="keep-v">姓名、手机号、地址文本、备注、经纬度等可定位字段，以及账号资料、绑定标识、收货地址、收藏、购物车、设备快照与登录凭证</text></view>
    </view>

    <!-- 身份校验 + 二次确认 -->
    <view class="sheet form">
      <view v-if="optionsLoading" class="hint loading">正在读取可用的校验方式…</view>
      <block v-else>
        <view v-if="methods.length > 1" class="mode">
          <view
            v-for="m in methods"
            :key="m"
            class="mode-tab"
            :class="{ 'mode-tab--on': method === m }"
            hover-class="is-press"
            @tap="switchMethod(m)"
          >
            <text class="mode-label">{{ METHOD_LABEL[m] }}</text>
            <view class="mode-line" />
          </view>
        </view>

        <!-- 密码方式 -->
        <view v-if="method === 'password'" class="field-block">
          <text class="label">当前密码</text>
          <input
            class="field"
            password
            placeholder="请输入当前账号密码"
            placeholder-class="field-ph"
            confirm-type="done"
            v-model="password"
            @confirm="submit"
          />
        </view>

        <!-- 短信验证码方式 -->
        <block v-else-if="method === 'sms'">
          <view class="field-block">
            <text class="label">绑定手机</text>
            <text class="phone mono">{{ options?.phone ?? '未绑定手机号' }}</text>
          </view>
          <view class="field-block">
            <text class="label">短信验证码</text>
            <view class="code-row">
              <input
                class="field code-input"
                type="number"
                maxlength="6"
                placeholder="6 位验证码"
                placeholder-class="field-ph"
                confirm-type="done"
                v-model="code"
                @confirm="submit"
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
        </block>

        <!-- 设备确认方式 -->
        <block v-else>
          <view class="field-block">
            <text class="label">最近登录设备</text>
            <view v-if="deviceInfo" class="device-card">
              <view class="device-row"><text class="device-k">机型</text><text class="device-v">{{ deviceInfo.model || '—' }}</text></view>
              <view class="device-row"><text class="device-k">系统</text><text class="device-v">{{ deviceOsText }}</text></view>
              <view class="device-row"><text class="device-k">网络</text><text class="device-v">{{ networkTypeLabel(deviceInfo.networkType) }}</text></view>
              <view class="device-row device-row--last"><text class="device-k">最近在线</text><text class="device-v mono">{{ lastSeenText }}</text></view>
            </view>
            <text v-else class="hint">未读取到最近登录设备快照；请确认当前设备即常用设备后继续。</text>
          </view>
          <view
            class="btn btn--ghost btn--sm device-challenge"
            :class="{ 'btn--disabled': challengeReady }"
            hover-class="is-press"
            @tap="requestChallenge"
          >
            <text class="btn-text">{{ challengeReady ? '设备确认已通过' : '确认本机为最近登录设备' }}</text>
          </view>
        </block>

        <!-- 二次确认口令 -->
        <view class="field-block confirm-block">
          <text class="label">二次确认</text>
          <text class="confirm-hint">请逐字输入「注销」，确认你已知晓上述后果并申请永久删除账号。</text>
          <input
            class="field"
            placeholder="输入「注销」二字"
            placeholder-class="field-ph"
            confirm-type="done"
            v-model="confirmText"
            @confirm="submit"
          />
        </view>

        <view v-if="error" class="mx-error-row">
          <text class="mx-error-mark">!</text>
          <text class="mx-error-text">{{ error }}</text>
        </view>

        <view
          class="btn btn--deep btn--block submit"
          :class="{ 'btn--disabled': submitting }"
          hover-class="is-press"
          @tap="submit"
        >
          <text class="submit-text">{{ submitting ? '提交中…' : '确认注销账号' }}</text>
        </view>
        <text class="foot-note">提交后服务端将校验身份；校验失败不会删除任何数据，可原地重试。</text>
      </block>
    </view>

    <text class="foot mono">MIXMAPP · ACCOUNT DELETION</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import {
  accountApi,
  ApiError,
  authApi,
  clearTokens,
  deviceApi,
  type AccountDeletionMethod,
  type AccountDeletionOptions,
  type DeleteAccountBody,
  type DeleteAccountResult,
  type DeviceContextDto,
} from '../../api/client';
import { getDeviceSnapshot, networkTypeLabel } from '../../device';
import { session } from '../../stores/session';
import { ROUTES } from '../../routes';
import MxBar from '../../components/mx-bar/mx-bar.vue';

const METHOD_ORDER: AccountDeletionMethod[] = ['password', 'sms', 'device'];

const METHOD_LABEL: Record<AccountDeletionMethod, string> = {
  password: '密码',
  sms: '手机验证码',
  device: '设备确认',
};

/** 错误码 → 中文提示；校验类失败不得删除数据，保留输入供原地重试。 */
const ERROR_TEXT: Record<string, string> = {
  DELETE_CONFIRM_REQUIRED: '确认口令不正确，请逐字输入「注销」后再提交。',
  DELETE_VERIFY_FAILED: '密码或验证码不正确，未删除任何数据；请核对后原地重试。',
  DELETE_CHALLENGE_REQUIRED: '设备校验票据缺失，请先完成本机设备确认。',
  DELETE_CHALLENGE_INVALID: '设备校验票据已过期或失效，请重新发起设备确认。',
  DELETE_DEVICE_MISMATCH: '当前设备与最近登录设备不一致，无法通过设备校验。',
  DELETE_METHOD_NOT_ALLOWED: '当前账号不支持该校验方式，请更换可用方式。',
  ACCOUNT_ALREADY_DELETED: '账号已注销或不存在，请返回登录页重新登录。',
  NETWORK: '网络异常，请稍后重试。',
};

const options = ref<AccountDeletionOptions | null>(null);
const optionsLoading = ref(true);
const method = ref<AccountDeletionMethod>('password');
const password = ref('');
const code = ref('');
const confirmText = ref('');
const challenge = ref('');
const challengeDeviceId = ref('');
const deviceInfo = ref<DeviceContextDto | null>(null);
const submitting = ref(false);
const sending = ref(false);
const counting = ref(false);
const countdown = ref(0);
const devCode = ref('');
const error = ref('');

const methods = computed<AccountDeletionMethod[]>(() => {
  const list = options.value?.methods ?? [];
  return METHOD_ORDER.filter((m) => list.includes(m));
});

const challengeReady = computed(() => Boolean(challenge.value && challengeDeviceId.value));

const deviceOsText = computed(() => {
  const info = deviceInfo.value;
  if (!info) return '—';
  return info.osVersion ? `${info.osName} ${info.osVersion}` : info.osName;
});

const lastSeenText = computed(() => {
  const at = deviceInfo.value?.updatedAt;
  if (!at) return '—';
  try {
    return new Date(at).toLocaleString();
  } catch {
    return at;
  }
});

onLoad(() => {
  void loadOptions();
});

async function loadOptions(): Promise<void> {
  optionsLoading.value = true;
  error.value = '';
  try {
    const res = await accountApi.deletionOptions();
    options.value = res;
    const ordered = METHOD_ORDER.filter((m) => res.methods.includes(m));
    method.value = ordered[0] ?? res.methods[0] ?? 'device';
    if (method.value === 'device') void loadDevice();
  } catch (e) {
    error.value = mapError(e);
  } finally {
    optionsLoading.value = false;
  }
}

function switchMethod(next: AccountDeletionMethod): void {
  if (method.value === next) return;
  method.value = next;
  error.value = '';
  password.value = '';
  code.value = '';
  challenge.value = '';
  challengeDeviceId.value = '';
  if (next === 'device') void loadDevice();
}

async function loadDevice(): Promise<void> {
  try {
    const res = await deviceApi.getContext();
    deviceInfo.value = res.device;
  } catch {
    deviceInfo.value = null;
  }
}

async function sendCode(): Promise<void> {
  if (counting.value || sending.value) return;
  const phone = options.value?.phone;
  if (!phone) {
    error.value = '当前账号没有绑定手机号，请更换校验方式。';
    return;
  }
  sending.value = true;
  error.value = '';
  try {
    const res = await authApi.requestSmsCode(phone, 'delete');
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
    error.value = mapError(e);
  } finally {
    sending.value = false;
  }
}

async function requestChallenge(): Promise<void> {
  if (submitting.value || challengeReady.value) return;
  error.value = '';
  const snapshot = getDeviceSnapshot();
  try {
    const res = await accountApi.deleteChallenge(snapshot.deviceId);
    challenge.value = res.challenge;
    challengeDeviceId.value = snapshot.deviceId;
    uni.showToast({ title: '设备确认已通过', icon: 'none' });
  } catch (e) {
    error.value = mapError(e);
  }
}

function validate(): string {
  if (confirmText.value !== '注销') return '请逐字输入「注销」以确认注销账号。';
  if (method.value === 'password' && !password.value) return '请输入当前账号密码。';
  if (method.value === 'sms' && !/^\d{6}$/.test(code.value)) return '请输入 6 位短信验证码。';
  if (method.value === 'device' && !challengeReady.value) return '请先完成本机设备确认。';
  return '';
}

async function submit(): Promise<void> {
  if (submitting.value) return;
  const invalid = validate();
  if (invalid) {
    error.value = invalid;
    return;
  }
  submitting.value = true;
  error.value = '';
  try {
    const body: DeleteAccountBody = { confirm: '注销', method: method.value };
    if (method.value === 'password') body.password = password.value;
    else if (method.value === 'sms') body.code = code.value;
    else {
      body.deviceId = challengeDeviceId.value;
      body.challenge = challenge.value;
    }
    const res = await accountApi.delete(body);
    onDeleted(res);
  } catch (e) {
    error.value = mapError(e);
  } finally {
    submitting.value = false;
  }
}

/** 注销成功：清空本机登录态与账号缓存，回登录页。 */
function clearLocalSession(): void {
  clearTokens();
  uni.removeStorageSync('mixmapp:user');
  uni.removeStorageSync('mixmapp:adminToken');
  session.user = null;
  session.accessToken = null;
}

function onDeleted(res: DeleteAccountResult): void {
  clearLocalSession();
  const content = `已注销账号：失效 ${res.revokedSessions} 个登录会话，${res.ordersAnonymized} 笔订单完成脱敏。`;
  uni.showModal({
    title: '账号已注销',
    content,
    showCancel: false,
    confirmText: '返回登录页',
    success: () => {
      uni.reLaunch({ url: ROUTES.login });
    },
  });
}

function mapError(e: unknown): string {
  if (e instanceof ApiError) return ERROR_TEXT[e.code] ?? (e.message || '注销申请提交失败，请稍后重试。');
  return '注销申请提交失败，请稍后重试。';
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  padding: $sp-5 $sp-4 calc($sp-8 + var(--mx-safe-bottom) + var(--mx-ime-bottom));
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
  @include mx-gradient-text;
}

.head .hint {
  margin-top: 14rpx;
}

/* ---------- 内容块 ---------- */
.block {
  margin-top: $sp-3;
  padding: $sp-4;
}

.block-title {
  display: block;
  margin-top: 12rpx;
  font-family: $font-display;
  font-size: $fs-h2;
  font-weight: 800;
  letter-spacing: $ls-tight;
  @include mx-gradient-text;
}

.block-lede {
  display: block;
  margin-top: 10rpx;
  font-size: $fs-meta;
  line-height: 1.6;
  color: $ink-3;
}

.block .rule {
  margin-top: $sp-3;
}

.loading {
  margin-top: 12rpx;
}

/* ---------- 后果清单 ---------- */
.consequence {
  display: flex;
  align-items: flex-start;
  padding: 16rpx 0;
  border-bottom: 1rpx solid $paper-2;
}

.consequence:last-child {
  border-bottom: none;
}

.consequence-dot {
  flex-shrink: 0;
  width: 32rpx;
  height: 32rpx;
  margin-right: 12rpx;
  border-radius: 50%;
  background: $signal;
  color: $shell;
  font-size: $fs-micro;
  line-height: 32rpx;
  text-align: center;
}

.consequence-text {
  flex: 1;
  font-size: $fs-meta;
  line-height: 1.6;
  color: $ink-2;
}

/* ---------- 保留清单 ---------- */
.keep-row {
  display: flex;
  align-items: flex-start;
  padding: 16rpx 0;
  border-bottom: 1rpx solid $paper-2;
}

.keep-row--last {
  border-bottom: none;
}

.keep-k {
  flex-shrink: 0;
  width: 64rpx;
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  color: $brand-deep;
}

.keep-row--last .keep-k {
  color: $signal;
}

.keep-v {
  flex: 1;
  font-size: $fs-meta;
  line-height: 1.6;
  color: $ink-2;
}

/* ---------- 表单 ---------- */
.form {
  margin-top: $sp-4;
  padding: $sp-4;
}

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
  background: $brand-deep;
}

.field-block {
  & + .field-block {
    margin-top: $sp-3;
  }
}

.phone {
  display: block;
  margin-top: 10rpx;
  font-size: $fs-meta;
  color: $ink;
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
  background: $brand-deep;
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

/* ---------- 设备快照 ---------- */
.device-card {
  margin-top: 10rpx;
  padding: 18rpx 20rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  background: $shell;
}

.device-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 10rpx 0;
  border-bottom: 1rpx solid $paper-2;
}

.device-row--last {
  border-bottom: none;
}

.device-k {
  flex-shrink: 0;
  margin-right: $sp-3;
  font-size: $fs-micro;
  color: $ink-3;
}

.device-v {
  flex: 1;
  font-size: $fs-micro;
  line-height: 1.5;
  color: $ink;
  text-align: right;
  word-break: break-all;
}

.device-challenge {
  margin-top: $sp-3;
  align-self: flex-start;
}

/* ---------- 二次确认 ---------- */
.confirm-block {
  margin-top: $sp-4;
  padding-top: $sp-3;
  border-top: 1rpx solid $paper-3;
}

.confirm-hint {
  display: block;
  margin-bottom: 10rpx;
  font-size: $fs-micro;
  line-height: 1.6;
  color: $ink-3;
}

/* ---------- 提交 ---------- */
.submit {
  margin-top: $sp-4;
}

.submit-text {
  font-size: $fs-body;
  font-weight: 800;
  letter-spacing: 2rpx;
  color: $on-solid;
}

.foot-note {
  display: block;
  margin-top: $sp-3;
  font-size: $fs-micro;
  line-height: 1.6;
  color: $ink-3;
  text-align: center;
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
