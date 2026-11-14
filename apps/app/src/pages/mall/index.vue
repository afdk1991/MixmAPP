<template>
  <view class="page page--wide">
    <mx-bar />
    <view class="head">
      <view class="head-top">
        <view class="head-title">
          <text class="eyebrow">MIXMAPP STORE</text>
          <text class="title">商城</text>
          <text class="count mono">目录 · {{ products.length }} 件</text>
        </view>
        <view class="cart-btn" hover-class="is-press" @tap="goCart">
          <text class="cart-text">购物车</text>
          <text class="cart-arrow mono">→</text>
        </view>
      </view>
      <view class="rule head-rule" />

      <view class="search">
        <view class="search-mark">
          <view class="search-lens" />
          <view class="search-handle" />
        </view>
        <input
          :value="keyword"
          class="search-input"
          placeholder="搜商品，如 螺丝 / 丝锥 / M6"
          placeholder-class="field-ph"
          confirm-type="search"
          @input="onKeywordInput"
          @confirm="onSearch"
        />
        <view class="search-go" hover-class="is-press" @tap="onSearch">
          <text class="search-go-text">搜索</text>
        </view>
      </view>

      <!-- 分类三层下钻：一级 → 二级 → 三级，逐层由 `/mall/categories?parent=` 驱动 -->
      <scroll-view :scroll-x="true" class="chips" :show-scrollbar="false">
        <view
          v-for="item in levelOneTabs"
          :key="item.id || 'all'"
          class="chip"
          :class="{ 'chip--active': l1 === item.id }"
          @tap="selectLevel1(item.id)"
        >
          <text class="chip-label">{{ item.name }}</text>
          <text v-if="item.count > 0" class="chip-count mono">{{ item.count }}</text>
        </view>
      </scroll-view>

      <scroll-view
        v-if="levelTwoTabs.length > 1"
        :scroll-x="true"
        class="chips chips--sub"
        :show-scrollbar="false"
      >
        <view
          v-for="item in levelTwoTabs"
          :key="item.id || 'all2'"
          class="chip chip--sub"
          :class="{ 'chip--active': l2 === item.id }"
          @tap="selectLevel2(item.id)"
        >
          <text class="chip-label">{{ item.name }}</text>
          <text v-if="item.count > 0" class="chip-count mono">{{ item.count }}</text>
        </view>
      </scroll-view>

      <scroll-view
        v-if="levelThreeTabs.length > 1"
        :scroll-x="true"
        class="chips chips--sub"
        :show-scrollbar="false"
      >
        <view
          v-for="item in levelThreeTabs"
          :key="item.id || 'all3'"
          class="chip chip--sub"
          :class="{ 'chip--active': l3 === item.id }"
          @tap="selectLevel3(item.id)"
        >
          <text class="chip-label">{{ item.name }}</text>
          <text v-if="item.count > 0" class="chip-count mono">{{ item.count }}</text>
        </view>
      </scroll-view>

      <!-- 三级类目下才有规格筛选；选项来自源站 ccc_filter 真实取值，无选项不渲染 -->
      <view v-if="dimsOptions.length" class="spec-group">
        <text class="spec-label mono">直径</text>
        <scroll-view :scroll-x="true" class="chips chips--spec" :show-scrollbar="false">
          <view class="chip chip--spec" :class="{ 'chip--active': !dims }" @tap="selectDims('')">
            <text class="chip-label">不限</text>
          </view>
          <view
            v-for="opt in dimsOptions"
            :key="`d-${opt}`"
            class="chip chip--spec"
            :class="{ 'chip--active': dims === opt }"
            @tap="selectDims(opt)"
          >
            <text class="chip-label mono">{{ opt }}</text>
          </view>
        </scroll-view>
      </view>

      <view v-if="lensOptions.length" class="spec-group">
        <text class="spec-label mono">长度</text>
        <scroll-view :scroll-x="true" class="chips chips--spec" :show-scrollbar="false">
          <view class="chip chip--spec" :class="{ 'chip--active': !lens }" @tap="selectLens('')">
            <text class="chip-label">不限</text>
          </view>
          <view
            v-for="opt in lensOptions"
            :key="`l-${opt}`"
            class="chip chip--spec"
            :class="{ 'chip--active': lens === opt }"
            @tap="selectLens(opt)"
          >
            <text class="chip-label mono">{{ opt }}</text>
          </view>
        </scroll-view>
      </view>
    </view>

    <view v-if="loading" class="grid wrap">
      <view v-for="i in 4" :key="i" class="card">
        <view class="sk cover-sk" />
        <view class="p-info">
          <view class="sk sk-line" />
          <view class="sk sk-line sk-line--short" />
          <view class="sk sk-price" />
        </view>
      </view>
    </view>

    <view v-else-if="error" class="empty">
      <view class="empty-mark mono">!</view>
      <text class="empty-title">没能取到商品</text>
      <text class="empty-sub">{{ error }}</text>
      <view class="btn btn--deep btn--sm retry" hover-class="is-press" @tap="refresh">重新加载</view>
    </view>

    <view v-else-if="products.length === 0" class="empty">
      <view class="empty-mark">空</view>
      <text class="empty-title">{{ keyword.trim() ? '没有找到相关商品' : '这个分类还没有商品' }}</text>
      <text class="empty-sub">
        {{ keyword.trim() ? '换个关键词，或浏览其他分类看看。' : '换个分类看看，或稍后再来。' }}
      </text>
    </view>

    <view v-else>
      <view class="list-head">
        <text class="micro mono">{{ products.length }} ITEMS</text>
        <text class="micro mono">按上架顺序</text>
      </view>
      <view class="grid wrap">
        <view
          v-for="product in products"
          :key="product.id"
          class="card"
          hover-class="is-press"
          @tap="openDetail(product)"
        >
          <view class="cover">
            <image
              v-if="coverOf(product) && !isBroken(product.id)"
              class="cover-img"
              :src="coverOf(product)"
              mode="aspectFill"
              lazy-load
              @error="markBroken(product.id)"
            />
            <view v-else class="cover-placeholder">
              <view class="cover-ring" />
              <text class="cover-char">{{ product.title.slice(0, 1) }}</text>
            </view>
            <text v-if="product.brand" class="cover-tag mono">{{ product.brand }}</text>
            <view
              v-if="isInquiryProduct(product)"
              class="cover-add cover-add--inquiry"
              hover-class="is-press"
              @tap.stop="addToCart(product)"
            >
              <text class="cover-add-text mono">询</text>
            </view>
            <view
              v-else-if="!isOutOfStock(product)"
              class="cover-add"
              hover-class="is-press"
              @tap.stop="addToCart(product)"
            >
              <text class="cover-add-text mono">+</text>
            </view>
          </view>
          <view class="p-info">
            <text class="p-name">{{ product.title }}</text>
            <text v-if="cardMeta(product)" class="p-sub">{{ cardMeta(product) }}</text>
            <text v-if="cardSpec(product)" class="p-spec mono">{{ cardSpec(product) }}</text>
            <view class="p-foot">
              <view v-if="isInquiryProduct(product)" class="p-price p-price--inquiry">
                <text class="p-inquiry">询价</text>
                <text class="p-inquiry-sub">联系报价</text>
              </view>
              <view v-else class="p-price">
                <text class="p-cur mono">¥</text>
                <text class="p-amount mono">{{ priceText(product.priceFen) }}</text>
                <text v-if="priceUnitLabel(product)" class="p-unit mono">{{ priceUnitLabel(product) }}</text>
                <text v-if="product.originalPriceFen > 0" class="p-old mono">¥{{ priceText(product.originalPriceFen) }}</text>
              </view>
              <view class="p-meta">
                <text v-if="packLabel(product)" class="p-pack mono">{{ packLabel(product) }}</text>
                <view v-if="isInquiryProduct(product)" class="status-chip status-chip--inquiry">
                  <text class="status-chip-text mono">询价待报</text>
                </view>
                <view v-else-if="isOutOfStock(product)" class="status-chip status-chip--oos">
                  <text class="status-chip-text mono">缺货</text>
                </view>
                <view v-else class="status-chip status-chip--stock">
                  <text class="status-chip-text mono">{{ isBulkStock(product.stock) ? '在售' : `在售 · 余 ${product.stock}` }}</text>
                </view>
              </view>
            </view>
          </view>
        </view>
      </view>

      <view class="list-foot">
        <text v-if="loadingMore" class="mono foot-note">加载中…</text>
        <text v-else-if="noMore" class="mono foot-note">没有更多商品了</text>
        <text v-else class="mono foot-note">上拉加载更多 · 价格以服务端实时数据为准</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onLoad, onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app';
