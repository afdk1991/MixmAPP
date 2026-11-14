<template>
  <view class="page page--wide">
    <mx-bar />
    <view class="head">
      <text class="eyebrow">BAG</text>
      <text class="title">购物车</text>
      <text class="sub mono">
        {{ cart.items.length ? `${cart.totalQuantity} 件 · ${cart.items.length} 个商品` : 'EMPTY' }}
      </text>
    </view>

    <view v-if="loading" class="loading">
      <view v-for="i in 2" :key="i" class="line-sk">
        <view class="sk thumb-sk" />
        <view class="sk-col">
          <view class="sk line-w" />
          <view class="sk line-n" />
          <view class="sk line-s" />
        </view>
      </view>
    </view>

    <view v-else-if="error" class="empty">
      <view class="empty-mark mono">!</view>
      <text class="empty-title">购物车没打开</text>
      <text class="empty-sub">{{ error }}</text>
      <view class="btn btn--deep btn--sm retry" hover-class="is-press" @tap="load">重新加载</view>
    </view>

    <view v-else-if="cart.items.length === 0" class="empty">
      <view class="empty-mark">空</view>
      <text class="empty-title">购物车还是空的</text>
      <text class="empty-sub">去商城挑点喜欢的东西吧。</text>
      <view class="btn btn--deep empty-btn" hover-class="is-press" @tap="goMall">去逛逛</view>
    </view>

    <block v-else>
      <view class="list">
        <view v-for="line in cart.items" :key="line.productId" class="line">
          <view class="cover">
            <view class="cover-scrim" />
            <text class="cover-char">{{ line.title.slice(0, 1) }}</text>
          </view>
          <view class="info">
            <view class="name-row">
              <text class="name">{{ line.title }}</text>
              <view class="remove" hover-class="is-press" @tap="remove(line.productId)">
                <text class="remove-text mono">移除</text>
              </view>
            </view>
            <view class="unit-row">
              <text v-if="isInquiryLine(line)" class="unit unit--inquiry mono">询价 · 联系报价</text>
              <text v-else-if="isOutOfStockLine(line)" class="unit unit--oos mono">缺货 · 询价确认</text>
              <template v-else>
                <text class="unit mono">¥{{ lineUnitPrice(line) }} / {{ line.unitName || '件' }}</text>
                <text v-if="line.packLabel" class="stock mono">{{ line.packLabel }} · {{ line.quantity }}支</text>
                <text v-else class="stock mono">{{ isBulkStock(line.stock) ? '现货' : `库存 ${line.stock}` }}</text>
              </template>
            </view>
            <view class="line-foot">
              <view v-if="!isBlockedLine(line)" class="stepper">
                <view class="step" hover-class="is-press" @tap="changeQty(line.productId, line.quantity - stepOf(line))">
                  <text class="step-text mono">−</text>
                </view>
                <text class="count mono">{{ line.packQty ?? line.quantity }}</text>
                <view class="step" hover-class="is-press" @tap="changeQty(line.productId, line.quantity + stepOf(line))">
                  <text class="step-text mono">+</text>
                </view>
              </view>
              <text v-else-if="isInquiryLine(line)" class="inquiry-hint">需联系报价后下单</text>
              <text v-else class="inquiry-hint">缺货，请联系询价确认</text>
              <view class="subtotal">
                <text class="subtotal-k mono">小计</text>
                <text v-if="isInquiryLine(line)" class="subtotal-v subtotal-v--inquiry">询价</text>
                <text v-else-if="isOutOfStockLine(line)" class="subtotal-v subtotal-v--oos">缺货</text>
                <text v-else class="subtotal-v mono">¥{{ price(line.subtotalFen) }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <view v-if="hasBlocked" class="inquiry-banner">
        <text class="inquiry-banner-title">购物车中有 {{ blockedLines.length }} 件暂不可结算商品</text>
        <text class="inquiry-banner-sub">
          <text v-if="hasInquiry">{{ inquiryLines.length }} 件需联系报价；</text>
          <text v-if="hasOos">{{ oosLines.length }} 件缺货，需确认库存后再下单。</text>
          这些商品暂不参与结算。
        </text>
      </view>

      <view v-if="checkoutVisible" class="checkout">
        <text class="eyebrow">CHECKOUT</text>
        <text class="checkout-title">收货信息</text>
        <text class="hint">提交后库存即扣减，可在订单页查看进度。</text>

        <text class="label mt">收货人</text>
        <input v-model="form.receiverName" class="field" placeholder="收货人姓名" placeholder-class="field-ph" />
        <text class="label mt">手机号</text>
        <input
          v-model="form.receiverPhone"
          class="field"
          type="number"
          maxlength="11"
          placeholder="手机号"
          placeholder-class="field-ph"
        />
        <text class="label mt">详细地址</text>
        <textarea
          v-model="form.address"
          class="field field--area"
          placeholder="省市区 + 门牌号"
          placeholder-class="field-ph"
        />
        <text class="label mt">备注（选填）</text>
        <input v-model="form.remark" class="field" placeholder="备注" placeholder-class="field-ph" />

        <view class="form-actions">
          <view class="btn btn--ghost form-btn" hover-class="is-press" @tap="checkoutVisible = false">
            <text class="form-btn-text">取消</text>
          </view>
          <view
            class="btn btn--deep form-btn"
            :class="{ 'btn--disabled': submitting }"
            hover-class="is-press"
            @tap="submitOrder"
          >
            <text class="form-btn-text form-btn-text--deep">{{ submitting ? '提交中…' : '提交订单' }}</text>
          </view>
        </view>
      </view>

      <view class="bar">
        <view class="bar-total">
          <text class="bar-label mono">共 {{ cart.totalQuantity }} 件</text>
          <text v-if="hasBlocked" class="bar-price bar-price--muted">含不可结算 {{ blockedLines.length }} 件</text>
          <text v-else class="bar-price mono">¥{{ price(payableFen) }}</text>
        </view>
        <view
          class="bar-btn"
          :class="{ 'bar-btn--busy': submitting, 'bar-btn--disabled': hasBlocked }"
          hover-class="is-press"
          @tap="onBarAction"
        >
          <text class="bar-btn-text">{{ barLabel }}</text>
        </view>
      </view>
    </block>
  </view>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import type { CartDto, CartLineDto } from '@mixmapp/contracts';
import { isBulkStock, INQUIRY_NOTICE, isOutOfStock, OUT_OF_STOCK_NOTICE, unitPriceText } from '../../api/mall';
import { mallApi } from '../../api/client';
import { ROUTES } from '../../routes';
import { goTo } from '../../navigation';

/** 购物车行：后端后续可能回传 priceSource，旧数据按价格是否为 0 兜底判定。 */
type CartLine = CartLineDto & { priceSource?: 'anonymous' | 'login' | 'inquiry' };
type CartView = Omit<CartDto, 'items'> & { items: CartLine[] };

const cart = ref<CartView>({ items: [], totalQuantity: 0, totalFen: 0 });

/** 询价行：priceSource 为 inquiry，或价格缺失 / 0 元，一律不参与结算。 */
function isInquiryLine(line: CartLine): boolean {
  return line.priceSource === 'inquiry' || line.priceFen == null || line.priceFen === 0;
}

/** 缺货行：非询价但库存缺失 / 0，历史加购进来的缺货商品同样不能结算。 */
function isOutOfStockLine(line: CartLine): boolean {
  return !isInquiryLine(line) && isOutOfStock(line);
}

/** 被结算拦截的行：询价 + 缺货。 */
function isBlockedLine(line: CartLine): boolean {
  return isInquiryLine(line) || isOutOfStockLine(line);
}

/** 接口返回非 JSON（离线/网关兜底）时可能是 undefined，统一收敛成合法购物车，避免模板读 items 白屏。 */
function normalizeCart(input: unknown): CartView {
  const raw = (input ?? {}) as Partial<CartDto>;
  if (!Array.isArray(raw.items)) return { items: [], totalQuantity: 0, totalFen: 0 };
  return {
    items: raw.items as CartLine[],
    totalQuantity: raw.totalQuantity ?? 0,
    totalFen: raw.totalFen ?? 0,
  };
}
const loading = ref(false);
const error = ref('');
const checkoutVisible = ref(false);
const submitting = ref(false);
const form = ref({ receiverName: '', receiverPhone: '', address: '', remark: '' });

const inquiryLines = computed(() => cart.value.items.filter(isInquiryLine));
const oosLines = computed(() => cart.value.items.filter(isOutOfStockLine));
const blockedLines = computed(() => cart.value.items.filter(isBlockedLine));
const hasInquiry = computed(() => inquiryLines.value.length > 0);
const hasOos = computed(() => oosLines.value.length > 0);
const hasBlocked = computed(() => blockedLines.value.length > 0);
const payableFen = computed(() =>
  cart.value.items.reduce((sum, line) => sum + (isBlockedLine(line) ? 0 : line.subtotalFen), 0),
);

const barLabel = computed(() => {
  if (hasInquiry.value && hasOos.value) return '含询价 / 缺货商品，暂不能结算';
  if (hasInquiry.value) return '含询价商品，暂不能结算';
  if (hasOos.value) return '含缺货商品，暂不能结算';
  if (!checkoutVisible.value) return '去结算';
  return submitting.value ? '提交中…' : '提交订单';
});

function onBarAction(): void {
  if (hasBlocked.value) {
    uni.showToast({ title: hasOos.value ? OUT_OF_STOCK_NOTICE : INQUIRY_NOTICE, icon: 'none' });
    return;
  }
  if (checkoutVisible.value) {
    void submitOrder();
    return;
  }
  checkoutVisible.value = true;
  void nextTick(() => {
    uni.pageScrollTo({ selector: '.checkout', duration: 280, offsetTop: -72, fail: () => undefined });
  });
}

function price(fen: number): string {
  return (fen / 100).toFixed(2);
}

/** 单价展示：有厘/支精确价时按支展示（避免 8.5 分被四舍五入成 9 分），否则回落到分/件。 */
function lineUnitPrice(line: CartLine): string {
  if (line.priceLi != null && line.priceLi > 0) return unitPriceText(line.priceLi);
  return price(line.priceFen);
}

/** 步进粒度：按箱/盒加购的行，一次加减一个整包装（quantity / packQty），否则 1 支。 */
function stepOf(line: CartLine): number {
  if (line.packQty && line.packQty > 0 && line.quantity % line.packQty === 0) {
    return line.quantity / line.packQty;
  }
  return 1;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    cart.value = normalizeCart(await mallApi.getCart());
  } catch (e) {
    const message = e instanceof Error ? e.message : '购物车加载失败';
    if (message.includes('登录')) {
      uni.navigateTo({ url: ROUTES.login });
      return;
    }
    error.value = message;
  } finally {
    loading.value = false;
  }
}

