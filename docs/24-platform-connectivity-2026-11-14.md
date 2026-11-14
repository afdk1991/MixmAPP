# 24 · 全平台连通性审计与启用矩阵（2026-11-14）

> 审计口径：只认「这个端发出去的请求，服务端会不会回给它」。构建能过不算通，必须核对源 origin、请求地址、跨域判定与响应头。
> 审计环境：Windows 本机（PowerShell），Node 22.23.2 / pnpm 9.12.0；仓库 `F:\合并项目\MixmAPP`。
> 边界：本次未改 `services/api/` 任何源码；未向任何外部平台推送 / 发布 / 部署；未改 `version.json`。

## 0. 编号说明

任务书原定本文编号 **23**。入库时发现 `docs/23-项目接管报告-2026-11-14.md` 已被提交占用（commit `6f631d4`），而仓库规则 `scripts/repo-lint.mjs` 第 6 条要求 `docs/NN-*.md` 编号唯一、撞号即失败。为不与既有文档撞号，本文取当前最大号之后的空号 **24**；若后续要改回 23，需先把那篇接管报告改名/挪号。

---

## 1. 结论摘要

### 1.1 已通 / 基本通

| 端 | 结论 | 依据 |
|---|---|---|
| 生产 H5（同域自托管 `https://cloud.mixm.top/`） | ✅ 同源，不跨域 | 首页 200；API `https://cloud.mixm.top/mixmapp/api/v1/healthz` 200，`db=ok` |
| 本地源码实例的 CORS 中间件 | ✅ 源码层已放行壳源 | 本机 tsx 实例带 `Origin: https://localhost` 请求，响应回 `access-control-allow-origin: https://localhost`（GET 与预检均回） |
| GitHub 仓库 + Actions 部署链路 | ✅ 凭据齐备 | `gh auth` 登录 `afdk1991`；部署 SSH 私钥/主机/用户 secret 与两个仓库变量均已配置 |
| Android 壳的 API 源注入 | ✅ 注入正确 | 壳内 `index.html` 与本次新构建产物均含 `window.__MIXMAPP_API_BASE__="https://cloud.mixm.top/mixmapp/api/v1"`；`android-inject-base.mjs --check` 通过 |

### 1.2 不通 / 阻塞（按优先级）

| # | 阻塞点 | 影响端 | 状态 |
|---|---|---|---|
| B1 | **线上 API 不回 `access-control-allow-origin`**：带浏览器 Origin 的请求只有 `vary: Origin` + `access-control-allow-credentials: true`，无 ACAO，浏览器层直接拒收 | Android 壳、所有第三方静态托管 H5、本地跨域调试 | 源码修复在工作区、**未部署到线上**；线上仍是旧构建 |
| B2 | **静态托管域名不在内置白名单**：内置只含 `https://localhost` / `capacitor://localhost` / localhost·127.0.0.1（含 5173）；`*.github.io`、`*.pages.dev`、`*.vercel.app` 等需服务端环境变量 `CORS_ORIGINS` 显式补充 | 第三方静态 H5 | 待服务端配置 + 重部署 |
| B3 | **Android 真机/模拟器不在场**：`adb devices` 列表为空，WebView 内探活与截图未做 | Android 壳真机验证 | 设备接入后补跑 `node scripts/android-smoke.mjs --require-api` |
| B4 | Cloudflare Pages / Vercel / Sealos / Gitee 缺凭据；IGA AK/SK 签名失效；EdgeOne CLI 已登录但仓库未接线 | 各静态/容器平台 | 见第 4 节矩阵与缺的 secret 名 |
| B5 | 微信小程序 `appid` 为空、未配 MP 后台合法域名；鸿蒙未在本机构建验证 | 小程序 / 鸿蒙 | 只能给结论，申请动作需账号侧完成 |

> 历史插曲（已自愈，留档）：审计初次构建 API 时，`packages/contracts/src/index.ts` 的 `specs` schema 用过 zod4 风格的 `z.record(...).max(32)`，而仓库声明/安装的是 zod 3.23.8（`ZodRecord` 无 `.max`），内存实例启动即 `TypeError: z.record(...).max is not a function`。审计期间该 schema 已被改为 `.refine(...)`，重建后报错不再复现。本次未改动 `packages/contracts/`。