import type { MallCategoryNodeDto, MallProductDto } from '../../api/mall';
import {
  breadcrumbLabel,
  INQUIRY_NOTICE,
  isBulkStock,
  isInquiryProduct,
  isOutOfStock,
  OUT_OF_STOCK_NOTICE,
  packLabel,
  priceText,
  priceUnitLabel,
  specEntries,
} from '../../api/mall';
import { mallApi, mediaUrl } from '../../api/client';
import { ROUTES } from '../../routes';
import { goTo } from '../../navigation';

const PAGE_SIZE = 20;

/**
 * 分类三层下钻状态：l1/l2/l3 存分类树节点 id（c1:002 / c2:002:007 / c3:007）。
 * 上级切换时清空下级选择，避免残留的深层节点把结果收敛到空集。
 */
const l1 = ref('');
const l2 = ref('');
const l3 = ref('');
const l1Nodes = ref<MallCategoryNodeDto[]>([]);
const l2Nodes = ref<MallCategoryNodeDto[]>([]);
const l3Nodes = ref<MallCategoryNodeDto[]>([]);
/** 规格筛选：只在三级类目下出现，取值来自 `/mall/specs?c3=` 的真实选项。 */
const dims = ref('');
const lens = ref('');
const dimsOptions = ref<string[]>([]);
const lensOptions = ref<string[]>([]);

