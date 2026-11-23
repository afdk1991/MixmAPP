# 43 · 全项目闭环审计（2026-11-23）

> 审计对象：`F:\合并项目\MixmAPP`（main 分支，HEAD `df6e6a6`，功能提交 `83ca179`）
> 审计口径：**只认实际读到的文件行号、命令输出、接口状态码**。不采信文档承诺，也不采信上一轮复核结论——上一轮的结论在本轮被修正两处（§5.2、§11）。
> 审计方式：按 12 个维度分 5 条线并行执行（API / 前端与后台 / Android / CI 与部署 / 文档），主控线负责仓库清点、网络实测、门禁复跑与合并。
> 证据落盘：`ui-review/audit-2026-11-23/{api,frontend,android,ci,docs,repo}/`（被 `.gitignore:53` 排除，不入库，见 §5.11）。
> 本轮**未改任何功能代码**，只新增本文档。

---

## 1. 结论速览

| 档位 | 模块数 | 占比 |
|---|---:|---:|
| 已闭环（有可复跑的端到端证据） | 6 | 27% |
| 部分闭环（主链路在，但有明确缺口） | 11 | 50% |
| 未闭环（用户能看到假功能，或关键能力不存在） | 5 | 23% |

**一句实话：整体达不到"全部闭环"。** 差距集中在四类，都不是"再补个文档"能解决的：

1. **交易链路断在最后一米**：支付回调只回写 `payments` 表，`payments` 连 `orders` 的外键都没有，订单永远停在 `pending`；端侧支付 SDK 也没接（`orders/index.vue:220-229` 的 live 分支只提示"待端侧支付 SDK 调起"）。**用户能下单、能"付款"、但订单状态永远不变**——这是最严重的一条。
2. **数据可信性有硬伤**：线上 20 条商品**全部 `stock=0`**，其中 10 条 `priceFen=0`（女装线，§5.4 实测）；设备 IP 可被客户端用 `X-Forwarded-For` 伪造（nginx 蓝本 6 行追加式，API 取首跳）。
3. **管理后台前后端不对齐**：后端 `/admin/console/*` 17 条路由（用户、订单、商品、内容、审计）齐全，H5 里**一条都没有入口**，前端连换 Cookie 会话的 `POST /admin/console/session` 都没封装。`docs/33:148` 写的"一一对应"是错的。
4. **五端里真正能交付的只有两端半**：H5（可上线）、APK（可安装、可冷启）、API；微信小程序停在 `touristappid`（未绑 AppID、未提审），鸿蒙只有 JS 视图包、没有 `.hap`、仓内无 DevEco 工程。

还有一条**结构性**的：产物哈希无法用于判定"线上跑的是不是 HEAD"。同一份源码，本地注入生产环境变量重建的主包与线上主包**字节数完全相同（246,940 B）**，但 chunk 命名与 SHA-256 全不同（§6.3），所以不能用哈希证明线上=HEAD。这不是 bug，但它让"一致性"失去了机器可验的手段。

---

## 2. 全项目模块 × 三档对账表

> 证据路径为仓库内相对路径；`ui-review/...` 下的为本地证据（不入库）。"实测"= 本轮 2026-11-23 实际执行过。

| # | 模块 | 档 | 证据 | 说明 |
|---|---|---|---|---|
| 1 | API 服务骨架（Fastify + 96 端点） | ✅ 已闭环 | `services/api/src/app.ts:243-259`；`ui-review/audit-2026-11-23/api/routes.md`；实测 `GET /healthz` → **200** | 12 个路由文件全部注册；端点 96 个（路由文件 95 + `app.ts:230` 根路径 1） |
| 2 | 鉴权与账号（Bearer / 刷新 / 游客 / 18 渠道 OAuth） | ✅ 已闭环 | `routes/auth.ts:24-93`、`routes/oauth.ts`、`modules/auth.ts:341-347`；实测 `GET /me` → **401** | 未启用渠道 **503 PROVIDER_DISABLED**，不是静默失败 |
| 3 | 设备与网络快照（第五轮交付） | ✅ 已闭环 | `docs/39`、`docs/42`；`routes/device.ts`；实测匿名 `GET /device/context` → **401** | 应用层闭环；其**取 IP 的可信度**单列在第 13 行 |
| 4 | ID 发号（三策略五形态） | ✅ 已闭环 | `packages/ids`；实测 `pnpm test` → **11 passed** | — |
| 5 | 自动化测试与门禁 | ✅ 已闭环 | 实测 `node scripts/repo-lint.mjs` → `✓ 规则检查通过`；`pnpm verify` → `全部通过 67.8s`（`repo/gates.txt`） | typecheck 30.0s / test 23.0s / api build 1.5s / h5 build 12.6s |
| 6 | 备份与夜间巡检 | ✅ 已闭环 | `.github/workflows/ops-nightly.yml`；run `45084211543` success；`ci/runs.md` | healthz ok + 备份 2247.4 KB 落盘 |
| 7 | 商城目录与商品数据 | ⚠ 部分闭环 | 实测 `GET /mall/products?limit=1000` → **20 条**，`stock=0` 20/20，`priceFen=0` 10/20（`repo/catalog-probe.txt`） | 有商品、可列出；但**全部无库存、半数无价**，等于不可成交 |
| 8 | 购物车 / 下单 / 订单状态机 | ⚠ 部分闭环 | `infra/sql/0018_order_status_flow.sql:46`；`db/types.ts:589`；`routes/mall.ts` | 状态机允许 `pending→paid`，但没有代码触发它（第 9 行） |
| 9 | 支付（微信 / 支付宝） | ❌ 未闭环 | `modules/pay.ts:137-141,157-161`；`infra/sql/0001_init.sql:59-71`；`api/payment-scale.md` | 回调只写 `payments`；`payments` 无 `order_id`；订单不翻 `paid` |
| 10 | 端侧支付 SDK | ❌ 未闭环 | `apps/app/src/pages/orders/index.vue:220-229` | live 分支只有"待端侧支付 SDK 调起"，无 H5+/原生调起代码 |
| 11 | 第三方能力（短信/存储/地图/推送/AI/一键登录） | ⚠ 部分闭环（降级态明确） | `config.ts:466,517-520`；`adapters/*`；实测 `/meta`：`sms:console, onekey:dev, storage:local, map:dev, push:dev, ai:dev` | 适配器都有真实分支，缺凭证降级到 dev/console，**不静默失败**；但线上就是降级态 |
| 12 | 存储与媒体域（CORS / 上传 / 回退） | ⚠ 部分闭环 | `infra/nginx/img.mixm.top.conf:35-40`（有 `ACAO:*`）；`cloud.mixm.top.conf:88-97`、`www.mixm.top.conf:72-79`（**无 ACAO**）；`media.ts:42` | 同源 `/media` 回退可用；跨域取图只有 img 域可走；dev 存储 URL `/dev-upload/<key>` 无对应路由（`storage.ts:98,106`） |
| 13 | 客户端 IP 可信度（XFF） | ❌ 未闭环（数据可信） | `infra/nginx/api.mixm.top.conf:53,66`；`lib/device-context.ts:71-76` | 6 行 `$proxy_add_x_forwarded_for` + 后端取首跳 ⇒ 可伪造任意 IP |
| 14 | H5 页面（15 页） | ⚠ 部分闭环 | `apps/app/src/pages.json`；`frontend/pages.md` | 完整 9 / 部分 4 / 演示数据 2 / 纯占位 0 |
| 15 | 管理后台（前后端一致性） | ❌ 未闭环 | 后端 `routes/admin-console.ts` 17 条；前端 `pages/admin/index.vue` 773 行；`api/client.ts:745` | 后端有用户/订单/商品/内容/审计，前端**零入口**；会话建立也没封装 |
| 16 | Android APK（可安装/可冷启/版本） | ⚠ 部分闭环 | `apps/mobile/android/app/build.gradle:26-42,67`；`android/meta.md`、`coldstart.md` | versionCode 3 / versionName 0.0.2 全链路一致；冷启 1417/1155 ms 无崩溃；**release 包缺 mipmap 位图**，且与线上非同一构建 |
| 17 | 微信小程序 | ⚠ 部分闭环（产物级） | `apps/app/dist/build/mp-weixin`（105 文件 582,155 B，`app.json` 15 页 / tabBar 4）；`project.config.json` appid=`touristappid` | 能构建、不能发布 |
| 18 | 鸿蒙 | ❌ 未闭环 | `apps/app/dist/build/app-harmony`（48 文件 1,450,266 B） | 只有 JS/视图包，**不是 `.hap`**，`platforms/harmony/` 为空，无 DevEco 工程 |
| 19 | CI（GitHub Actions） | ✅ 已闭环 | run `44926948913`/`44926948908`/`44926948942` 全 success，headSha 均 `83ca179` | §5.9 |
| 20 | 部署与原子发布 | ⚠ 部分闭环 | `deploy/atomic-release.sh:130`（切链）、`:176`（失败回滚）；`deploy-engine.mjs:225-245`（6 条断言） | 有断言、有自回滚、有 flock；但 `rollback.yml` **从未运行**，实践为零 |
| 21 | 发布门禁的"假绿"风险 | ❌ 未闭环 | `.github/workflows/deploy.yml:125,231-233` | `SSH_READY!=true` 时被 skip 的 step 不计失败，**job 仍 success** |
| 22 | 文档体系（42 份编号文档） | ⚠ 部分闭环 | `docs/`；`docs/numbering.md`、`links.md`、`overclaim.md` | 断号 1（22 已移入 `docs/archive/mim/`，该处**两份都挂 22**）；断链 22 条；超实现 26 条 |
| 23 | laal.top 支线 | ⛔ 不计入 | `deploy/domains.json`（`legacyUnused` + `forbiddenStrings`）；`scripts/domains.mjs:10,18,110` | 仓库自身定义为"与本项目无关且禁止接入"，§5.13 |

