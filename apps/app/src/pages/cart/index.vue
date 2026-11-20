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
        <view
          v-for="line in cart.items"
          :key="line.productId"
          class="line"
          :class="{ 'line--invalid': !isSelectable(line) }"
        >
          <!-- 行勾选（源站口径）：只有 A 到货行可勾选结算，R/L/X 一律不可勾选 -->
          <view class="tick" hover-class="is-press" @tap="toggleLine(line)">
            <view
              class="tick-box"
              :class="{
                'tick-box--on': selectedIds.has(line.productId),
                'tick-box--off': !isSelectable(line),
              }"
            >
              <text v-if="selectedIds.has(line.productId)" class="tick-mark">✓</text>
            </view>
          </view>
          <view class="cover" :style="tintOf(line)">
            <image
              v-if="coverOf(line) && !isBroken(coverOf(line))"
              class="cover-img"
              :src="coverOf(line)"
              mode="aspectFill"
              lazy-load
              @error="markBroken(coverOf(line))"
            />
            <block v-else>
              <view class="cover-scrim" />
              <text class="cover-char" :class="{ 'cover-char--on-tint': !!coverTint({ cover: line.cover }) }">{{ line.title.slice(0, 1) }}</text>
            </block>
          </view>
          <view class="info">
            <view class="name-row">
              <text class="name">{{ line.title }}</text>
              <!-- 四态徽章：R 需求 / L 缺货 / A 到货 / X 下架，文案优先用服务端下发口径 -->
              <text class="state-badge" :class="`state-badge--${lineStatusOf(line).toLowerCase()}`">{{
                line.lineStatusText || CART_LINE_STATUS_TEXT[lineStatusOf(line)].label
              }}</text>
              <view class="remove" hover-class="is-press" @tap="remove(line.productId)">
                <text class="remove-text mono">移除</text>
              </view>
            </view>
            <view class="unit-row">
              <text v-if="lineStatusOf(line) === 'X'" class="unit unit--gone mono">已下架 · 请移除</text>
              <text v-else-if="isInquiryLine(line)" class="unit unit--inquiry mono">询价 · 联系报价</text>
              <text v-else-if="isOutOfStockLine(line)" class="unit unit--oos mono">缺货 · 需确认库存</text>
              <text v-else-if="isStockUnconfirmedLine(line)" class="unit unit--pending mono">货源待确认 · 可结算</text>
              <template v-else>
                <text class="unit mono">¥{{ lineUnitPrice(line) }} / {{ line.unitName || '件' }}</text>
                <text v-if="line.packLabel" class="stock mono">{{ line.packLabel }} · {{ line.quantity }}支</text>
                <text v-else class="stock mono">{{ isBulkStock(line.stock) ? '现货' : `库存 ${line.stock}` }}</text>
              </template>
            </view>
            <!-- 行级优惠：商城 / 特价取优后的一层，不叠加 -->
            <text v-if="isSelectable(line) && lineDiscountFen(line) > 0" class="discount-tag mono">
              {{ lineDiscountLabel(line) }}
            </text>
            <view class="line-foot">
              <view v-if="isSelectable(line)" class="stepper">
                <view class="step" hover-class="is-press" @tap="changeQty(line.productId, line.quantity - stepOf(line))">
                  <text class="step-text mono">−</text>
                </view>
                <text class="count mono">{{ line.packQty ?? line.quantity }}</text>
                <view class="step" hover-class="is-press" @tap="changeQty(line.productId, line.quantity + stepOf(line))">
                  <text class="step-text mono">+</text>
                </view>
              </view>
              <text v-else class="inquiry-hint">{{ line.lineStatusHint || invalidHintOf(line) }}</text>
              <view class="subtotal">
                <text class="subtotal-k mono">小计</text>
                <text v-if="lineStatusOf(line) === 'X'" class="subtotal-v subtotal-v--oos">下架</text>
                <text v-else-if="isInquiryLine(line)" class="subtotal-v subtotal-v--inquiry">询价</text>
                <text v-else-if="isOutOfStockLine(line)" class="subtotal-v subtotal-v--oos">缺货</text>
                <text v-else class="subtotal-v mono">¥{{ price(line.faceFen ?? line.subtotalFen) }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- 下单拆有效行：R/L/X 失效行在此说明，勾选与结算只作用于 A 到货行 -->
      <view v-if="invalidLines.length" class="inquiry-banner">
        <text class="inquiry-banner-title">购物车中有 {{ invalidLines.length }} 件失效行，不会进入订单</text>
        <text class="inquiry-banner-sub">
          <text v-if="xLines.length">{{ xLines.length }} 件已下架，请从购物车移除；</text>
          <text v-if="rLines.length">{{ rLines.length }} 件需联系报价；</text>
          <text v-if="lLines.length">{{ lLines.length }} 件缺货，需确认库存后再下单。</text>
        </text>
      </view>

      <!-- 三层优惠汇总：商城 / 特价 / 满减，金额均为整数分换算展示 -->
      <view class="summary">
        <view class="summary-head">
          <text class="summary-title">优惠汇总</text>
          <text class="summary-op mono" hover-class="is-press" @tap="toggleAll">
            {{ allSelected ? '取消全选' : '全选可结算' }}
          </text>
        </view>
        <text class="summary-pick mono">已选 {{ selectedLines.length }} / {{ selectableLines.length }} 件可结算商品</text>
        <view class="summary-row">
          <text class="summary-k">商品小计</text>
          <text class="summary-v mono">¥{{ price(pricing.subtotalFen) }}</text>
        </view>
        <view class="summary-row">
          <text class="summary-k">商城优惠</text>
          <text class="summary-v summary-v--off mono">-¥{{ price(pricing.mallDiscountFen) }}</text>
        </view>
        <view class="summary-row">
          <text class="summary-k">特价优惠</text>
          <text class="summary-v summary-v--off mono">-¥{{ price(pricing.tejiaDiscountFen) }}</text>
        </view>
        <!-- 满减档位未启用时命中数为 0：不展示满减行，也不展示「已享受满减」提示 -->
        <view v-if="pricing.manjianDiscountFen > 0" class="summary-row">
          <text class="summary-k">满减优惠</text>
          <text class="summary-v summary-v--off mono">-¥{{ price(pricing.manjianDiscountFen) }}</text>
        </view>
        <text v-if="pricing.manjianTip" class="summary-tip">{{ pricing.manjianTip }}</text>
        <view class="summary-row summary-row--total">
          <text class="summary-k">优惠合计</text>
          <text class="summary-v summary-v--off mono">-¥{{ price(pricing.discountTotalFen) }}</text>
        </view>
        <view class="summary-row summary-row--pay">
          <text class="summary-k summary-k--pay">应付总额</text>
          <text class="summary-v summary-v--pay mono">¥{{ price(pricing.payableFen) }}</text>
        </view>
      </view>

      <view v-if="checkoutVisible" class="checkout">
        <text class="eyebrow">CHECKOUT</text>
        <text class="checkout-title">收货信息</text>
        <text class="hint">提交后库存即扣减，可在订单页查看进度。</text>
        <text v-if="hasUnconfirmed" class="hint">{{ STOCK_UNCONFIRMED_NOTICE }}</text>

        <!-- 地址簿（源站口径）：结算必须从已保存地址中选择，未选不可提交 -->
        <text class="label mt">收货地址</text>
        <text v-if="addressesLoading" class="hint">地址加载中…</text>
        <text v-else-if="!addresses.length" class="hint">还没有保存的地址，请先新增一个。</text>
        <view
          v-for="item in addresses"
          :key="item.id"
          class="addr-card"
          :class="{ 'addr-card--on': item.id === selectedAddressId }"
          hover-class="is-press"
          @tap="selectAddress(item)"
        >
          <view class="addr-head">
            <text class="addr-name">{{ item.receiverName }}</text>
            <text class="addr-phone mono">{{ item.receiverPhone }}</text>
            <text v-if="item.isDefault" class="addr-tag mono">默认</text>
          </view>
          <text class="addr-text">{{ item.fullAddress }}</text>
          <view class="addr-ops">
            <text v-if="!item.isDefault" class="addr-op" @tap.stop="setDefaultAddress(item)">设默认</text>
            <text class="addr-op" @tap.stop="editAddress(item)">编辑</text>
            <text class="addr-op" @tap.stop="removeAddress(item)">删除</text>
          </view>
        </view>
        <view class="addr-add" hover-class="is-press" @tap="toggleAddressForm">
          <text class="addr-add-text mono">{{ addressEditing ? '收起' : '+ 新增地址' }}</text>
        </view>

        <view v-if="addressEditing" class="addr-form">
          <input
            v-model="addrForm.receiverName"
            class="field"
            placeholder="收货人姓名"
            placeholder-class="field-ph"
          />
          <input
            v-model="addrForm.receiverPhone"
            class="field field--gap"
            type="number"
            maxlength="11"
            placeholder="手机号"
            placeholder-class="field-ph"
          />
          <view class="loc-row">
            <view
              class="btn btn--ghost loc-btn"
              :class="{ 'btn--disabled': locating }"
              hover-class="is-press"
              @tap="fillByLocation"
            >
              <text class="form-btn-text">{{ locating ? '定位中…' : '定位填充省市区' }}</text>
            </view>
          </view>
          <input
            v-model="addrForm.province"
            class="field field--gap"
            placeholder="省（如 上海）"
            placeholder-class="field-ph"
          />
          <input
            v-model="addrForm.city"
            class="field field--gap"
            placeholder="市（如 上海市）"
            placeholder-class="field-ph"
          />
          <input
            v-model="addrForm.district"
            class="field field--gap"
            placeholder="区（如 浦东新区）"
            placeholder-class="field-ph"
          />
          <textarea
            v-model="addrForm.detail"
            class="field field--area field--gap"
            placeholder="详细地址（街道、门牌号）"
            placeholder-class="field-ph"
          />
          <view class="form-actions">
            <view class="btn btn--ghost form-btn" hover-class="is-press" @tap="toggleAddressForm">
              <text class="form-btn-text">取消</text>
            </view>
            <view
              class="btn btn--deep form-btn"
              :class="{ 'btn--disabled': savingAddress }"
              hover-class="is-press"
              @tap="saveAddress"
            >
              <text class="form-btn-text form-btn-text--deep">{{ savingAddress ? '保存中…' : '保存地址' }}</text>
            </view>
          </view>
        </view>
        <text v-if="addressBlockReason" class="hint hint--warn">{{ addressBlockReason }}</text>

        <!-- 配送方式与送达时间：方式决定可选时间段，两段都选才可提交 -->
        <text class="label mt">配送方式</text>
        <view class="chips">
          <view
            v-for="m in deliveryMethods"
            :key="m.code"
            class="chip"
            :class="{ 'chip--on': m.code === deliveryMethod }"
            hover-class="is-press"
            @tap="chooseDeliveryMethod(m.code)"
          >
            <text class="chip-text">{{ m.name }}</text>
          </view>
        </view>
        <text class="label mt">配送时间</text>
        <view v-if="!deliveryMethod" class="hint">请先选择配送方式。</view>
        <view v-else class="chips">
          <view
            v-for="s in currentSlots"
            :key="s.code"
            class="chip"
            :class="{ 'chip--on': s.code === deliverySlot }"
            hover-class="is-press"
            @tap="chooseDeliverySlot(s.code)"
          >
            <text class="chip-text">{{ s.label }}</text>
          </view>
        </view>
        <text v-if="deliverySummary" class="hint">已选配送：{{ deliverySummary }}</text>

        <text class="label mt">收货人</text>
        <input
          v-model="form.receiverName"
          class="field"
          placeholder="收货人姓名"
          placeholder-class="field-ph"
          @input="onManualEdit"
        />
        <text class="label mt">手机号</text>
        <input
          v-model="form.receiverPhone"
          class="field"
          type="number"
          maxlength="11"
          placeholder="手机号"
          placeholder-class="field-ph"
          @input="onManualEdit"
        />
        <text class="label mt">详细地址</text>
        <textarea
          v-model="form.address"
          class="field field--area"
          placeholder="省市区 + 门牌号"
          placeholder-class="field-ph"
          @input="onManualEdit"
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
          <text class="bar-label mono">已选 {{ selectedLines.length }} 件 · 共 {{ cart.totalQuantity }} 件</text>
          <text class="bar-price mono">¥{{ price(pricing.payableFen) }}</text>
        </view>
        <view
          class="bar-btn"
          :class="{ 'bar-btn--busy': submitting, 'bar-btn--disabled': !selectedLines.length }"
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
import type {
  AddressDto,
  CartDto,
  CartLineDto,
  CartLineStatus,
  CartPricingDto,
  DeliveryMethodDto,
} from '@mixmapp/contracts';
import { CART_LINE_STATUS_TEXT, matchManjianTier } from '@mixmapp/contracts';
import {
  isBulkStock,
  isOutOfStock,
  isStockUnconfirmed,
  STOCK_UNCONFIRMED_NOTICE,
  unitPriceText,
} from '../../api/mall';
import { mallApi, mediaUrl, productCover, coverTint, isDemoOrderMode, integrationsApi } from '../../api/client';
import { addressApi } from '../../api/address';
import { ROUTES } from '../../routes';
import { goTo } from '../../navigation';

/** 图片加载失败的封面：记住 URL，避免同一张坏图反复重试。 */
const brokenCovers = ref<Set<string>>(new Set());
/** 统一走 mediaUrl（壳内 mediaOrigin 来自 __MIXMAPP_MEDIA_BASE__），禁止直接拼相对路径。 */
function coverOf(line: CartLine): string {
  return productCover({ cover: line.cover });
}
/** 无实物图商品（cover 存的是色值）的占位底色。 */
function tintOf(line: CartLine): Record<string, string> {
  const tint = coverTint({ cover: line.cover });
  return tint ? { background: tint } : {};
}
function isBroken(src: string): boolean {
  return brokenCovers.value.has(src);
}
function markBroken(src: string): void {
  brokenCovers.value = new Set(brokenCovers.value).add(src);
}

/** 购物车行：后端后续可能回传 priceSource，旧数据按价格是否为 0 兜底判定。 */
type CartLine = CartLineDto & { priceSource?: 'anonymous' | 'login' | 'inquiry' };
type CartView = Omit<CartDto, 'items'> & { items: CartLine[] };

/** 空优惠汇总：接口未返回 pricing（离线 / 旧网关兜底）时用它，避免模板读 undefined。 */
const EMPTY_PRICING: CartPricingDto = {
  subtotalFen: 0,
  mallDiscountFen: 0,
  tejiaDiscountFen: 0,
  manjianDiscountFen: 0,
  discountTotalFen: 0,
  payableFen: 0,
  manjianTier: null,
  manjianTip: '',
  tiers: [],
};

const cart = ref<CartView>({ items: [], totalQuantity: 0, totalFen: 0, pricing: EMPTY_PRICING });

/** 勾选集合：只保存可结算行的 productId；失效行永不进入。 */
const selectedIds = ref<Set<string>>(new Set());
/** 用户是否手动改过勾选：未改过时每次加载默认全选可结算行。 */
const selectionTouched = ref(false);

/** 询价行：priceSource 为 inquiry，或价格缺失 / 0 元，一律不参与结算。 */
function isInquiryLine(line: CartLine): boolean {
  return line.priceSource === 'inquiry' || line.priceFen == null || line.priceFen === 0;
}

/** 缺货行：非询价但库存缺失 / 0，历史加购进来的缺货商品同样不能结算。 */
function isOutOfStockLine(line: CartLine): boolean {
  return !isInquiryLine(line) && isOutOfStock(line);
}

/** 货源待确认行：匿名视图推断缺货但无停售信号，可结算，需人工确认货源。 */
function isStockUnconfirmedLine(line: CartLine): boolean {
  return !isInquiryLine(line) && !isOutOfStockLine(line) && isStockUnconfirmed(line);
}

/**
 * 行状态四态（源站 invStatus 口径）：
 * 优先用服务端下发的 lineStatus；旧接口没有该字段时按既有拦截口径兜底推断。
 */
function lineStatusOf(line: CartLine): CartLineStatus {
  if (line.lineStatus) return line.lineStatus;
  if (isInquiryLine(line)) return 'R';
  if (isOutOfStockLine(line)) return 'L';
  return 'A';
}

/** 可勾选性：以服务端 selectable 为准（只有 A 为 true），旧接口回落到「非询价 + 有货」。 */
function isSelectable(line: CartLine): boolean {
  if (typeof line.selectable === 'boolean') return line.selectable;
  return lineStatusOf(line) === 'A';
}

/** 失效行说明兜底：服务端未下发 lineStatusHint 时按四态默认文案补齐。 */
function invalidHintOf(line: CartLine): string {
  const status = lineStatusOf(line);
  return CART_LINE_STATUS_TEXT[status].hint || '该商品暂不可结算';
}

/** 行级优惠额（整数分）：商城与特价取优，服务端只会给其中一层，这里相加即最终值。 */
function lineDiscountFen(line: CartLine): number {
  return (line.mallDiscountFen ?? 0) + (line.tejiaDiscountFen ?? 0);
}

/** 行级优惠文案：区分商城折扣与特价折扣，便于用户核对来源。 */
function lineDiscountLabel(line: CartLine): string {
  const source = (line.tejiaDiscountFen ?? 0) > 0 ? '特价' : '商城';
  return `${source} -¥${price(lineDiscountFen(line))}`;
}

/** 接口返回非 JSON（离线/网关兜底）时可能是 undefined，统一收敛成合法购物车，避免模板读 items 白屏。 */
function normalizeCart(input: unknown): CartView {
  const raw = (input ?? {}) as Partial<CartDto>;
  if (!Array.isArray(raw.items)) {
    return { items: [], totalQuantity: 0, totalFen: 0, pricing: EMPTY_PRICING };
  }
  return {
    items: raw.items as CartLine[],
    totalQuantity: raw.totalQuantity ?? 0,
    totalFen: raw.totalFen ?? 0,
    // pricing 兜底：缺字段时退回空汇总，模板始终拿到结构完整的对象
    pricing: { ...EMPTY_PRICING, ...(raw.pricing ?? {}) },
  };
}
const loading = ref(false);
const error = ref('');
const checkoutVisible = ref(false);
const submitting = ref(false);
const form = ref({ receiverName: '', receiverPhone: '', address: '', remark: '' });

/* ---------- 结算必填项：地址簿 + 配送方式/时间 ---------- */
const addresses = ref<AddressDto[]>([]);
const addressesLoading = ref(false);
/** 当前选中的地址簿地址；手动改表单字段时清空，表示改用手填地址 */
const selectedAddressId = ref('');
/** 不可达原因：有值时直接展示并拦截提交 */
const addressBlockReason = ref('');
const addressEditing = ref(false);
const editingId = ref('');
const savingAddress = ref(false);
const locating = ref(false);
const addrForm = ref({
  receiverName: '',
  receiverPhone: '',
  province: '',
  city: '',
  district: '',
  detail: '',
});
const deliveryMethods = ref<DeliveryMethodDto[]>([]);
const deliveryMethod = ref('');
const deliverySlot = ref('');

const selectedAddress = computed(
  () => addresses.value.find((item) => item.id === selectedAddressId.value) ?? null,
);
/** 配送方式决定可选时间段：切换方式必须重选时间 */
const currentSlots = computed(
  () => deliveryMethods.value.find((item) => item.code === deliveryMethod.value)?.slots ?? [],
);
const deliverySummary = computed(() => {
  if (!deliveryMethod.value) return '';
  const method = deliveryMethods.value.find((item) => item.code === deliveryMethod.value);
  const slot = method?.slots.find((item) => item.code === deliverySlot.value);
  return [method?.name, slot?.label].filter(Boolean).join(' · ');
});

/** 可结算行 = A 到货；R/L/X 都是失效行，不可勾选、不进订单。 */
const selectableLines = computed(() => cart.value.items.filter(isSelectable));
/** 失效行：下单前需要向用户说明的部分。 */
const invalidLines = computed(() => cart.value.items.filter((line) => !isSelectable(line)));
const xLines = computed(() => invalidLines.value.filter((line) => lineStatusOf(line) === 'X'));
const rLines = computed(() => invalidLines.value.filter((line) => lineStatusOf(line) === 'R'));
const lLines = computed(() => invalidLines.value.filter((line) => lineStatusOf(line) === 'L'));
/* 失效行统计见 invalidLines / xLines / rLines / lLines。 */
const hasUnconfirmed = computed(() => cart.value.items.some(isStockUnconfirmedLine));

/** 选中行：勾选集合里仍属于 A 态的行（防止状态变化后残留选中）。 */
const selectedLines = computed(() =>
  selectableLines.value.filter((line) => selectedIds.value.has(line.productId)),
);
const allSelected = computed(
  () => selectableLines.value.length > 0 && selectedLines.value.length === selectableLines.value.length,
);

/** 勾选 / 取消勾选单行；失效行给出对应四态说明，不改变勾选状态。 */
function toggleLine(line: CartLine): void {
  if (!isSelectable(line)) {
    uni.showToast({ title: invalidHintOf(line), icon: 'none' });
    return;
  }
  selectionTouched.value = true;
  const next = new Set(selectedIds.value);
  if (next.has(line.productId)) next.delete(line.productId);
  else next.add(line.productId);
  selectedIds.value = next;
}

/** 全选 / 取消全选：只作用于可结算行。 */
function toggleAll(): void {
  selectionTouched.value = true;
  selectedIds.value = allSelected.value
    ? new Set()
    : new Set(selectableLines.value.map((line) => line.productId));
}

/** 勾选集合与最新购物车对齐：失效行自动取消；用户没动过勾选时默认全选 A 态行。 */
function reconcileSelection(): void {
  const available = new Set(selectableLines.value.map((line) => line.productId));
  const next = new Set<string>();
  for (const id of selectedIds.value) if (available.has(id)) next.add(id);
  if (!selectionTouched.value) for (const id of available) next.add(id);
  selectedIds.value = next;
}

/**
 * 三层优惠汇总（前端按勾选行本地重算，口径与后端一致）：
 * - 商城优惠 / 特价优惠：逐行取服务端算好的整数分减免额（两者互斥，取更优一层）
 * - 满减优惠：按小计净额（面价 - 商城/特价）匹配档位 `min~max → percent%`
 * 取整规则：满减用 Math.floor 向下取整到分，保证减免不超过档位比例；应付额兜底不小于 0。
 */
const pricing = computed<CartPricingDto>(() => {
  const tiers = cart.value.pricing.tiers;
  const rows = selectedLines.value;
  const subtotalFen = rows.reduce((sum, line) => sum + (line.faceFen ?? line.subtotalFen), 0);
  const mallDiscountFen = rows.reduce((sum, line) => sum + (line.mallDiscountFen ?? 0), 0);
  const tejiaDiscountFen = rows.reduce((sum, line) => sum + (line.tejiaDiscountFen ?? 0), 0);
  const netFen = subtotalFen - mallDiscountFen - tejiaDiscountFen;
  const hit = matchManjianTier(netFen, tiers);
  // 满减取整：percent 是「最多减免比例」，整数分向下取整避免超出档位比例
  const manjianDiscountFen = hit ? Math.floor((netFen * hit.percent) / 100) : 0;
  const discountTotalFen = mallDiscountFen + tejiaDiscountFen + manjianDiscountFen;
  const topPercent = tiers.reduce((max, tier) => Math.max(max, tier.percent), 0);
  const manjianTip = hit
    ? `${hit.percent >= topPercent ? '已享受最高折扣' : '已享受满减'} ${hit.percent}%，再减 ¥${price(manjianDiscountFen)}`
    : '';
  return {
    subtotalFen,
    mallDiscountFen,
    tejiaDiscountFen,
    manjianDiscountFen,
    discountTotalFen,
    payableFen: Math.max(0, subtotalFen - discountTotalFen),
    manjianTier: hit,
    manjianTip,
    tiers,
  };
});
/** 失效行汇总：banner 使用 invalidLines / xLines / rLines / lLines。 */
/* 失效行与金额已统一由 invalidLines / pricing 计算，此处不再保留旧口径。 */

const barLabel = computed(() => {
  if (!selectableLines.value.length) return '暂无可结算商品';
  if (!selectedLines.value.length) return '请选择商品';
  if (!checkoutVisible.value) return '去结算';
  return submitting.value ? '提交中…' : '提交订单';
});

function onBarAction(): void {
  if (!selectableLines.value.length) {
    uni.showToast({ title: '没有可结算的商品，请移除失效行', icon: 'none' });
    return;
  }
  if (!selectedLines.value.length) {
    uni.showToast({ title: '请选择要结算的商品', icon: 'none' });
    return;
  }
  if (checkoutVisible.value) {
    void submitOrder();
    return;
  }
  checkoutVisible.value = true;
  void prepareCheckout();
  void nextTick(() => {
    uni.pageScrollTo({ selector: '.checkout', duration: 280, offsetTop: -72, fail: () => undefined });
  });
}

/* ---------- 地址簿与配送（源站口径） ---------- */

/** 打开结算时并行拉取地址簿与配送方式；配送方式拉取失败会让提交被拦，不会静默放行。 */
async function prepareCheckout(): Promise<void> {
  if (!deliveryMethods.value.length) {
    try {
      deliveryMethods.value = await addressApi.deliveryOptions();
    } catch {
      deliveryMethods.value = [];
    }
  }
  await loadAddresses();
}

/** 拉取地址簿；优先选中指定地址，其次默认地址，最后第一条。 */
async function loadAddresses(preferId?: string): Promise<void> {
  addressesLoading.value = true;
  try {
    addresses.value = await addressApi.list();
    const want = preferId ?? selectedAddressId.value;
    const hit =
      addresses.value.find((item) => item.id === want) ??
      addresses.value.find((item) => item.isDefault) ??
      addresses.value[0] ??
      null;
    if (hit) selectAddress(hit);
    else {
      selectedAddressId.value = '';
      addressBlockReason.value = '';
    }
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '地址加载失败', icon: 'none' });
  } finally {
    addressesLoading.value = false;
  }
}