const keyword = ref('');
const products = ref<MallProductDto[]>([]);
const page = ref(1);
const loading = ref(false);
const loadingMore = ref(false);
const noMore = ref(false);
const error = ref('');

/** 图片 404 兜底：记录加载失败的 productId，命中后改用文字占位，避免破图。 */
const brokenImages = reactive(new Set<string>());
/** 搜索防抖计时器，避免逐字触发网关请求。 */
let searchTimer: ReturnType<typeof setTimeout> | null = null;
/** 深链带入的旧分类参数，待一级树加载后匹配。 */
let pendingCategory = '';

type TreeNode = { id: string; code: string; name: string; count: number };

/** 每层都带「全部」占位；接口已过滤空分类，不用再额外筛。 */
function withAll(nodes: MallCategoryNodeDto[]): TreeNode[] {
  return [
    { id: '', code: '', name: '全部', count: 0 },
    ...nodes
      .filter((n) => n && n.id && n.name)
      .map((n) => ({ id: n.id, code: n.code, name: n.name, count: n.count ?? 0 })),
  ];
}

const levelOneTabs = computed(() => withAll(l1Nodes.value));
const levelTwoTabs = computed(() => (l1.value ? withAll(l2Nodes.value) : []));
const levelThreeTabs = computed(() => (l2.value ? withAll(l3Nodes.value) : []));

/** 收敛到当前选中的最深节点；三级 > 二级 > 一级。 */
const activeCat = computed(() => l3.value || l2.value || l1.value || '');

async function loadLevelOne(): Promise<void> {
  try {
    const list = await mallApi.listCategoryChildren();
    l1Nodes.value = Array.isArray(list) ? list : [];
  } catch {
    l1Nodes.value = [];
  }
  // 深链 ?category= 兼容：既接受节点 id（c1:002）也接受旧短码（002 / eg-screw）
  if (pendingCategory) {
    const hit = l1Nodes.value.find((n) => n.id === pendingCategory || n.code === pendingCategory);
    pendingCategory = '';
    if (hit) void selectLevel1(hit.id);
  }
}

