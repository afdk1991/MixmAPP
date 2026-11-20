# Mim 项目审计：自研工具 · 外观配置 · 内容运营 · 安全加固

- 审计日期：2026-11-14
- 审计仓库：`F:\合并项目\Mim`，本地 HEAD `f441dbb`（refactor(web): 统一搜索说明文案同步改为社区商城）
- 审计性质：**只读审计**，未改业务代码、未提交任何变更；仅运行既有测试与读取源码。
- 审计范围：A 自研工具 / B 外观配置 / C 内容运营 / D 安全加固，共四大域 22 个能力项。

## 0. 线上可用性前提（2026-11-14 复核）

生产环境 `https://mim.mixm.top` 当前**不可用**，本次审计**未执行任何线上 curl / 登录主机**：

1. TLS 证书 `CN=cloud.mixm.top`，与 `mim.mixm.top` 不匹配，正常 HTTPS 握手失败。
2. `curl -k /health` 返回 200 但 body 为 SPA HTML；`/api/v1/*` 全部 404（自有 `NOT_FOUND` 信封），疑似 mim-api 路由未挂或反代上游指错。
3. CI 最近「发布到生产服务器」步骤在 scp 上传部署脚本环节失败；本地无 SSH 私钥。

因此：**自研工具以 `node tools/test-all.mjs` 本地真实输出为硬证据；外观 / 内容运营 / 安全以「代码 + 本地测试」判定；线上证据栏统一标注「线上不可用（主机侧阻断）」，不把线上 200/404 作为完成度依据。**

## 1. 判定口径

四选一：

- **已完成并上线**：代码闭环、测试通过，且线上可验证（本次因线上阻断，无一项落入此档）。
- **代码完成·配置即启用**：代码与本地测试闭环，缺的只是环境变量 / 凭证 / 后台录入；列出具体变量名。
- **部分实现**：主干已写，缺某一环（前端 SDK、某类内容、某回写口径、后台入口等）。
- **未实现**：源码中无对应实现。

---

## 2. A. 自研工具