/** 选中地址：回填原有表单字段（字段保持可编辑），并立即做可达性校验。 */
function selectAddress(item: AddressDto): void {
  selectedAddressId.value = item.id;
  form.value.receiverName = item.receiverName;
  form.value.receiverPhone = item.receiverPhone;
  form.value.address = item.fullAddress || `${item.province}${item.city}${item.district}${item.detail}`;
  void runAddressCheck();
}

/** 手动改表单 = 放弃地址簿选择；后端只在带 addressId 时按地址簿快照下单。 */
function onManualEdit(): void {
  selectedAddressId.value = '';
  addressBlockReason.value = '';
}

/** 可达性校验：不可达时把原因落到页面；接口异常不阻断填写，提交时后端还会再校验。 */
async function runAddressCheck(): Promise<void> {
  const item = selectedAddress.value;
  if (!item) {
    addressBlockReason.value = '';
    return;
  }
  try {
    const result = await addressApi.check({
      province: item.province,
      city: item.city,
      district: item.district,
      detail: item.detail,
      ...(deliveryMethod.value ? { deliveryMethod: deliveryMethod.value } : {}),
    });
    addressBlockReason.value = result.reachable ? '' : result.reason ?? '该收货地址暂不可达，请更换地址';
  } catch {
    addressBlockReason.value = '';
  }
}

