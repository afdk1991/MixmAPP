/**
 * 业务套件内容包类型。
 *
 * 内容包是**静态**的：构建期内联进前端产物，不发请求、不查库。
 * 理由很直接——这套内容的更新频率低（季度级），而首屏速度与 SEO 是硬要求。
 * 需要用户数据的地方（评论、点赞、收藏、进度、账单）走动态 API，
 * 由 `apps/app/src/api/suite.ts` 异步加载，两者各司其职。
 *
 * 内容包与「服务端的动态台账」通过 entryId 对齐：
 * 内容包里的 entries[].id 就是动态交互里用的 entryId。
 */

export type SuiteMeta = { label: string; value: string };

export type SuiteHighlight = {
  title: string;
  detail: string;
};

export type SuiteSection = {
  /** 锚点 id，用于目录跳转与 SEO 段落锚点 */
  id: string;
  title: string;
  body: string;
  bullets?: string[];
};

export type SuiteFaq = {
  q: string;
  a: string;
};

/** 内容条目：领域内的静态知识卡 / 清单 / 工具说明。 */
export type SuiteEntry = {
  /** 全局唯一（在领域内唯一即可），与动态交互的 entryId 对齐 */
  id: string;
  title: string;
  summary: string;
  tags?: string[];
  meta?: SuiteMeta[];
  /** 该条目附带的行动清单（办公 / 工程 / 政务等场景用） */
  checklist?: string[];
  /** 条目适用的阶段或分类提示 */
  note?: string;
};

export type SuiteHero = {
  /** 首屏主标题下的一句定位，长句，承载关键词 */
  lead: string;
  /** 3 条核心卖点，顺序即权重 */
  points: string[];
};

export type SuiteContent = {
  id: string;
  title: string;
  /** 归属分类中文名 */
  category: string;
  tagline: string;
  /** 1..6 对应主题六个彩色前景槽位 */
  accent: 1 | 2 | 3 | 4 | 5 | 6;
  hero: SuiteHero;
  highlights: SuiteHighlight[];
  sections: SuiteSection[];
  faq: SuiteFaq[];
  entries: SuiteEntry[];
  /** 内容更新日期（ISO 日期串），用于页面与 SEO 的 dateModified */
  updatedAt: string;
};

/** 内容包在 JSON 导入后需要一次断言，保证 shape 一致。 */
export function isSuiteContent(value: unknown): value is SuiteContent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<SuiteContent>;
  return (
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.tagline === 'string' &&
    typeof v.updatedAt === 'string' &&
    Array.isArray(v.entries) &&
    Array.isArray(v.sections) &&
    Array.isArray(v.faq) &&
    Array.isArray(v.highlights) &&
    !!v.hero
  );
}
