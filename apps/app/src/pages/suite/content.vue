<template>
  <suite-detail-shell :content="content" @need-login="onNeedLogin">
    <!--
      内容创作动态面板：选题建档 → 撰写 → 待审 → 已排期 → 已发布。
      正文来自构建期内联的内容包，这里的台账异步加载，失败不阻断正文。
    -->
    <template #dynamic>
      <view class="panel">
        <view class="panel__head">
          <text class="eyebrow">内容台账</text>
          <text class="panel__lead">
            选题、稿件、排期与发布登记都落在服务端台账里；状态不对的动作会被拒绝并说明原因。
          </text>
          <view class="panel__ops">
            <view
              class="btn btn--sm btn--ghost"
              hover-class="is-press"
              role="button"
              aria-label="新建一个选题"
              @tap="createTopic"
            >
              <text>新建选题</text>
            </view>
          </view>
        </view>

        <!-- 指标：待审 / 已排期 / 近七天发布（服务端有数据才给） -->
        <view v-if="metrics.length" class="metrics">
          <view v-for="m in metrics" :key="m.label" class="metric">
            <text class="metric__value mono">{{ m.value }}</text>
            <text class="metric__label">{{ m.label }}</text>
            <text v-if="m.hint" class="metric__hint">{{ m.hint }}</text>
          </view>
        </view>

        <!-- 三态：加载中 / 出错可重试 / 空态给下一步 -->
        <mx-state v-if="loading" variant="loading" title="正在读取内容台账…" />
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
          title="还没有选题"
          text="先新建一个选题：写上标题，补上目标频道与角度，再推进到撰写。"
        >
          <view
            class="btn btn--primary btn--sm panel__cta"
            hover-class="is-press"
            role="button"
            aria-label="新建第一个选题"
            @tap="createTopic"
          >
            <text>新建第一个选题</text>
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

            <!-- 按阶段给出可执行动作；发布后只读 -->
            <view class="item__acts">
              <view
                v-if="item.stage === 'idea'"
                class="btn btn--sm btn--ghost"
                :class="{ 'btn--disabled': busy === `topic:${item.id}` }"
                hover-class="is-press"
                role="button"
                aria-label="补充选题频道"
                @tap="fillTopic(item)"
              >
                <text>补充选题</text>
              </view>

              <view
                v-if="item.stage === 'idea' || item.stage === 'writing'"
                class="btn btn--sm btn--primary"
                :class="{ 'btn--disabled': busy === `advance:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="item.stage === 'idea' ? '开始撰写' : '提交待审'"
                @tap="move(item)"
              >
                <text>{{ item.stage === 'idea' ? '开始撰写' : '提交待审' }}</text>
              </view>

              <view
                v-if="item.stage === 'review'"
                class="btn btn--sm btn--primary"
                :class="{ 'btn--disabled': busy === `schedule:${item.id}` }"
                hover-class="is-press"
                role="button"
                aria-label="给稿件排期"
                @tap="scheduleItem(item)"
              >
                <text>排期</text>
              </view>

              <view
                v-if="item.stage === 'review'"
                class="btn btn--sm btn--ghost"
                :class="{ 'btn--disabled': busy === `revise:${item.id}` }"
                hover-class="is-press"
                role="button"
                aria-label="退回修改"
                @tap="reviseItem(item)"
              >
                <text>退回修改</text>
              </view>

              <view
                v-if="item.stage === 'scheduled'"
                class="btn btn--sm btn--primary"
                :class="{ 'btn--disabled': busy === `publish:${item.id}` }"
                hover-class="is-press"
                role="button"
                aria-label="登记发布"
                @tap="publishItem(item)"
              >
                <text>发布登记</text>
              </view>

              <view
                v-if="item.stage === 'scheduled'"
                class="btn btn--sm btn--ghost"
                :class="{ 'btn--disabled': busy === `reschedule:${item.id}` }"
                hover-class="is-press"
                role="button"
                aria-label="调整排期"
                @tap="scheduleItem(item)"
              >
                <text>改期</text>
              </view>

              <text v-if="item.stage === 'published'" class="micro item__done">已发布，记录只读</text>
            </view>
          </view>
        </view>

        <text class="micro panel__foot">选题与稿件按登录账号隔离；未登录只能阅读静态说明</text>
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
 * 内容创作领域页。
 *
 * 静态正文来自内容包；动态面板对接服务端 content 模块：
 * topic（选题）、commission（约稿）、schedule（排期）、revise（退修）、
 * publish（发布登记）与 advance（阶段推进）。
 */
const content = getSuiteContent('content');

const items = ref<SuiteDomainItemDto[]>([]);
const metrics = ref<Array<{ label: string; value: string; hint?: string }>>([]);
const loading = ref(true);
const error = ref('');
/** 正在执行的动作标识，用于按钮态与防连点。 */
const busy = ref('');

