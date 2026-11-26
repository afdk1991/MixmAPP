<template>
  <suite-detail-shell :content="content" @need-login="onNeedLogin">
    <!--
      效率工具的动态面板：待办条目 + 专注计时 + 习惯打卡 + 计划时段。
      正文是静态内容包，渲染不依赖任何请求；这里的台账异步加载，失败也不阻断正文。
    -->
    <template #dynamic>
      <view class="panel">
        <view class="panel__head">
          <text class="eyebrow">效率台账</text>
          <text class="panel__lead">
            待办、专注次数与习惯打卡都记在服务端台账里，切换设备后仍然对得上账。
          </text>
          <view class="panel__ops">
            <view
              class="btn btn--sm btn--ghost"
              hover-class="is-press"
              role="button"
              aria-label="新建一条待办"
              @tap="createTodo"
            >
              <text>新建待办</text>
            </view>
          </view>
        </view>

        <!-- 领域指标：今日待办数 / 累计专注次数 / 连续打卡天数（服务端有数据才给） -->
        <view v-if="metrics.length" class="metrics">
          <view v-for="m in metrics" :key="m.label" class="metric">
            <text class="metric__value mono">{{ m.value }}</text>
            <text class="metric__label">{{ m.label }}</text>
          </view>
        </view>

        <!-- 三态：加载中 / 出错可重试 / 空态给下一步 -->
        <mx-state v-if="loading" variant="loading" title="正在读取效率台账…" />
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
          title="还没有待办条目"
          text="先新建一条待办，再用「专注一次」记录投入、用「打卡」记录习惯的坚持。"
        >
          <view
            class="btn btn--primary btn--sm panel__cta"
            hover-class="is-press"
            role="button"
            aria-label="新建第一条待办"
            @tap="createTodo"
          >
            <text>新建第一条待办</text>
          </view>
        </mx-state>

        <!-- 待办条目 -->
        <view v-else class="items">
          <view v-for="item in items" :key="item.id" class="sheet sheet--flat item">
            <view class="item__head">
              <text class="item__title">{{ item.title }}</text>
              <text class="tag item__stage">{{ item.stageLabel }}</text>
            </view>

            <text class="item__summary">{{ item.summary }}</text>

            <!-- 进度条：读服务端 suite_progress 的 value -->
            <view class="item__bar">
              <view class="item__bar-fill" :style="barStyle(item)" />
            </view>
            <text class="micro item__bar-text">{{ progressText(item) }}</text>

            <view v-if="item.meta && item.meta.length" class="item__meta">
              <view v-for="m in item.meta" :key="m.label" class="item__meta-row">
                <text class="item__meta-label">{{ m.label }}</text>
                <text class="item__meta-value">{{ m.value }}</text>
              </view>
            </view>

            <view class="item__acts">
              <view
                class="btn btn--sm btn--ghost"
                :class="{ 'btn--disabled': busy === `focus:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`对${item.title}记一次专注`"
                @tap="runFocus(item)"
              >
                <text>{{ busy === `focus:${item.id}` ? '记录中' : '专注一次' }}</text>
              </view>

              <view
                v-if="item.stage !== 'done'"
                class="btn btn--sm btn--primary"
                :class="{ 'btn--disabled': busy === `complete:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`把${item.title}标记为已完成`"
                @tap="runComplete(item)"
              >
                <text>{{ busy === `complete:${item.id}` ? '提交中' : '完成' }}</text>
              </view>

              <view
                class="btn btn--sm btn--ghost"
                :class="{ 'btn--disabled': busy === `habit:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`为${habitOf(item)}打卡`"
                @tap="runHabitCheck(item)"
              >
                <text>{{ busy === `habit:${item.id}` ? '打卡中' : '打卡' }}</text>
              </view>

              <view
                class="btn btn--sm btn--ghost"
                :class="{ 'btn--disabled': busy === `plan:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`给${item.title}安排计划时段`"
                @tap="runPlan(item)"
              >
                <text>安排时段</text>
              </view>
            </view>
          </view>
        </view>

        <text class="micro panel__foot">待办、专注与打卡数据都按登录账号保存在服务端台账里</text>
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
 * 效率工具领域页。
 *
 * 正文与清单来自构建期内联的内容包（首屏零请求），
 * 动态面板走 /suite/domains/productivity/items 与 /suite/domains/productivity/stats：
 * 待办条目、专注计时、习惯打卡与计划时段都落在服务端台账里。
 */
const content = getSuiteContent('productivity');

/** 进度状态中文名，与服务端 suite_progress 的状态机一致。 */
const PROGRESS_LABEL: Record<string, string> = {
  todo: '未开始',
  doing: '进行中',
  done: '已完成',
  archived: '已归档',
};

type ProgressView = { status: string; value: number };

