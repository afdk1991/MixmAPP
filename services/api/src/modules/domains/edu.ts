import type { SuiteActionResultDto, SuiteDomainId, SuiteDomainItemDto } from '@mixmapp/contracts';
import type { SuiteBoardRecord, SuiteProgressStatus } from '../../db/types.js';
import {
  canTransit,
  createBoardDomain,
  toDomainItem,
  type SuiteDomainActionContext,
  type SuiteDomainModule,
  type SuiteDomainReadContext,
} from '../suite/domain.js';

/**
 * 教育科研领域模块（学习路径、随堂判分与文献记录）。
 *
 * 基线用看板 + 阶段状态机实现（规划中 → 学习中 → 巩固中 → 判分中 → 已完成），
 * 教育科研的专属语义在下面四处扩展：
 * - list：补齐学习路径 / 最近判分 / 文献数 / 错题数等行级字段；
 * - act：quiz（随堂判分）、record（文献记录）、path_node（路径节点推进）、
 *   review（标记待巩固）、mistake（错题登记）五个领域动作，
 *   未命中时回落到基线的 create / advance / setStage / remove；
 * - stats：路径平均完成度、待巩固条目、累计文献、已登记错题、本周判分次数。
 *
 * 两条硬规矩（与 docs/49 §4.4 一致）：
 * - 幂等：同一 action + 同一份入参重复提交，第二次必须 changed=false；
 * - 不抛异常：业务上不成立时返回 { ok:false, changed:false, message, item:null }。
 *
 * 数据口径全部落在 store.suite.* 四张通用台账里，领域差异放进 payload：
 * quizLog / score / citations / pathLog / pathProgress / mistakes / reviewNote。
 */
const DOMAIN_ID = 'edu' as SuiteDomainId;

/** 台账事件类型：一次随堂判分落一条事件，供「本周判分次数」等指标现算。 */
const QUIZ_EVENT_KIND = 'edu-quiz';
/** 条目上判分留痕的保留条数上限。 */
const QUIZ_LOG_LIMIT = 20;
/** 条目上文献记录的保留条数上限。 */
const CITATION_LIMIT = 60;
/** 条目上错题登记的保留条数上限。 */
const MISTAKE_LIMIT = 60;
/** 条目上路径推进留痕的保留条数上限。 */
const PATH_LOG_LIMIT = 40;
/** 判分达标线（百分制）：达到即视为该轮掌握达标；可按课程口径自行调整。 */
const PASS_SCORE = 60;
/** 一次判分最多接受的题数，避免 payload 无限膨胀。 */
const MAX_QUESTIONS = 60;
/** 一条学习路径最多登记的节点数。 */
const MAX_PATH_NODES = 200;
/** 一天的毫秒数，用于「本周判分次数」口径。 */
const DAY_MS = 86_400_000;

/** 阶段中文名。 */
const STAGE_LABELS: Record<string, string> = {
  planning: '规划中',
  learning: '学习中',
  consolidating: '巩固中',
  assessing: '判分中',
  completed: '已完成',
};

/**
 * 阶段迁移边：from → [to…]。
 * 正向是规划 → 学习 → 巩固 → 判分 → 完成；反向允许回退：
 * 巩固中 → 学习中（需重学）、判分中 → 巩固中（判分没过，重做巩固）、学习中 → 规划中（前置不成立，重排计划）。
 * 已完成是终态，不再向外迁移。
 */
const TRANSITIONS: Record<string, readonly string[]> = {
  planning: ['learning'],
  learning: ['consolidating', 'planning'],
  consolidating: ['assessing', 'learning'],
  assessing: ['completed', 'consolidating'],
  completed: [],
};

/* ---------- 通用小工具 ---------- */

/** 取字符串（去空白）；非字符串一律当空串。 */
function text(value: unknown): string {
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
  return STAGE_LABELS[stage] ?? stage;
}

