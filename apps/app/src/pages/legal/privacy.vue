<template>
  <view class="page" :class="{ 'page--gate': gate }">
    <mx-bar v-if="!gate" />

    <view class="head">
      <text class="eyebrow">PRIVACY &amp; PERMISSIONS</text>
      <text class="title">隐私政策与权限说明</text>
      <text class="sub mono">版本 {{ policyVersion }} · 更新于 2026-11-14</text>
      <view class="rule" />
    </view>

    <view class="sec">
      <text class="sec-name">一、我们收集什么</text>
      <text class="para">1. 账号资料：注册时填写的用户名、昵称、手机号或邮箱，用于签发通行证与登录。</text>
      <text class="para">2. 交易数据：购物车、订单、收货信息，仅在为你完成下单与履约时使用。</text>
      <text class="para">3. 运行信息：应用版本、网络连通状态与崩溃记录，用于定位故障与恢复页面。</text>
      <text class="para">4. 本机数据：登录凭证、隐私同意状态、最近一次启动记录，均保存在设备本地。</text>
    </view>

    <view class="sec">
      <text class="sec-name">二、应用申请的权限</text>
      <view class="perm">
        <text class="perm-k mono">网络</text>
        <text class="perm-v">访问网络与读取网络状态。必需，用于加载页面与在断网时给出提示。</text>
      </view>
      <view class="perm">
        <text class="perm-k mono">通知</text>
        <text class="perm-v">接收订单与账号相关通知。可选，不授权不影响使用，后续在合适时机单独询问。</text>
      </view>
      <view class="perm">
        <text class="perm-k mono">剪贴板</text>
        <text class="perm-v">仅在你点击「复制编号」等按钮时写入，不会在后台读取剪贴板内容。</text>
      </view>
      <text class="para">本应用不申请相机、麦克风、通讯录、位置与存储读取权限。</text>
    </view>

    <view class="sec">
      <text class="sec-name">三、信息如何使用</text>
      <text class="para">仅用于提供账号、商城与订单服务，以及安全防护与故障排查。我们不使用上述信息进行广告画像，也不向第三方出售个人信息。</text>
    </view>

    <view class="sec">
      <text class="sec-name">四、第三方与数据出境</text>
      <text class="para">应用仅连接自有服务端接口，未接入广告或统计 SDK。除法律法规要求或你主动触发的站外链接外，不向第三方提供你的个人信息。</text>
    </view>

    <view class="sec">
      <text class="sec-name">五、保存期限与安全</text>
      <text class="para">登录凭证保存在本机 WebView 存储中，退出登录即清除；应用已关闭系统自动备份，避免凭据随设备迁移被带出。传输全程使用 HTTPS。</text>
    </view>

    <view class="sec">
      <text class="sec-name">六、你的权利</text>
      <text class="para">你可以在「我的」页查看与修改账号资料、退出登录；在系统设置中清除应用数据，等同于撤回同意并删除本地数据。运营方与反馈入口见「我的 → 关于与能力」。</text>
    </view>

    <view v-if="gate" class="gate-bar">
      <view class="btn btn--quiet btn--sm gate-decline" hover-class="is-press" @tap="decline">
        <text class="btn-text btn-text--dark">暂不同意</text>
      </view>
      <view class="btn btn--deep gate-agree" hover-class="is-press" @tap="agree">
        <text class="btn-text">同意并继续</text>
      </view>
    </view>
    <text v-else class="tail mono">如政策更新，会在此页展示新版本并再次征得同意</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { ROUTES } from '../../routes';
import { PRIVACY_POLICY_VERSION, recordPrivacyConsent } from '../../privacy';

/** gate = 首启同意模式（无返回栏、底部固定同意条）；否则为回看模式 */
const gate = ref(false);
const policyVersion = PRIVACY_POLICY_VERSION;

onLoad((options) => {
  gate.value = options?.mode === 'gate';
});

function agree(): void {
  recordPrivacyConsent();
  uni.reLaunch({ url: ROUTES.home });
}

function decline(): void {
  uni.showModal({
    title: '尚未同意隐私政策',
    content: '同意后才能使用 MixmAPP 的账号与商城功能。你可以先阅读本页全部内容，再决定是否同意。',
    showCancel: false,
    confirmText: '继续阅读',
  });
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  padding: 0 $sp-4 calc($sp-6 + env(safe-area-inset-bottom));
}

.page--gate {
  padding-bottom: calc(180rpx + env(safe-area-inset-bottom));
}

.head {
  padding: $sp-5 0 $sp-3;
}

.title {
  display: block;
  margin-top: 16rpx;
  font-family: $font-display;
  font-size: $fs-h1;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: $lh-tight;
  color: $ink;
}

.sub {
  display: block;
  margin: $sp-2 0 $sp-3;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-3;
}

.sec {
  margin-top: $sp-5;
}

.sec-name {
  display: block;
  margin-bottom: $sp-2;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
}

.para {
  display: block;
  margin-bottom: $sp-2;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

.perm {
  padding: $sp-2 0;
  border-top: 1rpx solid $paper-3;
}

.perm:last-of-type {
  border-bottom: 1rpx solid $paper-3;
  margin-bottom: $sp-2;
}

.perm-k {
  display: block;
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  text-transform: uppercase;
  color: $brand-deep;
}

.perm-v {
  display: block;
  margin-top: 8rpx;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

.tail {
  display: block;
  margin-top: $sp-5;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-4;
  text-align: center;
}

.gate-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  gap: $sp-2;
  padding: $sp-3 $sp-4 calc($sp-3 + env(safe-area-inset-bottom));
  background: $shell;
  border-top: 1rpx solid $paper-3;
}

.gate-decline {
  flex: 0 0 auto;
}

.gate-agree {
  flex: 1;
}

@media (min-width: 768px) {
  .gate-bar {
    left: 50%;
    right: auto;
    width: 750px;
    transform: translateX(-50%);
  }
}
</style>
