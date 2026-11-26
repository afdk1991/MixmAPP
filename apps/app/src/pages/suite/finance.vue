<template>
  <suite-detail-shell :content="content" @need-login="onShellNeedLogin">
    <!--
      金融领域动态面板：记账台账 + 预算校验 + 价税分离 + 结清。
      正文是静态内容包，渲染不依赖任何请求；这里的台账异步加载，失败也不阻断正文。
    -->
    <template #dynamic>
      <view class="fin">
        <!-- 指标条：在账金额合计 / 已结清金额 / 待结清笔数 / 预算使用率（服务端有数据才给） -->
        <view v-if="metrics.length" class="fin-metrics">
          <view v-for="m in metrics" :key="m.label" class="fin-metric">
            <text class="fin-metric__value mono">{{ m.value }}</text>
            <text class="fin-metric__label">{{ m.label }}</text>
            <text v-if="m.hint" class="fin-metric__hint">{{ m.hint }}</text>
          </view>
        </view>

        <!-- 记一笔：账户与方向先填好，金额在弹窗里输入 -->
        <view class="sheet fin-compose">
          <text class="sec-title fin-compose__title">记一笔</text>
          <text class="hint fin-compose__hint">
            填好方向、分类与账户，金额在弹窗里输入；同一笔重复提交只记一次，不会重复入账。
          </text>

          <view class="fin-dir">
            <view
              class="fin-dir__item"
              :class="{ 'fin-dir__item--on': direction === 'out' }"
              hover-class="is-press"
              role="button"
              aria-label="方向选支出"
              @tap="direction = 'out'"
            >
              <text>支出</text>
            </view>
            <view
              class="fin-dir__item"
              :class="{ 'fin-dir__item--on': direction === 'in' }"
              hover-class="is-press"
              role="button"
              aria-label="方向选收入"
              @tap="direction = 'in'"
            >
              <text>收入</text>
            </view>
          </view>

          <input
            v-model="category"
            class="field fin-compose__field"
            placeholder="收支分类，例如 餐饮"
            placeholder-class="field-ph"
          />
          <input
            v-model="account"
            class="field fin-compose__field"
            placeholder="资金账户，例如 招行储蓄卡"
            placeholder-class="field-ph"
          />
          <input
            v-model="budgetInput"
            class="field fin-compose__field"
            placeholder="预算额度（元，可留空；累加即汇总预算）"
            placeholder-class="field-ph"
          />

          <view
            class="btn btn--primary fin-compose__btn"
            :class="{ 'btn--disabled': busy === 'record' }"
            hover-class="is-press"
            role="button"
            aria-label="记一笔"
            @tap="submitRecord"
          >
            <text>{{ busy === 'record' ? '记账中' : '记一笔' }}</text>
          </view>
        </view>

        <!-- 全局动作：校验预算 -->
        <view class="fin-ops">
          <view
            class="btn btn--sm btn--ghost fin-ops__btn"
            :class="{ 'btn--disabled': busy === 'budget' }"
            hover-class="is-press"
            role="button"
            aria-label="校验预算"
            @tap="submitBudgetCheck"
          >
            <text>{{ busy === 'budget' ? '校验中' : '校验预算' }}</text>
          </view>
          <text class="micro fin-ops__hint">预算按本领域全部条目金额合计，超出会直接写明超出多少</text>
        </view>

        <!-- 三态：加载中 / 出错可重试 / 空态给下一步 -->
        <mx-state v-if="loading" variant="loading" title="正在读取记账台账…" />
        <mx-state
          v-else-if="error"
          variant="error"
          title="台账没打开"
          :text="error"
          action-text="重新加载"
          @action="load"
        />
        <mx-state
          v-else-if="items.length === 0"
          variant="empty"
          title="还没有记账记录"
          text="先在上面记一笔：选好方向，填上分类与账户，在弹窗里输入金额，这笔账就会出现在这里；结清后可逐笔核对。"
        >
          <view
            class="btn btn--primary btn--sm fin-state-btn"
            hover-class="is-press"
            role="button"
            aria-label="记第一笔"
            @tap="submitRecord"
          >
            <text>记第一笔</text>
          </view>
        </mx-state>

        <view v-else class="fin-items">
          <view v-for="item in items" :key="item.id" class="sheet fin-item">
            <view class="fin-item__head">
              <text class="fin-item__title">{{ item.title }}</text>
              <text class="tag fin-item__stage">{{ item.stageLabel }}</text>
            </view>

            <text class="fin-item__amount mono">{{ amountText(item) }}</text>
            <text class="fin-item__summary">{{ item.summary }}</text>

            <view v-if="item.meta && item.meta.length" class="fin-item__meta">
              <view v-for="m in item.meta" :key="m.label" class="fin-item__meta-row">
                <text class="fin-item__meta-label">{{ m.label }}</text>
                <text class="fin-item__meta-value">{{ m.value }}</text>
              </view>
            </view>

            <view class="fin-item__acts">
              <view
                class="btn btn--sm btn--ghost fin-act"
                :class="{ 'btn--disabled': busy === `split:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`对${item.title}做价税分离`"
                @tap="submitSplitTax(item)"
              >
                <text>价税分离</text>
              </view>
              <view
                v-if="item.stage !== 'settled'"
                class="btn btn--sm btn--primary fin-act"
                :class="{ 'btn--disabled': busy === `settle:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`结清${item.title}`"
                @tap="submitSettle(item)"
              >
                <text>{{ busy === `settle:${item.id}` ? '结清中' : '结清' }}</text>
              </view>
              <view
                v-else
                class="btn btn--sm btn--quiet fin-act"
                hover-class="is-press"
                role="button"
                :aria-label="`${item.title}已结清`"
                @tap="submitSettle(item)"
              >
                <text>已结清</text>
              </view>
            </view>
          </view>
        </view>

        <text class="micro fin-foot">记账条目、进度与结清事件都按登录账号保存在服务端台账里</text>
      </view>
    </template>
  </suite-detail-shell>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { SuiteActionInput, SuiteDomainItemDto } from '@mixmapp/contracts';
