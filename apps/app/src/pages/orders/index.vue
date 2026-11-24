<template>
  <view class="page">
    <mx-bar title="我的订单" />
    <view class="head">
      <text class="eyebrow">ORDERS</text>
      <text class="title">通行证订单</text>
      <text class="sub mono">
        {{ total ?? orders.length }} RECORDS · 第 {{ page }}/{{ pageCount }} 页
      </text>
    </view>

    <!-- 状态筛选：与后端六态对齐；切换后回第一页 -->
    <scroll-view :scroll-x="true" class="status-tabs" :show-scrollbar="false">
      <view
        v-for="tab in STATUS_TABS"
        :key="tab.value || 'all'"
        class="status-tab"
        :class="{ 'status-tab--on': status === tab.value }"
        hover-class="is-press"
        @tap="selectStatus(tab.value)"
      >
        <text class="status-tab-text mono">{{ tab.label }}</text>
      </view>
    </scroll-view>

    <view v-if="loading" class="loading">
      <view v-for="i in 2" :key="i" class="sheet ticket-sk">
        <view class="sk tk-head" />
        <view class="sk tk-line" />
        <view class="sk tk-line tk-short" />
      </view>
    </view>

    <view v-else-if="error" class="empty">
      <view class="empty-mark mono">!</view>
      <text class="empty-title">订单没打开</text>
      <text class="empty-sub">{{ error }}</text>
      <view class="btn btn--deep btn--sm retry" hover-class="is-press" @tap="load">重新加载</view>
    </view>

    <view v-else-if="orders.length === 0" class="empty">
      <view class="empty-mark">0</view>
      <text class="empty-title">还没有订单</text>
      <text class="empty-sub">下单后可在这里查看进度。</text>
      <view class="btn btn--deep empty-btn" hover-class="is-press" @tap="goMall">去商城</view>
    </view>

    <view v-else class="list">
      <view
        v-for="order in orders"
        :key="order.id"
        class="sheet ticket"
        :class="{ 'ticket--active': order.orderNo === highlight }"
      >
        <view class="ticket-head">
          <view class="tk-no-wrap">
            <text class="tk-no mono">{{ order.orderNo }}</text>
            <view class="tk-sub">
              <text class="tk-date mono">{{ dateText(order.createdAt) }}</text>
              <view v-if="order.orderNo === highlight" class="active-flag">
                <text class="active-flag-text mono">本次下单</text>
              </view>
            </view>
          </view>
          <view class="status-chip" :class="`status-chip--${order.status}`">
            <text class="status-chip-text mono">{{ statusText(order.status) }}</text>
          </view>
        </view>

        <view class="rule perf-rule" />

        <view class="items">
          <view v-for="item in order.items" :key="item.productId + item.title" class="item">
            <view class="item-cover">
              <mx-icon name="box" :size="40" tone="ink2" />
            </view>
            <view class="item-main">
              <text class="item-title">{{ item.title }}</text>
              <text class="item-qty mono">×{{ item.quantity }}</text>
            </view>
            <text class="item-price mono">¥{{ price(item.subtotalFen) }}</text>
          </view>
        </view>

        <view class="ticket-foot">
          <view class="receiver">
            <text class="receiver-name">{{ order.receiverName }}</text>
            <text class="receiver-phone mono">{{ maskPhone(order.receiverPhone) }}</text>
          </view>
          <view class="total-wrap">
            <text class="total-k mono">合计</text>
            <text class="total-v mono">¥{{ price(order.totalFen) }}</text>
          </view>
        </view>

        <text class="address">{{ order.address }}</text>

        <!-- 详情入口：卡片内联展开，复用列表已带的完整 OrderDto，不另建页面 -->
        <view class="detail-toggle" hover-class="is-press" @tap="toggleDetail(order)">
          <text class="detail-toggle-text mono">
            {{ expandedNo === order.orderNo ? '收起详情' : '订单详情' }}
          </text>
        </view>
        <view v-if="expandedNo === order.orderNo" class="detail-panel">
          <text class="detail-row mono">下单时间 {{ dateText(order.createdAt) }}</text>
          <text v-if="order.pickingAt" class="detail-row mono">分配拣货 {{ dateText(order.pickingAt) }}</text>
          <text v-if="order.shippedAt" class="detail-row mono">发货时间 {{ dateText(order.shippedAt) }}</text>
          <text v-if="order.completedAt" class="detail-row mono">完成时间 {{ dateText(order.completedAt) }}</text>
          <text v-if="order.remark" class="detail-row">备注：{{ order.remark }}</text>
        </view>

        <!-- 0018 六态：已取消展示取消留痕；其余状态给取消入口，不可取消时说明原因（不静默置灰） -->
        <view v-if="order.status === 'cancelled'" class="cancel-row">
          <text class="cancel-note mono">{{ cancelLine(order) }}</text>
        </view>
        <view v-else class="action-row">
          <view
            v-if="order.status === 'pending'"
            class="btn btn--primary btn--sm pay-btn"
            :class="{ 'btn--disabled': paying === order.orderNo }"
            hover-class="is-press"
            @tap="pay(order)"
          >
            {{ paying === order.orderNo ? '发起中…' : '去支付' }}
          </view>
          <view
            v-if="canCancel(order)"
            class="btn btn--ghost btn--sm cancel-btn"
            :class="{ 'btn--disabled': cancelling === order.orderNo }"
            hover-class="is-press"
            @tap="askCancel(order)"
          >
            {{ cancelling === order.orderNo ? '取消中…' : '取消订单' }}
          </view>
          <text v-else class="lock-note">{{ cancelHint(order) }}</text>
        </view>
      </view>
    </view>

    <view v-if="orders.length" class="foot">
      <view class="pager">
        <view
          class="pager-btn"
          :class="{ 'pager-btn--disabled': page <= 1 || loading }"
          hover-class="is-press"
          @tap="changePage(page - 1)"
        >
          <text class="pager-text mono">上一页</text>
        </view>
        <text class="pager-info mono">{{ page }} / {{ pageCount }}</text>
        <view
          class="pager-btn"
          :class="{ 'pager-btn--disabled': page >= pageCount || loading }"
          hover-class="is-press"
          @tap="changePage(page + 1)"
        >
          <text class="pager-text mono">下一页</text>
        </view>
      </view>
      <text class="micro mono">订单与库存以服务端为准 · 下拉刷新可重新加载</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import type { OrderDto } from '@mixmapp/contracts';