---

## 2. 逐端连通性表格

跨域判定原则：H5 端跑在浏览器里，受同源策略约束；小程序 / App / 鸿蒙走原生网络栈，没有浏览器 CORS 概念，但受平台域名白名单与 TLS 约束。

| # | 端 | 源 origin | 请求地址 | 是否跨域 | 当前是否通 | 卡在哪 | 下一步确切命令 |
|---|---|---|---|---|---|---|---|
| E1 | H5 本地开发 `pnpm dev:h5` | `http://localhost:5173`（vite dev server） | 开发态前端直连 `http://127.0.0.1:8080/api/v1`（`client.ts` 的 DEV 回退）；vite proxy `/api` 只对**相对路径**请求生效 | 直连时 `localhost:5173 → 127.0.0.1:8080` 源不同，属跨域；走 proxy 相对路径则同源 | 本地 API 在线时可用（dev 默认 `CORS_ORIGINS=*` 反射任意源）；本轮未起独立 dev 浏览器实测 | 本地独立内存实例端口被另一会话的 tsx 实例占用；浏览器层未手测 | `pnpm dev:h5`；另开终端 `pnpm dev:api`；浏览器开 `http://localhost:5173`，DevTools Network 看请求头/响应头 |
| E2 | H5 产物本地预览 `node scripts/serve-h5.mjs` | `http://127.0.0.1:4173` | 预览服务把 `/api/*` 反代到 `API_ORIGIN`（默认 `http://127.0.0.1:8080`），页面与代理同源 | 同源，浏览器不触发 CORS | 取决于上游 API；代理链路本身同源无 CORS 问题 | 上游 API 需在线 | `node scripts/serve-h5.mjs`（可 `API_ORIGIN=https://cloud.mixm.top` 指线上） |
| E3 | H5 同域自托管（生产 web 入口） | `https://cloud.mixm.top` | 同域 `/mixmapp/api/v1`（相对路径，nginx `/mixmapp/` → 127.0.0.1:8080） | **同源，不跨域** | ✅ 通：首页 200，`healthz` 200 `db=ok` | 无 CORS 阻塞；登录态/下单另需有效 token | `curl.exe -s https://cloud.mixm.top/mixmapp/api/v1/healthz` |
| E4 | H5 第三方静态托管（GitHub Pages / CF Pages / Vercel / EdgeOne / IGA / Gitee Pages） | 托管域名，如 `https://afdk1991.github.io`、`https://<proj>.pages.dev`、`https://<proj>.vercel.app` | 绝对地址 `https://cloud.mixm.top/mixmapp/api/v1` | **跨域** | ❌ 不通：线上对这些源不回 ACAO（B1/B2） | ① 线上 API 部署含 CORS 修复的新构建；② 服务端 `CORS_ORIGINS` 加入各托管域名；③ 平台凭据（第 4 节） | 部署后：`curl.exe -s -o NUL -D - "https://cloud.mixm.top/mixmapp/api/v1/mall/products?pageSize=1" -H "Origin: <托管域名>"`，必须看到 `access-control-allow-origin: <托管域名>` |
| E5 | Android 壳（Capacitor，`androidScheme: https`） | `https://localhost`（旧版 Capacitor 可能为 `capacitor://localhost`） | 绝对地址 `https://cloud.mixm.top/mixmapp/api/v1`（已注入） | **跨域**（壳源 `https://localhost` → 云 API） | ❌ 不通：注入正确，但线上不回 ACAO，WebView 层拒收 → 全站离线 | B1：服务端放行 `https://localhost`（及 `capacitor://localhost`）并重部署；B3：真机不在场未做 WebView 实测 | 设备接入后：`node scripts/android-smoke.mjs --require-api`；放行验证：`curl.exe -s -o NUL -D - "https://cloud.mixm.top/mixmapp/api/v1/healthz" -H "Origin: https://localhost"` |
| E6 | iOS 壳（未在本机构建） | `capacitor://localhost`（默认 scheme） | 同 E5 | 跨域 | 未验证 | 同 B1；内置白名单已含 `capacitor://localhost` | 同 E5，需 macOS/Xcode 环境 |
| E7 | 微信小程序 | 无浏览器 origin；微信客户端发起 `uni.request` | 绝对 `https://cloud.mixm.top/mixmapp/api/v1` | 不走浏览器 CORS；受 MP 后台「request 合法域名」白名单 + HTTPS 约束 | ⏳ 未验证：`manifest.json` 的 `mp-weixin.appid` 为空，后台域名未配 | 缺小程序 AppID；需在 MP 后台把 `cloud.mixm.top` 加入 request 合法域名；开发期可在开发者工具关域名校验 | `pnpm build:mp-weixin`；微信开发者工具导入 `apps/app/dist/build/mp-weixin` |
| E8 | 鸿蒙（app-harmony） | 无浏览器 origin；原生网络栈 | 绝对 `https://cloud.mixm.top/mixmapp/api/v1` | 不走浏览器 CORS；需网络权限 + 服务端可达 | ⏳ 未在本机构建 | 缺 DevEco / 鸿蒙模拟器；域名放行在系统/应用配置层 | `pnpm build:harmony` |