async function changeQty(productId: string, quantity: number): Promise<void> {
  const line = cart.value.items.find((item) => item.productId === productId);
  if (line && isBlockedLine(line)) {
    uni.showToast({
      title: isOutOfStockLine(line) ? OUT_OF_STOCK_NOTICE : '询价商品不能调整数量',
      icon: 'none',
    });
    return;
  }
  if (quantity < 1) {
    await remove(productId);
    return;
  }
  try {
    const packQty = line?.packQty ? Math.max(1, Math.round(quantity / stepOf(line))) : undefined;
    cart.value = normalizeCart(
      await mallApi.updateCart(productId, quantity, line?.packUnit, packQty),
    );
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '修改数量失败', icon: 'none' });
  }
}

async function remove(productId: string): Promise<void> {
  try {
    cart.value = normalizeCart(await mallApi.removeCart(productId));
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '删除失败', icon: 'none' });
  }
}

async function submitOrder(): Promise<void> {
  if (hasBlocked.value) {
    uni.showToast({ title: hasOos.value ? OUT_OF_STOCK_NOTICE : INQUIRY_NOTICE, icon: 'none' });
    checkoutVisible.value = false;
    return;
  }
  const { receiverName, receiverPhone, address } = form.value;
  if (!receiverName.trim()) {
    uni.showToast({ title: '请填写收货人', icon: 'none' });
    return;
  }
  if (!/^1[3-9]\d{9}$/.test(receiverPhone.trim())) {
    uni.showToast({ title: '请填写正确的手机号', icon: 'none' });
    return;
  }
  if (address.trim().length < 4) {
    uni.showToast({ title: '请填写详细地址', icon: 'none' });
    return;
  }
  if (submitting.value) return;
  submitting.value = true;
  try {
    const order = await mallApi.createOrder({
      receiverName: receiverName.trim(),
      receiverPhone: receiverPhone.trim(),
      address: address.trim(),
      ...(form.value.remark.trim() ? { remark: form.value.remark.trim() } : {}),
    });
    checkoutVisible.value = false;
    cart.value = { items: [], totalQuantity: 0, totalFen: 0 };
    uni.showToast({ title: '下单成功', icon: 'success' });
    setTimeout(() => {
      uni.navigateTo({ url: `${ROUTES.orders}?orderNo=${encodeURIComponent(order.orderNo)}` });
    }, 600);
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '下单失败', icon: 'none' });
  } finally {
    submitting.value = false;
  }
}