import { mallApi, integrationsApi, providerState } from '../../api/client';
import { ROUTES } from '../../routes';
import { goTo } from '../../navigation';
import { showDangerModal } from '../../modal';
import MxIcon from '../../components/mx-icon/mx-icon.vue';

const orders = ref<OrderDto[]>([]);
const loading = ref(false);
const error = ref('');
const highlight = ref('');
/** 正在取消的订单号：防止重复点击 + 按钮态提示 */
const cancelling = ref('');
/** 正在发起支付的订单号 */
const paying = ref('');
/** 状态筛选：'' 表示全部；与后端 ORDER_STATUSES 对齐。 */
const status = ref<'' | OrderDto['status']>('');
const page = ref(1);
const pageSize = 20;
/** 服务端命中总数；未取到摘要时回落到当前页条数。 */
const total = ref<number | null>(null);
/** 内联展开详情的订单号（不新建页面，复用列表已带的完整 OrderDto）。 */
const expandedNo = ref('');

const STATUS_TABS: Array<{ value: '' | OrderDto['status']; label: string }> = [
  { value: '', label: '全部' },
  { value: 'pending', label: '待支付' },
  { value: 'paid', label: '已支付' },
  { value: 'picking', label: '拣货中' },
  { value: 'shipped', label: '已发货' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
];

const pageCount = computed(() => (total.value == null ? 1 : Math.max(1, Math.ceil(total.value / pageSize))));

function selectStatus(next: '' | OrderDto['status']): void {
  if (status.value === next) return;
  status.value = next;
  page.value = 1;
  expandedNo.value = '';
  void load();
}

function changePage(next: number): void {
  if (next < 1 || next > pageCount.value || loading.value) return;
  page.value = next;
  expandedNo.value = '';
  void load();
}

function toggleDetail(order: OrderDto): void {
  expandedNo.value = expandedNo.value === order.orderNo ? '' : order.orderNo;
}

function price(fen: number): string {
  return (fen / 100).toFixed(2);
}

function maskPhone(phone: string): string {
  return phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone;
}

/** 六态文案（0018）：未知态直接回显原值，避免新增状态时前端显示空白 */
const STATUS_TEXT: Record<OrderDto['status'], string> = {
  pending: '待支付',
  paid: '已支付',
  picking: '拣货中',
  shipped: '已发货',
  completed: '已完成',
  cancelled: '已取消',
};

function statusText(status: OrderDto['status']): string {
  return STATUS_TEXT[status] ?? status;
}

/** 可取消：仅待支付 / 已支付，且服务端未分配拣货（picking_at 为空） */
function canCancel(order: OrderDto): boolean {
  return (order.status === 'pending' || order.status === 'paid') && !order.pickingAt;
}

/** 不可取消时的原因文案：不要把按钮置灰了事，要明确告诉用户为什么 */
function cancelHint(order: OrderDto): string {
  // 与后端判定顺序一致：先报最接近当下的状态，shipped 行 pickingAt 同样非空
  if (order.status === 'completed') return '订单已完成，无法取消';
  if (order.status === 'shipped') return '已发货，无法取消';
  if (order.pickingAt || order.status === 'picking') return '已分配拣货，无法取消';
  return '';
}

/** 取消方文案：系统取消 / 管理员取消 / 用户主动取消 */
function cancelRoleText(by: OrderDto['cancelledBy']): string {
  if (by === 'system') return '（系统自动）';
  if (by === 'admin') return '（管理员）';
  if (by === 'user') return '（本人操作）';
  return '';
}

/** 已取消订单的留痕行：取消方 + 取消原因 */
function cancelLine(order: OrderDto): string {
  const role = cancelRoleText(order.cancelledBy ?? null);
  return order.cancelReason ? `已取消${role} · ${order.cancelReason}` : `已取消${role}`;
}

function askCancel(order: OrderDto): void {
  if (cancelling.value) return;
  showDangerModal({
    title: '取消订单',
    content: `确认取消订单 ${order.orderNo}？取消后不可恢复，库存将退回。`,
    confirmText: '确认取消',
    success: (res) => {
      if (res.confirm) void doCancel(order);
    },
  });
}

async function doCancel(order: OrderDto): Promise<void> {
  if (cancelling.value) return;
  cancelling.value = order.orderNo;
  try {
    const updated = await mallApi.cancelOrder(order.orderNo);
    // 原地替换单条，避免整表重载导致列表跳动
    const idx = orders.value.findIndex((o) => o.id === updated.id);
    if (idx >= 0) orders.value[idx] = updated;
    uni.showToast({ title: '订单已取消', icon: 'none' });
  } catch (e) {
    // 服务端会返回「已分配拣货 / 已发货 / 已完成」等具体原因，原样展示
    uni.showToast({ title: e instanceof Error ? e.message : '取消失败', icon: 'none' });
  } finally {
    cancelling.value = '';
  }
}

/** 发起支付：未配置商户时后端返回 dev 占位参数，不真实扣款；live 模式待端侧 SDK 调起。 */
async function pay(order: OrderDto): Promise<void> {
  if (paying.value) return;
  paying.value = order.orderNo;
  try {
    const channel = providerState('alipay') !== 'off' ? 'alipay' : 'wechat';
    const res = await integrationsApi.pay.createOrder({
      channel,
      amountFen: order.totalFen,
      subject: `订单 ${order.orderNo}`,
      outTradeNo: order.orderNo,
    });
    if (res.mode === 'dev') {
      uni.showModal({
        title: '开发态下单',
        content: `已生成占位支付单 ${res.outTradeNo}，未真实扣款。配置商户凭证后由端侧 SDK 调起支付。`,
        showCancel: false,
      });
    } else {
      uni.showModal({
        title: '支付单已创建',
        content: `商户订单号 ${res.outTradeNo}，待端侧支付 SDK 调起。`,
        showCancel: false,
      });
    }
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '支付发起失败', icon: 'none' });
  } finally {
    paying.value = '';
  }
}