### 2.1 鉴权维度（与跨域分开看）

- 公开接口（商品列表/分类、`healthz`、`meta`、注册/登录/发码）不要求 token；跨域放行之前，token 问题不会暴露。
- 登录后接口（购物车、订单、`/me`、管理面）需要 `Bearer <accessToken>`；管理面另需 `x-admin-token`。
- CORS 被拒时，请求在浏览器层就被拦下，登录态/token 根本到不了服务端——所以 E4/E5 的第一阻塞永远是 ACAO，不是缺 token。

---

## 3. CORS 根因与修复状态

### 3.1 现象（线上原始响应，2026-11-14 01:35 CST）

请求：

```powershell
curl.exe -s -o NUL -D - "https://cloud.mixm.top/mixmapp/api/v1/mall/products?pageSize=1" -H "Origin: https://localhost"
```

响应头（无 `access-control-allow-origin`）：

```text
HTTP/1.1 200 OK
Server: nginx
Date: Fri, 13 Nov 2026 17:35:45 GMT
Content-Type: application/json; charset=utf-8
Content-Length: 391
Connection: keep-alive
vary: Origin
access-control-allow-credentials: true
```

预检（OPTIONS）同样缺 ACAO：

```text
HTTP/1.1 204 No Content
Server: nginx
Date: Fri, 13 Nov 2026 17:35:53 GMT
Content-Length: 0
Connection: keep-alive
vary: Origin, Access-Control-Request-Headers
access-control-allow-credentials: true
access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE
access-control-allow-headers: content-type,authorization
access-control-max-age: 86400
```

逐源复测（线上，均无 ACAO）：

| `Origin` 请求头 | 业务状态 | `access-control-allow-origin` |
|---|---|---|
| `https://localhost` | 200 | 缺失 |
| `capacitor://localhost` | 200 | 缺失 |
| `http://localhost:5173` | 200 | 缺失 |
| `http://127.0.0.1:5173` | 200 | 缺失 |
| `https://mim.mixm.top` | 200 | 缺失 |
| `https://afdk1991.github.io` | 200 | 缺失 |

线上 `healthz` 正文（服务端本身健康，排除「服务挂了」）：

```json
{"status":"ok","version":"0.0.0-preview","uptimeSec":2279,"checks":{"db":"ok","dbTarget":"server","dbHost":"127.0.0.1:5432","dbSource":"DATABASE_URL_LOCAL","sms":"console","pay":"dev","storage":"dev","push":"dev","ai":"dev"},"time":"2026-11-13T17:41:47.582Z"}
```

### 3.2 根因链