function goMall(): void {
  goTo(ROUTES.mall);
}

onShow(() => {
  void load();
});
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  /* tabBar 页面：预留固定结算条 + 原生底部标签栏 + 安全区，内容不被遮挡 */
  padding: 0 $sp-3 calc(320rpx + env(safe-area-inset-bottom));
}

.head {
  padding: $sp-5 4rpx $sp-4;
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

.sub {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  letter-spacing: 2rpx;
  color: $ink-3;
}

.list {
  margin-bottom: $sp-4;
}

.line {
  display: flex;
  padding: $sp-3 0;
  border-bottom: 1rpx solid $paper-3;
}

.cover {
  position: relative;
  width: 148rpx;
  height: 148rpx;
  border-radius: $r-control;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: $paper-2;
  border: 1rpx solid $paper-3;
}

.cover-scrim {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: linear-gradient(150deg, rgba(17, 20, 19, 0.02), rgba(17, 20, 19, 0.08));
}

.cover-char {
  position: relative;
  z-index: 2;
  font-family: $font-display;
  font-size: 56rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
}

.info {
  flex: 1;
  margin-left: $sp-3;
  min-width: 0;
}

.name-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.name {
  flex: 1;
  padding-right: $sp-2;
  font-family: $font-display;
  font-size: 34rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: 1.35;
  color: $ink;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  white-space: normal;
}

.remove {
  height: 48rpx;
  padding: 0 4rpx;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.remove-text {
  font-size: 26rpx;
  letter-spacing: 1rpx;
  color: $ink-3;
}

.unit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8rpx;
}

.unit {
  font-size: 26rpx;
  color: $ink-3;
}

.unit--inquiry {
  color: $brand-deep;
  font-weight: 600;
}

.unit--oos {
  color: $amber;
  font-weight: 600;
}

.inquiry-hint {
  font-size: 24rpx;
  color: $ink-4;
}

.subtotal-v--inquiry {
  color: $brand-deep;
}

.subtotal-v--oos {
  color: $amber;
}

.inquiry-banner {
  margin: $sp-3 0;
  padding: $sp-3;
  background: $paper-2;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
}

.inquiry-banner-title {
  display: block;
  font-family: $font-display;
  font-size: 28rpx;
  font-weight: 800;
  color: $ink;
}

.inquiry-banner-sub {
  display: block;
  margin-top: 8rpx;
  font-size: 26rpx;
  line-height: 1.6;
  color: $ink-3;
}

.line-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-top: $sp-2;
}

