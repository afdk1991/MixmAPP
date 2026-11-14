# 平台矩阵（MixmAPP 实际状态）

对齐用户给出的 11 行平台矩阵，逐行说明 **现在到底做到哪一步**、缺什么、补齐后命令是什么。
原则：只有拿到平台侧可复核结果的行才标 ✅，没凭据的一律 ⏳ 并写明缺口，不用绿勾冒充上线。

| 平台 | 用途 | 状态 | 证据 / 缺口 |
|---|---|---|---|
| GitHub 仓库 | 源码权威仓 | ✅ | <https://github.com/afdk1991/MixmAPP>（公开，`main` 分支；已在仓库里扫过，无密钥文件，只有 `.env.example`） |
| Gitee 仓库（码云镜像） | 国内镜像 | ⏳ | 需 Gitee 账号的私人令牌；`.gitee/pipeline.yml` 已就绪 |
| GitHub Pages | 静态端公网（表外域名，预览用途） | ✅ 活的（2026-11-14 复核） | <https://afdk1991.github.io/MixmAPP/>（HTTP 200）；`pages.yml` 工作流 `state=active`，run 43581523947 `success`；`build_type=workflow`、`https_enforced=true`。**它不在 DNSPod 表内**（`afdk1991.github.io` 属表外），只作预览入口，不得写入生产配置或 CORS 白名单（`deploy/domains.json` 里标 `pending_confirmation`） |
| GitHub Packages（ghcr） | 镜像仓库 | ✅ | `ghcr.io/afdk1991/mixmapp:latest`（`image.yml` run 43194504120，镜像内真起容器跑迁移 + `/api/v1/readyz`） |
| 腾讯云 EdgeOne Pages | 单文件静态托管 | ⏳ 受平台接口限制 | `deploy-html` 只接受**内联 HTML 正文**，本仓单文件产物 348 KB 需整段塞进调用参数，实际不可行；单文件产物本身已产出（`release/mixmapp-h5-single.html`），改由 CloudBase 静态托管上线 |
| 腾讯云 CloudBase 静态托管 | H5 公网（已暂停 2026-11-13） | ⏸ 停用，H5 改由云服务器提供 | 收敛前曾上线，名 `MixmAPP` 项目名 `MixmAPP`：<https://mixmapp-cs-1-d5g815slocb5a611a.webapps.tcloudbase.com>（HTTP 200，411,774 字节）；构建 `buildId 2612270861` 状态 `SUCCESS`，链路 `getUploadUrl → PUT zip → deployApp`。旧名 `mixmapp-h5` 应用已删除，旧域名返回 404 |
| Cloudflare Pages / Workers | 静态端 + Worker | ⏳ | 需 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`；`deploy.yml` 对应 job 现为显式 SKIP |
| Cloudflare `_worker.js` 同源入口 | 静态 + API 同源 | ⏳ | 同上；还需把 `/api/*` 反代到 API 源（`infra/nginx/api.mixm.top.conf` 可作蓝本） |
| Vercel | 静态端 / Serverless | ⏳ | 需 `VERCEL_TOKEN`（及 `VERCEL_ORG_ID`/`PROJECT_ID`） |
| Sealos | 容器化部署 API | ⏳ 镜像已就绪 | 直接拉 `ghcr.io/afdk1991/mixmapp:latest`；需 Sealos 账号或部署 token |
| IGA Pages | 静态托管 | ⏳ | 需 `iga` CLI（≥1.1.0）+ 登录态或 AK/SK |
| 腾讯云自建服务器（**生产**） | H5（`www`）+ API（`api`）双域；`cloud` 切换期 legacy | ✅ 现状 / ⏳ 新域待解析 | 现状：<https://cloud.mixm.top/>（HTTP 200，472 KB，history 深链接 200）；API `https://cloud.mixm.top/mixmapp/api/v1/healthz` 200；`deploy` 工作流 run 43434486004，H5 与 API 同一 release 原子发布。目标：`www.mixm.top` / `api.mixm.top` / `img.mixm.top`，Nginx 蓝图已就绪，只差解析与证书；切换序列见 `2026-11-14/deploy-domains/outputs/切换与回退序列.md` |

## 平台命名规范（本轮统一）

规则：每个平台的**项目名一律为 `MixmAPP`**，名字对不上的项目已删除重建；只有受平台规范硬限制的才允许小写。

| 平台 | 项目名 | 说明 |
|---|---|---|
| GitHub 仓库 | `MixmAPP` | 由 `mixmapp` 改名而来，旧地址自动 301 跳转 |
| GitHub Pages | 挂在 `MixmAPP` 主仓 | 私有仓不支持免费 Pages（API 返回 422），只能让主仓公开后直接托管；旧产物仓 `mixmapp-h5` 已删除（旧地址 404） |
| GitHub Packages | `mixmapp` | OCI 规范要求镜像名全小写，无法写成 `MixmAPP`，这是平台硬限制；旧包 `mixmapp-api` 已删除 |
| 腾讯云 CloudBase | `MixmAPP` | 服务名已统一；控制台域名由平台小写化为 `mixmapp-cs-1-…`，DNS 本身不区分大小写。旧 `mixmapp-h5` 应用已删除 |
| 其余平台 | `MixmAPP` | 尚未创建，创建时统一使用该名称 |

命名统一已完成（2026-11-12 复核）：

- `gh repo delete afdk1991/mixmapp-h5 --yes` 执行后，账号下仓库只剩 `MixmAPP`（及另一项目的 `mim`），旧地址 `https://afdk1991.github.io/mixmapp-h5/` 返回 404
- `gh api -X DELETE user/packages/container/mixmapp-api` 执行后，容器包列表为 `mixmapp`（及另一项目的 `mim-api`）
- 前提是 `gh auth refresh -h github.com -s delete_repo,delete:packages` 补齐 scope；现持有 `delete:packages, delete_repo, gist, read:org, repo, workflow, write:packages`

## 域名注册表（已确定）

主域沿用 `mixm.top`，主入口是 `www.mixm.top`（2026-11-14 定案改版；裸域 301 到 www）。`cloud.mixm.top` 降级为切换期 legacy，不再作主入口、也不再作 API 宿主。机器可读的单一真源是 [deploy/domains.json](../deploy/domains.json)，改动后跑 `pnpm domains:check` 做门禁。

| 域名 | 角色 | 状态 | 说明 |
|---|---|---|---|
| `www.mixm.top` | **MixmAPP 主入口（H5 正式站）** | ⏳ 待建解析/证书 | 表内 sourceRows 5/6；Nginx `www.mixm.top.conf` 已就绪 |
| `mixm.top`（裸域） | 301 → `https://www.mixm.top` | ⏳ 待建解析/证书 | 只做跳转，不承载页面与 API |
| `api.mixm.top` | **后端 API + 支付回调** | ⏳ 待建解析/证书 | 表内 sourceRows 9/10；`/mixmapp/api/v1` 与 `/api/v1` 同上游 |
| `img.mixm.top` | 静态资源与图片 | ⏳ 待建解析/证书 | 表内 sourceRows 37/38；直出 `/var/lib/mixmapp/storage/` |
| `cloud.mixm.top` | **legacy 双跑** | ✅ 在用（待下线） | 切换期承载已发布 APK 与存量支付回调；零流量后再下线 |
| `mim.mixm.top` | 其他项目 | 未使用 | 同根域表内主机；仓库内无引用，MixmAPP 不接管 |
| `data.mixm.top` | 其他项目 | 未使用 | 同上 |
| `gy.mixm.top` | 其他项目 | 未使用 | 同上 |
| 7 条 `_dnsauth.*` / `edgeonereclaim.*` 主机 | 平台校验 | 未使用（表内） | 表内无备注、无平台字段；归属与有效性待控制台确认，本仓不提删除建议 |
| 其余 38 个规划子域 | 未来业务模块 | ⏳ 未建解析 | xls 仅给主机名与用途，无类型/记录值；按需逐条开通 |
| `laal.top` | 表内另一域名 | 未使用 | 45 个主机与 mixm.top 同名；与本项目无关，禁止接入配置 |
| `mix.top` / `cloud.mix.top` | 拼写域（少一个 m） | ❌ 无关 | 解析到 AWS 停放，历史事故根因；功能路径禁止出现 |

> **口径（2026-11-14 收紧）**：DNSPod 导出表 `dnspod_records_2026-11-05_21-42-26.xls` 只有「主机记录 / 线路 / TTL / 备注」四列有值，**记录类型、记录值、状态三列全空**。上表中 `A → 115.159.159.11`、`CNAME → …` 等指向来自历史实测与运维记录，**不出自该表**，仅作参考，不得据此认定 DNSPod 真实解析；`api.mixm.top` 等 42 个主机在表内存在，但没有记录类型/值，属"表内主机、待确认"，不是已生效解析。

> 命名规范：本项目所有域名必须写成 `mixm.top` / `www.mixm.top` / `api.mixm.top` / `img.mixm.top`。CI 的 `pnpm domains:check` 会在 `apps/mobile`、`infra`、`deploy`、`cloudbase`、`scripts`、`.env.example` 中出现拼写域时直接失败。

未来若把静态端绑定到其他平台，按下列记录类型申请（当前未启用，保留备查；`afdk1991.github.io`、`*.pages.dev`、`*.tcloudbase.com` 均为表外目标，不在 DNSPod 导出表内）：

| 平台 | 需要的 DNS 记录 | 备注 |
|---|---|---|
| GitHub Pages | `CNAME` → `afdk1991.github.io` | 同时在产物仓加 `CNAME` 文件，否则 Pages 会拒绝该域名 |
| Cloudflare Pages | `CNAME` → `<项目>.pages.dev` | 控制台加 Custom domain 并等待校验 |
| Vercel | `CNAME` → `cname.vercel-dns.com` | 控制台添加域名 |
| EdgeOne Pages | `CNAME` → 平台分配的 `*.pages.dnsoe5.com` | 平台侧「域名管理」先加域名 |
| 自建服务器 | `A` → 服务器公网 IP（或 `CNAME`） | 证书用 Let's Encrypt / 平台托管 |

## 本轮已经补上的能力

1. **GitHub Packages 打通**：`Dockerfile`（builder 用 pnpm 构建 + `pnpm deploy --prod` 出独立目录，运行层 `node:22-alpine`）+ `image.yml`（buildx 推送 `sha` 与 `latest`，随后真起容器）。
2. **镜像冒烟暴露的两个真问题**（都只在容器里出现）：
   - 迁移进程同样要 `JWT_SECRET`，生产模式会 fail-fast 拒绝启动；
   - 健康检查路径写的是根路径 `/readyz`，而所有路由挂在 `/api/v1` 前缀下，应改成 `/api/v1/readyz`。
3. 镜像发布**不依赖额外凭据**（用 `GITHUB_TOKEN` 与 `permissions: packages: write`），所以这一行无需你提供任何密钥即可持续产出。

## 主域 + 子域职责分配（2026-11-14 定案）

**主域：`mixm.top`；主入口：`www.mixm.top`；裸域 `mixm.top` 301 → `https://www.mixm.top`。** 理由：主入口收敛到 www（表内 sourceRows 5/6，备注「主站常规访问入口｜官方门户网站」），H5 与 API 拆成两个域、职责单一；`cloud.mixm.top` 不再保留为主入口、也不再是 API 宿主，只在切换期作 legacy 双跑，承载已发布 APK 与存量支付回调，确认零流量后下线。`laal.top` 明确不参与；`mix.top` 是拼写域。

机器可读版本在 `deploy/domains.json` 的 `domainArchitecture`（含 `primaryHost`、`rootRedirect`、`platformAssignments`、`matrix`），改动后跑 `pnpm domains:check`。

| 平台端 | 主机名 | 是否表内 | 状态 | 职责与绑定前置条件 |
|---|---|---|---|---|
| 官网 / H5 正式站 | `www.mixm.top` | 是（sourceRows 5/6） | ⏳ 待建解析/证书 | Nginx `www.mixm.top.conf`：`root /opt/mixmapp/current/web` + history 回退；过渡期同时反代 `/mixmapp/` 与直出 `/media/` |
| 裸域入口 | `mixm.top` | 是（sourceRows 1-4） | ⏳ 待建解析/证书 | 只做单跳 301 → `https://www.mixm.top`，不承载页面/API |
| 后端 API | `api.mixm.top/mixmapp/api/v1` | 是（sourceRows 9/10） | ⏳ 待建解析/证书 | `api.mixm.top.conf`：`/mixmapp/` 剥前缀、`/api/` 原样，同上游 `127.0.0.1:8080`；与 www 跨域，需 CORS |
| 管理后台 | `admin.mixm.top` | 是（planned） | 规划 | **阻塞**：仓库内无 admin 应用（`apps/` 只有 `app` / `mobile`），无服务可挂；需证书、解析、独立鉴权 |
| 移动端 / 客户端接口 | `api.mixm.top/mixmapp/api/v1` | 是 | ⏳ 待建解析/证书 | `apps/mobile/api-base.json` 与 `android.yml` 默认值已指向它；新 APK 必须在 api 双跑通过后出包，旧 APK 靠 cloud 兜底；`app.mixm.top` 保持规划 |
| 静态资源与图片 | `img.mixm.top` | 是（sourceRows 37/38） | ⏳ 待建解析/证书 | `img.mixm.top.conf` 直出 `/var/lib/mixmapp/storage/`；切换期保留 `cloud.mixm.top/media/` 回退 |
| 文档站 | `help.mixm.top` | 是（planned） | 规划 | 需先有文档站产物（当前 docs 为仓库内 Markdown）；接口文档备选 `dev.mixm.top` |
| 预览 / 灰度 | `test.mixm.top`（开发 `dev.mixm.top`） | 是（planned） | 规划 | 单机原子发布无灰度槽位，需新增独立环境与流量切分 |
| 健康检查与监控 | `api.mixm.top/mixmapp/api/v1/healthz` | 是 | ⏳ 待建解析/证书 | 现巡检仍查 cloud；双跑期两个都查，`HEALTH_BASE_URL` 在切换后改 api；`fwq.mixm.top` 监控面板仍规划 |
| 支付与回调 | `api.mixm.top/mixmapp/api/v1/pay/notify/*` | 是 | ⏳ 待建解析/证书 | 回调域变更须同步微信/支付宝商户平台并重新验签；双跑期 cloud 同路径必须保持可用；`pay.mixm.top` 保持规划 |
| 邮箱与验证 | — | 否 | 不分配 | 表内无 mail/smtp 主机，按「不造域名」原则不分配；事务邮件走第三方。`_dnsauth.*` / `edgeonereclaim.*` 7 条是平台回源校验，不用于邮箱 |

**本轮启用 3 个主机：`www.mixm.top`、`api.mixm.top`、`img.mixm.top`；`mixm.top` 只做 301。** 判据是「xls 表内已有主机名 + 服务端能力已存在 + 不需要新业务代码」，其余 38 个保持 `planned_no_dns` 不动。`cloud.mixm.top` 标 `legacy_dual_run`，不立即删除。

### 平台 × 域名 × 环境矩阵

| 平台 | 域名 | 环境 | 状态 |
|---|---|---|---|
| 腾讯云自建服务器（Nginx） | `www.mixm.top` | 正式 | 待建解析/证书（Nginx 已就绪） |
| 腾讯云自建服务器（Nginx） | `mixm.top` | 正式（301 → www） | 待建解析/证书 |
| 腾讯云自建服务器（Nginx） | `api.mixm.top` | 正式 | 待建解析/证书（Nginx 已就绪） |
| 腾讯云自建服务器（Nginx） | `img.mixm.top` | 正式 | 待建解析/证书（Nginx 已就绪） |
| 腾讯云自建服务器（Nginx） | `cloud.mixm.top` | 正式（legacy 双跑） | 在用，待下线 |
| 腾讯云自建服务器（Nginx） | `test.mixm.top` / `dev.mixm.top` | 预览灰度 / 开发 | 规划未接线 |
| GitHub Pages | `afdk1991.github.io/MixmAPP/` | 预览 | 活的（表外域名） |
| CloudBase 静态托管 | `mixmapp-cs-1-d5g815slocb5a611a.webapps.tcloudbase.com` | 预览 | 暂停（表外域名） |
| CloudBase 云函数 `mixmapp-api-proxy` | 回源优先 `api.mixm.top`，回退 `cloud.mixm.top` | 正式 | 待重新发布（代码已改） |
| Android（Capacitor 壳） | 旧包 `cloud.mixm.top/…`；新包 `api.mixm.top/…` | 正式 | 双基址过渡，仅 debug APK |
| 微信小程序 / 鸿蒙 App | `api.mixm.top/mixmapp/api/v1` | 正式 | 只构建，未发布 |
| Gitee / Cloudflare / Vercel / Sealos / IGA / EdgeOne | — | — | 缺凭据或平台限制 |
| ghcr | — | — | 活的 |