1. 壳 WebView 从 `https://localhost` 加载本地 H5，请求打到 `cloud.mixm.top` 属跨域。
2. 跨域响应必须回 `access-control-allow-origin`（且当前 `credentials: true`，不能用 `*`，必须回显具体源）。
3. 线上部署的构建没有把壳源 / 各调试源纳入放行名单，浏览器拿不到 ACAO，直接拒收 → 全站离线。
4. 注入排查已排除另一根因：已装 APK 的 `assets/public/index.html` 里 `__MIXMAPP_API_BASE__` 注入正确，离线不是「地址没注入」造成的。

### 3.3 源码现状（只读核对，本次未改 `services/api/`）

- `services/api/src/config.ts`（工作区改动，另一会话负责）：内置恒定白名单 `BUILTIN_CORS_ORIGINS` =
  `https://localhost`、`capacitor://localhost`、`http://localhost`、`http://127.0.0.1`、`http://localhost:5173`、`http://127.0.0.1:5173`，并与环境变量 `CORS_ORIGINS`（逗号分隔）合并去重。
- `services/api/src/app.ts`：注册 `@fastify/cors`，`origin: corsOrigins.includes('*') ? true : corsOrigins`，`credentials: true`，`maxAge: 86400`。
- **差距**：上述修复在本地工作区，线上跑的还是旧构建；且第三方静态托管域名不在内置名单，需线上环境变量 `CORS_ORIGINS` 显式补充（逗号分隔，回显具体源，不可与 `credentials: true` 同用 `*`）。

### 3.4 本地源码实例实证

本机 8080 由另一会话的 tsx 开发实例占用（`tsx src/index.ts`，读当前工作区源码；本次未杀进程、未重启它）。带 Origin 实测：

```text
=== GET /api/v1/mall/products?pageSize=1, Origin: https://localhost ===
HTTP/1.1 200 OK
vary: Origin
access-control-allow-origin: https://localhost
access-control-allow-credentials: true
content-type: application/json; charset=utf-8
content-length: 391

=== OPTIONS 预检, Origin: https://localhost ===
HTTP/1.1 204 No Content
vary: Origin, Access-Control-Request-Headers
access-control-allow-origin: https://localhost
access-control-allow-credentials: true
access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE
access-control-allow-headers: content-type,authorization
access-control-max-age: 86400
```

其余源本地均回显 ACAO：`capacitor://localhost`、`http://localhost:5173`、`http://127.0.0.1:5173`、`http://localhost:8080`、`https://afdk1991.github.io`、`https://evil.example.com`。

> 注意：本地 `CORS_ORIGINS` 缺省为 `*`，`@fastify/cors` 以 `origin: true` 回显任意源，所以本地无法复现「名单外被拒」；名单收紧后的拒绝行为只有在服务端显式配置 `CORS_ORIGINS` 后才能验到。内置名单在本地是兜底，不是放通一切的依据。

### 3.5 唯一外部阻塞点

- **B1 上线**：把含 CORS 修复的 API 新构建部署到生产服务器（当前 `deploy` 工作流 SSH 凭据齐备，可由有权限的会话触发；本次按红线未部署）。
- **B2 补域名**：生产环境变量 `CORS_ORIGINS` 追加静态托管域名（Pages / CF / Vercel 等实际落地域名），壳源已在内置名单，无需重复加。

---

## 4. 平台启用矩阵

凭据核对口径：只查「凭据/登录态/远程/工作流引用的 secret 名」是否存在，**没有真去部署或推送**。✅ = 现在可直接跑对应只读/构建命令；⏳ = 缺列出的凭据；🔌 = CLI 在线但仓库未接线。