.stepper {
  display: flex;
  align-items: center;
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
  font-size: 30rpx;
  color: $ink;
}

.count {
  width: 84rpx;
  text-align: center;
  font-size: 30rpx;
  color: $ink;
}

.subtotal {
  display: flex;
  align-items: baseline;
}

.subtotal-k {
  font-size: 26rpx;
  color: $ink-4;
  margin-right: 6rpx;
}

.subtotal-v {
  font-size: 30rpx;
  font-weight: 800;
  color: $ink;
}

.stock {
  font-size: 26rpx;
  color: $ink-4;
}

/* ---------- 结算表单 ---------- */
.checkout {
  padding: $sp-4 0 0;
  margin-bottom: $sp-4;
  border-top: 1rpx solid $paper-3;
  animation: rise 0.35s ease both;
}

.checkout-title {
  display: block;
  margin-top: 12rpx;
  font-family: $font-display;
  font-size: 40rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
}

.checkout .hint {
  margin-top: 8rpx;
}

.mt {
  margin-top: $sp-3;
}

.form-actions {
  display: flex;
  margin-top: $sp-4;
}

.form-btn {
  flex: 1;
  height: 88rpx;
}

.form-btn:first-child {
  margin-right: $sp-2;
}

.form-btn-text {
  font-size: 30rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: $ink;
}

