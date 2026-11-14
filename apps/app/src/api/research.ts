/**
 * 深度研究（Deep Research）前端数据层。
 *
 * 约定：
 * - 类型全部本地定义，后端契约落地后天然兼容，无需改消费侧。
 * - MixmAPP 后端尚未实现 `/ai/research`（meta 中 `ai=dev`），故 `researchApi` 当前直接以
 *   `mock*` 工厂驱动，保证 UI/UX 在任意环境即时、完整可演示，不依赖外部密钥。
 *   接入真实端点时，将 `researchApi` 各方法改为调用 `client` 的 `apiRequest`
 *   （auth:false、统一错误归一），并保留 `mock*` 作为兜底，与 `mall.ts` 口径一致。
 */

export type ResearchStatus = 'planning' | 'researching' | 'writing' | 'done';

/** 报告章节：level 2 为一级、3 为子节。 */
export interface ResearchSection {
  id: string;
  heading: string;
  level: 2 | 3;
  paragraphs: string[];
  bullets?: string[];
}

/** 引用来源：展示标题、域名、片段与可复制链接。 */
export interface ResearchSource {
  id: string;
  title: string;
  domain: string;
  url: string;
  snippet: string;
}

/** 进度步骤：pending 待执行 / active 进行中 / done 已完成。 */
export interface ResearchStep {
  id: string;
  label: string;
  detail: string;
  status: 'pending' | 'active' | 'done';
}

/** 一次深度研究的完整任务。 */
export interface ResearchTask {
  id: string;
  query: string;
  status: ResearchStatus;
  /** 已完成步骤数（用于驱动时间线与报告逐步 reveal）。 */
  stepIndex: number;
  createdAt: string;
  updatedAt: string;
  durationSec: number;
  sourcesCount: number;
  sections: ResearchSection[];
  sources: ResearchSource[];
  steps: ResearchStep[];
}

/* ---------------------------------- 工具 ---------------------------------- */

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

function isoToDateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 给研究任务附加「相对时间」字段，供列表/详情展示。 */
export function researchRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}

/* ------------------------------ mock 工厂 ------------------------------ */

/** 根据任意问题生成一份结构化报告（章节 / 来源 / 步骤）。 */
export function buildReport(query: string): {
  sections: ResearchSection[];
  sources: ResearchSource[];
  steps: ResearchStep[];
} {
  const q = query.trim() || '该研究方向';
  const sections: ResearchSection[] = [
    {
      id: 's1',
      heading: '研究背景与问题界定',
      level: 2,
      paragraphs: [
        `围绕「${q}」展开系统性梳理。该问题横跨产品选型、工艺与供应链多个层面，单篇资料难以覆盖全貌，因此采用多源检索 + 交叉验证的方式，优先采信行业规范、厂商技术文档与第三方评测。`,
        '研究范围限定在近三年的公开可核验信息，剔除明显营销口径，保留可被二次查证的数据与结论。',
      ],
    },
    {
      id: 's2',
      heading: '核心结论',
      level: 2,
      paragraphs: ['综合多源资料，可得出以下要点：'],
      bullets: [
        '关键指标上，主流方案在可靠性与成本之间呈现明显权衡，没有绝对最优解。',
        '选型应优先匹配实际工况（载荷、环境、运维半径），而非单纯追高性能参数。',
        '供应链层面建议保留双源供应，以对冲交期与价格波动风险。',
      ],
    },
    {
      id: 's3',
      heading: '关键论据与数据',
      level: 2,
      paragraphs: [
        '在可核验样本中，规格参数的标注一致性存在差异：同一指标在不同来源存在命名与单位口径不一致的情况，需做单位归一后再比较。',
      ],
      bullets: [
        '行业规范的强制条款对安全裕度有下限要求，是选型的硬约束。',
        '第三方评测的疲劳/盐雾数据可作为横向参考，但不替代出厂检验。',
        '价格数据波动较大，公开面价仅作量级参考，正式报价需以供应商为准。',
      ],
    },
    {
      id: 's4',
      heading: '分歧与不确定性',
      level: 2,
      paragraphs: [
        '资料间存在两类分歧：一是不同工况下「最优」结论相反；二是部分来源的样本量不足，结论外推存在风险。',
        '对于需登录或付费才能获取的真实库存与折后价，本次未纳入，避免引用未经核对的数值。',
      ],
    },
    {
      id: 's5',
      heading: '行动建议',
      level: 2,
      paragraphs: ['基于上述，给出可落地的下一步：'],
      bullets: [
        '先明确工况边界与预算上限，再锁定 2–3 个候选方案做小批量验证。',
        '要求供应商提供可核验的检验与质保文件，纳入到货验收。',
        '建立关键参数对照表，沉淀为内部选型基线，降低重复研究成本。',
      ],
    },
  ];

  // 说明：以下来源域名均为 RFC 2606 保留示例域（example.com / .org / .net），
  // 属研究功能的内置占位夹具，不是真实远端，也不在 DNSPod 导出表内；
  // 无等价表内主机，按 pending 待确认保留现状，接入真实检索源后再替换。
  const sources: ResearchSource[] = [
    {
      id: 'r1',
      title: '行业技术规范与术语口径（概述）',
      domain: 'example-standards.org',
      url: 'https://example-standards.org/spec/overview',
      snippet: '规定了强制安全裕度下限与命名规范，是选型硬约束的主要依据。',
    },
    {
      id: 'r2',
      title: '厂商技术文档：材料与工艺参数',
      domain: 'vendor-docs.example.com',
      url: 'https://vendor-docs.example.com/materials',
      snippet: '给出材料牌号、表面处理与典型工况适用范围，含疲劳曲线附录。',
    },
    {
      id: 'r3',
      title: '第三方评测：盐雾与耐久横向对比',
      domain: 'lab-report.example.net',
      url: 'https://lab-report.example.net/compare',
      snippet: '在受控环境下对多批次样品做加速老化，提供可比的等级评分。',
    },
    {
      id: 'r4',
      title: '市场与供应链观察（公开面价）',
      domain: 'market-insight.example.com',
      url: 'https://market-insight.example.com/trends',
      snippet: '汇总近三年价格区间与交期波动，提示双源供应的必要性。',
    },
  ];

  const steps: ResearchStep[] = [
    { id: 'p1', label: '解析研究问题', detail: '拆解子问题与检索维度', status: 'done' },
    { id: 'p2', label: '多源检索', detail: '并行检索规范 / 厂商 / 评测 / 市场', status: 'done' },
    { id: 'p3', label: '阅读与筛选', detail: '去重、评分、保留高相关来源', status: 'done' },
    { id: 'p4', label: '交叉验证', detail: '比对口径冲突与数据出入', status: 'done' },
    { id: 'p5', label: '综合撰写', detail: '按结构化模板生成报告', status: 'done' },
    { id: 'p6', label: '校对与引用', detail: '核对引用格式与事实', status: 'done' },
  ];

  return { sections, sources, steps };
}

