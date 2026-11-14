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
  mall: '/pages/mall/index',
  mallDetail: '/pages/mall/detail',
  cart: '/pages/cart/index',
  orders: '/pages/orders/index',
  about: '/pages/settings/about',
  admin: '/pages/admin/index',
  research: '/pages/research/index',
  researchDetail: '/pages/research/detail',
} as const;
