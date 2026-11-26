<template>
  <view class="page page--wide suite">
    <mx-bar :title="content.title" />

    <!-- ============ 首屏：静态内容，零请求 ============ -->
    <view class="suite-hero">
      <view class="suite-hero__top">
        <mx-domain-mark :text="content.title.slice(0, 2)" :accent="content.accent" size="lg" />
        <view class="suite-hero__id">
          <text class="eyebrow">{{ content.category }}</text>
          <text class="suite-hero__updated mono">更新于 {{ content.updatedAt }}</text>
        </view>
      </view>

      <text class="suite-hero__title serif">{{ content.title }}</text>
      <text class="suite-hero__tagline">{{ content.tagline }}</text>
      <text class="suite-hero__lead">{{ content.hero.lead }}</text>

      <view class="suite-hero__points">
        <view v-for="(point, i) in content.hero.points" :key="i" class="suite-hero__point">
          <text class="suite-hero__point-no mono">{{ String(i + 1).padStart(2, '0') }}</text>
          <text class="suite-hero__point-text">{{ point }}</text>
        </view>
      </view>
    </view>

    <!-- ============ 价值主张 ============ -->
    <view v-if="content.highlights.length" class="suite-block">
      <view v-for="h in content.highlights" :key="h.title" class="suite-hl">
        <text class="suite-hl__title">{{ h.title }}</text>
        <text class="suite-hl__detail">{{ h.detail }}</text>
      </view>
    </view>

    <!-- ============ 领域动态面板（各领域实现） ============ -->
    <slot name="dynamic" />

    <!-- ============ 目录 ============ -->
    <view v-if="content.sections.length > 1" class="suite-toc">
      <text class="micro">本页目录</text>
      <view class="suite-toc__list">
        <view
          v-for="s in content.sections"
          :key="s.id"
          class="suite-toc__item"
          hover-class="is-press"
          role="button"
          :aria-label="`跳到${s.title}`"
          @tap="scrollTo(s.id)"
        >
          <text class="suite-toc__text">{{ s.title }}</text>
        </view>
      </view>
    </view>

    <!-- ============ 正文章节（SEO 正文） ============ -->
    <view v-for="s in content.sections" :id="s.id" :key="s.id" class="suite-section">
      <text class="sec-title suite-section__title">{{ s.title }}</text>
      <text class="suite-section__body">{{ s.body }}</text>
      <view v-if="s.bullets && s.bullets.length" class="suite-section__list">
        <view v-for="(b, i) in s.bullets" :key="i" class="suite-section__bullet">
          <view class="suite-section__dot" />
          <text class="suite-section__bullet-text">{{ b }}</text>
        </view>
      </view>
    </view>

    <!-- ============ 条目清单（交互锚点） ============ -->
    <view v-if="content.entries.length" class="suite-entries">
      <text class="sec-title suite-entries__title">条目与清单</text>
      <view v-for="e in content.entries" :key="e.id" class="suite-entry">
        <view class="suite-entry__head">
          <text class="suite-entry__title">{{ e.title }}</text>
          <view v-if="e.tags && e.tags.length" class="suite-entry__tags">
            <text v-for="t in e.tags" :key="t" class="tag suite-entry__tag">{{ t }}</text>
          </view>
        </view>
        <text class="suite-entry__summary">{{ e.summary }}</text>

        <view v-if="e.meta && e.meta.length" class="suite-entry__meta">
          <view v-for="m in e.meta" :key="m.label" class="suite-entry__meta-row">
            <text class="suite-entry__meta-label">{{ m.label }}</text>
            <text class="suite-entry__meta-value">{{ m.value }}</text>
          </view>
        </view>

        <view v-if="e.checklist && e.checklist.length" class="suite-entry__checklist">
          <view v-for="(c, i) in e.checklist" :key="i" class="suite-entry__check-item">
            <view class="suite-entry__check-box" />
            <text class="suite-entry__check-text">{{ c }}</text>
          </view>
        </view>

        <text v-if="e.note" class="suite-entry__note">{{ e.note }}</text>

        <!-- 领域专属补充位（如剂量表、税率表、材料参数） -->
        <slot name="entry" :entry="e" />

        <suite-interaction-bar
          :domain-id="content.id"
          :entry-id="e.id"
          @need-login="onNeedLogin"
        />
      </view>
    </view>

    <!-- ============ 常见问题 ============ -->
    <view v-if="content.faq.length" class="suite-faq">
      <text class="sec-title suite-faq__title">常见问题</text>
      <view v-for="(f, i) in content.faq" :key="i" class="suite-faq__item">
        <text class="suite-faq__q">{{ f.q }}</text>
        <text class="suite-faq__a">{{ f.a }}</text>
      </view>
    </view>

    <view class="suite-foot">
      <text class="micro">内容更新于 {{ content.updatedAt }} · 动态数据实时加载</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import type { SuiteContent } from '../../content/suite/types';