/** 进度点 → 进度状态：满一百为 done，其余按有无进度分 doing / todo。 */
function statusOf(value: number): SuiteProgressStatus {
  if (value >= 100) return 'done';
  if (value > 0) return 'doing';
  return 'todo';
}

/**
 * 轻量字符串指纹（FNV-1a）：给判分 / 文献 / 错题当幂等键，不引第三方依赖。
 * 只用于「同一份内容是不是同一次提交」的判断，不承担安全职责。
 */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 一道题：题面、选项与正确项下标（正确项可缺省，缺省表示只登记题面）。 */
type QuizQuestion = { q: string; options: string[]; answer: number };

/** 判分留痕行。 */
type QuizRow = { key: string; score: number; correct: number; total: number; at: string };
/** 文献记录行。 */
type CitationRow = { key: string; title: string; citation: string; year: string; source: string; at: string };
/** 错题登记行。 */
type MistakeRow = { key: string; question: string; reason: string; at: string };
/** 路径推进留痕行。 */
type PathRow = { key: string; node: string; total: number; progress: number; at: string };

/** 读 payload 上的行数组；结构不对的行直接忽略，不让脏数据打断整条记录。 */
function readRows<T>(raw: unknown, pick: (record: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const rows: T[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = pick(item as Record<string, unknown>);
    if (row) rows.push(row);
  }
  return rows;
}

/** 读条目上的判分留痕。 */
function readQuizLog(payload: Record<string, unknown>): QuizRow[] {
  return readRows(payload['quizLog'], (record) => {
    const key = text(record['key']);
    if (!key) return null;
    return {
      key,
      score: num(record['score']),
      correct: num(record['correct']),
      total: num(record['total']),
      at: text(record['at']),
    };
  });
}

/** 读条目上的文献记录。 */
function readCitations(payload: Record<string, unknown>): CitationRow[] {
  return readRows(payload['citations'], (record) => {
    const key = text(record['key']);
    if (!key) return null;
    return {
      key,
      title: text(record['title']),
      citation: text(record['citation']),
      year: text(record['year']),
      source: text(record['source']),
      at: text(record['at']),
    };
  });
}

/** 读条目上的错题登记。 */
function readMistakes(payload: Record<string, unknown>): MistakeRow[] {
  return readRows(payload['mistakes'], (record) => {
    const key = text(record['key']);
    if (!key) return null;
    return {
      key,
      question: text(record['question']),
      reason: text(record['reason']),
      at: text(record['at']),
    };
  });
}

/** 读条目上的路径推进留痕。 */
function readPathLog(payload: Record<string, unknown>): PathRow[] {
  return readRows(payload['pathLog'], (record) => {
    const key = text(record['key']);
    if (!key) return null;
    return {
      key,
      node: text(record['node']),
      total: num(record['total']),
      progress: num(record['progress']),
      at: text(record['at']),
    };
  });
}

/** 条目上的路径推进度（百分比）；没有登记过路径节点时返回 null。 */
function pathProgressOf(payload: Record<string, unknown>): number | null {
  const raw = payload['pathProgress'];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** 条目上的文献条数（以累计计数为准，数组只是明细）。 */
function citationCountOf(payload: Record<string, unknown>): number {
  const counted = num(payload['citationCount']);
  if (counted > 0) return counted;
  return readCitations(payload).length;
}

/** 条目上的错题条数。 */
function mistakeCountOf(payload: Record<string, unknown>): number {
  const counted = num(payload['mistakeCount']);
  if (counted > 0) return counted;
  return readMistakes(payload).length;
}

/**
 * 领域 meta：学习路径 / 最近判分 / 文献记录三行必给，
 * 错题与巩固备注只在真的登记过时才补行（没数据不占位）。
 */
function eduMeta(payload: Record<string, unknown>): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];

  const node = text(payload['pathNode']);
  const progress = pathProgressOf(payload);
  rows.push({
    label: '学习路径',
    value: node ? `${node}${progress === null ? '' : ` · 推进 ${progress}%`}` : '未设置',
  });

  const rawScore = payload['score'];
  const score = typeof rawScore === 'number' && Number.isFinite(rawScore) ? Math.round(rawScore) : null;
  rows.push({
    label: '最近判分',
    value:
      score === null
        ? '未判分'
        : `${score}%（${num(payload['correctCount'])}/${num(payload['total'])}）`,
  });

  rows.push({ label: '文献记录', value: `${citationCountOf(payload)} 条` });

  const mistakes = mistakeCountOf(payload);
  if (mistakes > 0) rows.push({ label: '错题登记', value: `${mistakes} 条` });

  const note = text(payload['reviewNote']);
  if (note) rows.push({ label: '巩固备注', value: note });

  return rows;
}

