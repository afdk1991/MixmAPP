<template>
  <view class="page">
    <view class="hero">
      <view class="foil" />
      <text class="watermark mono">MixmAPP</text>

      <view class="hero-inner">
        <view class="masthead">
          <view class="mark mono">MX</view>
          <view class="mast-brand">
            <text class="mast-name">MixmAPP</text>
            <text class="mast-meta mono">MULTI-END IDENTITY</text>
          </view>
          <text class="mast-ver mono">{{ version }}</text>
        </view>

        <view class="hero-body">
          <text class="eyebrow eyebrow--light">通行证 · PASS</text>
          <text class="headline">一个账号</text>
          <text class="headline">跑通所有端</text>
          <text class="lede">Web / Android / iOS / 鸿蒙 · 注册即自动分配 MixmAPP 号码</text>
        </view>

        <view class="rule--dark" />

        <view class="pass-meta">
          <view class="meta-cell">
            <text class="meta-k mono">覆盖</text>
            <text class="meta-v mono">6 ENDS</text>
          </view>
          <view class="meta-cell">
            <text class="meta-k mono">发号</text>
            <text class="meta-v mono">AUTO</text>
          </view>
          <view class="meta-cell">
            <text class="meta-k mono">状态</text>
            <view class="status">
              <view class="dot" :class="{ 'dot--down': !online }" />
              <text class="status-text mono">{{ online ? 'ONLINE' : 'OFFLINE' }}</text>
            </view>
          </view>
        </view>

        <view class="hero-foot">
          <text class="mono hero-status">{{ statusText }}</text>
        </view>
      </view>
    </view>

    <view class="body">
      <view class="cta sheet" hover-class="is-press" @tap="go(primaryUrl)">
        <view class="cta-text">
          <text class="cta-kicker mono">{{ signedIn ? 'SIGNED IN' : 'STEP 01' }}</text>
          <text class="cta-title">{{ signedIn ? '回到我的通行证' : '先领一个 MixmAPP 号码' }}</text>
          <text class="hint">{{ signedIn ? '查看号码、绑定方式与账号资料' : '手机验证码 / 邮箱密码 / 第三方一键登录，30 秒完成' }}</text>
        </view>
        <view class="cta-arrow mono">→</view>
      </view>

      <view class="section">
        <view class="section-head">
          <text class="sec-title">通行入口</text>
          <text class="micro mono">05 ENTRIES</text>
        </view>
        <view class="sheet entries">
          <view
            v-for="entry in entries"
            :key="entry.key"
            class="entry"
            hover-class="is-press"
            @tap="go(entry.url)"
          >
            <text class="entry-no mono">{{ entry.key }}</text>
            <view class="entry-main">
              <text class="entry-title">{{ entry.title }}</text>
              <text class="entry-desc">{{ entry.desc }}</text>
            </view>
            <text class="entry-arrow mono">→</text>
          </view>
        </view>
      </view>

      <view class="section">
        <view class="section-head">
          <text class="sec-title">已接通的端</text>
          <text class="micro mono">COVERAGE</text>
        </view>
        <view class="sheet coverage sheet--flat">
          <view class="coverage-note">
            <text class="hint">同一套 Vue3 代码，按平台产出不同产物。</text>
          </view>
          <view class="coverage-grid">
            <view v-for="p in platforms" :key="p.code" class="cover-cell">
              <view class="cover-top">
                <text class="cover-code mono">{{ p.code }}</text>
                <view class="cover-dot" />
              </view>
              <text class="cover-name">{{ p.name }}</text>
            </view>
          </view>
        </view>
      </view>

      <view class="footer">
        <text class="mono foot-line">BUILD · TEST · SHIP · OPS</text>
        <text class="mono foot-line foot-line--dim">MIXMAPP · 单码多端预览版</text>
      </view>
    </view>

    <view class="dock">
      <view class="dock-link" hover-class="is-press" @tap="go('/pages/mall/index')">
        <text class="dock-link-text">商城</text>
      </view>
      <view class="dock-link" hover-class="is-press" @tap="go('/pages/me/index')">
        <text class="dock-link-text">我的</text>
      </view>
      <view class="dock-cta" hover-class="is-press" @tap="go(primaryUrl)">
        <text class="dock-cta-text">{{ primaryLabel }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { metaApi } from '../../api/client';
import { session } from '../../stores/session';
import { APP_VERSION } from '../../version';

const version = ref(APP_VERSION);
const online = ref(false);
const env = ref('unknown');

const platforms = [
  { code: 'WEB', name: 'H5 / PWA' },
  { code: 'ANDROID', name: 'Android' },
  { code: 'IOS', name: 'iOS' },
  { code: 'HARMONY', name: '鸿蒙' },
  { code: 'WECHAT', name: '微信小程序' },
  { code: 'APP-PLUS', name: 'App-Plus' },
];

const entries = [
  { key: '01', title: '商城', desc: '商品 · 购物车 · 订单', url: '/pages/mall/index' },
  { key: '02', title: '登录', desc: '密码 · 短信 · OAuth', url: '/pages/auth/login' },
  { key: '03', title: '我的', desc: 'MixmAPP 号码与绑定', url: '/pages/me/index' },
  { key: '04', title: 'ID 试算器', desc: '雪花 / ULID / UUIDv7', url: '/pages/tools/ids' },
  { key: '05', title: '关于', desc: '能力矩阵与版本', url: '/pages/settings/about' },
];

const signedIn = computed(() => Boolean(session.user));
const primaryUrl = computed(() => (signedIn.value ? '/pages/me/index' : '/pages/auth/register'));
const primaryLabel = computed(() => (signedIn.value ? '进入我的' : '创建账号'));

const statusText = computed(() =>
  online.value ? `服务在线 · ${env.value} 环境` : '未连上 API（先启动 services/api）',
);

function go(url: string): void {
  uni.navigateTo({ url });
}

onLoad(async () => {
  try {
    const meta = await metaApi.get();
    version.value = meta.version;
    env.value = meta.env;
    online.value = true;
  } catch {
    online.value = false;
  }
});
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  padding-bottom: 220rpx;
}

