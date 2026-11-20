# 35 · Android App 改造交付说明（2026-11-20）

- 日期：2026-11-20（Asia/Shanghai）
- 仓库根：`F:\合并项目\MixmAPP`　分支：`main`　HEAD：`c4a54b6`（父提交 `dad08f9`，即混入提交）
- 任务：把 Android APK 从"像一张网页海报"改造为"像一款正常 App"；本文件只做中文交付说明，未改源码、未跑构建、未提交 git。
- 冻结契约：`docs/34-android-app-shell-spec.md`；终验矩阵：`ui-review/android-2026-11-20/ACCEPTANCE.md`；两条写线报告：同目录 `SHELL-LINE-A-REPORT.md`（原生壳）、`pages-c-line-report.md`（业务页）。
- 设备与口径：AVD `Medium_Phone_API_37.0`（`emulator-5554`，1080×2400，420dpi，手势导航，无真机）；node v22.23.2、pnpm 9.12.0、JDK 21；包名 `top.mixm.app`，versionName `0.0.2` / versionCode `3`。
- 证据目录：`ui-review/android-2026-11-20/`（基线 `before-*.png`、改后 `after-*.png` / `after-final-*.png`、门禁 `gate-*.log`、logcat 转储）。下文截图与日志均相对仓库根引用。

---

## 1. 结论先说

**一句话结论：Android 壳内首屏已从整屏营销海报改为标准 App 信息架构，安全区、键盘避让、Tab 导航与深色跟随在 AVD 冒烟通过；登录后闭环、release 装机、三键/挖孔屏等项仍未闭环，见第 5 章。**

用户装包后能直接感受到的变化：

1. **首屏是 App 首页而不是海报**：48px 头部行 + 单行搜索 + 4 宫格入口（商城 / 购物车 / 订单 / 通行证）+ 压缩版通行证卡 + 运营位 / 分类 / 商品列表，没有整屏深色 hero。证据：`ui-review/android-2026-11-20/after-final-home.png`、`after-final-home-scroll.png`。
2. **内容不再压到状态栏和手势条下面**：头部品牌行落在状态栏留白之下，底部 Tab 栏完整停在手势条之上。证据：`after-final-home-light-statusbar.png`、`after-final-home-scroll.png`；壳内求值 `--mx-safe-top=63px`、`--mx-safe-bottom=63px`（logcat `安全区下发 top=63 bottom=63 right=0 ime=0`，`after-final-logcat.txt`）。
3. **底部 Tab 文案变短、选中态清楚**：四项为 首页 / 商城 / 购物车 / 通行证，字号 12px，选中色 `#0f9d8f`。证据：`after-final-mall.png`、`after-final-pass.png`；`apps/app/src/pages.json` 第 92–117 行。
4. **弹键盘不会遮住输入框**：聚焦账号框后 `--mx-ime-bottom=883px`，输入框在键盘上方可见。证据：`after-final-keyboard-ime.png`、logcat `ime=883` 行。
5. **深色下系统栏图标跟着变色**：系统深色后页面转深、状态栏图标转白，对比清晰。证据：`after-final-home-dark.png`、`after-final-home-dark-statusbar.png`；手动路径的观察项见第 5 章 #3。

---

## 2. 改造前为什么"不像 App"

三条根因均在基线截图与旧源码中核实，逐条附证据。

### 2.1 壳内装的是 11-16 的旧 H5 产物，首屏是整屏营销海报

- 基线实拍（旧包 / 旧产物重出包）：`ui-review/android-2026-11-20/before-shipped-home.png`、`before-source-home.png`，首屏为通栏深色营销 hero，无 App 信息架构；商城 / 购物车 / 通行证基线图同为旧版式：`before-shipped-mall.png`、`before-shipped-cart.png`、`before-shipped-pass.png`、`before-source-*.png`。
- 成因：`apps/mobile/android/app/src/main/assets/public` 此前装入的是旧 H5 构建产物；本次经 `cap sync android` + 注入脚本刷新后，壳内 JS chunk `22:36:46`、`index.html` `22:38:16`，确为本次构建（`gate-sync-android.log`、`gate-inject-check.log`；复核记录见 ACCEPTANCE §2.1）。

