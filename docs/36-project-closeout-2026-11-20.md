# 36 · 项目收尾报告：MixmAPP 当前状态一览（2026-11-20 / 21）

- 日期：2026-11-20 首轮验收；2026-11-21 第二 / 三 / 四轮补测与推送发布（Asia/Shanghai）
- 仓库根：`F:\合并项目\MixmAPP`　分支：`main`　本地 HEAD：`ac5a769`（与 `origin/main` 齐平，无 ahead）
- 读者口径：只看本文件即可判断项目处于什么状态、能跑什么、不能跑什么、下一步先做什么；所有结论挂第一手证据，拿不到证据的项如实标「未取到 / 待回填」。
- 第一手证据：
  - 终验矩阵（前三轮口径）：`ui-review/android-2026-11-20/ACCEPTANCE.md`
  - 生产复核：`ui-review/android-2026-11-20/PROD-VERIFY.md`
  - 全项目横切盘点与 CI：`ui-review/android-2026-11-20/inventory-PROJECT-INVENTORY.md`
  - 推送 / CI / 线上发布实证：`ui-review/android-2026-11-21/PUSH-CI-PROD.md`
  - 第四轮设备收口：`ui-review/android-2026-11-21/DEVICE-CLOSEOUT.md`
  - 交易链路实证：`ui-review/android-2026-11-21/report-trade-chain.md`（`trade-probe/`）
  - CORS 实证：`ui-review/android-2026-11-21/report-cors.md`（`cors-probe/`）
  - 角标 / 危险色报告：`ui-review/android-2026-11-21/report-cart-badge.md`、`report-danger-color.md`
  - Android 专项说明：`docs/35-android-app-refresh-2026-11-20.md`（首轮口径，部分子项已被后续补测更新，见 §11）
- 版本口径：`version.json` `version=0.0.2` / `channel=release` / `released=[0.0.1]`；Android badging `versionName=0.0.2` / `versionCode=3`。本轮未升版，换代依据是 release 目录名与 H5 指纹（PUSH-CI-PROD §3）。

---

## 1. 仓库当前坐标

### 1.1 提交序列（`git log --oneline`）

| 提交 | 说明 | 推送 / CI 状态 |
| --- | --- | --- |
| `1be127b` | 本轮收口：⑥ 角标 / ⑦ 危险态 / ① 原生 uiMode 主题推送（`1be127b`，9 文件） | **已推送（`ac5a769..1be127b`）**；三条 CI 全绿：ci `44897921255`、Android `44897921251`、deploy `44897921264`；deploy 真实原子发布 `20261121191911` |
| `ac5a769` | 商城列表不渲染修复报告（docs/38 入库，docs-only，`[skip ci]`） | 已在 `origin/main`；文档提交，无 CI 产物要求 |
| `2dce26b` | 商城首屏不再被重复 `onShow` 打回骨架屏，列表与分页恢复 | 已推送；三条 CI 绿（§6.1）。**提交信息未写明：⑥ 的 `stores/cart-badge.ts`（64 行）与 `mall/index.vue` 角标改动被一并扫入**（`git show --stat 2dce26b`），归属不能只看提交信息 |
| `6417e33` | Android 改造说明与全项目收尾报告（docs/35、docs/36 入库） | 已推送；三条 CI 绿（§6.1）；deploy 真实原子发布 |
| `a97b30f` | 壳层下拉刷新（SwipeRefreshLayout 形态，跨端不依赖 DOM） | 已推送（含在 `dad08f9..6417e33` 推送区间内） |
| `c4a54b6` | 首页入口与区块标题收口 | 已推送（同上区间） |
| `dad08f9` | 提交信息写「管理后台纳入正式包并加深藏入口，闭环头像上传本地回退」；**本次 Android 改造的多数文件被这个信息与内容不符的外部提交一并扫入** | 已推送；混入提醒见 §9 |
| `d4a30ef` | 智能助手对话页、待支付发起骨架与地址定位填充 | 已推送 |

- 推送实证：`git push origin main` 成功，`dad08f9..6417e33 main -> main`；推送后 `git status -sb` 为 `## main...origin/main`（无 ahead）；`gh auth status` = afdk1991，scope 含 repo / workflow，**未出现凭据失败**（PUSH-CI-PROD §1）。
- 工作树：本轮收口修复（① `MainActivity.java`、⑦ `theme.scss` / `uni.scss` / `modal.ts`、⑥ 的 `index/index.vue` / `me/index.vue` / `App.vue`）已提交为 **`1be127b`** 并推送，三条 CI 全绿（§6.1）、deploy 原子发布 `20261121191911`；本文件与 `docs/01-architecture.md` 的 demoMode 说明随后以 docs-only 提交入库（`[skip ci]`）。
- 并行线（同一账号另一会话，已提交 / 在途）：`README.md`、`apps/app/index.html`、`docs/android-build.md`、`docs/37-brand-logo-font-audit-2026-11-21.md`（品牌标志线，在途）、`docs/38-mall-list-render-fix-2026-11-21.md`（已随 `ac5a769` 入库）；**不属于本轮 Android / 交易收口**，本文件不声称本轮改了品牌 / 图标；docs/37、38 编号已被并行线占用，本轮只更新 docs/36。

### 1.2 一句话状态

线上 H5 / API / 媒体域在跑，且线上包与 CI 产物逐字节一致；Android 端经四轮补测，冷启动、安全区、导航、深色、键盘避让、下拉刷新、离线重试、三键 / 挖孔、按压 / 空态 / 骨架屏、CORS、角标、危险色均有设备或响应头实证；本地真实链路已跑到落库 + 扣库存，真实收款被外部商户资质阻塞；支付回调回写订单状态是一处待修代码缺口；小程序 / 鸿蒙仍只到构建产物。

---

## 2. 本次交付改动摘要（五层）

| 层 | 一句话 | 关键文件 | 证据指针 |
| --- | --- | --- | --- |
| 壳层契约与安全区 | 冻结原生壳 ↔ Web 的唯一接口：四个 `--mx-safe-*` / `--mx-ime-bottom` 变量，无壳时回落 `env()` → 0 | `docs/34-android-app-shell-spec.md`；`apps/app/src/styles/app-shell.scss`；`apps/app/src/styles/theme.scss`；`apps/app/src/App.vue` | docs/35 §3.1；ACCEPTANCE §四 A/B |
| 原生壳 | insets / 主题 / 键盘高度由原生下发 CSS 变量；系统栏图标按页面主题解析；第四轮补原生 `onConfigurationChanged` 主题推送路径 | `apps/mobile/android/app/src/main/java/top/mixm/app/MainActivity.java`；`apps/mobile/android/app/src/main/res/values/colors.xml` | docs/35 §3.2；DEVICE-CLOSEOUT §① |
| 首页信息架构与导航 | 整屏营销 hero 改为 头部行 → 搜索 → 4 宫格 → 通行证卡 → 运营位 / 分类 / 列表；Tab 四项短文案、12px；二级页统一返回槽 + 中文标题 | `apps/app/src/pages/index/index.vue`；`apps/app/src/pages.json`；`apps/app/src/navigation.ts`；`apps/app/src/components/mx-bar/mx-bar.vue` | docs/35 §3.3；ACCEPTANCE A/C |
| 业务页交互与深色 | 13 个业务页收口安全区 / 吸附条 / 按压 / 三态 / 键盘避让 / 窄屏收缩 / 深色令牌；第四轮补全局角标与危险态弹窗 | `apps/app/src/pages/{auth,mall,cart,orders,me,legal,settings,assistant,research}/**`；`apps/app/src/stores/cart-badge.ts`；`apps/app/src/modal.ts` | docs/35 §3.4；report-cart-badge.md；report-danger-color.md |
| 下拉刷新 | uni 自带下拉在「自定义导航栏 + Capacitor WebView」下不可靠，改为去 DOM 化壳层组件，流式推位 + 52px 旋转空隙，首页 / 商城接入 | `apps/app/src/components/mx-pull-refresh/mx-pull-refresh.vue`；`apps/app/src/pages/index/index.vue`；`apps/app/src/pages/mall/index.vue`；`apps/app/src/pages.json` | ACCEPTANCE §九 9.2；#6 |

