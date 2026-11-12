# 交付报告 · 2026-11-12（版本规约 + 门禁 + 多平台取证）

> 本轮交付物：版本号规约（`version.json` + `scripts/version.mjs` + CI 门禁 + README 同步）、
> 一次真实红灯的修复、以及 CloudBase 静态端的真实上线取证。
> 所有结论都带可复核证据；没做到的部分在文末单列，不用绿勾冒充。

---

## 1. 版本号规约（首发 V0.0.0）

| 项 | 落地 |
|---|---|
| 单一事实源 | `version.json`：`next=0.0.0`、`channel=preview`、`released=[]` |
| 执行脚本 | `scripts/version.mjs`（`show / check / sync / bump / release`） |
| 门禁 | `pnpm version:check`，已插入 `ci.yml` 安装依赖之后、规则检查之前 |
| 同步面 | 6 个 `package.json`、`.env.example` 的 `APP_VERSION`、`services/api/src/config.ts` 默认值、`README.md` 版本块 |
| 当前展示版本 | **V0.0.0-preview**（内部预览，未对外发布） |
| 规范文档 | `docs/08-versioning.md` |

规则三条硬约束（脚本强制，不是口头约定）：

1. **发布前不得占用正式号**：`bump` 在上一版未发布时直接拒绝；`check` 发现未发布却有同名 tag 也判红。
2. **预览与正式可区分**：预览一律 `-preview`，正式去掉后缀。
3. **与 README 同步**：README 版本块由脚本生成，手改即 `version:check` 失败。

反向验证（证明门禁真的会拦）：

```
> node scripts/version.mjs bump
✗ 当前 0.0.0 还没正式发布，不能先占用下一个号（规约：发布前不得占用）
exit=1
```

正向验证：

```
> node scripts/version.mjs check
✓ 版本一致：V0.0.0-preview（包 6 个、env、config、README、tag 均已核对）
exit=0
```

---

## 2. 本轮修掉的真问题

| # | 问题 | 根因 | 修法 | 证据 |
|---|---|---|---|---|
| 1 | `Image` 工作流连续红两次：容器起来了但健康检查一直 404 | 冒烟脚本请求根路径 `/readyz`，而所有路由挂在 `/api/v1` 前缀下 | 改为 `/api/v1/readyz`（与 Dockerfile HEALTHCHECK 对齐） | `Image` run 43192779036 转绿；本次 43193388929 仍绿 |

同类问题在 `ci.yml` 里本来就是对的（`/api/v1/readyz`），只有镜像冒烟写错，属于“本机与 CI 绿、容器里红”的那类只有真跑才暴露的问题。

---

## 3. 静态检查与自测（本地取证，2026-11-12 17:38–17:41）

| 检查 | 命令 | 结果 |
|---|---|---|
| 仓库规则 | `pnpm lint` | ✓ 规则检查通过 |
| 版本一致性 | `pnpm version:check` | ✓ 6 包 / env / config / README / tag 全部一致 |
| 类型 | `pnpm typecheck` | ✓ ids、contracts、api、app 四包 `tsc`/`vue-tsc` 全部 Done |
| 单元测试 | `pnpm test` | ✓ 22 passed，4 例真库用例按设计跳过（`REQUIRE_DATABASE_URL` 未置位） |
| 构建 | `pnpm build:api` | ✓ `dist/index.js` 77.33 KB |
| 构建 | `pnpm build:h5` | ✓ DONE |
| 单文件产物 | `node scripts/build-h5-single.mjs` | ✓ `release/mixmapp-h5-single.html` 348.4 KB |

真库集成测试 4 例不在本机跑（本机无 PostgreSQL），由 `ci` 的 `postgres:16-alpine` service 覆盖——这是有意的分工，不是漏测。

---

## 4. 部署与逐平台取证（只走免费方案）

### 4.1 GitHub Actions（免费 runner，4 条全绿）

提交 `1875819` 上：

| 工作流 | run id | 结果 |
|---|---|---|
| `ci` | 43193388751 | ✅ success |
| `deploy` | 43193388763 | ✅ success |
| `Android` | 43193388872 | ✅ success |
| `Image` | 43193388929 | ✅ success |

`ci` 这一轮额外多了一项：`版本一致性（version.json ↔ 各包 ↔ README）`，即版本门禁已在云端生效。

### 4.2 GitHub Pages（静态端）

