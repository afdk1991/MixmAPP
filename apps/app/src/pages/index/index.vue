<template>
  <view class="halo">
    <view class="page home">
      <!-- ---------- 星际联邦通行证 Hero ---------- -->
      <view class="hero">
        <view class="hero-mesh" />
        <view class="hero-stars" />
        <view class="hero-orbit" />
        <view class="hero-glow hero-glow--a" />
        <view class="hero-glow hero-glow--b" />
        <text class="hero-watermark mono">STELLAR</text>

        <view class="hero-inner">
          <view class="bar-top">
            <mx-logo size="lg" tone="light" sub="MULTI-END IDENTITY" />
            <view class="ver-chip">
              <text class="ver-text mono">{{ version }}</text>
            </view>
          </view>

          <view class="pass-row">
            <view class="pass-chip">
              <view class="pass-dot" :class="{ 'pass-dot--off': !online }" />
              <text class="pass-chip-text mono">PASS · 星际联邦通行证</text>
            </view>
            <text class="pass-no mono">NO. AUTO</text>
          </view>

          <view class="headline">
            <text class="hl-line">一张通行证</text>
            <text class="hl-line hl-accent">通行所有星域</text>
          </view>
          <text class="lede">Web · Android · iOS · 鸿蒙 —— 注册即签发星际联邦通行证，并分配全局唯一的 MixmAPP 公民编号</text>

          <view class="stats">
            <view class="stat">
              <text class="stat-k mono">终端</text>
              <text class="stat-v mono">6 ENDS</text>
            </view>
            <view class="stat-sep" />
            <view class="stat">
              <text class="stat-k mono">编号</text>
              <text class="stat-v mono">AUTO</text>
            </view>
            <view class="stat-sep" />
            <view class="stat">
              <text class="stat-k mono">链路</text>
              <view class="stat-status">
                <view class="status-dot" :class="{ 'status-dot--down': !online }" />
                <text class="stat-v mono">{{ online ? 'ONLINE' : 'OFFLINE' }}</text>
              </view>
            </view>
          </view>

          <view class="barcode" />
          <view class="hero-holo" />
          <view class="hero-foot">
            <text class="foot mono">{{ statusText }}</text>
            <text class="foot mono">↓ SCROLL</text>
          </view>
        </view>
      </view>

      <!-- ---------- 主体 ---------- -->
      <view class="body">
        <view class="cta" hover-class="is-press" @tap="go(primaryUrl)">
          <view class="cta-glow" />
          <view class="cta-text">
            <text class="cta-kicker mono">{{ signedIn ? 'SIGNED IN' : 'GET STARTED' }}</text>
            <text class="cta-title">{{ signedIn ? '查看联邦通行证' : '领取星际联邦通行证' }}</text>
            <text class="cta-sub">{{ signedIn ? '编号 · 绑定方式 · 账号资料' : '30 秒签发 · 全端通用' }}</text>
          </view>
          <view class="cta-arrow">
            <text class="cta-arrow-text">→</text>
          </view>
        </view>

        <view class="section">
          <view class="sec-head">
            <view class="sec-l">
              <text class="sec-n mono">01</text>
              <text class="sec-title">通行入口</text>
            </view>
            <text class="sec-meta mono">04 ENTRIES</text>
          </view>

          <view class="grid">
            <view
              v-for="entry in entries"
              :key="entry.key"
              class="tile"
              hover-class="is-press"
              @tap="go(entry.url)"
            >
              <view class="tile-top">
                <text class="tile-code mono">{{ entry.key }}</text>
                <text class="tile-tag mono">{{ entry.tag }}</text>
              </view>
              <text class="tile-title">{{ entry.title }}</text>
              <text class="tile-desc">{{ entry.desc }}</text>
              <view class="tile-bot">
                <text class="tile-arrow mono">→</text>
              </view>
            </view>
          </view>
        </view>

        <view class="section">
          <view class="sec-head">
            <view class="sec-l">
              <text class="sec-n mono">02</text>
              <text class="sec-title">已接通的端</text>
            </view>
            <text class="sec-meta mono">COVERAGE</text>
          </view>

          <view class="cover">
            <view v-for="p in platforms" :key="p.code" class="cover-item">
              <view class="cover-glyph">
                <text class="cover-glyph-text mono">{{ p.short }}</text>
              </view>
              <view class="cover-main">
                <text class="cover-name">{{ p.name }}</text>
                <text class="cover-code mono">{{ p.code }}</text>
              </view>
              <view class="cover-dot" />
            </view>
          </view>
          <text class="cover-note">同一套 Vue3 代码，按平台产出不同产物；账号、发号器与权限完全共用。</text>
        </view>

        <view class="footer">
          <view class="foot-rule" />
          <text class="foot-line mono">BUILD · TEST · SHIP · OPS</text>
          <text class="foot-line foot-line--dim mono">MIXMAPP · 单码多端预览版</text>
        </view>
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
import { ROUTES } from '../../routes';
import MxLogo from '../../components/mx-logo/mx-logo.vue';

