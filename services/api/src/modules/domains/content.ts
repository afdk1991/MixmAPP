import type { SuiteActionResultDto, SuiteDomainId, SuiteDomainItemDto } from '@mixmapp/contracts';
import type { SuiteBoardRecord, SuiteProgressStatus } from '../../db/types.js';
import {
  createBoardDomain,
  toDomainItem,
  type SuiteDomainActionContext,
  type SuiteDomainModule,
  type SuiteDomainReadContext,
} from '../suite/domain.js';

/**
 * 内容创作领域模块（选题库、稿件流转与发布排期）。
 *
 * 基线用看板 + 阶段状态机实现，内容创作的专属语义在下面四处扩展：
 * - list：补齐「当前阶段 / 栏目频道 / 负责人 / 发布日期 / 距发布天数 / 清单完成率」领域 meta；
 * - act：topic（选题建档）、commission（约稿）、schedule（排期）、revise（退回修改）、
 *   publish（发布登记）、checklist_progress（稿件清单完成率）六个领域动作，
 *   未命中时回落到基线的 create / advance / setStage / remove；
 * - stats：待审稿件数、已排期条数、近七天发布条数、选题到发布平均天数、渠道分布。
 *
 * 两条硬规矩（与 docs/49 §4.4 一致）：
 * - 幂等：同一 action + 同一份入参重复提交，第二次必须 changed=false；
 * - 不抛异常：业务上不成立时返回 { ok:false, changed:false, message, item:null }。
 *
 * 数据口径全部落在 store.suite.* 四张通用台账里，领域差异放进 payload：
 * channel / angle / keywords / assignee / deadline / publishAt / url /
 * publishedAt / reviseNote / checklist / checklistPercent。
 */
const DOMAIN_ID = 'content' as SuiteDomainId;

/** 一天的毫秒数：用于「近七天」「距发布天数」「选题到发布」口径。 */
const DAY_MS = 86_400_000;

/** 台账事件类型：一次约稿登记。 */
const COMMISSION_EVENT_KIND = 'content-commission';
/** 台账事件类型：一次排期（含改期）。 */
const SCHEDULE_EVENT_KIND = 'content-schedule';
/** 台账事件类型：一次发布登记。 */
const PUBLISH_EVENT_KIND = 'content-published';
/** 台账事件类型：一次退回修改。 */
const REVISE_EVENT_KIND = 'content-revise';

/** 阶段中文名。 */
const STAGE_LABEL: Record<string, string> = {
  idea: '选题',
  writing: '撰写中',
  review: '待审',
  scheduled: '已排期',
  published: '已发布',
};

/**
 * 阶段迁移表：只允许这几条边，其余一律拒绝并说明原因。
 * - 选题 → 撰写中：认领并开始动笔；
 * - 撰写中 → 待审 / 退回选题：交审，或撤回去重写；
 * - 待审 → 已排期 / 退回撰写中：排期，或写明原因退回修改；
 * - 已排期 → 已发布 / 退回待审：发布登记，或改期重审；
 * - 已发布：终态，不再流转。
 */
const TRANSITIONS: Record<string, readonly string[]> = {
  idea: ['writing'],
  writing: ['review', 'idea'],
  review: ['scheduled', 'writing'],
  scheduled: ['published', 'review'],
  published: [],
};

/* ---------- 通用小工具 ---------- */

/** 取字符串（去空白）；非字符串一律当空串。 */
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 取数字；拿不到或不是有限数返回 0。 */
function num(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** 业务不成立时的统一返回：不抛异常，只给用户看的话。 */
function fail(message: string): SuiteActionResultDto {
  return { ok: false, changed: false, message, item: null };
}

/** 阶段中文名。 */
function labelOf(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
}

/** 本地时区的 YYYY-MM-DD。台账里的「今天」一律按服务端本地日切分。 */
function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 是否是真实存在的 YYYY-MM-DD（2026-02-30 这类会被判为非法）。 */
function isValidDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  return dayKey(parsed) === value;
}

/**
 * 把用户填的日期归一成 YYYY-MM-DD。
 * 接受两种写法：纯日期（2026-12-01）与完整日期时间（2026-12-01T09:30:00 之类）。
 * 其它写法一律判为非法，返回 null，由调用方给出人话提示。
 */
