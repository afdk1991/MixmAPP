<template>
  <view class="page page--wide">
    <mx-bar />
    <view v-if="loading" class="loading">
      <view class="sk hero-sk" />
      <view class="loading-body">
        <view class="sk line-xl" />
        <view class="sk line" />
        <view class="sk line short" />
      </view>
    </view>

    <view v-else-if="error" class="empty">
      <view class="empty-mark mono">!</view>
      <text class="empty-title">商品没打开</text>
      <text class="empty-sub">{{ error }}</text>
      <view class="btn btn--deep btn--sm retry" hover-class="is-press" @tap="load">重新加载</view>
    </view>

    <block v-else-if="product">
      <view class="hero">
        <image
          v-if="mainImage && !isBroken(mainImage)"
          class="hero-img"
          :src="mediaUrl(mainImage)"
          mode="aspectFill"
          @error="markBroken(mainImage)"
        />
        <template v-else>
          <view class="hero-scrim" />
          <view class="hero-ring" />
          <view class="hero-ring hero-ring--sm" />
          <text class="hero-char">{{ product.title.slice(0, 1) }}</text>
        </template>
        <text v-if="product.brand" class="hero-tag mono">{{ product.brand }}</text>
        <text class="hero-serial mono">NO. {{ product.id.slice(0, 8).toUpperCase() }}</text>
      </view>

      <view v-if="images.length > 1" class="thumbs">
        <view
          v-for="(img, idx) in images"
          :key="idx"
          class="thumb"
          :class="{ 'thumb--active': mainImage === img }"
          hover-class="is-press"
          @tap="activeImage = img"
        >
          <image
            v-if="!isBroken(img)"
            class="thumb-img"
            :src="mediaUrl(img)"
            mode="aspectFill"
            @error="markBroken(img)"
          />
          <view v-else class="thumb-ph"><text class="thumb-ph-char mono">—</text></view>
        </view>
      </view>

      <view class="body">
        <text class="eyebrow">CATALOG</text>
        <view v-if="crumbs" class="crumbs mono">{{ crumbs }}</view>
        <text class="title">{{ product.title }}</text>
        <view class="subtitle">{{ product.subtitle }}</view>

        <view class="price-row">
          <view v-if="inquiry" class="price-main">
            <text class="amount amount--inquiry">询价</text>
            <text class="price-note">联系报价</text>
          </view>
          <view v-else class="price-main">
            <text class="cur mono">¥</text>
            <text class="amount mono">{{ unitPrice }}</text>
            <text v-if="priceUnitLabel(product)" class="price-unit mono">{{ priceUnitLabel(product) }}</text>
            <text v-if="discountLabel" class="price-off mono">{{ discountLabel }}</text>
            <text v-if="product.originalPriceFen > 0" class="price-old mono">¥{{ priceText(product.originalPriceFen) }}</text>
          </view>
          <view v-if="!inquiry" class="amount-col">
            <text class="amount-label mono">金额</text>
            <text class="amount-value mono">¥{{ totalText }}</text>
          </view>
        </view>
        <view v-if="product.packagingDesc" class="pkg-line mono">{{ product.packagingDesc }}</view>

        <view class="rule section-rule" />

        <!-- 购买方式 / 需求包装数 / 需求支数 -->
        <view class="section">
          <view class="sec-head">
            <text class="sec-label mono">ORDER</text>
            <text class="section-title">购买方式</text>
          </view>

          <view v-if="unitOptions.length > 1" class="unit-row">
            <text class="unit-title">购买方式</text>
            <view class="unit-tabs">
              <view
                v-for="u in unitOptions"
                :key="u.code"
                class="unit-tab"
                :class="{ 'unit-tab--active': selectedUnit === u.code }"
                hover-class="is-press"
                @tap="selectUnit(u.code)"
              >
                <text class="unit-tab-text">{{ u.name }}</text>
              </view>
            </view>
          </view>

          <view v-if="purchasable" class="qty-head">
            <text class="qty-title">需求包装数</text>
            <view class="stepper">
              <view class="step" hover-class="is-press" @tap="dec">
                <text class="step-text mono">−</text>
              </view>
              <text class="count mono">{{ quantity }}</text>
              <view class="step" hover-class="is-press" @tap="inc">
                <text class="step-text mono">+</text>
              </view>
            </view>
          </view>

          <view v-if="purchasable" class="qty-sum">
            <text class="qty-sum-label">需求支数</text>
            <text class="qty-sum-value mono">{{ totalPieces }} {{ product.unit || '支' }}</text>
          </view>

          <view class="delivery-row">
            <text v-if="inquiry" class="delivery-state delivery-state--inquiry mono">询价 · 联系报价</text>
            <text v-else-if="outOfStock" class="delivery-state delivery-state--oos mono">缺货 · 请联系询价</text>
            <text v-else class="delivery-state delivery-state--stock mono">{{ stockLineText }}</text>
          </view>
          <text v-if="purchasable && purchaseHint" class="hint">{{ purchaseHint }}</text>
        </view>

        <view class="rule section-rule" />

        <!-- 商品规格 / 商品详图 / 商品详情：有内容才出 tab -->
        <view v-if="tabs.length" class="section">
          <view class="tab-bar">
            <view
              v-for="t in tabs"
              :key="t.key"
              class="tab"
              :class="{ 'tab--active': activeTab === t.key }"
              hover-class="is-press"
              @tap="activeTab = t.key"
            >
              <text class="tab-text">{{ t.label }}</text>
            </view>
          </view>

          <view v-if="activeTab === 'spec'" class="tab-body">
            <view class="specs">
              <view v-for="[key, value] in specRows" :key="key" class="spec-row">
                <text class="spec-key">{{ key }}</text>
                <text class="spec-value">{{ value }}</text>
              </view>
            </view>
            <view v-if="product.tags.length" class="tags">
              <text v-for="tag in product.tags" :key="tag" class="tag">{{ tag }}</text>
            </view>
          </view>

          <view v-else-if="activeTab === 'pic'" class="tab-body">
            <image
              v-if="product.specImage && !isBroken(product.specImage)"
              class="spec-img"
              :src="mediaUrl(product.specImage)"
              mode="widthFix"
              @error="markBroken(product.specImage)"
            />
          </view>

          <view v-else class="tab-body">
            <text v-if="product.description" class="desc">{{ product.description }}</text>
            <view v-for="(promo, idx) in promotions" :key="idx" class="promo">
              <text class="promo-text">{{ promo.text }}</text>
              <text v-if="promo.validTo" class="promo-valid mono">有效期至 {{ promo.validTo }}</text>
            </view>
          </view>
        </view>

        <view v-if="tabs.length" class="rule section-rule" />

        <!-- 来源底稿（附录） -->
        <view v-if="product.sourceUrl" class="section source">
          <view class="sec-head">
            <text class="sec-label mono">SOURCE</text>
            <text class="section-title">来源底稿</text>
          </view>
          <text class="source-url">{{ product.sourceUrl }}</text>
          <view class="source-actions">
            <text class="source-copy mono" hover-class="is-press" @tap="copySource">复制链接</text>
          </view>
          <text v-if="capturedAt" class="source-meta mono">价格抓取时间：{{ capturedAt }}</text>
          <text class="source-disclaimer">内部选品底稿，价格以来源为准，非对外报价。</text>
        </view>

        <!-- 返回由 mx-bar 提供；分享为跨端复制兜底 -->
        <view class="share-row">
          <view class="share-btn" hover-class="is-press" @tap="shareProduct">
            <text class="share-btn-text">分享商品信息</text>
            <text class="share-btn-arrow mono">↗</text>
          </view>
        </view>

        <view class="note">
          <text class="micro mono">MIXMAPP · 目录选品 · 报价以对接确认为准</text>
        </view>
      </view>

      <view v-if="purchasable" class="bar">
        <view class="bar-total">
          <text class="bar-label mono">合计</text>
          <text class="bar-price mono">¥{{ totalText }}</text>
        </view>
        <view class="bar-btn bar-btn--ghost" hover-class="is-press" @tap="addToCart">
          <text class="bar-btn-text bar-btn-text--ghost">加入购物车</text>
        </view>
        <view class="bar-btn bar-btn--primary" hover-class="is-press" @tap="buyNow">
          <text class="bar-btn-text">立即购买</text>
        </view>
      </view>

      <view v-else-if="outOfStock" class="bar bar--inquiry">
        <view class="bar-total">
          <text class="bar-label mono">库存状态</text>
          <text class="bar-state mono">缺货</text>
        </view>
        <view class="bar-btn bar-btn--ghost" hover-class="is-press" @tap="showOutOfStock">
          <text class="bar-btn-text bar-btn-text--ghost">询价确认</text>
        </view>
      </view>

      <view v-else class="bar bar--inquiry">
        <view class="bar-btn bar-btn--primary bar-btn--block" hover-class="is-press" @tap="showInquiry">
          <text class="bar-btn-text">询价 / 联系报价</text>
        </view>
      </view>
    </block>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import type { MallProductDto } from '../../api/mall';