| 能力项 | 代码位置 | 测试 | 线上证据 | 判定 |
|---|---|---|---|---|
| A1 Quick Build WP（宣称「一键装宝塔 / 环境 / WordPress」） | `tools/quick-build-wp/cli.mjs`；`lib/plan.mjs`（计划模型）、`lib/render.mjs`（渲染 install.sh）、`lib/verify.mjs`（脚本自检）；`README.md` | `tools/quick-build-wp/test/cli.test.mjs`，**7 例全部通过**（本次真实运行，见 §5.1） | 线上不可用（主机侧阻断） | **部分实现**：工具本体可本地跑；但**并不安装宝塔面板**——计划只走 Debian/Ubuntu apt 安装 Nginx / MySQL / PHP + WordPress，无任何 `bt` 面板安装命令；README / 注释所称「宝塔式 / 宝塔系 apt 环境」是措辞包装。产物为一份幂等 `install.sh`（支持 `--dry-run`），由运维在 Linux 主机上执行，工具本身不远程装环境。CLI：`--plan`（输出 JSON 计划）、`--emit <out.sh>`（生成脚本）、`--verify <script.sh>`（自检 + 拒绝危险命令 / 缺能力脚本）。 |
| A2 数据库批量替换 / 换域名插件 | `tools/db-replace-domain/cli.mjs`；`lib/replace.mjs`（文本替换 + PHP 序列化长度重算）、`lib/sqlite.mjs`（SQLite 读写）；`README.md` | `tools/db-replace-domain/test/cli.test.mjs`，**8 例全部通过**（本次真实运行） | 线上不可用（主机侧阻断） | **部分实现**：CLI `--dry-run` / `--apply --sql <file>` / `--sqlite <file>` + 旧/新域名；apply 生成 `.bak` 备份、二次 apply 幂等。边界：① **不直连 MySQL**，只处理 `.sql` 文本导出文件与 SQLite 文件，README 种子摘要里的「MySQL 批量查找替换」口径偏大；② PHP 序列化只重算 `s:<字节长度>:"..."` 字符串长度，不解析 `O:` 对象、嵌套数组的结构长度；③ 无 Web 界面，纯命令行。 |
| A3 流盾 WAF（开源免费防护） | `tools/liudun-waf/cli.mjs`；`lib/waf.mjs`（Node 反代网关）、`lib/nginx.mjs`（nginx 配置渲染）、`rules.json`（正则规则集）；`README.md` | `tools/liudun-waf/test/waf.test.mjs`，**10 例全部通过**（本次真实运行） | 线上不可用（主机侧阻断） | **部分实现**：CLI 两种形态——`--listen --upstream [--rules --log --dry-run]` 起 Node 反代网关；`--emit-nginx <out.conf>` 生成等价 nginx 配置（`limit_req_zone` + 规则 map + `proxy_pass`）。能力为正则匹配（SQLi / XSS / 路径穿越 / 敏感文件探测）+ 滑动窗口 CC 限流 + IP 白名单 + JSONL 日志。边界：**不是入侵检测 / 语义分析引擎**，无规则学习、无持久规则同步；平台 mim-api 进程内**未挂载该 WAF**，需独立部署在反向代理层。 |
| A4 自研工具在社区的 `/tools` 入口（目录 / 元数据分发 vs 工具本体可执行） | 后端 `services/mim-api/src/routes/tools.ts`（公开清单 / 详情 / 检索过滤 / 管理 CRUD）；种子 `src/schema.d/21-tools.sql`；前台 `apps/web/src/views/Tools.tsx`；管理端 `apps/admin/src/views/ToolsAdmin.tsx` | `services/mim-api/test/tools.test.ts`，**9 例通过**（本次 vitest 真实运行，见 §5.2） | 线上不可用（主机侧阻断） | **部分实现**：**目录 / 元数据分发已完成**（三条种子工具、标签 / 版本记录 / 检索 / 管理增删改 / 401·403·409·400 门禁）；**工具本体的可执行产物分发未完成**——种子 `download_url=/tools/<slug>/download`、`doc_url=/docs/<slug>` 在后端**无对应路由**（`tools.ts` 仅有 list/detail/manage CRUD），前台 `Tools.tsx:221-222` 把它们渲染成普通 `<a>` 标签，点击为死链；mim-api 源码中无 `child_process` 调用三款工具（仅 ffmpeg），平台不托管脚本产物。 |

### A 域边界小结

- 三款工具均为**纯 Node、零新增依赖**的本地 CLI，单元测试闭环（25 例），`node tools/test-all.mjs` 为统一入口。
- 「平台发布到社区」目前等于**上架一张带版本记录的目录卡片**，不等于「可在站点内下载并运行工具」。
- 工具与平台之间无运行时集成：没有安装向导回写、没有批量替换的站点内调用、没有 WAF 挂到站点入口。

---

## 3. B. 外观配置

