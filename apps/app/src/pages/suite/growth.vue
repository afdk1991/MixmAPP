<template>
  <suite-detail-shell :content="content" @need-login="onShellNeedLogin">
    <!--
      营销增长动态面板：活动台账 + 启动活动 + 漏斗 + 投产比 + 归因 + 结算。
      正文是静态内容包，渲染不依赖任何请求；这里的台账异步加载，失败也不阻断正文。
    -->
    <template #dynamic>
      <view class="growth">
        <!-- 指标条：进行中活动 / 已结算活动 / 总预算 / 平均投产比（服务端有数据才给） -->
        <view v-if="metrics.length" class="growth-metrics">
          <view v-for="m in metrics" :key="m.label" class="growth-metric">
            <text class="growth-metric__value mono">{{ m.value }}</text>
            <text class="growth-metric__label">{{ m.label }}</text>
            <text v-if="m.hint" class="growth-metric__hint">{{ m.hint }}</text>
          </view>
        </view>

        <!-- 新建活动：先写名称，渠道与预算在弹窗里填 -->
        <view class="sheet growth-compose">
          <text class="sec-title growth-compose__title">新建活动</text>
          <text class="hint growth-compose__hint">
            先写活动名称，点「启动活动」后补渠道与预算；活动建好即进入「进行中」，之后可以看漏斗、算投产比、做归因，结束时再结算。
          </text>

          <input
            v-model="campaignName"
            class="field growth-compose__field"
            placeholder="活动名称，例如：双十一预热"
            placeholder-class="field-ph"
          />

          <view
            class="btn btn--primary growth-compose__btn"
            :class="{ 'btn--disabled': busy === 'launch' }"
            hover-class="is-press"
            role="button"
            aria-label="启动活动"
            @tap="submitLaunch()"
          >
            <text>{{ busy === 'launch' ? '启动中' : '启动活动' }}</text>
          </view>
        </view>

        <!-- 三态：加载中 / 出错可重试 / 空态给下一步 -->
        <mx-state v-if="loading" variant="loading" title="正在读取活动台账…" />
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
          title="还没有活动"
          text="在上面写个活动名称，点「启动活动」把渠道与预算填上：活动建好后就能看漏斗、算投产比、做归因，结束时再结算留痕。"
        >
          <view
            class="btn btn--primary btn--sm growth-state-btn"
            hover-class="is-press"
            role="button"
            aria-label="启动第一个活动"
            @tap="submitLaunch()"
          >
            <text>启动第一个活动</text>
          </view>
        </mx-state>

        <view v-else class="growth-items">
          <view v-for="view in views" :key="view.item.id" class="sheet growth-item">
            <view class="growth-item__head">
              <text class="growth-item__title">{{ view.item.title }}</text>
              <view class="growth-item__tags">
                <text class="tag growth-item__stage">{{ view.item.stageLabel }}</text>
                <text v-if="view.channel" class="tag tag--brand growth-item__channel">{{ view.channel }}</text>
              </view>
            </view>

            <text class="growth-item__summary">{{ view.item.summary }}</text>

            <view v-if="view.item.meta && view.item.meta.length" class="growth-item__meta">
              <view v-for="m in view.item.meta" :key="m.label" class="growth-item__meta-row">
                <text class="growth-item__meta-label">{{ m.label }}</text>
                <text class="growth-item__meta-value">{{ m.value }}</text>
              </view>
            </view>

            <!-- 漏斗：四级数字块 + 各级转化率 -->
            <view v-if="view.funnel" class="growth-funnel">
              <text class="micro growth-funnel__title">漏斗</text>
              <view class="growth-funnel__steps">
                <view v-for="s in view.funnel.steps" :key="s.key" class="growth-funnel__step">
                  <text class="growth-funnel__num mono">{{ s.value }}</text>
                  <text class="growth-funnel__label">{{ s.label }}</text>
                </view>
              </view>
              <view class="growth-funnel__rates">
                <view v-for="r in view.funnel.rates" :key="r.key" class="growth-funnel__rate">
                  <text class="growth-funnel__rate-label">{{ r.label }}</text>
                  <text class="growth-funnel__rate-value mono">{{ r.value }}%</text>
                </view>
              </view>
            </view>

            <view class="growth-item__acts">
              <view
                v-if="view.item.stage === 'draft'"
                class="btn btn--sm btn--primary growth-act"
                :class="{ 'btn--disabled': busy === `launch:${view.item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`启动活动${view.item.title}`"
                @tap="submitLaunch(view.item)"
              >
                <text>启动活动</text>
              </view>
              <view
                class="btn btn--sm btn--ghost growth-act"
                :class="{ 'btn--disabled': busy === `funnel:${view.item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`看${view.item.title}的漏斗`"
                @tap="submitFunnel(view.item)"
              >
                <text>看漏斗</text>
              </view>
              <view
                class="btn btn--sm btn--ghost growth-act"
                :class="{ 'btn--disabled': busy === `roi:${view.item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`算${view.item.title}的投产比`"
                @tap="submitRoi(view.item)"
              >
                <text>算投产比</text>
              </view>
              <view
                class="btn btn--sm btn--ghost growth-act"
                :class="{ 'btn--disabled': busy === `attribute:${view.item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`做${view.item.title}的渠道归因`"
                @tap="submitAttribute(view.item)"
              >
                <text>归因</text>
              </view>
              <view
                v-if="view.item.stage === 'running'"
                class="btn btn--sm btn--primary growth-act"
                :class="{ 'btn--disabled': busy === `settle:${view.item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`结算${view.item.title}`"
                @tap="submitSettle(view.item)"
              >
                <text>结算</text>
              </view>
              <view
                v-else
                class="btn btn--sm btn--quiet growth-act"
                hover-class="is-press"
                role="button"
                :aria-label="`${view.item.title}的结算状态`"
                @tap="submitSettle(view.item)"
              >
                <text>{{ view.item.stage === 'settled' ? '已结算' : '未开始' }}</text>
              </view>
            </view>
          </view>
        </view>

        <text class="micro growth-foot">活动台账、漏斗快照与结算事件按登录账号保存在服务端台账里</text>
      </view>
    </template>
  </suite-detail-shell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { SuiteActionInput, SuiteActionResultDto, SuiteDomainItemDto } from '@mixmapp/contracts';
