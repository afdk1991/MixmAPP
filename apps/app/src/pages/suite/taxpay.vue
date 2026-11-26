<template>
  <suite-detail-shell :content="content" @need-login="onNeedLogin">
    <!--
      财税支付动态面板：发票登记 + 价税分离试算 + 内部核验 + 对账记录。
      不发起任何支付、转账或申报；「已对账」只表示内部核对完成。
    -->
    <template #dynamic>
      <view class="panel">
        <view class="panel__head">
          <text class="eyebrow">票据台账</text>
          <text class="panel__lead">
            登记发票要素、做价税分离试算、记录内部核验与对账状态。
            本面板不生成申报表、不发起支付，发票真伪以官方查验平台结论为准。
          </text>
          <view class="panel__ops">
            <view
              class="btn btn--sm btn--ghost"
              hover-class="is-press"
              role="button"
              aria-label="登记一张发票"
              @tap="createInvoice"
            >
              <text>登记发票</text>
            </view>
            <view
              class="btn btn--sm btn--ghost"
              hover-class="is-press"
              role="button"
              aria-label="价税分离试算"
              @tap="splitTax"
            >
              <text>价税分离试算</text>
            </view>
          </view>
        </view>

        <!-- 指标：待核验 / 待对账 / 票面合计 / 近七天对账 -->
        <view v-if="metrics.length" class="metrics">
          <view v-for="m in metrics" :key="m.label" class="metric">
            <text class="metric__value mono">{{ m.value }}</text>
            <text class="metric__label">{{ m.label }}</text>
            <text v-if="m.hint" class="metric__hint">{{ m.hint }}</text>
          </view>
        </view>

        <!-- 三态 -->
        <mx-state v-if="loading" variant="loading" title="正在读取票据台账…" />
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
          title="还没有票据"
          text="先登记一张发票：填上发票号、价税合计与税率，再按内部流程做核验与对账。"
        >
          <view
            class="btn btn--primary btn--sm panel__cta"
            hover-class="is-press"
            role="button"
            aria-label="登记第一张发票"
            @tap="createInvoice"
          >
            <text>登记第一张</text>
          </view>
        </mx-state>

        <view v-else class="items">
          <view v-for="item in items" :key="item.id" class="sheet item">
            <view class="item__head">
              <text class="item__title">{{ item.title }}</text>
              <text class="tag item__stage">{{ item.stageLabel }}</text>
            </view>

            <text class="item__summary">{{ item.summary }}</text>

            <view v-if="item.meta.length" class="item__meta">
              <view v-for="m in item.meta" :key="m.label" class="item__meta-row">
                <text class="item__meta-label">{{ m.label }}</text>
                <text class="item__meta-value">{{ m.value }}</text>
              </view>
            </view>

            <view class="item__acts">
              <view
                v-if="item.stage === 'recorded'"
                class="btn btn--sm btn--primary"
                :class="{ 'btn--disabled': busy === `verify:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`给${item.title}登记内部核验`"
                @tap="verify(item)"
              >
                <text>内部核验</text>
              </view>
              <view
                v-if="item.stage === 'verified'"
                class="btn btn--sm btn--primary"
                :class="{ 'btn--disabled': busy === `reconcile:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`给${item.title}登记对账`"
                @tap="reconcile(item)"
              >
                <text>登记对账</text>
              </view>
              <text v-if="item.stage === 'reconciled'" class="micro item__done">已对账，记录只读</text>
            </view>
          </view>
        </view>

        <view class="disclaimer">
          <text class="disclaimer__text">
            边界说明：本面板不提供纳税申报、税额核定与代扣代缴，也不发起支付或转账。
            发票查验、银行流水、支付账单与申报通道尚未接入，相关能力标注为待接入。
          </text>
        </view>
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
 * 财税支付领域页。
 *
 * 动态面板对接服务端 taxpay 模块：invoice（发票登记）、split_tax（价税分离试算）、
 * verify（内部核验）与 reconcile（内部对账）。模块内不存在支付动作。
 */
const content = getSuiteContent('taxpay');

