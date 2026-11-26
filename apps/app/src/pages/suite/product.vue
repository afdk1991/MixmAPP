<template>
  <suite-detail-shell :content="content" @need-login="onNeedLogin">
    <!--
      产品研发的动态面板：需求、缺陷与迭代燃尽。
      正文是静态内容包，渲染不依赖任何请求；这里的台账异步加载，失败也不阻断正文。
    -->
    <template #dynamic>
      <view class="panel">
        <view class="panel__head">
          <text class="eyebrow">研发台账</text>
          <text class="panel__lead">需求、缺陷与迭代燃尽都记在服务端台账里，加载失败也不影响上方正文。</text>
          <view class="panel__ops">
            <view
              class="btn btn--sm btn--ghost"
              hover-class="is-press"
              role="button"
              aria-label="新建需求"
              @tap="createRequirement"
            >
              新建需求
            </view>
            <view
              class="btn btn--sm btn--ghost"
              hover-class="is-press"
              role="button"
              aria-label="登记缺陷"
              @tap="registerDefect"
            >
              登记缺陷
            </view>
          </view>
        </view>

        <!-- 领域指标：需求池 / 本迭代已交付 / 开发中 / 缺陷未闭环 -->
        <view v-if="metrics.length" class="metrics">
          <view v-for="m in metrics" :key="m.label" class="metric">
            <text class="metric__value mono">{{ m.value }}</text>
            <text class="metric__label">{{ m.label }}</text>
          </view>
        </view>

        <!-- 三态：加载中 / 出错可重试 / 空态给下一步 -->
        <mx-state v-if="loading" variant="loading" title="正在读取研发台账…" />
        <mx-state
          v-else-if="listError"
          variant="error"
          title="台账没打开"
          :text="listError"
          action-text="重新加载"
          @action="load"
        />
        <mx-state
          v-else-if="groups.length === 0"
          variant="empty"
          title="还没有研发条目"
          text="先建一条需求，再用「估点」把它挂到某个迭代；迭代视图与燃尽就会出现在这里。"
        >
          <view
            class="btn btn--primary btn--sm panel__cta"
            hover-class="is-press"
            role="button"
            aria-label="新建第一条需求"
            @tap="createRequirement"
          >
            新建第一条需求
          </view>
        </mx-state>

        <!-- 迭代视图：按所属迭代分组，每组给出总数 / 已完成 / 剩余 -->
        <view v-else class="sprints">
          <view v-for="group in groups" :key="group.key" class="sprint sheet sheet--flat">
            <view class="sprint__head">
              <view class="sprint__title">
                <text class="sprint__name mono">{{ group.name }}</text>
                <text class="sprint__count mono">
                  总数 {{ group.total }} · 已完成 {{ group.done }} · 剩余 {{ group.remaining }}
                </text>
              </view>
              <view
                class="btn btn--sm btn--ghost sprint__btn"
                hover-class="is-press"
                role="button"
                :aria-label="`查看 ${group.name} 的燃尽`"
                @tap="runBurndown(group.sprint)"
              >
                查看燃尽
              </view>
            </view>

            <view class="sprint__bar">
              <view class="sprint__bar-done" :style="doneBarStyle(group)" />
            </view>

            <view class="sprint__items">
              <view v-for="item in group.items" :key="item.id" class="item">
                <view class="item__head">
                  <text class="item__title">{{ item.title }}</text>
                  <view class="item__tags">
                    <text class="tag">{{ item.stageLabel }}</text>
                    <text v-if="severityOf(item)" class="tag tag--brand">{{ severityOf(item) }}</text>
                    <text v-if="pointsOf(item)" class="tag">{{ pointsOf(item) }} 点</text>
                  </view>
                </view>

                <view v-if="item.meta.length" class="item__meta">
                  <view v-for="m in item.meta" :key="m.label" class="item__meta-row">
                    <text class="item__meta-label">{{ m.label }}</text>
                    <text class="item__meta-value">{{ m.value }}</text>
                  </view>
                </view>

                <view class="item__acts">
                  <view
                    v-if="item.stage !== 'done'"
                    class="btn btn--sm btn--ghost"
                    hover-class="is-press"
                    role="button"
                    :aria-label="`推进 ${item.title} 到下一阶段`"
                    @tap="runAdvance(item)"
                  >
                    推进到下一阶段
                  </view>
                  <view
                    v-if="item.stage === 'idea'"
                    class="btn btn--sm btn--ghost"
                    hover-class="is-press"
                    role="button"
                    :aria-label="`排期 ${item.title}`"
                    @tap="runTriage(item)"
                  >
                    排期
                  </view>
                  <view
                    v-if="item.stage === 'review'"
                    class="btn btn--sm btn--ghost"
                    hover-class="is-press"
                    role="button"
                    :aria-label="`打开发布评审：${item.title}`"
                    @tap="runReview(item)"
                  >
                    打开发布评审
                  </view>
                  <view
                    class="btn btn--sm btn--ghost"
                    hover-class="is-press"
                    role="button"
                    :aria-label="`为 ${item.title} 估点`"
                    @tap="runEstimate(item)"
                  >
                    估点
                  </view>
                </view>
              </view>
            </view>
          </view>
        </view>

        <!-- 燃尽结果：数字块 + 完成比例条 -->
        <view v-if="burndown" class="burndown sheet sheet--flat">
          <view class="burndown__head">
            <text class="sec-title burndown__title">燃尽 · {{ burndown.sprint }}</text>
            <text class="micro mono">
              {{ burndown.total }} 条 · 已完成 {{ burndown.done }} · 剩余 {{ burndown.remaining }}
            </text>
          </view>
          <view class="burndown__bar">
            <view class="burndown__bar-done" :style="burndownBarStyle" />
          </view>
          <view class="burndown__grid">
            <view v-for="stage in burndown.stages" :key="stage.key" class="burndown__cell">
              <text class="burndown__value mono">{{ stage.value }}</text>
              <text class="burndown__label">{{ stage.label }}</text>
            </view>
          </view>
        </view>
      </view>
    </template>
  </suite-detail-shell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { SuiteDomainItemDto } from '@mixmapp/contracts';
