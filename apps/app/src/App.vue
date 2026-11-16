<script setup lang="ts">
import { onLaunch, onPageNotFound } from '@dcloudio/uni-app';
import { restore } from './stores/session';
import { PRIVACY_GATE_MODE, resolvePrivacyConsent } from './privacy';
import { ROUTES } from './routes';

// 正式产物里管理面（pages/admin/index）不注册，直接访问该地址会命中「路由不存在」。
// 统一回首页，避免用户停在一张白屏上；开发态注册了该页面，不受影响。
onPageNotFound(() => {
  uni.reLaunch({ url: ROUTES.home });
});

onLaunch(async () => {
  restore();
  // 记录一次冷启动，便于“关于”页展示运行环境
  const launch = uni.getSystemInfoSync();
  uni.setStorageSync('mixmapp:lastLaunch', {
    platform: launch.uniPlatform,
    model: launch.model,
    at: new Date().toISOString(),
  });
  // 隐私门禁：默认在注册环节取得同意（privacy.ts 的 PRIVACY_GATE_MODE='register'），
  // 启动直接进首页/通行证，不再弹窗。若商店审核要求首次运行即展示，
  // 把开关改成 'launch' 即可恢复下面的启动拦截。
  if (PRIVACY_GATE_MODE !== 'launch') return;
  const consented = await resolvePrivacyConsent();
  if (!consented) {
    uni.reLaunch({ url: `${ROUTES.legalPrivacy}?mode=gate` });
  }
});
</script>

<style lang="scss">
@import './styles/theme.scss';

page {
  background-color: $paper;
  color: $ink;
  font-family: $font-body;
  font-size: $fs-body;
  line-height: $lh-body;
  -webkit-font-smoothing: antialiased;
}

view,
text,
input,
textarea,
button {
  box-sizing: border-box;
}

image {
  display: block;
}

/* ---------- 备案页脚（H5 全站注入，见 src/site-footer.ts） ---------- */
/* 颜色全部走 --mx-* 变量，深色模式自动跟随；两个号不允许截断，窄屏换行堆叠。 */
.mx-beian {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8rpx $sp-2;
  box-sizing: border-box;
  max-width: 100%;
  margin-top: $sp-6;
  padding-top: $sp-3;
  border-top: 1rpx solid $paper-3;
  text-align: center;
}

/* 挂在 .page 外侧（如 .halo）时页面没有内边距，由页脚补左右与底部安全区 */
.mx-beian--edge {
  padding-left: $sp-4;
  padding-right: $sp-4;
  padding-bottom: calc(#{$sp-4} + env(safe-area-inset-bottom));
}

.mx-beian-link {
  font-family: $font-mono;
  font-size: $fs-micro;
  line-height: 1.6;
  letter-spacing: 0.5rpx;
  /* 页脚小字在浅色底上需满足 WCAG AA 4.5:1：$ink-3 实测 4.43 不足，改用深一档的 $ink-2。 */
  color: $ink-2;
  text-decoration: none;
  overflow-wrap: anywhere;
}

@media (hover: hover) {
  .mx-beian-link:hover {
    color: $ink;
  }
}

.mx-beian-link:active {
  color: $ink;
}

/* ---------- 右侧浮动滚动按钮组（H5 全站注入，见 src/site-scroll-buttons.ts） ---------- */
/* 尺寸用 px：这是贴视口控件，不能跟随 750 设计稿缩放（320px 屏上 rpx 会把 44px 缩到 37px），
 * 颜色全部走 --mx-* 变量，深色模式自动跟随；right / bottom 由脚本按版心、底部条与页脚实时改写。 */
.mx-scroll-fab {
  position: fixed;
  right: var(--mx-fab-right, 12px);
  bottom: var(--mx-fab-bottom, 24px);
  /* 高于商城结算条 / 操作坞，低于 tabBar 与弹层，避免盖住模态框 */
  z-index: 95;
  display: flex;
  flex-direction: column;
  gap: 8px;
  opacity: 0;
  visibility: hidden;
  transform: translateY(6px);
  pointer-events: none;
  transition: opacity 0.18s ease, transform 0.18s ease, visibility 0.18s;
}

/* 至少有一枚按钮需要出现时整组淡入 */
.mx-scroll-fab.is-on {
  opacity: 1;
  visibility: visible;
  transform: none;
  pointer-events: auto;
}

.mx-scroll-fab__btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  width: 44px;
  height: 44px;
  margin: 0;
  padding: 0;
  appearance: none;
  -webkit-appearance: none;
  -webkit-tap-highlight-color: transparent;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  background: $shell;
  box-shadow: $shadow-card;
  font-family: $font-body;
  cursor: pointer;
  transition: border-color 0.16s ease, color 0.16s ease, transform 0.12s ease;
}

/* 已在顶部 / 已到底时单独隐藏对应按钮，位置随之收紧 */
.mx-scroll-fab__btn[data-off] {
  display: none;
}

.mx-scroll-fab__btn:focus-visible {
  outline: 2px solid $brand;
  outline-offset: 2px;
}

.mx-scroll-fab__arrow {
  font-family: $font-mono;
  font-size: 14px;
  line-height: 1;
  color: $brand;
}

.mx-scroll-fab__text {
  font-size: 10px;
  line-height: 1.2;
  letter-spacing: 0.5px;
  color: $ink-3;
}

@media (hover: hover) {
  .mx-scroll-fab__btn:hover {
    border-color: $ink-4;
  }

  .mx-scroll-fab__btn:hover .mx-scroll-fab__text {
    color: $ink;
  }
}

.mx-scroll-fab__btn:active {
  transform: scale(0.96);
}

/* 系统开启「减少动态效果」时不再做淡入与按压动画 */
@media (prefers-reduced-motion: reduce) {
  .mx-scroll-fab,
  .mx-scroll-fab__btn {
    transition: none;
  }
}

/* 桌面宽屏（≥1000px）改用 mx-bar 顶部导航，隐藏 uni-app 生成的底部 tabBar，
 * 避免标签栏在宽屏中央悬浮；移动端保持原样，不受影响。 */
@media (min-width: 1000px) {
  uni-tabbar {
    display: none !important;
  }
}
</style>