---

## 3. 验收总表（A–H）

口径：前三轮以 `ACCEPTANCE.md` 为准；第四轮（2026-11-21）收口项以 `DEVICE-CLOSEOUT.md` / `report-trade-chain.md` / `report-cors.md` / `report-cart-badge.md` / `report-danger-color.md` 为准；终轮复验矩阵见 `ACCEPTANCE.md` 第十节「第四轮：②–⑦ 收口复验」（10.1–10.9，322–396 行）。

| 条目 | 口径 | 最新结论 | 关键证据 |
| --- | --- | --- | --- |
| A 冷启动首屏 | 3 秒内出首页、Tab 常驻、不压状态栏、无整屏海报 hero | **通过** | 多批次冷启动：首轮 1654ms、第三轮 2761ms、基线还原 1742ms；**终版包 COLD `TotalTime 1432ms / WaitTime 1434ms`，pid 5885**（ACCEPTANCE 10.2 / 10.5）；`after-final-coldstart.png`、`after-final-home.png`；`--mx-safe-top/bottom=63px` |
| B 系统栏与手势 | 浅 / 深 / edge-to-edge / 手势导航不被遮挡，栏图标明暗自适应 | **通过** | 第四轮原生推送路径：logcat `页面主题自报：dark/light（系统 uiMode 原生推送）`，body `rgb(18,23,22)` / `rgb(244,244,241)`，手动偏好不被系统覆盖（`uimode-dark-page.png`、`uimode-light-page.png`、`logcat-theme-insets.txt`、`logcat-uimode-round4.txt`）；终版深色令牌 `--mx-paper=#121716`、`--mx-ink=#eceee9`（`after-final-dark.png`）；三键 `--mx-safe-bottom=126px`、挖孔 `--mx-safe-top=136px` 见 §12 ③ |
| C 导航模型 | Tab 文案 ≤4 字、选中态清晰、逐级回退、根页双击退出有提示、二级页不丢 Tab 上下文 | **通过** | 文案 `首页/商城/购物车/通行证`；终版回归四枚 Tab 常驻（`.uni-tabbar__item` × 4，`nav3-home.png`、`badge-device-3.png`）；`after-final-mall.png`、`after-final-pass.png`、`after-final-product-detail.png`、`after-final-about.png`、`after-final-privacy.png`；双击退出 `after-final-back-first.png` / `after-final-back-exit.png`，实现 `MainActivity.java:686-737` |
| D 原生手感 | 惯性滚动、下拉刷新、按压反馈、键盘不遮输入、Toast / 加载 / 空 / 错态齐备、无白闪 | **通过** | 惯性滚动、键盘避让（`--mx-ime-bottom=883px`）、下拉刷新三态、离线错误态 + 重试通过；第四轮补按压 DOWN `is-press` opacity 0.7 / UP 回弹 1、空态 0 卡片、骨架屏 `sk=16 / 4` 张逐帧截图（`press-down.png`、`press-up.png`、`empty-state.png`、`skeleton-loading.png`）；终版回归：下拉刷新归位后列表 26 件（`after-final-refresh.png`）、键盘 `mInputShown=true`（`after-final-keyboard.png`） |
| E 功能完整 | 登录注册 / 商城 / 详情 / 购物车 / 下单 / 订单 / 通行证 / 关于隐私 / 深色 / 离线重试可走通，无横向溢出、320px 不破版 | **部分通过** | 游客态 + 演示沙箱闭环走通；**本地真实链路已实证落库 + 扣库存 + 幂等重放**（§12 ②）；收藏移除弹窗已真机取证（§7.4）；残留：真实收款外部阻塞（§8）、清空收藏夹与三态回归未逐帧留证（§7.4）、目录商品库存为 0（§7.5）。320px `after-final-narrow-home/mall/register.png` |
| F 出包与验收 | debug / release 均出 APK，装机启动无 FATAL，截图留证 | **通过（终版包已核验，指纹见 §3.2）** | 终版全量重建两包均 `BUILD SUCCESSFUL`；debug 卸载旧包后装机、`DEBUGGABLE` 在位；release `apksigner verify` 通过、包内 ⑥⑦ 新 chunk 在位；release 本轮未重装设备（保留 debug 可调试态），第二轮 release 装机冷启动 1370ms / 零 FATAL 结论并存。证据：`gate-build-debug-round4.log`、`gate-build-release-round4.log`、ACCEPTANCE 2.2 / 10.1 |
| G 不回归 | H5 / 小程序 / 鸿蒙构建不受影响，未改 API 协议与域名（只认 mixm.top） | **通过** | `gate-build-h5.log` / `gate-build-mp-weixin.log` / `gate-build-harmony.log` 均 exit 0；`gate-domains.log` 通过；`verify` 169 passed / 8 skipped；第四轮 `lint` ✓、`typecheck` ✓（`gate-lint-round4.log`、`gate-typecheck-round4.log`）；小程序 / 鸿蒙仅到构建产物，未在各自运行时预览 |
| H 中文说明 | 中文文档在位、证据可被引用 | **通过（证据在位）** | `docs/` 中文 Markdown 在位；本目录留存门禁日志、APK 签名、设备截图、logcat 与终验矩阵 |

### 3.1 补测改判记录（首轮 → 最新）