.form-btn-text--deep {
  /* 压在 .btn--deep 的 $solid 底上：深色下底色变浅，文字切到 $on-solid */
  color: $on-solid;
}

/* ---------- 底栏 ---------- */
/* tabBar 页面：结算条抬到原生标签栏之上，避免被 tabBar 遮挡（全局 .bar 默认 bottom:0） */
.bar {
  bottom: calc(120rpx + env(safe-area-inset-bottom));
}

.bar-total {
  flex: 1;
}

.bar-label {
  display: block;
  font-size: 26rpx;
  letter-spacing: 1rpx;
  color: $ink-4;
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
  padding: 0 48rpx;
  border-radius: $r-control;
  background: $solid;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 12rpx 28rpx -16rpx rgba(13, 25, 23, 0.5);
}

.bar-btn--busy {
  opacity: 0.72;
}

.bar-btn--disabled {
  opacity: 0.5;
}

.bar-price--muted {
  font-size: 30rpx;
  color: $ink-4;
}

.bar-btn-text {
  font-size: 30rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: $on-solid;
}

/* ---------- 骨架 ---------- */
.line-sk {
  display: flex;
  padding: $sp-3 0;
  border-bottom: 1rpx solid $paper-3;
}

.thumb-sk {
  width: 148rpx;
  height: 148rpx;
  flex-shrink: 0;
}

.sk-col {
  flex: 1;
  margin-left: $sp-3;
  padding-top: 8rpx;
}

.line-w {
  height: 30rpx;
  width: 70%;
}

.line-n {
  height: 22rpx;
  width: 34%;
  margin-top: 16rpx;
}

.line-s {
  height: 56rpx;
  width: 100%;
  margin-top: 22rpx;
}

.retry {
  margin-top: $sp-4;
  padding: 0 40rpx;
}

.empty-btn {
  margin-top: $sp-5;
  width: 300rpx;
}

/* ---------- 平板 / 折叠屏展开态：清单双栏，结算条跟随版心 ---------- */
@media (min-width: 1000px) {
  .list {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    column-gap: $sp-6;
    align-items: start;
  }

  .bar {
    width: 1000px;
  }
}
</style>