function normalizeDay(value: string): string | null {
  const raw = value.trim();
  if (raw === '') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return isValidDayKey(raw) ? raw : null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return dayKey(parsed);
  }
  return null;
}

/** 两个 YYYY-MM-DD 之间相差的自然天数（to - from）。 */
function diffDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / DAY_MS);
}

/** 按行拆列表（清单：一条一行，不按逗号拆，避免把一句话拆成两条）。 */
function toLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => str(v)).filter((v) => v !== '');
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter((v) => v !== '');
  }
  return [];
}

/** 拆关键词（顿号、逗号、分号、换行都算分隔符）。 */
function toKeywords(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => str(v)).filter((v) => v !== '');
  }
  if (typeof value === 'string') {
    return value
      .split(/[\r\n、,，;；]+/)
      .map((v) => v.trim())
      .filter((v) => v !== '');
  }
  return [];
}

/** 阶段 → 进度点：五段流水线的完成度（0 / 25 / 50 / 75 / 100）。 */
function stageProgress(stage: string): { status: SuiteProgressStatus; value: number } {
  switch (stage) {
    case 'writing':
      return { status: 'doing', value: 25 };
    case 'review':
      return { status: 'doing', value: 50 };
    case 'scheduled':
      return { status: 'doing', value: 75 };
    case 'published':
      return { status: 'done', value: 100 };
    default:
      return { status: 'todo', value: 0 };
  }
}

/**
 * 领域 meta：当前阶段 / 栏目频道 / 负责人 / 发布日期 / 距发布 / 清单完成率 / 发布链接。
 * 没填的项不占位（只有「当前阶段」始终给），避免一条稿件挂着一堆空标签。
 */
function contentMeta(
  payload: Record<string, unknown>,
  stage: string,
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: '当前阶段', value: labelOf(stage) },
    { label: '栏目 / 频道', value: str(payload['channel']) || '未设置' },
    { label: '负责人', value: str(payload['assignee']) || '未指派' },
  ];

  const published = stage === 'published';
  const publishAt = str(payload['publishAt']);
  const publishedAt = str(payload['publishedAt']);
  rows.push({
    label: published ? '发布日' : '排期日',
    value: published ? publishedAt || '未登记' : publishAt || '未排期',
  });

  if (!published && publishAt) {
    const days = diffDays(dayKey(new Date()), publishAt);
    rows.push({
      label: '距发布',
      value: days === 0 ? '今天发布' : days > 0 ? `还有 ${days} 天` : `已过 ${-days} 天`,
    });
  }

  const percent = num(payload['checklistPercent']);
  if (percent > 0) {
    rows.push({ label: '清单完成率', value: `${percent}%` });
  }

  const url = str(payload['url']);
  if (url) rows.push({ label: '发布链接', value: url });

  const reviseNote = str(payload['reviseNote']);
  if (reviseNote && stage === 'writing') {
    rows.push({ label: '退回原因', value: reviseNote });
  }

  return rows;
}

/** 领域摘要：有清单完成率时把它挂在摘要前面，一眼能看出这篇稿子写到哪了。 */
function contentSummary(payload: Record<string, unknown>, title: string): string {
  const base = str(payload['summary']) || title;
  const percent = num(payload['checklistPercent']);
  if (percent > 0) return `清单完成 ${percent}% · ${base}`;
  return base;
}

/** 看板记录 → 领域条目（内容创作口径）。 */
function toItem(board: SuiteBoardRecord): SuiteDomainItemDto {
  const payload = board.payload ?? {};
  return toDomainItem({
    id: board.id,
    title: board.title,
    summary: contentSummary(payload, board.title),
    stage: board.stage,
    stageLabel: labelOf(board.stage),
    priority: board.priority,
    amountFen: board.amountFen,
    meta: contentMeta(payload, board.stage),
    payload,
    updatedAt: board.updatedAt,
  });
}

/* ---------- 基线看板领域 ---------- */

