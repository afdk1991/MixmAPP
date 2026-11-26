<template>
  <suite-detail-shell :content="content" @need-login="onNeedLogin">
    <!--
      教育科研动态面板：学习条目 + 随堂判分 + 文献记录 + 路径节点 + 复习与错题。
      静态正文来自内容包；台账异步加载，失败不阻断正文。
    -->
    <template #dynamic>
      <view class="panel">
        <view class="panel__head">
          <text class="eyebrow">学习台账</text>
          <text class="panel__lead">
            判分、文献、路径节点与错题都落在服务端台账里；判分只按题数与答对数计算得分率。
          </text>
          <view class="panel__ops">
            <view
              class="btn btn--sm btn--ghost"
              hover-class="is-press"
              role="button"
              aria-label="新建学习条目"
              @tap="createCourse"
            >
              <text>新建学习条目</text>
            </view>
          </view>
        </view>

        <!-- 指标：最近得分、文献条数、路径完成度（服务端有数据才给） -->
        <view v-if="metrics.length" class="metrics">
          <view v-for="m in metrics" :key="m.label" class="metric">
            <text class="metric__value mono">{{ m.value }}</text>
            <text class="metric__label">{{ m.label }}</text>
            <text v-if="m.hint" class="metric__hint">{{ m.hint }}</text>
          </view>
        </view>

        <!-- 三态 -->
        <mx-state v-if="loading" variant="loading" title="正在读取学习台账…" />
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
          title="还没有学习条目"
          text="先新建一条：写下课程或研究主题，再用判分、文献与路径节点记录过程。"
        >
          <view
            class="btn btn--primary btn--sm panel__cta"
            hover-class="is-press"
            role="button"
            aria-label="新建第一条学习条目"
            @tap="createCourse"
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
                :class="{ 'btn--disabled': busy === `quiz:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`给${item.title}做随堂判分`"
                @tap="quiz(item)"
              >
                <text>随堂判分</text>
              </view>
              <view
                class="btn btn--sm btn--ghost"
                :class="{ 'btn--disabled': busy === `record:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`给${item.title}记一条文献`"
                @tap="recordCitation(item)"
              >
                <text>记文献</text>
              </view>
              <view
                class="btn btn--sm btn--ghost"
                :class="{ 'btn--disabled': busy === `path:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`推进${item.title}的学习路径`"
                @tap="advancePath(item)"
              >
                <text>路径节点</text>
              </view>
              <view
                class="btn btn--sm btn--ghost"
                :class="{ 'btn--disabled': busy === `review:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`给${item.title}写复习笔记`"
                @tap="reviewNote(item)"
              >
                <text>复习笔记</text>
              </view>
              <view
                class="btn btn--sm btn--ghost"
                :class="{ 'btn--disabled': busy === `mistake:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`给${item.title}登记错题`"
                @tap="addMistake(item)"
              >
                <text>错题</text>
              </view>
            </view>
          </view>
        </view>

        <text class="micro panel__foot">判分只按题数与答对数计算得分率，不替代正式考试成绩</text>
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
 * 教育科研领域页。
 *
 * 动态面板对接服务端 edu 模块：
 * quiz（随堂判分）、record（文献记录）、path_node（学习路径）、
 * review（复习记录）与 mistake（错题登记），其余动作回落基线。
 */
const content = getSuiteContent('edu');

const items = ref<SuiteDomainItemDto[]>([]);
const metrics = ref<Array<{ label: string; value: string; hint?: string }>>([]);
const loading = ref(true);
const error = ref('');
/** 正在执行的动作标识。 */
const busy = ref('');