async function loadChildren(parent: string, level: 2 | 3): Promise<void> {
  try {
    const list = await mallApi.listCategoryChildren(parent);
    const rows = Array.isArray(list) ? list : [];
    if (level === 2) l2Nodes.value = rows;
    else l3Nodes.value = rows;
  } catch {
    if (level === 2) l2Nodes.value = [];
    else l3Nodes.value = [];
  }
}

async function loadSpecs(c3: string): Promise<void> {
  dims.value = '';
  lens.value = '';
  dimsOptions.value = [];
  lensOptions.value = [];
  if (!c3) return;
  try {
    const opts = await mallApi.listSpecOptions(c3);
    dimsOptions.value = Array.isArray(opts?.dims) ? opts.dims : [];
    lensOptions.value = Array.isArray(opts?.lens) ? opts.lens : [];
  } catch {
    dimsOptions.value = [];
    lensOptions.value = [];
  }
}

async function selectLevel1(id: string): Promise<void> {
  if (l1.value === id) return;
  l1.value = id;
  l2.value = '';
  l3.value = '';
  l2Nodes.value = [];
  l3Nodes.value = [];
  await loadSpecs('');
  if (id) void loadChildren(id, 2);
  refresh();
}

async function selectLevel2(id: string): Promise<void> {
  if (l2.value === id) return;
  l2.value = id;
  l3.value = '';
  l3Nodes.value = [];
  await loadSpecs('');
  if (id) void loadChildren(id, 3);
  refresh();
}

async function selectLevel3(id: string): Promise<void> {
  if (l3.value === id) return;
  l3.value = id;
  await loadSpecs(id);
  refresh();
}

function selectDims(value: string): void {
  if (dims.value === value) return;
  dims.value = value;
  refresh();
}

function selectLens(value: string): void {
  if (lens.value === value) return;
  lens.value = value;
  refresh();
}

async function fetchPage(reset: boolean): Promise<void> {
  if (reset) {
    page.value = 1;
    noMore.value = false;
    loading.value = true;
    error.value = '';
  } else {
    if (loadingMore.value || loading.value || noMore.value) return;
    loadingMore.value = true;
  }
  try {
    const list = await mallApi.listProducts({
      cat: activeCat.value || undefined,
      dims: dims.value || undefined,
      lens: lens.value || undefined,
      keyword: keyword.value.trim() || undefined,
      page: page.value,
      pageSize: PAGE_SIZE,
    });
    // 接口异常或网关返回非 JSON 时保持空数组，避免模板读取 length 时报错白屏
    const rows = Array.isArray(list) ? list : [];
    products.value = reset ? rows : [...products.value, ...rows];
    if (rows.length < PAGE_SIZE) noMore.value = true;
    else page.value += 1;
  } catch (e) {
    if (reset) {
      error.value = e instanceof Error ? e.message : '商品加载失败';
    } else {
      uni.showToast({ title: '下一页加载失败，请重试', icon: 'none' });
    }
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

function refresh(): void {
  void fetchPage(true);
}

/** 输入即检索（350ms 防抖），键盘「搜索」/按钮立即检索并取消在途防抖。 */
function inputValue(e: unknown): string {
  const event = e as { detail?: { value?: string }; target?: { value?: string } };
  return event?.detail?.value ?? event?.target?.value ?? '';
}

function scheduleSearch(): void {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTimer = null;
    refresh();
  }, 350);
}

function onKeywordInput(e: unknown): void {
  keyword.value = inputValue(e);
  scheduleSearch();
}

function onSearch(): void {
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  refresh();
}

