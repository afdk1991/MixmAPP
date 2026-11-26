<template>
  <suite-detail-shell :content="content" @need-login="onShellNeedLogin">
    <!-- 办公管理动态面板：任务看板 + 审核区 + 会议纪要台账 -->
    <template #dynamic>
      <view class="office">
        <!-- 指标条：待审核 / 本周完成 / 平均办理时长（服务端有数据才给） -->
        <view v-if="metrics.length" class="office-metrics">
          <view v-for="m in metrics" :key="m.label" class="office-metric">
            <text class="office-metric-label">{{ m.label }}</text>
            <text class="office-metric-value mono">{{ m.value }}</text>
          </view>
        </view>

        <!-- 会议纪要台账 -->
        <view class="sheet office-compose">
          <text class="sec-title office-compose__title">记一笔会议纪要</text>
          <text class="hint office-compose__hint">标题、参与人与决议写进台账；同一场会重复提交只记一条。</text>
          <input
            v-model="noteTitle"
            class="field"
            placeholder="会议纪要标题，例如：产品周例会"
            placeholder-class="field-ph"
          />
          <input
            v-model="noteParticipants"
            class="field office-compose__field"
            placeholder="参与人（顿号分隔，可留空）"
            placeholder-class="field-ph"
          />
          <textarea
            v-model="noteDecisions"
            class="field field--area office-compose__area"
            placeholder="决议条目（每行一条，可留空）"
            placeholder-class="field-ph"
          />
          <view
            class="btn btn--primary office-compose__btn"
            :class="{ 'btn--disabled': busy === 'meeting' }"
            hover-class="is-press"
            role="button"
            aria-label="记一笔会议纪要"
            @tap="submitMeetingNote"
          >
            <text>{{ busy === 'meeting' ? '记录中' : '记一笔会议纪要' }}</text>
          </view>
        </view>

        <!-- 任务看板 -->
        <view class="office-head">
          <text class="sec-title office-head__title">任务看板</text>
          <text class="micro office-head__count">{{ items.length }} 条记录</text>
        </view>

        <mx-state v-if="loading" variant="loading" title="正在读取任务看板…" />
        <mx-state
          v-else-if="error"
          variant="error"
          title="看板没打开"
          :text="error"
          action-text="重新加载"
          @action="load"
        />
        <mx-state
          v-else-if="items.length === 0"
          variant="empty"
          title="还没有任务记录"
          text="先在上面记一笔会议纪要，或在下面新建一条待办；看板按待处理、办理中、待审核、已完成四态推进。"
        >
          <view
            v-if="!signedIn"
            class="btn btn--deep office-state-btn"
            hover-class="is-press"
            role="button"
            aria-label="登录后查看我的任务看板"
            @tap="onNeedLogin"
          >
            <text>登录后查看我的看板</text>
          </view>
        </mx-state>

        <view v-else class="office-items">
          <view v-for="item in items" :key="item.id" class="sheet office-item">
            <view class="office-item__head">
              <text class="office-item__title">{{ item.title }}</text>
              <text class="tag office-item__stage">{{ item.stageLabel }}</text>
            </view>

            <text class="office-item__summary">{{ item.summary }}</text>

            <view v-if="item.meta && item.meta.length" class="office-item__meta">
              <view v-for="m in item.meta" :key="m.label" class="office-item__meta-row">
                <text class="office-item__meta-label">{{ m.label }}</text>
                <text class="office-item__meta-value">{{ m.value }}</text>
              </view>
            </view>

            <!-- 任务自带清单时，可直接记录完成率 -->
            <view v-if="checklistOf(item).length" class="office-item__checklist">
              <text class="label">行动清单</text>
              <view v-for="(c, i) in checklistOf(item)" :key="i" class="office-item__check">
                <view class="office-item__check-box" />
                <text class="office-item__check-text">{{ c }}</text>
              </view>
              <view class="office-item__progress">
                <input
                  v-model="checkedMap[item.id]"
                  class="field office-item__progress-input"
                  type="number"
                  placeholder="已完成条数"
                  placeholder-class="field-ph"
                />
                <view
                  class="btn btn--sm btn--ghost office-act"
                  :class="{ 'btn--disabled': busy === `checklist:${item.id}` }"
                  hover-class="is-press"
                  role="button"
                  :aria-label="`记录${item.title}的清单完成率`"
                  @tap="submitChecklist(item)"
                >
                  <text>记录完成率</text>
                </view>
              </view>
            </view>

            <view class="office-item__actions">
              <view
                v-if="item.stage !== 'done' && item.stage !== 'review'"
                class="btn btn--sm btn--ghost office-act"
                :class="{ 'btn--disabled': busy === `advance:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`推进${item.title}到下一阶段`"
                @tap="advance(item)"
              >
                <text>{{ busy === `advance:${item.id}` ? '推进中' : '推进到下一阶段' }}</text>
              </view>

              <!-- 审核区：只有停在待审核的条目才给通过 / 驳回 -->
              <view
                v-if="item.stage === 'review'"
                class="btn btn--sm btn--primary office-act"
                :class="{ 'btn--disabled': busy === `approve:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`通过${item.title}`"
                @tap="approve(item)"
              >
                <text>{{ busy === `approve:${item.id}` ? '提交中' : '通过' }}</text>
              </view>
              <view
                v-if="item.stage === 'review' && rejectingId !== item.id"
                class="btn btn--sm btn--ghost office-act"
                hover-class="is-press"
                role="button"
                :aria-label="`驳回${item.title}`"
                @tap="startReject(item)"
              >
                <text>驳回</text>
              </view>
            </view>

            <!-- 驳回必须先写原因 -->
            <view v-if="rejectingId === item.id" class="office-reject">
              <text class="label">驳回原因（必填）</text>
              <textarea
                v-model="rejectNote"
                class="field field--area office-reject__area"
                placeholder="写清哪个环节不符合要求，办理人才知道改什么"
                placeholder-class="field-ph"
              />
              <view class="office-reject__actions">
                <view
                  class="btn btn--sm btn--ghost office-act"
                  hover-class="is-press"
                  role="button"
                  aria-label="取消驳回"
                  @tap="cancelReject"
                >
                  <text>取消</text>
                </view>
                <view
                  class="btn btn--sm btn--primary office-act"
                  :class="{ 'btn--disabled': busy === `reject:${item.id}` }"
                  hover-class="is-press"
                  role="button"
                  aria-label="提交驳回"
                  @tap="submitReject(item)"
                >
                  <text>提交驳回</text>
                </view>
              </view>
            </view>
          </view>
        </view>

        <!-- 新建待办 -->
        <view class="sheet office-compose">
          <text class="sec-title office-compose__title">新建一条待办</text>
          <input v-model="taskTitle" class="field" placeholder="任务标题" placeholder-class="field-ph" />
          <input
            v-model="taskOwner"
            class="field office-compose__field"
            placeholder="负责人（可留空）"
            placeholder-class="field-ph"
          />
          <input
            v-model="taskDeadline"
            class="field office-compose__field"
            placeholder="期限，如 2026-12-01（可留空）"
            placeholder-class="field-ph"
          />
          <textarea
            v-model="taskChecklist"
            class="field field--area office-compose__area"
            placeholder="行动清单（每行一条，可留空）"
            placeholder-class="field-ph"
          />
          <view
            class="btn btn--primary office-compose__btn"
            :class="{ 'btn--disabled': busy === 'create' }"
            hover-class="is-press"
            role="button"
            aria-label="新建待办任务"
            @tap="submitTask"
          >
            <text>{{ busy === 'create' ? '创建中' : '新建待办' }}</text>
          </view>
        </view>

        <text class="micro office-foot">任务、纪要与清单进度都按登录账号保存在服务端台账里</text>
      </view>
    </template>
  </suite-detail-shell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { SuiteActionInput, SuiteDomainItemDto } from '@mixmapp/contracts';