### 2.2 顶部安全区取值写在 `#ifndef H5` 分支里，APK 跑 H5 产物时恒为 0

- 旧源码（`git show d4a30ef:apps/app/src/components/mx-bar/mx-bar.vue`）：

  ```
  const statusBarHeight = ref(0);
  // #ifndef H5
    statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0;
  ```

  APK 内 WebView 跑的是 H5 产物，`#ifndef H5` 分支不参与编译，`statusBarHeight` 恒为 0；`env(safe-area-inset-top)` 在 Android WebView 内同样取不到值。结果是头部内容压到状态栏下（基线 `before-source-home.png` 顶部）。
- 现行做法：`mx-bar.vue` 改为只读壳层注入的 `var(--mx-safe-top)`，注释明确"不再取 statusBarHeight，也不直接读 `env(safe-area-inset-*)`（APK 内 WebView 两者都恒为 0）"（`apps/app/src/components/mx-bar/mx-bar.vue:68-69`）。

### 2.3 底部只靠 `env(safe-area-inset-bottom)`，Android WebView 里该值为 0，标签栏被手势条吃掉

- 壳内探针实测（A 线报告 §6.1，视口高 914 CSS px）：探针元素 `env(safe-area-inset-bottom)` 计算值 **0px**；`.uni-tabbar` 高 **121px** = 框架内容区 58px + 单次安全区 padding 63px，63px 来自壳层注入的 `--mx-safe-bottom`，无重复叠加。
- 基线可见问题：底部标签栏 / 结算条被手势条压盖（`before-shipped-home-scroll.png`、`before-source-home-scroll.png`）。
- 现行做法：Tab 栏与各页底部留白统一读 `var(--mx-safe-bottom, 0px)`，变量由原生壳在 insets 变化 / 页面加载 / 主题切换 / 键盘弹起四个时机下发（契约 §1，`docs/34-android-app-shell-spec.md`）。

### 附：第 4 个 Tab 原是 7 字长文案

- 旧 `pages.json`：第 4 项 `"text": "星际联邦通行证"`（7 字，`git show d4a30ef:apps/app/src/pages.json`）；旧 `theme.scss` 只能用 `:last-child` 降字号到 8px、收字距硬兜，注释记录了 1.3x 字体放大后折行被裁的问题。
- 现状：文案改为 `"通行证"`，字号统一 12px，降级补丁删除（`apps/app/src/pages.json`、`apps/app/src/styles/theme.scss`，HEAD diff）。

---

## 3. 改了什么（按四层组织）

> 文件清单来自 `git show --stat dad08f9`（26 个文件，+1256 / −895）；其后提交 `c4a54b6` 仅含 `apps/app/src/pages/index/index.vue` 首页视觉收尾（+8 / −5）。`dad08f9` 提交信息写的是"管理后台纳入正式包…"，与本次 Android 改造内容不符；混入情况与回滚口径见第 6 章。

### 3.1 壳层契约与安全区