**计数口径**：#1–#23 共 23 行，其中 #23 明确不计入 ⇒ 分母 22 ⇒ 已闭环 6、部分闭环 11、未闭环 5。若把 #9+#10 合并为"支付闭环"一类，则未闭环为 4 类。两种口径都在此写明，避免与历史文档的口径打架。

---

## 3. 文档声称 vs 代码实际

> 全量 26 条在 `ui-review/audit-2026-11-23/docs/overclaim.md`。下表按严重度排，★ 为最严重。

| # | 文档声称（原文摘句 + 位置） | 代码 / 线上实际 | 判定 |
|---|---|---|---|
| ★1 | "微信支付 / 支付宝支付已接入"（`README.md:46`、`docs/03`） | 适配器代码在位（`pay/wechat.ts:17,39,52`、`pay/alipay.ts:21,53`），**但回调不回写订单**；`payments` 无 `order_id`（`0001_init.sql:59-71`）；线上双 `off` | **假**（半成品被写成"已接入"） |
| ★2 | 后台"前端页面与后端接口一一对应"（`docs/33:148`） | 后端 console 17 条路由；前端仅调 `users/:id/sessions` 一条（`client.ts:748`），订单/商品/内容/审计**零入口** | **假** |
| ★3 | PWA 能力（`README.md:38,187`） | 全仓 0 命中 `manifest.webmanifest` / Service Worker / `registerSW` | **假** |
| ★4 | 页面"6 个"（`README.md:141`、`docs/01:73`） | `pages.json` 实际 **15 页**（`repo-lint` 双向校验通过） | **过时**（差 9 页） |
| ★5 | 测试基线"22 + 4 / 68 例"（`README.md:121,224`） | 实测：本地 `175 passed / 9 skipped`，CI（带 PG）`182 passed / 2 skipped`（`repo/tests.txt`、`ci/runs.md`） | **过时** |
| 6 | "OAuth 闭环"（`docs/16`） | 18 渠道代码在位、错误码清晰（`oauth.ts:79-84` 503），线上 `oauthProviders` 全 `off` | 降级（代码真、线上假） |
| 7 | "短信已接入" | 默认 `sms:console`（`config.ts:466`），验证码进日志并回 `devCode`；阿里云分支真实 | 降级 |
| 8 | "对象存储已接入" | 线上 `storage:local`（`config.ts:517-520`）；S3 presign 分支真实未启用 | 降级 |
| 9 | "地图 / 推送 / AI 已接入" | 线上 `map/push/ai` 均 `dev`；AI 缺 key 时 `DevAi` 回显 | 降级 |
| 10 | AI 调研能力（`docs/33:176` 自陈为演示） | 后端无 `/ai/research`（仅 `/ai/chat`，`integrations.ts:110`）；前端 `api/research.ts:278-282` 全本地 mock | 演示（文案已标注，可接受） |
| 11 | "五端全部可构建" | 五端都有真实脚本入口且今日跑通；但小程序 `touristappid`、鸿蒙无 `.hap` | **半真**（构建≠可发布） |
| 12 | "CI 自动回滚"（`docs/04`） | `rollback.yml` 仅手动且 `gh run list` 返回空（从未运行）；`--verify-only` 失败**不触发回滚**（`deploy-engine.mjs:319-322`） | **半真** |
| 13 | "发布后断言全部通过"（`docs/41:46`） | 6 条断言确有实现（`deploy-engine.mjs:225-245`）且 run `44926948942` 通过 | 真 |
| 14 | 线上版本 0.0.2（`docs/40`） | 实测 `/meta` → `version:"0.0.2"`, `env:"production"`, `demoMode:false` | 真 |
| 15 | API 示例版本 `0.1.0`（`docs/06-api.md:19`） | 真值 0.0.2 | 过时 |
| 16 | `apps/app` 有 PWA/manifest 静态资源 | `src/static` 只有 favicon/logo/tab 图标/splash，无 manifest | 假 |
| 17 | "设备快照已上线" | 线上包内 H5 含 4 指纹（`/device/context`、`mixmapp:device-id`、`reportContext`、`deviceId`） | 真（但版本关系不可证，§6.3） |
| 18 | "用户会话管理"（后台） | 前端只渲染 `listUserSessions` **前 10 条**（`admin-console.ts:438` 固定 10、无分页），且需先有 Cookie 会话——前端无入口 | 半真 |
| 19 | 文档"22 号已迁出"（`docs/32:13`） | `docs/archive/mim/` 下两份文件**都挂 `22-`** 前缀 | 真（但留下双 22） |
| 20 | "Gitee 镜像流水线"（`.gitee/pipeline.yml`） | 有完整 verify + Cloudflare Pages publish，但 `git remote` 只有 GitHub；`docs/24:175` 状态"未接线"；`domains.json` matrix 标 `no_credentials` | 未运行 |
| 21 | `docs/android-build.md` 图标"浅纸底 `#F4F4F1`"（工作区改动） | 代码 `values/ic_launcher_background.xml` 已是 `#F4F4F1` | 真（文档在追平代码） |
| 22 | favicon 改版"已落地"（`docs/37` §1） | 只在本地产物；线上实测仍是 `<link rel="icon" href="/static/logo.png" />`、无 apple-touch-icon | 未上线（文档已自陈"尚未推送上线"） |
| 23 | "启动图 11 张"（`docs/android-build.md`） | `res/drawable*` 下确有 11 张 `splash.png`（11/15 生成） | 真 |
| 24 | "22 号文档已归档" | `docs/32:13` 记录移出顶层序列，顶层确无 22 | 真 |
| 25 | "安装向导 12 步预演"（`docs/21`） | `install/server.mjs` + `ui.html` 在仓库；本轮未跑（§7） | 未核 |
| 26 | "生产闭环完成"（`docs/36:41` 自陈支付缺口未修） | 与实测一致：支付缺口确未修 | 真（自陈诚实） |

