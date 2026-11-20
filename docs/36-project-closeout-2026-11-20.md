# 36 · 项目收尾报告：MixmAPP 当前状态一览（2026-11-20 / 21）

- 日期：2026-11-20 首轮验收 / 第二轮补测；2026-11-21 第三轮复验（Asia/Shanghai）
- 仓库根：`F:\合并项目\MixmAPP`　分支：`main`　本地 HEAD：`a97b30f`
- 读者口径：只看本文件即可判断项目处于什么状态、能跑什么、不能跑什么、下一步先做什么；所有结论挂第一手证据，拿不到证据的项如实标「未取到」。
- 第一手证据：
  - 终验矩阵（含三轮补测，最新口径）：`ui-review/android-2026-11-20/ACCEPTANCE.md`
  - 生产复核：`ui-review/android-2026-11-20/PROD-VERIFY.md`
  - 全项目横切盘点与 CI：`ui-review/android-2026-11-20/inventory-PROJECT-INVENTORY.md`（任务口径中的 PROJECT-INVENTORY.md）
  - Android 专项说明：`docs/35-android-app-refresh-2026-11-20.md`（首轮口径，部分子项已被后续补测更新，见 §11）
- 版本口径：`version.json` `version=0.0.2` / `channel=release` / `released=[0.0.1]`；Android badging `versionName=0.0.2` / `versionCode=3`。

---

## 1. 仓库当前坐标

### 1.1 提交序列（`git log --oneline -6`）

| 提交 | 说明 | 状态 |
| --- | --- | --- |
| `本次 docs 提交` | `docs/35`（Android 改造说明）+ `docs/36`（本报告）入库 | **仅本地，未推送，无 CI 结果** |
| `a97b30f` | 壳层下拉刷新（SwipeRefreshLayout 形态，跨端不依赖 DOM） | **仅本地，未推送，无 CI 结果** |
| `c4a54b6` | 首页入口与区块标题收口（订单字形去底色块、区块标题中和全局渐变） | **仅本地，未推送，无 CI 结果** |
| `dad08f9` | 提交信息写「管理后台纳入正式包并加深藏入口，闭环头像上传本地回退」；**本次 Android 改造的多数文件被这个信息与内容不符的外部提交一并扫入**（壳层契约、原生壳、首页重排、13 个业务页） | 已推送；三条 CI 绿均对应该提交 |
| `d4a30ef` | 智能助手对话页、待支付发起骨架与地址定位填充 | 已推送 |

- 远端：`origin https://github.com/afdk1991/MixmAPP.git`（`git remote -v`）；`git status -sb` 显示 `## main...origin/main [ahead 3]`，即 `c4a54b6`、`a97b30f`、`本次 docs 提交` 三个提交未进远端。
- 工作树：干净，无源码改动（`git status --short` 无输出）。
- 混入提醒：`dad08f9` 的提交信息不能作为回滚或摘选的判断依据，文件归属以 §9 清单为准。

### 1.2 一句话状态

线上 H5 / API / 媒体域在跑且与 CI 产物逐字节一致；Android 端在 AVD 三轮验收后主体可用（冷启动、安全区、导航、深色、键盘避让、下拉刷新、离线重试、演示单闭环均有设备证据）；真实交易链路、小程序 / 鸿蒙发布、外部资质与若干设备形态仍是缺口；最新两个本地提交尚未被 CI 覆盖。

---

## 2. 本次交付改动摘要（五层）