const version = ref(APP_VERSION);
const online = ref(false);
const env = ref('unknown');

const platforms = [
  { code: 'WEB', short: 'WEB', name: 'H5 / PWA' },
  { code: 'ANDROID', short: 'AN', name: 'Android' },
  { code: 'IOS', short: 'iOS', name: 'iOS' },
  { code: 'HARMONY', short: 'HM', name: '鸿蒙' },
  { code: 'WECHAT', short: 'WX', name: '微信小程序' },
  { code: 'APP-PLUS', short: 'AP', name: 'App-Plus' },
];

const entries = [
  { key: '01', tag: 'MALL', title: '商城', desc: '商品 · 购物车 · 订单', url: ROUTES.mall },
  { key: '02', tag: 'SIGN', title: '登录', desc: '密码 · 短信 · OAuth', url: ROUTES.login },
  { key: '03', tag: 'PASS', title: '星际联邦通行证', desc: '公民编号与绑定方式', url: ROUTES.me },
  { key: '04', tag: 'INFO', title: '关于', desc: '能力矩阵与版本', url: ROUTES.about },
];

const signedIn = computed(() => Boolean(session.user));
const primaryUrl = computed(() => (signedIn.value ? ROUTES.me : ROUTES.register));
const primaryLabel = computed(() => (signedIn.value ? '进入星际联邦通行证' : '创建账号'));

