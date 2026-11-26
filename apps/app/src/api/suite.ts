import type {
  SuiteActionInput,
  SuiteActionResultDto,
  SuiteBoardDto,
  SuiteDomainId,
  SuiteDomainItemDto,
  SuiteDomainMetaDto,
  SuiteDomainStatsDto,
  SuiteEventDto,
  SuiteInteractionDto,
  SuiteInteractionListDto,
  SuiteProgressDto,
} from '@mixmapp/contracts';
import { apiRequest } from './client';

/**
 * 业务套件前端数据层。
 *
 * 只负责**动态**部分：领域目录、领域动态条目、交互、进度、看板、台账事件。
 * 静态内容（说明、清单、FAQ）在 apps/app/src/content/suite/ 构建期内联，不走这里。
 *
 * 两条通道的分工：
 * - 页面骨架与正文：同步来自内容包，首屏零请求；
 * - 需要登录态的数据：页面 onLoad 之后异步拉，失败不阻断正文渲染。
 */
function toQueryString(query: Record<string, unknown>): string {
  const qs = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return qs ? `?${qs}` : '';
}

/** 领域目录（公开读）。 */
export const suiteApi = {
  /** 13 个领域的元信息；套件中心一次拉走。 */
  domains: () => apiRequest<SuiteDomainMetaDto[]>('/suite/domains', { auth: false }),

  /** 单个领域元信息。 */
  domain: (domainId: string) =>
    apiRequest<SuiteDomainMetaDto>(`/suite/domains/${encodeURIComponent(domainId)}`, { auth: false }),

  /** 领域动态条目；未登录时服务端返回空数组。 */
  items: (domainId: string) =>
    apiRequest<SuiteDomainItemDto[]>(`/suite/domains/${encodeURIComponent(domainId)}/items`),

  /** 领域统计：通用台账计数 + 领域自定义指标。 */
  stats: (domainId: string) =>
    apiRequest<SuiteDomainStatsDto>(`/suite/domains/${encodeURIComponent(domainId)}/stats`),

  /** 执行一次领域动作。 */
  act: (domainId: string, input: SuiteActionInput) =>
    apiRequest<SuiteActionResultDto>(`/suite/domains/${encodeURIComponent(domainId)}/actions`, {
      method: 'POST',
      data: input,
    }),

  /* ---------------- 交互 ---------------- */

  /** 某条目的交互：列表 + 四类计数 + 我的交互态。 */
  interactions: (domainId: string, entryId: string, kind?: 'comment' | 'like' | 'save' | 'rating') =>
    apiRequest<SuiteInteractionListDto>(
      `/suite/interactions${toQueryString({ domainId, entryId, kind })}`,
    ),

  /** 新增评论或评分（评分按人覆盖，评论按条追加）。 */
  addInteraction: (input: {
    domainId: string;
    entryId: string;
    kind: 'comment' | 'rating';
    body?: string;
    rating?: number;
  }) => apiRequest<SuiteInteractionDto>('/suite/interactions', { method: 'POST', data: input }),

  /** 点赞 / 收藏切换，返回切换后的当前态与最新计数。 */
  toggleInteraction: (domainId: string, entryId: string, kind: 'like' | 'save') =>
    apiRequest<{ active: boolean; counts: SuiteInteractionListDto['counts'] }>(
      '/suite/interactions/toggle',
      { method: 'POST', data: { domainId, entryId, kind } },
    ),

  /** 删除自己的评论。 */
  removeInteraction: (id: string) =>
    apiRequest<{ removed: boolean }>(`/suite/interactions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  /* ---------------- 进度 ---------------- */

  /** 读取当前用户的进度列表（可按领域过滤）。 */
  progress: (domainId?: string) =>
    apiRequest<SuiteProgressDto[]>(`/suite/progress${toQueryString({ domainId })}`),

  /** 写入进度；同一 (领域, 条目) 覆盖。 */
  setProgress: (input: {
    domainId: string;
    entryId: string;
    status: 'todo' | 'doing' | 'done' | 'archived';
    value?: number;
    notes?: string;
    dueAt?: string;
  // 用 POST 而不是 PUT：共享请求层当前只声明了 GET/POST/PATCH/DELETE 四种方法，
  // 套件线不额外扩展共享契约，避免与并行开发线的请求层改动互相牵扯。
  }) => apiRequest<SuiteProgressDto>('/suite/progress', { method: 'POST', data: input }),

  /* ---------------- 看板 ---------------- */

  /** 看板列表（可按领域 / 阶段过滤）。 */
  boards: (query: { domainId?: string; stage?: string } = {}) =>
    apiRequest<SuiteBoardDto[]>(`/suite/boards${toQueryString(query)}`),

  /** 新建看板条目。 */
  createBoard: (input: {
    domainId: string;
    title: string;
    stage: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    amountFen?: number;
    dueAt?: string;
    payload?: Record<string, unknown>;
  }) => apiRequest<SuiteBoardDto>('/suite/boards', { method: 'POST', data: input }),

  /** 更新看板条目（阶段流转等）。 */
  updateBoard: (
    id: string,
    patch: {
      title?: string;
      stage?: string;
      priority?: 'low' | 'normal' | 'high' | 'urgent';
      amountFen?: number;
      dueAt?: string | null;
      payload?: Record<string, unknown>;
    },
  ) => apiRequest<SuiteBoardDto>(`/suite/boards/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    data: patch,
  }),

  /** 删除看板条目。 */
  removeBoard: (id: string) =>
    apiRequest<{ removed: boolean }>(`/suite/boards/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  /* ---------------- 台账事件 ---------------- */

  /** 台账事件列表。 */
  events: (query: { domainId?: string; kind?: string; status?: string } = {}) =>
    apiRequest<SuiteEventDto[]>(`/suite/events${toQueryString(query)}`),

  /** 更新台账事件状态。 */
  setEventStatus: (id: string, status: SuiteEventDto['status']) =>
    apiRequest<SuiteEventDto>(`/suite/events/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      data: { status },
    }),
};

/** 领域 id 的本地类型别名，避免页面到处 import contracts。 */
export type { SuiteDomainId };