const base = createBoardDomain({
  id: DOMAIN_ID,
  stages: [
    { key: 'idea', label: '选题' },
    { key: 'writing', label: '撰写中' },
    { key: 'review', label: '待审' },
    { key: 'scheduled', label: '已排期' },
    { key: 'published', label: '已发布' },
  ],
  transitions: TRANSITIONS,
  initialStage: 'idea',
  eventKind: 'content-item',
  describe: (board) => ({
    summary: contentSummary(board.payload ?? {}, board.title),
    meta: contentMeta(board.payload ?? {}, board.stage),
  }),
});

/* ---------- 领域辅助 ---------- */

/** 取当前用户的条目；不属于本人一律当作不存在。 */
async function findBoard(ctx: SuiteDomainActionContext): Promise<SuiteBoardRecord | null> {
  const entryId = ctx.input.entryId?.trim() ?? '';
  if (!entryId) return null;
  const found = await ctx.store.suite.boards.find(entryId);
  if (!found || found.userId !== ctx.userId) return null;
  return found;
}

/**
 * 写进度行：同一 (用户, 领域, 条目) 只保留一行，重复写即覆盖。
 * 进度口径＝阶段流水线的完成度（选题 0 / 撰写中 25 / 待审 50 / 已排期 75 / 已发布 100）。
 */
async function writeProgress(
  ctx: SuiteDomainActionContext,
  entryId: string,
  stage: string,
): Promise<void> {
  const userId = ctx.userId as string;
  const { status, value } = stageProgress(stage);
  const existing = await ctx.store.suite.progress.find(userId, DOMAIN_ID, entryId);
  const now = new Date();
  await ctx.store.suite.progress.upsert({
    id: existing?.id ?? ctx.ids.next().id,
    userId,
    domainId: DOMAIN_ID,
    entryId,
    status,
    value,
    notes: existing?.notes ?? '',
    dueAt: existing?.dueAt ?? null,
    completedAt: status === 'done' ? (existing?.completedAt ?? now) : null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

/** 落一条台账事件（幂等键相同则不重复记）。 */
async function appendEvent(
  ctx: SuiteDomainActionContext,
  kind: string,
  subject: string,
  payload: Record<string, unknown>,
  key: string,
): Promise<void> {
  const userId = ctx.userId as string;
  const existing = await ctx.store.suite.events.listByUser(userId, {
    domainId: DOMAIN_ID,
    kind,
  });
  const duplicated = existing.find((event) => str(event.payload['eventKey']) === key);
  if (duplicated) return;
  const now = new Date();
  await ctx.store.suite.events.insert({
    id: ctx.ids.next().id,
    domainId: DOMAIN_ID,
    userId,
    kind,
    subject,
    amountFen: 0,
    status: 'done',
    outTradeNo: null,
    payload: { ...payload, eventKey: key },
    createdAt: now,
    updatedAt: now,
  });
}

/* ---------- 领域动作 ---------- */

/**
 * topic：选题建档。
 *
 * 不带 entryId 时等价于建一条新选题（进入「选题」阶段，频道 / 角度 / 关键词一并落库）；
 * 带 entryId 时用于补齐已有选题的频道、角度与关键词——只在「选题」阶段可改，
 * 稿件一旦动笔，题材口径就不允许再悄悄漂移。
 *
 * 幂等：频道 + 角度 + 关键词完全一致时返回 changed=false。
 */
async function topicAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const payload = ctx.input.payload ?? {};
  const channel = str(payload['channel']);
  const angle = str(payload['angle']);
  const keywords = toKeywords(payload['keywords']);

  if (!ctx.input.entryId) {
    const title = str(payload['title']) || str(ctx.input.note);
    if (!title) return fail('请先写上选题标题');
    const created = await base.act({ ...ctx, input: { ...ctx.input, action: 'create' } });
    if (!created.ok) return created;
    return {
      ...created,
      message: created.changed ? '选题已建档：进入「选题」阶段' : created.message,
    };
  }

  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');
  if (board.stage !== 'idea') {
    return fail(`只有「选题」阶段的条目可以补充选题角度，当前是「${labelOf(board.stage)}」`);
  }

  const prev = board.payload ?? {};
  const prevKeywords = toKeywords(prev['keywords']);
  const same =
    str(prev['channel']) === channel &&
    str(prev['angle']) === angle &&
    prevKeywords.length === keywords.length &&
    prevKeywords.every((v, i) => v === keywords[i]);
  if (same) {
    return {
      ok: true,
      changed: false,
      message: '频道、角度与关键词没有变化',
      item: toItem(board),
      data: { progress: stageProgress(board.stage) },
    };
  }

  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: { ...prev, channel, angle, keywords },
  });
  if (!updated) return fail('选题建档失败，请稍后再试');

  return {
    ok: true,
    changed: true,
    message: '选题已建档：频道、角度与关键词已记录',
    item: toItem(updated),
    data: { progress: stageProgress(updated.stage) },
  };
}