const items = ref<SuiteDomainItemDto[]>([]);
const metrics = ref<Array<{ label: string; value: string; hint?: string }>>([]);
/** 条目 id → 进度行（读 suite_progress 用来画进度条） */
const progressMap = ref<Record<string, ProgressView>>({});
const loading = ref(true);
const error = ref('');
/** 正在执行的动作标识（动作:条目），用于按钮态与防连点 */
const busy = ref('');

const signedIn = computed(() => isLoggedIn());

/** 登录引导：未登录点动作时先跳登录页，并带回本页 redirect。 */
function onNeedLogin(): void {
  goTo(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.suiteProductivity)}`);
}

/** 写操作前的登录门禁：未登录不发写请求。 */
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

/* ---------- 取值 ---------- */

/** 本地时区的 YYYY-MM-DD（打卡日期按客户端当天算）。 */
function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** 条目上的关联习惯；没写就用条目标题兜底，保证打卡动作始终可执行。 */
function habitOf(item: SuiteDomainItemDto): string {
  const habit = item.payload['habit'];
  if (typeof habit === 'string' && habit.trim()) return habit.trim();
  return item.title.trim();
}

/** 条目上的计划时段。 */
function slotOf(item: SuiteDomainItemDto): string {
  const slot = item.payload['slot'];
  return typeof slot === 'string' ? slot.trim() : '';
}

/** 该条目当前的进度（未记录进度时按 0 计）。 */
function progressOf(item: SuiteDomainItemDto): ProgressView {
  return progressMap.value[item.id] ?? { status: 'todo', value: 0 };
}

/** 进度条宽度样式。 */
function barStyle(item: SuiteDomainItemDto): Record<string, string> {
  const value = Math.max(0, Math.min(100, progressOf(item).value));
  return { width: `${value}%` };
}

/** 进度条旁的读数：百分比 + 状态。 */
function progressText(item: SuiteDomainItemDto): string {
  const progress = progressOf(item);
  const label = PROGRESS_LABEL[progress.status] ?? progress.status;
  return `投入进度 ${progress.value}% · ${label}`;
}

/* ---------- 加载 ---------- */

/** 读进度行；读失败只影响进度条，不影响列表。 */
async function loadProgress(): Promise<void> {
  try {
    const rows = await suiteApi.progress('productivity');
    const map: Record<string, ProgressView> = {};
    for (const row of Array.isArray(rows) ? rows : []) {
      map[row.entryId] = {
        status: row.status,
        value: Math.max(0, Math.min(100, row.value)),
      };
    }
    progressMap.value = map;
  } catch {
    progressMap.value = {};
  }
}

/** 拉条目与领域指标；失败只影响这一块，不阻断静态正文。 */
async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [list, stats] = await Promise.all([
      suiteApi.items('productivity'),
      suiteApi.stats('productivity'),
    ]);
    items.value = Array.isArray(list) ? list : [];
    metrics.value = Array.isArray(stats?.metrics) ? stats.metrics : [];
  } catch (e) {
    items.value = [];
    error.value = errorText(e, '效率台账加载失败，请稍后再试');
  }
  await loadProgress();
  loading.value = false;
}

/** 动作之后的静默刷新：不重置 loading，避免列表整块闪回骨架。 */
async function refresh(): Promise<void> {
  try {
    const [list, stats] = await Promise.all([
      suiteApi.items('productivity'),
      suiteApi.stats('productivity'),
    ]);
    items.value = Array.isArray(list) ? list : [];
    metrics.value = Array.isArray(stats?.metrics) ? stats.metrics : [];
  } catch {
    // 动作已经成功，刷新失败不再打扰用户，下一次进入页面会重新拉。
  }
  await loadProgress();
}

/* ---------- 动作 ---------- */

/**
 * 动作成功后把进度写进 suite_progress：
 * 状态与完成度取服务端返回的 data（专注按次数换算，完成直接满一百）。
 */
async function syncProgress(entryId: string | undefined, res: SuiteActionResultDto): Promise<void> {
  if (!entryId) return;
  const data = res.data ?? {};
  const value = Number(data['value']);
  const status = String(data['status'] ?? '');
  if (!Number.isFinite(value) || !status) return;
  if (status !== 'todo' && status !== 'doing' && status !== 'done' && status !== 'archived') return;
  try {
    await suiteApi.setProgress({
      domainId: 'productivity',
      entryId,
      status,
      value: Math.max(0, Math.min(100, value)),
    });
  } catch {
    // 进度写入失败不影响主流程，刷新时会从服务端重新读回。
  }
}

/**
 * 统一执行领域动作：未登录不发写请求，成功后用服务端返回的 message 轻提示，
 * 并刷新列表、统计与进度。
 */
async function run(input: SuiteActionInput, key: string): Promise<void> {
  if (!requireLogin()) return;
  if (busy.value === key) return;
  busy.value = key;
  try {
    const res = await suiteApi.act('productivity', input);
    toast(res.message || (res.changed ? '已完成' : '没有变化'));
    if (res.ok) await syncProgress(input.entryId, res);
    await refresh();
  } catch (e) {
    toast(errorText(e, '操作没成功，稍后再试'));
  } finally {
    busy.value = '';
  }
}

/** 专注一次：focusAt 用当前时刻作幂等键，重复提交不会重复计时长。 */
function runFocus(item: SuiteDomainItemDto): void {
  const focusAt = new Date().toISOString();
  void run({ action: 'focus', entryId: item.id, payload: { focusAt } }, `focus:${item.id}`);
}

/** 完成：条目收口成已完成，进度写满一百。 */
function runComplete(item: SuiteDomainItemDto): void {
  void run({ action: 'complete', entryId: item.id }, `complete:${item.id}`);
}

/** 打卡：习惯名取条目上的关联习惯，打卡日期取今天。 */
function runHabitCheck(item: SuiteDomainItemDto): void {
  void run(
    {
      action: 'habit_check',
      entryId: item.id,
      payload: { habit: habitOf(item), checkinDate: todayKey() },
    },
    `habit:${item.id}`,
  );
}

/** 时段起点 → 今天的 ISO 时刻；解析不出来就不带 at（服务端会清空到期时间）。 */
function slotStartIso(slot: string): string | null {
  const matched = /^(\d{1,2}):(\d{2})/.exec(slot.trim());
  if (!matched) return null;
  const hours = Number(matched[1]);
  const minutes = Number(matched[2]);
  if (hours > 23 || minutes > 59) return null;
  const start = new Date();
  start.setHours(hours, minutes, 0, 0);
  return start.toISOString();
}

/** 安排时段：填一个时段字符串（形如 09:30-11:00），到期时间取时段起点。 */
function runPlan(item: SuiteDomainItemDto): void {
  if (!requireLogin()) return;
  const current = slotOf(item);
  uni.showModal({
    title: '安排时段',
    content: '填写这一条待办的计划时段',
    editable: true,
    placeholderText: current || '例如 09:30-11:00',
    confirmText: '安排',
    success: (res) => {
      if (!res.confirm) return;
      const slot = (res.content ?? '').trim();
      if (!slot) {
        toast('请填写计划时段，例如 09:30-11:00');
        return;
      }
      const at = slotStartIso(slot);
      void run(
        {
          action: 'plan',
          entryId: item.id,
          payload: { slot },
          ...(at ? { at } : {}),
        },
        `plan:${item.id}`,
      );
    },
  });
}

/** 新建一条待办（进入待办阶段）。 */
function createTodo(): void {
  if (!requireLogin()) return;
  uni.showModal({
    title: '新建待办',
    content: '给这条待办起一个标题',
    editable: true,
    placeholderText: '例如 整理季度复盘材料',
    confirmText: '创建',
    success: (res) => {
      if (!res.confirm) return;
      const title = (res.content ?? '').trim();
      if (!title) {
        toast('先写上待办标题');
        return;
      }
      void run({ action: 'create', note: title, payload: { title } }, 'create');
    },
  });
}

onMounted(() => {
  void load();
});

applySuiteSeo({
  title: '效率工具 · MixmAPP 业务套件',
  description: '待办清单、专注计时与习惯打卡，把计划落成节奏。',
  path: ROUTES.suiteProductivity,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: '效率工具 · MixmAPP 业务套件',
    description: '待办清单、专注计时与习惯打卡，把计划落成节奏。',
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

.panel__foot {
  display: block;
  margin-top: $sp-3;
  text-align: center;
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

/* ---------- 条目 ---------- */
.items {
  display: flex;
  flex-direction: column;
  gap: $sp-3;
}

.item {
  padding: $sp-3;
  border: 1rpx solid $paper-3;
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
  line-height: $lh-snug;
}

.item__stage {
  flex: 0 0 auto;
}

.item__summary {
  display: block;
  margin-top: 12rpx;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

/* ---------- 进度条 ---------- */
.item__bar {
  height: 12rpx;
  margin-top: $sp-3;
  border-radius: $r-xs;
  background: $paper-2;
  overflow: hidden;
}

.item__bar-fill {
  height: 100%;
  border-radius: $r-xs;
  background: $brand;
}

.item__bar-text {
  display: block;
  margin-top: 8rpx;
  color: $ink-3;
}

/* ---------- meta ---------- */
.item__meta {
  margin-top: $sp-3;
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

/* ---------- 操作 ---------- */
.item__acts {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: $sp-3;
}
</style>