| 子项 | 首轮口径 | 最新口径 | 轮次 / 证据 |
| --- | --- | --- | --- |
| 双击退出（C） | 未新鲜复现，存疑 | **通过**：冷启动根路由 `history.length=1`，首次返回 Toast「再按一次退出」，2s 内二次返回回启动器 | 第二轮，`after-final-back-first.png` / `after-final-back-exit.png` |
| release 装机（F） | 未装机，运行期未实测 | **通过**：卸载 debug → 装 release，COLD 1370ms，零 FATAL，测完装回 debug | 第二轮，`after-final-release-coldstart.png` / `after-final-release-logcat.txt` |
| 离线重试（D） | 仅源码证据 | **通过**：飞行模式错误态 + 重试无崩溃，恢复网络重载 20 件 | 第二轮，`after-final-offline-mall.png` / `after-final-online-reload.png` |
| 手动深浅跟随（B） | 存疑：手动路径未测 | **通过**：App 内切深色桥报 `dark`、图标转白；切浅色桥报 `light`、图标转回 | 第二轮，`after-final-manual-*.png` |
| 320px 窄屏（E） | 仅 H5 预览 | **通过**：320 CSS px 首页 / 商城 / 注册 `scrollWidth=innerWidth=320` | 第二轮，`after-final-narrow-*.png` |
| 登录到演示单（E） | 无测试账号，未走通 | **演示沙箱内走通**：注册 → 登录 → 加购 → 结算 → 演示预览单；真实落库后续由 ② 线本地实证 | 第二轮 `after-final-flow-*.png`；第四轮 `report-trade-chain.md` |
| 下拉刷新（D） | uni 自带回调未唤起 | **通过**：壳层组件三态齐全，真实请求发出（首页资源 27→32、商城 API 12→14），7 条回调 logcat | 第三轮，`after-final-pull-home-*.png` / `after-final-pull-mall-*.png` / `after-final-pull-logcat.txt` |
| 系统深浅原生自报（B） | matchMedia 未派发，壳层靠 `resolveNight()` 回落系统 uiMode 猜栏图标 | **通过，第一轮问题 #1 已关闭（终版包内仍生效）**：修掉的是壳层依赖——`onConfigurationChanged` 比对 `UI_MODE_NIGHT_MASK` 后主动经桥推 `dark/light`，`webTheme` 由自报值驱动系统栏图标，`resolveNight()` 仅首帧兜底；页面配色自动跟随仍按契约由 CSS `@media (prefers-color-scheme: dark)` 承担（`auto` 通道本就是媒体查询，设计如此），不是壳推送驱动换肤。终版包 logcat 双向留证：`10:58:05.820 dark（系统 uiMode 原生推送）`、`10:58:08.013 light（…原生推送）` | 第四轮 / 终轮，DEVICE-CLOSEOUT §①；ACCEPTANCE 10.5 / 10.6；`logcat-uimode-round4.txt`、`uimode-dark-page.png` / `uimode-light-page.png`、`after-final-dark.png`；`theme.ts:5-7,18-19` |
| 三键 / 挖孔（B） | 未实测 | **通过**：三键 `--mx-safe-bottom=126px`；挖孔 `--mx-safe-top=136px` | 第四轮，DEVICE-CLOSEOUT §③ |
| 按压 / 空态 / 骨架（D） | 缺逐帧设备截图 | **通过**：按压 opacity 0.7↔1；空列表 0 卡片；骨架 `sk=16 / 4` | 第四轮，DEVICE-CLOSEOUT §⑤ |
| CORS 壳源（G / E） | 白名单未确认 | **已放行（实测）**：三个壳源预检 204 + GET 200 精确回显 ACAO，负面对照无 ACAO | 第四轮，report-cors.md §3.1 |
| 全局角标（E） | 缺计数数据源 | **已接通并真机实证**：全局 store + 三处挂接；真实点「+」加购，三处读数与接口 `totalQuantity` 一致（3→2→0，0 隐藏）。残留限制见 §7.2 | 终轮，ACCEPTANCE 10.3；`badge-device-3.png` / `badge-device-3-tab.png` / `badge-device-3-me.png` / `badge-device-2.png` / `badge-device-2-me.png` / `badge-device-0.png`；report-cart-badge.md |
| 危险确认红色（D） | 被主按钮 `!important` 压成品牌青 | **已令牌化并真机取证**：`--mx-danger` 明 / 深 AA 对比；真机收藏移除弹窗主按钮 `rgb(179,55,42)`（= `#b3372a`），Cancel `rgb(51,58,55)`，关窗后危险类摘除、不污染普通确认；普通确认仍品牌青。未覆盖项见 §7.3 | 终轮，ACCEPTANCE 10.4；`danger-device.png`；report-danger-color.md |

### 3.2 终版两包指纹（ACCEPTANCE 2.2，第四轮终版全量重建）

| 包 | 体积 | 包体文件 SHA-256 | 证书 | 装机 / 校验 |
| --- | --- | --- | --- | --- |
| debug `app-debug.apk` | 4,736,066 B（4625.1 KiB） | `955E75F8EAEECA7FA50C98B27C9C273A118BBC77C8818313FB5D9EF7B4AEFB33` | DN `C=US, O=Android, CN=Android Debug`；证书 SHA-1 `37:39:BF:5C:F0:8C:C2:8B:D9:54:0F:31:E3:0B:A7:D4:76:93:97:45` | 先 `uninstall` 旧包再装，`DEBUGGABLE` 在位 |
| release `app-release.apk` | 3,526,555 B（3443.9 KiB） | `1B9A872B897D06A2D29645BB559A555825213794608440E9382AB644098E272D` | DN `CN=MixmAPP, OU=Mobile, O=MixmAPP, L=Ningbo, ST=Zhejiang, C=CN`；证书 SHA-256 `7fb8682499cd9e82f5e751cae4c99e63e8d405be78c76ff87703dfd008386e69` | `apksigner verify` 通过；本轮未重装设备（保留 debug 可调试态） |

- release 包内已核验 ⑥⑦ 新 chunk：`cart-badge.DOPMeSER.js` 470 B、`modal.DpW-IuuU.js` 494 B、`version.DOIV2F3S.js` 32 B；两包 badging `versionCode=3 / versionName=0.0.2`。
- **包体文件哈希 ≠ 证书哈希**，上表分别列出；DEVICE-CLOSEOUT §包体记录的 `757d8698…` 是 debug 证书 SHA-256，不是包体哈希（见 §11）。

---

## 4. 全项目 11 面浓缩清单

完整逐面证据见 `inventory-PROJECT-INVENTORY.md` §2.1–2.11；本表只给结论与指针，过时缺口以 §3 / §7 为准。