import {
  breadcrumbLabel,
  formatCapturedAt,
  INQUIRY_NOTICE,
  isBulkStock,
  isInquiryProduct,
  isOutOfStock,
  lineTotalFen,
  OUT_OF_STOCK_NOTICE,
  priceText,
  priceUnitLabel,
  specEntries,
  unitPriceText,
} from '../../api/mall';
import { mallApi, mediaUrl } from '../../api/client';
import { ROUTES } from '../../routes';
import { goTo } from '../../navigation';

const product = ref<MallProductDto | null>(null);
const productId = ref('');
/** 需求包装数（默认 1，步长/上限以商品字段为准） */
const quantity = ref(1);
const loading = ref(false);
const error = ref('');
const activeImage = ref('');
/** 当前选中的购买方式（源站单位代码，如 BX/CA/EA） */
const selectedUnit = ref('');
const activeTab = ref<'spec' | 'pic' | 'desc'>('spec');
/** 图片 404 兜底：按原始 src 记录加载失败的地址，命中后回退占位。 */
const brokenImages = reactive(new Set<string>());

const inquiry = computed(() => (product.value ? isInquiryProduct(product.value) : false));
const outOfStock = computed(() =>
  product.value ? !inquiry.value && isOutOfStock(product.value) : false,
);
const purchasable = computed(() =>
  product.value ? !inquiry.value && !outOfStock.value : false,
);
/** 现货文案：库存超过阈值只显示「现货」，避免暴露大额占位数字。 */
const stockLineText = computed(() => {
  const stock = product.value?.stock;
  return isBulkStock(stock) ? '现货' : `现货 · 余 ${stock ?? 0}`;
});
const images = computed(() =>
  product.value && Array.isArray(product.value.images) ? product.value.images : [],
);
const mainImage = computed(() => activeImage.value || images.value[0] || '');
const specs = computed(() => (product.value ? specEntries(product.value.specs) : []));
const crumbs = computed(() => (product.value ? breadcrumbLabel(product.value.categoryPath) : ''));
const capturedAt = computed(() => (product.value ? formatCapturedAt(product.value.priceCapturedAt) : ''));

