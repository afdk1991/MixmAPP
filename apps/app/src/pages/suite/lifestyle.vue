<template>
  <suite-detail-shell :content="content" @need-login="onNeedLogin">
    <!--
      生活休闲动态面板：计划 + 预约记录 + 权益到期 + 完成回填。
      预约与权益都是本地记录，模块不向商家提交订单、不支付定金。
    -->
    <template #dynamic>
      <view class="panel">
        <view class="panel__head">
          <text class="eyebrow">生活台账</text>
          <text class="panel__lead">
            计划写清去哪、和谁、什么时候；预约登记确认号与退改截止；权益记到期日。
            这些都不代替官方渠道的预订与核销。
          </text>
          <view class="panel__ops">
            <view
              class="btn btn--sm btn--ghost"
              hover-class="is-press"
              role="button"
              aria-label="新建周末计划"
              @tap="createPlan"
            >
              <text>新建计划</text>
            </view>
            <view
              class="btn btn--sm btn--ghost"
              hover-class="is-press"
              role="button"
              aria-label="登记会员权益"
              @tap="createBenefit"
            >
              <text>登记权益</text>
            </view>
          </view>
        </view>

        <!-- 指标：已预约 / 临期权益 -->
        <view v-if="metrics.length" class="metrics">
          <view v-for="m in metrics" :key="m.label" class="metric">
            <text class="metric__value mono">{{ m.value }}</text>
            <text class="metric__label">{{ m.label }}</text>
            <text v-if="m.hint" class="metric__hint">{{ m.hint }}</text>
          </view>
        </view>

        <!-- 三态 -->
        <mx-state v-if="loading" variant="loading" title="正在读取生活台账…" />
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
          title="还没有计划"
          text="先新建一条周末计划，填上日期与地点；也可以登记会员权益，提前收到到期提醒。"
        >
          <view
            class="btn btn--primary btn--sm panel__cta"
            hover-class="is-press"
            role="button"
            aria-label="新建第一条计划"
            @tap="createPlan"
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
              <template v-if="!isBenefit(item)">
                <view
                  v-if="item.stage === 'planned' || item.stage === 'booked'"
                  class="btn btn--sm btn--primary"
                  :class="{ 'btn--disabled': busy === `book:${item.id}` }"
                  hover-class="is-press"
                  role="button"
                  :aria-label="`给${item.title}登记预约`"
                  @tap="book(item)"
                >
                  <text>登记预约</text>
                </view>
                <view
                  v-if="item.stage !== 'done'"
                  class="btn btn--sm btn--ghost"
                  :class="{ 'btn--disabled': busy === `finish:${item.id}` }"
                  hover-class="is-press"
                  role="button"
                  :aria-label="`给${item.title}做完成回填`"
                  @tap="finish(item)"
                >
                  <text>完成回填</text>
                </view>
                <text v-else class="micro item__done">已完成</text>
              </template>
              <text v-else class="micro item__done">权益到期前会排在列表前面</text>
            </view>
          </view>
        </view>

        <view class="disclaimer">
          <text class="disclaimer__text">
            边界说明：预约与权益都是本地记录，模块不提交订单、不锁定名额、不支付定金；
            真实预订、退改与核销以场馆、票务或商家的官方渠道为准。票务与会员系统接口待接入。
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
 * 生活休闲领域页。
 *
 * 动态面板对接服务端 lifestyle 模块：plan（计划）、book（预约记录）、
 * benefit（权益登记）与 finish（完成回填）。
 */
const content = getSuiteContent('lifestyle');

const items = ref<SuiteDomainItemDto[]>([]);
const metrics = ref<Array<{ label: string; value: string; hint?: string }>>([]);
const loading = ref(true);
const error = ref('');
const busy = ref('');

/** 登录引导。 */
function onNeedLogin(): void {
  goTo(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.suiteLifestyle)}`);
}

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

/** 是否是权益条目（权益只提醒到期，不参与预约流程）。 */
function isBenefit(item: SuiteDomainItemDto): boolean {
  return typeof item.payload['benefitName'] === 'string' && item.payload['benefitName'] !== '';
}

/** 读台账。 */
async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [list, stats] = await Promise.all([suiteApi.items('lifestyle'), suiteApi.stats('lifestyle')]);
    items.value = Array.isArray(list) ? list : [];
    metrics.value = Array.isArray(stats?.metrics) ? stats.metrics : [];
  } catch (e) {
    items.value = [];
    error.value = errorText(e, '生活台账加载失败，请稍后再试');
  } finally {
    loading.value = false;
  }
}

/** 静默刷新。 */
async function refresh(): Promise<void> {
  try {
    const [list, stats] = await Promise.all([suiteApi.items('lifestyle'), suiteApi.stats('lifestyle')]);
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
    const res = await suiteApi.act('lifestyle', input);
    toast(res.message || (res.changed ? '已完成' : '没有变化'));
    if (res.ok) await refresh();
  } catch (e) {
    toast(errorText(e, '操作没成功，稍后再试一次'));
  } finally {
    busy.value = '';
  }
}

/** 新建计划：名称 + 日期。 */
async function createPlan(): Promise<void> {
  if (!requireLogin()) return;
  const title = await askText('新建计划', '例如：周六去美术馆');
  if (!title) return;
  const planAt = await askText('计划日期', 'YYYY-MM-DD');
  if (!planAt) return;
  await run({ action: 'plan', payload: { title, planAt } }, 'create');
}

/** 登记权益：名称 + 到期日。 */
async function createBenefit(): Promise<void> {
  if (!requireLogin()) return;
  const name = await askText('登记权益 · 名称', '例如：电影年卡');
  if (!name) return;
  const expiresAt = await askText('登记权益 · 到期日', 'YYYY-MM-DD');
  if (!expiresAt) return;
  await run(
    { action: 'benefit', payload: { benefitName: name, expiresAt } },
    'benefit',
  );
}

/** 登记预约：渠道 + 确认号。 */
async function book(item: SuiteDomainItemDto): Promise<void> {
  const channel = await askText('登记预约 · 渠道', '例如：场馆公众号、票务平台');
  if (!channel) return;
  const confirmationNo = await askText('登记预约 · 确认号', '没有可留空');
  if (confirmationNo === null) return;
  await run(
    { action: 'book', entryId: item.id, payload: { channel, confirmationNo } },
    `book:${item.id}`,
  );
}

/** 完成回填：可选评分 1-5。 */
async function finish(item: SuiteDomainItemDto): Promise<void> {
  const ratingRaw = await askText('完成回填 · 评分', '1-5，可留空');
  if (ratingRaw === null) return;
  let rating = 0;
  if (ratingRaw !== '') {
    const parsed = Number(ratingRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      toast('评分需要是 1 到 5 之间的整数');
      return;
    }
    rating = parsed;
  }
  await run(
    { action: 'finish', entryId: item.id, payload: { rating } },
    `finish:${item.id}`,
  );
}

onMounted(() => {
  void load();
});

applySuiteSeo({
  title: '生活休闲 · MixmAPP 业务套件',
  description: '活动计划、预约记录与权益到期提醒：预约仅为本地记录，真实预订以官方渠道为准。',
  path: ROUTES.suiteLifestyle,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: '生活休闲 · MixmAPP 业务套件',
    description: '活动预约、会员权益与生活清单，把周末还给自己。',
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
  color: $acc-2;
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