/**
 * commission：约稿。
 *
 * 记录 payload.assignee（约稿对象）与 payload.deadline（截止日）。
 * 阶段不变——约稿是「谁来写、什么时候交」的约定，不是流程推进。
 *
 * 幂等：负责人 + 截止日完全一致时返回 changed=false，台账里也不会多出一条约稿事件。
 */
async function commissionAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');
  if (board.stage === 'published') return fail('已发布的稿件不再改约稿信息');

  const payload = ctx.input.payload ?? {};
  const assignee = str(payload['assignee']);
  if (!assignee) return fail('请填写约稿对象，例如具体写作者或外协同学');

  const rawDeadline = str(payload['deadline']);
  let deadline = '';
  if (rawDeadline) {
    const normalized = normalizeDay(rawDeadline);
    if (!normalized) return fail('约稿截止日需要是 YYYY-MM-DD 这样的有效日期');
    deadline = normalized;
  }

  const prev = board.payload ?? {};
  if (str(prev['assignee']) === assignee && str(prev['deadline']) === deadline) {
    return {
      ok: true,
      changed: false,
      message: `「${assignee}」的约稿信息没有变化`,
      item: toItem(board),
      data: { assignee, deadline, progress: stageProgress(board.stage) },
    };
  }

  const now = new Date();
  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: { ...prev, assignee, deadline, commissionedAt: now.toISOString() },
  });
  if (!updated) return fail('约稿登记失败，请稍后再试');

  await appendEvent(
    ctx,
    COMMISSION_EVENT_KIND,
    `${board.title} → ${assignee}`,
    { boardId: board.id, assignee, deadline },
    `${board.id}|${assignee}|${deadline}`,
  );

  return {
    ok: true,
    changed: true,
    message: `已约稿：${assignee}${deadline ? ` · 截止 ${deadline}` : ''}`,
    item: toItem(updated),
    data: { assignee, deadline, progress: stageProgress(updated.stage) },
  };
}

/**
 * schedule：排期。
 *
 * 必须同时写 payload.channel（发布渠道）与 payload.publishAt（发布日期），
 * 缺一项直接拒绝——没有渠道和日期的「已排期」等于没排。
 *
 * 允许的来源阶段：待审（首次排期）与已排期（改期）；其余阶段一律拒绝并说明原因。
 * 幂等：已排期条目上再次提交同一渠道 + 同一日期，返回 changed=false，不改台账。
 */
