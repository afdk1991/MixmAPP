import type { SuiteCapability, SuiteCategory, SuiteDomainId, SuiteDomainMetaDto } from '@mixmapp/contracts';

/**
 * 业务套件领域登记表（单一真源）。
 *
 * 「静态内容」在前端内容包（apps/app/src/content/suite/），「动态能力」在服务端领域模块
 * （services/api/src/modules/domains/）。本表只登记两边共用的元信息：
 * 标识、中文名、两字标记、归属分类、一句话定位、配色槽位、能力清单。
 *
 * 之所以把这 13 个领域收在一张表里，是为了让「套件中心」能在一次请求里拿到全量目录，
 * 也让服务端在派发动态动作前有一份白名单可校验（不接受表外的 domainId）。
 */
export type SuiteDomainMeta = SuiteDomainMetaDto;

/** 能力常量：与契约里的 SuiteCapability 同名同义，这里只做可读的短别名。 */
const CAP = {
  interact: 'interact',
  progress: 'progress',
  board: 'board',
  ledger: 'ledger',
  booking: 'booking',
  quiz: 'quiz',
  checklist: 'checklist',
  schedule: 'schedule',
} as const satisfies Record<string, SuiteCapability>;

export const SUITE_DOMAINS: readonly SuiteDomainMeta[] = [
  {
    id: 'office',
    title: '办公管理',
    short: '办',
    category: 'collaboration',
    tagline: '任务看板、审批流转与会议纪要，一处推进到底。',
    accent: 1,
    capabilities: [CAP.interact, CAP.progress, CAP.board, CAP.checklist],
  },
  {
    id: 'productivity',
    title: '效率工具',
    short: '效',
    category: 'efficiency',
    tagline: '待办清单、专注计时与习惯打卡，把计划落成节奏。',
    accent: 2,
    capabilities: [CAP.interact, CAP.progress, CAP.board, CAP.schedule],
  },
  {
    id: 'product',
    title: '产品研发',
    short: '产',
    category: 'engineering',
    tagline: '需求、缺陷与迭代燃尽，产品决策有据可依。',
    accent: 3,
    capabilities: [CAP.interact, CAP.progress, CAP.board],
  },
  {
    id: 'engineering',
    title: '工程',
    short: '工',
    category: 'engineering',
    tagline: '工单派发、材料清单与验收留痕，现场与图纸对齐。',
    accent: 6,
    capabilities: [CAP.interact, CAP.progress, CAP.board, CAP.checklist],
  },
  {
    id: 'finance',
    title: '金融',
    short: '金',
    category: 'money',
    tagline: '预算、记账与资产负债三张表，看清钱去了哪里。',
    accent: 5,
    capabilities: [CAP.interact, CAP.progress, CAP.board, CAP.ledger],
  },
  {
    id: 'taxpay',
    title: '财税支付',
    short: '税',
    category: 'money',
    tagline: '发票登记、税额试算与支付对账，报销结账不断链。',
    accent: 4,
    capabilities: [CAP.interact, CAP.progress, CAP.board, CAP.ledger],
  },
  {
    id: 'growth',
    title: '营销增长',
    short: '营',
    category: 'growth',
    tagline: '活动漏斗、渠道归因与投产比，把流量变成留存。',
    accent: 1,
    capabilities: [CAP.interact, CAP.progress, CAP.board, CAP.checklist],
  },
  {
    id: 'ecommerce',
    title: '电商',
    short: '电',
    category: 'commerce',
    tagline: '商品、评价与客服工单，把一次成交变成长期复购。',
    accent: 2,
    capabilities: [CAP.interact, CAP.progress, CAP.board],
  },
  {
    id: 'content',
    title: '内容创作',
    short: '文',
    category: 'creative',
    tagline: '选题日历、稿件流转与发布排期，让产出有节奏。',
    accent: 3,
    capabilities: [CAP.interact, CAP.progress, CAP.board, CAP.schedule],
  },
  {
    id: 'edu',
    title: '教育科研',
    short: '学',
    category: 'learning',
    tagline: '学习路径、随堂判分与文献记录，读进去也留得住。',
    accent: 6,
    capabilities: [CAP.interact, CAP.progress, CAP.board, CAP.quiz],
  },
  {
    id: 'health',
    title: '医疗医药',
    short: '医',
    category: 'health',
    tagline: '用药记录、剂量校验与随访提醒，安全放在第一位。',
    accent: 4,
    capabilities: [CAP.interact, CAP.progress, CAP.board, CAP.checklist],
  },
  {
    id: 'legal',
    title: '法律政务',
    short: '法',
    category: 'civic',
    tagline: '办事指南、材料清单与合规自查，流程不走弯路。',
    accent: 5,
    capabilities: [CAP.interact, CAP.progress, CAP.board, CAP.checklist],
  },
  {
    id: 'lifestyle',
    title: '生活休闲',
    short: '乐',
    category: 'life',
    tagline: '活动预约、会员权益与生活清单，把周末还给自己。',
    accent: 2,
    capabilities: [CAP.interact, CAP.progress, CAP.board, CAP.booking],
  },
] as const;

/** id → 元信息。查不到返回 undefined（调用方负责兜底）。 */
export function findSuiteDomain(id: string): SuiteDomainMeta | undefined {
  return SUITE_DOMAINS.find((d) => d.id === id);
}

/** 全量目录：套件中心一次拉走。 */
export function listSuiteDomains(): SuiteDomainMeta[] {
  return SUITE_DOMAINS.map((d) => ({ ...d, capabilities: [...d.capabilities] }));
}

/** 分类中文名，供套件中心分组标题。 */
export const SUITE_CATEGORY_LABELS: Record<SuiteCategory, string> = {
  collaboration: '协同办公',
  efficiency: '效率提升',
  engineering: '产品工程',
  money: '资金财税',
  growth: '增长运营',
  commerce: '交易电商',
  creative: '内容创作',
  learning: '学习科研',
  health: '健康医药',
  civic: '法律政务',
  life: '生活休闲',
};

/** 按分类分组，保持登记顺序。 */
export function groupSuiteDomains(): Array<{ category: SuiteCategory; label: string; domains: SuiteDomainMeta[] }> {
  const order: SuiteCategory[] = [
    'collaboration',
    'efficiency',
    'engineering',
    'money',
    'growth',
    'commerce',
    'creative',
    'learning',
    'health',
    'civic',
    'life',
  ];
  return order
    .map((category) => ({
      category,
      label: SUITE_CATEGORY_LABELS[category],
      domains: SUITE_DOMAINS.filter((d) => d.category === category).map((d) => ({ ...d })),
    }))
    .filter((group) => group.domains.length > 0);
}

/** 领域 id 集合：服务端派发动作前的白名单。 */
export const SUITE_DOMAIN_ID_SET: ReadonlySet<SuiteDomainId> = new Set(
  SUITE_DOMAINS.map((d) => d.id as SuiteDomainId),
);