/* ---------- 通行证 Hero ---------- */
.hero {
  position: relative;
  overflow: hidden;
  padding: calc(48rpx + var(--status-bar-height, 0px)) $sp-5 $sp-5;
  background:
    radial-gradient(120% 90% at 88% -14%, rgba(15, 157, 143, 0.26), rgba(15, 157, 143, 0) 58%),
    linear-gradient(158deg, #08110f 0%, #0e2925 62%, #14453c 120%);
  border-bottom-left-radius: $r-shell;
  border-bottom-right-radius: $r-shell;
}

.foil {
  position: absolute;
  top: -30%;
  left: 0;
  width: 36%;
  height: 160%;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0));
  animation: foil 7s ease-in-out 0.6s infinite;
  pointer-events: none;
}

.watermark {
  position: absolute;
  right: -8rpx;
  bottom: -24rpx;
  font-size: 84rpx;
  line-height: 1;
  letter-spacing: 4rpx;
  color: rgba(242, 245, 243, 0.05);
  pointer-events: none;
}

.hero-inner {
  position: relative;
  z-index: 2;
}

.masthead {
  display: flex;
  align-items: center;
  margin-bottom: $sp-6;
}

.mark {
  width: 76rpx;
  height: 76rpx;
  border: 1rpx solid rgba(242, 245, 243, 0.24);
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
  color: #f2f5f3;
}

.mast-brand {
  flex: 1;
  margin-left: 20rpx;
  display: flex;
  flex-direction: column;
}

.mast-name {
  font-family: $font-display;
  font-size: 34rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #f4f8f6;
}

.mast-meta {
  margin-top: 6rpx;
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: rgba(242, 245, 243, 0.5);
}

.mast-ver {
  font-size: 20rpx;
  letter-spacing: 1rpx;
  color: rgba(242, 245, 243, 0.62);
  padding: 8rpx 16rpx;
  border: 1rpx solid rgba(242, 245, 243, 0.18);
  border-radius: $r-pill;
}

.eyebrow--light {
  color: rgba(242, 245, 243, 0.62);
}

.eyebrow--light::before {
  background: $brand;
}

.headline {
  display: block;
  margin-top: $sp-3;
  font-family: $font-display;
  font-size: $fs-display;
  font-weight: 600;
  line-height: 1.14;
  letter-spacing: 1rpx;
  color: #f6faf8;
}

.lede {
  display: block;
  margin-top: $sp-3;
  font-size: $fs-meta;
  line-height: 1.7;
  color: rgba(242, 245, 243, 0.66);
}

.rule--dark {
  margin: $sp-5 0 $sp-3;
}

.pass-meta {
  display: flex;
}