async function scheduleAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const payload = ctx.input.payload ?? {};
  const channel = str(payload['channel']);
  if (!channel) return fail('排期必须写明发布渠道，例如公众号、小红书、知乎或视频号');

  const rawPublishAt = str(payload['publishAt']);
  if (!rawPublishAt) return fail('排期必须写明发布日期');
  const publishAt = normalizeDay(rawPublishAt);
  if (!publishAt) return fail('发布日期无法识别，请用 YYYY-MM-DD 或完整的日期时间格式');

  if (board.stage === 'published') return fail('已发布的稿件不再重新排期');
  if (board.stage !== 'review' && board.stage !== 'scheduled') {
    return fail(`只有「待审」或「已排期」的稿件可以排期，当前是「${labelOf(board.stage)}」`);
  }

  const prev = board.payload ?? {};
  if (
    board.stage === 'scheduled' &&
    str(prev['channel']) === channel &&
    str(prev['publishAt']) === publishAt
  ) {
    return {
      ok: true,
      changed: false,
      message: `已经排在 ${publishAt} 的${channel}，无需重复排期`,
      item: toItem(board),
      data: { channel, publishAt, progress: stageProgress(board.stage) },
    };
  }

  const now = new Date();
  const updated = await ctx.store.suite.boards.update(board.id, {
    stage: 'scheduled',
    payload: { ...prev, channel, publishAt, scheduledAt: now.toISOString() },
    dueAt: new Date(`${publishAt}T00:00:00`),
  });
  if (!updated) return fail('排期失败，请稍后再试');

  await writeProgress(ctx, board.id, 'scheduled');
  await appendEvent(
    ctx,
    SCHEDULE_EVENT_KIND,
    `${board.title} · ${channel} ${publishAt}`,
    { boardId: board.id, channel, publishAt },
    `${board.id}|${channel}|${publishAt}`,
  );

  return {
    ok: true,
    changed: true,
    message: `已排期：${publishAt} 发到${channel}`,
    item: toItem(updated),
    data: { channel, publishAt, progress: stageProgress('scheduled') },
  };
}

/**
 * revise：退回修改（待审 → 撰写中）。
 *
 * 必须写明退回原因，否则动作直接拒绝：没有原因的退修等于把问题原样扔回去。
 * 幂等：同一条原因重复提交返回 changed=false（稿件已在撰写中，不会再退一次）。
 */
async function reviseAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const payload = ctx.input.payload ?? {};
  const note = str(payload['reviseNote']) || str(payload['note']) || str(ctx.input.note);
  if (!note) return fail('退回修改必须写明原因，撰写人才知道改什么');

  const prev = board.payload ?? {};
  if (board.stage === 'writing' && str(prev['reviseNote']) === note && str(prev['revisedAt']) !== '') {
    return {
      ok: true,
      changed: false,
      message: '这条稿件已经退回过修改，原因没有变化',
      item: toItem(board),
      data: { reviseNote: note, progress: stageProgress('writing') },
    };
  }

  if (board.stage !== 'review') {
    return fail(`只有「待审」的稿件可以退回修改，当前是「${labelOf(board.stage)}」`);
  }

  const now = new Date();
  const updated = await ctx.store.suite.boards.update(board.id, {
    stage: 'writing',
    payload: { ...prev, reviseNote: note, revisedAt: now.toISOString() },
  });
  if (!updated) return fail('退回修改失败，请稍后再试');

  await writeProgress(ctx, board.id, 'writing');
  await appendEvent(
    ctx,
    REVISE_EVENT_KIND,
    `${board.title} · 退回修改`,
    { boardId: board.id, reviseNote: note },
    `${board.id}|${note}|${now.toISOString()}`,
  );

  return {
    ok: true,
    changed: true,
    message: `已退回修改：${note}`,
    item: toItem(updated),
    data: { reviseNote: note, progress: stageProgress('writing') },
  };
}

/**
 * publish：发布登记（已排期 → 已发布）。
 *
 * 记录 payload.publishedAt（发布日）与 payload.url（发布链接），链接可留空但给了就必须合法。
 * 状态不对直接拒绝并说明当前阶段；已发布条目重复登记同一组信息返回 changed=false。
 */