| 文件 | 改动 | 取舍 |
| --- | --- | --- |
| `docs/34-android-app-shell-spec.md` | 冻结本次壳层契约：四个安全区变量、导航模型、首页信息架构、交互状态、深色规则、写线边界 | 契约先行：页面 / 组件只认 `--mx-safe-top/--mx-safe-bottom/--mx-safe-right/--mx-ime-bottom`，禁止直接读 `env(safe-area-inset-*)` 与 `statusBarHeight`；无壳时由样式层回落 `env()` → `0px`，H5 / 小程序端不被原生变量绑架 |
| `apps/app/src/styles/app-shell.scss` | 新增 272 行：四变量 `:root` 回落值、`.mx-app-head` 二级页头部骨架、`.mx-sticky-bar` 吸附底栏、`.mx-state` / `.mx-spinner` / `.mx-skeleton` 三态、`.mx-tap` 按压、`.mx-ime-pad` 键盘避让 | 壳层类只使用 `--mx-*` 令牌，不写裸色值；排在 `theme.scss` 之后引入，保证令牌可被主题覆盖（`App.vue` diff） |
| `apps/app/src/styles/theme.scss` | 删除第 4 Tab 8px 降字号补丁；Tab 栏 / 占位块底部改吃 `--mx-safe-bottom`；两处悬浮按钮 / 底栏 env() 换令牌；选中标签补字重 | 长文案补丁随文案缩短一并撤除；底部高度只叠加一次安全区，避免与原生 margin 方案双重留白（A 线报告 §一） |
| `apps/app/src/App.vue` | 引入 `app-shell.scss`；备案行底部 env() 换 `--mx-safe-bottom` | 同文件 `onPageNotFound` 注释更新属并行线改动，见第 6 章混入清单 |

### 3.2 原生壳

| 文件 | 改动 | 取舍 |
| --- | --- | --- |
| `apps/mobile/android/app/src/main/java/top/mixm/app/MainActivity.java`（+169 行） | 新增 insets → CSS 变量下发链路（`applyWindowInsets` / `pushInsetsToWeb`）；新增主题桥 `ShellBridge` 与页面内 `THEME_OBSERVER_JS`（MutationObserver 监听 `data-mx-theme`，matchMedia 监听系统深浅）；`applySystemBarAppearance` 改为 `resolveNight()`（页面自报 > 系统 uiMode）；新增 `resolveWindowBackground(night)`；`onPageFinished` / `onConfigurationChanged` 重推安全区；移除旧的父容器 margin 收缩方案 | 原生壳是四个安全区变量的唯一来源；旧 margin 兜底与新壳层样式叠加会双重留白，故整体移除。主题解析优先页面自报、回落系统 uiMode，避免深底深图标 / 浅底浅图标不可见。启动屏、返回键双击退出、离线错误页、崩溃恢复、网络感知等既有能力逐方法核对，未删除或降级（A 线报告 §二） |
| `apps/mobile/android/app/src/main/res/values/colors.xml`（+3 行） | 新增 `app_background_light=#F4F4F1`、`app_background_dark=#121716` 显式底色资源 | 与 H5 纸底色一一对应，供 `resolveWindowBackground` 按解析出的主题精确取色，不走 night 资源回落值猜测 |

未改动：`scripts/android-build.mjs`、`android-smoke.mjs`、`android-inject-base.mjs`（既有构建 / 冒烟 / 注入体检链路直接复用）。

### 3.3 首页信息架构与导航

| 文件 | 改动 | 取舍 |
| --- | --- | --- |
| `apps/app/src/pages/index/index.vue`（`dad08f9` 内 858 行改动；视觉收尾 +8 / −5 由 `c4a54b6` 单独提交） | 自上而下：48px 头部行（品牌标 + 名称 + 右侧动作槽）→ 单行搜索 → 4 宫格入口 → ≤120px 通行证卡 → 运营位 → 分类 → 商品列表；删除整屏深色 hero 与 "6 ENDS / AUTO / OFFLINE" 类内部指标 | 第一屏只保留 App 首页该有的区块，深色块高度受控、无横向滚动；搜索沿用原有输入即检 + 320ms 防抖 + 五态。`c4a54b6` 的 +8 / −5 为订单入口字形兜底与标题渐变中和 |
| `apps/app/src/pages.json` | Tab 第 4 项文案 "星际联邦通行证" → "通行证"；Tab 字号 11px → 12px；栏高维持 58px | 文案 ≤4 字是契约 §2 硬约束；长文案不再需要特例字号补丁 |
| `apps/app/src/navigation.ts`（+5 行） | 新增 `isTabRoute(path)`：判断路径是否 Tab 根页，供头部组件收敛返回行为 | Tab 根页返回交原生双击退出，二级页 `navigateBack`；`switchTab` 只跳 Tab 页，二级页返回后 Tab 上下文不丢 |
| `apps/app/src/components/mx-bar/mx-bar.vue`（162 行重写） | 安全区改读 `--mx-safe-top`；一级栈根页不清栈，交原生双击退出；二级页头部统一返回槽 + 中文标题 | 不再依赖 `statusBarHeight` 与 env()；H5 兜底回首页 Tab |

