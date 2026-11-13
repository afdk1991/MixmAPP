<template>
  <view class="halo">
    <view class="page home">
      <!-- ---------- 通行证 Hero ---------- -->
      <view class="hero">
        <view class="hero-mesh" />
        <view class="hero-glow hero-glow--a" />
        <view class="hero-glow hero-glow--b" />
        <text class="hero-watermark mono">MIXMAPP</text>

        <view class="hero-inner">
          <view class="bar-top">
            <view class="emblem">
              <text class="emblem-text mono">MX</text>
            </view>
            <view class="brand">
              <text class="brand-name">MixmAPP</text>
              <text class="brand-sub mono">MULTI-END IDENTITY</text>
            </view>
            <view class="ver-chip">
              <text class="ver-text mono">{{ version }}</text>
            </view>
          </view>

          <view class="pass-row">
            <view class="pass-chip">
              <view class="pass-dot" :class="{ 'pass-dot--off': !online }" />
              <text class="pass-chip-text mono">PASS · 通行证</text>
            </view>
            <text class="pass-no mono">NO. AUTO</text>
          </view>

          <view class="headline">
            <text class="hl-line">一个账号</text>
            <text class="hl-line hl-accent">跑通所有端</text>
          </view>
          <text class="lede">Web · Android · iOS · 鸿蒙 —— 注册即分配专属 MixmAPP 号码</text>

          <view class="stats">
            <view class="stat">
              <text class="stat-k mono">覆盖</text>
              <text class="stat-v mono">6 ENDS</text>
            </view>
            <view class="stat-sep" />
            <view class="stat">
              <text class="stat-k mono">发号</text>
              <text class="stat-v mono">AUTO</text>
            </view>
            <view class="stat-sep" />
            <view class="stat">
              <text class="stat-k mono">状态</text>
              <view class="stat-status">
                <view class="status-dot" :class="{ 'status-dot--down': !online }" />
                <text class="stat-v mono">{{ online ? 'ONLINE' : 'OFFLINE' }}</text>
              </view>
            </view>
          </view>

          <view class="barcode" />
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
            <text class="cta-title">{{ signedIn ? '回到我的通行证' : '领一枚 MixmAPP 号码' }}</text>
            <text class="cta-sub">{{ signedIn ? '号码 · 绑定方式 · 账号资料' : '30 秒完成 · 全端通用' }}</text>
          </view>
          <view class="cta-arrow">
            <text class="cta-arrow-text">→</text>
          </view>
        </view>

        <view class="quick">
          <view class="quick-btn" hover-class="is-press" @tap="go('/pages/auth/login')">
            <text class="quick-text">登录</text>
          </view>
          <view class="quick-btn" hover-class="is-press" @tap="go('/pages/mall/index')">
            <text class="quick-text">逛商城</text>
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
  { code: 'WEB', short: 'WEB', name: 'H5 / PWA' },
  { code: 'ANDROID', short: 'AN', name: 'Android' },
  { code: 'IOS', short: 'iOS', name: 'iOS' },
  { code: 'HARMONY', short: 'HM', name: '鸿蒙' },
  { code: 'WECHAT', short: 'WX', name: '微信小程序' },
  { code: 'APP-PLUS', short: 'AP', name: 'App-Plus' },
];

