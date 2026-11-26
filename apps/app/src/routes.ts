/**
 * 全项目唯一的页面路由表。
 *
 * 规矩（`scripts/repo-lint.mjs` 会强制检查）：
 * 1. 任何页面跳转只能引用这里的常量，不许在页面里写 `'/pages/...'` 字面量；
 * 2. 本表必须与 `apps/app/src/pages.json` 注册的页面**一一对应**，多一个、少一个都判红；
 * 3. 同一个页面只能有一个键名，禁止为同一路径起别名。
 * 带查询参数时只在这张表的路径后面拼 `?k=v`（自己 encodeURIComponent），不再另设第二套拼路径的助手。
 */
export const ROUTES = {
  home: '/pages/index/index',
  legalPrivacy: '/pages/legal/privacy',
  login: '/pages/auth/login',
  register: '/pages/auth/register',
  me: '/pages/me/index',
  favorites: '/pages/me/favorites',
  mall: '/pages/mall/index',
  mallDetail: '/pages/mall/detail',
  cart: '/pages/cart/index',
  orders: '/pages/orders/index',
  about: '/pages/settings/about',
  accountDelete: '/pages/settings/account-delete',
  localData: '/pages/settings/local-data',
  admin: '/pages/admin/index',
  research: '/pages/research/index',
  researchDetail: '/pages/research/detail',
  assistant: '/pages/assistant/index',
  notFound: '/pages/error/not-found',
  /* ---------- 业务套件（13 个领域） ---------- */
  suite: '/pages/suite/index',
  suiteOffice: '/pages/suite/office',
  suiteProductivity: '/pages/suite/productivity',
  suiteProduct: '/pages/suite/product',
  suiteEngineering: '/pages/suite/engineering',
  suiteFinance: '/pages/suite/finance',
  suiteTaxpay: '/pages/suite/taxpay',
  suiteGrowth: '/pages/suite/growth',
  suiteEcommerce: '/pages/suite/ecommerce',
  suiteContent: '/pages/suite/content',
  suiteEdu: '/pages/suite/edu',
  suiteHealth: '/pages/suite/health',
  suiteLegal: '/pages/suite/legal',
  suiteLifestyle: '/pages/suite/lifestyle',
} as const;

/**
 * 领域 id → 领域页面路由。
 *
 * 内容包、后端登记表与这张表三处用同一个领域 id（office / finance / …）。
 * 套件中心与内容包都用它来跳转，页面里不再出现 '/pages/suite/...' 字面量
 * （repo-lint 规则 5 会拦）。
 */
export const SUITE_ROUTE_BY_DOMAIN: Record<string, string> = {
  office: ROUTES.suiteOffice,
  productivity: ROUTES.suiteProductivity,
  product: ROUTES.suiteProduct,
  engineering: ROUTES.suiteEngineering,
  finance: ROUTES.suiteFinance,
  taxpay: ROUTES.suiteTaxpay,
  growth: ROUTES.suiteGrowth,
  ecommerce: ROUTES.suiteEcommerce,
  content: ROUTES.suiteContent,
  edu: ROUTES.suiteEdu,
  health: ROUTES.suiteHealth,
  legal: ROUTES.suiteLegal,
  lifestyle: ROUTES.suiteLifestyle,
};