| 能力项 | 代码位置 | 测试 | 线上证据 | 判定 |
|---|---|---|---|---|
| B1 导航配置（导航项文案 / 可见性覆盖） | 后端 `routes/appearance.ts:59` `PUT /appearance/settings`（权限 `appearance:write`）；配置存 `site_settings` 键 `theme`（`schema.d/20-appearance.sql`）；前台 `apps/web/src/appearance.ts` `mergeNavItems()`；消费点 `apps/web/src/App.tsx` | `test/appearance.test.ts`，**7 例通过**（本次真实运行） | 线上不可用（主机侧阻断） | **代码完成·配置即启用**：后台可经 API 存 `theme.nav_items`，前台用配置项覆盖默认导航的 label / visible。缺口：**admin 控制台无外观编辑页**（`apps/admin/src/views/` 无 Appearance/Theme 视图），只能靠 API 或种子改配置。 |
| B2 背景配置 | 同上，`theme.background` → `--bg`；前台 `appearance.ts` `applyThemeVars()` 写 CSS 变量；消费 `apps/web/src/styles.css:33,468,802…` `var(--bg)` | 含在 `appearance.test.ts` 7 例内（主题回落 / 写后生效） | 线上不可用（主机侧阻断） | **代码完成·配置即启用**：后台可存、前台真渲染底色；同样缺 admin 编辑 UI。 |
| B3 配色配置（主色 / 圆角 / 字体） | `theme.primary` → `--primary`，`theme.radius` → `--radius`，`theme.font` → `--font-family`；`applyThemeVars()` 写变量；`styles.css` 大量 `var(--primary)` / `var(--radius)` 消费 | 同上 | 线上不可用（主机侧阻断） | **代码完成·配置即启用**：含兜底值（清空配置后前台仍拿到完整主题结构，测试覆盖「不白屏」）。 |
| B4 列表样式（card / list / compact） | `theme.listStyle` → `<div data-list-style={theme.listStyle}>`（`App.tsx:277`）；变体选择器在 `styles.css`；默认 card | 同上 | 线上不可用（主机侧阻断） | **代码完成·配置即启用**：三种样式数据集已透传，CSS 有 list / compact 变体规则。 |
| B5 可视化模块与页面搭建（前台是否真消费 `page_blocks`） | 后端 `routes/appearance.ts:69` `GET /pages/:page`（公开只读）、`POST/PUT/DELETE /pages/:page/blocks`、`PUT /pages/:page/reorder`；表 `page_blocks`（`20-appearance.sql`）；种子 5 块：`db.ts:880-887`（home hero/features/announcements、forum tabs、store product_grid）；前台 `apps/web/src/views/PageBlocks.tsx`，挂载于商城首页与社区页 | 同上（区块公开只读 / 空清单不报错 / 新建区块排序出现在公开清单） | 线上不可用（主机侧阻断） | **代码完成·配置即启用**：前台确实按 `page_blocks` 的 `kind` + `config` 渲染，不是只存不渲染。缺口：① admin 无可视化搭建编辑器；② 区块类型覆盖有限（hero/features/announcements/tabs/product_grid），未形成自由拖拽搭建器。 |
| B6 导航布局（nav_layout：top / side 等变体） | `theme.navLayout` → `data-nav-layout`（`App.tsx:277`） | 无独立测试 | 线上不可用（主机侧阻断） | **部分实现**：数据集已写入 DOM，但 `styles.css` 中**没有任何 `data-nav-layout` 选择器**（grep 0 命中），切换布局不会产生视觉差异——存得下、传得到、没渲染。 |

### B 域小结：后台能存 vs 前台真渲染

- **真渲染**：主色、底色、圆角、字体、列表样式、导航项覆盖、页面区块。
- **只存不渲染 / 半成品**：导航布局变体（无 CSS 分支）；外观与区块的**后台可视化编辑入口整体缺失**，写操作只能走 API（`appearance:write`）。

---

## 4. C. 内容运营