const items = ref<SuiteDomainItemDto[]>([]);
const metrics = ref<Array<{ label: string; value: string; hint?: string }>>([]);
const loading = ref(true);
const error = ref('');
const busy = ref('');

/** 登录引导。 */
function onNeedLogin(): void {
  goTo(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.suiteTaxpay)}`);
}

function requireLogin(): boolean {
  if (isLoggedIn()) return true;
  onNeedLogin();
  return false;
}

function toast(title: string): void {
  uni.showToast({ title, icon: 'none' });
}

/** 用弹窗展示较长结果（toast 会截断金额与提示）。 */
function alertText(title: string, content: string): void {
  uni.showModal({ title, content, showCancel: false });
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** 单行输入。 */
function askText(title: string, placeholder: string): Promise<string | null> {
  return new Promise((resolve) => {
    uni.showModal({
      title,
      editable: true,
      placeholderText: placeholder,
      success: (res) => resolve(res.confirm ? (res.content ?? '').trim() : null),
      fail: () => resolve(null),
    });
  });
}

/** 元 → 分；非法返回 null。 */
function parseFen(raw: string): number | null {
  const cleaned = raw.replace(/[\s，,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/** 税率文本 → 小数；支持 0.13 与 13% 两种写法。 */
function parseRate(raw: string): number | null {
  const cleaned = raw.trim();
  const isPercent = cleaned.endsWith('%');
  const value = Number(isPercent ? cleaned.slice(0, -1) : cleaned);
  if (!Number.isFinite(value)) return null;
  const rate = isPercent ? value / 100 : value;
  if (rate < 0 || rate > 1) return null;
  return rate;
}

/** 读台账。 */
async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [list, stats] = await Promise.all([suiteApi.items('taxpay'), suiteApi.stats('taxpay')]);
    items.value = Array.isArray(list) ? list : [];
    metrics.value = Array.isArray(stats?.metrics) ? stats.metrics : [];
  } catch (e) {
    items.value = [];
    error.value = errorText(e, '票据台账加载失败，请稍后再试');
  } finally {
    loading.value = false;
  }
}

/** 静默刷新。 */
async function refresh(): Promise<void> {
  try {
    const [list, stats] = await Promise.all([suiteApi.items('taxpay'), suiteApi.stats('taxpay')]);
    items.value = Array.isArray(list) ? list : [];
    metrics.value = Array.isArray(stats?.metrics) ? stats.metrics : [];
  } catch {
    // 动作已成功，刷新失败下次进入再拉。
  }
}

/** 统一动作执行。 */
async function run(input: SuiteActionInput, key: string): Promise<void> {
  if (!requireLogin()) return;
  if (busy.value === key) return;
  busy.value = key;
  try {
    const res = await suiteApi.act('taxpay', input);
    toast(res.message || (res.changed ? '已完成' : '没有变化'));
    if (res.ok) await refresh();
  } catch (e) {
    toast(errorText(e, '操作没成功，稍后再试一次'));
  } finally {
    busy.value = '';
  }
}

/** 登记发票：发票号 → 价税合计 → 税率。 */
async function createInvoice(): Promise<void> {
  if (!requireLogin()) return;
  const invoiceNo = await askText('登记发票 · 发票号', '按票面逐位输入');
  if (!invoiceNo) return;
  const amountRaw = await askText('登记发票 · 价税合计', '单位元，例如 1130.00');
  if (!amountRaw) return;
  const amountFen = parseFen(amountRaw);
  if (amountFen === null) {
    toast('价税合计需要是大于 0 的数字，最多两位小数');
    return;
  }
  const rateRaw = await askText('登记发票 · 税率', '0.13 或 13%');
  if (!rateRaw) return;
  const rate = parseRate(rateRaw);
  if (rate === null) {
    toast('税率需要是 0 到 1 之间的小数，例如 0.13');
    return;
  }
  await run(
    { action: 'invoice', payload: { invoiceNo, amountFen, rate } },
    'create',
  );
}

/** 价税分离试算：纯算术，不写库。 */
async function splitTax(): Promise<void> {
  if (!requireLogin()) return;
  const amountRaw = await askText('价税分离 · 含税金额', '单位元，例如 1130.00');
  if (!amountRaw) return;
  const grossFen = parseFen(amountRaw);
  if (grossFen === null) {
    toast('含税金额需要是大于 0 的数字，最多两位小数');
    return;
  }
  const rateRaw = await askText('价税分离 · 税率', '0.13 或 13%');
  if (!rateRaw) return;
  const rate = parseRate(rateRaw);
  if (rate === null) {
    toast('税率需要是 0 到 1 之间的小数，例如 0.13');
    return;
  }
  if (busy.value === 'split') return;
  busy.value = 'split';
  try {
    const res = await suiteApi.act('taxpay', {
      action: 'split_tax',
      payload: { amountFen: grossFen, rate },
    });
    alertText('价税分离结果', res.message);
  } catch (e) {
    toast(errorText(e, '试算没成功，稍后再试一次'));
  } finally {
    busy.value = '';
  }
}

/** 内部核验：只登记内部核对，不代表官方查验通过。 */
function verify(item: SuiteDomainItemDto): void {
  void run({ action: 'verify', entryId: item.id }, `verify:${item.id}`);
}

/** 内部对账：只表示内部核对完成，不代表资金已收付。 */
function reconcile(item: SuiteDomainItemDto): void {
  void run({ action: 'reconcile', entryId: item.id }, `reconcile:${item.id}`);
}

onMounted(() => {
  void load();
});

applySuiteSeo({
  title: '财税支付 · MixmAPP 业务套件',
  description: '发票登记、价税分离试算与对账记录：不发起支付、不提交申报，外部查验与申报能力待接入。',
  path: ROUTES.suiteTaxpay,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: '财税支付 · MixmAPP 业务套件',
    description: '发票登记、税额试算与对账记录，报销结账不断链。',
    inLanguage: 'zh-CN',
  },
});
</script>

<style scoped lang="scss">
.panel {
  margin: 0 $sp-4 $sp-4;
  display: flex;
  flex-direction: column;
  gap: $sp-3;
}

.panel__head {
  padding: $sp-4;
  border-radius: $r-card;
  background: $shell;
  border: 1rpx solid $paper-3;
}

.panel__lead {
  display: block;
  margin-top: 8rpx;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

.panel__ops {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: $sp-3;
}

.panel__cta {
  margin-top: $sp-3;
}

.metrics {
  display: flex;
  flex-wrap: wrap;
  gap: $sp-2;
}

.metric {
  flex: 1 1 30%;
  min-width: 200rpx;
  padding: $sp-3;
  border-radius: $r-card;
  background: $paper-2;
}

.metric__value {
  display: block;
  font-size: $fs-h3;
  font-weight: 800;
  color: $acc-4;
}

.metric__label {
  display: block;
  margin-top: 6rpx;
  font-size: $fs-micro;
  color: $ink-3;
}

.metric__hint {
  display: block;
  margin-top: 4rpx;
  font-size: $fs-xs;
  line-height: $lh-snug;
  color: $ink-4;
}

.items {
  display: flex;
  flex-direction: column;
  gap: $sp-3;
}

.item {
  padding: $sp-4;
}

.item__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $sp-2;
}

.item__title {
  flex: 1;
  min-width: 0;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  color: $ink;
}

.item__stage {
  flex: 0 0 auto;
}

.item__summary {
  display: block;
  margin-top: 10rpx;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

.item__meta {
  margin-top: $sp-3;
  padding: $sp-3;
  border-radius: $r-control;
  background: $paper-2;
}

.item__meta-row {
  display: flex;
  justify-content: space-between;
  gap: $sp-3;
  padding: 4rpx 0;
}

.item__meta-label {
  flex: 0 0 auto;
  font-family: $font-mono;
  font-size: $fs-micro;
  color: $ink-4;
}

.item__meta-value {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: $fs-micro;
  color: $ink-2;
}

.item__acts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12rpx;
  margin-top: $sp-3;
}

.item__done {
  color: $ink-4;
}

.disclaimer {
  padding: $sp-3;
  border-radius: $r-control;
  background: $amber-soft;
}

.disclaimer__text {
  font-size: $fs-xs;
  line-height: $lh-body;
  color: $ink-2;
}
</style>