import { suiteApi } from '../../api/suite';
import MxState from '../../components/mx-state/mx-state.vue';
import SuiteDetailShell from '../../components/suite/suite-detail-shell.vue';
import { getSuiteContent } from '../../content/suite';
import { goTo } from '../../navigation';
import { ROUTES } from '../../routes';
import { applySuiteSeo } from '../../site-seo';
import { isLoggedIn } from '../../stores/session';

/**
 * 金融领域页。
 *
 * 正文与清单来自构建期内联的内容包（首屏零请求），
 * 动态面板走 /suite/domains/finance/items 与 /suite/domains/finance/stats：
 * 记账台账、预算校验、价税分离与结清对账。
 */
const content = getSuiteContent('finance');

type Metric = { label: string; value: string; hint?: string };

const items = ref<SuiteDomainItemDto[]>([]);
const metrics = ref<Metric[]>([]);
const loading = ref(true);
const error = ref('');
/** 正在执行的动作标识（按条目区分），用于按钮态与防连点 */
const busy = ref('');

/** 记一笔表单 */
const direction = ref<'in' | 'out'>('out');
const category = ref('');
const account = ref('');
const budgetInput = ref('');
/** 幂等键：同一次提交的多次点击只记一笔 */
const recordKey = ref('');

/** 登录引导：未登录点动作时先跳登录页，并带回本页 redirect。 */
function onNeedLogin(): void {
  goTo(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.suiteFinance)}`);
}

/**
 * 外壳（互动条）请求登录时由外壳自己跳转，这里不再跳一次，
 * 避免同一个页面被压入两次登录页。
 */
function onShellNeedLogin(): void {
  /* 外壳已处理跳转 */
}

function toast(title: string): void {
  uni.showToast({ title, icon: 'none' });
}

/** 分 → 元文案（两位小数），供条目金额展示。 */
function yuan(fen: number): string {
  return (fen / 100).toFixed(2);
}

/** 条目金额文案：方向决定正负号，金额单位标「元」。 */
function amountText(item: SuiteDomainItemDto): string {
  const amount = yuan(item.amountFen ?? 0);
  const dir = item.payload['direction'];
  if (dir === 'in') return `+${amount} 元`;
  if (dir === 'out') return `-${amount} 元`;
  return `${amount} 元`;
}

/** 拉记账台账与领域指标；失败只影响这一块，不阻断静态正文。 */
async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [list, stats] = await Promise.all([suiteApi.items('finance'), suiteApi.stats('finance')]);
    items.value = Array.isArray(list) ? list : [];
    metrics.value = Array.isArray(stats?.metrics) ? stats.metrics : [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : '读取失败，请稍后再试';
  } finally {
    loading.value = false;
  }
}

/** 动作之后的静默刷新：不重置 loading，避免列表整块闪回骨架。 */
async function refresh(): Promise<void> {
  try {
    const [list, stats] = await Promise.all([suiteApi.items('finance'), suiteApi.stats('finance')]);
    items.value = Array.isArray(list) ? list : [];
    metrics.value = Array.isArray(stats?.metrics) ? stats.metrics : [];
  } catch {
    // 动作已经成功，刷新失败不再打扰用户，下一次进入页面会重新拉。
  }
}

/**
 * 统一执行领域动作：未登录不发写请求，成功后用服务端返回的 message 轻提示，
 * 并刷新列表与统计。
 */
async function run(input: SuiteActionInput, key: string): Promise<boolean> {
  if (!isLoggedIn()) {
    onNeedLogin();
    return false;
  }
  if (busy.value === key) return false;
  busy.value = key;
  try {
    const res = await suiteApi.act('finance', input);
    toast(res.message || (res.changed ? '已完成' : '没有变化'));
    if (res.ok) await refresh();
    return res.ok;
  } catch (e) {
    toast(e instanceof Error ? e.message : '操作没成功，稍后再试一次');
    return false;
  } finally {
    busy.value = '';
  }
}

/** 元文本 → 整数分；非法输入返回 null。 */
function parseYuan(raw: string): number | null {
  const cleaned = raw.replace(/[\s，,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/** 税率文本 → 小数；支持 0.13 或 13% 两种写法。 */
function parseRate(raw: string): number | null {
  const cleaned = raw.trim();
  if (cleaned === '') return null;
  const isPercent = cleaned.endsWith('%');
  const value = Number(isPercent ? cleaned.slice(0, -1) : cleaned);
  if (!Number.isFinite(value)) return null;
  const rate = isPercent ? value / 100 : value;
  if (rate < 0 || rate > 1) return null;
  return rate;
}

/** 生成幂等键：同一次提交的重试共用一个键，避免重复入账。 */
function newRecordKey(): string {
  return `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 记一笔：金额在弹窗里输入，其余字段取自上方表单。 */