/** 购买方式：源站 units 原样，箱（CA）优先展示，与源站默认口径一致。 */
const unitOptions = computed(() => {
  const list = product.value && Array.isArray(product.value.unitOptions) ? product.value.unitOptions : [];
  return [...list].sort((a, b) => (a.code === 'CA' ? -1 : b.code === 'CA' ? 1 : 0));
});

/** 当前单位每 1 包装含多少支（EA=1，盒/箱按 convs）。 */
const piecesPerPack = computed(() => {
  const conv = product.value?.unitConversions;
  if (!conv || !selectedUnit.value) return 1;
  const n = conv[selectedUnit.value];
  return n && n > 0 ? n : 1;
});

/** 需求支数 = 包装数 × 每包装支数 */
const totalPieces = computed(() => quantity.value * piecesPerPack.value);

/** 面价（元/支），优先用厘/支精确值；旧数据回落 priceFen。 */
const unitPrice = computed(() => {
  const p = product.value;
  if (!p) return '0.00';
  if (p.priceLi != null) return unitPriceText(p.priceLi);
  return priceText(p.priceFen);
});

/** 金额 = 单价 × 需求支数（服务端同一公式，四舍五入到分）。 */
const totalText = computed(() =>
  product.value ? priceText(lineTotalFen(product.value, totalPieces.value)) : '0.00',
);