import { suiteApi } from '../../api/suite';
import MxState from '../../components/mx-state/mx-state.vue';
import SuiteDetailShell from '../../components/suite/suite-detail-shell.vue';
import { getSuiteContent } from '../../content/suite';
import { goTo } from '../../navigation';
import { ROUTES } from '../../routes';
import { applySuiteSeo } from '../../site-seo';
import { isLoggedIn } from '../../stores/session';

/**
 * 产品研发领域页。
 *
 * 正文与清单来自构建期内联的内容包（首屏零请求），
 * 动态面板走 /suite/domains/product/items 与 /suite/domains/product/stats。
 */
const content = getSuiteContent('product');

/** 迭代分组：按 payload.sprint 归拢，未指定迭代的条目归到「未排期」。 */
type SprintGroup = {
  key: string;
  name: string;
  /** 空串表示尚未归属任何迭代 */
  sprint: string;
  total: number;
  done: number;
  remaining: number;
  items: SuiteDomainItemDto[];
};

/** 燃尽快照的展示口径。 */
type BurndownView = {
  sprint: string;
  total: number;
  done: number;
  remaining: number;
  stages: Array<{ key: string; label: string; value: number }>;
};

const items = ref<SuiteDomainItemDto[]>([]);
const metrics = ref<Array<{ label: string; value: string; hint?: string }>>([]);
const loading = ref(true);
const listError = ref('');
/** 正在执行的动作键（动作:条目），用于按钮态与防重复提交 */
const busy = ref('');
const burndown = ref<BurndownView | null>(null);

const groups = computed<SprintGroup[]>(() => {
  const map = new Map<string, SprintGroup>();
  for (const item of items.value) {
    const sprint = sprintOf(item);
    const key = sprint || '__unscheduled__';
    let group = map.get(key);
    if (!group) {
      group = { key, name: sprint || '未排期', sprint, total: 0, done: 0, remaining: 0, items: [] };
      map.set(key, group);
    }
    group.items.push(item);
    group.total += 1;
    if (item.stage === 'done') group.done += 1;
    else group.remaining += 1;
  }
  const list = Array.from(map.values());
  list.sort((a, b) => {
    if (!a.sprint) return 1;
    if (!b.sprint) return -1;
    return a.sprint.localeCompare(b.sprint);
  });
  return list;
});

/** 迭代组内的完成比例（百分比字符串）。 */
function doneBarStyle(group: SprintGroup): Record<string, string> {
  const percent = group.total > 0 ? Math.round((group.done / group.total) * 100) : 0;
  return { width: `${percent}%` };
}

