# 34 · Android App 壳层规范（2026-11-20）

> 本文件是这次「把 Android App 做成一款正常 App」的**冻结契约**。所有并行写线按此执行，
> 不允许各自另立一套。改动契约需先改本文件，再改代码。

## 0. 现状判定（为什么会有这次改动）

| 现象 | 根因 |
| --- | --- |
| 装出来的 App 像一张网页海报，不像 App | `apps/mobile/android/app/src/main/assets/public` 装的是 11-16 的旧 H5 产物；首屏是一整屏营销 hero，没有 App 的信息架构 |
| 顶部内容压在状态栏下 | `mx-bar` 的 `statusBarHeight` 写在 `#ifndef H5` 分支里；APK 跑的是 H5 产物，取值为 0，`env(safe-area-inset-top)` 在 Android WebView 里同样是 0 |
| 底部标签栏被手势条吃掉 | 各页只用 `env(safe-area-inset-bottom)` 留白 |
| 第 4 个 Tab 文案"星际联邦通行证"（7 字）撑破格子 | 只能靠 `theme.scss` 里给 `:last-child` 降字号的补丁硬兜 |
| 系统栏图标明暗不跟页面主题 | 原生只认系统深色，不认页面里的手动深色切换（`data-mx-theme`） |

## 1. 安全区契约（原生壳 ↔ Web 的唯一接口）

原生壳在 **insets 变化 / 页面加载完成 / 主题切换 / 键盘弹起** 四个时机，把真实像素写进根节点 CSS 变量：

```
--mx-safe-top     状态栏 / 刘海高度（px）
--mx-safe-bottom  手势条 / 三键导航高度（px）
--mx-safe-right   横向刘海（px，一般 0）
--mx-ime-bottom   软键盘高度（px，未弹为 0）
```

回落值定义在 `apps/app/src/styles/app-shell.scss` 的 `:root`（`env(safe-area-inset-*)` → `0px`）。

**规矩**：页面/组件一律读这四个变量，禁止直接读 `env(safe-area-inset-*)`，禁止读 `statusBarHeight`。

## 2. 导航模型

- 底部 Tab 四项：**首页 / 商城 / 购物车 / 通行证**（每项 ≤4 字；"星际联邦通行证"只作为页面标题出现在通行证页内部）。
- `tabBar.height = 58px`，`fontSize = 12px`，选中色 `#0f9d8f`，未选中 `#8A938F`，底部内边距叠加 `var(--mx-safe-bottom)`。
- 二级页头部统一 `.mx-app-head`（返回 44×44 + 14–16px 标题 + 右侧动作槽），配 `.mx-app-head-gap` 占位。
- 返回：二级页 `navigateBack`；Tab 根页双击退出（原生已实现，Web 需保证第一次返回有 Toast 且栈不被误清）。
- `switchTab` 只能跳 Tab 页（沿用 `src/navigation.ts` 的 `goTo`），二级页返回后 Tab 上下文不丢。

## 3. 首页信息架构（第一屏必须像 App 首页）

自上而下，**高度受控**（第一屏 100% 可见以下 ①–④ 至少到 ③）：

1. 状态区留白 + 48px 头部行：品牌标 + 「MixmAPP」+ 右侧购物车角标/扫码位（**不再放版本徽标、不再放"6 ENDS / AUTO / OFFLINE"这类内部指标**）。
2. 搜索框（单行，主控件，沿用原有输入即检 + 320ms 防抖 + 五态）。
3. **快捷入口**：4 宫格（商城 / 购物车 / 订单 / 通行证），每格 图标 + 2–4 字标签。
4. 通行证卡（压缩版，高度 ≤ 120px）：登录态 + 编号 + 一句动作。
5. 运营位 → 大家常逛 → 商品列表（保持现有数据绑定）。

硬性约束：
- 首屏不允许出现整屏深色 hero / 全屏海报；深色块最高不超过一屏的 **40%**。
- 首屏标题字阶 ≤ 28px（现 `$fs-display: 96rpx` = 48px，首页只在桌面宽屏可用）。
- 没有任何横向滚动；320px 宽不破版。

## 4. 交互与状态（"原生手感"的可验收定义）

| 要求 | 落地 |
| --- | --- |
| 按压反馈 | 列表项/卡片挂 `.mx-tap`（按下 `$brand-soft` + `scale(.985)`）；已有 `hover-class="is-press"` 的保留 |
| 三态齐备 | 空 / 加载 / 错误统一用 `.mx-state` + `.mx-spinner`；列表加载用 `.mx-skeleton`，禁止"空白页" |
| 键盘不遮输入 | 表单页容器挂 `.mx-ime-pad`；滚动到焦点输入框 |
| 底部吸附条 | `.mx-sticky-bar`（Tab 页加 `--tab`），列表尾部留 `.mx-sticky-pad` |
| 滚动 | 所有长列表 `scroll-view` 保持惯性滚动（`scroll-with-animation` 只用于程序化滚动） |
| 转场 | 不做整页淡入；页面背景色由 `pages.json` 统一，避免白闪 |

## 5. 深色模式

- 两套通道保持现状：跟随系统 + 手动（`data-mx-theme`）。
- 新增要求：手动切换主题后，原生状态栏/导航栏图标明暗同步（由原生壳读取页面主题并回调）。
- 新增的壳层类（`.mx-app-head` / `.mx-sticky-bar` / `.mx-state`）只能用 `--mx-*` 令牌，不写裸色值。

## 6. 写线边界（同一时刻同一文件只有一条写线）

| 写线 | 独占文件 |
| --- | --- |
| A 原生壳 | `apps/mobile/**`（含 `scripts/android-*.mjs` 里属于壳的部分） |
| B 首页与导航 | `apps/app/src/pages/index/index.vue`、`apps/app/src/components/**`、`apps/app/src/styles/theme.scss`、`apps/app/src/App.vue`、`pages.json`、`navigation.ts`、`routes.ts` |
| C 业务页 | `apps/app/src/pages/{mall,cart,orders,me,auth,settings,legal,assistant,research}/**` |
| 我（Organizer） | `apps/app/src/styles/app-shell.scss`（已冻结）、`pages.json` 的 tabBar 文案（已冻结） |

## 7. 验收映射（QA 用）

A 首屏 / B 系统栏与手势 / C 导航模型 / D 原生手感 / E 功能完整 / F 出包 / G 不回归 /
H 中文说明 —— 每条都要截图或命令输出作证，落在 `ui-review/android-2026-11-20/`。
