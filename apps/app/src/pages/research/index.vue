<template>
  <view class="halo">
    <mx-bar />

    <view class="rs">
      <!-- ---------- 提问区 ---------- -->
      <view class="rs-hero">
        <text class="eyebrow">DEEP RESEARCH</text>
        <text class="rs-title">深度研究</text>
        <text class="rs-lede">提出问题，AI 多轮检索与综合，生成带引用来源的结构化研究报告。</text>

        <!-- 演示模块显式标注：后端 /ai/research 未上线前，报告由本地工厂生成，避免被当成真实数据 -->
        <view class="rs-demo">
          <text class="rs-demo-badge">功能演示</text>
          <text class="rs-demo-text">当前报告由本地模拟生成，后端 AI 接口上线后自动切换真实数据</text>
        </view>

        <view class="rs-qcard sheet sheet--pad">
          <textarea
            v-model="query"
            class="rs-textarea"
            :class="{ 'rs-textarea--filled': query.length }"
            placeholder="例如：高强度紧固件的材料选型与防松设计要点"
            placeholder-class="field-ph"
            maxlength="200"
            :disabled="starting"
            @confirm="startResearch"
          />
          <view class="rs-qfoot">
            <text class="rs-count mono">{{ query.length }}/200</text>
            <view
              class="btn btn--brand rs-start"
              :class="{ 'btn--disabled': starting || !query.trim() }"
              hover-class="is-press"
              @tap="startResearch"
            >
              <text class="rs-start-text">{{ starting ? '研究中…' : '开始研究' }}</text>
            </view>
          </view>
        </view>

        <view class="rs-samples">
          <view class="rs-samples-grid">
            <view
              v-for="(sample, i) in samples"
              :key="i"
              class="tag rs-sample"
              hover-class="is-press"
              @tap="useSample(sample)"
            >
              <text class="rs-sample-text">{{ sample }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- ---------- 历史研究 ---------- -->
      <view class="section">
        <view class="sec-head">
          <view class="sec-head-l">
            <text class="eyebrow">HISTORY</text>
            <text class="sec-title">研究记录</text>
          </view>
          <text class="sec-count mono">共 {{ history.length }} 条</text>
        </view>
        <view class="rule" />

        <view v-if="loading" class="rs-hist-skeleton">
          <view v-for="i in 2" :key="i" class="rs-skel-row">
            <view class="sk rs-skel-dot" />
            <view class="rs-skel-lines">
              <view class="sk rs-skel-line" />
              <view class="sk rs-skel-line rs-skel-line--short" />
            </view>
          </view>
        </view>

        <view v-else-if="history.length === 0" class="empty">
          <view class="empty-mark">∅</view>
          <text class="empty-title">还没有研究记录</text>
          <text class="empty-sub">在上方输入一个问题，开始你的第一次深度研究。</text>
        </view>

        <view v-else class="index-list">
          <view
            v-for="task in history"
            :key="task.id"
            class="rs-hist-row"
            hover-class="is-press"
            @tap="openTask(task)"
          >
            <view
              class="rs-dot"
              :class="{
                'rs-dot--done': task.status === 'done',
                'rs-dot--active': task.status !== 'done',
              }"
            />
            <view class="rs-hist-main">
              <text class="rs-hist-title">{{ task.query }}</text>
              <view class="rs-hist-meta">
                <text class="micro">{{ relativeTime(task.createdAt) }}</text>
                <text class="rs-hist-sep">·</text>
                <text class="micro">{{ task.status === 'done' ? `${task.sourcesCount} 个来源` : '进行中' }}</text>
              </view>
            </view>
            <text class="rs-hist-tag mono" :class="{ 'rs-hist-tag--done': task.status === 'done' }">
              {{ task.status === 'done' ? '已完成' : '研究中' }}
            </text>
            <text class="index-arrow mono">→</text>
          </view>
        </view>
      </view>

      <view class="footer">
        <view class="foot-rule" />
        <text class="foot-line mono">MIXMAPP · DEEP RESEARCH</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { ROUTES } from '../../routes';
import { goTo } from '../../navigation';
import MxBar from '../../components/mx-bar/mx-bar.vue';
import { researchApi, researchRelativeTime, type ResearchTask } from '../../api/research';

const samples = [
  '高强度紧固件的材料选型与防松设计要点',
  '中国工业紧固件出口市场格局 2026',
  'M12 内六角螺栓的扭矩与预紧力计算',
  '不锈钢 304 与 316 的耐蚀性差异',
];

const query = ref('');
const history = ref<ResearchTask[]>([]);
const loading = ref(false);
const starting = ref(false);

function relativeTime(iso: string): string {
  return researchRelativeTime(iso);
}