### 3.4 业务页交互与深色

13 个业务页按契约 §4 / §5 收口（文件与逐条理由见 `pages-c-line-report.md` §2）：

- **登录 / 注册**：`pages/auth/login.vue`、`pages/auth/register.vue` —— 容器挂 `.mx-ime-pad`，底部留白计入 `--mx-safe-bottom` + `--mx-ime-bottom`；签 / 链接 / 协议行补按压反馈；输入框补 `confirm-type` 与提交回调；二级页标题"登录 / 注册"。
- **商城 / 详情**：`pages/mall/index.vue`、`pages/mall/detail.vue` —— 底部预留 Tab 高 + 安全区 + 键盘；抽屉顶部读 `--mx-safe-top`；四条购买 / 询价 / 缺货 / 未登录条改挂 `.mx-sticky-bar`；长文本 `min-width:0` 防窄屏挤爆；标题"商品详情"。
- **购物车 / 订单 / 收藏**：`pages/cart/index.vue`、`pages/orders/index.vue`、`pages/me/favorites.vue` —— 结算条 `.mx-sticky-bar--tab` 抬到原生标签栏之上并吃安全区；订单行 / 商品名防挤压；移除无效的红色 `confirmColor`；标题"我的订单 / 我的收藏"。
- **个人中心 / 关于 / 隐私**：`pages/me/index.vue`、`pages/settings/about.vue`、`pages/legal/privacy.vue` —— 深场渐变硬编码 hex 换 `$deep/$deep-2/$deep-3` 令牌；关于页能力加载失败补重试；隐私同意条改 `.mx-sticky-bar`；标题"关于 MixmAPP / 隐私政策"。
- **助手 / 研究**：`pages/assistant/index.vue`、`pages/research/index.vue`、`pages/research/detail.vue` —— IME 避让；加载失败从"静默清空成空态"改为错误态 + 重试；品牌底色换 `$brand-soft`；标题"智能助手 / 研究助手 / 研究报告"。

取舍说明：按压反馈沿用既有 `hover-class="is-press"`，新挂 `.mx-tap`；三态统一 `.mx-state` + `.mx-spinner` / `.mx-skeleton`，不允许留空白页；长列表保持惯性滚动，不做整页淡入（契约 §4）。深色令牌之外仍有少量非令牌 rgba 残留，清单见 `pages-c-line-report.md` §C，留待主题线统一补 `$signal-soft` / `$amber-soft` 令牌。

---

## 4. 验收结果（A–H）

口径与 `ACCEPTANCE.md` 第四节保持一致，以该文件最新状态为准；判定分 通过 / 部分通过 / 未通过。