const statusText = computed(() =>
  online.value ? `联邦网络在线 · ${env.value} 环境` : '联邦网络离线 · 未连上 API',
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
/* ---------- 全幅底衬：宽屏时让 750 版心成为一张“证件卡”，而不是被灰带夹住 ---------- */
.halo {
  min-height: 100vh;
  background:
    radial-gradient(90% 60% at 50% -10%, rgba(15, 157, 143, 0.14), rgba(15, 157, 143, 0) 62%),
    linear-gradient(180deg, #f4f4f1 0%, #eaebe6 100%);
}

.home {
  padding-bottom: 64rpx;
}

/* ---------- Hero ---------- */
.hero {
  position: relative;
  overflow: hidden;
  padding: calc(56rpx + var(--status-bar-height, 0px)) $sp-5 60rpx;
  background:
    radial-gradient(90% 120% at 6% 0%, rgba(15, 157, 143, 0.34), rgba(15, 157, 143, 0) 56%),
    radial-gradient(70% 90% at 100% 8%, rgba(100, 228, 255, 0.1), rgba(100, 228, 255, 0) 60%),
    radial-gradient(60% 60% at 82% 100%, rgba(244, 244, 241, 0.06), rgba(244, 244, 241, 0) 72%),
    linear-gradient(162deg, #0b0f0e 0%, #11201d 52%, #17322c 100%);
  border-bottom-left-radius: $r-shell;
  border-bottom-right-radius: $r-shell;
}

.hero-mesh {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-image:
    linear-gradient(rgba(244, 244, 241, 0.06) 1rpx, transparent 1rpx),
    linear-gradient(90deg, rgba(244, 244, 241, 0.06) 1rpx, transparent 1rpx);
  background-size: 64rpx 64rpx;
  -webkit-mask-image: radial-gradient(120% 90% at 50% 0%, #000 30%, rgba(0, 0, 0, 0.25) 78%, transparent 100%);
  mask-image: radial-gradient(120% 90% at 50% 0%, #000 30%, rgba(0, 0, 0, 0.25) 78%, transparent 100%);
  pointer-events: none;
}

.hero-stars {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-image:
    radial-gradient(2rpx 2rpx at 12% 18%, rgba(255, 255, 255, 0.9), transparent 60%),
    radial-gradient(2rpx 2rpx at 32% 8%, rgba(160, 219, 255, 0.8), transparent 60%),
    radial-gradient(2rpx 2rpx at 68% 14%, rgba(255, 240, 200, 0.9), transparent 60%),
    radial-gradient(2rpx 2rpx at 88% 30%, rgba(255, 255, 255, 0.7), transparent 60%),
    radial-gradient(2rpx 2rpx at 22% 48%, rgba(255, 255, 255, 0.55), transparent 60%),
    radial-gradient(2rpx 2rpx at 54% 36%, rgba(180, 225, 255, 0.7), transparent 60%),
    radial-gradient(2rpx 2rpx at 76% 58%, rgba(255, 255, 255, 0.55), transparent 60%),
    radial-gradient(2rpx 2rpx at 44% 76%, rgba(255, 235, 190, 0.6), transparent 60%);
  opacity: 0.8;
  animation: twinkle 7s ease-in-out infinite;
  pointer-events: none;
}

.hero-orbit {
  position: absolute;
  top: 200rpx;
  right: -200rpx;
  width: 560rpx;
  height: 560rpx;
  border: 1rpx solid rgba(112, 190, 255, 0.16);
  border-radius: 50%;
  transform: rotate(-18deg);
  pointer-events: none;
}

.hero-glow {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(24rpx);
}

.hero-glow--a {
  top: -160rpx;
  right: -120rpx;
  width: 460rpx;
  height: 460rpx;
  background: radial-gradient(circle, rgba(15, 157, 143, 0.3), rgba(15, 157, 143, 0) 68%);
}

.hero-glow--b {
  bottom: -220rpx;
  left: -140rpx;
  width: 520rpx;
  height: 520rpx;
  background: radial-gradient(circle, rgba(100, 228, 255, 0.12), rgba(100, 228, 255, 0) 70%);
}

.hero-watermark {
  position: absolute;
  right: -6rpx;
  top: 300rpx;
  font-size: 64rpx;
  line-height: 1;
  letter-spacing: 8rpx;
  color: rgba(170, 214, 255, 0.05);
  pointer-events: none;
}

.hero-inner {
  position: relative;
  z-index: 2;
}

.bar-top {
  display: flex;
  align-items: center;
}

.emblem {
  width: 88rpx;
  height: 88rpx;
  flex-shrink: 0;
  border-radius: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(120% 120% at 30% 0%, rgba(255, 239, 201, 0.32), rgba(255, 239, 201, 0) 56%),
    linear-gradient(150deg, rgba(15, 157, 143, 0.3), rgba(11, 15, 14, 0.8));
  border: 1rpx solid rgba(15, 157, 143, 0.55);
  box-shadow:
    inset 0 1rpx 0 rgba(255, 255, 255, 0.32),
    0 16rpx 32rpx -20rpx rgba(0, 0, 0, 0.7),
    0 0 24rpx -6rpx rgba(15, 157, 143, 0.35);
}

.emblem-text {
  font-size: 28rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
  color: #8fe9dd;
}

.brand {
  flex: 1;
  margin-left: 20rpx;
  display: flex;
  flex-direction: column;
}

.brand-name {
  font-family: $font-body;
  font-size: 34rpx;
  font-weight: 700;
  letter-spacing: 0.5rpx;
  color: #f4fbf8;
}

.brand-sub {
  margin-top: 6rpx;
  font-size: 17rpx;
  letter-spacing: 2.4rpx;
  color: rgba(255, 226, 171, 0.62);
}

.ver-chip {
  padding: 10rpx 18rpx;
  border-radius: $r-pill;
  background: rgba(242, 245, 243, 0.07);
  border: 1rpx solid rgba(242, 245, 243, 0.18);
}

.ver-text {
  font-size: 18rpx;
  letter-spacing: 1rpx;
  color: rgba(226, 245, 238, 0.72);
}

.pass-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 44rpx;
}

.pass-chip {
  display: flex;
  align-items: center;
  height: 44rpx;
  padding: 0 18rpx;
  border-radius: $r-pill;
  background: rgba(11, 18, 16, 0.72);
  border: 1rpx solid rgba(15, 157, 143, 0.38);
}

.pass-dot {
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
  margin-right: 12rpx;
  background: #8fe9dd;
  box-shadow: 0 0 0 6rpx rgba(100, 228, 255, 0.16);
  animation: pulse 2.4s ease-in-out infinite;
}

.pass-dot--off {
  background: #e0a963;
  box-shadow: 0 0 0 6rpx rgba(232, 178, 103, 0.16);
  animation: none;
}

.pass-chip-text {
  font-size: 18rpx;
  letter-spacing: 2rpx;
  color: rgba(255, 232, 187, 0.94);
}

.pass-no {
  font-size: 18rpx;
  letter-spacing: 2rpx;
  color: rgba(226, 245, 238, 0.38);
}

.headline {
  margin-top: 34rpx;
}

.hl-line {
  display: block;
  font-family: $font-body;
  font-size: 88rpx;
  font-weight: 700;
  line-height: 1.12;
  letter-spacing: -2rpx;
  color: #f7fcfa;
}

.hl-accent {
  margin-top: 8rpx;
  background-image: linear-gradient(96deg, #f4f4f1 0%, #8fe9dd 34%, #0f9d8f 96%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: #8fe9dd;
}

.lede {
  display: block;
  margin-top: 26rpx;
  padding-right: 40rpx;
  font-size: $fs-meta;
  line-height: 1.72;
  color: rgba(207, 225, 252, 0.7);
}

.stats {
  display: flex;
  align-items: stretch;
  margin-top: 40rpx;
  padding: 22rpx 8rpx;
  border-radius: 28rpx;
  background: rgba(11, 18, 16, 0.56);
  border: 1rpx solid rgba(140, 190, 255, 0.14);
}

.stat {
  flex: 1;
  padding: 0 22rpx;
  display: flex;
  flex-direction: column;
}

.stat-sep {
  width: 1rpx;
  background: rgba(244, 244, 241, 0.12);
}

.stat-k {
  font-size: 18rpx;
  letter-spacing: 3rpx;
  color: rgba(184, 211, 255, 0.48);
}

.stat-v {
  margin-top: 10rpx;
  font-size: 26rpx;
  letter-spacing: 1rpx;
  color: rgba(239, 247, 255, 0.94);
}

.stat-status {
  display: flex;
  align-items: center;
  margin-top: 10rpx;
}

.status-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  margin-right: 12rpx;
  background: #8fe9dd;
  box-shadow: 0 0 0 6rpx rgba(100, 228, 255, 0.15);
  animation: pulse 2.4s ease-in-out infinite;
}

.status-dot--down {
  background: #e0a963;
  box-shadow: 0 0 0 6rpx rgba(232, 178, 103, 0.15);
  animation: none;
}

.barcode {
  margin-top: 34rpx;
  height: 34rpx;
  border-radius: 4rpx;
  background-image: repeating-linear-gradient(
    90deg,
    rgba(205, 229, 255, 0.34) 0,
    rgba(205, 229, 255, 0.34) 3rpx,
    rgba(205, 229, 255, 0) 3rpx,
    rgba(205, 229, 255, 0) 5rpx,
    rgba(205, 229, 255, 0.5) 5rpx,
    rgba(205, 229, 255, 0.5) 7rpx,
    rgba(205, 229, 255, 0) 7rpx,
    rgba(205, 229, 255, 0) 12rpx,
    rgba(205, 229, 255, 0.24) 12rpx,
    rgba(205, 229, 255, 0.24) 14rpx,
    rgba(205, 229, 255, 0) 14rpx,
    rgba(205, 229, 255, 0) 19rpx
  );
  opacity: 0.5;
  -webkit-mask-image: linear-gradient(90deg, #000 0%, #000 62%, transparent 96%);
  mask-image: linear-gradient(90deg, #000 0%, #000 62%, transparent 96%);
}

.hero-holo {
  height: 2rpx;
  margin-top: 18rpx;
  background: linear-gradient(90deg, rgba(124, 230, 255, 0) 0%, rgba(124, 230, 255, 0.72) 28%, rgba(255, 214, 138, 0.74) 68%, rgba(255, 214, 138, 0) 100%);
  opacity: 0.8;
}

.hero-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18rpx;
}

.foot {
  font-size: 18rpx;
  letter-spacing: 1rpx;
  color: rgba(226, 245, 238, 0.42);
}

/* ---------- 主体 ---------- */
.body {
  padding: 44rpx $sp-4 0;
}

.cta {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  padding: 36rpx 34rpx;
  border-radius: $r-card;
  background:
    radial-gradient(120% 140% at 100% 0%, rgba(15, 157, 143, 0.3), rgba(15, 157, 143, 0) 58%),
    linear-gradient(140deg, #0b0f0e 0%, #152622 100%);
  box-shadow: 0 30rpx 60rpx -34rpx rgba(11, 15, 14, 0.5);
  animation: rise 0.5s ease both;
}

.cta-glow {
  position: absolute;
  right: -60rpx;
  bottom: -80rpx;
  width: 260rpx;
  height: 260rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(120, 210, 255, 0.24), rgba(120, 210, 255, 0) 70%);
  pointer-events: none;
}

.cta-text {
  position: relative;
  z-index: 2;
  flex: 1;
  padding-right: 24rpx;
}

.cta-kicker {
  display: block;
  font-size: 18rpx;
  letter-spacing: 3rpx;
  color: rgba(120, 240, 214, 0.82);
}

.cta-title {
  display: block;
  margin-top: 12rpx;
  font-family: $font-body;
  font-size: 44rpx;
  font-weight: 700;
  line-height: 1.28;
  letter-spacing: -0.5rpx;
  color: #f7fcfa;
}

.cta-sub {
  display: block;
  margin-top: 12rpx;
  font-size: $fs-meta;
  letter-spacing: 0.5rpx;
  color: rgba(219, 240, 233, 0.6);
}

.cta-arrow {
  position: relative;
  z-index: 2;
  width: 92rpx;
  height: 92rpx;
  flex-shrink: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f7fcfa;
}

.cta-arrow-text {
  font-size: 34rpx;
  line-height: 1;
  color: #0d1917;
}

.section {
  margin-top: 52rpx;
}

.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22rpx;
}

.sec-l {
  display: flex;
  align-items: baseline;
}

.sec-n {
  margin-right: 16rpx;
  font-size: 20rpx;
  letter-spacing: 1rpx;
  color: $brand-deep;
}

.sec-title {
  font-family: $font-body;
  font-size: 34rpx;
  font-weight: 700;
  letter-spacing: -0.5rpx;
  color: $ink;
}

.sec-meta {
  font-size: 18rpx;
  letter-spacing: 2rpx;
  color: $ink-4;
}

.grid {
  display: flex;
  flex-wrap: wrap;
  margin: 0 -8rpx;
}

.tile {
  width: calc(50% - 16rpx);
  margin: 8rpx;
  padding: 26rpx 26rpx 20rpx;
  box-sizing: border-box;
  border-radius: 26rpx;
  background: $shell;
  border: 1rpx solid $paper-3;
  box-shadow: 0 2rpx 4rpx rgba(13, 25, 23, 0.03), 0 18rpx 36rpx -26rpx rgba(13, 25, 23, 0.22);
  transition: transform 0.16s ease, box-shadow 0.16s ease;
}

.tile-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tile-code {
  font-size: 20rpx;
  letter-spacing: 1rpx;
  color: $ink-4;
}

.tile-tag {
  padding: 4rpx 12rpx;
  border-radius: $r-pill;
  background: $brand-soft;
  font-size: 16rpx;
  letter-spacing: 1.5rpx;
  color: $brand-deep;
}

.tile-title {
  display: block;
  margin-top: 22rpx;
  font-family: $font-body;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1.25;
  color: $ink;
}

.tile-desc {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  line-height: 1.5;
  color: $ink-3;
}

.tile-bot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 18rpx;
}

.tile-arrow {
  font-size: 24rpx;
  color: $ink-4;
}

.cover {
  display: flex;
  flex-wrap: wrap;
  margin: 0 -8rpx;
}

.cover-item {
  width: calc(50% - 16rpx);
  margin: 8rpx;
  padding: 22rpx 24rpx;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  border-radius: 24rpx;
  background: $shell;
  border: 1rpx solid $paper-3;
}

.cover-glyph {
  width: 64rpx;
  height: 64rpx;
  flex-shrink: 0;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(150deg, #0d1917, #14453c);
}

.cover-glyph-text {
  font-size: 20rpx;
  letter-spacing: 1rpx;
  color: #d8fff3;
}

.cover-main {
  flex: 1;
  margin-left: 18rpx;
  display: flex;
  flex-direction: column;
}

.cover-name {
  font-size: 26rpx;
  font-weight: 600;
  color: $ink;
}

.cover-code {
  margin-top: 4rpx;
  font-size: 16rpx;
  letter-spacing: 1.5rpx;
  color: $ink-4;
}

.cover-dot {
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: $brand;
  flex-shrink: 0;
}

.cover-note {
  display: block;
  margin-top: 20rpx;
  padding: 0 8rpx;
  font-size: 22rpx;
  line-height: 1.7;
  color: $ink-3;
}

.footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 64rpx 0 0;
}

.foot-rule {
  width: 64rpx;
  height: 1rpx;
  margin-bottom: 26rpx;
  background: $paper-3;
}

.foot-line {
  font-size: 18rpx;
  letter-spacing: 2rpx;
  color: $ink-4;
}

.foot-line--dim {
  margin-top: 10rpx;
  opacity: 0.72;
}

/* ---------- 窄屏：收紧字号，保证 375px 也不挤 ---------- */
@media (max-width: 390px) {
  .hl-line {
    font-size: 76rpx;
  }

  .hero {
    padding-left: $sp-4;
    padding-right: $sp-4;
  }

  .body {
    padding-left: 22rpx;
    padding-right: 22rpx;
  }

  .stat {
    padding: 0 16rpx;
  }
}

/* 窄屏水印会压到标题，直接收掉 */
@media (max-width: 767px) {
  .hero-watermark {
    display: none;
  }
}

/* ---------- 宽屏：把版心当作一张证件卡浮在深压背景上 ---------- */
@media (min-width: 768px) {
  .page.home {
    margin-top: 48px;
    margin-bottom: 48px;
    border-radius: 28px;
    overflow: hidden;
    box-shadow: 0 60rpx 140rpx -70rpx rgba(13, 25, 23, 0.45), 0 2rpx 0 rgba(255, 255, 255, 0.6) inset;
  }

  .body {
    padding: 48rpx 48rpx 0;
  }

  .tile-title {
    font-size: 32rpx;
  }
}
@keyframes twinkle {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 0.95;
  }
}
</style>