| 能力项 | 代码位置 | 测试 | 线上证据 | 判定 |
|---|---|---|---|---|
| C1 产品公告 | 后端 `routes/content-ops.ts`；`src/content/announcements.ts`（公开口径：`status='published'` + 有效期内，置顶优先）；种子 `schema.d/08-announcements-project-content.sql`；前台 `apps/web/src/views/AnnouncementBar.tsx`；管理端 `apps/admin/src/views/ContentOps.tsx` | `test/content-ops.test.ts`，**29 例通过**（本次真实运行）：公开列表 / 草稿过期过滤 / limit / 状态流转（草稿→发布→归档→重发）/ 409 / 404 / 鉴权门禁 | 线上不可用（主机侧阻断） | **代码完成·配置即启用**：CRUD、发布归档流转、置顶、有效期、权限点 `content:write`（兼容期认 `appearance:write`）闭环；种子有公告数据。 |
| C2 更新日志（版本聚合） | `src/content/changelog.ts`；路由 `/changelog`、`/changelog/versions`；种子 `07-content.sql` / `08-…sql`；前台 `apps/web/src/views/Releases.tsx` | 同上 29 例：语义版本倒序、版本聚合（每版本一条 + 条目数）、重复版本号 409、草稿不进公开列表 | 线上不可用（主机侧阻断） | **代码完成·配置即启用**。 |
| C3 推广计划（曝光 / 点击 / 转化回写） | `src/content/promotions.ts`；路由 `/promotions`、`POST /promotions/:slug/click`、`POST /promotions/:slug/conversion`；种子 `07-content.sql:123-125`；前台 `apps/web/src/views/ContentHub.tsx` | 同上 29 例：点击幂等去重、转化幂等去重、滑动窗口 429 + Retry-After、非进行中 / 不存在 404、管理端可见统计字段 | 线上不可用（主机侧阻断） | **部分实现**：**点击 `click_count`、转化 `conversion_count` 回写已完成**（幂等键 + 频控 + 窗口上限）；**曝光（impression）未实现**——`promotions` 表无曝光字段（`07-content.sql` 仅 `click_count` / `conversion_count`），无曝光上报端点，前台也无曝光埋点。预算 `budget_cents` 仅作统计展示，不产生扣款。 |

### C 域小结

- 公告、更新日志两条线代码与测试闭环；推广线缺「曝光」这一环，宣传口径「曝光 / 点击 / 转化回写」目前只兑现后两者。

---

## 5. D. 安全加固

