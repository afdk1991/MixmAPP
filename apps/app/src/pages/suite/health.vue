<template>
  <suite-detail-shell :content="content" @need-login="onNeedLogin">
    <!--
      医疗医药动态面板：用药记录 + 剂量算术核对 + 随访提醒 + 结束记录。
      本面板只做记录与提醒，不提供诊断、处方或用药建议。
    -->
    <template #dynamic>
      <view class="panel">
        <view class="panel__head">
          <text class="eyebrow">用药台账</text>
          <text class="panel__lead">
            记录药名、单次剂量与每日次数；剂量核对只做乘法与减法，结果用于回去核对处方，
            不判断是否安全。诊断、加量减量与停药请以执业医师和药师意见为准。
          </text>
          <view class="panel__ops">
            <view
              class="btn btn--sm btn--ghost"
              hover-class="is-press"
              role="button"
              aria-label="新建用药记录"
              @tap="createRecord"
            >
              <text>新建用药记录</text>
            </view>
            <view
              class="btn btn--sm btn--ghost"
              hover-class="is-press"
              role="button"
              aria-label="做一次剂量核对"
              @tap="doseCheck(null)"
            >
              <text>剂量核对</text>
            </view>
          </view>
        </view>

        <!-- 指标：进行中 / 待复诊 / 近七天新增 -->
        <view v-if="metrics.length" class="metrics">
          <view v-for="m in metrics" :key="m.label" class="metric">
            <text class="metric__value mono">{{ m.value }}</text>
            <text class="metric__label">{{ m.label }}</text>
            <text v-if="m.hint" class="metric__hint">{{ m.hint }}</text>
          </view>
        </view>

        <!-- 三态 -->
        <mx-state v-if="loading" variant="loading" title="正在读取用药台账…" />
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
          title="还没有用药记录"
          text="先新建一条：填上药名、单次剂量与每日次数，之后可以登记复诊提醒或做剂量核对。"
        >
          <view
            class="btn btn--primary btn--sm panel__cta"
            hover-class="is-press"
            role="button"
            aria-label="新建第一条用药记录"
            @tap="createRecord"
          >
            <text>新建第一条</text>
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
                class="btn btn--sm btn--primary"
                :class="{ 'btn--disabled': busy === `dose:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`给${item.title}做剂量核对`"
                @tap="doseCheck(item)"
              >
                <text>剂量核对</text>
              </view>
              <view
                class="btn btn--sm btn--ghost"
                :class="{ 'btn--disabled': busy === `followup:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`给${item.title}登记复诊提醒`"
                @tap="followup(item)"
              >
                <text>复诊提醒</text>
              </view>
              <view
                v-if="item.stage !== 'closed'"
                class="btn btn--sm btn--ghost"
                :class="{ 'btn--disabled': busy === `close:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`结束${item.title}`"
                @tap="closeRecord(item)"
              >
                <text>结束记录</text>
              </view>
              <text v-else class="micro item__done">已结束，历史保留</text>
            </view>
          </view>
        </view>

        <view class="disclaimer">
          <text class="disclaimer__text">
            边界说明：本面板不提供诊断、处方、剂量调整或疗效判断；医院处方、电子病历、
            医保与药房数据均未接入，相关能力标注为待接入。
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
 * 医疗医药领域页。
 *
 * 动态面板对接服务端 health 模块：record（用药记录）、dose_check（剂量算术核对）、
 * followup（复诊提醒）与 close（结束记录）。所有动作都只记录事实，不输出医疗建议。
 */
const content = getSuiteContent('health');

const items = ref<SuiteDomainItemDto[]>([]);
const metrics = ref<Array<{ label: string; value: string; hint?: string }>>([]);
const loading = ref(true);
const error = ref('');
/** 正在执行的动作标识。 */
const busy = ref('');