| # | 面 | 结论 | 一句话依据 | 证据指针 |
| --- | --- | --- | --- | --- |
| 1 | API | **已完成** | `/healthz` `/readyz` `/meta` 均 200，meta 回包 version 0.0.2 / env production；路由与版本标记就位 | inventory §2.1；`prod-healthz-anon.body` / `prod-meta.body` |
| 2 | H5 | **已完成** | 本地与 CI 构建通过；`mixm.top` / `www.mixm.top` / `cloud.mixm.top` 三入口 200，注入 API / 媒体绝对基址 | inventory §2.2；`gate-build-h5.log` |
| 3 | Android | **主体完成，残留见 §7** | 四轮补测后 A/B/C/D/F/G/H 通过，E 部分通过；三键 / 挖孔 / 按压 / 空态 / 骨架 / 深色原生推送均有设备证据；终版 debug / release 已全量重建并核验指纹（§3.2） | inventory §2.3（部分缺口已被后续轮次更新）；ACCEPTANCE 全文；DEVICE-CLOSEOUT.md |
| 4 | mp-weixin | **未完成** | 构建通过、产物齐全；appid 仍 `touristappid`，未发布后台，上传 / 收银台 live / 地图选点未接 | inventory §2.4；`gate-build-mp-weixin.log` |
| 5 | 鸿蒙 | **未完成** | `build:harmony` 编译产物存在；本机无 DevEco / 模拟器 / 真机，设备验证未做 | inventory §2.5；`gate-build-harmony.log` |
| 6 | 管理后台 | **已完成** | 后台页 + 5 连击深藏入口 + 后端 `x-admin-token` 守卫就位；未带令牌 `/admin/*` 404 为预期回退 | inventory §2.6；PROD-VERIFY §3 |
| 7 | 支付与 OAuth 回退态 | **回退态已完成；真实收款外部阻塞** | 未接商户时订单走 dev/mock 占位不扣款；OAuth 未配置不下发按钮、直打 503 `PROVIDER_DISABLED`；本地账号路径可用；真实收款凭据与主体资质见 §8 | inventory §2.7；report-trade-chain.md §3.5 |
| 8 | 存储与上传 | **已完成** | 本地存储 + 签名 PUT 上传 + 目录穿越兜底就位；S3 适配器在但未配置（线上 `storage=local`） | inventory §2.8；PROD-VERIFY §4 |
| 9 | CI 与部署 | **已完成** | 两条提交线三条流水线绿；`atomic-release.sh` 切 symlink + 健康检查失败自动回滚；`rollback.sh` 可回退 N 版；目录数据包 CI 内缺失，走开发机直送 | inventory §2.9；§6 下文；PUSH-CI-PROD.md |
| 10 | 文档与版本一致性 | **已完成（附观察项）** | version.json ↔ README ↔ 各包 ↔ version.ts / manifest / `.env.example` / config 默认值均 0.0.2 / versionCode 3；编号 22 归档空缺；docs/35、36 已随 `6417e33` 入库，docs/37、38 为并行品牌 / 修复线 | inventory §2.10；`docs/19-versioning.md` |
| 11 | 历史阻塞 | **外部阻塞** | 个人开发者资质、商户 / 短信 / 一键登录、企业系 OAuth、小程序 AppID、鸿蒙工具链、图库授权等需平台侧申请审核，非代码缺口 | inventory §2.11；§8 下文；`docs/33` §3.5 |

---

## 5. 生产复核结论（6 条，PROD-VERIFY.md）

| # | 复核项 | 结论 | 一句话依据 |
| --- | --- | --- | --- |
| 1 | 生产 H5 包（admin 路由 / chunk 名 / 线上哈希比对） | **部分成立** | admin 路由在位；宣称的分包 / 主包 chunk 只存在于线上与 CI 包，本地 dist 不存在；本地与线上四个同角色 chunk sha256 全部不一致，CI 包与线上全部一致（`prod-h5-apk-hashes.txt`） |
| 2 | 管理后台三面板（oauthProviders / merges / mallImport） | **成立** | 页面、前端客户端、后端路由三层均有文件 + 行号证据，线上 admin 分包特征串在位（PROD-VERIFY §2） |
| 3 | 数据面守卫 `/admin/db` | **成立** | 无令牌 404 NOT_FOUND；正确令牌 200 返回 DB 快照；路由真实存在，未替换端点（`prod-admin-db-guard.txt`） |
| 4 | 上传链路端到端（presign → 签名 PUT → 媒体域读回） | **成立** | 200 / 200 / 204 / 200；读回 `image/png` 82 B，sha256 与本地 16×16 测试图一致，QA 前缀 `qa/android-refresh-20261120/`（`prod-upload-chain.json`） |
| 5 | debug APK `mixmapp-debug-apk-0.0.2` 一致性 | **成立（CI 产物）** | CI run 44752372990 归档 4,058,114 B，versionCode 3 / versionName 0.0.2；内嵌四 chunk 与线上逐字节一致；本地磁盘无同名文件 |
| 6 | API release `20261120222507` 在跑 | **已被新版替代（两轮）** | 复核时 `current → releases/20261120222507`；随后 `6417e33` 部署发布 `20261121180133`，本轮 `1be127b` 再发布 **`releases/20261121191911`**（上一版 `20261121183505`，即 `2dce26b` 那次），每次均健康校验 `/healthz`（PUSH-CI-PROD §3 / §7） |

### 5.1 线上新包指纹与演示态现状

- **线上确实换了新包（两次）**：`6417e33` 那次线上主包为 `/assets/index-B0so9w8u.js`（含 `mx-pull-refresh`）；`1be127b` 这次主包换为 **`/assets/index-B1LMK_54.js`**，内容含 `mx-pull-refresh`、`cart-badge`、`modal` 三个本轮组件名 —— 即线上跑的是本轮代码，不是旧包（`mx-modal--danger` 在独立 modal chunk 内，主包不含该字符串属正常分包）。
- **版本号未变**：meta 仍 `version=0.0.2`、`env=production`；符合 `docs/19` 口径，本次不升版，换代依据是 release 目录名与 H5 指纹，不是版本号。
- **线上仍为演示态**：meta `mall.demoMode=true`；`catalogSource` `mode=auto / source=db / active=false / productCount=0`（PUSH-CI-PROD §4）。

### 5.2 本地构建 ≠ 线上包：产物批次差异，不是部署不一致

- **事实**：线上部署包与 CI 产物内嵌 H5 四 chunk 逐字节一致；本地 `apps/app/dist/build/h5` 是另一次构建，chunk 名与哈希都不同（PROD-VERIFY §1、§5）。
- **口径**：这是「本地重建集 vs CI / 线上集」的构建产物批次差异，**既不是部署不一致，也不能宣称本地包已与线上对齐**；本机 `build/outputs/apk/debug/app-debug.apk` 内嵌的是本地重建 chunk 集，与线上不一致（PROD-VERIFY §5 本地磁盘对照项）。
- 取证期间本地 dist 被并发验收线多次重建；当前本地 dist 哈希未与线上比对，不据此判断线上版本新旧。

---

## 6. CI 现状

### 6.1 流水线结果（`gh run list` 与 PUSH-CI-PROD §2）

| 提交 | 工作流 | Run ID | 结论 | 备注 |
| --- | --- | --- | --- | --- |
| `6417e33` | ci | 44891979512 | **success** | 09:58:29Z 完成 |
| `6417e33` | Android（debug APK） | 44891979520 | **success** | 09:58:55Z 完成 |
| `6417e33` | deploy | 44891979523 | **success** | 10:01:39Z 完成，含真实原子发布 `20261121180133` |
| `2dce26b` | ci | 44894738381 | **success** | 商城骨架屏修复线 |
| `2dce26b` | deploy | 44894738429 | **success** | 同上 |
| `2dce26b` | Android | 44894738436 | **success** | 同上 |
| `1be127b` | ci | 44897921255 | **success** | 11:19Z 前后完成，含真实库集成 / 三端构建 |
| `1be127b` | Android（debug APK） | 44897921251 | **success** | 同上 |
| `1be127b` | deploy | 44897921264 | **success** | 原子发布 `20261121191911`（上一版 `20261121183505`） |
| `ac5a769` | — | — | docs-only `[skip ci]` | 文档提交，无 CI 产物要求 |

- deploy 步骤口径：构建发布包 success；API + H5 原子发布 success（SSH 凭据就绪，真实发布到腾讯云）；**商品数据相关 3 步 skipped**（`DEPLOY_CATALOG != 1`，目录验收未开）。
- Android 步骤口径：debug APK 构建 + 上传 artifact success；**Decode keystore / Assemble release AAB / Upload AAB skipped**（`HAS_SIGNING != true`，未配签名 Secrets）；`Warn when unsigned` success（inventory §0.2）。