async function loadHistory(): Promise<void> {
  loading.value = true;
  try {
    const list = await researchApi.listResearch();
    // 进行中置顶，已完成按时间倒序
    history.value = [...list].sort((a, b) => {
      const aRank = a.status === 'done' ? 1 : 0;
      const bRank = b.status === 'done' ? 1 : 0;
      if (aRank !== bRank) return aRank - bRank;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  } catch {
    history.value = [];
  } finally {
    loading.value = false;
  }
}

function useSample(text: string): void {
  query.value = text;
}

async function startResearch(): Promise<void> {
  const q = query.value.trim();
  if (!q || starting.value) return;
  starting.value = true;
  try {
    const task = await researchApi.createResearch(q);
    goTo(`${ROUTES.researchDetail}?id=${encodeURIComponent(task.id)}`);
  } catch {
    uni.showToast({ title: '发起研究失败，请重试', icon: 'none' });
    starting.value = false;
  }
}

function openTask(task: ResearchTask): void {
  goTo(`${ROUTES.researchDetail}?id=${encodeURIComponent(task.id)}`);
}

onLoad(() => {
  void loadHistory();
});

onPullDownRefresh(() => {
  void loadHistory().then(() => uni.stopPullDownRefresh());
});
</script>

<style scoped lang="scss">
.halo {
  min-height: 100vh;
  background: $paper;
}

.rs {
  padding-bottom: calc(120rpx + env(safe-area-inset-bottom));
}

/* ---------- 提问区 ---------- */
.rs-hero {
  padding: calc(40rpx + var(--status-bar-height, 0px)) $sp-4 $sp-5;
  background:
    radial-gradient(80% 120% at 94% 0%, rgba(15, 157, 143, 0.12), rgba(15, 157, 143, 0) 56%),
    $paper;
  border-bottom: 1rpx solid $paper-3;
}

.rs-title {
  display: block;
  margin-top: $sp-3;
  font-family: $font-display;
  font-size: $fs-h1;
  font-weight: 800;
  line-height: $lh-tight;
  letter-spacing: $ls-tight;
  color: $ink;
}

.rs-lede {
  display: block;
  margin-top: $sp-3;
  padding-right: $sp-4;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-3;
}

/* 演示模块标注：中性提示，不抢主视觉 */
.rs-demo {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  margin-top: $sp-2;
}

.rs-demo-badge {
  margin-right: $sp-2;
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  background: rgba(15, 157, 143, 0.12);
  color: $brand-deep;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
}

.rs-demo-text {
  font-size: $fs-micro;
  color: $ink-4;
}

.rs-qcard {
  margin-top: $sp-4;
}

.rs-textarea {
  width: 100%;
  height: 200rpx;
  box-sizing: border-box;
  padding: $sp-3;
  background: $paper-2;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  font-size: $fs-body;
  line-height: $lh-body;
  color: $ink;
}

.rs-textarea--filled {
  background: $shell;
}

.rs-qfoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: $sp-3;
}

.rs-count {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-4;
}

.rs-start {
  height: 84rpx;
  padding: 0 $sp-5;
  margin: 0;
}

.rs-start-text {
  font-size: $fs-meta;
  font-weight: 600;
  color: $on-solid;
}

.rs-samples {
  margin-top: $sp-3;
}

.rs-samples-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx 12rpx;
}

.rs-sample {
  display: inline-flex;
  max-width: 100%;
}

.rs-sample-text {
  font-size: $fs-micro;
  letter-spacing: 0.5rpx;
  color: $ink-2;
}

/* ---------- 历史研究 ---------- */
.section {
  margin-top: $sp-6;
  padding: 0 $sp-3;
}

.sec-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: $sp-2;
}

.sec-head-l {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.sec-title {
  margin-top: 10rpx;
  font-family: $font-display;
  font-size: $fs-h2;
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: $ls-tight;
  color: $ink;
}

.sec-count {
  flex-shrink: 0;
  margin-left: $sp-3;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-4;
}

.index-list {
  margin-top: $sp-2;
}

.rs-hist-row {
  display: flex;
  align-items: center;
  padding: $sp-3 0;
  border-bottom: 1rpx solid $paper-2;
}

.rs-hist-row:last-child {
  border-bottom: none;
}

.rs-dot {
  width: 14rpx;
  height: 14rpx;
  flex-shrink: 0;
  border-radius: 50%;
  margin-right: $sp-3;
}

.rs-dot--done {
  background: $brand;
}

.rs-dot--active {
  background: $amber;
  animation: pulse 1.6s ease-in-out infinite;
}

.rs-hist-main {
  flex: 1;
  min-width: 0;
  margin-right: $sp-3;
}

.rs-hist-title {
  display: block;
  font-size: $fs-body;
  font-weight: 600;
  line-height: 1.4;
  color: $ink;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rs-hist-meta {
  display: flex;
  align-items: center;
  margin-top: 6rpx;
}

.rs-hist-sep {
  margin: 0 10rpx;
  color: $ink-4;
}

.rs-hist-tag {
  flex-shrink: 0;
  padding: 4rpx 14rpx;
  border-radius: $r-control;
  background: rgba(164, 118, 28, 0.12);
  font-size: $fs-micro;
  letter-spacing: 1.5rpx;
  color: $amber;
}

.rs-hist-tag--done {
  background: $brand-soft;
  color: $brand-deep;
}

/* ---------- 骨架 ---------- */
.rs-hist-skeleton {
  margin-top: $sp-3;
}

.rs-skel-row {
  display: flex;
  align-items: center;
  padding: $sp-3 0;
  border-bottom: 1rpx solid $paper-2;
}

.rs-skel-dot {
  width: 14rpx;
  height: 14rpx;
  flex-shrink: 0;
  border-radius: 50%;
  margin-right: $sp-3;
}

.rs-skel-lines {
  flex: 1;
}

.rs-skel-line {
  height: 26rpx;
  width: 70%;
  margin-top: 12rpx;
  border-radius: 8rpx;
}

.rs-skel-line--short {
  width: 40%;
}

/* ---------- 页脚 ---------- */
.footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: $sp-8;
}

.foot-rule {
  width: 64rpx;
  height: 1rpx;
  margin-bottom: 26rpx;
  background: $paper-3;
}

.foot-line {
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $ink-4;
}

@media (min-width: 768px) {
  .rs {
    max-width: 750px;
    margin-left: auto;
    margin-right: auto;
    box-sizing: border-box;
  }
}
</style>