async function publishAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const payload = ctx.input.payload ?? {};
  const rawPublishedAt = str(payload['publishedAt']);
  if (!rawPublishedAt) return fail('发布登记需要写明发布时间');
  const publishedAt = normalizeDay(rawPublishedAt);
  if (!publishedAt) return fail('发布时间无法识别，请用 YYYY-MM-DD 或完整的日期时间格式');

  const url = str(payload['url']);
  if (url && !/^https?:\/\//i.test(url)) {
    return fail('发布链接需要以 http:// 或 https:// 开头');
  }

  const prev = board.payload ?? {};
  if (board.stage === 'published') {
    if (str(prev['publishedAt']) === publishedAt && str(prev['url']) === url) {
      return {
        ok: true,
        changed: false,
        message: '这条稿件已经登记过发布',
        item: toItem(board),
        data: { publishedAt, url, progress: stageProgress('published') },
      };
    }
    return fail('这条稿件已发布登记，如需更正发布信息请新建条目并注明关联');
  }

  if (board.stage !== 'scheduled') {
    return fail(`只有「已排期」的稿件才能登记发布，当前是「${labelOf(board.stage)}」`);
  }

  const now = new Date();
  const updated = await ctx.store.suite.boards.update(board.id, {
    stage: 'published',
    payload: { ...prev, publishedAt, url, publishedAtIso: now.toISOString() },
  });
  if (!updated) return fail('发布登记失败，请稍后再试');

  await writeProgress(ctx, board.id, 'published');
  await appendEvent(
    ctx,
    PUBLISH_EVENT_KIND,
    `${board.title} · ${publishedAt}`,
    { boardId: board.id, publishedAt, url },
    `${board.id}|${publishedAt}|${url}`,
  );

  return {
    ok: true,
    changed: true,
    message: `已登记发布：${publishedAt}${url ? ' · 链接已记录' : ''}`,
    item: toItem(updated),
    data: { publishedAt, url, progress: stageProgress('published') },
  };
}

/**
 * checklist_progress：稿件清单完成率。
 *
 * 入参 payload.checklist（清单条目，数组或换行字符串）+ payload.done（已完成条数），
 * 算出百分比写进条目（payload.checklistPercent、摘要与 meta）。
 *
 * 幂等：清单内容与完成数完全一致时返回 changed=false，不重复写条目。
 */
async function checklistProgressAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const payload = ctx.input.payload ?? {};
  const checklist = toLines(payload['checklist']);
  if (!checklist.length) return fail('请提供稿件清单条目，例如逐条写清要检查的动作');

  const rawDone = payload['done'] ?? payload['checked'];
  const parsed = typeof rawDone === 'number' ? rawDone : Number(rawDone ?? 0);
  const done = Math.min(Math.max(Math.trunc(Number.isFinite(parsed) ? parsed : 0), 0), checklist.length);
  const percent = Math.round((done / checklist.length) * 100);

  const prev = board.payload ?? {};
  const prevList = toLines(prev['checklist']);
  const same =
    num(prev['checklistPercent']) === percent &&
    prevList.length === checklist.length &&
    prevList.every((v, i) => v === checklist[i]);
  if (same) {
    return {
      ok: true,
      changed: false,
      message: `清单完成率 ${percent}%（${done}/${checklist.length}）`,
      item: toItem(board),
      data: {
        checklist: { percent, done, total: checklist.length },
        progress: stageProgress(board.stage),
      },
    };
  }

  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: {
      ...prev,
      checklist,
      checklistDone: done,
      checklistTotal: checklist.length,
      checklistPercent: percent,
    },
  });
  if (!updated) return fail('清单完成率记录失败，请稍后再试');

  return {
    ok: true,
    changed: true,
    message: `清单完成率 ${percent}%（${done}/${checklist.length}）`,
    item: toItem(updated),
    data: {
      checklist: { percent, done, total: checklist.length },
      progress: stageProgress(updated.stage),
    },
  };
}

/**
 * advance：推进到下一阶段。
 *
 * 与基线不同的地方：「待审 → 已排期」必须走排期动作（要填渠道与发布日期），
 * 「已排期 → 已发布」必须走发布登记（要填发布时间与链接），所以这两步在这里被拦下并指路。
 */
async function advanceAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');
  if (board.stage === 'review') {
    return fail('待审稿件请先做发布排期，填好渠道与发布日期再进入「已排期」');
  }
  if (board.stage === 'scheduled') {
    return fail('已排期稿件请用「发布登记」记录发布时间与链接');
  }
  const res = await base.act(ctx);
  if (res.ok && res.changed && res.item) {
    await writeProgress(ctx, res.item.id, res.item.stage);
  }
  return res;
}

/**
 * setStage：跳到指定阶段。
 *
 * 「已排期」与「已发布」只能由排期 / 发布登记动作进入，否则这两个阶段的必填信息会缺一块。
 */