/** 切配送方式：清空时间段并重跑可达性（门店自提仅上海）。 */
function chooseDeliveryMethod(code: string): void {
  deliveryMethod.value = code;
  deliverySlot.value = '';
  void runAddressCheck();
}

function chooseDeliverySlot(code: string): void {
  deliverySlot.value = code;
}

function resetAddrForm(): void {
  addrForm.value = { receiverName: '', receiverPhone: '', province: '', city: '', district: '', detail: '' };
}

function toggleAddressForm(): void {
  addressEditing.value = !addressEditing.value;
  if (!addressEditing.value) {
    editingId.value = '';
    resetAddrForm();
  }
}

function editAddress(item: AddressDto): void {
  editingId.value = item.id;
  addrForm.value = {
    receiverName: item.receiverName,
    receiverPhone: item.receiverPhone,
    province: item.province,
    city: item.city,
    district: item.district,
    detail: item.detail,
  };
  addressEditing.value = true;
}

/** 新增/编辑共用保存入口：字段校验与后端 schema 保持一致。 */
/** 定位填充：取当前坐标 → 逆地理回填省市区；定位或地图未配置时提示手动填写，不阻断。 */
async function fillByLocation(): Promise<void> {
  if (locating.value) return;
  locating.value = true;
  try {
    const loc = await new Promise<{ longitude: number; latitude: number }>((resolve, reject) => {
      uni.getLocation({
        type: 'gcj02',
        success: (res) => resolve({ longitude: res.longitude, latitude: res.latitude }),
        fail: reject,
      });
    });
    const geo = await integrationsApi.map.regeo(loc.longitude, loc.latitude);
    addrForm.value.province = geo.province;
    addrForm.value.city = geo.city;
    addrForm.value.district = geo.district;
    if (geo.address && !addrForm.value.detail) addrForm.value.detail = geo.address;
    uni.showToast({ title: '已填充定位区域', icon: 'none' });
  } catch {
    uni.showToast({ title: '定位不可用，请手动填写', icon: 'none' });
  } finally {
    locating.value = false;
  }
}