import SuiteDetailShell from '../../components/suite/suite-detail-shell.vue';
import MxState from '../../components/mx-state/mx-state.vue';
import { suiteApi } from '../../api/suite';
import { getSuiteContent } from '../../content/suite';
import { goTo } from '../../navigation';
import { ROUTES } from '../../routes';
import { applySuiteSeo } from '../../site-seo';
import { isLoggedIn } from '../../stores/session';

/**
 * 办公管理领域页。
 *
 * 正文与清单来自构建期内联的内容包（首屏零请求），
 * 动态面板走 /suite/domains/office/items 与 /suite/domains/office/actions：
 * 任务看板、审核（通过 / 驳回）、会议纪要台账、清单完成率。
 */
const content = getSuiteContent('office');

type Metric = { label: string; value: string; hint?: string };

const items = ref<SuiteDomainItemDto[]>([]);
const metrics = ref<Metric[]>([]);
const loading = ref(true);
const error = ref('');
/** 正在执行的动作标识（按条目区分），用于按钮态与防连点 */
const busy = ref('');

/** 会议纪要表单 */
const noteTitle = ref('');
const noteParticipants = ref('');
const noteDecisions = ref('');

/** 新建待办表单 */
const taskTitle = ref('');
const taskOwner = ref('');
const taskDeadline = ref('');
const taskChecklist = ref('');