/** 燃尽条的完成比例（百分比字符串）。 */
const burndownBarStyle = computed<Record<string, string>>(() => {
  const view = burndown.value;
  if (!view || view.total <= 0) return { width: '0%' };
  return { width: `${Math.round((view.done / view.total) * 100)}%` };
});

/* ---------- 条目取值 ---------- */

function sprintOf(item: SuiteDomainItemDto): string {
  const value = item.payload['sprint'];
  return typeof value === 'string' ? value.trim() : '';
}

function severityOf(item: SuiteDomainItemDto): string {
  const value = item.payload['severity'];
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function pointsOf(item: SuiteDomainItemDto): number {
  const value = item.payload['points'];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/* ---------- 加载 ---------- */

function toast(title: string): void {
  uni.showToast({ title, icon: 'none' });
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * 拉台账与指标。
 * 列表失败 → 面板进入错误态（可重试）；指标失败 → 只留空指标，不影响列表。
 */
async function load(): Promise<void> {
  loading.value = true;
  listError.value = '';
  try {
    const list = await suiteApi.items('product');
    items.value = Array.isArray(list) ? list : [];
  } catch (e) {
    items.value = [];
    listError.value = errorText(e, '研发台账加载失败，稍后再试一次');
  }
  try {
    const stats = await suiteApi.stats('product');
    metrics.value = Array.isArray(stats?.metrics) ? stats.metrics : [];
  } catch {
    // 指标读失败不阻断台账展示
    metrics.value = [];
  }
  loading.value = false;
}

/* ---------- 动作 ---------- */

/** 写操作前的登录门禁：未登录不发请求，先引导登录。 */
function requireLogin(): boolean {
  if (isLoggedIn()) return true;
  onNeedLogin();
  return false;
}

/** 执行一次领域动作，成功后用返回的 message 轻提示并刷新列表与统计。 */
async function runAct(
  action: string,
  item: SuiteDomainItemDto,
  payload?: Record<string, unknown>,
): Promise<void> {
  if (!requireLogin()) return;
  const key = `${action}:${item.id}`;
  if (busy.value === key) return;
  busy.value = key;
  try {
    const res = await suiteApi.act('product', {
      action,
      entryId: item.id,
      ...(payload ? { payload } : {}),
    });
    toast(res.message);
    if (res.ok) await load();
  } catch (e) {
    toast(errorText(e, '操作没成功，稍后再试一次'));
  } finally {
    busy.value = '';
  }
}

/** 推进到下一阶段。 */
function runAdvance(item: SuiteDomainItemDto): void {
  void runAct('advance', item);
}

/** 排期：填交付日期后把条目从需求池推进到已排期。 */
function runTriage(item: SuiteDomainItemDto): void {
  if (!requireLogin()) return;
  uni.showModal({
    title: '排期',
    content: '填写交付日期（可留空）',
    editable: true,
    placeholderText: '例如 2026-12-10',
    confirmText: '排期',
    success: (res) => {
      if (!res.confirm) return;
      const dueAt = (res.content ?? '').trim();
      void runAct('triage', item, dueAt ? { decision: 'schedule', dueAt } : { decision: 'schedule' });
    },
  });
}

/** 发布评审：通过并发布，或打回开发中。 */
function runReview(item: SuiteDomainItemDto): void {
  if (!requireLogin()) return;
  uni.showActionSheet({
    itemList: ['评审通过并发布', '打回开发中'],
    success: (res) => {
      if (res.tapIndex === 0) {
        void runAct('review', item, { decision: 'pass' });
        return;
      }
      uni.showModal({
        title: '打回开发中',
        content: '写一句打回意见（可留空）',
        editable: true,
        placeholderText: '例如 交互与设计稿不一致',
        confirmText: '打回',
        success: (modalRes) => {
          if (!modalRes.confirm) return;
          const note = (modalRes.content ?? '').trim();
          void runAct('review', item, note ? { decision: 'reject', reviewNote: note } : { decision: 'reject' });
        },
      });
    },
  });
}

/** 估点：填所属迭代与工作量点数。 */
function runEstimate(item: SuiteDomainItemDto): void {
  if (!requireLogin()) return;
  const currentSprint = sprintOf(item);
  uni.showModal({
    title: '估点 · 所属迭代',
    content: '填写条目归属的迭代编号',
    editable: true,
    placeholderText: currentSprint ? `当前 ${currentSprint}` : '例如 S12',
    confirmText: '下一步',
    success: (res) => {
      if (!res.confirm) return;
      const sprint = (res.content ?? '').trim() || currentSprint;
      if (!sprint) {
        toast('请填写所属迭代，例如 S12');
        return;
      }
      const currentPoints = pointsOf(item);
      uni.showModal({
        title: '估点 · 工作量点数',
        content: '填写工作量点数（正整数）',
        editable: true,
        placeholderText: currentPoints > 0 ? `当前 ${currentPoints}` : '例如 3',
        confirmText: '估点',
        success: (pointsRes) => {
          if (!pointsRes.confirm) return;
          const points = Number((pointsRes.content ?? '').trim());
          if (!Number.isInteger(points) || points <= 0) {
            toast('工作量点数需要是正整数');
            return;
          }
          void runAct('estimate', item, { sprint, points });
        },
      });
    },
  });
}

/** 查看燃尽：拿到快照后用数字块与比例条展示。 */
async function runBurndown(sprint: string): Promise<void> {
  if (!requireLogin()) return;
  const key = `burndown:${sprint || 'current'}`;
  if (busy.value === key) return;
  busy.value = key;
  try {
    const res = await suiteApi.act('product', {
      action: 'burndown',
      ...(sprint ? { payload: { sprint } } : {}),
    });
    toast(res.message);
    if (res.ok) burndown.value = toBurndownView(res.data);
  } catch (e) {
    toast(errorText(e, '燃尽没算出来，稍后再试一次'));
  } finally {
    busy.value = '';
  }
}

/** 燃尽返回值 → 展示口径。 */
function toBurndownView(data: Record<string, unknown> | undefined): BurndownView | null {
  if (!data) return null;
  const raw = data['byStage'];
  const byStage: Record<string, unknown> =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const stageDefs = [
    { key: 'idea', label: '未开始' },
    { key: 'planned', label: '已排期' },
    { key: 'doing', label: '开发中' },
    { key: 'review', label: '待验收' },
    { key: 'done', label: '已发布' },
  ];
  return {
    sprint: typeof data['sprint'] === 'string' ? data['sprint'] : '',
    total: Number(data['total'] ?? 0),
    done: Number(data['done'] ?? 0),
    remaining: Number(data['remaining'] ?? 0),
    stages: stageDefs.map((stage) => ({
      key: stage.key,
      label: stage.label,
      value: Number(byStage[stage.key] ?? 0),
    })),
  };
}

/** 空态的下一步：建一条需求，先落进需求池再估点。 */
function createRequirement(): void {
  if (!requireLogin()) return;
  uni.showModal({
    title: '新建需求',
    content: '给这条需求起个标题',
    editable: true,
    placeholderText: '例如 支持导出季度报表',
    confirmText: '创建',
    success: (res) => {
      if (!res.confirm) return;
      const title = (res.content ?? '').trim();
      if (!title) {
        toast('请填写需求标题');
        return;
      }
      void (async () => {
        try {
          const result = await suiteApi.act('product', { action: 'create', payload: { title } });
          toast(result.message);
          await load();
        } catch (e) {
          toast(errorText(e, '创建失败，稍后再试一次'));
        }
      })();
    },
  });
}

/** 登记缺陷：先填标题，再定严重级别（P0–P3）。 */
function registerDefect(): void {
  if (!requireLogin()) return;
  uni.showModal({
    title: '登记缺陷',
    content: '填写缺陷标题',
    editable: true,
    placeholderText: '例如 导出报表出现乱码',
    confirmText: '下一步',
    success: (res) => {
      if (!res.confirm) return;
      const title = (res.content ?? '').trim();
      if (!title) {
        toast('请填写缺陷标题');
        return;
      }
      uni.showActionSheet({
        itemList: ['P0 主干不可用或数据风险', 'P1 核心路径被阻断', 'P2 局部功能异常', 'P3 体验与文案问题'],
        success: (sheet) => {
          const severities = ['P0', 'P1', 'P2', 'P3'];
          const severity = severities[sheet.tapIndex];
          if (!severity) return;
          void (async () => {
            try {
              const result = await suiteApi.act('product', {
                action: 'defect',
                payload: { title, severity },
              });
              toast(result.message);
              await load();
            } catch (e) {
              toast(errorText(e, '缺陷登记失败，稍后再试一次'));
            }
          })();
        },
      });
    },
  });
}

function onNeedLogin(): void {
  goTo(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.suiteProduct)}`);
}

onMounted(() => {
  void load();
});

applySuiteSeo({
  title: '产品研发 · MixmAPP 业务套件',
  description: '需求、缺陷与迭代燃尽，产品决策有据可依。',
  path: ROUTES.suiteProduct,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: '产品研发 · MixmAPP 业务套件',
    description: '需求、缺陷与迭代燃尽，产品决策有据可依。',
    inLanguage: 'zh-CN',
  },
});
</script>

<style scoped lang="scss">
.panel {
  margin: 0 $sp-4 $sp-4;
  padding: $sp-4;
  border-radius: $r-card;
  background: $shell;
  border: 1rpx solid $paper-3;
}

.panel__head {
  margin-bottom: $sp-3;
}

.panel__lead {
  display: block;
  margin-top: 8rpx;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-3;
}

.panel__ops {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: $sp-3;
}

.panel__cta {
  margin-top: $sp-2;
  min-width: 280rpx;
}

/* ---------- 指标条 ---------- */
.metrics {
  display: flex;
  flex-wrap: wrap;
  gap: $sp-2;
  margin-bottom: $sp-3;
}

.metric {
  flex: 1 1 200rpx;
  min-width: 180rpx;
  padding: $sp-2 $sp-3;
  border-radius: $r-control;
  background: $paper-2;
}

.metric__value {
  display: block;
  font-size: $fs-h3;
  font-weight: 800;
  color: $ink;
  line-height: 1.2;
}

.metric__label {
  display: block;
  margin-top: 6rpx;
  font-size: $fs-micro;
  color: $ink-3;
}

/* ---------- 迭代分组 ---------- */
.sprint {
  padding: $sp-3;
  margin-bottom: $sp-3;
  border: 1rpx solid $paper-3;
}

.sprint__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $sp-2;
}

.sprint__title {
  flex: 1;
  min-width: 0;
}

.sprint__name {
  display: block;
  font-size: $fs-meta;
  font-weight: 700;
  color: $ink;
}

.sprint__count {
  display: block;
  margin-top: 6rpx;
  font-size: $fs-micro;
  color: $ink-3;
}

.sprint__btn {
  flex: 0 0 auto;
  min-width: 160rpx;
}

.sprint__bar {
  height: 12rpx;
  margin-top: $sp-2;
  border-radius: $r-xs;
  background: $paper-2;
  overflow: hidden;
}

.sprint__bar-done {
  height: 100%;
  border-radius: $r-xs;
  background: $brand;
}

.sprint__items {
  margin-top: $sp-2;
}

/* ---------- 条目 ---------- */
.item {
  padding-top: $sp-3;
  margin-top: $sp-3;
  border-top: 1rpx solid $paper-3;
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
  font-size: $fs-meta;
  font-weight: 600;
  color: $ink;
  line-height: $lh-snug;
}

.item__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  flex: 0 0 auto;
}

.item__meta {
  margin-top: $sp-2;
  padding: $sp-2;
  border-radius: $r-control;
  background: $paper-2;
}

.item__meta-row {
  display: flex;
  justify-content: space-between;
  gap: $sp-2;
  padding: 2rpx 0;
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
  gap: 12rpx;
  margin-top: $sp-2;
}

/* ---------- 燃尽块 ---------- */
.burndown {
  padding: $sp-3;
  border: 1rpx solid $paper-3;
}

.burndown__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $sp-2;
  flex-wrap: wrap;
}

.burndown__title {
  font-size: $fs-h3;
}

.burndown__bar {
  height: 16rpx;
  margin-top: $sp-2;
  border-radius: $r-xs;
  background: $paper-2;
  overflow: hidden;
}

.burndown__bar-done {
  height: 100%;
  border-radius: $r-xs;
  background: $brand;
}

.burndown__grid {
  display: flex;
  flex-wrap: wrap;
  gap: $sp-2;
  margin-top: $sp-3;
}

.burndown__cell {
  flex: 1 1 160rpx;
  min-width: 140rpx;
  text-align: center;
}

.burndown__value {
  display: block;
  font-size: $fs-h3;
  font-weight: 800;
  color: $ink;
  line-height: 1.2;
}

.burndown__label {
  display: block;
  margin-top: 4rpx;
  font-size: $fs-micro;
  color: $ink-3;
}
</style>