const discountLabel = computed(() => {
  const pct = product.value?.discountPct;
  return pct != null && pct < 100 ? `${pct}% 折扣` : '';
});

const promotions = computed(() =>
  product.value && Array.isArray(product.value.promotions) ? product.value.promotions : [],
);

/** 规格 tab 内容：类目属性在前（品牌/等级/材质/标准/牙别/表面处理…），结构化规格在后，同名去重。 */
const specRows = computed<Array<[string, string]>>(() => {
  const rows: Array<[string, string]> = [];
  const seen = new Set<string>();
  const attrs = product.value?.attributes ?? {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!value) continue;
    rows.push([key, value]);
    seen.add(key);
  }
  for (const [key, value] of specs.value) {
    if (seen.has(key)) continue;
    rows.push([key, value]);
  }
  return rows;
});

/** 三个 tab 有内容才出，避免空壳；默认落在第一个有内容的 tab。 */
const tabs = computed<Array<{ key: 'spec' | 'pic' | 'desc'; label: string }>>(() => {
  const list: Array<{ key: 'spec' | 'pic' | 'desc'; label: string }> = [];
  if (specRows.value.length) list.push({ key: 'spec', label: '商品规格' });
  if (product.value?.specImage) list.push({ key: 'pic', label: '商品详图' });
  if (product.value?.description?.trim() || promotions.value.length) {
    list.push({ key: 'desc', label: '商品详情' });
  }
  return list;
});

/** 包装数上限：不超过商品上限，也不超过库存能覆盖的整包装数。 */
const maxPackQty = computed(() => {
  const p = product.value;
  if (!p) return 1;
  const byStock = Math.floor((p.stock || 0) / piecesPerPack.value);
  // maxOrderQty 是「支」的上限，与包装数比较前必须先折算成包装数
  const byProduct = Math.floor((p.maxOrderQty ?? 1000000) / piecesPerPack.value);
  return Math.max(1, Math.min(byProduct, byStock || byProduct));
});

const purchaseHint = computed(() => {
  const p = product.value;
  if (!p) return '';
  const parts: string[] = [];
  if (p.packagingDesc) parts.push(p.packagingDesc);
  if (selectedUnit.value && piecesPerPack.value > 1) {
    const name = unitOptions.value.find((u) => u.code === selectedUnit.value)?.name ?? '包装';
    parts.push(`1${name} = ${piecesPerPack.value}${p.unit || '支'}`);
  }
  parts.push(`步长 ${p.qtyStep ?? 1}，单笔上限 ${maxPackQty.value} 包装`);
  return parts.join(' · ');
});

function selectUnit(code: string): void {
  selectedUnit.value = code;
  quantity.value = product.value?.minOrderQty ?? 1;
}