### 6.2 未取到 / 无 CI 结果的部分

- **Gitee 流水线：未取到。** 仓内 git remote 只有 GitHub（`git remote -v`），无 gitee remote；本机无 gitee CLI；仅有静态定义 `.gitee/pipeline.yml`。无仓库地址 / 凭据 / CLI，不据此判红或绿（inventory §0.4）。
- **截至 `1be127b`，本轮所有代码改动都已有 CI 结果**：工作树不再保留未提交的源码改动（仅剩本文件与 `docs/01-architecture.md` 的 demoMode 说明以 docs-only 提交入库）。上表 9 条绿结论对应 `6417e33` / `2dce26b` / `1be127b` 三个已推送提交。
- 小程序 / 鸿蒙仅到构建产物，无各自运行时预览环境（inventory §2.4 / §2.5）。

---

## 7. 仍开放的问题（内部缺口，按影响面排序）

每条给文件 / 行号、触发条件、影响、建议下一步。外部资质 / 通道类阻塞统一归 §8，不在本节重复。

### 7.1 代码缺口：支付回调未回写订单状态 `pending → paid`

- 文件：`services/api/src/modules/pay.ts:136-163`（回调只更新 `payments.status=paid / paidAt`）；`services/api/src/modules/admin-console.ts:52-55,316-352`（后台正向流转从 `paid → picking` 起）；`infra/sql/0001_init.sql`（`payments` 表无 `order_id` 外键，靠 `outTradeNo` / `subject` 约定关联）。
- 触发条件：真实支付成功回调到达后。
- 影响：订单仍停在 `pending`，后台无法进入拣货流转；这是**代码缺口，不是外部阻塞**，与商户凭据相互独立。
- 下一步：测试环境补「验签通过后按 `outTradeNo` 关联订单置 `paid` 并写 `paid_at`」；先固化单号映射规则，再评审订单状态机与并发（pending/paid 可取消边界）。证据：report-trade-chain.md §5-A/B。

### 7.2 角标残留：部分变更路径未即时同步；`99+` 未真机构造

- 真机实证（账号 `breezeqa01`，公民编号 `MixmAPP-038D-MWVP-0000-0`，商城页真实点「+」，非接口注入购物车）：3 件 → 接口 `totalQuantity=3`、首页头部 / Tab / 我的页行均 `3`；车页「−」减 1 → 三处均 `2`；0 件 → 头部与 Tab 角标隐藏（`badge-device-3.png` / `badge-device-3-tab.png` / `badge-device-3-me.png` / `badge-device-2.png` / `badge-device-2-me.png` / `badge-device-0.png`，ACCEPTANCE 10.3）。
- 取证限制：会话由接口直连注册 / 登录签发（UI 合成输入进不了 v-model，注册 / 登录表单在 AVD 上无法用合成事件驱动）；此后加购、收藏、移除均为真实 UI 操作，未用接口注入状态冒充前端。
- 残留缺口：① `pages/mall/detail.vue` 详情页加购未接即时同步；② **车页内改量 / 移除当帧不重推 Tab 角标**，切到别的 Tab 页 `onShow` 才由 `refreshCartBadge` 对齐——`pages/cart/index.vue` 的 `applyCart` 未直连 `syncCartBadge`；③ ≥100 的 `99+` 文案未在设备构造超大件数验证（规则见 `cart-badge.ts`，dev 注入渲染过 128 → `99+`）。
- 下一步：把 `syncCartBadge(cart)` 接入详情页加购与车页变更回调；补一次 ≥100 件数的设备构造验证。证据：report-cart-badge.md §六；ACCEPTANCE 10.3 / 10.9。

### 7.3 危险态弹窗待接清单（范围外 6 处）

- 现状：订单取消、移除收藏、清空收藏夹已接 `showDangerModal`；以下弹窗仍是品牌青，**未接危险态，不要写成已修**：

| 页面 | 行号 | 动作 | 性质 |
| --- | --- | --- | --- |
| `pages/cart/index.vue` | 844 | 删除地址 | 破坏性（删除） |
| `pages/me/index.vue` | 596 | 解绑登录方式 | 破坏性（解绑后不可用该方式登录） |
| `pages/admin/index.vue` | 353 | 停用 / 启用 OAuth 渠道 | 半危险（停用渠道） |
| `pages/admin/index.vue` | 394 | 回滚账号合并 | 破坏性（按快照还原，令牌不可复活） |
| `pages/admin/index.vue` | 422 | 大批量目录导入 | 写操作（提示先备份） |
| `pages/legal/privacy.vue` | 92 | 退出应用（门禁页） | 边界 / 门禁类，是否标红需产品判定 |

- 下一步：对应页面把 `uni.showModal` 换成 `showDangerModal` 即可，无需再碰样式层。证据：report-danger-color.md §7。
- 本轮真机覆盖边界：订单取消路径未触发——测试账号 0 订单、0 地址，订单页 `.cancel-btn` 0 个，演示沙箱不落库订单，**未用接口构造订单冒充**；真机只经收藏移除（同一 `showDangerModal` 实现）取证：根节点 `uni-modal mx-modal--danger`，主按钮「移除」`rgb(179,55,42)`、Cancel `rgb(51,58,55)`，关窗后危险类摘除（`danger-device.png`）。**未覆盖**：深色危险令牌 `#e2695c` 未真机实测；订单取消弹窗本身待有演示单 / 真实订单时补拍（ACCEPTANCE 10.4 / 10.9）。

### 7.4 收藏夹登录态残留

- 已收口：登录态（`breezeqa01`）真实点「收藏商品」入夹 → 收藏页点「移除」→ 危险确认弹窗真机取证（`danger-device.png`，见 §7.3）。
- 残留：清空收藏夹弹窗（`favorites.vue:299`，同一 `showDangerModal` 函数）未做点击级实拍；收藏夹加 / 移 / 清空三态在设备上的完整回归未逐帧留证。
- 下一步：备沙箱账号在设备上补清空收藏夹与三态回归截图。证据：report-danger-color.md §10；ACCEPTANCE 10.6。

### 7.5 目录商品库存为 0；线上目录源未接管

- 文件 / 数据：本地 DB `products` 15043 条，其中 15037 条带 `source_key` 的源商品 `stock=0`，仅 6 条种子商品有库存；`tier` 门控下源商品 `stockUnconfirmed=true`、不扣库存。线上 meta `catalogSource.active=false / productCount=0`。
- 触发条件：要在真实目录商品上验扣减、或线上退出演示态时。
- 影响：本次扣减实证落在 6 条种子商品上；真实目录库存与商品数据未闭环。
- 下一步：经 `tools/egluosi-importer` 导入带真实库存的目录数据，或人工补库存；核对 DB 目录源与文件源口径。证据：report-trade-chain.md §2 / §5-C；PUSH-CI-PROD §4。

### 7.6 线上仍演示态（`MALL_DEMO_MODE` 未关）