| 层 | 一句话 | 关键文件 | 证据指针 |
| --- | --- | --- | --- |
| 壳层契约与安全区 | 冻结原生壳 ↔ Web 的唯一接口：四个 `--mx-safe-*` / `--mx-ime-bottom` 变量，无壳时回落 `env()` → 0 | `docs/34-android-app-shell-spec.md`；`apps/app/src/styles/app-shell.scss`；`apps/app/src/styles/theme.scss`；`apps/app/src/App.vue` | docs/35 §3.1；ACCEPTANCE §四 A/B |
| 原生壳 | insets / 主题 / 键盘高度由原生下发 CSS 变量；系统栏图标按页面主题解析；移除旧 margin 双重留白方案 | `apps/mobile/android/app/src/main/java/top/mixm/app/MainActivity.java`；`apps/mobile/android/app/src/main/res/values/colors.xml` | docs/35 §3.2；ACCEPTANCE #1 |
| 首页信息架构与导航 | 整屏营销 hero 改为 头部行 → 搜索 → 4 宫格 → 通行证卡 → 运营位 / 分类 / 列表；Tab 四项短文案、12px；二级页统一返回槽 + 中文标题 | `apps/app/src/pages/index/index.vue`；`apps/app/src/pages.json`；`apps/app/src/navigation.ts`；`apps/app/src/components/mx-bar/mx-bar.vue` | docs/35 §3.3；ACCEPTANCE A/C |
| 业务页交互与深色 | 13 个业务页收口安全区 / 吸附条 / 按压 / 三态 / 键盘避让 / 窄屏收缩 / 深色令牌，补二级页中文标题 | `apps/app/src/pages/{auth,mall,cart,orders,me,legal,settings,assistant,research}/**` | docs/35 §3.4；`pages-c-line-report.md` §2 |
| 下拉刷新（第三轮） | uni 自带下拉在「自定义导航栏 + Capacitor WebView」下不可靠，改为去 DOM 化壳层组件，流式推位 + 52px 旋转空隙，首页 / 商城接入 | `apps/app/src/components/mx-pull-refresh/mx-pull-refresh.vue`；`apps/app/src/pages/index/index.vue`；`apps/app/src/pages/mall/index.vue`；`apps/app/src/pages.json`（两页 `enablePullDownRefresh=false`） | ACCEPTANCE §九 9.2；#6 |

---

## 3. 验收总表（A–H，以 ACCEPTANCE.md 最新状态为准）

| 条目 | 口径 | 最新结论 | 关键证据 |
| --- | --- | --- | --- |
| A 冷启动首屏 | 3 秒内出首页、Tab 常驻、不压状态栏、无整屏海报 hero | **通过** | COLD `TotalTime 1654ms`（首轮）；第三轮回归 `2761ms`；`after-final-coldstart.png`、`after-final-home.png`、`after-final-home-scroll.png`；`--mx-safe-top/bottom=63px` |
| B 系统栏与手势 | 浅 / 深 / edge-to-edge / 手势导航不被遮挡，栏图标明暗自适应 | **通过**（残留观察项见 §7.1） | 浅色 `after-final-home-light-statusbar.png`；深色 `after-final-home-dark.png` / `after-final-home-dark-statusbar.png`；手动深浅双向 `after-final-manual-dark-*.png` / `after-final-manual-light-*.png`；Tab 121px = 58 + 63 无重复叠加 |
| C 导航模型 | Tab 文案 ≤4 字、选中态清晰、逐级回退、根页双击退出有提示、二级页不丢 Tab 上下文 | **通过** | 文案 `首页/商城/购物车/通行证`；`after-final-mall.png`、`after-final-pass.png`、`after-final-product-detail.png`、`after-final-about.png`、`after-final-privacy.png`；双击退出 `after-final-back-first.png` / `after-final-back-exit.png`，实现 `MainActivity.java:686-737` |
| D 原生手感 | 惯性滚动、下拉刷新、按压反馈、键盘不遮输入、Toast / 加载 / 空 / 错态齐备、无白闪 | **部分通过** | 惯性滚动、键盘避让（`--mx-ime-bottom=883px`）、下拉刷新三态、离线错误态 + 重试通过；**按压态逐帧、空态列表、骨架屏加载态仍缺设备截图**（源码齐备）。证据 `after-final-keyboard-ime.png`、`after-final-pull-home-*.png`、`after-final-pull-mall-*.png`、`after-final-offline-mall.png`、`after-final-online-reload.png` |
| E 功能完整 | 登录注册 / 商城 / 详情 / 购物车 / 下单 / 订单 / 通行证 / 关于隐私 / 深色 / 离线重试可走通，无横向溢出、320px 不破版 | **部分通过** | 游客态 + 演示沙箱内闭环走通；**真实订单落库 / 扣库存 / 支付、收藏夹登录态复测未覆盖**。证据 `after-final-flow-*.png`（注册 `breezez9y1` → 加购 ¥0.09 → 演示单 `DEMO-MWP4MRFP931969` → 重新登录 → 订单空态）；320px `after-final-narrow-home/mall/register.png` |
| F 出包与验收 | debug / release 均出 APK，装机启动无 FATAL，截图留证 | **通过** | debug 4,735,893 B 装机冒烟 10/10；release 3,523,583 B，`apksigner verify` 通过，第二轮装机冷启动 COLD `1370ms`、logcat 零 FATAL（`after-final-release-coldstart.png`、`after-final-release-logcat.txt`）；第三轮重出含 `a97b30f` 刷新组件 |
| G 不回归 | H5 / 小程序 / 鸿蒙构建不受影响，未改 API 协议与域名（只认 mixm.top） | **通过** | `gate-build-h5.log` / `gate-build-mp-weixin.log` / `gate-build-harmony.log` 均 exit 0；`gate-domains.log` 通过；`verify` 169 passed / 8 skipped；小程序 / 鸿蒙仅到构建产物，未在各自运行时预览 |
| H 中文说明 | 中文文档在位、证据可被引用 | **通过（证据在位）** | `docs/` 中文 Markdown 在位；本目录留存门禁日志、APK 签名、设备截图、logcat 与终验矩阵 |