/** 登录引导。 */
function onNeedLogin(): void {
  goTo(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.suiteHealth)}`);
}

/** 登录门禁。 */
function requireLogin(): boolean {
  if (isLoggedIn()) return true;
  onNeedLogin();
  return false;
}

function toast(title: string): void {
  uni.showToast({ title, icon: 'none' });
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

/** 二次确认。 */
function confirm(title: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title,
      content,
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    });
  });
}

/** 读台账。 */
async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [list, stats] = await Promise.all([suiteApi.items('health'), suiteApi.stats('health')]);
    items.value = Array.isArray(list) ? list : [];
    metrics.value = Array.isArray(stats?.metrics) ? stats.metrics : [];
  } catch (e) {
    items.value = [];
    error.value = errorText(e, '用药台账加载失败，请稍后再试');
  } finally {
    loading.value = false;
  }
}

/** 静默刷新。 */
async function refresh(): Promise<void> {
  try {
    const [list, stats] = await Promise.all([suiteApi.items('health'), suiteApi.stats('health')]);
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
    const res = await suiteApi.act('health', input);
    toast(res.message || (res.changed ? '已完成' : '没有变化'));
    if (res.ok) await refresh();
  } catch (e) {
    toast(errorText(e, '操作没成功，稍后再试一次'));
  } finally {
    busy.value = '';
  }
}

/** 新建用药记录：药名 → 单次剂量（带单位）→ 每日次数。 */
async function createRecord(): Promise<void> {
  if (!requireLogin()) return;
  const name = await askText('用药记录 · 药名', '通用名优先，例如：阿莫西林');
  if (!name) return;
  const dosage = await askText('用药记录 · 单次剂量', '带单位，例如 0.5 克 / 1 片');
  if (!dosage) return;
  const frequency = await askText('用药记录 · 每日次数', '例如 每日两次');
  if (!frequency) return;
  await run(
    { action: 'record', payload: { title: name, dosage, frequency } },
    'create',
  );
}

/**
 * 剂量核对：单次剂量（数字+单位）→ 每日次数 → 每日上限（数字）。
 * 只发送数字与单位，结果由服务端做乘法与减法。
 */
async function doseCheck(item: SuiteDomainItemDto | null): Promise<void> {
  if (!requireLogin()) return;
  const doseRaw = await askText('剂量核对 · 单次剂量', '数字+单位，例如 0.5克');
  if (!doseRaw) return;
  const match = /^([\d.]+)\s*([^\d\s].*)?$/.exec(doseRaw);
  if (!match) {
    toast('单次剂量请写成「数字 + 单位」，例如 0.5克');
    return;
  }
  const dose = Number(match[1]);
  const unit = (match[2] ?? '').trim();
  const timesRaw = await askText('剂量核对 · 每日次数', '例如 3');
  if (!timesRaw) return;
  const times = Number(timesRaw);
  const maxRaw = await askText('剂量核对 · 每日上限', '处方或药师说明的每日上限，只填数字');
  if (!maxRaw) return;
  const dailyMax = Number(maxRaw);
  if (!Number.isFinite(dose) || dose <= 0 || !Number.isFinite(times) || times <= 0 || !Number.isFinite(dailyMax) || dailyMax <= 0) {
    toast('三个数值都需要是大于 0 的数字');
    return;
  }
  await run(
    {
      action: 'dose_check',
      ...(item ? { entryId: item.id } : {}),
      payload: { dose, timesPerDay: times, dailyMax, unit },
    },
    item ? `dose:${item.id}` : 'dose',
  );
}

/** 复诊提醒：日期 + 复查项目，材料可留空。 */
async function followup(item: SuiteDomainItemDto): Promise<void> {
  const at = await askText('复诊提醒 · 日期', 'YYYY-MM-DD');
  if (!at) return;
  const itemsText = await askText('复诊提醒 · 复查项目', '例如：血常规、肝肾功能');
  if (itemsText === null) return;
  await run(
    { action: 'followup', entryId: item.id, payload: { followupAt: at, items: itemsText } },
    `followup:${item.id}`,
  );
}

/** 结束记录：只改状态，不删除历史。 */
async function closeRecord(item: SuiteDomainItemDto): Promise<void> {
  const ok = await confirm('结束用药记录', `确定结束「${item.title}」吗？历史记录会保留，可随时回看。`);
  if (!ok) return;
  await run({ action: 'close', entryId: item.id }, `close:${item.id}`);
}

onMounted(() => {
  void load();
});

applySuiteSeo({
  title: '医疗医药 · MixmAPP 业务套件',
  description: '用药记录、剂量算术核对与随访提醒：只做记录与提醒，不提供诊断、处方或用药建议。',
  path: ROUTES.suiteHealth,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: '医疗医药 · MixmAPP 业务套件',
    description: '用药记录、剂量核对与随访提醒，安全放在第一位。',
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