/** 预置历史：一条已完成报告 + 一条进行中（用于列表演示两种状态）。 */
function mockResearchList(): ResearchTask[] {
  const done = buildReport('高强度紧固件的材料选型与防松设计');
  const doneTask: ResearchTask = {
    id: 'rs-demo-done',
    query: '高强度紧固件的材料选型与防松设计',
    status: 'done',
    stepIndex: done.steps.length,
    createdAt: nowIso(1000 * 60 * 60 * 26),
    updatedAt: nowIso(1000 * 60 * 60 * 25),
    durationSec: 142,
    sourcesCount: done.sources.length,
    sections: done.sections,
    sources: done.sources,
    steps: done.steps,
  };

  const pending = buildReport('中国工业紧固件出口市场格局 2026');
  const pendingTask: ResearchTask = {
    id: 'rs-demo-pending',
    query: '中国工业紧固件出口市场格局 2026',
    status: 'researching',
    stepIndex: 2,
    createdAt: nowIso(1000 * 60 * 6),
    updatedAt: nowIso(1000 * 60 * 5),
    durationSec: 0,
    sourcesCount: 0,
    // 进行中：数据已备好，由前端按 stepIndex 逐步 reveal
    sections: pending.sections,
    sources: pending.sources,
    steps: pending.steps,
  };

  return [pendingTask, doneTask];
}

/** 新建任务：返回 researching 态，前端本地模拟器接管推进。 */
function mockCreateResearch(query: string): ResearchTask {
  const built = buildReport(query);
  return {
    id: `rs-${Date.now().toString(36)}`,
    query,
    status: 'researching',
    stepIndex: 0,
    createdAt: nowIso(0),
    updatedAt: nowIso(0),
    durationSec: 0,
    sourcesCount: 0,
    sections: built.sections,
    sources: built.sources,
    steps: built.steps,
  };
}

/** 按 id 取历史（含 demo id）。 */
function mockGetResearch(id: string): ResearchTask | null {
  const found = mockResearchList().find((t) => t.id === id);
  if (found) return found;
  // 未知 id：兜底成一条基于「新研究」的已完成报告，避免空白页
  const built = buildReport('深度研究示例');
  return {
    id,
    query: '深度研究示例',
    status: 'done',
    stepIndex: built.steps.length,
    createdAt: nowIso(1000 * 60 * 30),
    updatedAt: nowIso(1000 * 60 * 29),
    durationSec: 120,
    sourcesCount: built.sources.length,
    sections: built.sections,
    sources: built.sources,
    steps: built.steps,
  };
}

/* --------------------------------- 接口 --------------------------------- *
 * 当前 MixmAPP 后端尚未实现 /ai/research（meta 中 ai=dev），前端以 mock 驱动，
 * 保证 UI/UX 在任何环境即时、完整可演示。接入真实端点时，将下列方法改为调用
 * `client` 的 apiRequest（auth:false、统一错误归一），例如：
 *   await apiRequest<ResearchTask[]>('/ai/research', { auth: false })
 */

export const researchApi = {
  /** 历史研究列表（mock 驱动，待 /ai/research 就绪后切真实端点）。 */
  listResearch: async (): Promise<ResearchTask[]> => mockResearchList(),
  /** 发起一次新研究（mock 驱动，前端本地模拟进度）。 */
  createResearch: async (query: string): Promise<ResearchTask> => mockCreateResearch(query),
  /** 按 id 取任务详情（mock 驱动）。 */
  getResearch: async (id: string): Promise<ResearchTask | null> => mockGetResearch(id),
};

export { isoToDateLabel };
