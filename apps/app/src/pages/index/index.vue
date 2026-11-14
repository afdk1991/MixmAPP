<template>
  <view class="halo">
    <view class="page page--wide home">
      <!-- ---------- 档案封面（深场） ---------- -->
      <view class="hero">
        <view class="hero-inner">
          <text class="hero-eyebrow mono">MULTI-END IDENTITY</text>
          <view class="hero-title-wrap">
            <text class="hero-title">一张通行证</text>
            <text class="hero-title hero-title--accent">通行所有星域</text>
          </view>
          <text class="hero-lede">Web・Android・iOS・鸿蒙 —— 注册即签发星际联邦通行证，并分配唯一的 MixmAPP 公民编号</text>

          <mx-logo class="hero-logo" size="lg" tone="light" sub="MIXMAPP APP" />

          <view class="hero-meta">
            <view class="meta-item">
              <text class="meta-k mono">版本</text>
              <text class="meta-v mono">{{ version }}</text>
            </view>
            <view class="meta-sep" />
            <view class="meta-item">
              <text class="meta-k mono">环境</text>
              <text class="meta-v mono">{{ env }}</text>
            </view>
            <view class="meta-sep" />
            <view class="meta-item">
              <text class="meta-k mono">链路</text>
              <view class="meta-status">
                <view class="status-dot" :class="{ 'status-dot--off': !online }" />
                <text class="meta-v mono">{{ online ? 'ONLINE' : 'OFFLINE' }}</text>
              </view>
            </view>
          </view>

          <view v-if="error" class="hero-error">
            <view class="hero-error-mark mono">!</view>
            <view class="hero-error-main">
              <text class="hero-error-title">API 暂不可用</text>
              <text class="hero-error-text mono">{{ error }}</text>
            </view>
            <view class="hero-retry" hover-class="is-press" @tap="loadMeta">
              <text class="hero-retry-text mono">重试</text>
            </view>
          </view>
        </view>
      </view>

      <!-- ---------- 索引条目（纸面） ---------- -->
      <view class="body">
        <view class="cta" hover-class="is-press" @tap="go(primaryUrl)">
          <text class="cta-kicker mono">{{ signedIn ? 'SIGNED IN' : 'GET STARTED' }}</text>
          <view class="cta-main">
            <view class="cta-text">
              <text class="cta-title">{{ signedIn ? '查看联邦通行证' : '登录 / 领取星际联邦通行证' }}</text>
              <text class="cta-sub">{{ signedIn ? '编号 · 绑定方式 · 账号资料' : '登录 · 注册 · 30 秒签发' }}</text>
            </view>
            <text class="cta-arrow mono">→</text>
          </view>
        </view>

        <!-- ---------- 精选目录：真实商城数据，含空/错/骨架/破图兜底 ---------- -->
        <view class="section pick">
          <view class="sec-head">
            <view class="sec-head-l">
              <text class="eyebrow">CATALOG</text>
              <text class="sec-title">精选目录</text>
            </view>
            <text class="sec-count mono">实时数据 · {{ tabCategories.length }} 类</text>
          </view>
          <view class="rule" />

          <scroll-view v-if="tabCategories.length" :scroll-x="true" class="pick-chips" :show-scrollbar="false">
            <view
              class="pick-chip"
              :class="{ 'pick-chip--active': activeCategory === '' }"
              hover-class="is-press"
              @tap="switchCategory('')"
            >
              <text class="pick-chip-label">全部</text>
            </view>
            <view
              v-for="cat in tabCategories"
              :key="cat.code"
              class="pick-chip"
              :class="{ 'pick-chip--active': activeCategory === cat.code }"
              hover-class="is-press"
              @tap="switchCategory(cat.code)"
            >
              <text class="pick-chip-label">{{ cat.name }}</text>
              <text v-if="cat.count > 0" class="pick-chip-count mono">{{ cat.count }}</text>
            </view>
          </scroll-view>

          <view v-if="mallLoading" class="pick-grid">
            <view v-for="i in 2" :key="i" class="pick-card">
              <view class="sk pick-sk-cover" />
              <view class="pick-info">
                <view class="sk pick-sk-line" />
                <view class="sk pick-sk-line pick-sk-line--short" />
                <view class="sk pick-sk-price" />
              </view>
            </view>
          </view>

          <view v-else-if="mallError" class="pick-state">
            <view class="pick-state-mark mono">!</view>
            <text class="pick-state-title">精选目录暂未加载</text>
            <text class="pick-state-sub">{{ mallError }}</text>
            <view class="pick-retry" hover-class="is-press" @tap="loadMall">
              <text class="pick-retry-text mono">重试</text>
            </view>
          </view>

          <view v-else-if="products.length === 0" class="pick-state">
            <view class="pick-state-mark">空</view>
            <text class="pick-state-title">暂时没有可展示的商品</text>
            <text class="pick-state-sub">目录数据同步中，可前往商城浏览完整五金目录。</text>
          </view>

          <view v-else class="pick-grid">
            <view
              v-for="product in products"
              :key="product.id"
              class="pick-card"
              hover-class="is-press"
              @tap="openDetail(product)"
            >
              <view class="pick-cover">
                <image
                  v-if="coverOf(product) && !isBroken(product.id)"
                  class="pick-cover-img"
                  :src="coverOf(product)"
                  mode="aspectFill"
                  lazy-load
                  @error="markBroken(product.id)"
                />
                <view v-else class="pick-cover-ph">
                  <text class="pick-cover-char">{{ product.title.slice(0, 1) }}</text>
                </view>
                <text v-if="product.brand" class="pick-cover-tag mono">{{ product.brand }}</text>
                <view
                  v-if="isInquiryProduct(product)"
                  class="pick-add pick-add--inquiry"
                  hover-class="is-press"
                  @tap.stop="addToCart(product)"
                >
                  <text class="pick-add-text mono">询</text>
                </view>
                <view
                  v-else-if="!isOutOfStock(product)"
                  class="pick-add"
                  hover-class="is-press"
                  @tap.stop="addToCart(product)"
                >
                  <text class="pick-add-text mono">+</text>
                </view>
              </view>
              <view class="pick-info">
                <text class="pick-name">{{ product.title }}</text>
                <text v-if="cardMeta(product)" class="pick-sub">{{ cardMeta(product) }}</text>
                <text v-if="cardSpec(product)" class="pick-spec mono">{{ cardSpec(product) }}</text>
                <text v-if="packLabel(product)" class="pick-pack mono">{{ packLabel(product) }}</text>
                <view class="pick-foot">
                  <view v-if="isInquiryProduct(product)" class="pick-price">
                    <text class="pick-inquiry">询价</text>
                    <text class="pick-inquiry-sub">联系报价</text>
                  </view>
                  <view v-else class="pick-price">
                    <text class="pick-cur mono">¥</text>
                    <text class="pick-amount mono">{{ priceText(product.priceFen) }}</text>
                    <text v-if="priceUnitLabel(product)" class="pick-unit mono">{{ priceUnitLabel(product) }}</text>
                  </view>
                </view>
              </view>
            </view>
          </view>

          <view class="pick-more" hover-class="is-press" @tap="go(ROUTES.mall)">
            <text class="pick-more-text">进入商城浏览完整目录</text>
            <text class="pick-more-arrow mono">→</text>
          </view>
        </view>

        <view class="section">
          <view class="sec-head">
            <view class="sec-head-l">
              <text class="eyebrow">ENTRIES</text>
              <text class="sec-title">通行入口</text>
            </view>
            <text class="sec-count mono">目录 · {{ entries.length }} 类</text>
          </view>
          <view class="rule" />
          <view class="index-list">
            <view
              v-for="entry in entries"
              :key="entry.key"
              class="index-row"
              hover-class="is-press"
              @tap="go(entry.url)"
            >
              <text class="index-code mono">{{ entry.key }}</text>
              <view class="index-main">
                <text class="index-title">{{ entry.title }}</text>
                <text class="index-desc">{{ entry.desc }}</text>
              </view>
              <text class="index-tag mono">{{ entry.tag }}</text>
              <text class="index-arrow mono">→</text>
            </view>
          </view>
        </view>

        <view class="section">
          <view class="sec-head">
            <view class="sec-head-l">
              <text class="eyebrow">COVERAGE</text>
              <text class="sec-title">已接通的端</text>
            </view>
            <text class="sec-count mono">终端 · {{ platforms.length }} 端</text>
          </view>
          <view class="rule" />
          <view class="index-list">
            <view v-for="p in platforms" :key="p.code" class="index-row">
              <text class="index-code mono">{{ p.short }}</text>
              <view class="index-main">
                <text class="index-title">{{ p.name }}</text>
                <text class="index-desc mono">{{ p.code }}</text>
              </view>
              <view class="index-dot" />
            </view>
          </view>
          <text class="section-note">同一套 Vue3 代码，按平台产出不同产物；账号、发号器与权限完全共用。</text>
        </view>

        <view class="footer">
          <view class="foot-rule" />
          <text class="foot-line mono">BUILD · TEST · SHIP · OPS</text>
          <text class="foot-line foot-line--dim mono">{{ releaseLabel }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app';
import { metaApi, mallApi, mediaUrl, ApiError } from '../../api/client';
import { session } from '../../stores/session';
import { APP_VERSION } from '../../version';
import { ROUTES } from '../../routes';
import { goTo } from '../../navigation';
import MxLogo from '../../components/mx-logo/mx-logo.vue';
import type { MallCategoryDto, MallProductDto } from '../../api/mall';
import {
  breadcrumbLabel,
  INQUIRY_NOTICE,
  isInquiryProduct,
  isOutOfStock,
  OUT_OF_STOCK_NOTICE,
  packLabel,
  priceText,
  priceUnitLabel,
  specEntries,
} from '../../api/mall';

/** 版本文案由构建期生成的 APP_VERSION 驱动，标注正式发布，不写死版本号。 */
const releaseLabel = computed(() => `MIXMAPP · ${APP_VERSION} · 正式发布`);

const version = ref(APP_VERSION);
const env = ref('unknown');
const online = ref(false);
const error = ref('');

const platforms = [
  { code: 'WEB', short: 'WEB', name: 'H5 / PWA' },
  { code: 'ANDROID', short: 'AN', name: 'Android' },
  { code: 'IOS', short: 'iOS', name: 'iOS' },
  { code: 'HARMONY', short: 'HM', name: '鸿蒙' },
  { code: 'WECHAT', short: 'WX', name: '微信小程序' },
  { code: 'APP-PLUS', short: 'AP', name: 'App-Plus' },
];

const entries = [
  { key: '01', tag: 'MALL', title: '商城', desc: '商品 · 购物车 · 订单', url: ROUTES.mall },
  { key: '02', tag: 'PASS', title: '星际联邦通行证', desc: '登录 · 注册 · 公民编号', url: ROUTES.me },
  { key: '04', tag: 'RESEARCH', title: '深度研究', desc: 'AI 多轮检索 · 结构化报告', url: ROUTES.research },
  { key: '03', tag: 'INFO', title: '关于', desc: '能力矩阵与版本', url: ROUTES.about },
];

const signedIn = computed(() => Boolean(session.user));
const primaryUrl = computed(() => ROUTES.me);

/* ---------- 精选目录：真实商城数据（mallApi 契约，不加 mock） ---------- */
const PAGE_SIZE = 6;

const categories = ref<MallCategoryDto[]>([]);
const activeCategory = ref('');
const products = ref<MallProductDto[]>([]);
const mallLoading = ref(false);
const mallError = ref('');
/** 图片 404 兜底：记录加载失败的 productId，命中后改用文字占位，避免破图。 */
const brokenImages = reactive(new Set<string>());

/**
 * 分类完全由后端 `/mall/categories` 驱动（catalog 侧只返回 6 个真实一级类目）。
 * 不再用硬编码分类黑名单，仅过滤空 code / 空 name 的脏数据，避免无名 tab。
 */
const tabCategories = computed(() =>
  categories.value
    .filter((item) => item && item.code && item.name)
    .map((item) => ({ code: item.code, name: item.name, count: item.count ?? 0 })),
);

async function loadCategories(): Promise<void> {
  try {
    const list = await mallApi.listCategories();
    categories.value = Array.isArray(list) ? list : [];
  } catch {
    categories.value = [];
  }
}

async function loadProducts(): Promise<void> {
  mallLoading.value = true;
  mallError.value = '';
  try {
    const list = await mallApi.listProducts({
      category: activeCategory.value || undefined,
      page: 1,
      pageSize: PAGE_SIZE,
    });
    products.value = Array.isArray(list) ? list : [];
  } catch (e) {
    mallError.value = e instanceof Error ? e.message : '商品加载失败';
    products.value = [];
  } finally {
    mallLoading.value = false;
  }
}

function loadMall(): Promise<unknown> {
  return Promise.allSettled([loadCategories(), loadProducts()]);
}

function switchCategory(code: string): void {
  activeCategory.value = code;
  void loadProducts();
}

function coverOf(product: MallProductDto): string {
  const first = Array.isArray(product.images) ? product.images[0] : undefined;
  return mediaUrl(first);
}

function isBroken(id: string): boolean {
  return brokenImages.has(id);
}

function markBroken(id: string): void {
  brokenImages.add(id);
}

/** 卡片副行：优先分类面包屑，退回 subtitle。 */
function cardMeta(product: MallProductDto): string {
  return breadcrumbLabel(product.categoryPath) || product.subtitle || '';
}

/** 规格摘要：取前两条有效规格，拼成一行短文案。 */
function cardSpec(product: MallProductDto): string {
  return specEntries(product.specs)
    .slice(0, 2)
    .map(([key, value]) => `${key} ${value}`)
    .join(' · ');
}

function openDetail(product: MallProductDto): void {
  goTo(`${ROUTES.mallDetail}?id=${encodeURIComponent(product.id)}`);
}

async function addToCart(product: MallProductDto): Promise<void> {
  if (isInquiryProduct(product)) {
    uni.showToast({ title: INQUIRY_NOTICE, icon: 'none' });
    return;
  }
  if (isOutOfStock(product)) {
    uni.showToast({ title: OUT_OF_STOCK_NOTICE, icon: 'none' });
    return;
  }
  try {
    await mallApi.addToCart(product.id, 1);
    uni.showToast({ title: '已加入购物车', icon: 'success' });
  } catch (e) {
    const message = e instanceof Error ? e.message : '加入购物车失败';
    if (message.includes('登录')) {
      goTo(ROUTES.login);
      return;
    }
    uni.showToast({ title: message, icon: 'none' });
  }
}

function go(url: string): void {
  goTo(url);
}

async function loadMeta(): Promise<void> {
  error.value = '';
  try {
    const meta = await metaApi.get();
    // 版本以构建期 APP_VERSION（正式发布）为准，不被服务端 meta.version 覆盖成旧版串。
    env.value = meta.env;
    online.value = true;
  } catch (e) {
    online.value = false;
    error.value = e instanceof ApiError ? `${e.message}（${e.status}）` : '无法连接 API';
  }
}

onLoad(() => {
  void loadMeta();
  void loadMall();
});

/** 原生下拉刷新：同时刷新运行环境与精选目录，两者都落定后收起指示器 */
onPullDownRefresh(() => {
  void Promise.allSettled([loadMeta(), loadMall()]).then(() => uni.stopPullDownRefresh());
});
</script>

<style scoped lang="scss">
.halo {
  min-height: 100vh;
  background: $paper;
}

.home {
  /* tabBar 页面：为原生底部标签栏留安全距离，避免页脚被遮挡 */
  padding-bottom: calc(140rpx + env(safe-area-inset-bottom));
}

/* ---------- 档案封面（深场） ---------- */
.hero {
  position: relative;
  overflow: hidden;
  padding: calc(56rpx + var(--status-bar-height, 0px)) $sp-4 $sp-5;
  background:
    radial-gradient(90% 120% at 6% 0%, rgba(15, 157, 143, 0.34), rgba(15, 157, 143, 0) 56%),
    radial-gradient(70% 90% at 100% 8%, rgba(100, 228, 255, 0.1), rgba(100, 228, 255, 0) 60%),
    linear-gradient(162deg, #0b0f0e 0%, #11201d 52%, #17322c 100%);
  border-bottom: 1rpx solid $on-deep-line;
}

.hero-inner {
  position: relative;
  z-index: 2;
}

.hero-eyebrow {
  display: block;
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  text-transform: uppercase;
  color: $on-deep-2;
}

.hero-title-wrap {
  margin-top: $sp-3;
}

.hero-title {
  display: block;
  font-family: $font-display;
  font-size: $fs-display;
  font-weight: 800;
  line-height: $lh-tight;
  letter-spacing: $ls-tight;
  color: $on-deep;
}

.hero-title--accent {
  color: $brand-on-deep;
}

.hero-lede {
  display: block;
  margin-top: $sp-3;
  padding-right: $sp-5;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $on-deep-2;
}

.hero-logo {
  margin-top: $sp-5;
}

.hero-meta {
  display: flex;
  align-items: stretch;
  margin-top: $sp-5;
  padding-top: $sp-4;
  border-top: 1rpx solid $on-deep-line;
}

.meta-item {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.meta-sep {
  width: 1rpx;
  margin: 0 $sp-2;
  background: $on-deep-line;
}

.meta-k {
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $on-deep-3;
}

.meta-v {
  margin-top: 10rpx;
  font-size: $fs-meta;
  letter-spacing: 1rpx;
  color: $on-deep-2;
}

.meta-status {
  display: flex;
  align-items: center;
  margin-top: 10rpx;
}

.status-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  margin-right: 12rpx;
  background: $brand-on-deep;
}

.status-dot--off {
  background: $amber-on-deep;
}

.hero-error {
  display: flex;
  align-items: flex-start;
  margin-top: $sp-4;
  padding: $sp-3;
  border: 1rpx solid $on-deep-line;
  border-radius: $r-control;
  background: rgba(11, 18, 16, 0.56);
}

.hero-error-mark {
  width: 44rpx;
  height: 44rpx;
  flex-shrink: 0;
  border: 1rpx solid $on-deep-line;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  color: $amber-on-deep;
}

.hero-error-main {
  flex: 1;
  min-width: 0;
  margin-left: $sp-3;
}

.hero-error-title {
  display: block;
  font-size: $fs-meta;
  font-weight: 800;
  color: $on-deep;
}

.hero-error-text {
  display: block;
  margin-top: 8rpx;
  font-size: $fs-micro;
  line-height: $lh-body;
  color: $on-deep-2;
  word-break: break-all;
}

.hero-retry {
  flex-shrink: 0;
  height: 64rpx;
  margin-left: $sp-3;
  padding: 0 $sp-3;
  border: 1rpx solid $on-deep-line;
  border-radius: $r-control;
  display: flex;
  align-items: center;
}

.hero-retry-text {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $on-deep-2;
}

/* ---------- 正文：索引条目 ---------- */
.body {
  padding: $sp-6 $sp-3 0;
}

.cta {
  padding: $sp-4;
  border-radius: $r-control;
  background: $paper-2;
}

.cta-kicker {
  display: block;
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  text-transform: uppercase;
  color: $brand-deep;
}

.cta-main {
  display: flex;
  align-items: center;
  margin-top: 12rpx;
}

.cta-text {
  flex: 1;
  min-width: 0;
}

.cta-title {
  display: block;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  line-height: $lh-snug;
  letter-spacing: $ls-tight;
  color: $ink;
}

.cta-sub {
  display: block;
  margin-top: 8rpx;
  font-size: $fs-meta;
  color: $ink-3;
}

.cta-arrow {
  flex-shrink: 0;
  margin-left: $sp-3;
  font-size: 30rpx;
  color: $ink-4;
}

.section {
  margin-top: $sp-6;
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

.index-row {
  display: flex;
  align-items: center;
  padding: $sp-3 0;
  border-bottom: 1rpx solid $paper-2;
}

.index-row:last-child {
  border-bottom: none;
}

.index-code {
  width: 64rpx;
  flex-shrink: 0;
  font-size: $fs-meta;
  letter-spacing: 1rpx;
  color: $ink-4;
}

.index-main {
  flex: 1;
  min-width: 0;
  margin-left: $sp-2;
}

.index-title {
  display: block;
  font-size: $fs-body;
  font-weight: 600;
  line-height: 1.4;
  color: $ink;
}

.index-desc {
  display: block;
  margin-top: 4rpx;
  font-size: $fs-micro;
  line-height: 1.5;
  color: $ink-3;
}

.index-tag {
  flex-shrink: 0;
  margin-left: $sp-3;
  padding: 4rpx 12rpx;
  border-radius: $r-control;
  background: $brand-soft;
  font-size: $fs-micro;
  letter-spacing: 1.5rpx;
  color: $brand-deep;
}

.index-arrow {
  flex-shrink: 0;
  margin-left: 14rpx;
  font-size: $fs-meta;
  color: $ink-4;
}

.index-dot {
  flex-shrink: 0;
  margin-left: $sp-3;
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: $brand;
}

.section-note {
  display: block;
  margin-top: $sp-3;
  padding: 0 8rpx;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-3;
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

.foot-line--dim {
  margin-top: 10rpx;
  opacity: 0.72;
}

/* ---------- 精选目录 ---------- */
.pick-chips {
  margin-top: $sp-3;
  white-space: nowrap;
}

.pick-chip {
  display: inline-flex;
  align-items: center;
  height: 60rpx;
  padding: 0 22rpx;
  margin-right: 14rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  background: $shell;
}

.pick-chip--active {
  background: $brand-soft;
  border-color: transparent;
}

.pick-chip-label {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-3;
}

.pick-chip--active .pick-chip-label {
  color: $brand-deep;
  font-weight: 600;
}

.pick-chip-count {
  margin-left: 8rpx;
  font-size: $fs-micro;
  color: $ink-4;
}

.pick-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  margin-top: $sp-3;
}

.pick-card {
  width: 48.6%;
  margin-bottom: $sp-3;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-card;
  overflow: hidden;
}

.pick-cover {
  position: relative;
  width: 100%;
  height: 240rpx;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $paper-2;
  border-bottom: 1rpx solid $paper-3;
}

.pick-cover-img {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
}

.pick-cover-ph {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pick-cover-char {
  font-family: $font-display;
  font-size: 84rpx;
  font-weight: 800;
  color: $ink-4;
}

.pick-cover-tag {
  position: absolute;
  left: 16rpx;
  top: 16rpx;
  z-index: 2;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-3;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: 6rpx;
  padding: 4rpx 10rpx;
}

.pick-add {
  position: absolute;
  right: 14rpx;
  bottom: 14rpx;
  z-index: 3;
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: $shell;
  border: 1rpx solid $paper-3;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pick-add--inquiry {
  background: $brand-soft;
}

.pick-add-text {
  font-size: 32rpx;
  line-height: 1;
  color: $ink;
}

.pick-info {
  padding: $sp-3;
  display: flex;
  flex-direction: column;
  min-height: 196rpx;
}

.pick-name {
  font-family: $font-display;
  font-size: 28rpx;
  font-weight: 800;
  line-height: 1.4;
  color: $ink;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.pick-sub,
.pick-spec,
.pick-pack {
  display: block;
  margin-top: 6rpx;
  font-size: $fs-micro;
  color: $ink-3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pick-spec,
.pick-pack {
  margin-top: 4rpx;
  color: $ink-4;
}

.pick-foot {
  margin-top: auto;
  padding-top: $sp-2;
}

.pick-price {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
}

.pick-cur {
  font-size: 24rpx;
  color: $ink-2;
  margin-right: 2rpx;
}

.pick-amount {
  font-family: $font-mono;
  font-size: 38rpx;
  font-weight: 800;
  color: $ink;
}

.pick-unit {
  margin-left: 6rpx;
  font-size: $fs-micro;
  color: $ink-3;
}

.pick-inquiry {
  font-size: 34rpx;
  font-weight: 800;
  color: $brand-deep;
}

.pick-inquiry-sub {
  margin-left: 10rpx;
  font-size: $fs-micro;
  color: $ink-3;
}

.pick-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: $sp-6 0 $sp-4;
}

.pick-state-mark {
  width: 72rpx;
  height: 72rpx;
  border: 1rpx solid $paper-3;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  color: $ink-4;
}

.pick-state-title {
  margin-top: $sp-3;
  font-size: $fs-body;
  font-weight: 700;
  color: $ink;
}

.pick-state-sub {
  margin-top: 8rpx;
  font-size: $fs-meta;
  color: $ink-3;
  text-align: center;
  line-height: $lh-body;
}

.pick-retry {
  margin-top: $sp-3;
  height: 64rpx;
  padding: 0 $sp-4;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  display: flex;
  align-items: center;
}

.pick-retry-text {
  font-size: $fs-micro;
  color: $ink-2;
}

.pick-sk-cover {
  height: 240rpx;
  border-radius: 0;
}

.pick-sk-line {
  height: 26rpx;
  margin-top: 14rpx;
  width: 82%;
}

.pick-sk-line--short {
  width: 54%;
}

.pick-sk-price {
  height: 30rpx;
  margin-top: 18rpx;
  width: 40%;
}

.pick-more {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: $sp-2;
  padding: $sp-3 4rpx;
  border-top: 1rpx solid $paper-2;
}

.pick-more-text {
  font-size: $fs-meta;
  color: $brand-deep;
  font-weight: 600;
}

.pick-more-arrow {
  font-size: $fs-meta;
  color: $ink-4;
}

/* ---------- 窄屏：收紧展示大标，保证 375px 不挤 ---------- */
@media (max-width: 390px) {
  .hero-title {
    font-size: 84rpx;
  }

  .body {
    padding-left: 22rpx;
    padding-right: 22rpx;
  }
}

/* ---------- 平板 / 折叠屏展开态：左目录 + 右索引双栏 ---------- */
@media (min-width: 1000px) {
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    column-gap: $sp-6;
    align-items: start;
  }

  /* 左栏：快捷入口 + 精选目录；右栏：能力入口 + 覆盖范围 */
  .body > :nth-of-type(n + 3) {
    grid-column: 2;
  }

  .body > .footer {
    grid-column: 1 / -1;
  }

  .pick-card {
    width: 48.6%;
  }
}
</style>