/** 登录引导：未登录点动作先跳登录页，并带回本页 redirect。 */
function onNeedLogin(): void {
  goTo(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.suiteContent)}`);
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

/** 统一错误文案。 */
function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** 弹出单行输入框，返回去掉空白的文本；取消返回 null。 */
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

/** 拉台账与指标。 */
async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [list, stats] = await Promise.all([suiteApi.items('content'), suiteApi.stats('content')]);
    items.value = Array.isArray(list) ? list : [];
    metrics.value = Array.isArray(stats?.metrics) ? stats.metrics : [];
  } catch (e) {
    items.value = [];
    error.value = errorText(e, '内容台账加载失败，请稍后再试');
  } finally {
    loading.value = false;
  }
}

/** 静默刷新：动作成功后更新列表，不闪回骨架。 */
async function refresh(): Promise<void> {
  try {
    const [list, stats] = await Promise.all([suiteApi.items('content'), suiteApi.stats('content')]);
    items.value = Array.isArray(list) ? list : [];
    metrics.value = Array.isArray(stats?.metrics) ? stats.metrics : [];
  } catch {
    // 动作已成功，刷新失败不打扰用户，下次进入会重新拉。
  }
}

/** 统一执行动作：登录门禁、防连点、成功提示与刷新。 */
async function run(input: SuiteActionInput, key: string): Promise<void> {
  if (!requireLogin()) return;
  if (busy.value === key) return;
  busy.value = key;
  try {
    const res = await suiteApi.act('content', input);
    toast(res.message || (res.changed ? '已完成' : '没有变化'));
    if (res.ok) await refresh();
  } catch (e) {
    toast(errorText(e, '操作没成功，稍后再试一次'));
  } finally {
    busy.value = '';
  }
}

/** 新建选题：标题必填，频道与角度可在下一步补充。 */
async function createTopic(): Promise<void> {
  if (!requireLogin()) return;
  const title = await askText('新建选题', '例如：车间降本增效的三种做法');
  if (!title) return;
  await run({ action: 'topic', payload: { title } }, 'create');
}

/** 补充选题：频道 + 角度，只在「选题」阶段可改。 */
async function fillTopic(item: SuiteDomainItemDto): Promise<void> {
  const channel = await askText('选题频道', '例如：公众号、知乎、视频号');
  if (!channel) return;
  const angle = await askText('选题角度', '一句话说明从哪个角度写');
  await run(
    { action: 'topic', entryId: item.id, payload: { channel, angle: angle ?? '' } },
    `topic:${item.id}`,
  );
}

/** 推进阶段：由服务端校验状态机，非法流转会直接拒绝。 */
function move(item: SuiteDomainItemDto): void {
  void run({ action: 'advance', entryId: item.id }, `advance:${item.id}`);
}

/** 排期：渠道 + 发布日期都是必填项。 */
async function scheduleItem(item: SuiteDomainItemDto): Promise<void> {
  const channel = await askText('发布渠道', '例如：公众号、小红书');
  if (!channel) return;
  const at = await askText('发布日期', 'YYYY-MM-DD');
  if (!at) return;
  await run(
    { action: 'schedule', entryId: item.id, payload: { channel, publishAt: at } },
    item.stage === 'scheduled' ? `reschedule:${item.id}` : `schedule:${item.id}`,
  );
}

/** 退回修改：必须写原因，否则服务端会拒绝。 */
async function reviseItem(item: SuiteDomainItemDto): Promise<void> {
  const reason = await askText('退回原因', '写清要改什么，例如：数据来源需补充');
  if (!reason) return;
  await run(
    { action: 'revise', entryId: item.id, payload: { reviseNote: reason } },
    `revise:${item.id}`,
  );
}

/** 发布登记：发布时间必填，链接可留空但必须是 http(s)。 */
async function publishItem(item: SuiteDomainItemDto): Promise<void> {
  const at = await askText('发布时间', 'YYYY-MM-DD');
  if (!at) return;
  const url = await askText('发布链接（可留空）', 'https://...');
  if (url === null) return;
  await run(
    { action: 'publish', entryId: item.id, payload: { publishedAt: at, url } },
    `publish:${item.id}`,
  );
}

onMounted(() => {
  void load();
});

applySuiteSeo({
  title: '内容创作 · MixmAPP 业务套件',
  description: '选题日历、稿件流转与发布排期：静态说明零请求可读，台账与发布登记登录后异步加载。',
  path: ROUTES.suiteContent,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: '内容创作 · MixmAPP 业务套件',
    description: '选题日历、稿件流转与发布排期，让产出有节奏。',
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
  color: $acc-3;
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
</style>