### 3.1 补测改判记录（首轮 → 最新）

| 子项 | 首轮口径 | 最新口径 | 轮次 / 证据 |
| --- | --- | --- | --- |
| 双击退出（C） | 未新鲜复现，存疑 | **通过**：冷启动根路由 `history.length=1`，首次返回 Toast「再按一次退出」，2s 内二次返回回启动器 | 第二轮，`after-final-back-first.png` / `after-final-back-exit.png` |
| release 装机（F） | 未装机，运行期未实测 | **通过**：卸载 debug → 装 release，COLD 1370ms，零 FATAL，测完装回 debug | 第二轮，`after-final-release-coldstart.png` / `after-final-release-logcat.txt` |
| 离线重试（D） | 仅源码证据 | **通过**：飞行模式错误态 + 重试无崩溃，恢复网络重载 20 件 | 第二轮，`after-final-offline-mall.png` / `after-final-online-reload.png` |
| 手动深浅跟随（B） | 存疑：手动路径未测 | **通过**：App 内切深色桥报 `dark`、图标转白；切浅色桥报 `light`、图标转回 | 第二轮，`after-final-manual-*.png` |
| 320px 窄屏（E） | 仅 H5 预览 | **通过**：320 CSS px 首页 / 商城 / 注册 `scrollWidth=innerWidth=320` | 第二轮，`after-final-narrow-*.png` |
| 登录到演示单（E） | 无测试账号，未走通 | **演示沙箱内走通**：注册 → 登录 → 加购 → 结算 → 演示预览单；真实落库仍未覆盖 | 第二轮，`after-final-flow-*.png` |
| 下拉刷新（D） | uni 自带回调未唤起 | **通过**：壳层组件三态齐全，真实请求发出（首页资源 27→32、商城 API 12→14），7 条回调 logcat | 第三轮，`after-final-pull-home-*.png` / `after-final-pull-mall-*.png` / `after-final-pull-logcat.txt` |

---

## 4. 全项目 11 面浓缩清单

完整逐面证据见 `inventory-PROJECT-INVENTORY.md` §2.1–2.11；本表只给结论与指针。