function dateText(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const query = { status: status.value || undefined, page: page.value, pageSize };
    const [list, summary] = await Promise.all([
      mallApi.listOrders(query),
      mallApi.orderSummary(query).catch(() => null),
    ]);
    orders.value = Array.isArray(list) ? list : [];
    total.value = summary && typeof summary.total === 'number' ? summary.total : null;
    // 越界兜底：筛选项变化后当前页可能超出总页数，回第一页。
    if (orders.value.length === 0 && page.value > 1) {
      page.value = 1;
      void load();
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : '订单加载失败';
    if (message.includes('登录')) {
      uni.navigateTo({ url: ROUTES.login });
      return;
    }
    error.value = message;
  } finally {
    loading.value = false;
  }
}

function goMall(): void {
  goTo(ROUTES.mall);
}

onLoad((options) => {
  highlight.value = (options?.['orderNo'] as string | undefined) ?? '';
  void load();
});
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  padding: 0 $sp-3 calc($sp-8 + var(--mx-safe-bottom));
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
  color: $acc-6;
}

/* ---------- 票据 ---------- */
.ticket {
  position: relative;
  overflow: hidden;
  padding: $sp-4 $sp-4 0;
  margin-bottom: $sp-3;
}

.ticket--active {
  box-shadow:
    0 0 0 2rpx rgba(15, 157, 143, 0.35),
    $shadow-card;
}