async function load(): Promise<void> {
  if (!productId.value) return;
  loading.value = true;
  error.value = '';
  try {
    const res = await mallApi.getProduct(productId.value);
    // 离线/网关兜底会返回空值，缺 tags 时补空数组，避免模板读 tags.length 白屏
    product.value =
      res && typeof res === 'object'
        ? { ...res, tags: Array.isArray(res.tags) ? res.tags : [] }
        : null;
    activeImage.value = '';
    quantity.value = product.value?.minOrderQty ?? 1;
    // 默认购买方式：箱（CA）优先，其次源站 units 第一个
    selectedUnit.value = unitOptions.value[0]?.code ?? '';
    activeTab.value = 'spec';
    if (!tabs.value.some((t) => t.key === activeTab.value)) {
      activeTab.value = tabs.value[0]?.key ?? 'spec';
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '商品加载失败';
  } finally {
    loading.value = false;
  }
}

function inc(): void {
  if (!product.value) return;
  const next = quantity.value + (product.value.qtyStep ?? 1);
  if (next > maxPackQty.value) {
    uni.showToast({ title: '已达可购上限', icon: 'none' });
    return;
  }
  quantity.value = next;
}

function dec(): void {
  const min = product.value?.minOrderQty ?? 1;
  quantity.value = Math.max(min, quantity.value - (product.value?.qtyStep ?? 1));
}

function showInquiry(): void {
  uni.showModal({
    title: '询价商品',
    content: INQUIRY_NOTICE,
    showCancel: false,
    confirmText: '知道了',
  });
}

function showOutOfStock(): void {
  uni.showModal({
    title: '暂时缺货',
    content: OUT_OF_STOCK_NOTICE,
    showCancel: false,
    confirmText: '知道了',
  });
}

function copySource(): void {
  const url = product.value?.sourceUrl;
  if (!url) return;
  uni.setClipboardData({
    data: url,
    success: () => uni.showToast({ title: '来源链接已复制', icon: 'none' }),
  });
}

/**
 * 跨端分享兜底：uni.share 在 H5 / App / 小程序各端 provider 不一致，
 * 统一复制「商品名 + 来源链接」到剪贴板，用户可粘贴到任意渠道分享。
 */
function shareProduct(): void {
  const p = product.value;
  if (!p) return;
  const text = p.sourceUrl ? `${p.title} — ${p.sourceUrl}` : p.title;
  uni.setClipboardData({
    data: text,
    success: () => uni.showToast({ title: '商品信息已复制，可粘贴分享', icon: 'none' }),
  });
}

function isBroken(src: string): boolean {
  return brokenImages.has(src);
}

function markBroken(src: string): void {
  brokenImages.add(src);
}

async function addToCart(): Promise<void> {
  if (!product.value) return;
  if (isInquiryProduct(product.value)) {
    uni.showToast({ title: INQUIRY_NOTICE, icon: 'none' });
    return;
  }
  if (isOutOfStock(product.value)) {
    uni.showToast({ title: OUT_OF_STOCK_NOTICE, icon: 'none' });
    return;
  }
  try {
    await mallApi.addToCart(productId.value, totalPieces.value, selectedUnit.value || undefined, quantity.value);
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

async function buyNow(): Promise<void> {
  if (!product.value) return;
  if (isInquiryProduct(product.value)) {
    uni.showToast({ title: INQUIRY_NOTICE, icon: 'none' });
    return;
  }
  if (isOutOfStock(product.value)) {
    uni.showToast({ title: OUT_OF_STOCK_NOTICE, icon: 'none' });
    return;
  }
  try {
    await mallApi.addToCart(productId.value, totalPieces.value, selectedUnit.value || undefined, quantity.value);
    goTo(ROUTES.cart);
  } catch (e) {
    const message = e instanceof Error ? e.message : '操作失败';
    if (message.includes('登录')) {
      goTo(ROUTES.login);
      return;
    }
    uni.showToast({ title: message, icon: 'none' });
  }
}

onLoad((options) => {
  productId.value = (options?.['id'] as string | undefined) ?? '';
  void load();
});
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  padding-bottom: calc(240rpx + env(safe-area-inset-bottom));
}

/* ---------- 主视觉 ---------- */
.hero {
  position: relative;
  height: 440rpx;
  background:
    radial-gradient(120% 120% at 18% 0%, rgba(15, 157, 143, 0.3), rgba(15, 157, 143, 0) 58%),
    linear-gradient(160deg, #0b0f0e 0%, #152622 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.hero-img {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
}

.hero-scrim {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: linear-gradient(160deg, rgba(244, 244, 241, 0.02) 10%, rgba(244, 244, 241, 0.08) 100%);
}

.hero-ring {
  position: absolute;
  width: 400rpx;
  height: 400rpx;
  border: 1rpx solid rgba(244, 244, 241, 0.18);
  border-radius: 50%;
}

.hero-ring--sm {
  width: 280rpx;
  height: 280rpx;
  border-color: rgba(244, 244, 241, 0.1);
}

.hero-tag {
  position: absolute;
  left: $sp-4;
  top: $sp-4;
  z-index: 2;
  font-size: $fs-micro;
  letter-spacing: 3rpx;
  text-transform: uppercase;
  color: $on-deep-2;
  padding: 6rpx 14rpx;
  border: 1rpx solid $on-deep-line;
  border-radius: 8rpx;
  background: rgba(11, 15, 14, 0.32);
}

.hero-char {
  position: relative;
  z-index: 2;
  font-family: $font-display;
  font-size: 140rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: 1;
  color: $on-deep;
}

.hero-serial {
  position: absolute;
  right: $sp-4;
  bottom: 60rpx;
  z-index: 2;
  max-width: 60%;
  text-align: right;
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  line-height: 1.5;
  word-break: break-all;
  color: $on-deep-3;
}

/* ---------- 缩略图条 ---------- */
.thumbs {
  display: flex;
  gap: 16rpx;
  padding: $sp-3 $sp-4 0;
  overflow-x: auto;
}

.thumb {
  width: 120rpx;
  height: 120rpx;
  flex-shrink: 0;
  border-radius: $r-control;
  overflow: hidden;
  border: 1rpx solid $paper-3;
  background: $paper-2;
}

.thumb--active {
  border-color: $brand;
}

.thumb-img {
  width: 100%;
  height: 100%;
}

.thumb-ph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $paper-2;
}

.thumb-ph-char {
  font-size: 30rpx;
  color: $ink-4;
}

/* ---------- 正文层 ---------- */
.body {
  position: relative;
  z-index: 3;
  padding: $sp-5 $sp-4 0;
  background: $paper;
}

.crumbs {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  letter-spacing: 1rpx;
  line-height: 1.6;
  white-space: pre-line;
  word-break: break-all;
  color: $ink-4;
}

.title {
  display: block;
  margin-top: 14rpx;
  font-family: $font-display;
  font-size: 48rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: 1.28;
  color: $ink;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.subtitle {
  display: block;
  width: 100%;
  max-width: 100%;
  margin-top: 10rpx;
  font-size: 30rpx;
  line-height: 1.6;
  white-space: pre-line;
  word-break: break-all;
  overflow-wrap: anywhere;
  color: $ink-3;
}

.price-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-top: $sp-4;
  padding-bottom: $sp-3;
  border-bottom: 1rpx solid $paper-3;
}

.price-main {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
}

.cur {
  font-size: 26rpx;
  color: $ink-2;
  margin-right: 4rpx;
}

.amount {
  font-size: 56rpx;
  font-weight: 800;
  line-height: 1;
  color: $ink;
}

.amount--inquiry {
  color: $brand-deep;
}

.price-note {
  margin-left: 12rpx;
  font-size: 26rpx;
  color: $ink-3;
}

.price-unit {
  margin-left: 8rpx;
  font-size: 24rpx;
  color: $ink-3;
}

.price-old {
  margin-left: 14rpx;
  font-size: 26rpx;
  color: $ink-4;
  text-decoration: line-through;
}

.delivery-row {
  display: flex;
  align-items: center;
  margin-top: $sp-3;
}

.delivery-state {
  font-size: $fs-meta;
  letter-spacing: 1rpx;
  color: $ink-3;
}

.delivery-state--stock {
  color: $brand-deep;
}

.delivery-state--oos {
  color: $amber;
}

.delivery-state--inquiry {
  color: $ink-2;
}

.meta-line {
  display: flex;
  flex-wrap: wrap;
  margin-top: 14rpx;
}

.meta-item {
  margin-right: 24rpx;
  font-size: 26rpx;
  color: $ink-3;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  margin-top: $sp-3;
}

.tag {
  margin: 0 12rpx 12rpx 0;
}

.section {
  margin-top: $sp-5;
}

.sec-head {
  display: flex;
  flex-direction: column;
}

.sec-label {
  font-family: $font-mono;
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  color: $ink-4;
}

.section-title {
  display: block;
  margin-top: 8rpx;
  font-family: $font-display;
  font-size: $fs-h2;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
}

.section-rule {
  margin-top: $sp-5;
}

.specs {
  margin-top: 18rpx;
}

.spec-row {
  display: flex;
  padding: 18rpx 0;
  border-bottom: 1rpx solid $paper-3;
}

.spec-row:last-child {
  border-bottom: none;
}

.spec-key {
  width: 200rpx;
  flex-shrink: 0;
  font-size: 28rpx;
  color: $ink-3;
}

.spec-value {
  flex: 1;
  font-size: 28rpx;
  color: $ink;
  word-break: break-all;
}

.desc {
  display: block;
  margin-top: 14rpx;
  font-size: 30rpx;
  line-height: 1.8;
  white-space: pre-line;
  color: $ink-2;
}

.qty-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10rpx;
}

.qty-title {
  font-family: $font-display;
  font-size: $fs-h2;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
}

.hint {
  margin-top: 10rpx;
}

.stepper {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.step {
  width: 88rpx;
  height: 88rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  background: $paper-2;
  display: flex;
  align-items: center;
  justify-content: center;
}

.step-text {
  font-size: 34rpx;
  color: $ink;
}

.count {
  width: 84rpx;
  text-align: center;
  font-size: 34rpx;
  color: $ink;
}

/* ---------- 金额 / 折扣 ---------- */
.amount-col {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  margin-left: $sp-3;
}

.amount-label {
  font-size: 22rpx;
  letter-spacing: 0.12em;
  color: $ink-3;
}

.amount-value {
  font-size: 38rpx;
  font-weight: 800;
  color: $brand-deep;
}

.price-off {
  margin-left: 12rpx;
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
  background: rgba(15, 157, 143, 0.12);
  color: $brand-deep;
  font-size: 22rpx;
}

.pkg-line {
  margin-top: 10rpx;
  font-size: 24rpx;
  color: $ink-3;
}

/* ---------- 购买方式 / 需求支数 ---------- */
.unit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10rpx;
}

.unit-title {
  font-size: 28rpx;
  color: $ink-2;
}

.unit-tabs {
  display: flex;
}

.unit-tab {
  margin-left: 12rpx;
  padding: 10rpx 26rpx;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  background: $paper-2;
}

.unit-tab--active {
  border-color: $brand-deep;
  background: rgba(15, 157, 143, 0.1);
}

.unit-tab-text {
  font-size: 26rpx;
  color: $ink-2;
}

.unit-tab--active .unit-tab-text {
  color: $brand-deep;
  font-weight: 700;
}

.qty-sum {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12rpx;
}

.qty-sum-label {
  font-size: 28rpx;
  color: $ink-2;
}

.qty-sum-value {
  font-size: 30rpx;
  font-weight: 700;
  color: $ink;
}

/* ---------- 规格 / 详图 / 详情 tab ---------- */
.tab-bar {
  display: flex;
  border-bottom: 1rpx solid $paper-3;
}

.tab {
  padding: 16rpx 24rpx;
}

.tab--active {
  border-bottom: 4rpx solid $brand-deep;
}

.tab-text {
  font-size: 28rpx;
  color: $ink-3;
}

.tab--active .tab-text {
  color: $ink;
  font-weight: 700;
}

.tab-body {
  padding-top: $sp-3;
}

.spec-img {
  width: 100%;
  border-radius: $r-control;
}

.promo {
  margin-top: 12rpx;
  padding: 16rpx;
  background: rgba(15, 157, 143, 0.08);
  border-radius: $r-control;
}

.promo-text {
  font-size: 26rpx;
  color: $ink-2;
}

.promo-valid {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: $ink-3;
}

.source-url {
  display: block;
  margin-top: 14rpx;
  font-size: 24rpx;
  line-height: 1.5;
  color: $ink-3;
  word-break: break-all;
}

.source-actions {
  margin-top: 10rpx;
}

.source-copy {
  font-size: 24rpx;
  letter-spacing: 1rpx;
  color: $brand-deep;
}

.source-meta {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: $ink-4;
}

.source-disclaimer {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: $ink-4;
}

.share-row {
  margin-top: $sp-5;
}

.share-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 88rpx;
  padding: 0 $sp-3;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  background: $shell;
}