import { suiteApi } from '../../api/suite';
import MxState from '../../components/mx-state/mx-state.vue';
import SuiteDetailShell from '../../components/suite/suite-detail-shell.vue';
import { getSuiteContent } from '../../content/suite';
import { goTo } from '../../navigation';
import { ROUTES } from '../../routes';
import { applySuiteSeo } from '../../site-seo';
import { isLoggedIn } from '../../stores/session';

/**
 * 营销增长领域页。
 *
 * 正文与清单来自构建期内联的内容包（首屏零请求），
 * 动态面板走 /suite/domains/growth/items 与 /suite/domains/growth/stats：
 * 活动台账、启动活动、漏斗转化率、投产比、渠道归因与结算留痕。
 */
const content = getSuiteContent('growth');

type Metric = { label: string; value: string; hint?: string };

type FunnelStep = { key: string; label: string; value: number };
type FunnelRate = { key: string; label: string; value: number };
type FunnelView = { steps: FunnelStep[]; rates: FunnelRate[] };
type ItemView = { item: SuiteDomainItemDto; channel: string; funnel: FunnelView | null };

const items = ref<SuiteDomainItemDto[]>([]);
const metrics = ref<Metric[]>([]);
const loading = ref(true);
const error = ref('');
/** 正在执行的动作标识（按条目区分），用于按钮态与防连点 */
const busy = ref('');
/** 新建活动用的名称输入 */
const campaignName = ref('');

/** 列表视图模型：渠道与漏斗从条目 payload 里取，模板不再重复解析。 */
const views = computed<ItemView[]>(() =>
  items.value.map((item) => ({
    item,
    channel: str(item.payload['channel']),
    funnel: funnelOf(item),
  })),
);