async function saveAddress(): Promise<void> {
  if (savingAddress.value) return;
  const value = addrForm.value;
  const receiverName = value.receiverName.trim();
  const receiverPhone = value.receiverPhone.trim();
  const province = value.province.trim();
  const city = value.city.trim();
  const district = value.district.trim();
  const detail = value.detail.trim();
  if (!receiverName) {
    uni.showToast({ title: '请填写收货人', icon: 'none' });
    return;
  }
  if (!/^1[3-9]\d{9}$/.test(receiverPhone)) {
    uni.showToast({ title: '请填写正确的手机号', icon: 'none' });
    return;
  }
  if (!province || !city || !district) {
    uni.showToast({ title: '请填写省、市、区', icon: 'none' });
    return;
  }
  if (detail.length < 4) {
    uni.showToast({ title: '请填写详细地址', icon: 'none' });
    return;
  }
  savingAddress.value = true;
  try {
    const payload = { receiverName, receiverPhone, province, city, district, detail };
    const saved = editingId.value
      ? await addressApi.update(editingId.value, payload)
      : await addressApi.create(payload);
    addressEditing.value = false;
    editingId.value = '';
    resetAddrForm();
    await loadAddresses(saved.id);
    uni.showToast({ title: '地址已保存', icon: 'none' });
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '地址保存失败', icon: 'none' });
  } finally {
    savingAddress.value = false;
  }
}

