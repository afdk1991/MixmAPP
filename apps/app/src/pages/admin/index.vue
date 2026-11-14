<template>
  <view class="page">
    <mx-bar />

    <!-- ---------- 深场页头 ---------- -->
    <view class="head">
      <view class="head-row">
        <view class="head-text">
          <text class="head-eyebrow mono">ADMIN SURFACE</text>
          <text class="head-title">数据库落点</text>
          <text class="head-sub mono">云服务器本机 PG = 权威 · CloudBase 云 PG = 可选备援</text>
        </view>
        <view class="head-chip" :class="{ 'head-chip--off': !status }">
          <text class="head-chip-text mono">{{ status ? 'CONNECTED' : 'LOCKED' }}</text>
        </view>
      </view>
    </view>

    <view class="body">
      <!-- ---------- 数字档案：2×2 指标 ---------- -->
      <view v-if="status" class="metrics">
        <view class="metric">
          <text class="metric-k mono">CURRENT</text>
          <text class="metric-v mono">{{ currentLabel }}</text>
        </view>
        <view class="metric">
          <text class="metric-k mono">DRIVER</text>
          <text class="metric-v mono">{{ status.driver }}</text>
        </view>
        <view class="metric">
          <text class="metric-k mono">BACKUP</text>
          <text class="metric-v mono" :class="{ 'metric-v--warn': !status.available.cloudbase.configured }">
            {{ backupLabel }}
          </text>
        </view>
        <view class="metric">
          <text class="metric-k mono">SWEEP</text>
          <text class="metric-v mono">{{ sweepCount }}</text>
        </view>
      </view>

      <!-- ---------- 管理令牌 ---------- -->
      <view class="section">
        <view class="sec-head">
          <view class="sec-head-l">
            <text class="eyebrow">ADMIN TOKEN</text>
            <text class="sec-title">管理令牌</text>
          </view>
        </view>
        <input
          v-model="token"
          class="field mono"
          placeholder="x-admin-token（服务端 ADMIN_TOKEN）"
          password
          @confirm="saveToken"
        />
        <view class="btn-row">
          <button class="btn btn--deep btn--block" :loading="loading" @click="refresh">读取落点</button>
          <button class="btn btn--ghost btn--block" :loading="loading" @click="saveToken">记住令牌</button>
        </view>
        <text class="hint">未设置令牌时服务端管理面整体 404，读不到任何信息——这是设计，不是故障。</text>
      </view>

      <!-- ---------- 落点档案 ---------- -->
      <view v-if="status" class="section">
        <view class="sec-head">
          <view class="sec-head-l">
            <text class="eyebrow">CURRENT</text>
            <text class="sec-title">{{ status.target === 'cloudbase' ? 'CloudBase 云 PG（备援）' : '云服务器本机 PG（权威）' }}</text>
          </view>
        </view>
        <view class="row"><text class="k">驱动</text><text class="v mono">{{ status.driver }}</text></view>
        <view class="row"><text class="k">实际主机</text><text class="v mono">{{ status.host }}</text></view>
        <view class="row"><text class="k">连接串来源</text><text class="v mono">{{ status.source }}</text></view>
        <view class="row row--last">
          <text class="k">云 PG 已配置</text>
          <text class="v mono" :class="{ warn: !status.available.cloudbase.configured }">
            {{ status.available.cloudbase.configured ? status.available.cloudbase.host : '未配置连接串' }}
          </text>
        </view>
      </view>

      <!-- ---------- 切换落点 ---------- -->
      <view v-if="status" class="section">
        <view class="sec-head">
          <view class="sec-head-l">
            <text class="eyebrow">SWITCH</text>
            <text class="sec-title">切换落点</text>
          </view>
        </view>
        <text class="hint">热切换，不重启进程。切换前会先建连接并 ping 验证，连不通就不切，旧库继续服务。</text>
        <view class="btn-row">
          <button class="btn btn--deep btn--block" :loading="loading" @click="switchTo('cloudbase')">切到云 PG（备援）</button>
          <button class="btn btn--ghost btn--block" :loading="loading" @click="switchTo('server')">切到服务器 PG（权威）</button>
        </view>
      </view>

      <!-- ---------- 超时订单扫描 ---------- -->
      <view v-if="status" class="section">
        <view class="sec-head">
          <view class="sec-head-l">
            <text class="eyebrow">ORDERS</text>
            <text class="sec-title">超时订单扫描</text>
          </view>
        </view>
        <text class="hint">待支付订单超过 TTL 会被取消并归还库存；这里可以手动触发一次。</text>
        <button class="btn btn--ghost btn--block" :loading="loading" @click="sweep">立刻扫描</button>
        <view v-if="sweepResult" class="row row--last sweep-row">
          <text class="k">本次取消</text>
          <text class="v mono">{{ sweepResult.count }} 单 · TTL {{ sweepResult.ttlMinutes }} 分钟</text>
        </view>
      </view>

      <text v-if="error" class="err">{{ error }}</text>
      <text v-if="notice" class="notice">{{ notice }}</text>

      <text class="foot mono">ADMIN SURFACE · 仅内部使用</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { adminApi, ApiError, readAdminToken, writeAdminToken } from '../../api/client';