- 文件：`services/api/src/config.ts:566-573`（开关取值，非测试环境默认 `on`）；`services/api/src/modules/mall.ts:887-892`（演示 / 真实下单分支）；开关说明已补入 `docs/01-architecture.md` §4。
- 触发条件：服务端 `api.env` 未显式置 `MALL_DEMO_MODE=off`。
- 影响：线上下单只生成 `DEMO-` 预览单，不落库、不扣库存、不清购物车、不调支付。
- 下一步：目录数据与支付回调闭环后，在服务端显式关闭演示态并回归真实下单链路。

### 7.7 待回填项

- 无。本轮代码改动已提交为 `1be127b` 并推送，三条 CI 全绿（ci `44897921255` / Android `44897921251` / deploy `44897921264`），线上已换包到 `releases/20261121191911`；终版两包指纹（§3.2）、真实加购角标（§7.2）、真机危险色（§7.3）、ACCEPTANCE 第十节（10.1–10.9，322–396 行）均已闭环，无留空。
- 唯一 docs-only 收尾：本文件与 `docs/01-architecture.md` 的 `MALL_DEMO_MODE` 说明随后单独提交（`[skip ci]`，文档提交无 CI 产物要求）。

### 7.8 可选小清理：`data-mx-system-theme` 当前无消费方

- 现状：原生 `pushSystemThemeOnConfig` 注入 JS 写 `data-mx-system-theme` 标记；全仓库 `apps/app/src` 检索该属性 0 命中——**没有任何 CSS / JS 消费它**。
- 定性：不影响现网行为。页面配色自动跟随按契约由 CSS `@media (prefers-color-scheme: dark)` 承担（`auto` 通道），`manual` 通道写 `data-mx-theme`；该属性目前只能描述为取证 / 调试标记，不驱动页面配色。
- 下一步（可选，本轮不动）：要么删掉原生侧这个写入，要么未来在 `theme.ts` 做成第三个消费者；无功能阻断。证据：`MainActivity.java:434-453`；`theme.ts:5-7,18-19`。

---

## 8. 历史阻塞与外部门槛（非代码缺口）

归属与政策摘录见 `docs/33` §3.5、inventory §2.11、`docs/29` §5、`docs/24`；交易侧精确凭据清单见 `report-trade-chain.md` §3.5。

### 8.1 真实收款：商户凭据 + 主体资质 + 公网回调

- **微信支付（`PAY_WECHAT_*`）**：启用判定需 `APP_ID + MCH_ID + SERIAL_NO + PRIVATE_KEY` 四项齐；回调另需 `API_V3_KEY`（32 字节）、`PLATFORM_PUBLIC_KEY`、`NOTIFY_URL`。申请主体须企业或个体工商户：注册商户号 → 绑定开放平台 AppID → 开通 APP 支付；**个人主体无法开通 APP 支付**。
- **支付宝（`PAY_ALIPAY_*`）**：启用判定需 `APP_ID + PRIVATE_KEY`；回调另需 `PUBLIC_KEY`、`NOTIFY_URL`。主体须企业 / 个体工商户，开放平台创建应用并签约 APP 支付（`alipay.trade.app.pay`，RSA2）。
- **回调可达性**：回调地址为 `https://<域名>/mixmapp/api/v1/pay/notify/{wechat|alipay}`；本地 `127.0.0.1` 收不到平台异步通知，需公网 HTTPS 环境。
- 代码侧适配器完整、无空桩；缺凭据时抛 `PROVIDER_DISABLED` 或回退 dev mock，登录页不渲染未启用渠道。

### 8.2 其他需企业资质 / 平台审核的通道

- 国内短信：个人认证无法通过签名实名制报备；一键登录 / 本机号码认证需运营商企业商务签约；企业微信 / 钉钉 / 飞书登录需企业组织主体；微信扫码 / 公众号授权需开发者资质认证或已认证服务号（`docs/33` §3.5-B）。
- 微信小程序：AppID 为空（`touristappid`），MP 后台合法域名待配。
- 鸿蒙：DevEco Studio 账号、签名、工具链与设备 / 模拟器缺失。
- Android 上架：release 签名 Secrets 未配进 CI，应用商店渠道未接。
- 备案：`mixm.top` 根域已备案；支付回调主体备案与账号一致为支付宝前置条件。
- 数据 / 资源类：商品原图包 / 高清图库授权、CloudBase 云 PG 连接串、AI 生成额度，属平台侧资源，本地无法闭环。

### 8.3 数据 / 并行线阻塞（编号沿用 docs/33 §3.5-C）

- **#34**：hznzcn 女装迁移线整目录隔离未入库（`.gitignore:41-43`），待并行会话收口后评估源码入库与生产导入。
- **#35**：无图商品约 3,817 个待补图，需原图包 / 图库授权；离线补图脚本已入库可重跑。
- 说明：仓库全文检索未发现独立编号 **#33** 的阻塞条目；本节准入矩阵口径来自 `docs/33` §3.5（即任务口径所指 #33），#34 / #35 为该文件内显式编号。

### 8.4 非阻塞的自助渠道（填 Key 即转 live）

GitHub / Gitee / Google / Facebook / 微博 / 抖音 / 华为 / QQ / Apple OAuth、高德 Key、AI Key、S3 对象存储、推送（极光 / FCM）适配器均完整；个人实名可申请，凭据落对应 env 即从 dev/off 转 live。

---

## 9. 回滚手册

**前提提醒**：本次 Android 改动多数混在 `dad08f9` 里，该提交信息与内容不符；**回滚不能按提交信息判断归属，只能按文件清单核对**（清单详见 `docs/35` §6.1）。回滚后需按 `docs/35` §7 重建 H5 产物并重新 `sync:android`，否则 APK 内仍是旧内嵌产物。

### 9.1 按提交粒度

```powershell
# 先核对提交内容，不要只看 message
git show --stat dad08f9

# 整包反向提交（保留历史）：会一并撤掉 admin 剥离解除、头像上传、连点手势、contracts 兼容
git revert --no-commit dad08f9
git status
# 核对无误后：
git commit -m "revert: 回滚 dad08f9 混入的 Android 壳层改造与并行线改动（按文件清单复核）"
```

- 后续单一目的提交可单独 revert：`2dce26b`（商城骨架屏修复）、`6417e33`（文档）、`a97b30f`（下拉刷新）、`c4a54b6`（首页收口）。
- 注意：`dad08f9` 之后多个提交改过 `index/index.vue`、`mall/index.vue` 等文件，整包 revert 可能冲突，按 9.2 文件清单手工取舍。
- 工作树本轮剩余未提交改动如需丢弃，先逐文件核对归属（§12 分组），不要整树 `checkout .`。

### 9.2 按文件粒度（只撤 Android 改造，保留并行线功能）

回滚基线为 `d4a30ef`（`dad08f9` 之前；`dad08f9` 本身仍含 Android 改动，不能作为基线）。Android 改造相关文件清单见 `docs/35` §6.1，命令形式：

```powershell
git checkout d4a30ef -- <docs/35 §6.1 清单中的文件>
```

