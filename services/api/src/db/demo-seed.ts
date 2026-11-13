import type { ProductRecord } from './types.js';
import type { MemoryStore } from './memory.js';

/**
 * 本地联调用的商品种子，语义与 infra/sql/0002_mall.sql 完全一致（同 id / 价格 / 库存 / 排序）。
 * 只在显式 SEED_DEMO_PRODUCTS=1 且内存驱动时注入，避免污染单元测试对空库的断言。
 */
export const DEMO_PRODUCTS: ProductRecord[] = [
  {
    id: 'mix-p-1001',
    title: 'MixmAPP 首发限定礼盒',
    subtitle: '单码多端 · 全端通行',
    priceFen: 29900,
    originalPriceFen: 39900,
    stock: 120,
    category: 'featured',
    cover: '#0f9d8f',
    images: [],
    tags: ['首发', '限定'],
    description: '含品牌徽章、贴纸与全端通行卡，适合作为 MixmAPP 首个对外发布纪念。',
    sortNo: 10,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
  },
  {
    id: 'mix-p-1002',
    title: '石墨黑轻量冲锋衣',
    subtitle: '通勤 / 露营两用',
    priceFen: 45900,
    originalPriceFen: 59900,
    stock: 64,
    category: 'wear',
    cover: '#1f2937',
    images: [],
    tags: ['防风', '轻量'],
    description: '三层复合面料，收纳后仅一瓶水大小，适合城市与短途户外。',
    sortNo: 20,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
  },
  {
    id: 'mix-p-1003',
    title: '桌面理线收纳坞',
    subtitle: '一坞收齐所有线',
    priceFen: 8900,
    originalPriceFen: 12900,
    stock: 210,
    category: 'life',
    cover: '#334155',
    images: [],
    tags: ['桌面', '收纳'],
    description: '铝合金底座 + 硅胶卡槽，兼容常见充电头与线材。',
    sortNo: 30,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
  },
  {
    id: 'mix-p-1004',
    title: 'MIX 号码金属徽章',
    subtitle: '专属号码定制',
    priceFen: 3900,
    originalPriceFen: 0,
    stock: 500,
    category: 'featured',
    cover: '#b45309',
    images: [],
    tags: ['定制', '徽章'],
    description: '可刻印你的 MIX 号码，磁吸式背面，不伤衣物。',
    sortNo: 40,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
  },
  {
    id: 'mix-p-1005',
    title: '便携氮化镓充电器 65W',
    subtitle: '一个头搞定全端',
    priceFen: 15900,
    originalPriceFen: 19900,
    stock: 88,
    category: 'digital',
    cover: '#0b1220',
    images: [],
    tags: ['快充', 'GaN'],
    description: '双 C 口 + 单 A 口，65W 总输出，手机/平板/轻薄本通用。',
    sortNo: 50,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
  },
  {
    id: 'mix-p-1006',
    title: '全端同步帆布托特包',
    subtitle: '装得下 16 寸笔电',
    priceFen: 9900,
    originalPriceFen: 13900,
    stock: 150,
    category: 'life',
    cover: '#7c3aed',
    images: [],
    tags: ['帆布', '通勤'],
    description: '加厚帆布 + 内衬电脑仓，日常通勤与周末出行都够用。',
    sortNo: 60,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
  },
];

/** 幂等注入：已存在的 id 不覆盖，返回真实新增条数。 */
export async function seedDemoProducts(store: MemoryStore): Promise<number> {
  let added = 0;
  for (const product of DEMO_PRODUCTS) {
    const existing = await store.mall.products.findById(product.id);
    if (existing) continue;
    await store.mall.products.insert(product);
    added += 1;
  }
  return added;
}