| 平台 | 用途 | 凭据现状（本机 / GitHub） | 引用到的 secret / 变量名 | 状态 | 补齐后可直接跑的命令 |
|---|---|---|---|---|---|
| GitHub 仓库 | 源码权威仓 | `git remote -v`：`origin https://github.com/afdk1991/MixmAPP.git`；`gh auth status` 登录 `afdk1991`，scope：`delete:packages, delete_repo, gist, read:org, repo, workflow, write:packages` | 内置 `GITHUB_TOKEN` | ✅ 可直接跑只读命令 | `gh repo view afdk1991/MixmAPP`；`git fetch origin` |
| GitHub Actions：deploy / ci / android / ops-nightly | 构建与发布门禁 | 工作流均 `active`；secret 已配：`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`、`DEPLOY_SSH_KEY_B64`；变量已配：`HEALTH_BASE_URL`、`MIXMAPP_API_BASE` | 已齐：`DEPLOY_SSH_KEY_B64`、`DEPLOY_HOST`、`DEPLOY_USER`；变量 `MIXMAPP_API_BASE`、`HEALTH_BASE_URL` | ✅ 链路凭据齐；线上 CORS 修复随 deploy 工作流上线 | 仓库 Actions 页手动 `deploy` workflow_dispatch；本地 `node scripts/healthcheck.mjs https://cloud.mixm.top/mixmapp` |
| Android release 签名 | AAB 签名发布 | gh secret list **未见** 签名四件套 | 缺：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` | ⏳ debug APK 可出；release AAB 走未签名告警路径 | 凭据进 GitHub secrets 后，`android.yml` 的 `Assemble release AAB` 步骤自动转签名构建 |
| GitHub Pages | 单文件 H5 公网 | `pages.yml` `active`；无额外 secret（内置 Pages 权限）；仓库变量 `MIXMAPP_API_BASE` 已配绝对源 | 无额外 secret；构建用变量 `MIXMAPP_API_BASE`、`MIXMAPP_H5_BASE` | ✅ 工作流可跑；⚠️ 落地域名 `https://afdk1991.github.io` 需加入服务端 `CORS_ORIGINS`（B2） | 本地预构建：`MIXMAPP_API_BASE=https://cloud.mixm.top/mixmapp/api/v1 MIXMAPP_H5_BASE=/MixmAPP/ node scripts/build-h5-single.mjs`；发布走 Actions `Pages` |
| GitHub Packages（ghcr） | 容器镜像 | `Image` 工作流 `disabled_manually`；用内置 `GITHUB_TOKEN`，无额外 secret | 内置 `GITHUB_TOKEN` | ⏳ 仅工作流被手动禁用；凭据不缺 | `gh workflow enable image.yml` 后由 push/tag 触发；镜像 `ghcr.io/afdk1991/mixmapp:latest` |
| Gitee 镜像 | 国内仓 + Gitee Go | 无 gitee remote（`git remote -v` 仅 origin）；本机无 Gitee token；`.gitee/pipeline.yml` 已就绪 | 缺：Gitee 私人令牌（仓库镜像授权 + Gitee Go 变量）；流水线内 `deploy-static.mjs` 另需 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | ⏳ | 配好 token 后：`git remote add gitee https://gitee.com/<账号>/MixmAPP.git`；Gitee Go 后台填变量 |
| Cloudflare Pages | 多文件静态托管 | `wrangler` CLI 未安装；本机环境无 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`；gh secrets 也未见 | 缺：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`；可选 `CF_PAGES_PROJECT`（脚本默认 `mixmapp`） | ⏳ `deploy-static.mjs`：缺 API 源 → 退出 1；缺 CF 凭据 → 显式 SKIP 退出 0 | 凭据补齐后：`$env:CLOUDFLARE_API_TOKEN='…'; $env:CLOUDFLARE_ACCOUNT_ID='…'; node scripts/deploy-static.mjs`（或 `npx wrangler pages deploy apps/app/dist/build/h5 --project-name=mixmapp`）；落地域名需进服务端 CORS 名单 |
| Vercel | 静态端 / Serverless | `vercel` CLI 未安装；本机无 token；仓库无 `vercel.json` | 缺：`VERCEL_TOKEN`；链接项目另需 `VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` | ⏳ | `npm i -g vercel`；`vercel login` 或配 token；首次 `vercel link` 后 `vercel --prod`；域名进 CORS 名单 |
| Sealos | 容器化部署 API | `sealos` CLI 未安装；本机无 Sealos kubeconfig / token；镜像已在 ghcr | 缺：Sealos 账号 kubeconfig（或部署 token / 应用安装凭据） | ⏳ 镜像就绪，部署凭据缺 | 装好 CLI 并 `sealos login` 后，拉 `ghcr.io/afdk1991/mixmapp:latest` 部署；配置 `JWT_SECRET`、数据库连接串等运行时变量 |
| EdgeOne Pages | 静态托管 | `edgeone` CLI 已登录：账号 `100033061933`，APPID `1320483685`；仓库无对应 workflow/脚本 | 本机登录态在；仓库侧未接 secret | 🔌 凭据本地在、链路未接线；历史结论：`deploy-html` 只接受内联 HTML，348KB 单文件以外的多文件产物不可行 | 走 EdgeOne Makers 插件/CLI 对接；先确认 Pages 是否支持多文件目录上传；落地域名进 CORS 名单 |
| IGA Pages | 静态托管 | `iga` CLI 存在；`~/.iga/auth.json` 有 AK/SK，但 `iga whoami` 报 `SignatureDoesNotMatch`（签名不匹配，AK/SK 失效或填错） | 缺：有效 IGA `accessKey` / `secretKey` | ⏳ 凭据失效 | 换新 AK/SK 后 `iga` 登录校验；产物 `release/mixmapp-h5-single.html` |
| 微信小程序 | 小程序端 | `manifest.json` 的 `mp-weixin.appid` 为空；本机无 MP 后台会话 | 缺：小程序 AppID；MP 后台 request 合法域名 `cloud.mixm.top` | ⏳ 非 CORS 问题，是平台白名单 | `pnpm build:mp-weixin`，开发者工具导入产物；后台配合法域名后真机预览 |
| 鸿蒙 | HarmonyOS 端 | 本机无 DevEco / 模拟器记录 | 缺：鸿蒙构建工具链与设备 | ⏳ 未验证 | `pnpm build:harmony` |
| 自建服务器（唯一生产入口） | H5 + API 同域 | SSH secret 齐备；线上 200 | `DEPLOY_SSH_KEY_B64`、`DEPLOY_HOST`、`DEPLOY_USER` 已配 | ✅ 在线；待随 deploy 工作流带上 CORS 修复 | `gh run watch` / Actions `deploy`；线上校验 `curl.exe -s https://cloud.mixm.top/mixmapp/api/v1/healthz` |