/** 看板记录 → 领域条目（摘要与 meta 按教育科研口径产出）。 */
function toItem(board: SuiteBoardRecord): SuiteDomainItemDto {
  const payload = board.payload ?? {};
  return toDomainItem({
    id: board.id,
    title: board.title,
    summary: text(payload['summary']) || board.title,
    stage: board.stage,
    stageLabel: labelOf(board.stage),
    priority: board.priority,
    amountFen: board.amountFen,
    meta: eduMeta(payload),
    payload,
    updatedAt: board.updatedAt,
  });
}

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
 */
async function writeProgress(
  ctx: SuiteDomainActionContext,
  entryId: string,
  status: SuiteProgressStatus,
  value: number,
  notes: string,
): Promise<void> {
  const userId = ctx.userId as string;
  const existing = await ctx.store.suite.progress.find(userId, DOMAIN_ID, entryId);
  const now = new Date();
  await ctx.store.suite.progress.upsert({
    id: existing?.id ?? ctx.ids.next().id,
    userId,
    domainId: DOMAIN_ID,
    entryId,
    status,
    value: Math.max(0, Math.min(100, Math.round(value))),
    notes: notes || existing?.notes || '',
    dueAt: existing?.dueAt ?? null,
    completedAt: status === 'done' ? (existing?.completedAt ?? now) : null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

/* ---------- 基线看板领域 ---------- */

const base = createBoardDomain({
  id: DOMAIN_ID,
  stages: [
    { key: 'planning', label: '规划中' },
    { key: 'learning', label: '学习中' },
    { key: 'consolidating', label: '巩固中' },
    { key: 'assessing', label: '判分中' },
    { key: 'completed', label: '已完成' },
  ],
  transitions: TRANSITIONS,
  initialStage: 'planning',
  eventKind: 'edu-study',
  describe: (board) => ({
    summary: text(board.payload['summary']) || board.title,
    meta: eduMeta(board.payload ?? {}),
  }),
});

/* ---------- 领域动作 ---------- */

/**
 * 解析题目数组：结构不合法直接给出可读的拒绝理由，不抛异常。
 */
function parseQuestions(raw: unknown): { questions: QuizQuestion[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: '题目列表是空的，请至少录入一道题' };
  }
  if (raw.length > MAX_QUESTIONS) {
    return { error: `一次判分最多支持 ${MAX_QUESTIONS} 道题，请拆成多次登记` };
  }
  const questions: QuizQuestion[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!item || typeof item !== 'object') {
      return { error: `第 ${i + 1} 题的数据格式不对` };
    }
    const record = item as Record<string, unknown>;
    const q = text(record['q']);
    if (!q) return { error: `第 ${i + 1} 题缺少题面` };

    const rawOptions = record['options'];
    if (!Array.isArray(rawOptions) || rawOptions.length < 2) {
      return { error: `第 ${i + 1} 题至少要有两个选项` };
    }
    const options = rawOptions.map((value) => text(value));
    if (options.some((value) => value === '')) {
      return { error: `第 ${i + 1} 题有空的选项，请补齐后再判分` };
    }

    const rawAnswer = record['answer'];
    if (rawAnswer === undefined || rawAnswer === null || rawAnswer === '') {
      questions.push({ q, options, answer: -1 });
      continue;
    }
    const answer = typeof rawAnswer === 'number' ? rawAnswer : Number(rawAnswer);
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) {
      return { error: `第 ${i + 1} 题的正确项序号超出范围` };
    }
    questions.push({ q, options, answer });
  }
  return { questions };
}