async function setDefaultAddress(item: AddressDto): Promise<void> {
  try {
    await addressApi.setDefault(item.id);
    await loadAddresses(item.id);
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '设置默认地址失败', icon: 'none' });
  }
}

function removeAddress(item: AddressDto): void {
  uni.showModal({
    title: '删除地址',
    content: `确定删除「${item.fullAddress}」吗？`,
    success: (res) => {
      if (!res.confirm) return;
      void (async () => {
        try {
          await addressApi.remove(item.id);
          if (selectedAddressId.value === item.id) selectedAddressId.value = '';
          await loadAddresses();
        } catch (e) {
          uni.showToast({ title: e instanceof Error ? e.message : '删除失败', icon: 'none' });
        }
      })();
    },
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

/** 把接口返回的购物车落到本地，并同步勾选集合（失效行自动取消勾选）。 */
function applyCart(input: unknown): void {
  cart.value = normalizeCart(input);
  reconcileSelection();
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    applyCart(await mallApi.getCart());
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
  // 失效行（R/L/X）不能调整数量：按四态说明提示，操作入口只保留移除
  if (line && !isSelectable(line)) {
    uni.showToast({ title: invalidHintOf(line), icon: 'none' });
    return;
  }
  if (quantity < 1) {
    await remove(productId);
    return;
  }
  try {
    const packQty = line?.packQty ? Math.max(1, Math.round(quantity / stepOf(line))) : undefined;
    applyCart(await mallApi.updateCart(productId, quantity, line?.packUnit, packQty));
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '修改数量失败', icon: 'none' });
  }
}

async function remove(productId: string): Promise<void> {
  try {
    applyCart(await mallApi.removeCart(productId));
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '删除失败', icon: 'none' });
  }
}