### 4.1 需要用户/运维提供的外部凭据清单（精确到名）

1. **Cloudflare**：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`（可选 `CF_PAGES_PROJECT`）。
2. **Vercel**：`VERCEL_TOKEN`（及 `VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`）。
3. **Sealos**：kubeconfig / 部署 token（CLI 登录态）。
4. **Gitee**：私人令牌（仓库镜像 + Gitee Go 变量）。
5. **IGA**：有效 `accessKey` / `secretKey`（现有的签名校验失败，需更换）。
6. **Android 签名**：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`（仅 release AAB 需要）。
7. **微信小程序**：小程序 AppID + MP 后台合法域名配置。
8. **服务端 CORS 环境变量**：生产 `CORS_ORIGINS` 追加各静态托管落地域名（壳源已内置，不用加）。

---

## 5. 本次代码改动清单

红线内：仅 `scripts/`、`apps/app/` 配置类文件、`apps/mobile/`（本次未改 `apps/mobile/` 文件，只读取其 `api-base.json` 作为默认源）；未碰 `pages/`、未碰 `services/api/`、未提交 git。

| 文件 | 改动 | 原因 |
|---|---|---|
| `scripts/build-h5.mjs` | ① API 源取值改为 `MIXMAPP_API_BASE` 环境变量 → `apps/mobile/api-base.json` 兜底；② 校验形态：必须是 http(s) 绝对地址或以 `/` 开头的同域相对路径，绝对地址必须带 `/api/v1` 后缀；③ 两者都给不出时 **fail-fast 报错退出**，列出两种合法用法；④ 注入后打印模式（跨域/同域）与来源，并提示跨域需服务端 CORS 放行 | 旧逻辑缺省静默回退同源 `/api/v1`，在静态平台/壳上产出「装上去就离线」的包（本次离线第二根因） |
| `scripts/build-h5-single.mjs` | 构建前校验：`MIXMAPP_API_BASE` 缺失 → 退出 1；相对路径 → 退出 1；缺 `/api/v1` 后缀 → 退出 1 | 单文件产物只能上纯静态平台，无 dev proxy、无同域后端，必须是绝对地址 |
| `scripts/deploy-static.mjs` | 发布前校验：缺 `MIXMAPP_API_BASE` → 退出 1；相对路径 → 退出 1；缺后缀 → 退出 1；校验通过后再补注入、再走 Cloudflare 凭据 SKIP 分支 | 静态发布不允许带着相对 `/api/v1` 上线；原逻辑缺省静默跳过注入 |
| `scripts/android-inject-base.mjs` | ① 注释补明：壳 origin 为 `https://localhost`（旧版 `capacitor://localhost`），脚本不探测服务端 CORS 放行状态；② 体检通过后追加一条提醒：跨域是否放行要查响应头 `access-control-allow-origin` | 原脚本只校验「注入了没有/是否绝对地址」，没提示服务端白名单这一层 |
| `apps/app/vite.config.ts` | 仅注释补充：`server.proxy` 只在 dev server 生效、生产构建不带代理；留空的 `__MIXMAPP_API_BASE__` 只在同域自托管下回退 `/api/v1` 才成立；未改任何逻辑 | 审计结论留痕，防止后续误以为构建产物仍带 dev 代理 |