.ticket-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.tk-no-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.tk-no {
  min-width: 0;
  font-size: 26rpx;
  letter-spacing: 1rpx;
  word-break: break-all;
  color: $ink-3;
}

.tk-date {
  font-size: 26rpx;
  color: $ink-4;
}

.tk-sub {
  display: flex;
  align-items: center;
  margin-top: 6rpx;
}

.active-flag {
  margin-left: 12rpx;
  padding: 2rpx 12rpx;
  border-radius: $r-pill;
  background: $brand;
  display: inline-flex;
  align-items: center;
}

.active-flag-text {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $shell;
}

.status-chip {
  margin-left: $sp-2;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 44rpx;
  padding: 0 16rpx;
  border-radius: $r-pill;
}

.status-chip--pending {
  background: $paper-2;
}

.status-chip--pending .status-chip-text {
  color: $amber;
}

.status-chip--paid {
  background: $brand-soft;
}

.status-chip--paid .status-chip-text {
  color: $brand-deep;
}

.status-chip--cancelled {
  background: $paper-2;
}

.status-chip--cancelled .status-chip-text {
  color: $ink-4;
}

/* 0018 新增三态：拣货中（进行中）/ 已发货（送达中）/ 已完成（终态） */
.status-chip--picking {
  background: $brand-soft;
}

.status-chip--picking .status-chip-text {
  color: $brand-deep;
}

.status-chip--shipped {
  background: $brand-soft;
}

.status-chip--shipped .status-chip-text {
  color: $brand-deep;
}

.status-chip--completed {
  background: $paper-2;
}

.status-chip--completed .status-chip-text {
  color: $ink-2;
}

.status-chip-text {
  font-size: $fs-micro;
  letter-spacing: 1rpx;
}

.perf-rule {
  margin: $sp-3 0;
}

.items {
  padding: 2rpx 0 $sp-2;
}

.item {
  display: flex;
  align-items: center;
  padding: 12rpx 0;
  border-bottom: 1rpx solid $paper-3;
}

.item:last-child {
  border-bottom: none;
}

.item-cover {
  width: 88rpx;
  height: 88rpx;
  flex-shrink: 0;
  margin-right: 16rpx;
  border-radius: 16rpx;
  background: $paper-2;
  display: flex;
  align-items: center;
  justify-content: center;
}

