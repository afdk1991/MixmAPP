<template>
  <suite-detail-shell :content="content" @need-login="onShellNeedLogin">
    <!--
      电商领域动态面板：客服工单 + 服务评价 + 复购提醒。
      正文是静态内容包，渲染不依赖任何请求；这里的工单台账异步加载，失败也不阻断正文。
      商品、购物车与订单由商城模块负责，本面板不重复造那部分。
    -->
    <template #dynamic>
      <view class="ec">
        <!-- 商城衔接：选品、购物车、结算与订单仍在商城模块，
             这里只做客服工单与复购提醒，避免出现第二条下单路径。 -->
        <view class="sheet ec-bridge">
          <view class="ec-bridge__main">
            <text class="sec-title ec-bridge__title">商品与订单在商城</text>
            <text class="hint ec-bridge__hint">
              选品、购物车、结算与订单都由商城模块承接；本面板只登记客服工单、服务评价与复购提醒，不重复提供下单入口。
            </text>
          </view>
          <view
            class="btn btn--sm btn--ghost ec-bridge__btn"
            hover-class="is-press"
            role="button"
            aria-label="前往商城"
            @tap="goMall"
          >
            <text>去商城</text>
          </view>
        </view>

        <!-- 指标条：待处理工单 / 处理中 / 平均首次响应时长 / 平均服务评分（服务端有数据才给） -->
        <view v-if="metrics.length" class="ec-metrics">
          <view v-for="m in metrics" :key="m.label" class="ec-metric">
            <text class="ec-metric__value mono">{{ m.value }}</text>
            <text class="ec-metric__label">{{ m.label }}</text>
            <text v-if="m.hint" class="ec-metric__hint">{{ m.hint }}</text>
          </view>
        </view>

        <!-- 全局动作：登记工单 / 登记复购提醒 -->
        <view class="sheet ec-compose">
          <text class="sec-title ec-compose__title">登记客服工单</text>
          <text class="hint ec-compose__hint">
            登记时写清标题、来源渠道、问题类型与优先级，分派与回复才有共同语境；同一标题重复登记不会生成两张工单。
          </text>
          <view
            class="btn btn--primary ec-compose__btn"
            :class="{ 'btn--disabled': busy === 'ticket' }"
            hover-class="is-press"
            role="button"
            aria-label="登记客服工单"
            @tap="submitTicket"
          >
            <text>{{ busy === 'ticket' ? '登记中' : '登记工单' }}</text>
          </view>
          <view
            class="btn btn--ghost ec-compose__btn"
            :class="{ 'btn--disabled': busy === 'reorder' }"
            hover-class="is-press"
            role="button"
            aria-label="登记复购提醒"
            @tap="submitReorder"
          >
            <text>{{ busy === 'reorder' ? '登记中' : '登记复购提醒' }}</text>
          </view>
        </view>

        <!-- 三态：加载中 / 出错可重试 / 空态给下一步 -->
        <mx-state v-if="loading" variant="loading" title="正在读取客服工单…" />
        <mx-state
          v-else-if="error"
          variant="error"
          title="工单台账没打开"
          :text="error"
          action-text="重新加载"
          @action="load"
        />
        <mx-state
          v-else-if="items.length === 0"
          variant="empty"
          title="还没有客服工单"
          text="下一步：登记第一张工单——写清标题、来源渠道、问题类型与优先级；登记后就能分派处理人、追加回复、登记服务评分，最后结案。"
        >
          <view
            class="btn btn--primary btn--sm ec-state-btn"
            hover-class="is-press"
            role="button"
            aria-label="登记第一张工单"
            @tap="submitTicket"
          >
            <text>登记第一张工单</text>
          </view>
        </mx-state>

        <view v-else class="ec-items">
          <view v-for="item in items" :key="item.id" class="sheet ec-item">
            <view class="ec-item__head">
              <text class="ec-item__title">{{ item.title }}</text>
              <text class="tag ec-item__stage">{{ item.stageLabel }}</text>
            </view>

            <view v-if="isReminder(item)" class="ec-item__tags">
              <text class="tag ec-item__tag">复购提醒</text>
              <text v-if="channelOf(item)" class="tag ec-item__tag">{{ channelOf(item) }}</text>
            </view>
            <text v-else-if="channelOf(item)" class="ec-item__channel">来源渠道 · {{ channelOf(item) }}</text>

            <text class="ec-item__summary">{{ item.summary }}</text>

            <view v-if="item.meta && item.meta.length" class="ec-item__meta">
              <view v-for="m in item.meta" :key="m.label" class="ec-item__meta-row">
                <text class="ec-item__meta-label">{{ m.label }}</text>
                <text class="ec-item__meta-value">{{ m.value }}</text>
              </view>
            </view>

            <view v-if="!isReminder(item)" class="ec-item__acts">
              <view
                class="btn btn--sm btn--ghost ec-act"
                :class="{ 'btn--disabled': busy === `assign:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`分派${item.title}的处理人`"
                @tap="submitAssign(item)"
              >
                <text>分派</text>
              </view>
              <view
                class="btn btn--sm btn--ghost ec-act"
                :class="{ 'btn--disabled': busy === `respond:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`回复${item.title}`"
                @tap="submitRespond(item)"
              >
                <text>回复</text>
              </view>
              <view
                class="btn btn--sm btn--ghost ec-act"
                :class="{ 'btn--disabled': busy === `rate:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`给${item.title}打服务评分`"
                @tap="submitRate(item)"
              >
                <text>评分</text>
              </view>
              <view
                v-if="item.stage !== 'resolved'"
                class="btn btn--sm btn--primary ec-act"
                :class="{ 'btn--disabled': busy === `resolve:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`解决${item.title}`"
                @tap="submitResolve(item)"
              >
                <text>解决</text>
              </view>
              <view
                v-if="item.stage !== 'resolved'"
                class="btn btn--sm btn--quiet ec-act"
                :class="{ 'btn--disabled': busy === `advance:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`推进${item.title}`"
                @tap="submitAdvance(item)"
              >
                <text>推进</text>
              </view>
            </view>
          </view>
        </view>

        <text class="micro ec-foot">工单、回复、评分与复购提醒都按登录账号保存在服务端台账里</text>
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
 * 电商领域页。
 *
 * 正文与清单来自构建期内联的内容包（首屏零请求），
 * 动态面板走 /suite/domains/ecommerce/items 与 /suite/domains/ecommerce/stats：
 * 客服工单、分派、回复、服务评分、结案与复购提醒。
 */