**"文档写了、代码/线上没有"的硬名单（10 条）**：支付已接入 · 后台一一对应 · PWA · 页面 6 个 · 测试 68 例 · CI 自动回滚 · 小程序可发布 · 鸿蒙可发布 · `/ai/research` 后端 · Gitee 镜像在跑。

---

## 4. 未闭环清单（按优先级）

### P0 —— 用户会看到假功能，或数据不可信

**P0-1 支付回调不回写订单（交易链路断点）**
- 卡点：`modules/pay.ts:137-141`（微信）、`:157-161`（支付宝）只 `UPDATE payments`；`payments` 无 `order_id`；`orders.status` 永久 `pending`；用户"付了钱订单没变"。
- 改动面：新增迁移 `0022_payment_order_link.sql`（`payments.order_id` + 索引）→ `db/types.ts` 与方法签名 → `db/postgres.ts` 与 `db/memory.ts` 双驱动 → `modules/pay.ts` 回调内 `transitionStatus(order_id,'paid')`（复用 `types.ts:589` / `postgres.ts:1357-1367` / `memory.ts:606-615`）→ `packages/contracts` 契约 → `routes/integrations.ts` 校验 → `test/pay-*-notify.test.ts` 补订单断言。**9–11 个文件**。
- 规模：**中**，约 200–350 行；无前端改动（后台订单列表直接读 `orders`，`admin-console.ts:169,181` 自动可见 `paid`）。注意 `markStatusAt` 不打 `paid_at`（`postgres.ts:1396-1397`、`memory.ts:641`），若要对账需一并补。历史 pending 支付单需一次性脚本按 `out_trade_no ↔ order_no` 补链。

**P0-2 客户端 IP 可伪造（数据可信）**
- 卡点：`infra/nginx/api.mixm.top.conf:53,66` + `www:51,64` + `cloud:66,79` 用 `$proxy_add_x_forwarded_for`（追加式）；`lib/device-context.ts:71-76` 取**首跳**。
- 改动面：上述 **6 行**改为 `proxy_set_header X-Forwarded-For $remote_addr;`（单机直挂场景）；若日后前置 CDN，则加 `real_ip_header` + `set_real_ip_from` 可信段后再取 `$remote_addr`。代码侧建议加"取末跳 + 可信代理白名单"兜底。
- 规模：**小**，1 个文件 6 行 + 1 个函数；但需在生产机 `nginx -T` 核对实际 conf 是否等于蓝本（本机无 SSH，§7）。

**P0-3 管理后台前后端不对齐**
- 卡点：后端 `admin-console.ts` 17 条路由齐全；前端 `pages/admin/index.vue` 只有 5 个写动作（落点/扫描/OAuth/导入/合并回滚）与 5 个只读块，**订单、商品、用户、内容、审计零入口**；前端未封装 `POST /admin/console/session`，`x-mixm-console` 写头从未发送（`client.ts:745` 仅注释）。
- 改动面：`apps/app/src/api/client.ts` 增加会话建立 + 8 组封装 → `pages/admin/` 增加 5 个区块（或拆子页）→ `pages.json` 与 `routes.ts` 同步（`repo-lint` 双向校验）。
- 规模：**中偏大**，前端 400–700 行；后端无需改。

**P0-4 商品数据不可成交（库存/价格）**
- 卡点：线上 20 条商品 `stock=0` 20/20；10 条女装 `priceFen=0`（`repo/catalog-probe.txt`）。女装线 `hzn-*` 抓取自档口，价格与库存在源里就是 0，不是渲染问题。
- 改动面：数据侧（`tools/hznzcn-importer/` 补价格/库存字段，或运营后台录入）> 代码侧。若允许"无货展示"，商品卡必须显式标"缺货/询价"，否则用户看到 ¥0.00 是假信息。
- 规模：数据工程为主，**中**；需业务口径拍板（仓库内无价格来源）。

### P1 —— 影响可交付性

| # | 项 | 卡点 | 改动面 | 规模 |
|---|---|---|---|---|
| P1-1 | 端侧支付 SDK 未接 | `orders/index.vue:220-229` 只有提示文案 | H5+ 支付通道 / 微信 JSAPI / 支付宝 App 调起三选一 + 回调轮询 | 中 |
| P1-2 | release APK 缺 mipmap 位图 | debug 全套在位，release 仅 `res/BW.xml` | `apps/mobile/branding/generate-icons.py` 产物纳入 release 的 res 合并，或 `android-inject-base` 阶段校验 | 小 |
| P1-3 | 小程序不可发布 | `project.config.json` appid=`touristappid` | 绑正式 AppID + 提审 | 小 |
| P1-4 | 鸿蒙不可发布 | 只有 `app-harmony` JS 包，无 `.hap`，`platforms/harmony/` 空 | 补 DevEco 工程模板 + 打包环境 | 中–大 |
| P1-5 | 发布门禁"假绿" | `deploy.yml:125` 只校验 `DEPLOY_SSH_KEY_B64` 非空，不校验 HOST/USER；`SSH_READY!=true` 时末步只 `echo SKIP` 并 `exit 0`（`:231-233`） | 末步改 `exit 1`，或 job 级区分"真发布/跳过" | 小 |
| P1-6 | 回滚零实践 | `rollback.yml` 从未运行；`rollback.sh` 自身不抢 flock（`atomic-release.sh:42-48` 有） | 补 flock + 演练一次并留日志 | 小–中（演练是主要成本） |
| P1-7 | 构建不可跨环境复现 | 同源码同 env，本地主包与线上字节数相同但 44 处 chunk 名不同（§6.3） | 固定 `chunkFileNames`/`assetFileNames` 去 hash，或在 release 存档里留"构建输入 + 产物 SHA" | 小 |
| P1-8 | 文档 10 条超实现 | §3 硬名单 | 改文档（非改代码） | 小，但**必须改** |

### P2 —— 体验与工程化