async function submitOrder(): Promise<void> {
  // 下单拆有效行：只提交勾选的 A 到货行，失效行留在购物车并给出说明
  if (!selectedLines.value.length) {
    uni.showToast({ title: '请选择要结算的商品', icon: 'none' });
    return;
  }
  const { receiverName, receiverPhone, address } = form.value;
  // 结算必填项拦截（源站口径）：地址簿未选中且手填地址不完整 → 不可提交
  if (!selectedAddressId.value && address.trim().length < 4) {
    uni.showToast({ title: '请选择收货地址', icon: 'none' });
    return;
  }
  if (addressBlockReason.value) {
    uni.showToast({ title: addressBlockReason.value, icon: 'none' });
    return;
  }
  if (!deliveryMethod.value) {
    uni.showToast({ title: '请选择配送方式', icon: 'none' });
    return;
  }
  if (!deliverySlot.value) {
    uni.showToast({ title: '请选择配送时间', icon: 'none' });
    return;
  }
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

  // 防误提交：无论演示还是真实链路，提交前都二次确认。
  // 演示模式明确告知「不产生真实订单 / 不扣库存 / 不支付」；真实链路提示库存将扣减。
  const demo = isDemoOrderMode();
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: demo ? '演示环境 · 预览订单' : '确认提交订单',
      content: demo
        ? '当前为演示模式：仅走下单流程预览，不会生成真实订单、不扣减库存、不发起支付。'
        : '提交后将扣减库存并生成真实订单，确认继续？',
      confirmText: demo ? '生成预览单' : '确认提交',
      cancelText: '再看看',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    });
  });
  if (!confirmed) return;

  submitting.value = true;
  try {
    const order = await mallApi.createOrder({
      receiverName: receiverName.trim(),
      receiverPhone: receiverPhone.trim(),
      address: address.trim(),
      ...(form.value.remark.trim() ? { remark: form.value.remark.trim() } : {}),
      // 地址簿选择 + 配送方式/时间段：后端据此落快照并再次校验
      ...(selectedAddressId.value ? { addressId: selectedAddressId.value } : {}),
      ...(deliveryMethod.value ? { deliveryMethod: deliveryMethod.value } : {}),
      ...(deliverySlot.value ? { deliverySlot: deliverySlot.value } : {}),
      // 显式声明「从购物车结算」：下单成功后由后端扣减已结算行；
      // 不能靠「有没有 items」反推（勾选结算同样会传 items）
      fromCart: true,
      // 只把勾选的 A 到货行交给后端；失效行/未勾选行不会进单
      items: selectedLines.value.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        ...(line.packUnit ? { packUnit: line.packUnit } : {}),
        ...(line.packQty != null ? { packQty: line.packQty } : {}),
      })),
    });
    // 演示沙箱订单：后端未落库、未扣库存、未清购物车，只回显预览单号，不跳「我的订单」。
    if (order.demo) {
      uni.showModal({
        title: '演示订单已生成',
        content: `单号 ${order.orderNo}\n仅作流程预览，未写入真实订单。`,
        showCancel: false,
        confirmText: '知道了',
      });
      return;
    }
    checkoutVisible.value = false;
    // 失效行留在购物车：清空勾选，返回本页时由 onShow 重新拉取
    selectedIds.value = new Set();
    selectionTouched.value = false;
    const skipped = order.skippedLines?.length ?? 0;
    uni.showToast({
      title: skipped ? `下单成功，${skipped} 件失效商品未进单` : '下单成功',
      icon: 'success',
    });
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
  @include mx-gradient-text;
}