/**
 * 解析错题序号：支持 1 起的题号，或与题面完全一致的文字。
 * 对不上题目的序号一律拒绝，不做「猜一个最像的」。
 */
function resolveWrongIds(
  raw: unknown,
  total: number,
  questions: QuizQuestion[],
): { wrong: number; error?: string } {
  if (!Array.isArray(raw)) return { wrong: 0 };
  let wrong = 0;
  for (const item of raw) {
    if (typeof item === 'number') {
      if (!Number.isInteger(item) || item < 1 || item > total) {
        return { wrong: 0, error: `错题序号 ${item} 超出了本次的 ${total} 道题` };
      }
      wrong += 1;
      continue;
    }
    const value = text(item);
    if (!value) return { wrong: 0, error: '错题序号格式不对，请填题号或题面' };
    const asNumber = Number(value);
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= total) {
      wrong += 1;
      continue;
    }
    if (questions.some((question) => question.q === value)) {
      wrong += 1;
      continue;
    }
    return { wrong: 0, error: `错题「${value}」对不上题目，请检查题号或题面` };
  }
  return { wrong };
}

/**
 * quiz：随堂判分。
 *
 * 两种入参：
 * - 逐题：payload.questions = [{ q, options:[…], answer:下标 }]，配合 payload.wrongIds 标出错题；
 * - 快速：payload.total（总题数）+ payload.correct（答对题数）。
 *
 * 服务端算分：score = 答对题数 ÷ 总题数，换成百分制整数；
 * 答对题数没给时按「总题数 − 错题数」反推；两者都没有则拒绝，不给假分。
 * 判分结果写进条目 payload（score / correctCount / total / quizLog），
 * 同时写一条 suite_progress 进度行，并落一条 suite_events（kind = edu-quiz）供统计现算。
 *
 * 幂等：幂等键优先取 payload.submissionId；没给时用本次判分内容的指纹。
 * 同一份内容重复提交返回 changed=false，不再累加判分次数。
 */