- 地址：<https://afdk1991.github.io/mixmapp-h5/>
- 取证：`curl` 返回 `http_code=200 size=293594`（耗时 40s 触发本地超时，但响应码与字节数已拿到）
- 性质：公开**产物仓** `afdk1991/mixmapp-h5`，源码仓仍私有

### 4.3 腾讯云 CloudBase 静态托管（本轮新增上线）

- 地址：<https://mixmapp-h5-cs-1-d5g815slocb5a611a.webapps.tcloudbase.com>
- 部署链路（cloud mode 无本地文件系统的正规路径）：
  1. `manageApps(action=getUploadUrl, serviceName=mixmapp-h5)` → 预签名 URL + `cosTimestamp=1794476517`
  2. `curl -X PUT -T release/site.zip` 到预签名地址 → **HTTP 200**
  3. `manageApps(action=deployApp, cosTimestamp=1794476517, framework=static, installCmd="", buildCmd="")`
  4. `queryApps(action=getAppVersion, buildId=2612267461)` → `BUILDING` → `SUCCESS`
- 线上取证：`Invoke-WebRequest` → `status=200`、`bytes=356739`、`data-page=True`、`title=MixmAPP`

### 4.4 ghcr.io 镜像（生产可运行的 API 制品）

- 镜像：`ghcr.io/afdk1991/mixmapp-api:latest`（同 `sha` 标签）
- 凭据：仅用仓库内置 `GITHUB_TOKEN`（`permissions: packages: write`），不需要额外密钥
- 冒烟：容器内真跑 `node dist/db/migrate.js`，再起容器请求 `/api/v1/readyz` 断言 `"ready":true`

### 4.5 EdgeOne Pages（受平台接口限制，未上线）

- 平台只提供 `deploy-html`（单 HTML → 公网 URL），参数是**内联 HTML 正文**；
- 本仓单文件产物 348 KB，整段塞进调用参数不现实（也容易触发内容策略拒绝）；
- 因此改由 CloudBase 承接静态上线，EdgeOne 行保持 ⏳ 并写明原因，不伪造绿勾。

---

## 5. 仍未完成（缺外部条件，逐条写清）

| 项 | 缺什么 | 已有准备 |
|---|---|---|
| API 线上实例 | 一台可跑的宿主 + PostgreSQL 连接串（免费方案：Neon/Supabase + CloudBase 云托管或 Sealos） | `ghcr.io/afdk1991/mixmapp-api:latest` 已就绪；`deploy/atomic-release.sh`、`rollback.sh`、`infra/nginx` 已就绪 |
| Cloudflare Pages / Workers | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | `deploy.yml` 的 static job 配好 secrets 即从 SKIP 转实际发布 |
| 自定义域名 | `mixm.top` 是否沿用、子域如何分配 | 平台侧绑定命令与 DNS 记录类型已写在 `docs/08-platform-matrix.md` |
| Android release 签名 | keystore + 4 个 secrets | `app/build.gradle` 已支持 env 驱动签名，缺则只出 debug |
| 真实短信 / 支付 / 地图 / 推送 / AI | 各平台商户号与密钥 | 填 `.env` 后 `/api/v1/meta` 能力矩阵自动变 `on` |

以上五项都属于“账号/密钥在平台侧、AI 无法自签”的类型；代码与流水线已经备好，拿到凭据即可跑，不需要再改代码。

---

## 6. 本轮文件清单

| 文件 | 变更 |
|---|---|
| `version.json` | 新增，版本单一事实源 |
| `scripts/version.mjs` | 新增，5 个子命令 + 一致性校验 |
| `docs/08-versioning.md` | 新增，规约与命令说明 |
| `package.json` | `version` 0.1.0 → 0.0.0；新增 5 个 `version:*` 脚本 |
| `apps/*/package.json`、`services/*/package.json`、`packages/*/package.json` | 版本归零到 0.0.0 |
| `.env.example` | `APP_VERSION=0.0.0-preview` |
| `services/api/src/config.ts` | 默认版本 `0.0.0-preview` |
| `README.md` | 顶部新增版本块（脚本可同步） |
| `.github/workflows/ci.yml` | 新增版本门禁步骤 |
| `.github/workflows/image.yml` | 冒烟健康检查路径修正（`/api/v1/readyz`） |
| `docs/08-platform-matrix.md` | 补 CloudBase 上线取证、EdgeOne 限制说明 |