| # | 项 | 卡点 | 改动面 / 规模 |
|---|---|---|---|
| P2-1 | `ui-review/` 与 `reports/` 证据不入库 | `.gitignore:53-54`；`git ls-files` 均为 0；62.7 MB / 508 文件只在本地 | §5.11 方案 A+B，**小** |
| P2-2 | 文档断号与断链 | 22 缺号（两份在 archive）；断链 22 条（真死链 2、编号写错 3、gitignore 产物 4、旧仓路径 11、旧会话绝对路径 2） | 纯文档，**小** |
| P2-3 | 4 个并行品牌线在途文件未提交 | `apps/app/index.html`(M)、`docs/android-build.md`(M)、`docs/37-*`(??)、`docs/mall-list-fixed-*.png`(??) | §5.12，**小** |
| P2-4 | dev 存储 URL 断链 | `adapters/storage.ts:98,106` 返回 `/dev-upload/<key>`，无服务端路由 | 加 dev 路由或改返回本地绝对路径，**小** |
| P2-5 | `cloud`/`www` 的 `/media/` 无 CORS | `cloud.conf:88-97`、`www:72-79` 只有三个安全头 | 需跨域取图时在 location 内补 `ACAO`（注意 `cloud.conf:93` 注释：location 内出现 add_header 后 server 级头不继承），**小** |
| P2-6 | 构建期媒体域注入不进本地默认 | `build-h5.mjs:94` 只读 `MIXMAPP_MEDIA_BASE`，本地默认无注入 ⇒ 与线上差 35 B、走 `/media` 相对回退 | `api-base.json` 增 `mediaBase` 并让脚本读它，**小** |
| P2-7 | 三套休眠流水线口径分裂 | `.gitee/pipeline.yml`（Cloudflare Pages）、`pages.yml`（GitHub Pages）、`image.yml`（GHCR）均手动/暂停，与 `deploy.yml`（腾讯云 SSH）互不相干 | 统一或标注"仅存档"，**小** |
| P2-8 | 遗留目录 | `core/`、`modules/`、`archive/` **空目录**（0 文件）；`cloudbase/migrations/` 7 个历史迁移；`tools/hznzcn-importer/` 10461 文件未入库（`.gitignore:43`） | 清理或加 README 说明，**小** |
| P2-9 | CI 与本地 debug APK 字节不同 | CI 产出 4,067,519 B，本地 4,736,066 B（同 commit） | 查明差异（打包脚本/env），**小** |

---

## 5. 逐维度结论（对应本轮 12 项审计范围）

### 5.1 仓库与交付面清点

- 顶层目录 31 个，**在 workspace 内**的只有 `apps/*`、`services/*`、`packages/*`（`pnpm-workspace.yaml` 三行）；`turbo.json` **不存在**（不用 turbo）。
- 真实模块 5 个：`apps/app`（`@mixmapp/app`，uni-app，h5/mp-weixin/app/app-harmony 四目标）、`apps/mobile`（`@mixmapp/mobile`，Capacitor + Gradle）、`services/api`（`@mixmapp/api`，tsup/vitest/tsx）、`packages/contracts`、`packages/ids`。
- 派生目录（各带一份复制出来的 package.json，**不是模块**）：`out/api`、`out/api-test`、`out/release`、`release/api-stage`。
- 非标准目录：`.catalog-storage`(0 文件)、`.catalog-sync`(3)、`.edge-profile`、`.gitee`(1)、`.screenshots`、`.secrets`(5，含 `release.keystore`，被 `.gitignore:27` 排除)、`.tmp`(117)、`.workbuddy`(3)、`2026-11-14`(1719 文件/325.3 MB)、`2026-11-15`(17)、`2026-11-16`(53)、`archive`(空)、`cloudbase`(7)、`core`(空)、`install`(2)、`modules`(空)、`out`(16970/200.1 MB)、`release`(6819/219.3 MB)、`storage`(6714/1264.4 MB)、`tools`(11724/2193.5 MB)、`reports`(10/0.2 MB)、`ui-review`(508/62.7 MB)。
- 根文件里的历史件：`项目接管报告-2026-11-14.docx`（461 KB，`.gitignore:60` 已排除）、`dnspod_records_2026-11-05_21-42-26.xls`（38.5 KB，**已入库**，且是 `deploy/domains.json` 的唯一数据源）。
- **五端构建入口核验（全部今日实跑，exit 0）**：

| 端 | 命令 | 脚本入口 | 产物 | 今日 |
|---|---|---|---|---|
| API | `pnpm build:api` | `services/api/package.json:16`（tsup） | `services/api/dist` 7 文件 430,715 B | ✅ |
| H5 | `pnpm build:h5` | 根 `package.json:14` → `scripts/build-h5.mjs:77` | `apps/app/dist/build/h5` 60 文件 803,998 B | ✅ |
| APK | `pnpm --filter @mixmapp/mobile build:debug`/`release` | `apps/mobile/package.json:10-11` → `scripts/android-build.mjs:75`（gradlew，webDir `../app/dist/build/h5`） | `app/build/outputs/apk/{debug,release}/*.apk` | 本轮未重跑（沿用 11-23 01:01 的包，见 §5.6） |
| 微信小程序 | `pnpm build:mp-weixin` | 根 `package.json:15`、`apps/app/package.json:9` | `dist/build/mp-weixin` 105 文件 582,155 B | ✅ |
| 鸿蒙 | `pnpm build:harmony` | 根 `package.json:17`、`apps/app/package.json:12`（`uni build -p app-harmony`） | `dist/build/app-harmony` 48 文件 1,450,266 B | ✅（只到 JS 包） |

**结论：五端都有真实构建入口，不是只有文档承诺。** 但"能构建"和"能交付"是两件事，见 #17/#18。

### 5.2 API（端点 / 鉴权 / 假实现）

- **端点 96 个**：auth 14（`auth.ts` 11 + `oauth.ts` 3）、me 9、device 2、商城 30（`mall.ts` 21 + `address.ts` 7 + `home.ts` 2）、支付 4、地图 2、存储 2、媒体 1（仅 `storage.provider=local` 注册，`app.ts:239-241`）、AI 1、`x-admin-token` 面 10（`admin.ts`）、console 面 17（`admin-console.ts`）、meta/探针 3、根路径 1（`app.ts:230`）。
- **鉴权四类**：Bearer（`app.ts:161-167`）、`x-admin-token`（`admin.ts:17-22`，未配/不符**一律 404**）、Cookie 会话 `mixm_ops_session` + 写头 `x-mixm-console:1`（`admin-console.ts:91-100`）、回调验签/HMAC。
- **假实现三分类**：演示态开关 10 条；真未实现 4 条（支付不回写订单、`/ai/research` 缺失、dev 存储 URL、订单不翻状态）；注释/命名巧合 8 组。`services/api/src` 内**无** `TODO/FIXME/NOT_IMPLEMENTED` 残留。
- **修正上一轮结论（第 1 处）**：上一轮记录"`GET /auth/me` 未带 token → 401"。本轮实测 `/auth/me` → **404**，因为**该路由不存在**（`routes/auth.ts:24-93` 中无 `/auth/me`）；正确路径是 `/me`（`routes/me.ts`），实测 `/me` → 401。上一轮属笔误。
- **修正上一轮结论（第 2 处）**：上一轮把"XFF 可伪造"当成服务端信任问题；本轮定位到根因在**仓库里的 nginx 蓝本**（`infra/nginx/api.mixm.top.conf:53,66`），不是"服务器上现改一处"。

### 5.3 H5（15 页 + 三端构建）