| 能力项 | 代码位置 | 测试 | 线上证据 | 判定 |
|---|---|---|---|---|
| D1 图片验证码（本地自研） | `src/security.ts` `issueCaptcha()` image 分支（SVG 题目 + 答案一次性消费）、`verifyCaptcha()`；签发路由 `GET /auth/captcha?scene=`（`routes/security.ts:60`）；校验在业务端点内联完成——注册 / 登录 / 发码走中间件 `middleware.ts:333` `requireCaptcha`，发帖 `routes/community.ts:551`，举报 `routes/security.ts:71`；**无独立 `/auth/captcha/:id/verify` 端点**。前台 `apps/web/src/views/Login.tsx:206-224`（SVG 渲染 + 输入 + 换一张） | `test/security-captcha.test.ts` 9 例 + `test/security-captcha-enforce.test.ts` 7 例，**本次真实运行全部通过** | 线上不可用（主机侧阻断） | **代码完成·配置即启用**：本地自研、无外部依赖；模式变量 `MIM_CAPTCHA_MODE=image`，场景开关 `MIM_CAPTCHA_REGISTER/LOGIN/REPORT/POST`（旧 `MIM_CAPTCHA_REQUIRED=1` 视为全场景强制）。 |
| D2 滑动验证码（本地自研） | `security.ts` slider 分支（背景 SVG + 缺口位置，不下发目标 x；容差内通过、一次性消费）；前台 `Login.tsx:226-251` 指针拖拽记录 `slider_x` | 同上 16 例（签发不下发 x、容差通过 / 超差失败 / 防重用、登录缺票据 400） | 线上不可用（主机侧阻断） | **代码完成·配置即启用**：`MIM_CAPTCHA_MODE=slider`。 |
| D3 腾讯验证码（TCaptcha） | `security.ts` `verifyTencent()`（ticket / randstr 服务端二次校验；缺凭证抛 `PROVIDER_NOT_CONFIGURED` 503）；凭证变量 `MIM_TENCENT_CAPTCHA_APP_ID`、`MIM_TENCENT_CAPTCHA_SECRET_KEY` | `security-captcha.test.ts` 含「tencent 未配置密钥：签发与校验均抛 503」1 例 | 线上不可用（主机侧阻断） | **部分实现**：**后端校验适配器已写**；**前端未接入 TCaptcha JS SDK**——`Login.tsx:257-265` 仅渲染占位提示「腾讯验证码组件待加载完成后在此弹出」，票据 state 留空待回调。另见 §6 环境变量名不一致问题。 |
| D4 极验 4.0（GeeTest v4） | `security.ts` `verifyGeetest4()`（lot_number / captcha_output / pass_token / gen_time 四元组校验；缺凭证 503）；凭证变量 `MIM_GEETEST4_CAPTCHA_ID`、`MIM_GEETEST4_CAPTCHA_KEY` | `security-captcha.test.ts` 含「geetest4 未配置密钥：签发与校验均抛 503」1 例 | 线上不可用（主机侧阻断） | **部分实现**：同 D3，后端适配器已写，**前端 SDK 挂载未实现**（占位提示）。 |
| D5 百度内容审核（文本 + 图片） | `security.ts` `auditText()`（text_censor v2）、`auditImage()`（图片公网 URL 审核）；凭证 `MIM_BAIDU_AUDIT_API_KEY`、`MIM_BAIDU_AUDIT_SECRET_KEY`；降级 `MIM_AUDIT_FALLBACK=open/closed`（缺省 closed）。文本接入点：`routes/community.ts`（帖子标题 / 摘要 / 正文 / 板块名）、`routes/assets.ts`（资产标题 / 摘要 / 正文）；图片接入点：**仅** `routes/assets.ts:236` | `test/security-audit.test.ts` **4 例通过**（本次真实运行）：未配置 provider=none 放行不伪装已审核；双密钥齐备才 configured；fallback 缺省 closed；status 如实回显 | 线上不可用（主机侧阻断） | **部分实现**：适配器与降级语义闭环；但① **图片审核覆盖不全**——社区图集 / 剧集封面 / 剧集 `media_url`、帖子 `cover_url` 未走 `auditImage`，仅资产库图片接入；② 双密钥未配置时 `provider=none` 直接放行（如实回显，不伪装已审核）；③ 两个百度密钥变量**未在 `.env.example` 登记**（见 §6）。 |
| D6 举报频率限制 | `security.ts` `slidingWindow()`（共享缓存后端，Redis / 内存降级同一语义）；路由 `POST /reports`（`routes/security.ts:68`）：先 report 场景验证码 → 用户+目标滑动窗口 → 目标存在性 / 自举报校验；变量 `MIM_REPORT_LIMIT`（缺省 5）、`MIM_REPORT_WINDOW_MINUTES`（缺省 1440） | `test/security-report-limit.test.ts` **4 例通过**（本次真实运行）：窗口内超限 429、不同目标分别计数、索引巡检只读 | 线上不可用（主机侧阻断） | **代码完成·配置即启用**。 |
| D7 防 SSRF | `security.ts` `assertSafeOutboundUrl()` / `assertPublicHttpUrl()`（禁 localhost / .local / 私网 IPv4·IPv6 / 非 http(s)）、`safeOutboundFetch()`（手动跟随重定向，**逐跳复核 Location**，最多 5 跳）；调用点：`navigationProbe.ts`、`routes/assets.ts:38`、`routes/community.ts:545`、`routes/media.ts:151` | `test/security-ssrf.test.ts` **19 例通过**（本次真实运行） | 线上不可用（主机侧阻断） | **代码完成·配置即启用**：含重定向链防绕过；AI 提供商基址另走 `assertProviderBaseUrl`（http 需 `MIM_AI_ALLOW_INSECURE_BASE=1` 显式放开）。 |

### D 域关键口径：验证码四类，哪些本地可用

| 类别 | 本地自研可直接用 | 待凭证 / 待 SDK |
|---|---|---|
| 图片 image | ✅ 完整闭环（出题 SVG + 校验 + 前端交互） | — |
| 滑动 slider | ✅ 完整闭环（拼图背景 + 拖拽 + 容差校验） | — |
| 腾讯 tencent | ❌ | 后端适配器待凭证；前端 JS SDK 未挂载（占位） |
| 极验 geetest4 | ❌ | 后端适配器待凭证；前端 JS SDK 未挂载（占位） |