import MxBar from '../mx-bar/mx-bar.vue';
import MxDomainMark from './mx-domain-mark.vue';
import SuiteInteractionBar from './suite-interaction-bar.vue';
import { goTo } from '../../navigation';
import { ROUTES } from '../../routes';

/**
 * 业务套件详情页外壳。
 *
 * 13 个领域共用这一份版式，领域之间只有内容包与动态面板不同 ——
 * 这样「整体体验一致」不靠人工对齐，而是结构上就只有一处。
 *
 * 静态内容（首屏 / 主张 / 章节 / 条目 / FAQ）全部来自内容包，
 * 渲染不依赖任何请求；动态面板与交互条由插槽与子组件异步补上。
 */
defineProps<{ content: SuiteContent }>();

const emit = defineEmits<{ needLogin: [] }>();

/** 目录跳转：H5 用原生锚点滚动，小程序/App 端退化为提示（uni 不支持任意锚点滚动）。 */
function scrollTo(id: string): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function onNeedLogin(): void {
  emit('needLogin');
  goTo(`${ROUTES.login}?redirect=${encodeURIComponent(currentPath())}`);
}

function currentPath(): string {
  if (typeof window !== 'undefined') return window.location.pathname + window.location.search;
  return ROUTES.suite;
}
</script>

<style scoped lang="scss">
.suite {
  padding-bottom: $sp-8;
}

/* ---------- 首屏 ---------- */
.suite-hero {
  padding: $sp-5 $sp-4 $sp-6;
  background: linear-gradient(160deg, $deep 0%, $deep-3 100%);
}

.suite-hero__top {
  display: flex;
  align-items: center;
  gap: $sp-3;
  margin-bottom: $sp-4;
}

.suite-hero__id {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  min-width: 0;
}

.suite-hero__id .eyebrow {
  color: $acc-on-deep-1;
}

.suite-hero__updated {
  font-size: $fs-micro;
  color: $on-deep-3;
}

.suite-hero__title {
  display: block;
  font-size: $fs-h1;
  color: $on-deep;
  margin-bottom: $sp-2;
}

.suite-hero__tagline {
  display: block;
  font-size: $fs-body;
  color: $on-deep-2;
  line-height: $lh-body;
}

.suite-hero__lead {
  display: block;
  margin-top: $sp-4;
  font-size: $fs-body;
  line-height: $lh-body;
  color: $on-deep;
}

.suite-hero__points {
  margin-top: $sp-5;
  display: flex;
  flex-direction: column;
  gap: $sp-2;
}

.suite-hero__point {
  display: flex;
  align-items: baseline;
  gap: $sp-3;
  padding: $sp-3;
  border-radius: $r-control;
  background: $on-deep-soft;
}

.suite-hero__point-no {
  font-size: $fs-micro;
  color: $acc-on-deep-1;
}

.suite-hero__point-text {
  flex: 1;
  min-width: 0;
  font-size: $fs-meta;
  color: $on-deep;
  line-height: $lh-snug;
}

/* ---------- 主张 ---------- */
.suite-block {
  padding: $sp-4;
  display: flex;
  flex-direction: column;
  gap: $sp-2;
}

.suite-hl {
  padding: $sp-4;
  border-radius: $r-card;
  background: $shell;
  border: 1rpx solid $paper-3;
}

.suite-hl__title {
  display: block;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  color: $ink;
  margin-bottom: 8rpx;
}