/** 驳回中的条目与原因 */
const rejectingId = ref('');
const rejectNote = ref('');

/** 清单完成数（按条目记） */
const checkedMap = ref<Record<string, string>>({});

const signedIn = computed(() => isLoggedIn());

/** 登录引导：未登录点动作时先跳登录页，并带回本页 redirect。 */
function onNeedLogin(): void {
  goTo(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.suiteOffice)}`);
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

/** 拉任务看板与领域指标；失败只影响这一块，不阻断静态正文。 */
async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [list, stats] = await Promise.all([suiteApi.items('office'), suiteApi.stats('office')]);
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
    const [list, stats] = await Promise.all([suiteApi.items('office'), suiteApi.stats('office')]);
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
async function run(input: SuiteActionInput, key: string): Promise<void> {
  if (!isLoggedIn()) {
    onNeedLogin();
    return;
  }
  busy.value = key;
  try {
    const res = await suiteApi.act('office', input);
    toast(res.message || (res.changed ? '已完成' : '没有变化'));
    await refresh();
  } catch (e) {
    toast(e instanceof Error ? e.message : '操作没成功，稍后再试');
  } finally {
    busy.value = '';
  }
}

/** 推进到下一阶段（待处理 → 办理中 → 待审核 → 已完成）。 */
function advance(item: SuiteDomainItemDto): void {
  void run({ action: 'advance', entryId: item.id }, `advance:${item.id}`);
}

/** 审核通过：待审核 → 已完成。 */
function approve(item: SuiteDomainItemDto): void {
  void run({ action: 'review', entryId: item.id, payload: { decision: 'approve' } }, `approve:${item.id}`);
}

/** 驳回：先填原因，再提交。 */
function startReject(item: SuiteDomainItemDto): void {
  rejectingId.value = item.id;
  rejectNote.value = '';
}

function cancelReject(): void {
  rejectingId.value = '';
  rejectNote.value = '';
}

function submitReject(item: SuiteDomainItemDto): void {
  const note = rejectNote.value.trim();
  if (!note) {
    toast('驳回要写明原因，方便对方照着改');
    return;
  }
  cancelReject();
  void run(
    { action: 'review', entryId: item.id, payload: { decision: 'reject', reviewNote: note } },
    `reject:${item.id}`,
  );
}

/** 记一笔会议纪要：标题必填，参与人与决议可留空。 */
function submitMeetingNote(): void {
  const title = noteTitle.value.trim();
  if (!title) {
    toast('先写上会议纪要标题');
    return;
  }
  const participants = noteParticipants.value
    .split(/[\r\n、,，;；]+/)
    .map((v) => v.trim())
    .filter((v) => v !== '');
  const decisions = noteDecisions.value
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter((v) => v !== '');
  void run(
    { action: 'meeting_note', payload: { title, participants, decisions } },
    'meeting',
  );
  noteTitle.value = '';
  noteParticipants.value = '';
  noteDecisions.value = '';
}

/** 新建一条待办：进入待处理阶段。 */
function submitTask(): void {
  const title = taskTitle.value.trim();
  if (!title) {
    toast('先写上任务标题');
    return;
  }
  const owner = taskOwner.value.trim();
  const deadline = taskDeadline.value.trim();
  const checklist = taskChecklist.value
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter((v) => v !== '');
  void run(
    {
      action: 'create',
      note: title,
      payload: {
        title,
        ...(owner ? { owner } : {}),
        ...(deadline ? { deadline } : {}),
        ...(checklist.length ? { checklist } : {}),
      },
    },
    'create',
  );
  taskTitle.value = '';
  taskOwner.value = '';
  taskDeadline.value = '';
  taskChecklist.value = '';
}

/** 条目自带的行动清单（由建单时写入 payload）。 */
function checklistOf(item: SuiteDomainItemDto): string[] {
  const raw = item.payload['checklist'];
  if (Array.isArray(raw)) {
    return raw.map((v) => (typeof v === 'string' ? v.trim() : '')).filter((v) => v !== '');
  }
  if (typeof raw === 'string') {
    return raw
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter((v) => v !== '');
  }
  return [];
}

/** 记录清单完成率：完成条数 ÷ 清单总条数。 */
function submitChecklist(item: SuiteDomainItemDto): void {
  const checklist = checklistOf(item);
  if (!checklist.length) return;
  const parsed = Number.parseInt(checkedMap.value[item.id] ?? '0', 10);
  const checked = Number.isFinite(parsed) ? parsed : 0;
  void run(
    { action: 'checklist_progress', entryId: item.id, payload: { checklist, checked } },
    `checklist:${item.id}`,
  );
}

onMounted(() => {
  void load();
});

applySuiteSeo({
  title: '办公管理 · MixmAPP 业务套件',
  description: '任务看板、审批流转与会议纪要，一处推进到底。',
  path: ROUTES.suiteOffice,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: '办公管理 · MixmAPP 业务套件',
    description: '任务看板、审批流转与会议纪要，一处推进到底。',
    inLanguage: 'zh-CN',
  },
});
</script>

<style scoped lang="scss">
.office {
  margin: 0 $sp-4 $sp-4;
  display: flex;
  flex-direction: column;
  gap: $sp-3;
}

/* ---------- 指标条 ---------- */
.office-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: $sp-2;
}

.office-metric {
  flex: 1 1 30%;
  min-width: 200rpx;
  padding: $sp-3;
  border-radius: $r-card;
  background: $paper-2;
}

.office-metric-label {
  display: block;
  font-size: $fs-micro;
  color: $ink-3;
}

.office-metric-value {
  display: block;
  margin-top: 6rpx;
  font-size: $fs-h3;
  font-weight: 800;
  color: $acc-1;
}

/* ---------- 表单卡 ---------- */
.office-compose {
  padding: $sp-4;
}

.office-compose__title {
  font-size: $fs-h3;
}

.office-compose__hint {
  margin: 8rpx 0 $sp-3;
}

.office-compose__field {
  margin-top: $sp-2;
}

.office-compose__area {
  margin-top: $sp-2;
  min-height: 160rpx;
}

.office-compose__btn {
  margin-top: $sp-3;
  width: 100%;
}

/* ---------- 看板 ---------- */
.office-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $sp-2;
  padding-top: $sp-2;
}

.office-head__title {
  font-size: $fs-h3;
}

.office-head__count {
  flex: 0 0 auto;
}

.office-items {
  display: flex;
  flex-direction: column;
  gap: $sp-3;
}

.office-item {
  padding: $sp-4;
}

.office-item__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $sp-2;
}

.office-item__title {
  flex: 1;
  min-width: 0;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  color: $ink;
}

.office-item__stage {
  flex: 0 0 auto;
}

.office-item__summary {
  display: block;
  margin-top: 12rpx;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

.office-item__meta {
  margin-top: $sp-3;
  padding: $sp-3;
  border-radius: $r-control;
  background: $paper-2;
}

.office-item__meta-row {
  display: flex;
  justify-content: space-between;
  gap: $sp-3;
  padding: 4rpx 0;
}

.office-item__meta-label {
  flex: 0 0 auto;
  font-family: $font-mono;
  font-size: $fs-micro;
  color: $ink-4;
}

.office-item__meta-value {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: $fs-micro;
  color: $ink-2;
}

.office-item__checklist {
  margin-top: $sp-3;
  padding: $sp-3;
  border-radius: $r-control;
  background: $paper-2;
}

.office-item__check {
  display: flex;
  align-items: baseline;
  gap: 14rpx;
  padding: 6rpx 0;
}

.office-item__check-box {
  width: 20rpx;
  height: 20rpx;
  flex: 0 0 auto;
  border-radius: $r-xs;
  border: 2rpx solid $paper-3;
  background: $shell;
  transform: translateY(4rpx);
}

.office-item__check-text {
  flex: 1;
  min-width: 0;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

.office-item__progress {
  display: flex;
  align-items: center;
  gap: $sp-2;
  margin-top: $sp-2;
}

.office-item__progress-input {
  flex: 1;
  min-width: 0;
  height: 72rpx;
  font-size: $fs-meta;
}

/* ---------- 操作 ---------- */
.office-item__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: $sp-3;
}

.office-act {
  flex: 0 0 auto;
}

.office-reject {
  margin-top: $sp-3;
  padding: $sp-3;
  border-radius: $r-control;
  background: $paper-2;
}

.office-reject__area {
  min-height: 140rpx;
}

.office-reject__actions {
  display: flex;
  gap: 12rpx;
  margin-top: $sp-2;
}

.office-state-btn {
  margin-top: $sp-3;
}

.office-foot {
  margin-top: $sp-2;
  text-align: center;
}
</style>
