<template>
  <suite-detail-shell :content="content" @need-login="onShellNeedLogin">
    <!-- 工程动态面板：工单看板 + 派工 / 核材料 / 验收 / 施工记录 -->
    <template #dynamic>
      <view class="eng">
        <!-- 指标条：待派工 / 施工中 / 验收中 / 材料费用 / 平均验收周期 -->
        <view v-if="metrics.length" class="eng-metrics">
          <view v-for="m in metrics" :key="m.label" class="eng-metric">
            <text class="eng-metric-label">{{ m.label }}</text>
            <text class="eng-metric-value mono">{{ m.value }}</text>
          </view>
        </view>

        <!-- 新建工单 -->
        <view class="sheet eng-compose">
          <text class="sec-title eng-compose__title">登记一条新工单</text>
          <text class="hint eng-compose__hint">
            写清要做什么、在哪儿做，登记后派给具体负责人；派工后按阶段推进，完工进入验收留痕。
          </text>
          <input
            v-model="newTitle"
            class="field"
            placeholder="工单标题，例如：三层东区给水管道渗漏"
            placeholder-class="field-ph"
          />
          <input
            v-model="newSite"
            class="field eng-compose__field"
            placeholder="施工地点，例如：三层东区管井"
            placeholder-class="field-ph"
          />
          <input
            v-model="newOwner"
            class="field eng-compose__field"
            placeholder="负责人（可留空，登记后再派工）"
            placeholder-class="field-ph"
          />
          <textarea
            v-model="newMaterials"
            class="field field--area eng-compose__area"
            placeholder="材料清单（每行：名称 数量 单价（元），可留空）"
            placeholder-class="field-ph"
          />
          <view
            class="btn btn--primary eng-compose__btn"
            :class="{ 'btn--disabled': busy === 'create' }"
            hover-class="is-press"
            role="button"
            aria-label="登记新工单"
            @tap="submitCreate"
          >
            <text>{{ busy === 'create' ? '登记中' : '登记工单' }}</text>
          </view>
        </view>

        <!-- 工单看板 -->
        <view class="eng-head">
          <text class="sec-title eng-head__title">工单看板</text>
          <text class="micro eng-head__count">{{ items.length }} 条工单</text>
        </view>

        <mx-state v-if="loading" variant="loading" title="正在读取工单看板…" />
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
          title="还没有工单"
          text="下一步：在上面登记一条工单，写清施工地点，再派给具体负责人；核完材料等总价，完工后按验收结论收口。"
        >
          <view
            v-if="!signedIn"
            class="btn btn--deep eng-state-btn"
            hover-class="is-press"
            role="button"
            aria-label="登录后查看我的工单看板"
            @tap="onNeedLogin"
          >
            <text>登录后查看我的看板</text>
          </view>
        </mx-state>

        <view v-else class="eng-items">
          <view v-for="item in items" :key="item.id" class="sheet eng-item">
            <view class="eng-item__head">
              <text class="eng-item__title">{{ item.title }}</text>
              <text class="tag eng-item__stage">{{ item.stageLabel }}</text>
            </view>

            <text class="eng-item__summary">{{ item.summary }}</text>

            <view class="eng-item__line">
              <text class="eng-item__line-label micro">负责人</text>
              <text class="eng-item__line-value">{{ ownerOf(item) }}</text>
              <text class="eng-item__line-label micro">施工地点</text>
              <text class="eng-item__line-value">{{ siteOf(item) }}</text>
            </view>

            <view v-if="item.meta && item.meta.length" class="eng-item__meta">
              <view v-for="m in item.meta" :key="m.label" class="eng-item__meta-row">
                <text class="eng-item__meta-label">{{ m.label }}</text>
                <text class="eng-item__meta-value">{{ m.value }}</text>
              </view>
            </view>

            <!-- 材料总价（服务端按分核算，展示换算成元） -->
            <view v-if="totalFenOf(item) > 0" class="eng-item__cost">
              <text class="eng-item__cost-label micro">材料总价</text>
              <text class="eng-item__cost-value mono">{{ yuanOf(totalFenOf(item)) }} 元</text>
            </view>

            <text v-if="noteCountOf(item) > 0" class="eng-item__notes micro">
              施工记录 {{ noteCountOf(item) }} 条
            </text>

            <!-- 动作区 -->
            <view class="eng-item__actions">
              <view
                v-if="item.stage === 'reported' || item.stage === 'assigned'"
                class="btn btn--sm btn--ghost eng-act"
                :class="{ 'btn--disabled': busy === `dispatch:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`给${item.title}派工`"
                @tap="startDispatch(item)"
              >
                <text>派工</text>
              </view>

              <view
                v-if="item.stage !== 'done' && item.stage !== 'reported'"
                class="btn btn--sm btn--ghost eng-act"
                :class="{ 'btn--disabled': busy === `advance:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`推进${item.title}到下一阶段`"
                @tap="advance(item)"
              >
                <text>{{ busy === `advance:${item.id}` ? '推进中' : '推进' }}</text>
              </view>

              <view
                class="btn btn--sm btn--ghost eng-act"
                :class="{ 'btn--disabled': busy === `materials:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`核算${item.title}的材料总价`"
                @tap="startMaterials(item)"
              >
                <text>核材料</text>
              </view>

              <view
                v-if="item.stage === 'checking'"
                class="btn btn--sm btn--primary eng-act"
                :class="{ 'btn--disabled': busy === `accept:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`验收通过${item.title}`"
                @tap="accept(item, 'pass')"
              >
                <text>验收通过</text>
              </view>

              <view
                v-if="item.stage === 'checking' && rejectingId !== item.id"
                class="btn btn--sm btn--ghost eng-act"
                hover-class="is-press"
                role="button"
                :aria-label="`验收不通过${item.title}`"
                @tap="startReject(item)"
              >
                <text>验收不通过</text>
              </view>

              <view
                class="btn btn--sm btn--ghost eng-act"
                :class="{ 'btn--disabled': busy === `note:${item.id}` }"
                hover-class="is-press"
                role="button"
                :aria-label="`给${item.title}记一笔施工记录`"
                @tap="startNote(item)"
              >
                <text>记一笔</text>
              </view>
            </view>

            <!-- 派工表单 -->
            <view v-if="dispatchingId === item.id" class="eng-form">
              <text class="label">负责人（必填）</text>
              <input
                v-model="ownerInput"
                class="field"
                placeholder="写明谁来接这条工单"
                placeholder-class="field-ph"
              />
              <view class="eng-form__actions">
                <view class="btn btn--sm btn--ghost eng-act" hover-class="is-press" role="button" aria-label="取消派工" @tap="cancelForm">
                  <text>取消</text>
                </view>
                <view
                  class="btn btn--sm btn--primary eng-act"
                  :class="{ 'btn--disabled': busy === `dispatch:${item.id}` }"
                  hover-class="is-press"
                  role="button"
                  aria-label="确认派工"
                  @tap="submitDispatch(item)"
                >
                  <text>确认派工</text>
                </view>
              </view>
            </view>

            <!-- 材料清单表单 -->
            <view v-if="materialsId === item.id" class="eng-form">
              <text class="label">材料清单（每行：名称 数量 单价（元））</text>
              <textarea
                v-model="materialsInput"
                class="field field--area eng-form__area"
                placeholder="给水钢管 12 86.50"
                placeholder-class="field-ph"
              />
              <text class="hint eng-form__hint">按行录入，提交后由服务端按分核算总价，重复提交同一份清单不会重复记账。</text>
              <view class="eng-form__actions">
                <view class="btn btn--sm btn--ghost eng-act" hover-class="is-press" role="button" aria-label="取消核材料" @tap="cancelForm">
                  <text>取消</text>
                </view>
                <view
                  class="btn btn--sm btn--primary eng-act"
                  :class="{ 'btn--disabled': busy === `materials:${item.id}` }"
                  hover-class="is-press"
                  role="button"
                  aria-label="提交材料清单核算总价"
                  @tap="submitMaterials(item)"
                >
                  <text>核算总价</text>
                </view>
              </view>
            </view>

            <!-- 验收不通过表单 -->
            <view v-if="rejectingId === item.id" class="eng-form">
              <text class="label">验收问题（必填）</text>
              <textarea
                v-model="acceptNote"
                class="field field--area eng-form__area"
                placeholder="写清哪个部位不符合要求、达到什么状态算通过"
                placeholder-class="field-ph"
              />
              <view class="eng-form__actions">
                <view class="btn btn--sm btn--ghost eng-act" hover-class="is-press" role="button" aria-label="取消验收退回" @tap="cancelForm">
                  <text>取消</text>
                </view>
                <view
                  class="btn btn--sm btn--primary eng-act"
                  :class="{ 'btn--disabled': busy === `accept:${item.id}` }"
                  hover-class="is-press"
                  role="button"
                  aria-label="提交验收退回"
                  @tap="submitReject(item)"
                >
                  <text>退回施工</text>
                </view>
              </view>
            </view>

            <!-- 施工记录表单 -->
            <view v-if="notingId === item.id" class="eng-form">
              <text class="label">施工记录</text>
              <textarea
                v-model="noteInput"
                class="field field--area eng-form__area"
                placeholder="写到部位、材料与完成状态，下一次接手的靠它省掉一轮追问"
                placeholder-class="field-ph"
              />
              <view class="eng-form__actions">
                <view class="btn btn--sm btn--ghost eng-act" hover-class="is-press" role="button" aria-label="取消记录" @tap="cancelForm">
                  <text>取消</text>
                </view>
                <view
                  class="btn btn--sm btn--primary eng-act"
                  :class="{ 'btn--disabled': busy === `note:${item.id}` }"
                  hover-class="is-press"
                  role="button"
                  aria-label="提交施工记录"
                  @tap="submitNote(item)"
                >
                  <text>记下来</text>
                </view>
              </view>
            </view>
          </view>
        </view>

        <text class="micro eng-foot">工单、材料清单与验收记录按登录账号保存在服务端台账里</text>
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
 * 工程领域页。
 *
 * 正文与清单来自构建期内联的内容包（首屏零请求），
 * 动态面板走 /suite/domains/engineering/items 与 /suite/domains/engineering/actions：
 * 工单看板、派工、核材料、验收与施工记录。
 */