| # | 面 | 结论 | 一句话依据 | 证据指针 |
| --- | --- | --- | --- | --- |
| 1 | API | **已完成** | `/healthz` `/readyz` `/meta` 均 200，meta 回包 version 0.0.2 / env production；路由与版本标记就位 | inventory §2.1；`prod-healthz-anon.body` / `prod-meta.body` |
| 2 | H5 | **已完成** | 本地与 CI 构建通过；`mixm.top` / `www.mixm.top` / `cloud.mixm.top` 三入口 200，注入 API / 媒体绝对基址 | inventory §2.2；`gate-build-h5.log` |
| 3 | Android | **部分完成**（终验口径见 §3） | debug 出包 + AVD 冒烟 10/10 + 壳层改造闭环；release 已装机冷启动；按压 / 空态 / 骨架屏逐帧证据、三键 / 挖孔屏、CORS 仍缺 | inventory §2.3（部分缺口已被二 / 三轮更新，以 §3 为准）；ACCEPTANCE 全文 |
| 4 | mp-weixin | **未完成** | 构建通过、产物齐全；appid 仍 `touristappid`，未发布后台，上传 / 收银台 live / 地图选点未接 | inventory §2.4；`gate-build-mp-weixin.log` |
| 5 | 鸿蒙 | **未完成** | `build:harmony` 编译产物存在；本机无 DevEco / 模拟器 / 真机，设备验证未做 | inventory §2.5；`gate-build-harmony.log` |
| 6 | 管理后台 | **已完成** | 后台页 + 5 连击深藏入口 + 后端 `x-admin-token` 守卫就位；未带令牌 `/admin/*` 404 为预期回退 | inventory §2.6；PROD-VERIFY §3 |
| 7 | 支付与 OAuth 回退态 | **已完成** | 未接商户时订单走 dev/mock 占位不扣款；OAuth 未配置不下发按钮、直打 503 `PROVIDER_DISABLED`；本地账号路径可用 | inventory §2.7；`services/api/src/modules/pay.ts`、`routes/oauth.ts` |
| 8 | 存储与上传 | **已完成** | 本地存储 + 签名 PUT 上传 + 目录穿越兜底就位；S3 适配器在但未配置（线上 `storage=local`） | inventory §2.8；PROD-VERIFY §4 |
| 9 | CI 与部署 | **已完成** | 三条流水线最近绿；`atomic-release.sh` 切 symlink + 健康检查失败自动回滚；`rollback.sh` 可回退 N 版；目录数据包 CI 内缺失，走开发机直送 | inventory §2.9；§6 下文 |
| 10 | 文档与版本一致性 | **已完成（附观察项）** | version.json ↔ README ↔ 各包 ↔ version.ts / manifest / `.env.example` / config 默认值均 0.0.2 / versionCode 3；编号 22 归档空缺，35 / 36 号文档已随 `本次 docs 提交` 入库 | inventory §2.10；`docs/19-versioning.md` |
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
| 6 | API release `20261120222507` 在跑 | **成立** | `current → releases/20261120222507`，systemd 22:25:08 CST 启动；healthz / readyz / meta 均 200；编号不在公开 API 字段，直接证据为服务端软链（`prod-release-ssh.txt`） |

### 5.1 本地构建 ≠ 线上包：产物批次差异，不是部署不一致

- **事实**：线上部署包与 CI 产物内嵌 H5 四 chunk 逐字节一致；本地 `apps/app/dist/build/h5` 是另一次构建，chunk 名与哈希都不同（PROD-VERIFY §1、§5、结论汇总表第 1 / 5 项）。
- **口径**：这是「本地重建集 vs CI / 线上集」的构建产物批次差异，**既不是部署不一致，也不能宣称本地包已与线上对齐**；本机 `build/outputs/apk/debug/app-debug.apk` 内嵌的是本地重建 chunk 集，与线上不一致（PROD-VERIFY §5 本地磁盘对照项）。
- 取证期间本地 dist 还被并发验收线第三次重建过，当前 dist 为未与线上比对过的新哈希（PROD-VERIFY §未能取证 3）。

---

## 6. CI 现状

### 6.1 三条流水线（最近一次运行均在 `dad08f9`，inventory §0.2）

| 流水线 | 工作流 | 结论 | Run ID | 关键步骤 |
| --- | --- | --- | --- | --- |
| ci | `.github/workflows/ci.yml` | **绿** | 44752373151（≈87s） | 18 步全 success：版本一致性、域名一致性、lint、typecheck、迁移、单测、PG 集成、API / H5 构建、健康检查、小程序构建 |
| deploy | `.github/workflows/deploy.yml` | **绿** | 44752372961（≈5m35s） | 构建发布包 success；API + H5 原子发布 success（SSH 凭据就绪，真实发布到腾讯云）；**商品数据相关 3 步 skipped**（`DEPLOY_CATALOG != 1`，目录验收未开） |
| Android debug APK | `.github/workflows/android.yml` | **绿（debug 产物）** | 44752372990（≈103s） | debug APK 构建 + 上传 artifact success；**Decode keystore / Assemble release AAB / Upload AAB skipped**（`HAS_SIGNING != true`，未配签名 Secrets）；`Warn when unsigned` success |