/** 登录引导。 */
function onNeedLogin(): void {
  goTo(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.suiteEdu)}`);
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

/** 读台账。 */
async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [list, stats] = await Promise.all([suiteApi.items('edu'), suiteApi.stats('edu')]);
    items.value = Array.isArray(list) ? list : [];
    metrics.value = Array.isArray(stats?.metrics) ? stats.metrics : [];
  } catch (e) {
    items.value = [];
    error.value = errorText(e, '学习台账加载失败，请稍后再试');
  } finally {
    loading.value = false;
  }
}

/** 静默刷新。 */
async function refresh(): Promise<void> {
  try {
    const [list, stats] = await Promise.all([suiteApi.items('edu'), suiteApi.stats('edu')]);
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
    const res = await suiteApi.act('edu', input);
    toast(res.message || (res.changed ? '已完成' : '没有变化'));
    if (res.ok) await refresh();
  } catch (e) {
    toast(errorText(e, '操作没成功，稍后再试一次'));
  } finally {
    busy.value = '';
  }
}

/** 新建学习条目：走基线 create。 */
async function createCourse(): Promise<void> {
  if (!requireLogin()) return;
  const title = await askText('新建学习条目', '例如：数据结构 · 第三章');
  if (!title) return;
  await run({ action: 'create', payload: { title, summary: '待安排学习计划' } }, 'create');
}

/** 随堂判分：总题数 + 答对题数。 */
async function quiz(item: SuiteDomainItemDto): Promise<void> {
  const totalRaw = await askText('随堂判分 · 总题数', '例如 20');
  if (!totalRaw) return;
  const correctRaw = await askText('随堂判分 · 答对题数', '例如 17');
  if (!correctRaw) return;
  const total = Number(totalRaw);
  const correct = Number(correctRaw);
  if (!Number.isInteger(total) || total < 1) {
    toast('总题数需要是大于 0 的整数');
    return;
  }
  if (!Number.isInteger(correct) || correct < 0 || correct > total) {
    toast('答对题数需要在 0 到总题数之间');
    return;
  }
  await run(
    { action: 'quiz', entryId: item.id, payload: { total, correct } },
    `quiz:${item.id}`,
  );
}

/** 文献记录：题录或标题。 */
async function recordCitation(item: SuiteDomainItemDto): Promise<void> {
  const citation = await askText('文献记录', '作者《标题》期刊/年份，或直接写标题');
  if (!citation) return;
  await run(
    { action: 'record', entryId: item.id, payload: { citation } },
    `record:${item.id}`,
  );
}

/** 学习路径节点：节点名 + 节点总数。 */
async function advancePath(item: SuiteDomainItemDto): Promise<void> {
  const node = await askText('路径节点', '例如：第三章习题');
  if (!node) return;
  const totalRaw = await askText('节点总数', '例如 8');
  if (!totalRaw) return;
  const total = Number(totalRaw);
  if (!Number.isInteger(total) || total < 1) {
    toast('节点总数需要是大于 0 的整数');
    return;
  }
  await run(
    { action: 'path_node', entryId: item.id, payload: { node, total } },
    `path:${item.id}`,
  );
}

/** 复习记录：一句要点。 */
async function reviewNote(item: SuiteDomainItemDto): Promise<void> {
  const note = await askText('复习笔记', '写下这次复习的要点或疑问');
  if (!note) return;
  await run(
    { action: 'review', entryId: item.id, payload: { note } },
    `review:${item.id}`,
  );
}

/** 错题登记：题干 + 原因。 */
async function addMistake(item: SuiteDomainItemDto): Promise<void> {
  const question = await askText('错题登记', '一句话概括错题考点');
  if (!question) return;
  const reason = await askText('错误原因', '为什么错，例如：公式记混');
  if (!reason) return;
  await run(
    { action: 'mistake', entryId: item.id, payload: { question, reason } },
    `mistake:${item.id}`,
  );
}

onMounted(() => {
  void load();
});

applySuiteSeo({
  title: '教育科研 · MixmAPP 业务套件',
  description: '学习路径、随堂判分与文献记录：静态说明零请求可读，判分与台账登录后异步加载。',
  path: ROUTES.suiteEdu,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: '教育科研 · MixmAPP 业务套件',
    description: '学习路径、随堂判分与文献记录，读进去也留得住。',
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

.panel__foot {
  text-align: center;
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
  color: $acc-6;
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
  gap: 12rpx;
  margin-top: $sp-3;
}
</style>