.meta-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.meta-k {
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: rgba(242, 245, 243, 0.46);
}

.meta-v {
  margin-top: 8rpx;
  font-size: 26rpx;
  letter-spacing: 1rpx;
  color: rgba(242, 245, 243, 0.92);
}

.status {
  display: flex;
  align-items: center;
  margin-top: 8rpx;
}

.dot {
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
  background: #34d399;
  margin-right: 10rpx;
  animation: pulse 2.4s ease-in-out infinite;
}

.dot--down {
  background: $amber;
  animation: none;
}

.status-text {
  font-size: 26rpx;
  letter-spacing: 1rpx;
  color: rgba(242, 245, 243, 0.92);
}

.hero-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: $sp-4;
}

.hero-status {
  font-size: 20rpx;
  letter-spacing: 0.5rpx;
  color: rgba(242, 245, 243, 0.5);
  max-width: 68%;
}

/* ---------- 主体 ---------- */
.body {
  padding: $sp-4 $sp-3 0;
}

.cta {
  display: flex;
  align-items: center;
  padding: $sp-4;
  animation: rise 0.5s ease both;
}

.cta-text {
  flex: 1;
  padding-right: $sp-3;
}

.cta-kicker {
  display: block;
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: $brand-deep;
}

.cta-title {
  display: block;
  margin-top: 10rpx;
  font-family: $font-display;
  font-size: 40rpx;
  font-weight: 600;
  line-height: 1.3;
  color: $ink;
}

.cta-text .hint {
  margin-top: 10rpx;
}

.cta-arrow {
  width: 88rpx;
  height: 88rpx;
  flex-shrink: 0;
  border-radius: 50%;
  background: $ink;
  color: #f4f8f6;
  font-size: 34rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.section {
  margin-top: $sp-6;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: $sp-3;
  padding: 0 4rpx;
}

.entries {
  overflow: hidden;
  animation: rise 0.5s ease 0.08s both;
}

.entry {
  display: flex;
  align-items: center;
  padding: $sp-4 $sp-4;
  border-bottom: 1rpx solid $paper-2;
  transition: background 0.16s ease;
}

.entry:last-child {
  border-bottom: none;
}

.entry-no {
  width: 64rpx;
  font-size: 22rpx;
  letter-spacing: 1rpx;
  color: $ink-4;
}

.entry-main {
  flex: 1;
  padding-right: $sp-3;
}

.entry-title {
  display: block;
  font-family: $font-display;
  font-size: $fs-h2;
  font-weight: 600;
  line-height: 1.3;
  color: $ink;
}

.entry-desc {
  display: block;
  margin-top: 6rpx;
  font-size: $fs-micro;
  letter-spacing: 0.5rpx;
  color: $ink-3;
}

.entry-arrow {
  font-size: 28rpx;
  color: $ink-4;
}

.coverage {
  overflow: hidden;
}

.coverage-note {
  padding: $sp-4;
  padding-bottom: $sp-3;
}

.coverage-grid {
  display: flex;
  flex-wrap: wrap;
  border-top: 1rpx solid $paper-2;
}

.cover-cell {
  width: 50%;
  padding: $sp-3 $sp-4;
  border-bottom: 1rpx solid $paper-2;
  box-sizing: border-box;
}

.cover-cell:nth-child(odd) {
  border-right: 1rpx solid $paper-2;
}

.cover-cell:nth-last-child(-n + 2) {
  border-bottom: none;
}

.cover-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cover-code {
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: $ink-4;
}

.cover-dot {
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: $brand;
}

.cover-name {
  display: block;
  margin-top: 10rpx;
  font-size: 28rpx;
  color: $ink;
}

.footer {
  padding: $sp-6 4rpx 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.foot-line {
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: $ink-4;
}

.foot-line--dim {
  margin-top: 10rpx;
  color: $ink-4;
  opacity: 0.7;
}

/* ---------- 底部操作坞 ---------- */
.dock {
  padding: 10rpx;
}

.dock-link {
  flex: 1;
  height: 84rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dock-link-text {
  font-size: 26rpx;
  color: $ink-2;
}

.dock-cta {
  flex: 1.5;
  height: 84rpx;
  margin-left: 6rpx;
  border-radius: $r-pill;
  background: $ink;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 12rpx 28rpx -16rpx rgba(13, 25, 23, 0.5);
}

.dock-cta-text {
  font-size: 26rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #f4f8f6;
}
</style>