### 6.2 未取到 / 无 CI 结果的部分

- **Gitee 流水线：未取到。** 仓内 git remote 只有 GitHub（`git remote -v`），无 gitee remote；本机无 gitee CLI；仅有静态定义 `.gitee/pipeline.yml`。无仓库地址 / 凭据 / CLI，不据此判红或绿（inventory §0.4）。
- **`c4a54b6`、`a97b30f`、`本次 docs 提交` 三个本地提交无 CI 结果**：尚未推送 `origin/main`，Actions 不会为未推送提交产生 run；上述绿结论全部停在 `dad08f9`。`docs/35`、`docs/36` 已随 `本次 docs 提交` 入库，但同样未进远端。
- 小程序 / 鸿蒙仅到构建产物，无各自运行时预览环境（inventory §2.4 / §2.5）。

---

## 7. 仍开放的问题（按影响面排序）

每条给文件 / 行号、触发条件、影响、建议下一步。编号沿用 ACCEPTANCE 第五节。

### 7.1 系统 uimode 切深色时 matchMedia 未向壳桥上报（#1，残留观察项）

- 文件：`apps/mobile/android/app/src/main/java/top/mixm/app/MainActivity.java` —— `THEME_OBSERVER_JS` 85–97 行（90 行 matchMedia 取值、95–96 行 change 监听）、`applyWebTheme` 402–406 行、`resolveNight` 408–412 行。
- 触发条件：`adb shell cmd uimode night yes` 切系统深浅；WebView 不派发 matchMedia `change` 时，`webTheme` 不置 dark。
- 影响：系统深浅切换时栏图标明暗依赖 `resolveNight()` 回落系统 uiMode 兜底；本次目视正确，但页面手动主题与系统深浅不一致时存在不跟随风险。**手动 `data-mx-theme` 属性变更路径经 MutationObserver 上报正常**（第二轮已取证），残留仅限系统 uimode 这条 matchMedia 路径。
- 下一步：壳 / 前端线复核观察者监听与 WebView 主题派发时机；系统深浅与手动偏好不一致时单独取证。

### 7.2 真实订单落库 / 扣库存 / 支付与收藏夹受 demoMode 沙箱限制（#3）

- 文件：`apps/app/src/api/client.ts:499-514`（`MALL_DEMO_MODE`，`order.demo=true` 时不跳「我的订单」、不清购物车）；`apps/app/src/pages/cart/index.vue:1007-1016`。
- 触发条件：当前环境后端 `mall.demoMode=true`（`prod-meta.body`）；提交订单只生成演示预览单 `DEMO-*`。
- 影响：真实订单落库、库存扣减、支付链路与收藏夹登录态未在设备复测；订单列表为空属沙箱设计行为，非缺陷。
- 下一步：备沙箱账号在非 demoMode 环境（或后端测试环境）走加购 → 下单 → 订单 → 收藏 → 扣减全链路；收藏夹登录态补一轮设备取证。

### 7.3 三键导航与挖孔屏未实测（#4）

- 触发条件：三键导航机型 / 挖孔屏机型；AVD 为手势导航、无挖孔，SDK 37 模拟器切 `navigation_mode=0` 未生效。
- 影响：`--mx-safe-bottom` 三键下应取导航栏高度、`displayCutout` 已并入 top / right，但底部与左右安全区缺目视证据。
- 下一步：找三键真机 / 挖孔屏机型复核底部栏与左右留白。

### 7.4 服务端 CORS 白名单未确认（#8）

- 触发条件：壳 origin `https://localhost`，真机壳内请求 `https://api.mixm.top/...` 与媒体域属跨域；`/healthz` 200 探活不代表跨域放行。
- 影响：若白名单未含 `https://localhost` 及各托管域名，真机壳内接口 / 图片可能被浏览器层拒收。
- 下一步：服务端侧核对 API / 媒体域 CORS 白名单；断网 / 跨域失败路径在设备上复现一次。

### 7.5 购物车角标缺全局计数数据源