async function stageAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const target = str(ctx.input.payload?.['stage']);
  if (target === 'scheduled') {
    return fail('进入「已排期」请用「排期」动作，同时写下渠道与发布日期');
  }
  if (target === 'published') {
    return fail('进入「已发布」请用「发布登记」动作，同时写下发布时间与链接');
  }
  const res = await base.act(ctx);
  if (res.ok && res.changed && res.item) {
    await writeProgress(ctx, res.item.id, res.item.stage);
  }
  return res;
}

/* ---------- 对外导出 ---------- */

export const contentModule: SuiteDomainModule = {
  id: 'content',

  /** 读：条目 + 领域 meta（阶段 / 栏目频道 / 负责人 / 发布日期 / 距发布 / 清单完成率）。 */
  async list(ctx: SuiteDomainReadContext): Promise<SuiteDomainItemDto[]> {
    return base.list(ctx);
  },

  /** 写：领域动作优先，未命中再回落到基线的 create / remove。 */
  async act(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
    switch (ctx.input.action) {
      case 'topic':
        return topicAction(ctx);
      case 'commission':
        return commissionAction(ctx);
      case 'schedule':
        return scheduleAction(ctx);
      case 'revise':
        return reviseAction(ctx);
      case 'publish':
        return publishAction(ctx);
      case 'checklist_progress':
        return checklistProgressAction(ctx);
      case 'advance':
        return advanceAction(ctx);
      case 'setStage':
        return stageAction(ctx);
      default:
        return base.act(ctx);
    }
  },

  /**
   * 统计：待审稿件数、已排期条数、近七天发布条数、选题到发布平均天数、渠道分布。
   * 某一项没有对应数据时整项不出现，不用零值或估算值占位。
   */
  async stats(ctx: SuiteDomainReadContext) {
    const userId = ctx.userId as string;
    const boards = await ctx.store.suite.boards.listByUser(userId, { domainId: DOMAIN_ID });
    const metrics: Array<{ label: string; value: string; hint?: string }> = [];

    const pendingReview = boards.filter((board) => board.stage === 'review').length;
    if (pendingReview > 0) {
      metrics.push({
        label: '待审稿件',
        value: `${pendingReview} 条`,
        hint: '停在待审阶段、等一个人点头的稿件',
      });
    }

    const scheduled = boards.filter((board) => board.stage === 'scheduled').length;
    if (scheduled > 0) {
      metrics.push({
        label: '已排期',
        value: `${scheduled} 条`,
        hint: '已定下发布渠道与发布日期的稿件',
      });
    }

    const weekAgo = Date.now() - 7 * DAY_MS;
    const publishedThisWeek = boards.filter(
      (board) => board.stage === 'published' && board.updatedAt.getTime() >= weekAgo,
    ).length;
    if (publishedThisWeek > 0) {
      metrics.push({
        label: '近七天发布',
        value: `${publishedThisWeek} 条`,
        hint: '最近七天完成发布登记的稿件',
      });
    }

    // 选题到发布的平均天数：已发布稿件从建档日到发布登记日的天数差。
    const spans = boards
      .filter((board) => board.stage === 'published')
      .map((board) => {
        const publishedAt = str(board.payload?.['publishedAt']);
        if (!publishedAt) return null;
        const days = diffDays(dayKey(board.createdAt), publishedAt);
        return days >= 0 ? days : null;
      })
      .filter((value): value is number => value !== null);
    if (spans.length > 0) {
      const average = spans.reduce((sum, value) => sum + value, 0) / spans.length;
      metrics.push({
        label: '选题到发布',
        value: `${average.toFixed(1)} 天`,
        hint: '已发布稿件从建档到发布登记的平均间隔',
      });
    }

    // 渠道分布：按发布渠道统计稿件条数。
    const channelCount = new Map<string, number>();
    for (const board of boards) {
      const channel = str(board.payload?.['channel']);
      if (!channel) continue;
      channelCount.set(channel, (channelCount.get(channel) ?? 0) + 1);
    }
    if (channelCount.size > 0) {
      const text = [...channelCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([channel, count]) => `${channel} ${count}`)
        .join(' · ');
      metrics.push({
        label: '渠道分布',
        value: text,
        hint: '按发布渠道统计的稿件条数',
      });
    }

    const baseStats = await base.stats(ctx);
    return [...metrics, ...baseStats];
  },
};