未改动：`apps/mobile/api-base.json`（值维持 `https://cloud.mixm.top/mixmapp/api/v1`）、`apps/mobile/capacitor.config.json`、`apps/app/src/api/client.ts`（另一会话在改）、`services/api/**`、`packages/contracts/**`、`version.json`。

---

## 6. 复跑命令

### 6.1 CORS / 连通性复测

```powershell
# 线上：带壳源 Origin 看是否回 ACAO（期望出现 access-control-allow-origin: https://localhost）
curl.exe -s -o NUL -D - "https://cloud.mixm.top/mixmapp/api/v1/healthz" -H "Origin: https://localhost"

# 线上：预检
curl.exe -s -o NUL -D - -X OPTIONS "https://cloud.mixm.top/mixmapp/api/v1/mall/products" `
  -H "Origin: https://localhost" -H "Access-Control-Request-Method: GET" `
  -H "Access-Control-Request-Headers: content-type,authorization"

# 本地内存实例（需 8080 空闲；数据重启即失，仅联调）
$env:ALLOW_MEMORY_STORE='1'; $env:SEED_DEMO_PRODUCTS='1'; $env:PORT='8080'
node services/api/dist/index.js
curl.exe -s -o NUL -D - "http://127.0.0.1:8080/api/v1/mall/products?pageSize=1" -H "Origin: https://localhost"
```

### 6.2 构建与注入核对

```powershell
# 显式绝对源构建
$env:MIXMAPP_API_BASE='https://cloud.mixm.top/mixmapp/api/v1'
node scripts/build-h5.mjs

# 产物入口注入值（期望：window.__MIXMAPP_API_BASE__="https://cloud.mixm.top/mixmapp/api/v1";）
Select-String -Path "apps/app/dist/build/h5/index.html" -Pattern "__MIXMAPP_API_BASE__"

# 无环境变量时：回退 apps/mobile/api-base.json 并显式打印来源
Remove-Item Env:MIXMAPP_API_BASE -ErrorAction SilentlyContinue
node scripts/build-h5.mjs

# 单文件静态包（缺绝对源应直接退出 1）
node scripts/build-h5-single.mjs
```

### 6.3 Android 壳体检 / 冒烟

```powershell
node scripts/android-inject-base.mjs --check     # 只校验注入与地址形态
node scripts/android-smoke.mjs                   # 有设备时装→启→探活→截图
node scripts/android-smoke.mjs --require-api     # CI：探活失败也判死
```

### 6.4 平台凭据核对（只读）

```powershell
gh auth status
gh secret list
gh variable list
gh workflow list --all
git remote -v
# vercel whoami / wrangler whoami      # CLI 未安装，缺 token
edgeone whoami
iga whoami
```

---

## 附录 A：本次实证原始输出留档

### A.1 H5 构建（显式绝对源）

命令：

```powershell
$env:MIXMAPP_API_BASE='https://cloud.mixm.top/mixmapp/api/v1'; node scripts/build-h5.mjs
```