type DbStatus = Awaited<ReturnType<typeof adminApi.db>>;
type SweepResult = { ttlMinutes: number; cancelled: string[]; count: number };

const token = ref('');
const status = ref<DbStatus | null>(null);
const sweepResult = ref<SweepResult | null>(null);
const loading = ref(false);
const error = ref('');
const notice = ref('');

const currentLabel = computed(() => (status.value?.target === 'cloudbase' ? 'CLOUDBASE' : 'SERVER'));
const backupLabel = computed(() =>
  status.value?.available.cloudbase.configured ? 'READY' : 'NONE',
);
const sweepCount = computed(() => (sweepResult.value ? String(sweepResult.value.count) : '—'));

function saveToken(): void {
  writeAdminToken(token.value.trim());
  notice.value = '令牌已保存在本机存储';
}

async function refresh(): Promise<void> {
  if (!token.value.trim()) {
    error.value = '先填入管理令牌';
    return;
  }
  loading.value = true;
  error.value = '';
  notice.value = '';
  try {
    status.value = await adminApi.db(token.value.trim());
  } catch (e) {
    error.value = e instanceof ApiError ? `读取失败：${e.message}（${e.status}）` : '读取失败';
    status.value = null;
  } finally {
    loading.value = false;
  }
}

async function switchTo(target: 'cloudbase' | 'server'): Promise<void> {
  loading.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await adminApi.switchDb(token.value.trim(), target);
    status.value = result;
    notice.value = `已切到 ${result.target}（${result.host}）`;
  } catch (e) {
    error.value = e instanceof ApiError ? `切换失败：${e.message}` : '切换失败';
  } finally {
    loading.value = false;
  }
}

async function sweep(): Promise<void> {
  loading.value = true;
  error.value = '';
  notice.value = '';
  try {
    sweepResult.value = await adminApi.sweepOrders(token.value.trim());
    notice.value = `扫描完成：取消 ${sweepResult.value.count} 单`;
  } catch (e) {
    error.value = e instanceof ApiError ? `扫描失败：${e.message}` : '扫描失败';
  } finally {
    loading.value = false;
  }
}

onLoad(() => {
  token.value = readAdminToken();
  if (token.value) void refresh();
});
</script>

<style scoped lang="scss">
.page {
  box-sizing: border-box;
  overflow-x: hidden;
  min-height: 100vh;
  background: $paper;
  padding: 0 $sp-3 calc($sp-8 + env(safe-area-inset-bottom));
}