| 条目 | 验收口径 | 结论 | 关键证据 |
| --- | --- | --- | --- |
| A 冷启动首屏 | 3 秒内出首页、Tab 常驻、状态栏不压内容、有核心入口、无整屏海报 hero | **通过** | COLD `TotalTime: 1654ms`（`after-final-coldstart.png`、`gate-smoke.log` 启动 2315ms）；首屏区块见 `after-final-home.png` / `after-final-home-scroll.png`；`--mx-safe-top=63px`（`after-final-logcat.txt`） |
| B 系统栏与手势 | 浅 / 深 / edge-to-edge / 手势导航下内容不被遮挡，栏图标明暗自适应 | **通过**（附观察项 #1） | 浅色 `after-final-home-light-statusbar.png`；深色 `after-final-home-dark.png` / `after-final-home-dark-statusbar.png`；`.uni-tabbar` 121px = 58 + 63 无重复叠加；三键 / 挖孔未实测（问题 #4） |
| C 导航模型 | Tab 文案 ≤4 字、选中态清晰、逐级回退、根页双击退出有提示、二级页返回不丢 Tab 上下文 | **部分通过** | 文案与选中态通过：`pages.json`、`after-final-mall.png`、`after-final-pass.png`；逐级回退通过：`after-final-product-detail.png`、`after-final-about.png`、`after-final-privacy.png`；**双击退出本次未新鲜复现**，沿用 A 线 `back-first.png` / `back-exit.png` / `logcat-back-exit.txt`，存疑待复核（问题 #2） |
| D 原生手感 | 惯性滚动、下拉刷新、按压反馈、键盘不遮输入、Toast / 加载 / 空 / 错态齐备、无白闪 | **部分通过** | 惯性滚动（`after-final-home-scroll.png`，`scrollH=3382`）、键盘避让（`--mx-ime-bottom=883px`，`after-final-keyboard-ime.png`）、无白闪目视通过；下拉刷新动画、按压态、空 / 错 / 加载态、离线重试仅有源码与 H5 预览证据，设备未触发取证（问题 #6） |
| E 功能完整 | 登录注册 / 商城 / 详情 / 购物车 / 下单 / 订单 / 个人中心 / 通行证 / 关于隐私 / 深色 / 离线重试可走通，无横向溢出、320px 不破版 | **部分通过** | 游客态走通：`after-final-register.png`、`after-final-mall.png`、`after-final-product-detail.png`、`after-final-pass.png`、`after-final-about.png`、`after-final-privacy.png`；守卫跳登录：`after-final-cart-guarded.png`、`after-final-orders.png`；首页 / 隐私 / 注册 `scrollWidth=innerWidth=411` 无横向溢出；下单 / 订单 / 收藏需登录态，设备未走通（问题 #3）；320px 未在设备实测（问题 #7） |
| F 出包与验收 | debug / release 均出 APK，AVD 装机启动无 FATAL，截图留证 | **部分通过** | debug 4,735,704 B 已装机、冒烟 10/10、logcat 零 FATAL；release 3,523,153 B，`apksigner verify` 通过、证书指纹核验一致、壳内产物最新 0.0.2，但**未装机运行**（问题 #5） |
| G 不回归 | H5 / 小程序 / 鸿蒙构建不受影响，未改 API 协议与域名（只认 mixm.top） | **通过** | `gate-build-h5.log` / `gate-build-mp-weixin.log` / `gate-build-harmony.log` 均 exit 0；`gate-domains.log` 域名校验通过；注入 API `https://api.mixm.top/mixmapp/api/v1`、媒体 `https://img.mixm.top`；`verify` 169 passed / 8 skipped（`gate-verify.log`）；业务协议语义未动，`packages/contracts/src/index.ts` 仅有 avatarUrl `/media` 兼容放宽（见第 6 章混入清单） |
| H 中文说明 | 中文说明文档在位、证据可被引用 | **通过（证据在位）** | `docs/` 中文 Markdown 在位；本目录留存门禁日志、APK 路径与签名、设备截图、logcat 扫描与终验矩阵；文档正文完整性由本线背书 |

门禁逐条：`pnpm lint` ✓（`gate-lint.log`，`✓ 规则检查通过`）；`pnpm --filter @mixmapp/app typecheck` ✓（`gate-typecheck.log`）；`pnpm verify` ✓ 169 passed / 8 skipped（`gate-verify.log`）；`pnpm build:h5` / `build:mp-weixin` / `build:harmony` / `domains:check` 均 ✓。

版本号合规性：本次未改 `version.json` 与 `manifest.json`（`git show --stat HEAD` 不含两文件）；两包 badging `versionName=0.0.2 versionCode=3`，与 `version.json` 工作号 `0.0.2` 一致，`released` 仅登记 `0.0.1`。按 `docs/19-versioning.md` 规约，内部改造不强制 bump 版本号；未占用新正式号、未打 tag，合规。

---

## 5. 还剩什么没做 + 风险