| 档 | 数量 | 页面 |
|---|---:|---|
| 完整实现 | 9 | index/index、legal/privacy、auth/login、me/index、me/favorites、mall/index、mall/detail、cart/index、settings/about |
| 部分闭环 | 4 | auth/register（OAuth 四渠道是静态表，未按服务端 providers 过滤，`register.vue:296-301`）、orders/index（支付 SDK 未接）、admin/index（§5.5）、assistant/index（未配 key 走 DEV ECHO） |
| 演示数据 | 2 | research/index、research/detail（`api/research.ts:195,249` 纯本地 mock，页内有"功能演示"角标） |
| 纯占位 | 0 | — |

- 三份构建今日全部 exit 0，产物路径与字节见 §5.1。
- 小程序 `app.json`：页面 15、tabBar 4，与 `pages.json` 一致；appid 仍 `touristappid`。
- 鸿蒙：`app-harmony` 只导出 JS/视图包（`app-service.js` 305,967 B、`uni-app-view.umd.js` 360,470 B），**没有 `.hap`**。
- 本地 vs 线上：icon 行不同（线上 `/static/logo.png`，本地 favicon+apple-touch-icon）；主包 `index-8BK037kq.js` 246,905 B vs 线上 `index-DtAsuT32.js` 246,940 B；CSS 同 hash 同字节（`index-C9MP1rlz.css` 26,508 B）。

### 5.4 商城数据实测（本轮补做，影响"数据可信"判定）

```
GET /mall/products?limit=1000 -> 20 条
stock=0    : 20/20
priceFen=0 : 10/20
品牌分布   : EG=10（有价 ¥0.07–¥0.10/支，库存 0）
             浙宝005=7 / 美沁=2 / 欣美人=1（女装，priceFen=0，库存 0）
```
- `mall.demoMode` 已由早前文档写的 `true` 漂移为 **false**（`/meta` 实测）；`catalogSource.active=false/productCount=0` 指**文件型 catalog.json 源未启用**，**不代表零商品**——这两个字段极易被误读成"商城空"，本轮据此纠正（我最初也差点按上一轮印象写成 0 商品）。
- 未实测：`stock=0` 时下单是否被拦截（需登录态，§7）。

### 5.5 管理后台（真实能力 vs 只读占位）

`apps/app/src/pages/admin/index.vue`（773 行）9 个区块：

| 类型 | 数量 | 内容 |
|---|---:|---|
| 真实可写 | 5 | 切换落点、超时订单扫描、OAuth 启停、目录导入、合并回滚 |
| 只读 | 5 | 落点指标、档案、OAuth 读、合并读、用户会话（固定 10 条） |
| 本地存储 | 1 | `ADMIN_TOKEN` 输入记忆 |

后端有、前端**完全未暴露**：用户列表/详情、订单列表/详情/推进/取消、商品列表/上下架、内容运营位、收藏、满减、审计日志、总览。
未登录表现：`onLoad:544-547` 无令牌不发请求，数据块 `v-if` 隐藏，**不白屏**。
两套鉴权的生产/本地差别：`x-admin-token` 面——生产未配 `ADMIN_TOKEN` 则 `/admin/*` 整体 404（实测 `/admin/products` → **404**）；Cookie 面——线上匿名 `/admin/console/overview` → **404**，本地内存实例带 Cookie 可 200（上一轮留档，本轮未重跑本地实例）。

### 5.6 Android

- `build.gradle:67` applicationId `top.mixm.app`；`versionCode 3` / `versionName 0.0.2`（由 `version.json` 派生）；minSdk 23 / target 35 / compile 35。`node scripts/version.mjs check` exit 0。
- debug 4,736,066 B / `a95698c2…0444e`（Android 默认 debug 密钥）；release 3,530,507 B / `dce30b39…7da47`（DN `CN=MixmAPP, OU=Mobile, O=MixmAPP, L=Ningbo, ST=Zhejiang, C=CN`，证书 SHA-256 `7fb86824…386e69`，v1+v2）。权限仅 INTERNET / ACCESS_NETWORK_STATE / POST_NOTIFICATIONS / DYNAMIC_RECEIVER_NOT_EXPORTED。
- **APK 包内 H5 == 当前源码的无 env 构建**：`assets/public/assets/index-8BK037kq.js` 246,905 B / SHA-256 `a616e15f…c6553`，与本地重建同名同哈希同字节；包内 `index.html` 已含**未提交**的 favicon 改动。
- **与线上不是同一构建**：线上主包 246,940 B（+35 B），44 处 chunk 命名不同、SHA 不同（§6.3）。
- 冷启动：`am start -W` TotalTime **1417 ms / 1155 ms**，WaitTime 1418/1157，Status ok；logcat 无 `FATAL EXCEPTION`/`AndroidRuntime`；截图确认 H5 首页渲染，非白屏。
- WebView 加载分支：**优先包内本地资源**（`https://localhost/` → `assets/public`，`MainActivity.java:77,139,191,566`），远程仅用于 `/meta` 版本检查（`:657`），无"先拉远程 HTML"降级。
- 异常：release 包缺 mipmap 位图（P1-2）；`manifest.json` targetSdk 34 与壳 35 有跨端差。

### 5.7 支付与 OAuth 回退态（是否静默失败）

| 场景 | 实际表现 | 依据 |
|---|---|---|
| 支付未配商户，创建支付单 | **201**，`mode:'dev'` + `payload.mock:true`；前端弹"未真实扣款" | `pay.ts:101-106,109-116`；`orders/index.vue:220-229` |
| 渠道未配置时打回调 | **503** `PROVIDER_DISABLED` | `wechat.ts:79`、`alipay.ts:25` |
| OAuth 渠道不存在 | **400** `BAD_REQUEST` | `oauth.ts:78` |
| OAuth 渠道未启用，直打 start | **503** `PROVIDER_DISABLED` | `oauth.ts:79-84` |
| 回调 state 失效 | **422** `CODE_INVALID` | `oauth.ts:125` |
| 换码时适配器未启用 / 网络错误 | **503** / **502** | `modules/auth.ts:341,347` |
| 前端登录页 | 渠道清单拉取失败显示"第三方登录服务暂不可达"（`login.vue:159,225-228`）；未启用渠道**不渲染按钮**（`:214-218`）；回跳错误就近展示（`:231-242`） | **无白屏路径** |
| AI 未配 key | 不抛错，`DevAi` 回显；配了 provider 缺 key 才 503 | `ai.ts:27,72` |

**结论：不是静默失败，是"显式降级 + 明示演示态"。** 这是本轮少数可以明确说"做对了"的地方。

### 5.8 存储与网络（CORS / 上传 / 同源回退 / XFF）

- 上传：`local` provider 走 `PUT /storage/upload`（HMAC `key/exp/sig`，`integrations.ts:84-107`）→ 落盘 → `GET /media/*` 由 API 直出（`media.ts:42`）或 nginx alias（`cloud.mixm.top.conf:88-89`，alias `/var/lib/mixmapp/storage/`）。
- 媒体域：`img.mixm.top` 有 `ACAO:*` + OPTIONS 204（`img.conf:35-40`）；`cloud`/`www` 的 `/media/` **无 ACAO**（仅三个安全头），与上一轮结论一致且本轮定位到具体行号。
- 同源回退：H5 构建注入 `__MIXMAPP_MEDIA_BASE__`（`build-h5.mjs:98`）→ 未注入时 `client.ts:122-131` 回落 API 源 origin + `/media/`。
- **XFF**：6 行追加式 + 后端取首跳 ⇒ 可伪造。改法与规模见 P0-2。**生产机实际 conf 是否等于蓝本：无法核实**（§7）。

