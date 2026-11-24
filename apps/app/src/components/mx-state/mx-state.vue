<template>
  <view class="mx-state" :class="`mx-state--${variant}`">
    <!-- 加载态：细环旋转；空态 / 错误态：圆形符号位 -->
    <view v-if="variant === 'loading'" class="mx-spinner" />
    <view v-else-if="resolvedMark" class="mx-state__mark">{{ resolvedMark }}</view>

    <text v-if="title" class="mx-state__title">{{ title }}</text>
    <text v-if="text" class="mx-state__text">{{ text }}</text>

    <view
      v-if="actionText"
      class="mx-state__action"
      :class="{ 'mx-state__action--ghost': actionKind === 'ghost' }"
      hover-class="is-press"
      @tap="onAction"
    >
      <text>{{ actionText }}</text>
    </view>

    <!-- 扩展位：需要多按钮 / 自定义说明时由页面插入 -->
    <slot />
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    /** 三态：loading 加载环 / empty 空态 / error 错误重试 */
    variant?: 'loading' | 'empty' | 'error';
    /** 主标题（可空） */
    title?: string;
    /** 辅助说明（可空） */
    text?: string;
    /** 覆盖默认符号：空态 ◌ / 错误 ! */
    mark?: string;
    /** 动作按钮文案；留空则不渲染按钮 */
    actionText?: string;
    /** 动作按钮样式：primary 实心深底 / ghost 描边 */
    actionKind?: 'primary' | 'ghost';
  }>(),
  {
    variant: 'empty',
    title: '',
    text: '',
    mark: '',
    actionText: '',
    actionKind: 'primary',
  },
);

const emit = defineEmits<{ action: [] }>();

const resolvedMark = computed(() => {
  if (props.mark) return props.mark;
  if (props.variant === 'error') return '!';
  if (props.variant === 'empty') return '◌';
  return '';
});

function onAction(): void {
  emit('action');
}
</script>
