# 平台矩阵（MixmAPP 实际状态）

对齐用户给出的 11 行平台矩阵，逐行说明 **现在到底做到哪一步**、缺什么、补齐后命令是什么。
原则：只有拿到平台侧可复核结果的行才标 ✅，没凭据的一律 ⏳ 并写明缺口，不用绿勾冒充上线。

| 平台 | 用途 | 状态 | 证据 / 缺口 |
|---|---|---|---|
| GitHub 仓库 | 源码权威仓 | ✅ | <https://github.com/afdk1991/mixmapp>（私有，`main` 分支） |
| Gitee 仓库（码云镜像） | 国内镜像 | ⏳ | 需 Gitee 账号的私人令牌；`.gitee/pipeline.yml` 已就绪 |
| GitHub Pages | 静态端公网 | ✅ | 产物仓 <https://afdk1991.github.io/mixmapp-h5/>；未绑自定义域名（绑域名需仓库加 `CNAME` + DNS CNAME 记录） |
| GitHub Packages（ghcr） | 镜像仓库 | ✅ | `ghcr.io/afdk1991/mixmapp-api:latest`（`image.yml` run 43192779036，镜像内真起容器跑迁移 + `readyz`） |
| 腾讯云 EdgeOne Pages | 单文件静态托管 | ⏳ 受平台接口限制 | `deploy-html` 只接受**内联 HTML 正文**，本仓单文件产物 348 KB 需整段塞进调用参数，实际不可行；单文件产物本身已产出（`release/mixmapp-h5-single.html`），改由 CloudBase 静态托管上线 |
| 腾讯云 CloudBase 静态托管 | H5 公网 | ✅ | <https://mixmapp-h5-cs-1-d5g815slocb5a611a.webapps.tcloudbase.com>（HTTP 200，356,739 字节，DOM 含 `data-page`，标题 `MixmAPP`）；构建 `buildId 2612267461` 状态 `SUCCESS`，链路 `getUploadUrl → PUT zip → deployApp` |
| Cloudflare Pages / Workers | 静态端 + Worker | ⏳ | 需 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`；`deploy.yml` 对应 job 现为显式 SKIP |
| Cloudflare `_worker.js` 同源入口 | 静态 + API 同源 | ⏳ | 同上；还需把 `/api/*` 反代到 API 源（`infra/nginx/mixmapp-api.conf` 可作蓝本） |
| Vercel | 静态端 / Serverless | ⏳ | 需 `VERCEL_TOKEN`（及 `VERCEL_ORG_ID`/`PROJECT_ID`） |
| Sealos | 容器化部署 API | ⏳ 镜像已就绪 | 直接拉 `ghcr.io/afdk1991/mixmapp-api:latest`；需 Sealos 账号或部署 token |
| IGA Pages | 静态托管 | ⏳ | 需 `iga` CLI（≥1.1.0）+ 登录态或 AK/SK |
| 腾讯云自建服务器（生产终点） | API + 静态 | ⏳ | 需 `DEPLOY_SSH_KEY`、`DEPLOY_HOST`、`DEPLOY_USER`；`deploy/atomic-release.sh` 与回滚脚本已就绪 |

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
