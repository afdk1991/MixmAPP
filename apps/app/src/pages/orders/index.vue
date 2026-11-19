<template>
  <view class="page">
    <mx-bar />
    <view class="head">
      <text class="eyebrow">ORDERS</text>
      <text class="title">通行证订单</text>
      <text class="sub mono">{{ orders.length ? `${orders.length} RECORDS` : 'NO RECORDS' }}</text>
    </view>

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
            <text class="item-title">{{ item.title }}</text>
            <text class="item-qty mono">×{{ item.quantity }}</text>
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

        <!-- 0018 六态：已取消展示取消留痕；其余状态给取消入口，不可取消时说明原因（不静默置灰） -->
        <view v-if="order.status === 'cancelled'" class="cancel-row">
          <text class="cancel-note mono">{{ cancelLine(order) }}</text>
        </view>
        <view v-else class="action-row">
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
      <text class="micro mono">订单与库存以服务端为准 · 下拉刷新可重新加载</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import type { OrderDto } from '@mixmapp/contracts';
import { mallApi } from '../../api/client';
import { ROUTES } from '../../routes';
import { goTo } from '../../navigation';

const orders = ref<OrderDto[]>([]);
const loading = ref(false);
const error = ref('');
const highlight = ref('');
/** 正在取消的订单号：防止重复点击 + 按钮态提示 */
const cancelling = ref('');

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
  uni.showModal({
    title: '取消订单',
    content: `确认取消订单 ${order.orderNo}？取消后不可恢复，库存将退回。`,
    confirmText: '确认取消',
    confirmColor: '#C0392B',
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

function dateText(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const list = await mallApi.listOrders();
    orders.value = Array.isArray(list) ? list : [];
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
  padding: 0 $sp-3 $sp-8;
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

/* ---------- 票据 ---------- */
.ticket {
  position: relative;
  overflow: hidden;
  padding: $sp-4 $sp-4 0;
  margin-bottom: $sp-3;
}

.ticket--active {
  border-color: rgba(15, 157, 143, 0.5);
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
  font-size: 28rpx;
  letter-spacing: 1rpx;
  word-break: break-all;
  color: $acc-2;
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
  background: $brand;
}

.status-chip--shipped .status-chip-text {
  color: $shell;
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

.item-title {
  flex: 1;
  font-size: 30rpx;
  line-height: 1.35;
  color: $acc-2;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  white-space: normal;
}

.item-qty {
  width: 80rpx;
  text-align: right;
  font-size: 26rpx;
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

/* ---------- 取消入口 / 取消留痕（0018） ---------- */
.action-row {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding-bottom: $sp-4;
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