const entries = [
  { key: '01', tag: 'MALL', title: '商城', desc: '商品 · 购物车 · 订单', url: '/pages/mall/index' },
  { key: '02', tag: 'SIGN', title: '登录', desc: '密码 · 短信 · OAuth', url: '/pages/auth/login' },
  { key: '03', tag: 'PASS', title: '我的', desc: '号码与绑定方式', url: '/pages/me/index' },
  { key: '04', tag: 'INFO', title: '关于', desc: '能力矩阵与版本', url: '/pages/settings/about' },
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
/* ---------- 全幅底衬：宽屏时让 750 版心成为一张“证件卡”，而不是被灰带夹住 ---------- */
.halo {
  min-height: 100vh;
  background:
    radial-gradient(90% 60% at 50% -10%, rgba(15, 157, 143, 0.16), rgba(15, 157, 143, 0) 62%),
    linear-gradient(180deg, #e6ecea 0%, #dde5e2 100%);
}

.home {
  padding-bottom: 260rpx;
}

/* ---------- Hero ---------- */
.hero {
  position: relative;
  overflow: hidden;
  padding: calc(56rpx + var(--status-bar-height, 0px)) $sp-5 60rpx;
  background:
    radial-gradient(90% 120% at 6% 0%, rgba(15, 157, 143, 0.34), rgba(15, 157, 143, 0) 56%),
    radial-gradient(70% 90% at 100% 8%, rgba(87, 227, 200, 0.16), rgba(87, 227, 200, 0) 60%),
    linear-gradient(162deg, #07100e 0%, #0b1d1a 46%, #123b33 100%);
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
    linear-gradient(rgba(242, 245, 243, 0.055) 1rpx, transparent 1rpx),
    linear-gradient(90deg, rgba(242, 245, 243, 0.055) 1rpx, transparent 1rpx);
  background-size: 64rpx 64rpx;
  -webkit-mask-image: radial-gradient(120% 90% at 50% 0%, #000 30%, rgba(0, 0, 0, 0.25) 78%, transparent 100%);
  mask-image: radial-gradient(120% 90% at 50% 0%, #000 30%, rgba(0, 0, 0, 0.25) 78%, transparent 100%);
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
  background: radial-gradient(circle, rgba(64, 224, 196, 0.34), rgba(64, 224, 196, 0) 68%);
}

.hero-glow--b {
  bottom: -220rpx;
  left: -140rpx;
  width: 520rpx;
  height: 520rpx;
  background: radial-gradient(circle, rgba(15, 157, 143, 0.24), rgba(15, 157, 143, 0) 70%);
}

.hero-watermark {
  position: absolute;
  right: -6rpx;
  top: 300rpx;
  font-size: 72rpx;
  line-height: 1;
  letter-spacing: 6rpx;
  color: rgba(242, 245, 243, 0.038);
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
  background: linear-gradient(150deg, rgba(242, 245, 243, 0.16), rgba(242, 245, 243, 0.04));
  border: 1rpx solid rgba(242, 245, 243, 0.26);
  box-shadow: inset 0 1rpx 0 rgba(255, 255, 255, 0.22), 0 16rpx 32rpx -20rpx rgba(0, 0, 0, 0.6);
}

.emblem-text {
  font-size: 28rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
  color: #eafff8;
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
  font-size: 18rpx;
  letter-spacing: 3rpx;
  color: rgba(226, 245, 238, 0.5);
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
  background: rgba(12, 43, 37, 0.55);
  border: 1rpx solid rgba(117, 240, 214, 0.28);
}

.pass-dot {
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
  margin-right: 12rpx;
  background: #4ff0cd;
  box-shadow: 0 0 0 6rpx rgba(79, 240, 205, 0.16);
  animation: pulse 2.4s ease-in-out infinite;
}

.pass-dot--off {
  background: #e8b267;
  box-shadow: 0 0 0 6rpx rgba(232, 178, 103, 0.16);
  animation: none;
}

.pass-chip-text {
  font-size: 18rpx;
  letter-spacing: 3rpx;
  color: rgba(198, 255, 240, 0.9);
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
  background-image: linear-gradient(96deg, #c9ffe9 0%, #55e6c6 44%, #17a898 96%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: #55e6c6;
}

.lede {
  display: block;
  margin-top: 26rpx;
  padding-right: 40rpx;
  font-size: $fs-meta;
  line-height: 1.72;
  color: rgba(219, 240, 233, 0.66);
}

.stats {
  display: flex;
  align-items: stretch;
  margin-top: 40rpx;
  padding: 22rpx 8rpx;
  border-radius: 28rpx;
  background: rgba(6, 26, 22, 0.5);
  border: 1rpx solid rgba(242, 245, 243, 0.1);
}

.stat {
  flex: 1;
  padding: 0 22rpx;
  display: flex;
  flex-direction: column;
}

.stat-sep {
  width: 1rpx;
  background: rgba(242, 245, 243, 0.1);
}

.stat-k {
  font-size: 18rpx;
  letter-spacing: 3rpx;
  color: rgba(226, 245, 238, 0.42);
}

.stat-v {
  margin-top: 10rpx;
  font-size: 26rpx;
  letter-spacing: 1rpx;
  color: rgba(236, 252, 246, 0.94);
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
  background: #4ff0cd;
  box-shadow: 0 0 0 6rpx rgba(79, 240, 205, 0.15);
  animation: pulse 2.4s ease-in-out infinite;
}

.status-dot--down {
  background: #e8b267;
  box-shadow: 0 0 0 6rpx rgba(232, 178, 103, 0.15);
  animation: none;
}

.barcode {
  margin-top: 34rpx;
  height: 34rpx;
  border-radius: 4rpx;
  background-image: repeating-linear-gradient(
    90deg,
    rgba(226, 245, 238, 0.34) 0,
    rgba(226, 245, 238, 0.34) 3rpx,
    rgba(226, 245, 238, 0) 3rpx,
    rgba(226, 245, 238, 0) 5rpx,
    rgba(226, 245, 238, 0.5) 5rpx,
    rgba(226, 245, 238, 0.5) 7rpx,
    rgba(226, 245, 238, 0) 7rpx,
    rgba(226, 245, 238, 0) 12rpx,
    rgba(226, 245, 238, 0.24) 12rpx,
    rgba(226, 245, 238, 0.24) 14rpx,
    rgba(226, 245, 238, 0) 14rpx,
    rgba(226, 245, 238, 0) 19rpx
  );
  opacity: 0.5;
  -webkit-mask-image: linear-gradient(90deg, #000 0%, #000 62%, transparent 96%);
  mask-image: linear-gradient(90deg, #000 0%, #000 62%, transparent 96%);
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
    radial-gradient(120% 140% at 100% 0%, rgba(63, 224, 196, 0.3), rgba(63, 224, 196, 0) 58%),
    linear-gradient(140deg, #0d1917 0%, #0d2a25 100%);
  box-shadow: 0 30rpx 60rpx -34rpx rgba(11, 35, 30, 0.55);
  animation: rise 0.5s ease both;
}

.cta-glow {
  position: absolute;
  right: -60rpx;
  bottom: -80rpx;
  width: 260rpx;
  height: 260rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(79, 240, 205, 0.24), rgba(79, 240, 205, 0) 70%);
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

.quick {
  display: flex;
  margin-top: 20rpx;
}

.quick-btn {
  flex: 1;
  height: 88rpx;
  margin-right: 16rpx;
  border-radius: $r-pill;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $shell;
  border: 1rpx solid $paper-3;
  transition: transform 0.16s ease, box-shadow 0.16s ease;

  &:last-child {
    margin-right: 0;
  }
}

.quick-text {
  font-size: 26rpx;
  letter-spacing: 0.5rpx;
  color: $ink;
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

/* ---------- 底部操作坞（玻璃岛） ---------- */
.dock {
  padding: 10rpx;
  background: rgba(255, 255, 255, 0.86);
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
  background: linear-gradient(120deg, #0d1917, #123b33);
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
</style>
