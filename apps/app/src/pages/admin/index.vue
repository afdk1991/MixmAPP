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
/* 本页刻意不依赖全局 SCSS 令牌：色值/尺寸写死，保证任何分支都能独立编译 */
.page {
  box-sizing: border-box;
  overflow-x: hidden;
  min-height: 100vh;
  background: #f2f5f3;
  padding: 1rem 0.75rem 2rem;
}

.head {
  box-sizing: border-box;
  padding: 1.25rem;
  background:
    radial-gradient(120% 90% at 88% -14%, rgba(15, 157, 143, 0.26), rgba(15, 157, 143, 0) 58%),
    linear-gradient(158deg, #08110f 0%, #0e2925 62%, #14453c 120%);
  border-radius: 1.75rem;
}

.head-row {
  display: flex;
  align-items: center;
}

.head-mark {
  width: 2.75rem;
  height: 2.75rem;
  margin-right: 0.75rem;
  border: 1px solid rgba(242, 245, 243, 0.24);
  border-radius: 0.625rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.0625rem;
  color: #f4f8f6;
}

.head-text {
  flex: 1;
  min-width: 0;
}

.head-title {
  display: block;
  font-size: 1.3125rem;
  font-weight: 600;
  color: #f6faf8;
}

.head-sub {
  display: block;
  word-break: break-all;
  margin-top: 0.25rem;
  font-size: 0.625rem;
  color: rgba(242, 245, 243, 0.6);
}

.block {
  box-sizing: border-box;
  margin-top: 0.75rem;
  padding: 1rem;
  background: #ffffff;
  border: 1px solid #dbe3df;
  border-radius: 1rem;
  box-shadow: 0 8px 24px rgba(13, 25, 23, 0.06);
}

.block-title {
  display: block;
  margin-top: 0.375rem;
  font-size: 1.125rem;
  font-weight: 600;
  color: #0d1917;
}

.input {
  box-sizing: border-box;
  width: 100%;
  margin-top: 0.75rem;
  padding: 0.625rem 0.75rem;
  background: #e8edeb;
  border-radius: 1rem;
  font-size: 0.75rem;
  color: #0d1917;
}

.btn-row {
  display: flex;
  margin-top: 0.75rem;
  gap: 0.5rem;
}

.btn {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0.6875rem 0;
  border-radius: 1rem;
  border: 1px solid #dbe3df;
  background: transparent;
  font-size: 0.75rem;
  color: #33443f;
}

.btn--primary {
  background: #0f9d8f;
  border-color: #0f9d8f;
  color: #f6faf8;
}

.hint {
  display: block;
  margin-top: 0.75rem;
  font-size: 0.6875rem;
  line-height: 1.6;
  color: #697b76;
}

.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 0.625rem 0;
  border-bottom: 1px solid #e8edeb;
}

.row--last {
  border-bottom: none;
  padding-bottom: 0;
}

.k {
  flex-shrink: 0;
  margin-right: 0.75rem;
  font-size: 0.75rem;
  color: #697b76;
}

.v {
  flex: 1;
  font-size: 0.75rem;
  line-height: 1.5;
  color: #0d1917;
  text-align: right;
  word-break: break-all;
}

.warn {
  color: #a9761a;
}

.err {
  display: block;
  margin-top: 0.75rem;
  font-size: 0.75rem;
  color: #b33a2b;
}

.notice {
  display: block;
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: #0a7a70;
}

.foot {
  display: block;
  margin-top: 1.5rem;
  text-align: center;
  font-size: 0.625rem;
  letter-spacing: 0.0625rem;
  color: #97a5a1;
}
</style>