### 5.9 CI 与部署

- 7 个 workflow：`ci.yml`（push main/develop/tag/PR；PG16 service；version:check→domains:check→lint→typecheck→db:migrate→test→真实 PG 集成测试→build:api→build:h5→readyz/healthz/meta 冒烟→build:mp-weixin；artifact `mixmapp-artifacts`）、`android.yml`（paths 触发；签名 secret 存在才出 AAB，否则只出 debug APK 并告警）、`deploy.yml`（push main + 手动；build→api 两 job；concurrency `deploy-production`）、`rollback.yml`（**仅手动，从未运行**）、`image.yml`（push 段已注释）、`ops-nightly.yml`（cron `20 18 * * *`）、`pages.yml`（push 段已注释）。
- 三条 run 全 success 且 headSha = `83ca179`；本地 HEAD `df6e6a6` 是其上 docs-only `[skip ci]`，**未部署**。
- `releases/current` 切链：正常发布 `atomic-release.sh:130` `ln -sfn "$RELEASE" "$APP_DIR/current"`；失败自回滚 `:176` `ln -sfn "$PREV" ...`（`PREV` 来自 `:53 readlink -f`，回滚后重启 `:181`、退出 1 `:184`）；手动回滚 `rollback.sh:17`；旧版清理 `atomic-release.sh:206`（`KEEP_RELEASES` 默认 5，`:14`）。
- 断言 6 条（`deploy-engine.mjs:225-245`）：meta 200 / 版本 == EXPECT_VERSION / `env=production` / `demoMode===false`（缺字段即失败）/ healthz ok / 站点首页 200。`--verify-only` 任一失败 `return 1`（`:319-322`）→ job 失败，**但不回滚**。
- 互斥：GitHub concurrency `deploy-production` + 生产机 flock（`atomic-release.sh:42-48`，锁 `/var/lock/mixmapp-deploy.lock`，等 600s）。缺口：`rollback.sh` 不抢 flock；旁路手工 ssh 不经 GitHub 组。
- **本机无法直连核实**：`~/.ssh/mixmapp_deploy` 于 2026-11-13 重装后失效，`~/.ssh/config` 无生产 Host 别名，`deploy/CATALOG-DEPLOY.md:26` 明写"本会话能否直连生产：不能"。CI 侧 secrets 配齐（deploy/backup 实际 SSH 成功），**不可核实仅指本机**。

### 5.10 文档一致性

- 顶层编号 01–21、23–42 共 **42 份**，无撞号，**断号 1 个（22）**；22 在 `docs/archive/mim/` 下且**两份都带 22 前缀**。`21-wordpress-style-installer.md` 标题残留旧号"17 ·"。
- 断链 **22 条** / 424 个引用：真死链 2（`docs/19:105`、`docs/21:201`）、编号写错 3（`docs/25:206` 把 26 写成 16；`docs/27:364` 两条指向 archive 里的 22）、gitignore 产物 4、旧 Mim 仓路径 11（全在 `docs/Mim-全能力完成度核验-20261114.md`）、旧会话绝对路径 2（`docs/23:143,147`）。
- 版本一致性：`version.json` / `package.json:3` / `config.ts:428` / `version.ts:3` / `manifest.json:5-6` / `.env.example:4` / `build.gradle:33,35` / 线上 `meta` 全部 `0.0.2`（versionCode 3）；仅 `docs/06-api.md:19` 示例写 `0.1.0`（过时）、`docs/36:16` 的 `released` 快照滞后。
- `repo-lint` 只校验编号唯一性、**不查断号**，且只扫 `docs/` 顶层——archive 里的双 22 不会变红，这也是它能一直存在的原因。

### 5.11 ui-review / reports 证据入库（只给方案，未改）

现状：`.gitignore:53` `/ui-review/`、`:54` `/reports/` ⇒ `git ls-files` 两者均为 **0**。体量：`ui-review` 508 文件 / 62.7 MB；`reports` 10 文件 / 0.2 MB；其中最大的单件是 `ui-review/device-2026-11-22/api/installed-base.apk`（4.5 MB）与一批 0.8–1.2 MB 截图。

**方案 A（推荐）：分层入库**——保留 `/ui-review/` 忽略，但把"文本类、体积小、可追溯"的关键件强制入库到 `docs/evidence/`（不放 `ui-review/` 下，避免和忽略规则打架）：

```powershell
git add -f docs/evidence/audit-2026-11-23/ACCEPTANCE.md `
            docs/evidence/audit-2026-11-23/PUSH-CI-PROD.md `
            docs/evidence/audit-2026-11-23/gates.txt `
            docs/evidence/audit-2026-11-23/tests.txt `
            docs/evidence/audit-2026-11-23/*-probe.txt
```
- 优点：证据进 git、跟 commit 走；图片/APK 仍不入库，仓库不膨胀（预计 < 200 KB）。
- 代价：新增 `docs/evidence/` 约定，需在 `ADR-0001` 或 `docs/README` 写明"证据正文入库、截图与安装包本地保留"。
- 规模：**小**（一次性 5–8 个文件 + 一条约定）。

**方案 B：转为文档附录摘要**——报告里保留"命令 + 关键输出 + 本地路径"，不搬文件。本文 §9/§10 就是 B。
- 优点：零新增目录、零仓库膨胀。
- 代价：原始报文/截图仍只在本地，换机器就丢。

**建议 A + B 混合**：文本类用 A 入库；截图与 APK 用 B 只留索引。**本轮不做**，等拍板。

### 5.12 工作区 4 个并行品牌线在途文件（是否并入）

| 文件 | 状态 | 内容 | 与本轮冲突？ | 建议 |
|---|---|---|---|---|
| `apps/app/index.html` | M | favicon `/static/logo.png`→`/static/favicon.png` + 增 `apple-touch-icon` | **不冲突**，但它是**代码改动**，且线上未生效（实测线上仍是 `logo.png`） | **不并入**本轮 docs-only 提交；否则 HEAD 代码与线上产物又多一处漂移。等品牌线自己出包上线时一起走 |
| `docs/android-build.md` | M | 图标/启动图描述由"深底 `#0B0F0E`"改为"浅纸底 `#F4F4F1`" | **不冲突**，且与代码一致（`ic_launcher_background.xml` 已是 `#F4F4F1`） | 可并入（纯文档追平代码），但为保持本轮"只加 43 号"的干净度，**建议留给品牌线** |
| `docs/37-brand-logo-font-audit-2026-11-21.md` | ?? | 82 行品牌/字体审计 | 不冲突，但**占用 37 号且未入库**，与本轮"文档编号一致性"结论直接相关 | 品牌线自己 `git add` 后提交；本轮不在 43 里替它登记 |
| `docs/mall-list-fixed-2026-11-21.png` | ?? | 截图证据 | 不冲突 | 同上；若要入库，按 §5.11 方案 A 放 `docs/evidence/` |

**判断：4 个文件属同一条"品牌/图标"线，与本轮审计无逻辑冲突，也不需要并入。本轮提交保持"仅新增 docs/43"。**

### 5.13 laal.top 支线（要不要计入）

**不计入。** 理由来自仓库自己的权威登记，不是我的判断：