.item-main {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-size: 28rpx;
  line-height: 1.35;
  color: $ink-2;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  white-space: normal;
}

.item-qty {
  display: block;
  margin-top: 4rpx;
  font-size: 24rpx;
  color: $ink-4;
}

.item-price {
  width: 140rpx;
  text-align: right;
  font-size: 30rpx;
  color: $acc-4;
}

.ticket-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-top: $sp-2;
  padding-top: $sp-3;
  border-top: 1rpx solid $paper-3;
}

.receiver {
  display: flex;
  flex-direction: column;
}

.receiver-name {
  font-size: 30rpx;
  color: $ink-2;
}

.receiver-phone {
  margin-top: 6rpx;
  font-size: 26rpx;
  color: $ink-4;
}

.total-wrap {
  display: flex;
  align-items: baseline;
}

.total-k {
  font-size: 26rpx;
  letter-spacing: 1rpx;
  color: $ink-4;
  margin-right: 8rpx;
}

.total-v {
  font-size: 34rpx;
  font-weight: 800;
  color: $acc-4;
}

.address {
  display: block;
  margin-top: $sp-2;
  padding-bottom: $sp-2;
  font-size: 26rpx;
  line-height: 1.6;
  color: $ink-3;
}

/* ---------- 状态筛选 tab ---------- */
.status-tabs {
  display: flex;
  white-space: nowrap;
  padding: 0 4rpx $sp-3;
}

.status-tab {
  margin-right: $sp-2;
  padding: 8rpx 22rpx;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-pill;
}

.status-tab--on {
  background: $brand-soft;
  border-color: transparent;
}

.status-tab-text {
  font-size: $fs-micro;
  color: $ink-3;
}

.status-tab--on .status-tab-text {
  color: $brand-deep;
  font-weight: 600;
}

/* ---------- 订单详情内联展开 ---------- */
.detail-toggle {
  display: inline-flex;
  padding: 4rpx 0;
}

.detail-toggle-text {
  font-size: $fs-micro;
  color: $brand-deep;
}

.detail-panel {
  display: flex;
  flex-direction: column;
  padding: $sp-2 0;
  border-top: 1rpx dashed $paper-3;
}

.detail-row {
  margin-top: 6rpx;
  font-size: 26rpx;
  line-height: 1.6;
  color: $ink-3;
}

/* ---------- 分页 ---------- */
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: $sp-2;
}

.pager-btn {
  padding: 8rpx 24rpx;
  background: $shell;
  border: 1rpx solid $paper-3;
  border-radius: $r-control;
}

.pager-btn--disabled {
  opacity: 0.4;
}

.pager-text {
  font-size: $fs-micro;
  color: $ink-2;
}

.pager-info {
  margin: 0 $sp-3;
  font-size: $fs-micro;
  color: $ink-3;
}

/* ---------- 取消入口 / 取消留痕（0018） ---------- */
.action-row {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding-bottom: $sp-4;
}

.pay-btn {
  min-width: 180rpx;
  margin-right: $sp-2;
}

.cancel-btn {
  min-width: 180rpx;
}

.cancel-row {
  padding-bottom: $sp-4;
}

.cancel-note {
  font-size: 26rpx;
  line-height: 1.5;
  color: $ink-4;
}

.lock-note {
  font-size: 26rpx;
  color: $ink-4;
}

/* ---------- 骨架 / 空态 ---------- */
.ticket-sk {
  padding: $sp-4;
  margin-bottom: $sp-3;
  border-radius: $r-card;
}

.tk-head {
  height: 30rpx;
  width: 52%;
}

.tk-line {
  height: 24rpx;
  width: 82%;
  margin-top: 22rpx;
}

.tk-short {
  width: 40%;
  margin-top: 14rpx;
}

.retry {
  margin-top: $sp-4;
  padding: 0 40rpx;
}

.empty-btn {
  margin-top: $sp-5;
  width: 300rpx;
}

.foot {
  padding: $sp-3 0 $sp-6;
  text-align: center;
}
</style>
