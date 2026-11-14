<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';
import { restore } from './stores/session';
import { hasPrivacyConsent } from './privacy';
import { ROUTES } from './routes';

onLaunch(() => {
  restore();
  // 记录一次冷启动，便于“关于”页展示运行环境
  const launch = uni.getSystemInfoSync();
  uni.setStorageSync('mixmapp:lastLaunch', {
    platform: launch.uniPlatform,
    model: launch.model,
    at: new Date().toISOString(),
  });
  // 首启门禁：未同意当前版本隐私政策时，先进同意页；同意后回首页。
  if (!hasPrivacyConsent()) {
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
</style>