.sub {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  letter-spacing: 2rpx;
  color: $acc-6;
}

.list {
  margin-bottom: $sp-4;
}

.line {
  display: flex;
  padding: $sp-3 0;
  border-bottom: 1rpx solid $paper-3;
}

/* 行勾选：只有 A 到货行可点，R/L/X 显示为禁用态 */
.tick {
  width: 64rpx;
  height: 148rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tick-box {
  width: 40rpx;
  height: 40rpx;
  border: 1rpx solid $paper-3;
  border-radius: 8rpx;
  background: $paper-2;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tick-box--on {
  background: $solid;
  border-color: $solid;
}

.tick-box--off {
  opacity: 0.35;
}

.tick-mark {
  font-size: 24rpx;
  font-weight: 700;
  color: $on-solid;
}

/* 失效行整体降饱和，避免与可结算行混淆 */
.line--invalid .cover,
.line--invalid .name {
  opacity: 0.55;
}

/* 四态徽章：R 需求 / L 缺货 / A 到货 / X 下架 */
.state-badge {
  flex-shrink: 0;
  margin-top: 4rpx;
  margin-right: $sp-2;
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
  font-size: 22rpx;
  font-weight: 600;
  line-height: 1.5;
}

.state-badge--a {
  color: $ink-3;
  background: $paper-2;
}

.state-badge--r {
  color: $brand-deep;
  background: rgba(13, 25, 23, 0.06);
}

.state-badge--l {
  color: $amber;
  background: rgba(198, 138, 24, 0.12);
}

.state-badge--x {
  color: $ink-4;
  background: $paper-2;
  text-decoration: line-through;
}

.unit--gone {
  color: $ink-4;
  text-decoration: line-through;
}

/* 行级优惠：商城 / 特价取优后的一层 */
.discount-tag {
  display: inline-block;
  margin-top: 6rpx;
  font-size: 24rpx;
  color: $amber;
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

.cover-img {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
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
  color: $acc-2;
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

.unit--pending {
  color: $amber;
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

/* ---------- 三层优惠汇总 ---------- */
.summary {
  margin: $sp-3 0 $sp-4;
  padding: $sp-3;
  border: 1rpx solid $paper-3;
  border-radius: $r-card;
  background: $paper-2;
}

.summary-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.summary-title {
  font-family: $font-display;
  font-size: 32rpx;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
}

.summary-op {
  font-size: 24rpx;
  color: $brand-deep;
}

.summary-pick {
  display: block;
  margin-top: 4rpx;
  font-size: 24rpx;
  color: $ink-4;
}

.summary-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: 12rpx;
}

.summary-k {
  font-size: 26rpx;
  color: $ink-3;
}

.summary-v {
  font-size: 28rpx;
  font-weight: 600;
  color: $ink;
}

.summary-v--off {
  color: $amber;
}

.summary-tip {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: $amber;
}

.summary-row--total {
  padding-top: 12rpx;
  border-top: 1rpx dashed $paper-3;
}

.summary-k--pay {
  font-size: 28rpx;
  font-weight: 600;
  color: $ink;
}

.summary-v--pay {
  font-size: 36rpx;
  font-weight: 800;
  color: $acc-4;
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
  color: $acc-2;
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
  color: $acc-4;
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
  @include mx-gradient-text;
}

.checkout .hint {
  margin-top: 8rpx;
}

.mt {
  margin-top: $sp-3;
}

/* ---------- 地址簿 / 配送方式 ---------- */
.addr-card {
  margin-top: $sp-2;
  padding: $sp-3;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
  background: $paper-2;
}

.addr-card--on {
  border-color: $brand-deep;
  background: $paper;
}

.addr-head {
  display: flex;
  align-items: center;
}

.addr-name {
  font-family: $font-display;
  font-size: 30rpx;
  font-weight: 800;
  color: $ink;
}

.addr-phone {
  margin-left: $sp-2;
  font-size: 26rpx;
  color: $ink-3;
}

.addr-tag {
  margin-left: auto;
  padding: 2rpx 12rpx;
  border: 1rpx solid $brand-deep;
  border-radius: 999rpx;
  font-size: 22rpx;
  color: $brand-deep;
}

.addr-text {
  display: block;
  margin-top: 8rpx;
  font-size: 26rpx;
  line-height: 1.5;
  color: $ink-3;
}

.addr-ops {
  display: flex;
  justify-content: flex-end;
  margin-top: 12rpx;
}

.addr-op {
  margin-left: $sp-3;
  font-size: 24rpx;
  color: $brand-deep;
}

.addr-add {
  margin-top: $sp-2;
  padding: $sp-2 0;
}

.addr-add-text {
  font-size: 26rpx;
  color: $brand-deep;
}

.addr-form {
  margin-top: $sp-2;
}

.field--gap {
  margin-top: $sp-2;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  margin-top: 8rpx;
}

.chip {
  margin-right: $sp-2;
  margin-bottom: $sp-2;
  padding: 0 24rpx;
  height: 68rpx;
  border: 1rpx solid $paper-3;
  border-radius: 999rpx;
  background: $paper-2;
  display: flex;
  align-items: center;
}

.chip--on {
  border-color: $brand-deep;
  background: $brand-deep;
}

.chip-text {
  font-size: 26rpx;
  color: $ink;
}

.chip--on .chip-text {
  color: $on-solid;
}

.hint--warn {
  color: $amber;
}

.loc-row {
  display: flex;
  margin-top: $sp-2;
}

.loc-btn {
  height: 76rpx;
  padding: 0 28rpx;
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
  color: $acc-4;
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
