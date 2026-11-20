<template>
  <view class="page mx-ime-pad">
    <mx-bar title="智能助手" />

    <view class="head">
      <text class="eyebrow">ASSISTANT</text>
      <text class="title">智能助手</text>
      <text class="sub mono">{{ aiState === 'dev' ? 'DEV ECHO' : 'LIVE AI' }}</text>
    </view>

    <view v-if="aiState === 'dev'" class="demo-note">
      <text class="demo-note-text">开发态回显：配置 AI_PROVIDER / AI_API_KEY 后自动切换真实模型。</text>
    </view>

    <view class="stream">
      <view v-for="(line, i) in lines" :key="i" class="bubble-wrap" :class="`bubble-wrap--${line.role}`">
        <view class="bubble" :class="`bubble--${line.role}`">
          <text class="bubble-text">{{ line.content }}</text>
        </view>
      </view>
      <view v-if="sending" class="bubble-wrap bubble-wrap--assistant">
        <view class="bubble bubble--assistant">
          <text class="bubble-text">正在输入…</text>
        </view>
      </view>
    </view>

    <text v-if="error" class="error">{{ error }}</text>

    <view class="composer">
      <input
        class="composer-input"
        type="text"
        maxlength="500"
        placeholder="输入问题，回车发送"
        placeholder-class="field-ph"
        confirm-type="done"
        v-model="draft"
        @confirm="send"
      />
      <view
        class="composer-btn"
        :class="{ 'composer-btn--off': sending || !draft.trim() }"
        hover-class="is-press"
        @tap="send"
      >
        <text class="composer-btn-text">{{ sending ? '…' : '发送' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { integrationsApi, ApiError, providerState } from '../../api/client';

type ChatLine = { role: 'user' | 'assistant'; content: string };

const aiState = providerState('ai');

const lines = ref<ChatLine[]>([
  { role: 'assistant', content: '你好，我是 MixmAPP 智能助手。输入问题开始对话。' },
]);
const draft = ref('');
const sending = ref(false);
const error = ref('');

async function send(): Promise<void> {
  const text = draft.value.trim();
  if (!text || sending.value) return;
  error.value = '';
  lines.value.push({ role: 'user', content: text });
  draft.value = '';
  sending.value = true;
  try {
    const messages = lines.value.map((l) => ({ role: l.role, content: l.content }));
    const res = await integrationsApi.ai.chat(messages);
    lines.value.push({ role: 'assistant', content: res.content });
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '对话失败，请稍后重试';
    lines.value.push({ role: 'assistant', content: '抱歉，回复生成失败，请稍后再试。' });
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  padding: 0 $sp-3 calc($sp-6 + var(--mx-safe-bottom) + var(--mx-ime-bottom));
  display: flex;
  flex-direction: column;
}

.head {
  padding: $sp-5 4rpx $sp-3;
}

.title {
  display: block;
  margin-top: 16rpx;
  font-family: $font-display;
  font-size: $fs-h1;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: $lh-tight;
  @include mx-gradient-text;
}

.sub {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  letter-spacing: 2rpx;
  color: $acc-6;
}

.demo-note {
  margin: $sp-2 4rpx $sp-3;
  padding: 16rpx 20rpx;
  border-radius: $r-control;
  background: $brand-soft;
}

.demo-note-text {
  font-size: $fs-micro;
  line-height: 1.5;
  color: $ink-3;
}

.stream {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: $sp-3;
  padding: $sp-2 0;
}

.bubble-wrap {
  display: flex;
}

.bubble-wrap--user {
  justify-content: flex-end;
}

.bubble-wrap--assistant {
  justify-content: flex-start;
}

.bubble {
  max-width: 78%;
  padding: 20rpx 24rpx;
  border-radius: $r-card;
}

.bubble--user {
  background: $brand;
}

.bubble--assistant {
  background: $paper-2;
}

.bubble-text {
  font-size: 30rpx;
  line-height: 1.55;
  color: $ink;
  white-space: pre-wrap;
  word-break: break-all;
}

.bubble--user .bubble-text {
  color: $shell;
}

.error {
  display: block;
  margin-top: $sp-2;
  font-size: $fs-micro;
  color: $signal;
}

.composer {
  display: flex;
  align-items: center;
  gap: $sp-2;
  margin-top: $sp-3;
  padding-top: $sp-3;
  border-top: 1rpx solid $paper-2;
}

.composer-input {
  flex: 1;
  height: 88rpx;
  padding: 0 24rpx;
  border-radius: $r-control;
  background: $paper-2;
  font-size: 30rpx;
  color: $ink;
}

.composer-btn {
  flex-shrink: 0;
  height: 88rpx;
  padding: 0 32rpx;
  border-radius: $r-control;
  background: $solid;
  display: flex;
  align-items: center;
  justify-content: center;
}

.composer-btn--off {
  opacity: 0.45;
}

.composer-btn-text {
  font-size: $fs-meta;
  font-weight: 700;
  color: $on-solid;
}
</style>