async function quizAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const payload = ctx.input.payload ?? {};
  const boardPayload = board.payload ?? {};

  // 题库：给了 questions 就逐题登记，否则走「总题数 + 答对题数」的快速口径。
  let questions: QuizQuestion[] = [];
  const rawQuestions = payload['questions'];
  if (rawQuestions !== undefined && rawQuestions !== null) {
    const parsed = parseQuestions(rawQuestions);
    if ('error' in parsed) return fail(parsed.error);
    questions = parsed.questions;
  }

  let total = questions.length;
  if (total === 0) {
    const rawTotal = payload['total'];
    const parsedTotal = typeof rawTotal === 'number' ? rawTotal : Number(rawTotal);
    if (!Number.isInteger(parsedTotal) || parsedTotal < 1) {
      return fail('请提供题目列表，或填写大于零的总题数');
    }
    if (parsedTotal > MAX_QUESTIONS) {
      return fail(`一次判分最多支持 ${MAX_QUESTIONS} 道题，请拆成多次登记`);
    }
    total = parsedTotal;
  }

  // 答对题数：给了就用；没给就按错题序号反推；两者都没有则拒绝。
  let correct: number;
  const rawCorrect = payload['correct'];
  if (rawCorrect !== undefined && rawCorrect !== null && rawCorrect !== '') {
    const parsedCorrect = typeof rawCorrect === 'number' ? rawCorrect : Number(rawCorrect);
    if (
      !Number.isInteger(parsedCorrect) ||
      parsedCorrect < 0 ||
      parsedCorrect > total
    ) {
      return fail(`答对题数需要在 0 到 ${total} 之间`);
    }
    correct = parsedCorrect;
  } else {
    const hasWrongIds = payload['wrongIds'] !== undefined && payload['wrongIds'] !== null;
    const wrong = resolveWrongIds(payload['wrongIds'], total, questions);
    if (wrong.error) return fail(wrong.error);
    if (!hasWrongIds) return fail('请填写答对题数，或标出错题序号');
    correct = total - wrong.wrong;
  }

  const score = Math.round((correct / total) * 100);
  const submissionId = text(payload['submissionId']);
  const key = submissionId
    ? `sub:${submissionId}`
    : `auto:${fingerprint(
        JSON.stringify({
          total,
          correct,
          questions: questions.map((question) => question.q),
        }),
      )}`;

  const log = readQuizLog(boardPayload);
  const duplicated = log.find((row) => row.key === key);
  if (duplicated) {
    return {
      ok: true,
      changed: false,
      message: `这次判分已经记过了（${duplicated.correct}/${duplicated.total} · ${duplicated.score}%）`,
      item: toItem(board),
      data: {
        score: duplicated.score,
        correctCount: duplicated.correct,
        total: duplicated.total,
        value: duplicated.score,
        status: statusOf(duplicated.score),
      },
    };
  }

  const now = new Date();
  const at = now.toISOString();
  const nextLog = [...log, { key, score, correct, total, at }].slice(-QUIZ_LOG_LIMIT);
  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: {
      ...boardPayload,
      score,
      correctCount: correct,
      total,
      lastQuizAt: at,
      quizCount: num(boardPayload['quizCount']) + 1,
      quizLog: nextLog,
    },
  });
  if (!updated) return fail('判分记录失败，请稍后再试');

  // 判分落一条台账事件，供「本周判分次数」这类指标现算，不做二次汇总。
  await ctx.store.suite.events.insert({
    id: ctx.ids.next().id,
    domainId: DOMAIN_ID,
    userId: ctx.userId as string,
    kind: QUIZ_EVENT_KIND,
    subject: updated.title,
    amountFen: 0,
    status: 'done',
    outTradeNo: null,
    payload: { boardId: board.id, score, correct, total },
    createdAt: now,
    updatedAt: now,
  });

  const status = statusOf(score);
  await writeProgress(ctx, board.id, status, score, `随堂判分 ${correct}/${total} · ${score}%`);

  return {
    ok: true,
    changed: true,
    message: `判分完成：${correct}/${total} 题，得分率 ${score}%${score >= PASS_SCORE ? '（达到达标线）' : '（未达达标线）'}`,
    item: toItem(updated),
    data: { score, correctCount: correct, total, value: score, status },
  };
}

/**
 * record：文献记录。
 *
 * 入参 payload.citation（题录）/ payload.title（标题）/ payload.year（年份）/ payload.source（来源）。
 * 文献以数组形式挂在条目 payload 上，同时记累计条数；文献本身不参与判分与路径计算。
 *
 * 幂等：题录 + 标题 + 年份 + 来源完全一致时视为同一条文献，重复提交返回 changed=false。
 */
async function recordAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const payload = ctx.input.payload ?? {};
  const citation = text(payload['citation']);
  const title = text(payload['title']);
  if (!citation && !title) return fail('请填写文献题录或文献标题');
  const year = text(payload['year']);
  const source = text(payload['source']);

  const boardPayload = board.payload ?? {};
  const rows = readCitations(boardPayload);
  const key = fingerprint([citation, title, year, source].join('｜'));
  const duplicated = rows.find((row) => row.key === key);
  if (duplicated) {
    return {
      ok: true,
      changed: false,
      message: `《${title || citation}》已经在记录里了（累计 ${rows.length} 条）`,
      item: toItem(board),
      data: { citationCount: rows.length },
    };
  }

  const now = new Date();
  const at = now.toISOString();
  const next = [...rows, { key, title: title || citation, citation, year, source, at }].slice(
    -CITATION_LIMIT,
  );
  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: {
      ...boardPayload,
      citations: next,
      citationCount: rows.length + 1,
      lastCitation: title || citation,
      lastCitationAt: at,
    },
  });
  if (!updated) return fail('文献记录失败，请稍后再试');

  return {
    ok: true,
    changed: true,
    message: `已记录文献《${title || citation}》（累计 ${rows.length + 1} 条）`,
    item: toItem(updated),
    data: { citationCount: rows.length + 1 },
  };
}