**`MIM_CAPTCHA_MODE` 现状**：代码缺省为 `off`；本地 `.env` 未设置任何 `MIM_` 变量（grep 0 命中），即本地模式 off、所有场景不强制；按代码缺省与 0.0.9 既有行为，**线上实际也应为 off**（线上阻断未能实测 `GET /security/status` 复核）。`/security/status` 会如实回显 `captcha.mode / required_scenes / providers.*` 与 `content_audit / audit.provider / fallback`，不夸大已接入能力。

### D 域相邻测试（本次未运行，仅登记用例数）

| 测试文件 | 用例数 | 覆盖点 |
|---|---|---|
| `test/security-guest-limit.test.ts` | 2 | 访客频控共享缓存单例、跨实例计数一致 |
| `test/security-cache.test.ts` | 8 | 缓存后端适配 / 降级 |
| `test/security-cdn.test.ts` | 11 | CDN 配置回显 / 刷新审计（`/security/cdn` 需 `commerce:write`，匿名 401 为预期） |

---

## 6. 发现的不实 / 夸大描述与缺口清单

1. **「一键装宝塔」不实**：Quick Build WP 只生成 apt 系 `install.sh`（Nginx/MySQL/PHP/WordPress），不含宝塔面板安装命令；工具也不远程执行，脚本需人工上主机运行。
2. **「MySQL 批量查找替换」口径偏大**：db-replace-domain 不直连 MySQL，仅处理 `.sql` 文本导出与 SQLite 文件；PHP 序列化只重算 `s:` 字符串长度，不处理 `O:` 对象 / 嵌套数组结构长度。
3. **「流盾 WAF 开源免费防护」被高估**：本质是正则规则集 + 进程内滑动窗口限流的 Node 反代 / nginx 配置生成器；无语义检测、无规则学习；平台进程未挂载该网关。
4. **工具下载 / 文档链接为死链**：种子 `/tools/<slug>/download`、`/docs/<slug>` 后端无路由；平台不托管产物，`/tools` 目录只是元数据卡片。
5. **腾讯 / 极验「已支持」只兑现一半**：服务端票据校验适配器 + 缺凭证 503 已写，前端官方 JS SDK 未挂载（占位提示），真实出码弹窗不会出现。
6. **环境变量名不一致（配置即启用的隐患）**：
   - 代码读 `MIM_TENCENT_CAPTCHA_APP_ID` / `MIM_TENCENT_CAPTCHA_SECRET_KEY`；`.env.example` 写的是 `MIM_CAPTCHA_TENCENT_APP_ID`，且无 secret 示例行。
   - 代码读 `MIM_GEETEST4_CAPTCHA_ID` / `MIM_GEETEST4_CAPTCHA_KEY`；`.env.example` 写的是 `MIM_CAPTCHA_GEETEST_ID` / `MIM_CAPTCHA_GEETEST_KEY`。
   - `MIM_BAIDU_AUDIT_API_KEY` / `MIM_BAIDU_AUDIT_SECRET_KEY` 在 `.env.example` 中**完全未登记**。
   - `MIM_CAPTCHA_MODE`、`MIM_CAPTCHA_REGISTER/LOGIN/REPORT/POST` 在 `.env.example` 中**未登记**。
   - 按示例文件填值，第三方提供商不会被识别为已配置。
7. **百度图片审核覆盖不全**：仅资产库图片接入；社区图集、剧集封面 / 媒体、帖子封面未接图片审核。
8. **推广「曝光」未实现**：无字段、无端点、无埋点；宣传的曝光 / 点击 / 转化回写只兑现点击 + 转化。
9. **外观后台无编辑入口**：导航 / 背景 / 配色 / 区块搭建均无 admin 页面，只能 API 或种子改；导航布局 `nav_layout` 写进 DOM 但 CSS 无变体选择器，切换不生效。
10. **性能口径未在本次四域取证**：宣传的「100ms 级响应、SQL 个位数查询」不在本审计范围，未做压测 / 慢查询复核。

