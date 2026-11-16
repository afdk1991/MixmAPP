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
  color: $ink-3;
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

/* 桌面宽屏（≥1000px）改用 mx-bar 顶部导航，隐藏 uni-app 生成的底部 tabBar，
 * 避免标签栏在宽屏中央悬浮；移动端保持原样，不受影响。 */
@media (min-width: 1000px) {
  uni-tabbar {
    display: none !important;
  }
}
</style>