/** 登录引导：未登录点动作时先跳登录页，并带回本页 redirect。 */
function onNeedLogin(): void {
  goTo(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.suiteGrowth)}`);
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

/* ---------- 取值小工具 ---------- */

/** 取字符串（去首尾空白）；非字符串一律视为空串。 */
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 取数字；拿不到或不是有限数返回 null。 */
function toNum(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 元文本 → 整数分；非法输入返回 null。 */
function parseMoney(raw: string, allowZero: boolean): number | null {
  const cleaned = raw.replace(/[\s，,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  if (!allowZero && value <= 0) return null;
  return Math.round(value * 100);
}

/** 计数文本 → 非负整数；非法输入返回 null。 */
function parseCount(raw: string): number | null {
  const cleaned = raw.replace(/[\s，,]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

/** 条目里的漏斗数据 → 数字块视图；没有漏斗返回 null。 */
function funnelOf(item: SuiteDomainItemDto): FunnelView | null {
  const raw = item.payload['funnel'];
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const clicks = toNum(source['clicks']);
  const visits = toNum(source['visits']);
  const leads = toNum(source['leads']);
  const orders = toNum(source['orders']);
  if (clicks === null || visits === null || leads === null || orders === null) return null;

  const ratesRaw = item.payload['funnelRates'];
  const rates = (ratesRaw && typeof ratesRaw === 'object' ? ratesRaw : {}) as Record<string, unknown>;
  const overall = toNum(item.payload['funnelOverall']) ?? 0;

  return {
    steps: [
      { key: 'clicks', label: '点击', value: clicks },
      { key: 'visits', label: '访问', value: visits },
      { key: 'leads', label: '线索', value: leads },
      { key: 'orders', label: '订单', value: orders },
    ],
    rates: [
      { key: 'clickToVisit', label: '点击 → 访问', value: toNum(rates['clickToVisit']) ?? 0 },
      { key: 'visitToLead', label: '访问 → 线索', value: toNum(rates['visitToLead']) ?? 0 },
      { key: 'leadToOrder', label: '线索 → 订单', value: toNum(rates['leadToOrder']) ?? 0 },
      { key: 'overall', label: '总体（点击 → 订单）', value: overall },
    ],
  };
}

/* ---------- 数据加载 ---------- */

/** 拉活动台账与领域指标；失败只影响这一块，不阻断静态正文。 */
async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [list, stats] = await Promise.all([suiteApi.items('growth'), suiteApi.stats('growth')]);
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
    const [list, stats] = await Promise.all([suiteApi.items('growth'), suiteApi.stats('growth')]);
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
async function run(input: SuiteActionInput, key: string): Promise<SuiteActionResultDto | null> {
  if (!isLoggedIn()) {
    onNeedLogin();
    return null;
  }
  if (busy.value === key) return null;
  busy.value = key;
  try {
    const res = await suiteApi.act('growth', input);
    toast(res.message || (res.changed ? '已完成' : '没有变化'));
    if (res.ok) await refresh();
    return res;
  } catch (e) {
    toast(e instanceof Error ? e.message : '操作没成功，稍后再试一次');
    return null;
  } finally {
    busy.value = '';
  }
}

/* ---------- 弹窗收集 ---------- */

/** 带输入框的弹窗：确认返回输入内容，取消返回 null。 */
function promptEditable(title: string, prompt: string, placeholder: string): Promise<string | null> {
  return new Promise((resolve) => {
    uni.showModal({
      title,
      content: prompt,
      editable: true,
      placeholderText: placeholder,
      success: (res) => {
        resolve(res.confirm ? (res.content ?? '').trim() : null);
      },
      fail: () => {
        resolve(null);
      },
    });
  });
}

/** 弹窗收集一个非负整数。 */
async function promptCount(title: string, prompt: string, placeholder: string): Promise<number | null> {
  const raw = await promptEditable(title, prompt, placeholder);
  if (raw === null) return null;
  const value = parseCount(raw);
  if (value === null) {
    toast('这里要填不小于 0 的整数');
    return null;
  }
  return value;
}

/* ---------- 领域动作 ---------- */

/**
 * 启动活动：渠道与预算在弹窗里填。
 * 给了条目就启动那条策划中的活动；没给条目就先建一条活动再启动。
 */
async function submitLaunch(item?: SuiteDomainItemDto): Promise<void> {
  if (!isLoggedIn()) {
    onNeedLogin();
    return;
  }

  const channel = await promptEditable('启动活动 · 投放渠道', '输入投放渠道', '例如：短视频信息流');
  if (channel === null) return;
  const budgetRaw = await promptEditable('启动活动 · 预算', '输入预算金额（元）', '例如：5000');
  if (budgetRaw === null) return;
  const budgetFen = parseMoney(budgetRaw, false);
  if (budgetFen === null) {
    toast('预算需要是大于 0 的数字，最多两位小数');
    return;
  }

  if (item) {
    await run(
      { action: 'launch', entryId: item.id, payload: { channel, budgetFen } },
      `launch:${item.id}`,
    );
    return;
  }

  const title = campaignName.value.trim();
  if (!title) {
    toast('先填写活动名称');
    return;
  }
  const created = await run({ action: 'create', payload: { title, channel, budgetFen } }, 'launch');
  const entryId = created && created.ok ? created.item?.id : undefined;
  if (!entryId) return;
  await run({ action: 'launch', entryId, payload: { channel, budgetFen } }, `launch:${entryId}`);
  campaignName.value = '';
}

/** 看漏斗：依次填点击、访问、线索、订单四级。 */
async function submitFunnel(item: SuiteDomainItemDto): Promise<void> {
  if (!isLoggedIn()) {
    onNeedLogin();
    return;
  }
  const clicks = await promptCount('漏斗 · 点击', '输入点击数', '例如 12000');
  if (clicks === null) return;
  const visits = await promptCount('漏斗 · 访问', '输入访问数', '例如 3200');
  if (visits === null) return;
  const leads = await promptCount('漏斗 · 线索', '输入留资数', '例如 640');
  if (leads === null) return;
  const orders = await promptCount('漏斗 · 订单', '输入成交数', '例如 96');
  if (orders === null) return;

  await run(
    { action: 'funnel', entryId: item.id, payload: { funnel: { clicks, visits, leads, orders } } },
    `funnel:${item.id}`,
  );
}

/** 算投产比：先填花费，再填收入。 */
async function submitRoi(item: SuiteDomainItemDto): Promise<void> {
  if (!isLoggedIn()) {
    onNeedLogin();
    return;
  }
  const spendRaw = await promptEditable('投产比 · 花费', '输入花费金额（元）', '例如：5000');
  if (spendRaw === null) return;
  const spendFen = parseMoney(spendRaw, false);
  if (spendFen === null) {
    toast('花费需要是大于 0 的数字，最多两位小数');
    return;
  }
  const revenueRaw = await promptEditable('投产比 · 收入', '输入收入金额（元）', '例如：12000');
  if (revenueRaw === null) return;
  const revenueFen = parseMoney(revenueRaw, true);
  if (revenueFen === null) {
    toast('收入需要是不小于 0 的数字，最多两位小数');
    return;
  }

  await run({ action: 'roi', entryId: item.id, payload: { spendFen, revenueFen } }, `roi:${item.id}`);
}

/** 归因：渠道（没登记过就问一次）、触点列表与本次转化订单数。 */
async function submitAttribute(item: SuiteDomainItemDto): Promise<void> {
  if (!isLoggedIn()) {
    onNeedLogin();
    return;
  }
  let channel = str(item.payload['channel']);
  if (!channel) {
    const input = await promptEditable('归因 · 渠道', '输入渠道', '例如：短视频信息流');
    if (input === null) return;
    channel = input;
  }

  const touchRaw = await promptEditable('归因 · 触点', '输入触点，逗号分隔', '例如：短视频,搜索,私域');
  if (touchRaw === null) return;
  const touchpoints = touchRaw
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
  if (touchpoints.length === 0) {
    toast('至少填一个触点');
    return;
  }

  const convertedRaw = await promptEditable(
    '归因 · 转化',
    '输入本次转化订单数，填 0 表示未转化',
    '例如：12',
  );
  if (convertedRaw === null) return;
  const convertedCount = parseCount(convertedRaw);
  if (convertedCount === null) {
    toast('转化订单数要填不小于 0 的整数');
    return;
  }

  await run(
    {
      action: 'attribute',
      entryId: item.id,
      payload: { channel, touchpoints, converted: convertedCount > 0 },
    },
    `attribute:${item.id}`,
  );
}

/** 结算：填实际花费；已结算的活动直接回报当前金额，不重复记账。 */
async function submitSettle(item: SuiteDomainItemDto): Promise<void> {
  if (!isLoggedIn()) {
    onNeedLogin();
    return;
  }
  if (item.stage === 'settled') {
    await run({ action: 'settle', entryId: item.id }, `settle:${item.id}`);
    return;
  }
  const spendRaw = await promptEditable('结算 · 实际花费', '输入实际花费金额（元）', '例如：4800');
  if (spendRaw === null) return;
  const spendFen = parseMoney(spendRaw, false);
  if (spendFen === null) {
    toast('花费需要是大于 0 的数字，最多两位小数');
    return;
  }

  await run({ action: 'settle', entryId: item.id, payload: { spendFen } }, `settle:${item.id}`);
}

onMounted(() => {
  void load();
});

applySuiteSeo({
  title: '营销增长 · MixmAPP 业务套件',
  description: '活动漏斗、渠道归因与投产比，把流量变成留存。',
  path: ROUTES.suiteGrowth,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: '营销增长 · MixmAPP 业务套件',
    description: '活动漏斗、渠道归因与投产比，把流量变成留存。',
    inLanguage: 'zh-CN',
  },
});
</script>

<style scoped lang="scss">
.growth {
  margin: 0 $sp-4 $sp-4;
  display: flex;
  flex-direction: column;
  gap: $sp-3;
}

/* ---------- 指标条 ---------- */
.growth-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: $sp-2;
}

.growth-metric {
  flex: 1 1 30%;
  min-width: 200rpx;
  padding: $sp-3;
  border-radius: $r-card;
  background: $paper-2;
}

.growth-metric__value {
  display: block;
  font-size: $fs-h3;
  font-weight: 800;
  color: $acc-1;
}

.growth-metric__label {
  display: block;
  margin-top: 6rpx;
  font-size: $fs-micro;
  color: $ink-3;
}

.growth-metric__hint {
  display: block;
  margin-top: 4rpx;
  font-size: $fs-xs;
  line-height: $lh-snug;
  color: $ink-4;
}

/* ---------- 新建活动 ---------- */
.growth-compose {
  padding: $sp-4;
}

.growth-compose__title {
  font-size: $fs-h3;
}

.growth-compose__hint {
  margin: 8rpx 0 $sp-3;
}

.growth-compose__field {
  margin-top: $sp-2;
}

.growth-compose__btn {
  margin-top: $sp-3;
  width: 100%;
}

/* ---------- 活动台账 ---------- */
.growth-items {
  display: flex;
  flex-direction: column;
  gap: $sp-3;
}

.growth-item {
  padding: $sp-4;
}

.growth-item__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $sp-2;
}

.growth-item__title {
  flex: 1;
  min-width: 0;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  color: $ink;
}

.growth-item__tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  flex: 0 0 auto;
  gap: 8rpx;
}

.growth-item__stage {
  flex: 0 0 auto;
}

.growth-item__channel {
  flex: 0 0 auto;
  max-width: 260rpx;
}

.growth-item__summary {
  display: block;
  margin-top: 12rpx;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

.growth-item__meta {
  margin-top: $sp-3;
  padding: $sp-3;
  border-radius: $r-control;
  background: $paper-2;
}

.growth-item__meta-row {
  display: flex;
  justify-content: space-between;
  gap: $sp-3;
  padding: 4rpx 0;
}

.growth-item__meta-label {
  flex: 0 0 auto;
  font-family: $font-mono;
  font-size: $fs-micro;
  color: $ink-4;
}

.growth-item__meta-value {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: $fs-micro;
  color: $ink-2;
}

/* ---------- 漏斗数字块 ---------- */
.growth-funnel {
  margin-top: $sp-3;
  padding: $sp-3;
  border-radius: $r-control;
  background: $paper-2;
}

.growth-funnel__title {
  color: $ink-4;
}

.growth-funnel__steps {
  display: flex;
  flex-wrap: wrap;
  margin-top: 10rpx;
  gap: 10rpx;
}

.growth-funnel__step {
  flex: 1 1 22%;
  min-width: 130rpx;
  padding: 12rpx 10rpx;
  border-radius: $r-xs;
  background: $shell;
  text-align: center;
}

.growth-funnel__num {
  display: block;
  font-size: $fs-h3;
  font-weight: 800;
  color: $acc-1;
}

.growth-funnel__label {
  display: block;
  margin-top: 4rpx;
  font-size: $fs-xs;
  color: $ink-3;
}

.growth-funnel__rates {
  margin-top: 12rpx;
}

.growth-funnel__rate {
  display: flex;
  justify-content: space-between;
  gap: $sp-3;
  padding: 4rpx 0;
}

.growth-funnel__rate-label {
  flex: 1;
  min-width: 0;
  font-size: $fs-xs;
  color: $ink-3;
}

.growth-funnel__rate-value {
  flex: 0 0 auto;
  font-size: $fs-xs;
  font-weight: 600;
  color: $ink;
}

/* ---------- 动作 ---------- */
.growth-item__acts {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: $sp-3;
}

.growth-act {
  flex: 0 0 auto;
}

.growth-state-btn {
  margin-top: $sp-3;
}

.growth-foot {
  margin-top: $sp-2;
  text-align: center;
}
</style>