- 触发条件：登录态加购后需要头部 / Tab 角标反映购物车数量。
- 影响：当前头部右侧购物车位与 Tab 角标无全局计数来源，不显示角标；属功能缺口，非排版缺陷。
- 下一步：确认会话态购物车计数接口与全局 store 订阅，再接头部 / Tab 角标。证据指针：`docs/35-android-app-refresh-2026-11-20.md` §5.6。

### 7.6 危险操作红色令牌被主按钮 `!important` 覆盖

- 文件：`apps/app/src/styles/theme.scss:245-247`，`.uni-modal__btn_primary` 用 `!important` 强制品牌色，页面传入的 `confirmColor` 行内样式被压掉。
- 触发条件：任何调用 `uni.showModal` 做删除 / 取消 / 清空的场景（订单取消、收藏移除、清空收藏夹）。
- 影响：设计上的危险确认红色全局丢失；C 线已移除三处无效 `confirmColor: '#C0392B'` 避免裸色值过 lint。
- 下一步：主题 / 组件线补一套令牌化危险态 modal 样式，再由各页面挂接。

### 7.7 按压态 / 空态 / 骨架屏缺逐帧设备截图

- 文件：源码齐备于 `apps/app/src/pages/mall/index.vue:97-105`（骨架屏）、`:115-121`（空态）、`:108-113`（错误态）；卡片按压 `hover-class="is-press"`（如 `mall/index.vue:146`）。
- 触发条件：需设备逐帧取证时；本次设备截图只覆盖正常态、键盘态、离线错误态与刷新态。
- 影响：D 条相关子项为源码 / 既有预览证据，缺设备目视背书。
- 下一步：在 AVD 补抓按压态、空列表、骨架屏加载态逐帧截图。

---

## 8. 历史阻塞（外部门槛，非代码缺口）

归属与政策摘录见 `docs/33` §3.5、inventory §2.11、`docs/29` §5、`docs/24`。

### 8.1 B 类：需个体工商户 / 企业资质（纯个人不可闭环）

- 微信支付商户：普通商户主体限个体工商户 / 企业 / 组织；纯个人只能经服务商进件小微 / 个人卖家（经营满 6 个月、累计收入超 20 万元），无法自助开普通商户号。
- 支付宝收单：手机网站支付需营业执照且 ICP 备案主体与账号一致；无执照收款额度受限（单笔 ≤2000、单日 ≤20000）。
- 国内短信：个人认证无法通过签名实名制报备；一键登录 / 本机号码认证需运营商企业商务签约；企业微信 / 钉钉 / 飞书登录需企业组织主体；微信扫码 / 公众号授权需开发者资质认证或已认证服务号。

### 8.2 C 类：数据 / 并行线阻塞（编号沿用 docs/33 §3.5-C）

- **#34**：hznzcn 女装迁移线整目录隔离未入库（`.gitignore:41-43`），待并行会话收口后评估源码入库与生产导入。
- **#35**：无图商品约 3,817 个待补图，需原图包 / 图库授权；离线补图脚本已入库可重跑。
- 说明：仓库全文检索未发现独立编号 **#33** 的阻塞条目；本节准入矩阵口径来自 `docs/33` §3.5（即任务口径所指 #33），#34 / #35 为该文件内显式编号。

### 8.3 其余平台侧门槛

- 微信小程序：AppID 为空（`touristappid`），MP 后台合法域名待配。
- 鸿蒙：DevEco Studio 账号、签名、工具链与设备 / 模拟器缺失。
- Android 上架：release 签名 Secrets 未配进 CI，应用商店渠道未接。
- 备案：`mixm.top` 根域已备案；支付回调主体备案与账号一致为支付宝前置条件。
- CloudBase 云 PG 连接串、商品原图包 / 高清图库授权、AI 生成额度：平台侧资源，本地无法闭环。
- A 类个人可自助渠道（GitHub / Gitee / Google / Facebook / 微博 / 抖音 / 华为 / QQ / Apple OAuth、高德 Key、AI Key、S3、推送）适配器完整、非阻塞，填 Key 落 env 即从 dev/off 转 live。

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

- `c4a54b6`（首页视觉收尾）、`a97b30f`（下拉刷新组件）是单一目的提交，可单独 revert：

```powershell
git revert --no-commit a97b30f   # 仅撤壳层下拉刷新
git revert --no-commit c4a54b6    # 仅撤首页入口 / 标题收口
```