.share-btn-text {
  font-size: $fs-meta;
  color: $ink-2;
}

.share-btn-arrow {
  font-size: 32rpx;
  color: $brand-deep;
}

.note {
  margin: $sp-5 0 0;
  padding-top: $sp-4;
  border-top: 1rpx solid $paper-3;
  text-align: center;
}

/* ---------- 底部购买条 ---------- */
.bar-total {
  flex: 1;
}

.bar-label {
  display: block;
  font-size: 26rpx;
  letter-spacing: 2rpx;
  color: $ink-4;
}

.bar-state {
  display: block;
  margin-top: 2rpx;
  font-size: 34rpx;
  font-weight: 800;
  letter-spacing: 1rpx;
  color: $ink;
}

.bar-price {
  display: block;
  margin-top: 4rpx;
  font-size: 40rpx;
  font-weight: 800;
  line-height: 1.1;
  color: $ink;
}

.bar-btn {
  height: 88rpx;
  padding: 0 30rpx;
  border-radius: $r-control;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 14rpx;
}

.bar-btn--block {
  flex: 1;
  margin-left: 0;
}

.bar-btn--ghost {
  background: $shell;
  border: 1rpx solid $paper-3;
}

.bar-btn--primary {
  background: $solid;
  box-shadow: 0 12rpx 28rpx -16rpx rgba(13, 25, 23, 0.5);
}