const content = getSuiteContent('ecommerce');

type Metric = { label: string; value: string; hint?: string };

/** 问题类型四选一（与服务端 ISSUE_TYPES 一致）。 */
const ISSUE_TYPE_OPTIONS = ['售前', '售后', '物流', '其他'] as const;
/** 优先级四档（与看板优先级口径一致）。 */
const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent'] as const;

const items = ref<SuiteDomainItemDto[]>([]);
const metrics = ref<Metric[]>([]);
const loading = ref(true);
const error = ref('');
/** 正在执行的动作标识（按条目区分），用于按钮态与防连点 */
const busy = ref('');

/** 登录引导：未登录点动作时先跳登录页，并带回本页 redirect。 */
function onNeedLogin(): void {
  goTo(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.suiteEcommerce)}`);
}

/** 商城衔接：选品、购物车、结算与订单统一回到商城模块，不在套件内重复造下单路径。 */
function goMall(): void {
  goTo(ROUTES.mall);
}

/**
 * 外壳（互动条）请求登录时由外壳自己跳转，这里不再跳一次，
 * 避免同一个页面被压入两次登录页。
 */
function onShellNeedLogin(): void {
  /* 外壳已处理跳转 */
}

/** 未登录不发写请求；这里返回 false 表示调用方应当中止。 */
function requireLogin(): boolean {
  if (isLoggedIn()) return true;
  onNeedLogin();
  return false;
}

function toast(title: string): void {
  uni.showToast({ title, icon: 'none' });
}

/** 读条目 payload 里的字符串字段。 */
function payloadText(item: SuiteDomainItemDto, key: string): string {
  const value = item.payload ? item.payload[key] : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

/** 这条是不是复购提醒（而不是客服工单）。 */
function isReminder(item: SuiteDomainItemDto): boolean {
  return payloadText(item, 'kind') === 'reorder';
}

/** 来源渠道文案。 */
function channelOf(item: SuiteDomainItemDto): string {
  return payloadText(item, 'channel');
}

/** 拉工单台账与领域指标；失败只影响这一块，不阻断静态正文。 */
async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [list, stats] = await Promise.all([suiteApi.items('ecommerce'), suiteApi.stats('ecommerce')]);
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
    const [list, stats] = await Promise.all([suiteApi.items('ecommerce'), suiteApi.stats('ecommerce')]);
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
async function run(input: SuiteActionInput, key: string): Promise<boolean> {
  if (!isLoggedIn()) {
    onNeedLogin();
    return false;
  }
  if (busy.value === key) return false;
  busy.value = key;
  try {
    const res = await suiteApi.act('ecommerce', input);
    toast(res.message || (res.changed ? '已完成' : '没有变化'));
    if (res.ok) await refresh();
    return res.ok;
  } catch (e) {
    toast(e instanceof Error ? e.message : '操作没成功，稍后再试一次');
    return false;
  } finally {
    busy.value = '';
  }
}

/** 从一组固定选项里挑一个（问题类型 / 优先级）。 */
function pickOption(options: readonly string[], onPick: (value: string) => void): void {
  uni.showActionSheet({
    itemList: [...options],
    success: (res) => {
      const value = options[res.tapIndex];
      if (value === undefined) return;
      onPick(value);
    },
  });
}

/** 登记工单：标题 → 来源渠道 → 关联商品 → 问题类型 → 优先级。 */
function submitTicket(): void {
  if (!requireLogin()) return;
  uni.showModal({
    title: '登记客服工单 · 标题',
    content: '一句话写清客户反馈的问题',
    editable: true,
    placeholderText: '例如 收到的商品与图片不符，要求换货',
    confirmText: '下一步',
    success: (res) => {
      if (!res.confirm) return;
      const title = (res.content ?? '').trim();
      if (!title) {
        toast('请先写一句工单标题');
        return;
      }
      uni.showModal({
        title: '登记客服工单 · 来源渠道',
        content: '这条工单从哪个渠道进来',
        editable: true,
        placeholderText: '例如 商城 / 直播间 / 私域社群 / 电话',
        confirmText: '下一步',
        success: (chanRes) => {
          if (!chanRes.confirm) return;
          const channel = (chanRes.content ?? '').trim();
          if (!channel) {
            toast('请写明来源渠道');
            return;
          }
          uni.showModal({
            title: '登记客服工单 · 关联商品',
            content: '填写关联商品的 SKU（没有可以留空）',
            editable: true,
            placeholderText: '例如 SKU-2048',
            confirmText: '下一步',
            success: (skuRes) => {
              if (!skuRes.confirm) return;
              const sku = (skuRes.content ?? '').trim();
              pickOption(ISSUE_TYPE_OPTIONS, (issueType) => {
                pickOption(PRIORITY_OPTIONS, (priority) => {
                  void run(
                    {
                      action: 'ticket',
                      payload: { title, channel, sku, issueType, priority },
                    },
                    'ticket',
                  );
                });
              });
            },
          });
        },
      });
    },
  });
}

/** 登记复购提醒：客户 → 关联商品 → 提醒时间。 */
function submitReorder(): void {
  if (!requireLogin()) return;
  uni.showModal({
    title: '登记复购提醒 · 客户',
    content: '写明要提醒的客户',
    editable: true,
    placeholderText: '例如 会员 U-1024',
    confirmText: '下一步',
    success: (res) => {
      if (!res.confirm) return;
      const customer = (res.content ?? '').trim();
      if (!customer) {
        toast('请写明客户');
        return;
      }
      uni.showModal({
        title: '登记复购提醒 · 关联商品',
        content: '写明提醒的是哪件商品',
        editable: true,
        placeholderText: '例如 SKU-2048',
        confirmText: '下一步',
        success: (skuRes) => {
          if (!skuRes.confirm) return;
          const sku = (skuRes.content ?? '').trim();
          if (!sku) {
            toast('请写明关联商品');
            return;
          }
          uni.showModal({
            title: '登记复购提醒 · 提醒时间',
            content: '写明什么时候触达这位客户',
            editable: true,
            placeholderText: '例如 2026-12-01',
            confirmText: '登记',
            success: (timeRes) => {
              if (!timeRes.confirm) return;
              const remindAt = (timeRes.content ?? '').trim();
              if (!remindAt) {
                toast('请写明提醒时间');
                return;
              }
              void run(
                { action: 'reorder', payload: { customer, sku, remindAt } },
                'reorder',
              );
            },
          });
        },
      });
    },
  });
}

/** 分派：写明处理人。 */
function submitAssign(item: SuiteDomainItemDto): void {
  if (!requireLogin()) return;
  uni.showModal({
    title: '分派处理人',
    content: '写明这条工单交给谁跟',
    editable: true,
    placeholderText: '例如 客服小林',
    confirmText: '分派',
    success: (res) => {
      if (!res.confirm) return;
      const owner = (res.content ?? '').trim();
      if (!owner) {
        toast('分派前要先写明处理人');
        return;
      }
      void run({ action: 'assign', entryId: item.id, payload: { owner } }, `assign:${item.id}`);
    },
  });
}

/** 回复：追加一条带时间戳的回复。 */
function submitRespond(item: SuiteDomainItemDto): void {
  if (!requireLogin()) return;
  uni.showModal({
    title: '回复客户',
    content: '写一句回复内容',
    editable: true,
    placeholderText: '例如 已安排仓库换货，单号稍后发您',
    confirmText: '发送',
    success: (res) => {
      if (!res.confirm) return;
      const content = (res.content ?? '').trim();
      if (!content) {
        toast('写一句回复内容再提交');
        return;
      }
      void run({ action: 'respond', entryId: item.id, payload: { content } }, `respond:${item.id}`);
    },
  });
}

/** 评分：登记 1 到 5 分的服务评分。 */
function submitRate(item: SuiteDomainItemDto): void {
  if (!requireLogin()) return;
  uni.showModal({
    title: '服务评分',
    content: '填写 1 到 5 之间的整数',
    editable: true,
    placeholderText: '例如 5',
    confirmText: '评分',
    success: (res) => {
      if (!res.confirm) return;
      const raw = (res.content ?? '').trim();
      const score = Number(raw);
      if (!raw || !Number.isInteger(score) || score < 1 || score > 5) {
        toast('服务评分需要是 1 到 5 之间的整数');
        return;
      }
      void run({ action: 'rate', entryId: item.id, payload: { score } }, `rate:${item.id}`);
    },
  });
}

/** 解决：写明处理结果后结案。 */
function submitResolve(item: SuiteDomainItemDto): void {
  if (!requireLogin()) return;
  uni.showModal({
    title: '解决工单',
    content: '写明这条工单最后怎么处理',
    editable: true,
    placeholderText: '例如 已换货并退回运费',
    confirmText: '结案',
    success: (res) => {
      if (!res.confirm) return;
      const resolution = (res.content ?? '').trim();
      if (!resolution) {
        toast('结案要写明处理结果');
        return;
      }
      void run(
        { action: 'resolve', entryId: item.id, payload: { resolution } },
        `resolve:${item.id}`,
      );
    },
  });
}

/**
 * 推进：待处理 → 处理中直接推进；
 * 处理中 → 已解决要求先写明处理结果（与服务端的结案口径一致）。
 */
function submitAdvance(item: SuiteDomainItemDto): void {
  if (!requireLogin()) return;
  if (item.stage === 'handling') {
    uni.showModal({
      title: '推进到已解决',
      content: '写明这条工单的处理结果',
      editable: true,
      placeholderText: '例如 已换货并退回运费',
      confirmText: '结案',
      success: (res) => {
        if (!res.confirm) return;
        const resolution = (res.content ?? '').trim();
        if (!resolution) {
          toast('推进到「已解决」前要先写明处理结果');
          return;
        }
        void run(
          { action: 'advance', entryId: item.id, payload: { resolution } },
          `advance:${item.id}`,
        );
      },
    });
    return;
  }
  void run({ action: 'advance', entryId: item.id }, `advance:${item.id}`);
}

onMounted(() => {
  void load();
});

applySuiteSeo({
  title: '电商 · MixmAPP 业务套件',
  description: '客服工单、服务评价与复购提醒，把一次成交接成长线服务。',
  path: ROUTES.suiteEcommerce,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: '电商 · MixmAPP 业务套件',
    description: '客服工单、服务评价与复购提醒，把一次成交接成长线服务。',
    inLanguage: 'zh-CN',
  },
});
</script>

<style scoped lang="scss">
.ec {
  margin: 0 $sp-4 $sp-4;
  display: flex;
  flex-direction: column;
  gap: $sp-3;
}

/* ---------- 指标条 ---------- */
.ec-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: $sp-2;
}

.ec-metric {
  flex: 1 1 30%;
  min-width: 200rpx;
  padding: $sp-3;
  border-radius: $r-card;
  background: $paper-2;
}

.ec-metric__value {
  display: block;
  font-size: $fs-h3;
  font-weight: 800;
  color: $acc-2;
}

.ec-metric__label {
  display: block;
  margin-top: 6rpx;
  font-size: $fs-micro;
  color: $ink-3;
}

.ec-metric__hint {
  display: block;
  margin-top: 4rpx;
  font-size: $fs-xs;
  line-height: $lh-snug;
  color: $ink-4;
}

/* ---------- 登记区 ---------- */
.ec-compose {
  padding: $sp-4;
}

.ec-compose__title {
  font-size: $fs-h3;
}

.ec-compose__hint {
  margin: 8rpx 0 $sp-3;
}

.ec-compose__btn {
  margin-top: $sp-2;
  width: 100%;
}

/* ---------- 商城衔接卡 ---------- */
.ec-bridge {
  display: flex;
  align-items: center;
  gap: $sp-3;
  padding: $sp-4;
}

.ec-bridge__main {
  flex: 1;
  min-width: 0;
}

.ec-bridge__title {
  font-size: $fs-h3;
}

.ec-bridge__hint {
  display: block;
  margin-top: 8rpx;
}

.ec-bridge__btn {
  flex: 0 0 auto;
}

/* ---------- 工单列表 ---------- */
.ec-items {
  display: flex;
  flex-direction: column;
  gap: $sp-3;
}

.ec-item {
  padding: $sp-4;
}

.ec-item__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $sp-2;
}

.ec-item__title {
  flex: 1;
  min-width: 0;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  color: $ink;
}

.ec-item__stage {
  flex: 0 0 auto;
}

.ec-item__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-top: 10rpx;
}

.ec-item__tag {
  height: 40rpx;
  font-size: $fs-xs;
}

.ec-item__channel {
  display: block;
  margin-top: 10rpx;
  font-size: $fs-micro;
  color: $ink-4;
}

.ec-item__summary {
  display: block;
  margin-top: 8rpx;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

.ec-item__meta {
  margin-top: $sp-3;
  padding: $sp-3;
  border-radius: $r-control;
  background: $paper-2;
}

.ec-item__meta-row {
  display: flex;
  justify-content: space-between;
  gap: $sp-3;
  padding: 4rpx 0;
}

.ec-item__meta-label {
  flex: 0 0 auto;
  font-family: $font-mono;
  font-size: $fs-micro;
  color: $ink-4;
}

.ec-item__meta-value {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: $fs-micro;
  color: $ink-2;
}

.ec-item__acts {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: $sp-3;
}

.ec-act {
  flex: 0 0 auto;
}

.ec-state-btn {
  margin-top: $sp-3;
}

.ec-foot {
  margin-top: $sp-2;
  text-align: center;
}
</style>