每条含影响面、触发条件、建议下一步；编号对应 ACCEPTANCE 第五节问题清单。

1. **release 包未装机运行（#5）**：影响面——release 混淆 / 资源压缩 / 签名打包后的运行期表现未实测，当前设备结论只覆盖 debug；触发条件——release 与 debug 签名不同不能覆盖安装，AVD 上只装了 debug；下一步——卸 debug 后单独装 release，冷启动 + 冒烟 + 登录态主流程走一遍，留存运行期 logcat 与截图。
2. **登录后下单闭环未走通（#3）**：影响面——加购 → 下单 → 订单列表 → 收藏夹 → 库存扣减链路缺设备端证据，`pages/cart/index.vue`、`pages/orders/index.vue`、`pages/me/favorites.vue`、`pages/mall/detail.vue` 下单入口仅由后端测试（169 用例）与 H5 预览截图间接覆盖（`pages-orders-320.png`、`pages-favorites-320.png`、`pages-cart-320.png`）；触发条件——无测试账号，未登录访问购物车 / 订单 / 收藏均被既有路由守卫到 `/pages/auth/login`（守卫行为，非缺陷）；下一步——备一个沙箱账号，在真机 / AVD 走完整登录后闭环。
3. **手动切深色时系统栏图标是否跟随，未闭环（#1）**：影响面——若页面 `data-mx-theme` 与系统深浅不一致，或 WebView 不派发 matchMedia change，系统栏图标明暗可能不跟随页面实际主题；触发条件——终验切系统深色后页面转深、栏图标转白，但 logcat 中 `页面主题自报：dark` 0 条（仅 6 条 `light`），靠 `resolveNight()` 回落系统 uiMode 兜底生效，涉及 `MainActivity.java` `THEME_OBSERVER_JS`（85–97 行）、`applyWebTheme`（402–406 行）、`resolveNight`（408–412 行）；下一步——壳 / 前端线复核观察者监听与 WebView 主题派发时机，手动 `data-mx-theme=dark` 与系统深浅不一致时单独取证。
4. **三键导航与挖孔屏未实测（#4）**：影响面——三键机 / 挖孔机的底部与左右安全区未在设备上确认，`--mx-safe-bottom` 三键下应取导航栏高度，`displayCutout` 已并入 top / right，但缺目视证据；触发条件——AVD 为手势导航、无挖孔，SDK 37 模拟器切 `navigation_mode=0` 未生效（A 线报告 §五.1）；下一步——找三键导航真机 / 挖孔屏机型复核底部栏与左右留白。
5. **CORS 白名单未在服务端侧确认（#8）**：影响面——壳 origin `https://localhost`，若服务端白名单未含该 origin，真机壳内完整接口 / 图片可能被浏览器层拒收，`/healthz` 200 探活通过不代表跨域放行（`gate-smoke.log`）；触发条件——壳内 WebView 以 `https://localhost/` 加载，请求 `https://api.mixm.top/...` 属跨域；下一步——服务端侧核对 API / 媒体域 CORS 白名单包含 `https://localhost` 及各托管域名，断网 / 跨域失败路径在设备上复现一次。
6. **购物车角标缺全局计数数据源**：影响面——首页头部右侧购物车位 / Tab 角标没有全局未读 / 未购计数来源，当前不显示角标，属功能缺口而非排版缺陷；触发条件——登录态加购后需要角标反映购物车数量；下一步——确认会话态购物车计数接口与全局 store 订阅，再接头部 / Tab 角标。
7. **危险操作红色令牌被主按钮 `!important` 覆盖（C 线报告 §B）**：影响面——订单取消、收藏移除、清空收藏夹等危险确认弹窗设计上应为红色确认，但 `styles/theme.scss:245-247` `.uni-modal__btn_primary` 用 `!important` 强制品牌色，页面传入的 `confirmColor` 行内样式被压掉；C 线已移除三处无效 `confirmColor: '#C0392B'` 避免裸色值过 lint，"危险确认用红色"这一交互意图当前全局丢失；触发条件——任何调用 `uni.showModal` 做删除 / 取消 / 清空的场景；下一步——主题 / 组件线补一套令牌化的危险态 modal 样式，再由各页面挂接。
8. **并行工作流把改动扫进了一个信息不符的提交，影响回滚判断**：影响面——混入提交 `dad08f9` 信息为"管理后台纳入正式包并加深藏入口，闭环头像上传本地回退"，但 `git show --stat` 显示该提交同时扫入了本次 Android 改造的壳层契约、原生壳、首页重排与 13 个业务页改动，两类内容混在同一提交；其后 `c4a54b6` 才把首页视觉收尾单独提交（信息与内容一致）。触发条件——按提交信息做回滚 / 摘选时，会误判 `dad08f9` 全部属于后台 / 头像功能，或反过来把 Android 改动一并撤掉；下一步——回滚必须按第 6 章文件清单逐文件核对，不能按 commit message 判断范围，后续提交应按写线边界拆分（契约 §6）。
9. **其他待补证据（#6 / #7）**：下拉刷新动画、按压态、空 / 错 / 加载态、离线重试、320px 窄屏仅有源码或 H5 预览证据（`pages-*-320.png`），缺设备目视截图；管理后台页仍有裸安全区与硬编码渐变（`pages/admin/index.vue:457/466`，C 线报告 §A）；少量非令牌 rgba 残留待统一收口（C 线报告 §C）。

