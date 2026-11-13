<template>
  <view class="page">
    <mx-bar />
    <view class="head">
      <view class="head-row">
        <view class="head-mark mono">DB</view>
        <view class="head-text">
          <text class="head-title">数据库落点</text>
          <text class="head-sub mono">云服务器本机 PG = 权威 · CloudBase 云 PG = 可选备援</text>
        </view>
      </view>
    </view>

    <view class="sheet block">
      <text class="eyebrow">ADMIN TOKEN</text>
      <text class="block-title">管理令牌</text>
      <input
        v-model="token"
        class="input mono"
        placeholder="x-admin-token（服务端 ADMIN_TOKEN）"
        password
        @confirm="saveToken"
      />
      <view class="btn-row">
        <button class="btn btn--primary" :loading="loading" @click="refresh">读取落点</button>
        <button class="btn" @click="saveToken">记住令牌</button>
      </view>
      <text class="hint">未设置令牌时服务端管理面整体 404，读不到任何信息——这是设计，不是故障。</text>
    </view>

    <view v-if="status" class="sheet block">
      <text class="eyebrow">CURRENT</text>
      <text class="block-title">{{ status.target === 'cloudbase' ? 'CloudBase 云 PG（备援）' : '云服务器本机 PG（权威）' }}</text>
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

    <view v-if="status" class="sheet block">
      <text class="eyebrow">SWITCH</text>
      <text class="block-title">切换落点</text>
      <text class="hint">热切换，不重启进程。切换前会先建连接并 ping 验证，连不通就不切，旧库继续服务。</text>
      <view class="btn-row">
        <button class="btn btn--primary" :loading="loading" @click="switchTo('cloudbase')">切到云 PG（备援）</button>
        <button class="btn" :loading="loading" @click="switchTo('server')">切到服务器 PG（权威）</button>
      </view>
    </view>

    <view v-if="status" class="sheet block">
      <text class="eyebrow">ORDERS</text>
      <text class="block-title">超时订单扫描</text>
      <text class="hint">待支付订单超过 TTL 会被取消并归还库存；这里可以手动触发一次。</text>
      <button class="btn" :loading="loading" @click="sweep">立刻扫描</button>
      <view v-if="sweepResult" class="row row--last">
        <text class="k">本次取消</text>
        <text class="v mono">{{ sweepResult.count }} 单 · TTL {{ sweepResult.ttlMinutes }} 分钟</text>
      </view>
    </view>

    <text v-if="error" class="err">{{ error }}</text>
    <text v-if="notice" class="notice">{{ notice }}</text>

    <text class="foot mono">ADMIN SURFACE · 仅内部使用</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
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
/* 本页刻意不依赖全局 SCSS 令牌：色值/尺寸写死，保证任何分支都能独立编译。
   尺寸统一用 rpx，避免 rem 在不同端被缩成 10px 级小字，按钮也被压扁。 */
.page {
  box-sizing: border-box;
  overflow-x: hidden;
  min-height: 100vh;
  background: #f2f5f3;
  padding: 24rpx 24rpx calc(64rpx + env(safe-area-inset-bottom));
}

.head {
  box-sizing: border-box;
  padding: 40rpx;
  background:
    radial-gradient(120% 90% at 88% -14%, rgba(15, 157, 143, 0.26), rgba(15, 157, 143, 0) 58%),
    linear-gradient(158deg, #0b0f0e 0%, #152622 62%, #17322c 120%);
  border-radius: 32rpx;
}

.head-row {
  display: flex;
  align-items: center;
}

.head-mark {
  width: 88rpx;
  height: 88rpx;
  margin-right: 24rpx;
  border: 1rpx solid rgba(244, 244, 241, 0.24);
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
  color: #f4f8f6;
}

.head-text {
  flex: 1;
  min-width: 0;
}

.head-title {
  display: block;
  font-size: 40rpx;
  font-weight: 700;
  line-height: 1.25;
  color: #f6faf8;
}

.head-sub {
  display: block;
  word-break: break-all;
  margin-top: 8rpx;
  font-size: 26rpx;
  line-height: 1.5;
  color: rgba(244, 244, 241, 0.62);
}

.block {
  box-sizing: border-box;
  margin-top: 24rpx;
  padding: 32rpx;
  background: #ffffff;
  border: 1rpx solid #dbe3df;
  border-radius: 24rpx;
  box-shadow: 0 8rpx 24rpx rgba(13, 25, 23, 0.06);
}

.block-title {
  display: block;
  margin-top: 12rpx;
  font-size: 32rpx;
  font-weight: 700;
  line-height: 1.3;
  color: #0d1917;
}

.input {
  box-sizing: border-box;
  width: 100%;
  min-height: 84rpx;
  margin-top: 24rpx;
  padding: 22rpx 24rpx;
  background: #e8edeb;
  border-radius: 16rpx;
  font-size: 26rpx;
  color: #0d1917;
}

.btn-row {
  display: flex;
  margin-top: 24rpx;
  gap: 16rpx;
}

.btn {
  flex: 1;
  min-width: 0;
  min-height: 84rpx;
  margin: 0;
  padding: 18rpx 16rpx;
  border-radius: 16rpx;
  border: 1rpx solid #dbe3df;
  background: transparent;
  font-size: 26rpx;
  line-height: 1.3;
  color: #33443f;
}

.btn--primary {
  background: #0d1917;
  border-color: #0d1917;
  color: #f6faf8;
}

.hint {
  display: block;
  margin-top: 24rpx;
  font-size: 26rpx;
  line-height: 1.65;
  color: #697b76;
}

.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #e8edeb;
}

.row--last {
  border-bottom: none;
  padding-bottom: 0;
}

.k {
  flex-shrink: 0;
  margin-right: 24rpx;
  font-size: 26rpx;
  color: #697b76;
}

.v {
  flex: 1;
  min-width: 0;
  font-size: 26rpx;
  line-height: 1.55;
  color: #0d1917;
  text-align: right;
  word-break: break-all;
}

.warn {
  color: #a9761a;
}

.err {
  display: block;
  margin-top: 24rpx;
  font-size: 26rpx;
  color: #b33a2b;
}

.notice {
  display: block;
  margin-top: 16rpx;
  font-size: 26rpx;
  color: #0a7a70;
}

.foot {
  display: block;
  margin-top: 48rpx;
  text-align: center;
  font-size: 26rpx;
  letter-spacing: 2rpx;
  color: #97a5a1;
}
</style>