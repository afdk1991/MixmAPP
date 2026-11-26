<template>
  <suite-detail-shell :content="content" @need-login="onNeedLogin">
    <!--
      法律政务动态面板：事项建档 + 材料清单 + 合规自查 + 阶段推进。
      只做流程与清单记录，不提供法律意见，也不判定合规与否。
    -->
    <template #dynamic>
      <view class="panel">
        <view class="panel__head">
          <text class="eyebrow">事项台账</text>
          <text class="panel__lead">
            先记受理机构与依据类型，再列材料清单、做提交前自查。
            自查只报完成度与缺失项，不输出「合规 / 不合规」结论。
          </text>
          <view class="panel__ops">
            <view
              class="btn btn--sm btn--ghost"
              hover-class="is-press"
              role="button"
              aria-label="新建办事事项"
              @tap="createMatter"
            >
              <text>新建事项</text>
            </view>
          </view>
        </view>

        <!-- 指标：办理中 / 待办结 / 近七天办结 / 材料未齐 -->
        <view v-if="metrics.length" class="metrics">
          <view v-for="m in metrics" :key="m.label" class="metric">
            <text class="metric__value mono">{{ m.value }}</text>
            <text class="metric__label">{{ m.label }}</text>
            <text v-if="m.hint" class="metric__hint">{{ m.hint }}</text>
          </view>
        </view>

        <!-- 三态 -->
        <mx-state v-if="loading" variant="loading" title="正在读取事项台账…" />
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
          title="还没有事项"
          text="先新建一条：写上事项名称与受理机构，再列材料清单和自查项。"
        >
          <view
            class="btn btn--primary btn--sm panel__cta"
            hover-class="is-press"
            role="button"
            aria-label="新建第一个事项"
            @tap="createMatter"
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
                :class="{ 'btn--disabled': busy === `materials:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`给${item.title}登记材料清单`"
                @tap="editMaterials(item)"
              >
                <text>材料清单</text>
              </view>
              <view
                class="btn btn--sm btn--ghost"
                :class="{ 'btn--disabled': busy === `check:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`给${item.title}做合规自查`"
                @tap="selfCheck(item)"
              >
                <text>合规自查</text>
              </view>
              <view
                v-if="item.stage !== 'done'"
                class="btn btn--sm btn--ghost"
                :class="{ 'btn--disabled': busy === `advance:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="advanceLabel(item)"
                @tap="advance(item)"
              >
                <text>{{ advanceLabel(item) }}</text>
              </view>
              <text v-else class="micro item__done">已办结，记录只读</text>
            </view>
          </view>
        </view>

        <view class="disclaimer">
          <text class="disclaimer__text">
            边界说明：本面板不提供法律意见，自查结果不构成合规结论。
            条款解释、争议处理与实质合规判断请咨询执业律师或主管机关；
            电子证照、办件进度与在线申报能力均未接入，标注为待接入。
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
 * 法律政务领域页。
 *
 * 动态面板对接服务端 legal 模块：guide（事项建档）、materials（材料完成度）、
 * self_check（自查完成度）与基线 advance（阶段推进）。
 */
const content = getSuiteContent('legal');

const items = ref<SuiteDomainItemDto[]>([]);
const metrics = ref<Array<{ label: string; value: string; hint?: string }>>([]);
const loading = ref(true);
const error = ref('');
const busy = ref('');