/**
 * path_node：学习路径节点推进。
 *
 * 入参 payload.node（节点名，必填）+ payload.total（节点总数，必填）；
 * 可选 payload.done（已完成节点数）：给了按完成数算完成度，没给按已登记的节点数算推进度。
 * 推进度写进条目 payload（pathNode / pathTotal / pathProgress），并写一条 suite_progress 进度行。
 *
 * 幂等：同一个节点名 + 同一个节点总数重复提交返回 changed=false，不重复累加推进度。
 * 首次登记节点时，条目从「规划中」进入「学习中」（该迁移边已在 TRANSITIONS 声明）。
 */
async function pathNodeAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const payload = ctx.input.payload ?? {};
  const node = text(payload['node']);
  if (!node) return fail('请填写节点名称，例如「第 3 讲 抽样估计」');

  const rawTotal = payload['total'];
  const total = typeof rawTotal === 'number' ? rawTotal : Number(rawTotal);
  if (!Number.isInteger(total) || total < 1) return fail('请填写节点总数（大于零的整数）');
  if (total > MAX_PATH_NODES) return fail(`一条路径最多登记 ${MAX_PATH_NODES} 个节点`);

  const boardPayload = board.payload ?? {};
  const log = readPathLog(boardPayload);
  const duplicated = log.find((row) => row.node === node && row.total === total);
  if (duplicated) {
    return {
      ok: true,
      changed: false,
      message: `节点「${node}」已经登记过了（推进到 ${duplicated.progress}%）`,
      item: toItem(board),
      data: { value: duplicated.progress, status: statusOf(duplicated.progress), node, total },
    };
  }

  // 完成度：给了 done 按完成数算；没给则按同一条路径上已登记的节点数推算推进度。
  const rawDone = payload['done'];
  let progress: number;
  if (rawDone !== undefined && rawDone !== null && rawDone !== '') {
    const done = typeof rawDone === 'number' ? rawDone : Number(rawDone);
    if (!Number.isFinite(done) || done < 0 || done > total) {
      return fail(`已完成节点数需要在 0 到 ${total} 之间`);
    }
    progress = Math.round((done / total) * 100);
  } else {
    const nodes = new Set(
      log.filter((row) => row.total === total).map((row) => row.node),
    );
    nodes.add(node);
    progress = Math.min(100, Math.round((nodes.size / total) * 100));
  }

  const now = new Date();
  const at = now.toISOString();
  const nextLog = [
    ...log,
    { key: fingerprint(`${node}｜${total}`), node, total, progress, at },
  ].slice(-PATH_LOG_LIMIT);

  const updated = await ctx.store.suite.boards.update(board.id, {
    // 第一次登记节点即视为开工：阶段从「规划中」推进到「学习中」（迁移边已声明）。
    stage: board.stage === 'planning' ? 'learning' : board.stage,
    payload: {
      ...boardPayload,
      pathNode: node,
      pathTotal: total,
      pathProgress: progress,
      pathUpdatedAt: at,
      pathLog: nextLog,
    },
  });
  if (!updated) return fail('路径节点登记失败，请稍后再试');

  const status = statusOf(progress);
  await writeProgress(ctx, board.id, status, progress, `路径推进 ${progress}% · ${node}`);

  return {
    ok: true,
    changed: true,
    message: `已推进到「${node}」，路径完成度 ${progress}%`,
    item: toItem(updated),
    data: { value: progress, status, node, total, progress },
  };
}

