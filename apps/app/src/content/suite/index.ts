import office from './office.json';
import productivity from './productivity.json';
import product from './product.json';
import engineering from './engineering.json';
import finance from './finance.json';
import taxpay from './taxpay.json';
import growth from './growth.json';
import ecommerce from './ecommerce.json';
import content from './content.json';
import edu from './edu.json';
import health from './health.json';
import legal from './legal.json';
import lifestyle from './lifestyle.json';
import type { SuiteContent } from './types';

/**
 * 业务套件内容包总表（静态层）。
 *
 * 全部用静态 import —— 这样打包器会把 JSON 直接内联进产物，
 * 首屏不需要任何请求，也不需要等接口回来才渲染正文（SEO 同样受益）。
 * 动态的部分（评论 / 点赞 / 收藏 / 进度 / 账单）走 apps/app/src/api/suite.ts。
 *
 * 内容包与后端领域登记表（services/api/src/modules/suite/registry.ts）一一对应，
 * 两边的 id 必须完全一致：内容包提供静态说明，服务端提供动态能力。
 */
const PACKS: Record<string, unknown> = {
  office,
  productivity,
  product,
  engineering,
  finance,
  taxpay,
  growth,
  ecommerce,
  content,
  edu,
  health,
  legal,
  lifestyle,
};

/** id → 内容包。 */
export const SUITE_CONTENT: Record<string, SuiteContent> = Object.fromEntries(
  Object.entries(PACKS).map(([id, value]) => [id, value as unknown as SuiteContent]),
);

/** 领域展示顺序：与后端 registry 一致，保证套件中心与静态页顺序相同。 */
export const SUITE_CONTENT_ORDER = [
  'office',
  'productivity',
  'product',
  'engineering',
  'finance',
  'taxpay',
  'growth',
  'ecommerce',
  'content',
  'edu',
  'health',
  'legal',
  'lifestyle',
] as const;

/** 内容缺失时的兜底包：渲染层据此给出明确提示，而不是白屏。 */
const MISSING_PACK: SuiteContent = {
  id: 'unknown',
  title: '内容待补全',
  category: '未分类',
  tagline: '这个领域的内容包还没有就位。',
  accent: 1,
  hero: { lead: '内容包缺失，动态能力仍可正常使用。', points: ['静态说明待补全'] },
  highlights: [],
  sections: [],
  faq: [],
  entries: [],
  updatedAt: '—',
};

/**
 * 取内容包；未知 id 回落到兜底包（页面据此给出明确提示，而不是白屏）。
 */
export function getSuiteContent(id: string): SuiteContent {
  return SUITE_CONTENT[id] ?? { ...MISSING_PACK, id };
}

/** 内容包是否真实存在（区别于兜底包）。 */
export function hasSuiteContent(id: string): boolean {
  return Boolean(SUITE_CONTENT[id]);
}

/** 按展示顺序取全部内容包。 */
export function listSuiteContent(): SuiteContent[] {
  return SUITE_CONTENT_ORDER.map((id) => SUITE_CONTENT[id]).filter(
    (pack): pack is SuiteContent => Boolean(pack),
  );
}

/** 分类 → 该分类下的内容包。 */
export function groupSuiteContent(): Array<{ category: string; packs: SuiteContent[] }> {
  const groups = new Map<string, SuiteContent[]>();
  for (const pack of listSuiteContent()) {
    const bucket = groups.get(pack.category) ?? [];
    bucket.push(pack);
    groups.set(pack.category, bucket);
  }
  return Array.from(groups, ([category, packs]) => ({ category, packs }));
}

export type {
  SuiteContent,
  SuiteEntry,
  SuiteFaq,
  SuiteHero,
  SuiteHighlight,
  SuiteMeta,
  SuiteSection,
} from './types';