---

## 7. 测试与原始输出

### 7.1 自研工具：`node tools/test-all.mjs`（本次真实运行，工作树 `F:\合并项目\Mim`）

```
=== quick-build-wp ===
1..7
# tests 7
# pass 7
# fail 0
PASS quick-build-wp

=== db-replace-domain ===
1..8
# tests 8
# pass 8
# fail 0
PASS db-replace-domain

=== liudun-waf ===
1..10
# tests 10
# pass 10
# fail 0
PASS liudun-waf

=== 汇总 ===
PASS  quick-build-wp
PASS  db-replace-domain
PASS  liudun-waf

3/3 PASS
```

合计 **25 例，25 通过，0 失败**（7 + 8 + 10）。原始 TAP 输出另存：`tools-test-raw.txt`（agent workspace）。

### 7.2 API 侧 vitest（本次真实运行，`services/mim-api`，`vitest run` 指定 8 个相关文件）

```
 ✓ test/security-ssrf.test.ts (19 tests) 26ms
 ✓ test/security-captcha.test.ts (9 tests) 957ms
 ✓ test/tools.test.ts (9 tests) 1154ms
 ✓ test/content-ops.test.ts (29 tests) 3552ms
 ✓ test/security-audit.test.ts (4 tests) 529ms
 ✓ test/security-report-limit.test.ts (4 tests) 1073ms
 ✓ test/appearance.test.ts (7 tests) 2388ms
 ✓ test/security-captcha-enforce.test.ts (7 tests) 2592ms

 Test Files  8 passed (8)
      Tests  88 passed (88)
   Duration  20.88s
```

合计 **88 例，88 通过，0 失败**。用例分布：tools 9 / appearance 7 / content-ops 29 / audit 4 / captcha 9 / captcha-enforce 7 / report-limit 4 / ssrf 19。

### 7.3 线上接口实测记录

**本次未执行线上请求**（依据 2026-11-14 主机侧阻断复核）。代码侧契约备查：

| 端点 | 鉴权 | 代码位置 | 本次线上实测 |
|---|---|---|---|
| `GET /api/v1/tools` | 公开 | `routes/tools.ts` | 未测：线上阻断 |
| `GET /api/v1/tools/:slug` | 公开 | 同上 | 未测：线上阻断 |
| `GET /api/v1/announcements` | 公开 | `routes/content-ops.ts` | 未测：线上阻断 |
| `GET /api/v1/changelog` / `/changelog/versions` | 公开 | 同上 | 未测：线上阻断 |
| `GET /api/v1/promotions` | 公开 | 同上 | 未测：线上阻断 |
| `GET /api/v1/security/status` | 公开 | `routes/security.ts:40` | 未测：线上阻断（代码缺省回显 mode=off、provider=none） |
| `GET /api/v1/appearance` | 登录态 | `routes/appearance.ts:44` | 未测：线上阻断；公开主题读取走 `GET /api/v1/site/config` |
| `PUT /api/v1/appearance/settings` | `appearance:write` | `routes/appearance.ts:59` | 未测：线上阻断 |
| `GET /api/v1/pages/:page` | 公开 | `routes/appearance.ts:69` | 未测：线上阻断 |

---

## 8. 结论

- **可本地跑通的硬闭环**：三款工具 CLI（25 例）；图片 / 滑动验证码、举报限频、SSRF、公告、更新日志、推广点击 / 转化、外观主题变量与区块前台渲染、工具目录元数据（API 侧 88 例通过）。
- **主要缺口集中在「最后一公里」**：第三方验证码前端 SDK、百度图片审核的社区覆盖、推广曝光回写、外观后台编辑 UI、平台内工具产物分发、环境变量口径对齐。
- **线上完成度无法判定**：生产主机侧阻断，待部署链路修复后，应按 §7.3 端点清单补一轮线上实测（含 guest 令牌鉴权接口）。