---

## 6. 怎么回滚

**先读这一条**：混入提交 `dad08f9` 的信息与内容不符（见 5.8）。回滚时**不要按提交信息判断改动归属，要按本节文件清单**，并用 `git show --stat dad08f9` 与 `git status` 逐项复核。以下命令在仓库根 `F:\合并项目\MixmAPP` 执行；本次写作时点工作树除本新文档外干净，首页收尾改动已在 `c4a54b6` 提交。

### 6.1 按文件粒度（推荐：只撤 Android 改造，保留并行线功能）

Android 改造相关文件（撤回至 `d4a30ef`，即混入提交 `dad08f9` 之前；`dad08f9` 本身仍含这些改动，不能作为回滚基线）。其中 `index/index.vue` 撤回到 `d4a30ef` 会一并丢掉 `c4a54b6` 的视觉收尾，需保留时先摘出该提交的两个 hunk：

```powershell
git checkout d4a30ef -- `
  docs/34-android-app-shell-spec.md apps/app/src/styles/app-shell.scss `
  apps/app/src/styles/theme.scss `
  apps/mobile/android/app/src/main/java/top/mixm/app/MainActivity.java `
  apps/mobile/android/app/src/main/res/values/colors.xml `
  apps/app/src/pages/index/index.vue apps/app/src/pages.json `
  apps/app/src/navigation.ts apps/app/src/components/mx-bar/mx-bar.vue `
  apps/app/src/pages/auth/login.vue apps/app/src/pages/auth/register.vue `
  apps/app/src/pages/cart/index.vue apps/app/src/pages/mall/index.vue `
  apps/app/src/pages/mall/detail.vue apps/app/src/pages/me/favorites.vue `
  apps/app/src/pages/orders/index.vue apps/app/src/pages/legal/privacy.vue `
  apps/app/src/pages/assistant/index.vue apps/app/src/pages/research/index.vue `
  apps/app/src/pages/research/detail.vue
```

混合文件（同时含 Android 适配与并行线功能，不能整文件 checkout，需手工拆 hunk）：

- `apps/app/src/pages/me/index.vue`：安全区 / 令牌适配 + 头像上传 / 后台入口。
- `apps/app/src/pages/settings/about.vue`：深色令牌 / 重试 + 版本号连点 5 次进后台手势。
- `apps/app/src/api/client.ts`：离线重试逻辑 + `avatarUrl` `/media` 兼容与占位 SVG。
- `apps/app/src/App.vue`：壳层样式引入 / 备案行令牌 + `onPageNotFound` 注释与后台注册行为。