.bar-btn-text {
  font-size: 30rpx;
  font-weight: 600;
  letter-spacing: 0.5rpx;
  color: $on-solid;
}

.bar-btn-text--ghost {
  color: $ink;
}

/* ---------- 骨架 / 空态 ---------- */
.loading {
  padding-bottom: 40rpx;
}

.hero-sk {
  height: 470rpx;
  border-radius: 0;
}

.loading-body {
  padding: $sp-5 $sp-4 0;
  background: $paper;
}

.line-xl {
  height: 56rpx;
  width: 70%;
  margin-bottom: 22rpx;
}

.line {
  height: 26rpx;
  width: 50%;
  margin-bottom: 16rpx;
}

.short {
  width: 32%;
}

.retry {
  margin-top: $sp-4;
  padding: 0 40rpx;
}

/* ---------- 平板 / 折叠屏展开态：左图右文双栏 ---------- */
@media (min-width: 1000px) {
  .page {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    column-gap: $sp-6;
    align-items: start;
  }

  .loading,
  .empty {
    grid-column: 1 / -1;
  }

  .hero {
    grid-column: 1;
    grid-row: 1;
    height: 760rpx;
  }

  .thumbs {
    grid-column: 1;
    grid-row: 2;
  }

  .body {
    grid-column: 2;
    grid-row: 1 / span 2;
  }
}
</style>
