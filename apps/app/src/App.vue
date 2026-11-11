<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';
import { restore } from './stores/session';

onLaunch(() => {
  restore();
  // 记录一次冷启动，便于“关于”页展示运行环境
  const launch = uni.getSystemInfoSync();
  uni.setStorageSync('mixmapp:lastLaunch', {
    platform: launch.uniPlatform,
    model: launch.model,
    at: new Date().toISOString(),
  });
});
</script>

<style lang="scss">
@import './styles/theme.scss';

page {
  background-color: #f6f7f9;
  color: #0b1220;
  font-family: -apple-system, 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif;
}

.container {
  padding: 32rpx;
}

.card {
  background: #ffffff;
  border-radius: 24rpx;
  padding: 32rpx;
  box-shadow: 0 8rpx 24rpx rgba(11, 18, 32, 0.06);
}
</style>
