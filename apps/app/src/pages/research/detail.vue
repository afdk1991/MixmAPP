<template>
  <view class="halo">
    <mx-bar />

    <view v-if="!task" class="empty">
      <view class="empty-mark">!</view>
      <text class="empty-title">未找到该研究</text>
      <text class="empty-sub">记录可能已失效，返回重新发起一次研究。</text>
      <view class="btn btn--brand empty-btn" hover-class="is-press" @tap="backToList">
        <text class="empty-btn-text">返回研究记录</text>
      </view>
    </view>

    <view v-else class="rs">
      <!-- ---------- 问题重述 ---------- -->
      <view class="rs-head">
        <view class="rs-head-top">
          <text class="eyebrow">RESEARCH BRIEF</text>
          <text
            class="rs-state mono"
            :class="{ 'rs-state--done': task.status === 'done' }"
          >{{ task.status === 'done' ? '已完成' : '研究中' }}</text>
        </view>
        <text class="rs-query">{{ task.query }}</text>
        <view class="rs-meta">
          <text class="micro">{{ relativeTime(task.createdAt) }}</text>
          <text class="rs-meta-sep">·</text>
          <text class="micro">{{ task.status === 'done' ? `耗时 ${task.durationSec}s` : '多轮检索进行中' }}</text>
          <text class="rs-meta-sep">·</text>
          <text class="micro">{{ task.sourcesCount || visibleSources.length }} 个来源</text>
        </view>

        <!-- 演示模块显式标注：报告与来源均为本地模拟，避免被误认为真实检索结果 -->
        <view class="rs-demo">
          <text class="rs-demo-badge">功能演示</text>
          <text class="rs-demo-text">报告与来源由本地模拟生成，后端 AI 接口上线后自动切换</text>
        </view>
      </view>

      <!-- ---------- 进度时间线 ---------- -->
      <view class="section">
        <view class="sec-head">
          <view class="sec-head-l">
            <text class="eyebrow">PROGRESS</text>
            <text class="sec-title">研究进度</text>
          </view>
          <text class="sec-count mono">{{ Math.min(stepIndex, steps.length) }}/{{ steps.length }}</text>
        </view>
        <view class="rule" />

        <view class="timeline">
          <view
            v-for="(step, i) in stepsView"
            :key="step.id"
            class="tl-row"
            :class="{ 'tl-row--active': step.status === 'active' }"
          >
            <view class="tl-rail">
              <view
                class="tl-dot"
                :class="{
                  'tl-dot--done': step.status === 'done',
                  'tl-dot--active': step.status === 'active',
                  'tl-dot--pending': step.status === 'pending',
                }"
              >
                <text v-if="step.status === 'done'" class="tl-check mono">✓</text>
              </view>
              <view v-if="i < steps.length - 1" class="tl-line" :class="{ 'tl-line--done': step.status === 'done' }" />
            </view>
            <view class="tl-main">
              <text class="tl-label">{{ step.label }}</text>
              <text class="tl-detail">{{ step.detail }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- ---------- 报告 ---------- -->
      <view class="section">
        <view class="sec-head">
          <view class="sec-head-l">
            <text class="eyebrow">REPORT</text>
            <text class="sec-title">研究报告</text>
          </view>
          <text class="sec-count mono">{{ visibleSections.length }}/{{ sections.length }}</text>
        </view>
        <view class="rule" />

        <view v-if="visibleSections.length === 0 && task.status !== 'done'" class="rs-report-skeleton">
          <view v-for="i in 3" :key="i" class="rs-skel-block">
            <view class="sk rs-skel-bar" />
            <view class="sk rs-skel-line" />
            <view class="sk rs-skel-line" />
            <view class="sk rs-skel-line rs-skel-line--short" />
          </view>
        </view>

        <view v-else class="report">
          <view
            v-for="section in visibleSections"
            :key="section.id"
            class="report-sec"
          >
            <text class="report-h" :class="section.level === 3 ? 'report-h--sub' : ''">{{ section.heading }}</text>
            <text
              v-for="(p, pi) in section.paragraphs"
              :key="pi"
              class="report-p"
            >{{ p }}</text>
            <view v-if="section.bullets && section.bullets.length" class="report-bullets">
              <view v-for="(b, bi) in section.bullets" :key="bi" class="report-bullet">
                <text class="report-bullet-mark mono">—</text>
                <text class="report-bullet-text">{{ b }}</text>
              </view>
            </view>
          </view>

          <view v-if="task.status !== 'done' && visibleSections.length < sections.length" class="rs-skel-block">
            <view class="sk rs-skel-bar" />
            <view class="sk rs-skel-line" />
            <view class="sk rs-skel-line rs-skel-line--short" />
          </view>
        </view>
      </view>

      <!-- ---------- 引用来源 ---------- -->
      <view class="section">
        <view class="sec-head">
          <view class="sec-head-l">
            <text class="eyebrow">SOURCES</text>
            <text class="sec-title">引用来源</text>
          </view>
          <text class="sec-count mono">{{ visibleSources.length }}/{{ sources.length }}</text>
        </view>
        <view class="rule" />

        <view v-if="visibleSources.length === 0 && task.status !== 'done'" class="rs-skel-block">
          <view class="sk rs-skel-line" />
          <view class="sk rs-skel-line rs-skel-line--short" />
        </view>

        <view v-else class="sources">
          <view
            v-for="src in visibleSources"
            :key="src.id"
            class="source sheet sheet--pad"
            hover-class="is-press"
            @tap="copySource(src)"
          >
            <view class="source-top">
              <text class="source-title">{{ src.title }}</text>
            </view>
            <view class="source-domain">
              <text class="tag tag--brand">{{ src.domain }}</text>
            </view>
            <text class="source-snippet">{{ src.snippet }}</text>
            <view class="source-foot">
              <text class="source-url mono">{{ src.url }}</text>
              <text class="source-copy mono">复制</text>
            </view>
          </view>
        </view>
      </view>

      <view class="footer">
        <view class="foot-rule" />
        <text class="foot-line mono">MIXMAPP · DEEP RESEARCH</text>
      </view>
    </view>

    <!-- ---------- 底部操作坞 ---------- -->
    <view v-if="task" class="dock">
      <view
        v-if="task.status === 'done'"
        class="dock-btn dock-btn--ghost"
        hover-class="is-press"
        @tap="copyReport"
      >
        <text class="dock-btn-text">复制报告</text>
      </view>
      <view
        class="dock-btn"
        :class="task.status === 'done' ? 'dock-btn--brand' : 'dock-btn--ghost dock-btn--disabled'"
        hover-class="is-press"
        @tap="task.status === 'done' ? reResearch() : backToList()"
      >
        <text class="dock-btn-text">{{ task.status === 'done' ? '重新研究' : '返回记录' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import { ROUTES } from '../../routes';
import { goTo } from '../../navigation';
import MxBar from '../../components/mx-bar/mx-bar.vue';
import { researchApi, researchRelativeTime, type ResearchTask } from '../../api/research';

const task = ref<ResearchTask | null>(null);
const stepIndex = ref(0);
const durationSec = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

const steps = computed(() => task.value?.steps ?? []);
const sections = computed(() => task.value?.sections ?? []);
const sources = computed(() => task.value?.sources ?? []);

function relativeTime(iso: string): string {
  return researchRelativeTime(iso);
}

const stepsView = computed(() =>
  steps.value.map((step, i) => ({
    ...step,
    status: (i < stepIndex.value ? 'done' : i === stepIndex.value ? 'active' : 'pending') as
      | 'pending'
      | 'active'
      | 'done',
  })),
);

const revealedSections = computed(() => {
  const len = sections.value.length;
  if (task.value?.status === 'done') return len;
  if (!len) return 0;
  const ratio = stepIndex.value / Math.max(1, steps.value.length);
  return Math.max(task.value?.stepIndex ?? 0, Math.ceil(ratio * len));
});

const visibleSections = computed(() => sections.value.slice(0, revealedSections.value));

const revealedSources = computed(() => {
  const len = sources.value.length;
  if (task.value?.status === 'done') return len;
  if (!len) return 0;
  const ratio = stepIndex.value / Math.max(1, steps.value.length);
  return Math.max(0, Math.floor(ratio * len));
});

const visibleSources = computed(() => sources.value.slice(0, revealedSources.value));

function stopTimer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function finish(): void {
  stopTimer();
  if (!task.value) return;
  task.value = { ...task.value, status: 'done', stepIndex: steps.value.length, durationSec: durationSec.value || 120 };
  uni.showToast({ title: '研究完成', icon: 'success' });
}

/** 本地模拟器：从当前 stepIndex 推进到完成，期间报告与来源逐步 reveal。 */
function runSimulator(): void {
  if (!task.value) return;
  if (stepIndex.value >= steps.value.length) {
    finish();
    return;
  }
  timer = setInterval(() => {
    if (stepIndex.value >= steps.value.length) {
      finish();
      return;
    }
    stepIndex.value += 1;
    durationSec.value += 1;
  }, 1100);
}

async function loadTask(id: string): Promise<void> {
  const t = await researchApi.getResearch(id);
  if (!t) {
    task.value = null;
    return;
  }
  task.value = t;
  stepIndex.value = t.stepIndex;
  durationSec.value = t.durationSec;
  if (t.status !== 'done' && t.stepIndex < t.steps.length) {
    runSimulator();
  } else {
    stepIndex.value = t.steps.length;
    task.value = { ...t, status: 'done', stepIndex: t.steps.length };
  }
}

function reportPlainText(): string {
  const t = task.value;
  if (!t) return '';
  const lines: string[] = [`# 深度研究：${t.query}`, ''];
  for (const s of t.sections) {
    lines.push(`${s.level === 2 ? '## ' : '### '}${s.heading}`);
    for (const p of s.paragraphs) lines.push(p);
    for (const b of s.bullets ?? []) lines.push(`- ${b}`);
    lines.push('');
  }
  lines.push('## 引用来源');
  for (const src of t.sources) lines.push(`- ${src.title}（${src.domain}） ${src.url}`);
  return lines.join('\n');
}

function copyReport(): void {
  const text = reportPlainText();
  if (!text) return;
  uni.setClipboardData({
    data: text,
    success: () => uni.showToast({ title: '报告已复制', icon: 'none' }),
    fail: () => uni.showToast({ title: '复制失败', icon: 'none' }),
  });
}

function copySource(src: { title: string; url: string }): void {
  uni.setClipboardData({
    data: src.url,
    success: () => uni.showToast({ title: '链接已复制', icon: 'none' }),
    fail: () => uni.showToast({ title: '复制失败', icon: 'none' }),
  });
}

async function reResearch(): Promise<void> {
  if (!task.value) return;
  const next = await researchApi.createResearch(task.value.query);
  uni.redirectTo({ url: `${ROUTES.researchDetail}?id=${encodeURIComponent(next.id)}` });
}

function backToList(): void {
  goTo(ROUTES.research);
}

onLoad((options?: Record<string, any>) => {
  const id = (options as { id?: string })?.id ?? '';
  if (id) void loadTask(id);
  else task.value = null;
});

onUnload(() => stopTimer());
</script>

<style scoped lang="scss">
.halo {
  min-height: 100vh;
  background: $paper;
}

.rs {
  padding: 0 0 calc(220rpx + env(safe-area-inset-bottom));
}

/* ---------- 问题重述 ---------- */
.rs-head {
  padding: calc(36rpx + var(--status-bar-height, 0px)) $sp-4 $sp-4;
  background:
    radial-gradient(80% 120% at 94% 0%, rgba(15, 157, 143, 0.12), rgba(15, 157, 143, 0) 56%),
    $paper;
  border-bottom: 1rpx solid $paper-3;
}

.rs-head-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.rs-state {
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $amber;
}

.rs-state--done {
  color: $brand-deep;
}

.rs-query {
  display: block;
  margin-top: $sp-3;
  font-family: $font-display;
  font-size: $fs-h2;
  font-weight: 800;
  line-height: 1.3;
  letter-spacing: $ls-tight;
  color: $ink;
}

.rs-meta {
  display: flex;
  align-items: center;
  margin-top: $sp-3;
}

.rs-meta-sep {
  margin: 0 12rpx;
  color: $ink-4;
}

/* 演示模块标注：与列表页同一口径 */
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

/* ---------- 区块通用 ---------- */
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

/* ---------- 时间线 ---------- */
.timeline {
  margin-top: $sp-3;
}

.tl-row {
  display: flex;
  align-items: stretch;
}

.tl-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 44rpx;
  flex-shrink: 0;
  margin-right: $sp-3;
}

.tl-dot {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1rpx solid $paper-3;
  background: $shell;
}

.tl-dot--done {
  background: $brand;
  border-color: transparent;
}

.tl-dot--active {
  background: $amber;
  border-color: transparent;
  animation: pulse 1.4s ease-in-out infinite;
}

.tl-dot--pending {
  background: $paper-2;
}

.tl-check {
  font-size: $fs-micro;
  line-height: 1;
  color: $on-solid;
}

.tl-line {
  width: 1rpx;
  flex: 1;
  margin: 4rpx 0;
  background: $paper-3;
}

.tl-line--done {
  background: $brand;
}

.tl-main {
  flex: 1;
  min-width: 0;
  padding: 4rpx 0 $sp-4;
}

.tl-label {
  display: block;
  font-size: $fs-body;
  font-weight: 600;
  line-height: 1.4;
  color: $ink;
}

.tl-row--active .tl-label {
  color: $amber;
}

.tl-detail {
  display: block;
  margin-top: 4rpx;
  font-size: $fs-micro;
  line-height: 1.5;
  color: $ink-3;
}

/* ---------- 报告 ---------- */
.report {
  margin-top: $sp-3;
}

.report-sec {
  margin-bottom: $sp-5;
}

.report-h {
  display: block;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  line-height: 1.3;
  letter-spacing: $ls-tight;
  color: $ink;
}

.report-h--sub {
  font-size: $fs-body;
  margin-top: $sp-3;
}

.report-p {
  display: block;
  margin-top: $sp-2;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

.report-bullets {
  margin-top: $sp-2;
}

.report-bullet {
  display: flex;
  align-items: flex-start;
  margin-top: 12rpx;
}

.report-bullet-mark {
  flex-shrink: 0;
  margin-right: 14rpx;
  font-size: $fs-meta;
  color: $brand-deep;
}

.report-bullet-text {
  flex: 1;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

/* ---------- 来源 ---------- */
.sources {
  margin-top: $sp-3;
}

.source {
  margin-bottom: $sp-3;
}

.source-top {
  display: flex;
  align-items: flex-start;
}

.source-title {
  font-size: $fs-body;
  font-weight: 600;
  line-height: 1.4;
  color: $ink;
}

.source-domain {
  margin-top: 12rpx;
}

.source-snippet {
  display: block;
  margin-top: $sp-2;
  font-size: $fs-micro;
  line-height: 1.6;
  color: $ink-3;
}

.source-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: $sp-2;
  padding-top: $sp-2;
  border-top: 1rpx solid $paper-2;
}

.source-url {
  flex: 1;
  min-width: 0;
  margin-right: $sp-2;
  font-size: $fs-micro;
  color: $ink-4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-copy {
  flex-shrink: 0;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $brand-deep;
}

/* ---------- 骨架 ---------- */
.rs-report-skeleton,
.rs-skel-block {
  margin-top: $sp-3;
}

.rs-skel-block:not(:last-child) {
  margin-bottom: $sp-5;
}

.rs-skel-bar {
  height: 34rpx;
  width: 50%;
  border-radius: 8rpx;
  margin-bottom: $sp-3;
}

.rs-skel-line {
  height: 24rpx;
  width: 100%;
  margin-top: 14rpx;
  border-radius: 8rpx;
}

.rs-skel-line--short {
  width: 62%;
}

/* ---------- 底部 dock ---------- */
.dock {
  position: fixed;
  left: $sp-3;
  right: $sp-3;
  bottom: calc(#{$sp-2} + env(safe-area-inset-bottom));
  z-index: 90;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 10rpx;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  box-shadow: $shadow-lift;
}

/* 顶部渐隐遮罩：让经过 dock 的内容“溶入”操作坞，避免硬切截断感 */
.dock::before {
  content: '';
  position: absolute;
  left: -1rpx;
  right: -1rpx;
  top: -56rpx;
  height: 56rpx;
  background: linear-gradient(to top, $shell 0%, var(--mx-shell-fade) 100%);
  pointer-events: none;
}

.dock-btn {
  flex: 1;
  height: 76rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: $r-control;
}

.dock-btn--brand {
  background: $brand;
}

.dock-btn--ghost {
  background: $shell;
  border: 1rpx solid $paper-3;
}

.dock-btn--disabled {
  opacity: 0.5;
}

.dock-btn-text {
  font-size: $fs-meta;
  font-weight: 600;
  color: $on-solid;
}

.dock-btn--ghost .dock-btn-text {
  color: $ink-2;
}

/* ---------- 空态 ---------- */
.empty {
  padding: calc(180rpx + var(--status-bar-height, 0px)) $sp-4 120rpx;
  text-align: center;
}

.empty-btn {
  margin: $sp-5 auto 0;
  width: 60%;
}

.empty-btn-text {
  font-size: $fs-meta;
  font-weight: 600;
  color: $on-solid;
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

  .dock {
    left: 50%;
    right: auto;
    width: 702px;
    transform: translateX(-50%);
  }
}
</style>