- `deploy/domains.json` 把 45 条 `laal.top` 主机全部归入 `legacyUnused`，`projectUsage: "unused_legacy_zone"`，每条 note 写"laal.top 表内记录，与本项目无关"；
- 同文件 `forbiddenStrings` 明列 `laal.top`：**"功能路径禁止接入"**；
- `domainArchitecture.$comment`：**"laal.top 明确不参与"**；
- `scripts/domains.mjs:10,18,110` 是**禁止性门禁**（防止它漏进功能配置），不是接入；
- workflows / `.env.example` / `package.json` **0 命中**，仓内无其构建/部署入口；
- 唯一实体证据是 `reports/laal-top-settings-20261120/`（外部 WordPress 7.1.5 + zibll 站点巡检：804 项 zibll CSV + options JSON），而 `reports/` 被 `.gitignore:54` 排除，`git ls-files reports` = 0 ⇒ **连留档都不在仓库里**。

**结论：laal.top 的 0 商品 / 0 订单 / 凭证全空 / 主题被切过一次且来源未定位，属于该 WordPress 站自己的交付口径，不写进本仓库的闭环分母。** 仅在 §12 留一行索引，避免以后又被当成"本项目的缺口"重算一遍。

---

## 6. 关键实测（自证用）

### 6.1 线上接口状态码（2026-11-23 17:28，原始输出 `repo/live-probe.txt`）

```
GET /healthz                 -> 200
GET /meta                    -> 200
GET /admin/console/overview  -> 404
GET /admin/products          -> 404
GET /device/context          -> 401
GET /auth/me                 -> 404   ← 该路由不存在（上一轮记为 401，笔误）
GET /me                      -> 401
GET /pay/notify/wechat       -> 404   （GET 未注册）
POST /pay/notify/wechat      -> 400   （缺签名载荷，非 500）
```

### 6.2 门禁复跑（原始输出 `repo/gates.txt`、`repo/tests.txt`）

```
node scripts/repo-lint.mjs  -> ✓ 规则检查通过
pnpm verify                 -> 全部通过 67.8s
  规则检查 0.7s / 类型检查 30.0s / 自动化测试 23.0s / API 构建 1.5s / H5 构建 12.6s
pnpm test                   -> services/api: 175 passed | 9 skipped (184)
                               packages/ids: 11 passed
                               packages/contracts: No test files（--passWithNoTests）
```
与 CI（带 PG service）的 `182 passed / 2 skipped` 对得上：184 个用例总数一致，本地因无 PG 跳过 9 个集成测试。

### 6.3 "APK 是否等于 HEAD / 是否等于线上"的三方对照（原始输出 `repo/rebuild-env-proof.txt`）

| 对象 | 主包文件 | 字节 | SHA-256 | 来源 |
|---|---|---:|---|---|
| APK 包内（debug/release 同） | `index-8BK037kq.js` | 246,905 | `a616e15f…c6553` | 2026-11-23 01:01 出包 |
| 本地重建（**无** env） | `index-8BK037kq.js` | 246,905 | 同上 | 本轮 |
| 本地重建（**注入** `MIXMAPP_API_BASE`+`MIXMAPP_MEDIA_BASE`） | `index-BY07yhrl.js` | **246,940** | `3257d6c1…dd74` | 本轮 |
| 线上 `www.mixm.top` | `index-DtAsuT32.js` | **246,940** | `b5372452…cec79e3` | 2026-11-22 发布 |

- APK ↔ 本地无 env 构建：**同名、同字节、同 SHA** ⇒ 逐字节可证"APK 就是当前源码树（含未提交 index.html）的产物"。
- 本地带 env ↔ 线上：**字节数完全相同（246,940）**，但 44 处 `__vite__mapDeps.viteFileDeps` 的懒加载 chunk 名不同（345 个字符差异全部落在这 44 段里，长度一致）⇒ 不是逐字节同一份产物。
- **结论**：APK 与 HEAD 一致（可证）；线上与 HEAD"极可能是同一源码 + 不同构建环境/注入参数"，但**不能用哈希证明**。这是本轮唯一"看起来已闭环、实际只能给间接证据"的项。要定论，需要线上 release 的构建输入记录（本机无 SSH，取不到）。

### 6.4 线上商品目录实测（原始输出 `repo/catalog-probe.txt`）

```
GET /mall/products?limit=1000 -> count=20
priceFen=0: 10   stock=0: 20
EG=10  浙宝005=7  美沁=2  欣美人=1
```

### 6.5 文档 26 条超实现里"文档写了代码没有"的硬名单

支付已接入 / 后台一一对应 / PWA / 页面 6 个 / 测试 68 例 / CI 自动回滚 / 小程序可发布 / 鸿蒙可发布 / `/ai/research` 后端 / Gitee 镜像在跑 —— **10 条**。

---

## 7. 无法核实清单（缺什么凭据）

| 项 | 为什么核不了 | 缺什么 | 现有间接证据 |
|---|---|---|---|
| 生产机 `releases/current` 实际指向 | 无 SSH | `DEPLOY_HOST`/`DEPLOY_USER`/有效私钥 | deploy 日志 `▶ 发布 20261122005721（上一版：…20261121191911）` + 6 条断言对 www 全过 |
| 库内 `schema_migrations` 到哪一条 | 无 SSH / 无库连接串 | 同上 + 数据库凭据 | 日志 `已应用: 0021_device_context.sql`；CI migrate 0001–0021 |
| 生产 nginx 实际 conf 是否 = 仓库蓝本 | 无 SSH | 同上（需 `nginx -T` 导出） | 线上 healthz/meta 200 只能证明服务在跑，反推不出 conf 全文 |
| 生产 `ADMIN_TOKEN` 是否配置 | 无凭据 | 同上 | 匿名侧 `/admin/*`、`/admin/console/*` 均 404（配没配在匿名侧表现相同） |
| 线上 H5 对应哪个 commit | 产物不可复现比对 | 线上 release 的构建输入记录 | §6.3 字节级间接证据 |
| `stock=0` 时下单是否被拦 | 需登录态 | 可用测试账号 | `/mall/products` 已证库存为 0 |
| 安装向导 12 步 | 本轮未跑 | — | `install/server.mjs` + `ui.html` 在仓 |
| 小程序提审 / 鸿蒙上架 | 无 AppID / 无 DevEco | 微信 AppID、DevEco Studio | 产物已在 |

---

## 8. 变更与提交范围（本轮）

- **只新增**：`docs/43-project-closeout-audit-2026-11-23.md`（本文）。
- **不改**：任何功能代码、nginx 蓝本、workflow、`pages.json`、`.gitignore`、`README.md`、在途 4 文件。
- 提交信息：`docs: 全项目闭环审计（12 维对账 + 文档/代码差异 + P0/P1/P2 清单）[skip ci]`。
- 提交前门禁已复跑：`repo-lint` ✓、`pnpm verify` ✓（§6.2）。

---

## 9. 附录 A：本轮实际执行的命令与原始输出（节选）

> 完整原始件在 `ui-review/audit-2026-11-23/{api,frontend,android,ci,docs,repo}/`。