/**
 * review：标记待巩固 / 错题重做。
 *
 * 条目回到「巩固中」，备注写进 payload.reviewNote。
 * 「学习中 → 巩固中」「判分中 → 巩固中」两条迁移边都在 TRANSITIONS 里声明；
 * 「规划中」还没开工、「已完成」是终态，都会被拒绝并说明原因。
 *
 * 幂等：已经在「巩固中」且备注没变时返回 changed=false，只改备注时算一次真实变更。
 */
async function reviewAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const payload = ctx.input.payload ?? {};
  const note = text(payload['note']) || text(ctx.input.note);
  const stage = board.stage;

  if (stage === 'completed') {
    return fail('「已完成」是终态，需要重学请另建一条学习条目重新走一遍路径');
  }
  if (stage === 'planning') {
    return fail('条目还在「规划中」，先推进到「学习中」再标记待巩固');
  }

  const boardPayload = board.payload ?? {};
  const prevNote = text(boardPayload['reviewNote']);
  if (stage === 'consolidating' && prevNote === note) {
    return {
      ok: true,
      changed: false,
      message: '这条已经标记为待巩固了',
      item: toItem(board),
      data: { stage },
    };
  }
  if (stage !== 'consolidating' && !canTransit(TRANSITIONS, stage, 'consolidating')) {
    return fail(`不能从「${labelOf(stage)}」直接回到「巩固中」`);
  }

  const now = new Date();
  const updated = await ctx.store.suite.boards.update(board.id, {
    stage: 'consolidating',
    payload: {
      ...boardPayload,
      reviewNote: note,
      reviewedAt: now.toISOString(),
      reviewCount: num(boardPayload['reviewCount']) + 1,
    },
  });
  if (!updated) return fail('标记待巩固失败，请稍后再试');

  return {
    ok: true,
    changed: true,
    message: note ? `已标记为待巩固：${note}` : '已标记为待巩固',
    item: toItem(updated),
    data: { stage: 'consolidating' },
  };
}

/**
 * mistake：错题登记。
 *
 * 入参 payload.question（题面，必填）+ payload.reason（错误原因，可填）。
 * 错题追加到条目 payload 的 mistakes 数组上，并把 needsReview 置为 true，提醒回到巩固环节。
 *
 * 幂等：题面 + 错误原因完全一致时视为同一条错题，重复提交返回 changed=false。
 */
async function mistakeAction(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
  const board = await findBoard(ctx);
  if (!board) return fail('条目不存在或不属于你');

  const payload = ctx.input.payload ?? {};
  const question = text(payload['question']);
  if (!question) return fail('请填写错题题面');
  const reason = text(payload['reason']);

  const boardPayload = board.payload ?? {};
  const rows = readMistakes(boardPayload);
  const key = fingerprint([question, reason].join('｜'));
  const duplicated = rows.find((row) => row.key === key);
  if (duplicated) {
    return {
      ok: true,
      changed: false,
      message: '这条错题已经登记过了',
      item: toItem(board),
      data: { mistakeCount: rows.length },
    };
  }

  const now = new Date();
  const at = now.toISOString();
  const next = [...rows, { key, question, reason, at }].slice(-MISTAKE_LIMIT);
  const updated = await ctx.store.suite.boards.update(board.id, {
    payload: {
      ...boardPayload,
      mistakes: next,
      mistakeCount: rows.length + 1,
      needsReview: true,
      lastMistakeAt: at,
    },
  });
  if (!updated) return fail('错题登记失败，请稍后再试');

  return {
    ok: true,
    changed: true,
    message: `已登记错题（累计 ${rows.length + 1} 条）`,
    item: toItem(updated),
    data: { mistakeCount: rows.length + 1 },
  };
}