/* ---------- 深场页头：发丝线收边，直接切纸面 ---------- */
.head {
  box-sizing: border-box;
  padding: $sp-5 $sp-4 $sp-4;
  background:
    radial-gradient(120% 90% at 88% -14%, rgba(15, 157, 143, 0.26), rgba(15, 157, 143, 0) 58%),
    linear-gradient(158deg, #0b0f0e 0%, #152622 62%, #17322c 120%);
  border-bottom: 1rpx solid $on-deep-line;
}

.head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.head-text {
  flex: 1;
  min-width: 0;
}

.head-eyebrow {
  display: block;
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  text-transform: uppercase;
  color: $on-deep-2;
}

.head-title {
  display: block;
  margin-top: 10rpx;
  font-family: $font-display;
  font-size: $fs-h1;
  font-weight: 800;
  line-height: $lh-tight;
  letter-spacing: $ls-tight;
  color: $on-deep;
}

.head-sub {
  display: block;
  word-break: break-all;
  margin-top: 10rpx;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $on-deep-2;
}

/* 状态 chip：本页唯一使用 $r-pill 的控件 */
.head-chip {
  flex-shrink: 0;
  margin-left: $sp-3;
  padding: 8rpx 18rpx;
  border: 1rpx solid $on-deep-line;
  border-radius: $r-pill;
  background: rgba(244, 244, 241, 0.08);
}

.head-chip--off .head-chip-text {
  color: $amber-on-deep;
}

.head-chip-text {
  font-size: $fs-micro;
  letter-spacing: 1.5rpx;
  color: $on-deep-2;
}

.body {
  padding-top: $sp-4;
}

/* ---------- 数字档案：2×2 栅格 ---------- */
.metrics {
  display: flex;
  flex-wrap: wrap;
  border-top: 1rpx solid $paper-2;
  border-left: 1rpx solid $paper-2;
}

.metric {
  width: 50%;
  box-sizing: border-box;
  padding: $sp-3;
  border-right: 1rpx solid $paper-2;
  border-bottom: 1rpx solid $paper-2;
}

.metric-k {
  display: block;
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  text-transform: uppercase;
  color: $ink-3;
}

.metric-v {
  display: block;
  margin-top: 12rpx;
  font-size: $fs-h2;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: 0;
  color: $ink;
  word-break: break-all;
}

.metric-v--warn {
  color: $amber;
}

/* ---------- 分节：发丝线分隔，不描卡片 ---------- */
.section {
  margin-top: $sp-6;
  padding-top: $sp-4;
  border-top: 1rpx solid $paper-2;
}

.sec-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: $sp-3;
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

.field {
  margin-top: $sp-2;
}

.btn-row {
  display: flex;
  gap: $sp-2;
  margin-top: $sp-3;
}

.btn {
  min-height: 88rpx;
  border-radius: $r-control;
  font-weight: 800;
}

.hint {
  display: block;
  margin-top: $sp-3;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-3;
}

/* ---------- 档案行 ---------- */
.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20rpx 0;
  border-bottom: 1rpx solid $paper-2;
}

.row--last {
  border-bottom: none;
  padding-bottom: 0;
}

.k {
  flex-shrink: 0;
  margin-right: $sp-3;
  font-size: $fs-micro;
  color: $ink-3;
}

.v {
  flex: 1;
  min-width: 0;
  font-size: $fs-meta;
  line-height: 1.55;
  color: $ink;
  text-align: right;
  word-break: break-all;
}

.warn {
  color: $amber;
}

.sweep-row {
  margin-top: $sp-3;
}

.err {
  display: block;
  margin-top: $sp-4;
  font-size: $fs-meta;
  color: $signal;
}

.notice {
  display: block;
  margin-top: $sp-3;
  font-size: $fs-meta;
  color: $brand-deep;
}

.foot {
  display: block;
  margin-top: $sp-6;
  text-align: center;
  font-size: $fs-micro;
  letter-spacing: 2rpx;
  color: $ink-4;
}
</style>