function submitRecord(): void {
  if (!isLoggedIn()) {
    onNeedLogin();
    return;
  }
  if (!recordKey.value) recordKey.value = newRecordKey();
  uni.showModal({
    title: '记一笔',
    content: '输入金额（元）',
    editable: true,
    placeholderText: '例如 128.50',
    confirmText: '记账',
    success: (res) => {
      if (!res.confirm) return;
      const amountFen = parseYuan((res.content ?? '').trim());
      if (amountFen === null) {
        toast('金额需要是大于 0 的数字，最多两位小数');
        return;
      }
      const budgetFen = parseYuan(budgetInput.value);
      void run(
        {
          action: 'record',
          payload: {
            amountFen,
            category: category.value.trim(),
            account: account.value.trim(),
            direction: direction.value,
            ...(budgetFen ? { budgetFen } : {}),
            idempotencyKey: recordKey.value,
          },
        },
        'record',
      ).then((ok) => {
        if (ok) recordKey.value = '';
      });
    },
  });
}

/** 价税分离：先收含税金额，再收税率。 */
function submitSplitTax(item: SuiteDomainItemDto): void {
  if (!isLoggedIn()) {
    onNeedLogin();
    return;
  }
  uni.showModal({
    title: '价税分离 · 含税金额',
    content: '输入含税金额（元）',
    editable: true,
    placeholderText: '例如 113.00',
    confirmText: '下一步',
    success: (res) => {
      if (!res.confirm) return;
      const amountFen = parseYuan((res.content ?? '').trim());
      if (amountFen === null) {
        toast('含税金额需要是大于 0 的数字，最多两位小数');
        return;
      }
      uni.showModal({
        title: '价税分离 · 税率',
        content: '输入税率小数，0.13 表示 13%',
        editable: true,
        placeholderText: '例如 0.13',
        confirmText: '分离',
        success: (rateRes) => {
          if (!rateRes.confirm) return;
          const rate = parseRate((rateRes.content ?? '').trim());
          if (rate === null) {
            toast('税率需要是 0 到 1 之间的小数，例如 0.13');
            return;
          }
          void run(
            { action: 'split_tax', entryId: item.id, payload: { amount: amountFen, rate } },
            `split:${item.id}`,
          );
        },
      });
    },
  });
}

/** 结清：条目推进到已结清，并留进度与结清事件。 */
function submitSettle(item: SuiteDomainItemDto): void {
  void run({ action: 'settle', entryId: item.id }, `settle:${item.id}`);
}