/* ---------- 对外导出 ---------- */

export const eduModule: SuiteDomainModule = {
  id: 'edu',

  /** 读：条目 + 领域 meta（学习路径 / 最近判分 / 文献数 / 错题数）。 */
  async list(ctx: SuiteDomainReadContext): Promise<SuiteDomainItemDto[]> {
    const boards = await ctx.store.suite.boards.listByUser(ctx.userId as string, {
      domainId: DOMAIN_ID,
    });
    return boards.map((board) => toItem(board));
  },

  /** 写：领域动作优先，未命中再回落到基线的 create / advance / setStage / remove。 */
  async act(ctx: SuiteDomainActionContext): Promise<SuiteActionResultDto> {
    switch (ctx.input.action) {
      case 'quiz':
        return quizAction(ctx);
      case 'record':
        return recordAction(ctx);
      case 'path_node':
        return pathNodeAction(ctx);
      case 'review':
        return reviewAction(ctx);
      case 'mistake':
        return mistakeAction(ctx);
      default:
        return base.act(ctx);
    }
  },

  /**
   * 统计：路径平均完成度 / 待巩固条目 / 累计文献 / 已登记错题 / 本周判分次数。
   * 某一项没有对应数据时整项不出现，不用零值或估算值占位。
   */
  async stats(ctx: SuiteDomainReadContext) {
    const userId = ctx.userId as string;
    const boards = await ctx.store.suite.boards.listByUser(userId, { domainId: DOMAIN_ID });
    const metrics: Array<{ label: string; value: string; hint?: string }> = [];

    // 路径平均完成度：只统计已经登记过路径节点的条目。
    const progresses = boards
      .map((board) => pathProgressOf(board.payload ?? {}))
      .filter((value): value is number => value !== null);
    if (progresses.length > 0) {
      const average = Math.round(
        progresses.reduce((sum, value) => sum + value, 0) / progresses.length,
      );
      metrics.push({
        label: '路径平均完成度',
        value: `${average}%`,
        hint: '已登记路径条目的推进度平均值',
      });
    }

    // 待巩固条目：停在「巩固中」、等一轮复习收口的条目。
    const pending = boards.filter((board) => board.stage === 'consolidating').length;
    if (pending > 0) {
      metrics.push({
        label: '待巩固条目',
        value: `${pending} 条`,
        hint: '停在「巩固中」、等一轮复习收口的条目',
      });
    }

    // 累计文献：全部条目上登记的文献条数。
    const citations = boards.reduce(
      (sum, board) => sum + citationCountOf(board.payload ?? {}),
      0,
    );
    if (citations > 0) {
      metrics.push({
        label: '累计文献',
        value: `${citations} 条`,
        hint: '全部条目上登记的文献条数',
      });
    }

    // 已登记错题：累计登记的错题数量。
    const mistakes = boards.reduce(
      (sum, board) => sum + mistakeCountOf(board.payload ?? {}),
      0,
    );
    if (mistakes > 0) {
      metrics.push({
        label: '已登记错题',
        value: `${mistakes} 条`,
        hint: '累计登记的错题数量',
      });
    }

    // 本周判分次数：按台账事件里最近七天的判分事件算，不做二次汇总。
    const quizEvents = await ctx.store.suite.events.listByUser(userId, {
      domainId: DOMAIN_ID,
      kind: QUIZ_EVENT_KIND,
    });
    const weekAgo = Date.now() - 7 * DAY_MS;
    const thisWeek = quizEvents.filter(
      (event) => event.createdAt.getTime() >= weekAgo,
    ).length;
    if (thisWeek > 0) {
      metrics.push({
        label: '本周判分次数',
        value: `${thisWeek} 次`,
        hint: '最近 7 天内完成的随堂判分',
      });
    }

    const baseStats = await base.stats(ctx);
    return [...metrics, ...baseStats];
  },
};