并行线混入、与 Android 改造无关的文件（回滚 Android 时**不要**动）：

- `apps/app/scripts/build.mjs`（解除 admin 页面正式包剥离）
- `packages/contracts/src/index.ts`（avatarUrl 类型兼容）

首页视觉收尾提交 `c4a54b6` 只动 `index/index.vue`；若保留 Android 首页重排、仅想撤掉该收尾，单独 revert 它即可：

```powershell
git revert --no-commit c4a54b6
```

### 6.2 按提交粒度（整包回滚，代价是一并撤掉并行线功能）

```powershell
# 确认提交内容（不要只看 message）
git show --stat dad08f9

# 生成反向提交，保留历史；先在工作树核对再提交
git revert --no-commit dad08f9
git status
# 核对无误后：
git commit -m "revert: 回滚 dad08f9 混入的 Android 壳层改造与并行线改动（按文件清单复核）"
```

注意：`git revert dad08f9` 会把该提交内 admin 剥离解除、头像上传、连点手势、contracts 兼容一并撤回；`c4a54b6` 随后又改过 `index/index.vue`，revert 该文件可能冲突，按 6.1 文件清单手工取舍。若只想撤 Android 部分，不要用整包 revert，必须按文件 / 按 hunk 处理。回滚后需按第 7 章重建 H5 产物并重新 `sync:android`，否则 APK 内仍是旧内嵌产物。

---

## 7. 复现与验证手册

别人拿到这台机器后，5 步内重新出包并复验。命令在仓库根执行；PowerShell 7。

1. **装依赖 + 跑门禁**

   ```powershell
   pnpm install
   pnpm lint
   pnpm typecheck
   pnpm verify          # 169 passed / 8 skipped 为基线
   pnpm build:h5
   pnpm build:mp-weixin
   pnpm build:harmony
   pnpm domains:check
   ```

2. **同步壳内资产并做注入体检**

   ```powershell
   pnpm --filter @mixmapp/mobile run sync:android   # cap sync android + android-inject-base.mjs
   node scripts/android-inject-base.mjs --check      # 壳内前端版本常量与 version.json 一致
   ```

3. **出 debug / release 两个 APK**（JDK 21，路径见 ACCEPTANCE §2.2）

   ```powershell
   pnpm --filter @mixmapp/mobile run build:debug
   pnpm --filter @mixmapp/mobile run build:release
   ```

4. **装机 + 冒烟**（AVD `emulator-5554` 在线）

   ```powershell
   adb devices
   adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
   node scripts/android-smoke.mjs        # 10/10 通过；/healthz 200；logcat 无 FATAL
   ```

5. **目视复验，对照这几张图**（`ui-review/android-2026-11-20/`）：冷启动 / 首页 `after-final-coldstart.png`、`after-final-home.png`、`after-final-home-scroll.png`（3 秒内出首页，头部不压状态栏，Tab 在手势条之上）；深色 `after-final-home-dark.png`、`after-final-home-dark-statusbar.png`；键盘 `after-final-keyboard-ime.png`；二级页返回 + 中文标题 `after-final-product-detail.png`、`after-final-about.png`、`after-final-privacy.png`；守卫与注册 `after-final-cart-guarded.png`、`after-final-orders.png`、`after-final-register.png`；疑点复核 `after-final-exit-first.png`（双击退出待干净冷启动后重测）、全量 logcat `after-final-logcat.txt`。

---

## 8. 证据口径备注

本文件引用的终验数字以 `ACCEPTANCE.md` 最新状态为准；两条写线报告中早一轮的构建 / 实测数字与终验存在批次差异，正文未混用。已知两处：A 线报告 §4 的 APK 体积（debug 4,735,371 B / release 3,496,849 B）与终验 §2.2（debug 4,735,704 B / release 3,523,153 B）为不同批次出包；A 线报告 §3.4 冒烟启动 `TotalTime 1489ms` 与终验冒烟 `2315ms`、冷启动 `1654ms` 为不同次运行。