```powershell
# 1) 仓库与工作区状态
git status --porcelain=v1
#  M apps/app/index.html
#  M docs/android-build.md
# ?? docs/37-brand-logo-font-audit-2026-11-21.md
# ?? docs/mall-list-fixed-2026-11-21.png
git log --oneline -3
# df6e6a6 docs: 设备与网络快照实施说明与收尾回填 [skip ci]
# 83ca179 feat(device): 设备与网络快照（原生桥 + 服务端落库/API + 我的页与后台展示）
# 5631094 feat(deploy): 一键自动部署引擎（8 阶段 + 断言失败自动回滚 + 发布台账）
git remote -v
# origin https://github.com/afdk1991/MixmAPP.git (fetch/push)   ← 无 gitee remote

# 2) workspace 与派生目录
Get-Content pnpm-workspace.yaml      # packages: apps/*, services/*, packages/*
Test-Path turbo.json                 # False
# core / modules / archive: items=0（空目录）
# cloudbase: 7 个 .sql 历史迁移
# tools: 11724 文件 2193.5 MB（其中 hznzcn-importer 10461 文件、被 .gitignore:43 排除）

# 3) 入库面
git ls-files docs      # 179
git ls-files ui-review # 0
git ls-files reports   # 0
git ls-files tools     # 8
# .gitignore:27 .secrets/  :43 tools/hznzcn-importer/  :53 /ui-review/  :54 /reports/  :60 docx

# 4) 线上探测（必须 -L：mixm.top 301 → www.mixm.top）
curl.exe -sL https://mixm.top/
#   <link rel="icon" href="/static/logo.png" />
#   <script type="module" crossorigin src="/assets/index-DtAsuT32.js"></script>
#   <link rel="stylesheet" crossorigin href="/assets/index-C9MP1rlz.css">
#   <script>window.__MIXMAPP_MEDIA_BASE__="https://img.mixm.top";</script>
curl.exe -s https://api.mixm.top/mixmapp/api/v1/meta
# {"version":"0.0.2","env":"production","thirdParty":{...,"wechatPay":"off","alipay":"off"},
#  "mall":{"demoMode":false},"catalogSource":{"source":"db","active":false,"productCount":0,...}}

# 5) 门禁
node scripts/repo-lint.mjs   # ✓ 规则检查通过
pnpm verify                  # 全部通过 67.8s
pnpm test                    # api 175 passed | 9 skipped (184)；ids 11 passed

# 6) 三端构建（frontend 线实跑，exit 0）
pnpm build:h5         # dist/build/h5           60 文件  803,998 B；index-8BK037kq.js 246,905 B
pnpm build:mp-weixin  # dist/build/mp-weixin   105 文件  582,155 B；app.json 15 页 / tabBar 4
pnpm build:harmony    # dist/build/app-harmony  48 文件 1,450,266 B；无 .hap
pnpm build:api        # services/api/dist        7 文件  430,715 B

# 7) 带生产 env 重建（主控线补做，用于 §6.3）
$env:MIXMAPP_API_BASE='https://api.mixm.top/mixmapp/api/v1'
$env:MIXMAPP_MEDIA_BASE='https://img.mixm.top'
pnpm build:h5
# [h5] 已注入 API 源（跨域绝对源，来源 MIXMAPP_API_BASE）
# [h5] 已注入媒体源：https://img.mixm.top
# 主包 -> index-BY07yhrl.js 246,940 B / SHA-256 3257d6c1…dd74（线上 246,940 B / b5372452…cec79e3）

# 8) Android
Get-FileHash apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
# a95698c2…0444e / 4,736,066 B
Get-FileHash apps/mobile/android/app/build/outputs/apk/release/app-release.apk
# dce30b39…7da47 / 3,530,507 B
apksigner verify --print-certs app-release.apk     # CN=MixmAPP… / SHA-256 7fb86824…386e69
adb shell am force-stop top.mixm.app; adb shell am start -W -n top.mixm.app/.MainActivity
# TotalTime: 1417 / 1155 ms；Status: ok；logcat 无 FATAL EXCEPTION

# 9) 目录体积
# ui-review 508/62.7 MB | reports 10/0.2 MB | tools 11724/2193.5 MB
# out 16970/200.1 MB | release 6819/219.3 MB | storage 6714/1264.4 MB | 2026-11-14 1719/325.3 MB
```

## 10. 附录 B：证据索引

| 维度 | 证据位置（均在本机，未入库） |
|---|---|
| API 端点/假实现/支付规模/降级/nginx | `ui-review/audit-2026-11-23/api/{routes.md,fake-impl.md,payment-scale.md,runtime-and-network.md,README.md}` + `endpoint-list.txt`、`raw-todo.txt`、`sql-migrations.txt`、`test-files.txt` |
| 前端页面/三端构建/后台 | `ui-review/audit-2026-11-23/frontend/{pages.md,builds.md,admin.md}` + `build-*.log`、`mp-app.json`、`online-index.{html,js,css}` |
| Android | `ui-review/audit-2026-11-23/android/{audit-summary.md,meta.md,threeway.md,coldstart.md}` + `badging-*.txt`、`apksigner-*.txt`、`coldstart.png`、`online-index-DtAsuT32.js` |
| CI/部署 | `ui-review/audit-2026-11-23/ci/{workflows.md,runs.md,deploy-chain.md}` + `run-{ci,android,deploy,ops-nightly}-*.log` |
| 文档 | `ui-review/audit-2026-11-23/docs/{numbering.md,links.md,version.md,overclaim.md,laal.md,stale-claims.md}` + `check-links.ps1` |
| 主控线（仓库/网络/门禁） | `ui-review/audit-2026-11-23/repo/{live-probe.txt,gates.txt,tests.txt,catalog-probe.txt,rebuild-env-proof.txt,root-files.txt,topdirs.txt}` |

---

## 11. 与上一轮（`ui-review/device-recheck-2026-11-22`）的差异

| 上一轮结论 | 本轮修正 | 依据 |
|---|---|---|
| `GET /auth/me` 未带 token → 401 | 该路由不存在，正确路径 `/me` → 401 | `routes/auth.ts:24-93`；实测 §6.1 |
| IP 可被 XFF 伪造（服务端问题） | 根因在仓库 nginx 蓝本 6 行（`api:53,66` 等），且后端取首跳 | `infra/nginx/*.conf`；`lib/device-context.ts:71-76` |
| 后台"会话不回填" | 保留，并升级为 P0-3（后端 17 条路由前端零入口，不只是回填问题） | `pages/admin/index.vue`、`client.ts:745` |
| 支付回写 / `payments.order_id` 仍开放 | 保留，并给出 9–11 文件 / 200–350 行 / 迁移 0022 的规模判断 | `api/payment-scale.md` |
| 线上"商城 demoMode=true" | **已漂移为 false** | `/meta` 实测 |
| 线上"0 商品"的印象 | **不成立**：20 条商品，但全部 `stock=0`、半数 `priceFen=0` | §5.4 实测 |

---

## 12. 补充：laal.top 索引（不计入分母，仅留痕）

- 引用位置：`deploy/domains.json`（45 主机 + `forbiddenStrings`）、`scripts/domains.mjs:10,18,110`（禁止性门禁）、`docs/08:55,82`、`docs/14:9,119`、`reports/laal-top-settings-20261120/`（**未入库**，`git ls-files reports` = 0）。
- 现状：外部 WordPress 7.1.5 + zibll，0 商品 / 0 订单 / 1 用户 / 凭证全空 / 主题曾被切到 twentytwentyfive 再切回，来源未定位。
- 定性：**外部站点，不参与本仓库闭环口径**；若要跟踪，在该站点自己的交付文档里跟踪。

---

*本文档为本轮唯一新增文件。所有行号与命令输出均为 2026-11-23 当日实测或当日读码所得；凡标"无法核实"的，均已在 §7 写明缺什么凭据。*
</content>