/** 校验预算：输入预算总额，换回在账金额、剩余额度或超出金额。 */
function submitBudgetCheck(): void {
  if (!isLoggedIn()) {
    onNeedLogin();
    return;
  }
  uni.showModal({
    title: '校验预算',
    content: '输入本周期预算总额（元）',
    editable: true,
    placeholderText: '例如 5000.00',
    confirmText: '校验',
    success: (res) => {
      if (!res.confirm) return;
      const budgetFen = parseYuan((res.content ?? '').trim());
      if (budgetFen === null) {
        toast('预算总额需要是大于 0 的数字，最多两位小数');
        return;
      }
      void run({ action: 'budget_check', payload: { budgetFen } }, 'budget');
    },
  });
}

onMounted(() => {
  void load();
});

applySuiteSeo({
  title: '金融 · MixmAPP 业务套件',
  description: '预算、记账与资产负债三张表，看清钱去了哪里。',
  path: ROUTES.suiteFinance,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: '金融 · MixmAPP 业务套件',
    description: '预算、记账与资产负债三张表，看清钱去了哪里。',
    inLanguage: 'zh-CN',
  },
});
</script>

<style scoped lang="scss">
.fin {
  margin: 0 $sp-4 $sp-4;
  display: flex;
  flex-direction: column;
  gap: $sp-3;
}

/* ---------- 指标条 ---------- */
.fin-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: $sp-2;
}

.fin-metric {
  flex: 1 1 30%;
  min-width: 200rpx;
  padding: $sp-3;
  border-radius: $r-card;
  background: $paper-2;
}

.fin-metric__value {
  display: block;
  font-size: $fs-h3;
  font-weight: 800;
  color: $acc-5;
}

.fin-metric__label {
  display: block;
  margin-top: 6rpx;
  font-size: $fs-micro;
  color: $ink-3;
}

.fin-metric__hint {
  display: block;
  margin-top: 4rpx;
  font-size: $fs-xs;
  line-height: $lh-snug;
  color: $ink-4;
}

/* ---------- 记一笔 ---------- */
.fin-compose {
  padding: $sp-4;
}

.fin-compose__title {
  font-size: $fs-h3;
}

.fin-compose__hint {
  margin: 8rpx 0 $sp-3;
}

.fin-dir {
  display: flex;
  gap: 12rpx;
  margin-bottom: $sp-3;
}

.fin-dir__item {
  flex: 1;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: $r-control;
  border: 1rpx solid $paper-3;
  background: $shell;
  font-size: $fs-meta;
  color: $ink-2;
}

.fin-dir__item--on {
  background: $brand-soft;
  border-color: transparent;
  color: $brand-deep;
  font-weight: 600;
}

.fin-compose__field {
  margin-top: $sp-2;
}

.fin-compose__btn {
  margin-top: $sp-3;
  width: 100%;
}

/* ---------- 全局动作 ---------- */
.fin-ops {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: $sp-2;
  padding: 0 $sp-1;
}

.fin-ops__btn {
  flex: 0 0 auto;
}

.fin-ops__hint {
  flex: 1;
  min-width: 200rpx;
}

/* ---------- 台账 ---------- */
.fin-items {
  display: flex;
  flex-direction: column;
  gap: $sp-3;
}

.fin-item {
  padding: $sp-4;
}

.fin-item__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $sp-2;
}

.fin-item__title {
  flex: 1;
  min-width: 0;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  color: $ink;
}

.fin-item__stage {
  flex: 0 0 auto;
}

.fin-item__amount {
  display: block;
  margin-top: 10rpx;
  font-size: $fs-h2;
  font-weight: 800;
  color: $acc-5;
}

.fin-item__summary {
  display: block;
  margin-top: 8rpx;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

.fin-item__meta {
  margin-top: $sp-3;
  padding: $sp-3;
  border-radius: $r-control;
  background: $paper-2;
}

.fin-item__meta-row {
  display: flex;
  justify-content: space-between;
  gap: $sp-3;
  padding: 4rpx 0;
}

.fin-item__meta-label {
  flex: 0 0 auto;
  font-family: $font-mono;
  font-size: $fs-micro;
  color: $ink-4;
}

.fin-item__meta-value {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: $fs-micro;
  color: $ink-2;
}

.fin-item__acts {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: $sp-3;
}

.fin-act {
  flex: 0 0 auto;
}

.fin-state-btn {
  margin-top: $sp-3;
}

.fin-foot {
  margin-top: $sp-2;
  text-align: center;
}
</style>
