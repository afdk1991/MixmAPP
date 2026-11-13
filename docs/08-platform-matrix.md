# 平台矩阵（MixmAPP 实际状态）

对齐用户给出的 11 行平台矩阵，逐行说明 **现在到底做到哪一步**、缺什么、补齐后命令是什么。
原则：只有拿到平台侧可复核结果的行才标 ✅，没凭据的一律 ⏳ 并写明缺口，不用绿勾冒充上线。

| 平台 | 用途 | 状态 | 证据 / 缺口 |
|---|---|---|---|
| GitHub 仓库 | 源码权威仓 | ✅ | <https://github.com/afdk1991/MixmAPP>（公开，`main` 分支；已在仓库里扫过，无密钥文件，只有 `.env.example`） |
| Gitee 仓库（码云镜像） | 国内镜像 | ⏳ | 需 Gitee 账号的私人令牌；`.gitee/pipeline.yml` 已就绪 |
| GitHub Pages | 静态端公网（已暂停 2026-11-13） | ⏸ 工作流 `pages.yml` 已 disable | 收敛单服务器前曾用主仓托管：<https://afdk1991.github.io/MixmAPP/>（`pages.yml` run 43194503748，HTTP 200，DOM 含 `data-page`） |
| GitHub Packages（ghcr） | 镜像仓库 | ✅ | `ghcr.io/afdk1991/mixmapp:latest`（`image.yml` run 43194504120，镜像内真起容器跑迁移 + `/api/v1/readyz`） |
| 腾讯云 EdgeOne Pages | 单文件静态托管 | ⏳ 受平台接口限制 | `deploy-html` 只接受**内联 HTML 正文**，本仓单文件产物 348 KB 需整段塞进调用参数，实际不可行；单文件产物本身已产出（`release/mixmapp-h5-single.html`），改由 CloudBase 静态托管上线 |
| 腾讯云 CloudBase 静态托管 | H5 公网（已暂停 2026-11-13） | ⏸ 停用，H5 改由云服务器提供 | 收敛前曾上线，名 `MixmAPP` 项目名 `MixmAPP`：<https://mixmapp-cs-1-d5g815slocb5a611a.webapps.tcloudbase.com>（HTTP 200，411,774 字节）；构建 `buildId 2612270861` 状态 `SUCCESS`，链路 `getUploadUrl → PUT zip → deployApp`。旧名 `mixmapp-h5` 应用已删除，旧域名返回 404 |
| Cloudflare Pages / Workers | 静态端 + Worker | ⏳ | 需 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`；`deploy.yml` 对应 job 现为显式 SKIP |
| Cloudflare `_worker.js` 同源入口 | 静态 + API 同源 | ⏳ | 同上；还需把 `/api/*` 反代到 API 源（`infra/nginx/mixmapp-api.conf` 可作蓝本） |
| Vercel | 静态端 / Serverless | ⏳ | 需 `VERCEL_TOKEN`（及 `VERCEL_ORG_ID`/`PROJECT_ID`） |
| Sealos | 容器化部署 API | ⏳ 镜像已就绪 | 直接拉 `ghcr.io/afdk1991/mixmapp:latest`；需 Sealos 账号或部署 token |
| IGA Pages | 静态托管 | ⏳ | 需 `iga` CLI（≥1.1.0）+ 登录态或 AK/SK |
| 腾讯云自建服务器（**唯一生产入口**） | H5 + API 同域 | ✅ | <https://cloud.mixm.top/>（HTTP 200，472 KB，history 深链接 200）；API `https://cloud.mixm.top/mixmapp/api/v1/healthz` 200；`deploy` 工作流 run 43434486004，H5 与 API 同一 release 原子发布 |

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

## 域名映射（待确认）

`mixm.top` 是否沿用、各子域如何分配属于你的决策，这里不擅自写死。确认后按下列方式接通：

| 平台 | 需要的 DNS 记录 | 备注 |
|---|---|---|
| GitHub Pages | `CNAME` → `afdk1991.github.io`（项目页绑定自定义域） | 同时在产物仓加 `CNAME` 文件，否则 Pages 会拒绝该域名 |
| Cloudflare Pages | `CNAME` → `<项目>.pages.dev` | Cloudflare 侧还要在控制台加 Custom domain 并等待校验 |
| Vercel | `CNAME` → `cname.vercel-dns.com` | 控制台添加域名 |
| EdgeOne Pages | `CNAME` → 平台分配的 `*.pages.dnsoe5.com` | 平台侧「域名管理」先加域名 |
| 自建服务器 | `A` → 服务器公网 IP（或 `CNAME`） | 证书用 Let's Encrypt / 平台托管 |

## 本轮已经补上的能力

1. **GitHub Packages 打通**：`Dockerfile`（builder 用 pnpm 构建 + `pnpm deploy --prod` 出独立目录，运行层 `node:22-alpine`）+ `image.yml`（buildx 推送 `sha` 与 `latest`，随后真起容器）。
2. **镜像冒烟暴露的两个真问题**（都只在容器里出现）：
   - 迁移进程同样要 `JWT_SECRET`，生产模式会 fail-fast 拒绝启动；
   - 健康检查路径写的是根路径 `/readyz`，而所有路由挂在 `/api/v1` 前缀下，应改成 `/api/v1/readyz`。
3. 镜像发布**不依赖额外凭据**（用 `GITHUB_TOKEN` 与 `permissions: packages: write`），所以这一行无需你提供任何密钥即可持续产出。