混合文件（同时含 Android 适配与并行线功能，不能整文件 checkout，需手工拆 hunk）：`pages/me/index.vue`、`pages/settings/about.vue`、`api/client.ts`、`App.vue`；并行线混入、回滚 Android 时不要动：`apps/app/scripts/build.mjs`、`packages/contracts/src/index.ts`。

### 9.3 本轮 `1be127b` 只撤这一批（最常用）

```powershell
# 只回滚本轮收口（角标 / 危险态 / 原生主题推送），保留 dad08f9 的壳层与首页改造
git revert --no-commit 1be127b
git status        # 核对：App.vue / index.vue / me/index.vue / orders / favorites / theme.scss / uni.scss / modal.ts / MainActivity.java
git commit -m "revert: 回滚 1be127b（角标、危险态、原生主题推送）"
```

注意：⑥ 的 `stores/cart-badge.ts` 与 `mall/index.vue` 角标改动在 `2dce26b` 里，**回滚 `1be127b` 时这两个文件不会被撤回**，需要一并撤时对 `2dce26b` 按 §9.2 文件粒度手工取舍（该提交同时含商城骨架屏修复，不要整包 revert）。

---

## 10. 下一步建议（按投入产出排序，5 条）

1. **已完成的推送与 CI（本轮）**：`1be127b` 已推送，ci `44897921255` / Android `44897921251` / deploy `44897921264` 三条全绿，线上已切 `releases/20261121191911`。下一步无需再推，直接进入第 2 条的支付回调闭环。
2. **补支付回调回写订单 `paid` 的代码闭环。** 先在测试环境验「验签通过 → 按 outTradeNo 置订单 paid + 写 paid_at」，固化单号映射；这是真实收款前必须先修的内部缺口，不依赖外部资质。
3. **闭环目录数据与演示态切换。** 导入带真实库存的目录商品（或人工补库存），核对 DB / 文件源口径；目录就绪后服务端关闭 `MALL_DEMO_MODE`，在非 demoMode 环境跑下单 → 支付 → 回调 → 订单置 `paid` 全链路。
4. **收口前端残留：** 详情页 / 车页角标即时同步（`applyCart` 直连 `syncCartBadge`）；补 ≥100 `99+` 设备构造验证；6 处范围外弹窗接 `showDangerModal`；补深色危险令牌 `#e2695c` 真机实测、订单取消弹窗取证、清空收藏夹点击级实拍。
5. **外部资质与平台发布按节奏推进：** 企业 / 个体户资质到位后申请微信支付商户号与支付宝 APP 支付凭据、配公网回调；小程序注册 AppID 与后台域名；鸿蒙引入 DevEco 工具链；CI 配 release 签名 Secrets。A 类自助渠道可先行填 Key 转 live。

---

## 11. 证据口径与出入备注

- 本文件终验结论以 `ACCEPTANCE.md` 前三轮状态 + 2026-11-21 五份第四轮报告为准；`docs/35` 为首轮写作口径，其 §4 中 F「release 未装机 / 部分通过」、§5 中双击退出未复现、320px 未实测、离线重试缺证据、手动深色存疑、下拉刷新未唤起等条目，已在第二 / 三轮闭环或改判，详见 §3.1。
- `inventory-PROJECT-INVENTORY.md` §2.3 的 Android 缺口清单写于 `c4a54b6` 时点，早于后续补测；其中 release 装机、双击退出、320px、离线重试、手动深浅、下拉刷新、三键 / 挖孔、按压 / 空态 / 骨架等子项已被后续报告覆盖更新，未闭环项以 §7 为准。
- 多批次 APK 口径：**终版以 ACCEPTANCE 2.2 为准**（debug 4,736,066 B / release 3,526,555 B，指纹 §3.2）；历史批次体积仅作沿革、不再混用：A 线 4,735,371 / 3,496,849 B、PROD-VERIFY 本地 debug 4,735,704 B、第三轮 4,735,893 / 3,523,583 B。DEVICE-CLOSEOUT §包体「本轮未重出 release、旧包禁止当终版」的口径已被终版全量重建作废。启动耗时为不同次运行：1654 / 2315 / 1370 / 2761 / 1742 / 1432 ms（终版）。
- 交易链路结论来自本地 PostgreSQL 探针（`127.0.0.1:8080`，`MALL_DEMO_MODE=off`），**未触碰线上**；线上仍 `demoMode=true`。演示态对照实例在 `8081`，库内 orders / items / 库存均未变（report-trade-chain.md §4）。
- 探针账号 `probeuser01`（交易链路，本地 PG）与 `breezeqa01`（设备角标 / 收藏移除）均为本轮新建测试号，不代表真实用户；演示沙箱下的 0 订单 / 0 地址 / 空收藏属环境限制，不是应用缺陷。
- 角标取证口径：3 件 / 2 件 / 0 件为真机真实加购（`breezeqa01`，`badge-device-*.png`）；`99+` 仍为 dev 会话 store 单例注入渲染（128），未在设备构造；早期 `badge-3.png` / `badge-3-me.png` / `badge-99plus.png` 为注入渲染基线，保留对照。
- 危险色改前 `confirmColor: '#C0392B'` 行内红被压成品牌青 `rgb(15,157,143)` 为复刻旧调用取证；真机改后危险红 `rgb(179,55,42)`（明 `#b3372a`）；深色 `rgb(226,105,92)`（`#e2695c`）仅 dev 渲染取证、未真机实测；普通确认仍品牌青。
- 并行线改动（README、`index.html`、`docs/android-build.md`、`docs/37-brand-logo-font-audit-2026-11-21.md`、`docs/38-mall-list-render-fix-2026-11-21.md`）不属本轮 Android / 交易收口。**归属提醒**：`2dce26b` 提交信息只写骨架屏修复，实际把 ⑥ 的 `stores/cart-badge.ts` 与 `mall/index.vue` 角标改动一并扫入；docs/37（品牌标志线，在途）、docs/38（已随 `ac5a769` 入库）编号被并行线占用，本轮只更新 docs/36。

---

## 12. 本轮收口记录（①–⑧，2026-11-21）