尾部输出：

```text
> @mixmapp/app@0.0.0 build:h5 …
> uni build
Compiler version: 5.36（vue3）
Compiling...
DONE  Build complete.
[h5] 已注入 API 源（跨域绝对源，来源 MIXMAPP_API_BASE）：https://cloud.mixm.top/mixmapp/api/v1
[h5] 提示：跨域端要求服务端 CORS 白名单包含当前页面 origin（壳 https://localhost、各托管域名等），否则浏览器层直接拒收。
```

`index.html` 注入行：

```html
<script>window.__MIXMAPP_API_BASE__="https://cloud.mixm.top/mixmapp/api/v1";</script>
```

JS chunk 内编译结果（vite define 同时写入构建变量）：

```text
const xg="https://cloud.mixm.top/mixmapp/api/v1".trim()
```

无环境变量回退构建：

```text
[h5] 已注入 API 源（跨域绝对源，来源 apps/mobile/api-base.json）：https://cloud.mixm.top/mixmapp/api/v1
```

### A.2 fail-fast 分支实测

单文件缺环境变量：

```text
✗ 构建中止：单文件 H5 只能托管在静态平台，必须设置 MIXMAPP_API_BASE 为绝对地址（如 https://cloud.mixm.top/mixmapp/api/v1）
exit=1
```

单文件给相对路径：

```text
✗ 单文件静态端不支持同域相对路径："/mixmapp/api/v1"，请给 http(s) 绝对地址
exit=1
```

静态发布缺环境变量：

```text
✗ 未设置 MIXMAPP_API_BASE：静态托管没有 /api/v1 路由，缺省会让整站请求打到托管域 404（全站离线）。
  请先设置 MIXMAPP_API_BASE=https://<api-host>[/path]/api/v1 再发布。
exit=1
```

### A.3 Android 壳体检

```text
✓ 壳产物体检通过：https://cloud.mixm.top/mixmapp/api/v1
[android] 提醒：壳内 origin 为 https://localhost（旧版可能为 capacitor://localhost），需在服务端 CORS 白名单内；本脚本不探测服务端放行状态，跨域是否通请查响应头 access-control-allow-origin。
```

### A.4 Android 真机冒烟（设备不在场）

`adb devices` 列表为空；`node scripts/android-smoke.mjs` 输出：

```text
✗ 设备在线：没有可用设备

冒烟结果：0/1 通过
失败项：设备在线
exit=1
```

APK 产物存在：`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`（True），但未做装机与 WebView 实测。

### A.5 生产同域 H5 入口注入值

`curl.exe -s https://cloud.mixm.top/` 返回的入口 HTML（同域相对源，不跨域）：

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <script>window.__MIXMAPP_API_BASE__="/mixmapp/api/v1";</script>
    ...
    <title>MixmAPP</title>
```

### A.6 凭据核对原始结果

```text
gh auth status: github.com ✓ Logged in as afdk1991 (keyring)
  Token scopes: 'delete:packages', 'delete_repo', 'gist', 'read:org', 'repo', 'workflow', 'write:packages'

gh secret list:
DEPLOY_HOST            2026-11-12T11:06:48Z
DEPLOY_SSH_KEY         2026-11-12T11:10:28Z
DEPLOY_SSH_KEY_B64     2026-11-12T11:12:09Z
DEPLOY_USER            2026-11-12T11:06:49Z

gh variable list:
HEALTH_BASE_URL   https://cloud.mixm.top/mixmapp
MIXMAPP_API_BASE  https://cloud.mixm.top/mixmapp/api/v1

gh workflow list --all:
Android           active
ci                active
deploy            active
Image             disabled_manually
ops-nightly       active
Pages             active

git remote -v: origin https://github.com/afdk1991/MixmAPP.git（无 gitee remote）

vercel / wrangler / sealos：CLI 未安装；本机环境无对应 token。
edgeone whoami：Account Name 100033061933，APPID 1320483685（已登录）。
iga whoami：SignatureDoesNotMatch — AK/SK 签名校验失败，需更换。
```