function loadMore(): void {
  void fetchPage(false);
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

function goCart(): void {
  goTo(ROUTES.cart);
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

// 深链进入时可通过 ?keyword=&category= 预填检索条件；onShow 随后按当前 ref 拉首屏。
onLoad((options) => {
  const q = (options?.['keyword'] as string | undefined) ?? '';
  const c = (options?.['category'] as string | undefined) ?? '';
  keyword.value = q.trim();
  pendingCategory = c.trim();
});

onShow(() => {
  void loadLevelOne();
  refresh();
});

onReachBottom(() => {
  loadMore();
});

/** 原生下拉刷新：分类与第一页商品同时重取，两者都落定后收起指示器 */
onPullDownRefresh(() => {
  void Promise.allSettled([loadLevelOne(), fetchPage(true)]).then(() =>
    uni.stopPullDownRefresh(),
  );
});
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  /* tabBar 页面：为原生底部标签栏留安全距离，避免列表底部被遮挡 */
  padding: 0 $sp-3 calc(140rpx + env(safe-area-inset-bottom));
}

/* ---------- 页头：eyebrow + 大标 + 等宽计数 + 发丝线 ---------- */
.head {
  padding: $sp-5 0 $sp-3;
}

.head-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.head-title {
  flex: 1;
  min-width: 0;
}

.title {
  display: block;
  margin-top: 16rpx;
  font-family: $font-display;
  font-size: $fs-h1;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: $lh-tight;
  color: $ink;
}

.count {
  display: block;
  margin-top: 10rpx;
  font-size: $fs-meta;
  letter-spacing: $ls-label;
  color: $ink-3;
}

.head-rule {
  margin-top: $sp-3;
}

.cart-btn {
  margin-top: 20rpx;
  display: flex;
  align-items: center;
  height: 88rpx;
  padding: 0 22rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  background: $shell;
  flex-shrink: 0;
}

.cart-text {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-2;
}

.cart-arrow {
  margin-left: 8rpx;
  font-size: $fs-micro;
  color: $ink-4;
}

.search {
  display: flex;
  align-items: center;
  margin-top: $sp-4;
  height: 96rpx;
  padding: 0 8rpx 0 26rpx;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
}

.search-mark {
  position: relative;
  width: 36rpx;
  height: 36rpx;
  margin-right: 12rpx;
  flex-shrink: 0;
}

.search-lens {
  position: absolute;
  left: 0;
  top: 0;
  width: 24rpx;
  height: 24rpx;
  border: 2rpx solid $ink-4;
  border-radius: 50%;
}

.search-handle {
  position: absolute;
  right: 0;
  bottom: 2rpx;
  width: 16rpx;
  height: 2rpx;
  background: $ink-4;
  transform: rotate(45deg);
}

.search-input {
  flex: 1;
  height: 96rpx;
  font-size: $fs-meta;
  color: $ink;
}

.search-go {
  height: 72rpx;
  padding: 0 28rpx;
  border-radius: $r-control;
  background: $solid;
  display: flex;
  align-items: center;
  justify-content: center;
}

.search-go-text {
  font-size: $fs-meta;
  letter-spacing: 1rpx;
  color: $on-solid;
}

/* ---------- 分类 chip：分类用 control 圆角 ---------- */
.chips {
  margin-top: $sp-4;
  white-space: nowrap;
}

/* 二/三级与规格行收紧间距，保持深色主题变量不变 */
.chips--sub {
  margin-top: $sp-2;
}

.chips--spec {
  margin-top: 0;
  flex: 1;
  min-width: 0;
}

.chip {
  display: inline-flex;
  align-items: center;
  height: 64rpx;
  padding: 0 24rpx;
  margin-right: 16rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  background: $shell;
}

.chip--sub {
  height: 56rpx;
  padding: 0 20rpx;
  margin-right: 12rpx;
}

.chip--spec {
  height: 52rpx;
  padding: 0 18rpx;
  margin-right: 10rpx;
}

.spec-group {
  display: flex;
  align-items: center;
  margin-top: $sp-2;
}

.spec-label {
  flex: 0 0 auto;
  width: 68rpx;
  font-size: $fs-micro;
  color: $ink-4;
}

.chip--active {
  background: $brand-soft;
  border-color: transparent;
}

.chip-label {
  font-family: $font-mono;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-3;
}

.chip--active .chip-label {
  color: $brand-deep;
  font-weight: 600;
}

.chip-count {
  margin-left: 8rpx;
  font-size: $fs-micro;
  color: $ink-4;
}

/* ---------- 目录索引卡 ---------- */
.list-head {
  display: flex;
  justify-content: space-between;
  padding: $sp-2 0 $sp-3;
}

.wrap {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
}

.card {
  width: 48.6%;
  margin-bottom: $sp-4;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-card;
  overflow: hidden;
  transition: transform 0.16s ease;
}

/* ---------- 平板 / 折叠屏展开态：商品网格三栏 ---------- */
@media (min-width: 1000px) {
  .card {
    width: 32%;
  }
}

.cover {
  position: relative;
  width: 100%;
  height: 300rpx;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $paper-2;
  border-bottom: 1rpx solid $paper-3;
}

.cover-img {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
}

.cover-placeholder {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.cover-ring {
  position: absolute;
  width: 210rpx;
  height: 210rpx;
  border-radius: 50%;
  border: 1rpx solid $paper-3;
  top: 46rpx;
  left: 50%;
  margin-left: -105rpx;
}

.cover-tag {
  position: absolute;
  left: 20rpx;
  top: 20rpx;
  z-index: 2;
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  text-transform: uppercase;
  color: $ink-3;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: 6rpx;
  padding: 4rpx 10rpx;
}

.cover-char {
  position: relative;
  z-index: 2;
  font-family: $font-display;
  font-size: 84rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: 1;
  color: $ink;
}

.cover-add {
  position: absolute;
  right: 16rpx;
  bottom: 16rpx;
  z-index: 3;
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  background: $shell;
  border: 1rpx solid $paper-3;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-add--inquiry {
  background: $brand-soft;
}

.cover-add-text {
  font-size: 36rpx;
  line-height: 1;
  color: $ink;
}

.p-info {
  padding: $sp-3;
  display: flex;
  flex-direction: column;
  min-height: 176rpx;
}

.p-name {
  font-family: $font-display;
  font-size: 30rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: 1.4;
  color: $ink;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.p-sub,
.p-spec {
  display: block;
  margin-top: 6rpx;
  font-size: $fs-micro;
  color: $ink-3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.p-spec {
  margin-top: 4rpx;
  color: $ink-4;
}

.p-foot {
  display: block;
  margin-top: auto;
  padding-top: $sp-2;
}

.p-price {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
}

.p-cur {
  font-size: 26rpx;
  color: $ink-2;
  margin-right: 2rpx;
}

.p-amount {
  font-family: $font-mono;
  font-size: 40rpx;
  font-weight: 800;
  color: $ink;
}

.p-unit {
  margin-left: 6rpx;
  font-size: $fs-micro;
  color: $ink-3;
}

.p-old {
  margin-left: 8rpx;
  font-size: $fs-micro;
  color: $ink-4;
  text-decoration: line-through;
}

.p-price--inquiry {
  align-items: baseline;
}

.p-inquiry {
  font-size: 36rpx;
  font-weight: 800;
  color: $brand-deep;
}

.p-inquiry-sub {
  margin-left: 10rpx;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-3;
}

.p-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  margin-top: $sp-1;
}

.p-pack {
  font-size: $fs-micro;
  color: $ink-3;
  margin-right: 12rpx;
}

/* 状态 chip：仅状态用 pill 圆角 */
.status-chip {
  display: inline-flex;
  align-items: center;
  height: 40rpx;
  padding: 0 16rpx;
  border-radius: $r-pill;
}

.status-chip--stock {
  background: $brand-soft;
}

.status-chip--stock .status-chip-text {
  color: $brand-deep;
}

.status-chip--oos {
  background: $paper-2;
}

.status-chip--oos .status-chip-text {
  color: $amber;
}

.status-chip--inquiry {
  background: $paper-2;
}

.status-chip--inquiry .status-chip-text {
  color: $ink-2;
}

.status-chip-text {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
}

/* ---------- 骨架 ---------- */
.cover-sk {
  height: 300rpx;
  border-radius: 0;
}

.sk-line {
  height: 28rpx;
  margin-top: 14rpx;
  width: 82%;
}

.sk-line--short {
  width: 54%;
}

.sk-price {
  height: 32rpx;
  margin-top: 20rpx;
  width: 40%;
}

.list-foot {
  padding: $sp-3 0 $sp-6;
  text-align: center;
}

.foot-note {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-4;
}

.retry {
  margin-top: $sp-4;
  padding: 0 40rpx;
}
</style>