| 编号 | 项 | 收口前状态 | 收口后实证 | 证据 |
| --- | --- | --- | --- | --- |
| ① | 系统 uimode 切深浅，壳桥原生自报（第一轮问题 #1，已关闭） | WebView 不派发 matchMedia `change`，壳层靠 `resolveNight()` 回落系统 uiMode 猜栏图标 | **修掉的是壳层依赖**：`onConfigurationChanged` 比对 `UI_MODE_NIGHT_MASK` 后主动经桥推 `dark/light`，`webTheme` 由自报值驱动系统栏图标；manual 偏好不被系统覆盖；`resolveNight()` 仅 `webTheme=null` 首帧兜底。**页面配色自动跟随仍按契约由 CSS `@media (prefers-color-scheme: dark)` 承担**（`auto` 通道本就是媒体查询，设计如此），不是壳推送驱动换肤；深色 body `rgb(18,23,22)`、浅色 `rgb(244,244,241)`。终版包双向 logcat：`10:58:05.820 dark（系统 uiMode 原生推送）`、`10:58:08.013 light（…原生推送）`。原生写入的 `data-mx-system-theme` 全仓库无消费方，列 §7.8 可选清理 | DEVICE-CLOSEOUT §①；ACCEPTANCE 10.5 / 10.6；`logcat-uimode-round4.txt`、`uimode-dark-page.png` / `uimode-light-page.png`、`after-final-dark.png`；`theme.ts:5-7,18-19`；`MainActivity.java` 85–97、156–159、413–426、434–453、455–460、474–477、826–833 |
| ② | 真实订单落库 / 扣库存 / 幂等 | 无测试账号，演示态只出 `DEMO-` 预览单 | 本地 `MALL_DEMO_MODE=off`：注册 `probeuser01` → 下单 `MOMWQ8XI9N424065`（`MO` 前缀）→ 落库 `orders=1 / order_items=1`（8900×2=17800）→ 库存 `mix-p-1003` 210→208 → 幂等重放同单未重复扣 → 购物车清空；支付流水 1 条 `pending / mode=dev / payload.mock=true`，无交易号。演示态对照：`DEMO-` 单、`demo=true`、订单列表空、购物车保留、库内未变 | report-trade-chain.md §3 / §4；`trade-probe/00-28-*`、`api-real.log` / `api-demo.log` |
| ③ | 三键导航 + 挖孔屏 | AVD 手势导航、无挖孔；`navigation_mode=0` 模拟器不生效 | 三键走 overlay `navbar.threebutton`：`--mx-safe-bottom=126px`、top 63、right 0，Tab 未被压；新建 `Pixel7_API37`（pixel_7）：cutout insets `Rect(0,136-0,0)`、boundingRect `Rect(480,0-625,136)`，`--mx-safe-top=136px`，头部避让 | DEVICE-CLOSEOUT §③；`nav3-home.png`、`cutout-home.png` |
| ④ | CORS 壳源白名单 | 未确认；担心真机壳内接口 / 图片被浏览器层拒收 | 已放行（实测）：`OPTIONS https://localhost` 204 + `GET 200`，回显 `ACAO: https://localhost`、`ACAC: true`；`capacitor://localhost`、`http://localhost` 同样放行；`https://evil.example.com` 无 ACAO 被拒；预检 `ACAM: GET,HEAD,PUT,PATCH,POST,DELETE`、`ACAH: authorization,content-type`、`max-age 86400`、`vary: Origin`；媒体域 `img.mixm.top` 全 Origin `ACAO: *`。判据为响应头；未在真实 WebView 内做浏览器层复测，设备侧首页 / 商城可取真实数据作旁证 | report-cors.md §3.1–3.3；`cors-probe/`；`config.ts:50-62` / `:453-464`、`app.ts:81-86`、`infra/nginx/img.mixm.top.conf:28-41` |
| ⑤ | 按压态 / 空态 / 骨架屏逐帧设备截图 | 仅源码 / 预览证据，缺设备目视背书 | 按压 DOWN `is-press card` opacity 0.7，UP `card` opacity 1；空态关键词 `zzz999noexist` 0 卡片；骨架屏常驻 CDP 限速 3000ms 抓到 `sk=16 / 4` 张，返回后无骨架与商品混排 | DEVICE-CLOSEOUT §⑤；`press-down.png` / `press-up.png` / `empty-state.png` / `skeleton-loading.png`；`skeleton-capture.mjs` |
| ⑥ | 购物车角标全局计数 | 无全局计数数据源，头部 / Tab / 我的行不显示角标 | 新增 `stores/cart-badge.ts`（`cartCount` / `cartBadgeText`：0 隐藏、1–99 数字、≥100 `99+` / `applyTabBadge` / `syncCartBadge` / `refreshCartBadge` / `clearCartBadge`）；首页头部、Tab（index 2）、我的页三处挂接；`App.vue` 将 `.uni-tabbar__badge` 覆盖为品牌底；来源 `CartDto.totalQuantity`。**真机真实加购**（`breezeqa01`，点「+」）：3 件 → 接口 / 头部 / Tab / 我的行均 3；减 1 → 均 2；0 件 → 头部与 Tab 隐藏。限制：详情页加购、车页内改量 / 移除当帧未即时同步（靠 `onShow` 对齐）；`99+` 未真机构造；会话由接口直连签发；小程序 / 鸿蒙仅构建核对 | ACCEPTANCE 10.3；`badge-device-3.png` / `badge-device-3-tab.png` / `badge-device-3-me.png` / `badge-device-2.png` / `badge-device-2-me.png` / `badge-device-0.png`；report-cart-badge.md §二 / §三 / §六；注入基线 `badge-0/3/3-me/99plus/dark.png` |
| ⑦ | 危险操作确认红色 | `theme.scss:245-247` 主按钮 `!important` 压品牌青，`confirmColor` 行内红失效 | 方案 B（显式危险态类）：`--mx-danger` 明 `#b3372a` 6.01:1 / 深 `#e2695c` 5.22:1（均 AA）；危险选择器 258–264；`uni.scss:25` `$danger`；新增 `modal.ts` `showDangerModal`；挂接订单取消、移除收藏、清空收藏夹；普通确认仍品牌青。**真机取证**：收藏移除弹窗根节点 `uni-modal mx-modal--danger`，主按钮「移除」`rgb(179,55,42)`、Cancel `rgb(51,58,55)`，关窗后危险类摘除。未覆盖：深色令牌 `#e2695c` 未真机实测；订单取消路径未触发（0 订单 / 0 地址，未构造冒充）；范围外 6 处弹窗未接，清单见 §7.3 | ACCEPTANCE 10.4；`danger-device.png`；report-danger-color.md §3–§7；dev 基线 `danger-before.png` / `danger-after.png` / `danger-normal-confirm.png` / `danger-after-dark.png` |
| ⑧ | 终版两包全量重建与指纹 | 前轮 release 未重出、包体哈希 / 签名结论待回填 | 终版全量重建 debug / release 均 `BUILD SUCCESSFUL`；debug 4,736,066 B、包体 SHA-256 `955E75F8…FB33`，卸载旧包后装机、`DEBUGGABLE` 在位；release 3,526,555 B、包体 SHA-256 `1B9A872B…E272D`，`apksigner verify` 通过，包内 `cart-badge.DOPMeSER.js` 470 B / `modal.DpW-IuuU.js` 494 B / `version.DOIV2F3S.js` 32 B；release 本轮未重装设备。终版冷启动 COLD 1432ms / WaitTime 1434ms，pid 5885 | ACCEPTANCE 2.2 / 10.1 / 10.2；§3.2 指纹表；`gate-build-debug-round4.log`、`gate-build-release-round4.log` |

### 12.1 本轮门禁（编排线记录）

`pnpm lint` ✓、`pnpm --filter @mixmapp/app typecheck` ✓（ACCEPTANCE 10.1，`gate-lint-round4.log`、`gate-typecheck-round4.log`）；壳产物体检通过（`gate-check-round4.log`）；`build:h5` / debug / release 本地构建 `BUILD SUCCESSFUL`（`gate-build-h5-round4.log`、`gate-build-debug-round4.log`、`gate-build-release-round4.log`）。`pnpm verify` 全绿（规则 / 类型 / 测试 / API 构建 / H5 构建，约 80.6s）为编排线本轮记录；验证轮次独立日志未留存在 `ui-review/`，verify 结论以该记录为准。