const content = getSuiteContent('engineering');

type Metric = { label: string; value: string; hint?: string };
type MaterialInput = { name: string; qty: number; unitPriceFen: number };

const items = ref<SuiteDomainItemDto[]>([]);
const metrics = ref<Metric[]>([]);
const loading = ref(true);
const error = ref('');
/** 正在执行的动作标识（按条目区分），用于按钮态与防连点 */
const busy = ref('');

/** 新建工单表单 */
const newTitle = ref('');
const newSite = ref('');
const newOwner = ref('');
const newMaterials = ref('');

/** 派工 / 材料 / 验收退回 / 施工记录：同一时刻只展开一个表单 */
const dispatchingId = ref('');
const materialsId = ref('');
const rejectingId = ref('');
const notingId = ref('');

const ownerInput = ref('');
const materialsInput = ref('');
const acceptNote = ref('');
const noteInput = ref('');

const signedIn = computed(() => isLoggedIn());

/** 登录引导：未登录点动作时先跳登录页，并带回本页 redirect。 */
function onNeedLogin(): void {
  goTo(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.suiteEngineering)}`);
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

/** 拉工单看板与领域指标；失败只影响这一块，不阻断静态正文。 */
async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [list, stats] = await Promise.all([
      suiteApi.items('engineering'),
      suiteApi.stats('engineering'),
    ]);
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
    const [list, stats] = await Promise.all([
      suiteApi.items('engineering'),
      suiteApi.stats('engineering'),
    ]);
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
    const res = await suiteApi.act('engineering', input);
    toast(res.message || (res.changed ? '已完成' : '没有变化'));
    await refresh();
  } catch (e) {
    toast(e instanceof Error ? e.message : '操作没成功，稍后再试');
  } finally {
    busy.value = '';
  }
}

/** 展开表单前先过登录门禁：未登录不进入写流程，直接引导登录。 */
function ensureLogin(): boolean {
  if (isLoggedIn()) return true;
  onNeedLogin();
  return false;
}

/** 清掉所有展开中的表单。 */
function cancelForm(): void {
  dispatchingId.value = '';
  materialsId.value = '';
  rejectingId.value = '';
  notingId.value = '';
  ownerInput.value = '';
  materialsInput.value = '';
  acceptNote.value = '';
  noteInput.value = '';
}

/* ---------- 条目取数 ---------- */

function ownerOf(item: SuiteDomainItemDto): string {
  const owner = item.payload['owner'];
  return typeof owner === 'string' && owner.trim() !== '' ? owner : '未指派';
}

function siteOf(item: SuiteDomainItemDto): string {
  const site = item.payload['site'];
  return typeof site === 'string' && site.trim() !== '' ? site : '未填写';
}

/** 材料总价（分）。服务端按分核算，展示时换算成元。 */
function totalFenOf(item: SuiteDomainItemDto): number {
  const raw = item.payload['materialsTotalFen'];
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** 分 → 元（两位小数）。 */
function yuanOf(fen: number): string {
  return (fen / 100).toFixed(2);
}

/** 施工记录条数。 */
function noteCountOf(item: SuiteDomainItemDto): number {
  const raw = item.payload['noteCount'];
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 解析材料清单文本：每行「名称 数量 单价（元）」。
 * 单价在前端换算成分，服务端只接收整数分，避免浮点误差。
 */
function parseMaterials(raw: string): { ok: true; materials: MaterialInput[] } | { ok: false; message: string } {
  const lines = raw
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter((v) => v !== '');
  if (!lines.length) {
    return { ok: false, message: '先写上材料清单（每行：名称 数量 单价）' };
  }
  const materials: MaterialInput[] = [];
  for (const line of lines) {
    const parts = line
      .split(/[\s、,，;；]+/)
      .map((v) => v.trim())
      .filter((v) => v !== '');
    if (parts.length < 3) {
      return { ok: false, message: `这一行看不懂：「${line}」，按「名称 数量 单价（元）」写` };
    }
    const name = parts[0] ?? '';
    const qty = Number(parts[1]);
    const yuan = Number(parts[2]);
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, message: `「${name}」的数量需要是大于 0 的数字` };
    }
    if (!Number.isFinite(yuan) || yuan < 0) {
      return { ok: false, message: `「${name}」的单价需要是以元表示的非负数字` };
    }
    materials.push({ name, qty, unitPriceFen: Math.round(yuan * 100) });
  }
  return { ok: true, materials };
}

/** 条目上已存的材料清单还原成可编辑文本（单价换回元）。 */
function materialsTextOf(item: SuiteDomainItemDto): string {
  const raw = item.payload['materials'];
  if (!Array.isArray(raw)) return '';
  return raw
    .map((entry) => {
      const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      const name = typeof row['name'] === 'string' ? row['name'] : '';
      if (!name) return '';
      const qty = Number(row['qty']);
      const fen = Number(row['unitPriceFen']);
      const count = Number.isFinite(qty) ? qty : 0;
      const price = Number.isFinite(fen) ? (fen / 100).toFixed(2) : '0.00';
      return `${name} ${count} ${price}`;
    })
    .filter((v) => v !== '')
    .join('\n');
}

/* ---------- 动作 ---------- */

/** 登记一条新工单：进入待派工阶段。 */
function submitCreate(): void {
  const title = newTitle.value.trim();
  if (!title) {
    toast('先写上工单标题');
    return;
  }
  const site = newSite.value.trim();
  const owner = newOwner.value.trim();
  const materialsRaw = newMaterials.value.trim();
  let materials: MaterialInput[] = [];
  if (materialsRaw) {
    const parsed = parseMaterials(materialsRaw);
    if (!parsed.ok) {
      toast(parsed.message);
      return;
    }
    materials = parsed.materials;
  }
  void run(
    {
      action: 'create',
      note: title,
      payload: {
        title,
        ...(site ? { site } : {}),
        ...(owner ? { owner } : {}),
        ...(materials.length ? { materials } : {}),
      },
    },
    'create',
  );
  newTitle.value = '';
  newSite.value = '';
  newOwner.value = '';
  newMaterials.value = '';
}

/** 派工：先填负责人。 */
function startDispatch(item: SuiteDomainItemDto): void {
  if (!ensureLogin()) return;
  cancelForm();
  dispatchingId.value = item.id;
  ownerInput.value = ownerOf(item) === '未指派' ? '' : ownerOf(item);
}

/** 提交派工。 */
function submitDispatch(item: SuiteDomainItemDto): void {
  const owner = ownerInput.value.trim();
  if (!owner) {
    toast('派工要先写明负责人');
    return;
  }
  void run({ action: 'dispatch', entryId: item.id, payload: { owner } }, `dispatch:${item.id}`);
  cancelForm();
}

/** 推进到下一阶段（已派工 → 施工中 → 验收中）。 */
function advance(item: SuiteDomainItemDto): void {
  void run({ action: 'advance', entryId: item.id }, `advance:${item.id}`);
}

/** 核材料：展开清单表单。 */
function startMaterials(item: SuiteDomainItemDto): void {
  if (!ensureLogin()) return;
  cancelForm();
  materialsId.value = item.id;
  materialsInput.value = materialsTextOf(item);
}

/** 提交材料清单核算总价。 */
function submitMaterials(item: SuiteDomainItemDto): void {
  const parsed = parseMaterials(materialsInput.value);
  if (!parsed.ok) {
    toast(parsed.message);
    return;
  }
  void run(
    { action: 'materials_cost', entryId: item.id, payload: { materials: parsed.materials } },
    `materials:${item.id}`,
  );
  cancelForm();
}

/** 验收不通过：先写清问题再退回施工。 */
function startReject(item: SuiteDomainItemDto): void {
  if (!ensureLogin()) return;
  cancelForm();
  rejectingId.value = item.id;
  acceptNote.value = '';
}

/** 验收通过（直接提交）。 */
function accept(item: SuiteDomainItemDto, decision: 'pass' | 'reject'): void {
  if (!ensureLogin()) return;
  if (decision === 'pass') {
    void run({ action: 'accept', entryId: item.id, payload: { decision } }, `accept:${item.id}`);
    return;
  }
  cancelForm();
  rejectingId.value = item.id;
  acceptNote.value = '';
}

/** 提交验收退回：必须写明问题。 */
function submitReject(item: SuiteDomainItemDto): void {
  const note = acceptNote.value.trim();
  if (!note) {
    toast('验收不通过要写明问题，方便施工方照着改');
    return;
  }
  void run(
    { action: 'accept', entryId: item.id, payload: { decision: 'reject', acceptNote: note } },
    `accept:${item.id}`,
  );
  cancelForm();
}

/** 记一笔施工记录：展开输入。 */
function startNote(item: SuiteDomainItemDto): void {
  if (!ensureLogin()) return;
  cancelForm();
  notingId.value = item.id;
  noteInput.value = '';
}

/** 提交施工记录。 */
function submitNote(item: SuiteDomainItemDto): void {
  const content = noteInput.value.trim();
  if (!content) {
    toast('写一句记录内容再提交');
    return;
  }
  void run(
    { action: 'progress_note', entryId: item.id, payload: { note: content } },
    `note:${item.id}`,
  );
  cancelForm();
}

onMounted(() => {
  void load();
});

applySuiteSeo({
  title: '工程 · MixmAPP 业务套件',
  description: '工单派发、材料清单与验收留痕，现场与图纸对齐。',
  path: ROUTES.suiteEngineering,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: '工程 · MixmAPP 业务套件',
    description: '工单派发、材料清单与验收留痕，现场与图纸对齐。',
    inLanguage: 'zh-CN',
  },
});
</script>

<style scoped lang="scss">
.eng {
  margin: 0 $sp-4 $sp-4;
  display: flex;
  flex-direction: column;
  gap: $sp-3;
}

/* ---------- 指标条 ---------- */
.eng-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: $sp-2;
}

.eng-metric {
  flex: 1 1 30%;
  min-width: 200rpx;
  padding: $sp-3;
  border-radius: $r-card;
  background: $paper-2;
}

.eng-metric-label {
  display: block;
  font-size: $fs-micro;
  color: $ink-3;
}

.eng-metric-value {
  display: block;
  margin-top: 6rpx;
  font-size: $fs-h3;
  font-weight: 800;
  color: $acc-6;
}

/* ---------- 新建工单 ---------- */
.eng-compose {
  padding: $sp-4;
}

.eng-compose__title {
  font-size: $fs-h3;
}

.eng-compose__hint {
  margin: 8rpx 0 $sp-3;
}

.eng-compose__field {
  margin-top: $sp-2;
}

.eng-compose__area {
  margin-top: $sp-2;
  min-height: 160rpx;
}

.eng-compose__btn {
  margin-top: $sp-3;
  width: 100%;
}

/* ---------- 看板 ---------- */
.eng-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $sp-2;
  padding-top: $sp-2;
}

.eng-head__title {
  font-size: $fs-h3;
}

.eng-head__count {
  flex: 0 0 auto;
}

.eng-items {
  display: flex;
  flex-direction: column;
  gap: $sp-3;
}

.eng-item {
  padding: $sp-4;
}

.eng-item__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $sp-2;
}

.eng-item__title {
  flex: 1;
  min-width: 0;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  color: $ink;
}

.eng-item__stage {
  flex: 0 0 auto;
}

.eng-item__summary {
  display: block;
  margin-top: 12rpx;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

.eng-item__line {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: $sp-3;
}

.eng-item__line-label {
  flex: 0 0 auto;
}

.eng-item__line-value {
  flex: 0 0 auto;
  font-size: $fs-micro;
  color: $ink;
}

.eng-item__meta {
  margin-top: $sp-3;
  padding: $sp-3;
  border-radius: $r-control;
  background: $paper-2;
}

.eng-item__meta-row {
  display: flex;
  justify-content: space-between;
  gap: $sp-3;
  padding: 4rpx 0;
}

.eng-item__meta-label {
  flex: 0 0 auto;
  font-family: $font-mono;
  font-size: $fs-micro;
  color: $ink-4;
}

.eng-item__meta-value {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: $fs-micro;
  color: $ink-2;
}

.eng-item__cost {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $sp-3;
  margin-top: $sp-3;
  padding: $sp-3;
  border-radius: $r-control;
  background: $amber-soft;
}

.eng-item__cost-value {
  font-size: $fs-h3;
  font-weight: 800;
  color: $acc-4;
}

.eng-item__notes {
  margin-top: $sp-2;
}

/* ---------- 操作 ---------- */
.eng-item__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: $sp-3;
}

.eng-act {
  flex: 0 0 auto;
}

/* ---------- 行内表单 ---------- */
.eng-form {
  margin-top: $sp-3;
  padding: $sp-3;
  border-radius: $r-control;
  background: $paper-2;
}

.eng-form__area {
  min-height: 140rpx;
}

.eng-form__hint {
  margin-top: 10rpx;
}

.eng-form__actions {
  display: flex;
  gap: 12rpx;
  margin-top: $sp-2;
}

.eng-state-btn {
  margin-top: $sp-3;
}

.eng-foot {
  margin-top: $sp-2;
  text-align: center;
}
</style>