- 注意：`dad08f9` 之后 `c4a54b6` / `a97b30f` 又改过 `index/index.vue`、`mall/index.vue` 等文件，整包 revert 可能冲突，按 9.2 文件清单手工取舍。

### 9.2 按文件粒度（只撤 Android 改造，保留并行线功能）

回滚基线为 `d4a30ef`（`dad08f9` 之前；`dad08f9` 本身仍含 Android 改动，不能作为基线）。Android 改造相关 20 个文件清单见 `docs/35` §6.1，命令形式：

```powershell
git checkout d4a30ef -- <docs/35 §6.1 清单中的文件>
```

混合文件（同时含 Android 适配与并行线功能，不能整文件 checkout，需手工拆 hunk）：`pages/me/index.vue`、`pages/settings/about.vue`、`api/client.ts`、`App.vue`；并行线混入、回滚 Android 时不要动：`apps/app/scripts/build.mjs`、`packages/contracts/src/index.ts`。

---

## 10. 下一步建议（按投入产出排序，最多 5 条）

1. **推送本地三个提交并重跑三条 CI。** `c4a54b6`、`a97b30f`、`本次 docs 提交` 尚未进 `origin/main`，所有绿结论停在 `dad08f9`；不推送则后续 Android / H5 验收与线上包可能基于未覆盖 CI 的代码。推送后确认 ci / deploy / Android 三条 run 转绿。
2. **闭环生产商品目录与数据口径。** 线上 meta `demoMode=true / catalogSource.productCount=0`，而 `/mall/categories` 返回上万计数；目录数据包在 CI 内被 gitignore 排除、走开发机直送，deploy 目录验收三步 skipped。需核对 DB 目录源与文件源口径，补齐 catalog 数据包落位与增强验收，避免长期演示态。
3. **补齐 Android 残留设备证据与服务端确认。** 配 CI 签名 Secrets 出 release AAB；补按压态 / 空态 / 骨架屏逐帧截图；三键导航 / 挖孔屏真机复核；确认壳 origin `https://localhost` 在服务端 CORS 白名单；复核 matchMedia 系统深色上报路径。
4. **推进真实交易与登录后闭环。** 备沙箱账号在非 demoMode 环境走加购 → 下单 → 订单 → 收藏 → 库存扣减；收藏夹登录态复测；同步推进 B 类资质（支付 / 短信 / 企业系 OAuth）与 A 类自助渠道填 Key 转 live。
5. **补齐小程序与鸿蒙发布就绪度。** 小程序注册 AppID、配 MP 后台合法域名；鸿蒙引入 DevEco 工具链，至少完成编译到预览器 / 模拟器的设备侧验证。两端当前均为「只构建、未发布 / 未验证」。

---

## 11. 证据口径与出入备注

- 本文件终验结论以 `ACCEPTANCE.md` 第三轮最新状态为准；`docs/35` 为首轮写作口径，其 §4 中 F「release 未装机 / 部分通过」、§5 中双击退出未复现、320px 未实测、离线重试缺证据、手动深色存疑、下拉刷新未唤起等条目，已在第二 / 三轮闭环或改判，详见 §3.1。
- `inventory-PROJECT-INVENTORY.md` §2.3 的 Android 缺口清单写于 `c4a54b6` 时点，早于第二 / 三轮补测；其中 release 装机、双击退出、320px、离线重试、手动深浅、下拉刷新等子项已被 ACCEPTANCE 更新覆盖，未闭环项以 §7 为准。
- 多批次 APK 体积数字不混用：A 线报告 debug 4,735,371 B / release 3,496,849 B（首轮）；PROD-VERIFY §5 本地 debug 4,735,704 B；第三轮重出 debug 4,735,893 B / release 3,523,583 B（ACCEPTANCE §2.2）。
- 启动耗时为不同次运行：首轮冷启动 1654ms、冒烟 2315ms；release 冷启动 1370ms；第三轮冷启动 2761ms。
- PROD-VERIFY §1 本地 dist 两个快照 chunk 名已被 23:45 并发构建第三次轮换；当前本地 dist 哈希未与线上比对，不据此判断线上版本新旧。
