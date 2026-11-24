<template>
  <view class="page">
    <mx-bar title="页面不存在" />
    <mx-state
      variant="empty"
      mark="404"
      title="页面不存在"
      text="页面可能已被移动或删除，回到首页看看吧。"
      action-text="回首页"
      @action="goHome"
    />
  </view>
</template>

<script setup lang="ts">
import { ROUTES } from '../../routes';
import MxBar from '../../components/mx-bar/mx-bar.vue';
import MxState from '../../components/mx-state/mx-state.vue';

function goHome(): void {
  uni.reLaunch({ url: ROUTES.home });
}
</script>

<style lang="scss" scoped>
.page {
  padding-top: 0;
}
</style>
