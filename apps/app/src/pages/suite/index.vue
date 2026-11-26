<template>
  <view class="page page--wide suite-hub">
    <mx-bar title="业务套件" hide-back />

    <view class="hub-hero">
      <text class="eyebrow">MIXMAPP · 13 个领域</text>
      <text class="page-title hub-hero__title">一个账号，一套业务能力</text>
      <text class="hub-hero__lead">
        每个领域都是「静态说明 + 动态台账」两层：说明随包内置，打开即读、不等接口；
        台账与互动实时落库，登录后即可推进。
      </text>
      <view class="hub-hero__stats">
        <view class="hub-stat">
          <text class="hub-stat__num mono">{{ packs.length }}</text>
          <text class="hub-stat__label">个领域</text>
        </view>
        <view class="hub-stat">
          <text class="hub-stat__num mono">{{ totalEntries }}</text>
          <text class="hub-stat__label">个条目</text>
        </view>
        <view class="hub-stat">
          <text class="hub-stat__num mono">{{ totalFaq }}</text>
          <text class="hub-stat__label">条问答</text>
        </view>
      </view>
    </view>

    <view v-for="group in groups" :key="group.category" class="hub-group">
      <view class="hub-group__head">
        <view class="hub-group__bar" />
        <text class="hub-group__name">{{ group.category }}</text>
        <text class="hub-group__count mono">{{ group.packs.length }}</text>
      </view>

      <view class="hub-grid">
        <view
          v-for="pack in group.packs"
          :key="pack.id"
          class="hub-card"
          hover-class="is-press"
          role="link"
          :aria-label="`进入${pack.title}`"
          @tap="open(pack.id)"
        >
          <mx-domain-mark :text="pack.title.slice(0, 2)" :accent="pack.accent" size="md" />
          <text class="hub-card__title">{{ pack.title }}</text>
          <text class="hub-card__tagline">{{ pack.tagline }}</text>
          <view class="hub-card__foot">
            <text class="hub-card__entries mono">{{ pack.entries.length }} 条目</text>
            <text class="hub-card__arrow mono">→</text>
          </view>
        </view>
      </view>
    </view>

    <view class="hub-foot">
      <text class="micro">内容随版本更新 · 互动与台账实时保存</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MxBar from '../../components/mx-bar/mx-bar.vue';
import MxDomainMark from '../../components/suite/mx-domain-mark.vue';
import { groupSuiteContent, listSuiteContent } from '../../content/suite';
import { goTo } from '../../navigation';
import { ROUTES, SUITE_ROUTE_BY_DOMAIN } from '../../routes';
import { applySuiteSeo } from '../../site-seo';

/**
 * 业务套件中心。
 *
 * 目录数据完全来自构建期内联的内容包 —— 打开即完整可见，不发一个请求，
 * 也不需要等接口回来才让用户看到「这里有什么」。
 */
const packs = listSuiteContent();
const groups = groupSuiteContent();

const totalEntries = computed(() =>
  packs.reduce((sum, pack) => sum + pack.entries.length, 0),
);
const totalFaq = computed(() => packs.reduce((sum, pack) => sum + pack.faq.length, 0));

function open(domainId: string): void {
  const route = SUITE_ROUTE_BY_DOMAIN[domainId];
  if (!route) return;
  goTo(route);
}

applySuiteSeo({
  title: '业务套件 · 13 个领域',
  description:
    'MixmAPP 业务套件：办公管理、效率工具、产品研发、工程、金融、财税支付、营销增长、电商、内容创作、教育科研、医疗医药、法律政务、生活休闲，每个领域都是静态说明加动态台账。',
  path: ROUTES.suite,
});
</script>

<style scoped lang="scss">
.suite-hub {
  padding-bottom: $sp-8;
}

.hub-hero {
  padding: $sp-5 $sp-4 $sp-5;
  background: linear-gradient(160deg, $deep 0%, $deep-3 100%);
}

.hub-hero .eyebrow {
  color: $acc-on-deep-1;
}

.hub-hero__title {
  display: block;
  margin-top: $sp-2;
  color: $on-deep;
}

.hub-hero__lead {
  display: block;
  margin-top: $sp-3;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $on-deep-2;
}

.hub-hero__stats {
  display: flex;
  gap: $sp-3;
  margin-top: $sp-5;
}

.hub-stat {
  flex: 1;
  padding: $sp-3;
  border-radius: $r-control;
  background: $on-deep-soft;
}

.hub-stat__num {
  display: block;
  font-size: $fs-h2;
  font-weight: 800;
  color: $on-deep;
}

.hub-stat__label {
  display: block;
  margin-top: 4rpx;
  font-size: $fs-micro;
  color: $on-deep-3;
}

.hub-group {
  padding: $sp-5 $sp-4 0;
}

.hub-group__head {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-bottom: $sp-3;
}

.hub-group__bar {
  width: 10rpx;
  height: 28rpx;
  background: $acc-1;
}

.hub-group__name {
  flex: 1;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  color: $ink;
}

.hub-group__count {
  font-size: $fs-micro;
  color: $ink-4;
}

.hub-grid {
  display: flex;
  flex-wrap: wrap;
  gap: $sp-3;
}

.hub-card {
  width: 336rpx;
  box-sizing: border-box;
  padding: $sp-4;
  border-radius: $r-card;
  background: $shell;
  border: 1rpx solid $paper-3;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.hub-card__title {
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  color: $ink;
}

.hub-card__tagline {
  flex: 1;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-3;
}

.hub-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 12rpx;
  border-top: 1rpx solid $paper-3;
}

.hub-card__entries {
  font-size: $fs-micro;
  color: $ink-4;
}

.hub-card__arrow {
  font-size: $fs-meta;
  color: $brand-deep;
}

.hub-foot {
  padding: $sp-6 $sp-4 $sp-4;
  text-align: center;
}

@media (min-width: 768px) {
  .hub-grid {
    gap: $sp-4;
  }

  .hub-card {
    width: calc((100% - #{$sp-4}) / 2);
  }
}

@media (min-width: 1000px) {
  .hub-card {
    width: calc((100% - #{$sp-4} * 2) / 3);
  }
}
</style>