/** 登录引导。 */
function onNeedLogin(): void {
  goTo(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.suiteLegal)}`);
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

/** 按顿号、逗号与分号拆成数组，供服务端按条目统计。 */
function splitItems(raw: string): string[] {
  return raw
    .split(/[、,，;；]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** 阶段对应的推进按钮文案。 */
function advanceLabel(item: SuiteDomainItemDto): string {
  if (item.stage === 'draft') return '标记已提交';
  if (item.stage === 'submitted') return '转入办理中';
  if (item.stage === 'processing') return '标记已办结';
  return '已完成';
}

/** 读台账。 */
async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [list, stats] = await Promise.all([suiteApi.items('legal'), suiteApi.stats('legal')]);
    items.value = Array.isArray(list) ? list : [];
    metrics.value = Array.isArray(stats?.metrics) ? stats.metrics : [];
  } catch (e) {
    items.value = [];
    error.value = errorText(e, '事项台账加载失败，请稍后再试');
  } finally {
    loading.value = false;
  }
}

/** 静默刷新。 */
async function refresh(): Promise<void> {
  try {
    const [list, stats] = await Promise.all([suiteApi.items('legal'), suiteApi.stats('legal')]);
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
    const res = await suiteApi.act('legal', input);
    toast(res.message || (res.changed ? '已完成' : '没有变化'));
    if (res.ok) await refresh();
  } catch (e) {
    toast(errorText(e, '操作没成功，稍后再试一次'));
  } finally {
    busy.value = '';
  }
}

/** 新建事项：名称 + 受理机构，其余字段可后续补充。 */
async function createMatter(): Promise<void> {
  if (!requireLogin()) return;
  const title = await askText('新建事项 · 名称', '例如：食品经营许可变更');
  if (!title) return;
  const authority = await askText('新建事项 · 受理机构', '例如：区市场监督管理局');
  if (!authority) return;
  await run({ action: 'guide', payload: { title, authority } }, 'create');
}

/** 材料清单：用顿号分隔材料，再填已备条数。 */
async function editMaterials(item: SuiteDomainItemDto): Promise<void> {
  const raw = await askText('材料清单', '用顿号分隔，例如：申请书、营业执照复印件、场地证明');
  if (!raw) return;
  const list = splitItems(raw);
  if (!list.length) {
    toast('请至少填写一项材料');
    return;
  }
  const doneRaw = await askText('已备条数', `共 ${list.length} 项，已备几项？`);
  if (doneRaw === null) return;
  const done = Number(doneRaw);
  if (!Number.isInteger(done) || done < 0 || done > list.length) {
    toast(`已备条数需要在 0 到 ${list.length} 之间`);
    return;
  }
  await run(
    { action: 'materials', entryId: item.id, payload: { materials: list, done } },
    `materials:${item.id}`,
  );
}

/** 合规自查：检查项用顿号分隔，再填已勾选条数。 */
async function selfCheck(item: SuiteDomainItemDto): Promise<void> {
  const raw = await askText('合规自查 · 检查项', '用顿号分隔，例如：证照在有效期、经营范围覆盖、合同节点明确');
  if (!raw) return;
  const list = splitItems(raw);
  if (!list.length) {
    toast('请至少填写一个检查项');
    return;
  }
  const checkedRaw = await askText('已勾选条数', `共 ${list.length} 项，已勾选几项？`);
  if (checkedRaw === null) return;
  const checked = Number(checkedRaw);
  if (!Number.isInteger(checked) || checked < 0 || checked > list.length) {
    toast(`已勾选条数需要在 0 到 ${list.length} 之间`);
    return;
  }
  await run(
    { action: 'self_check', entryId: item.id, payload: { items: list, checked } },
    `check:${item.id}`,
  );
}

/** 阶段推进：状态机由服务端校验。 */
function advance(item: SuiteDomainItemDto): void {
  void run({ action: 'advance', entryId: item.id }, `advance:${item.id}`);
}

onMounted(() => {
  void load();
});

applySuiteSeo({
  title: '法律政务 · MixmAPP 业务套件',
  description: '办事指南、材料清单与合规自查：只做流程与清单记录，不提供法律意见，不判定合规结论。',
  path: ROUTES.suiteLegal,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: '法律政务 · MixmAPP 业务套件',
    description: '办事指南、材料清单与合规自查，流程不走弯路。',
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
  color: $acc-5;
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