.suite-hl__detail {
  display: block;
  font-size: $fs-meta;
  color: $ink-2;
  line-height: $lh-body;
}

/* ---------- 目录 ---------- */
.suite-toc {
  margin: $sp-2 $sp-4 $sp-4;
  padding: $sp-3;
  border-radius: $r-card;
  background: $paper-2;
}

.suite-toc__list {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 12rpx;
}

.suite-toc__item {
  padding: 10rpx 18rpx;
  border-radius: $r-control;
  background: $shell;
  border: 1rpx solid $paper-3;
}

.suite-toc__text {
  font-size: $fs-micro;
  color: $ink-2;
}

/* ---------- 章节 ---------- */
.suite-section {
  padding: 0 $sp-4 $sp-5;
}

.suite-section__title {
  display: block;
  margin-bottom: $sp-2;
}

.suite-section__body {
  display: block;
  font-size: $fs-body;
  line-height: $lh-body;
  color: $ink-2;
}

.suite-section__list {
  margin-top: $sp-3;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.suite-section__bullet {
  display: flex;
  align-items: baseline;
  gap: 14rpx;
}

.suite-section__dot {
  width: 10rpx;
  height: 10rpx;
  flex: 0 0 auto;
  margin-top: 14rpx;
  background: $acc-1;
}

.suite-section__bullet-text {
  flex: 1;
  min-width: 0;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

/* ---------- 条目 ---------- */
.suite-entries {
  padding: 0 $sp-4 $sp-4;
}

.suite-entries__title {
  display: block;
  margin-bottom: $sp-3;
}

.suite-entry {
  padding: $sp-4;
  margin-bottom: $sp-3;
  border-radius: $r-card;
  background: $shell;
  border: 1rpx solid $paper-3;
}

.suite-entry__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $sp-2;
}

.suite-entry__title {
  flex: 1;
  min-width: 0;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  color: $ink;
}

.suite-entry__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  flex: 0 0 auto;
}

.suite-entry__tag {
  height: 40rpx;
  font-size: $fs-xs;
}

.suite-entry__summary {
  display: block;
  margin-top: 12rpx;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

.suite-entry__meta {
  margin-top: $sp-3;
  padding: $sp-3;
  border-radius: $r-control;
  background: $paper-2;
}

.suite-entry__meta-row {
  display: flex;
  justify-content: space-between;
  gap: $sp-3;
  padding: 4rpx 0;
}

.suite-entry__meta-label {
  flex: 0 0 auto;
  font-family: $font-mono;
  font-size: $fs-micro;
  color: $ink-4;
}

.suite-entry__meta-value {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: $fs-micro;
  color: $ink-2;
}

.suite-entry__checklist {
  margin-top: $sp-3;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.suite-entry__check-item {
  display: flex;
  align-items: baseline;
  gap: 14rpx;
}

.suite-entry__check-box {
  width: 22rpx;
  height: 22rpx;
  flex: 0 0 auto;
  border-radius: $r-xs;
  border: 2rpx solid $paper-3;
  background: $shell;
  transform: translateY(4rpx);
}

.suite-entry__check-text {
  flex: 1;
  min-width: 0;
  font-size: $fs-meta;
  color: $ink-2;
  line-height: $lh-body;
}

.suite-entry__note {
  display: block;
  margin-top: $sp-3;
  padding: 12rpx 16rpx;
  border-radius: $r-control;
  background: $amber-soft;
  font-size: $fs-xs;
  color: $ink-2;
  line-height: $lh-body;
}

/* ---------- FAQ ---------- */
.suite-faq {
  padding: 0 $sp-4 $sp-5;
}

.suite-faq__title {
  display: block;
  margin-bottom: $sp-3;
}

.suite-faq__item {
  padding: $sp-3 0;
  border-bottom: 1rpx solid $paper-3;
}

.suite-faq__q {
  display: block;
  font-size: $fs-body;
  font-weight: 600;
  color: $ink;
}

.suite-faq__a {
  display: block;
  margin-top: 8rpx;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-3;
}

.suite-foot {
  padding: $sp-4;
  text-align: center;
}
</style>
