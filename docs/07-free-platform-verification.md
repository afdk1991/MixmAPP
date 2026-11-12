# 免费平台验证取证

本文只记录**在免费云端平台上真实跑出来的结果**，不记录本机跑通的内容。
每条都给出可复核的 run id / 产物，以及失败过的真实原因。

仓库：`https://github.com/afdk1991/MixmAPP`（公开）
路线：Windows 本机开发 → 推送到 GitHub → 由 GitHub 提供的免费 runner 执行构建、测试与出包。

---

## 1. 结论速览

| 平台 | 用途 | 结果 | 关键证据 |
|---|---|---|---|
| GitHub Actions（ubuntu-latest） | 门禁 + 真实 PostgreSQL + 构建 | ✅ 通过 | `ci` run 43080670212，1m18s |
| GitHub Actions（ubuntu-latest） | 发布包与静态产物打包 | ✅ 通过 | `deploy` run 43080670325，1m10s |
| GitHub Actions（ubuntu-latest） | Android debug APK | ✅ 通过 | `Android` run 43080670220，3m18s，产物 3.91 MB |
| GitHub 提供的 PostgreSQL service 容器 | 真库集成测试 | ✅ 通过 | `postgres:16-alpine`，4 例集成测试全绿 |
| GitHub Pages | H5 静态托管 | ✅ 通过（主仓 Pages） | <https://afdk1991.github.io/MixmAPP/> 返回 200、DOM 有 `data-page` |
| Cloudflare Pages | H5 静态托管 | ⏸ 未执行 | 缺 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`，workflow 显式 SKIP |
| 远程 API 宿主 | 线上服务 | ⏸ 未执行 | 缺 SSH 凭据与服务器 |

> 免费额度说明：私有仓库的 Actions 在免费账户下有月度分钟额度，本次三个工作流合计约 6 分钟，
> 属于免费额度内；PostgreSQL 是 runner 上的 service 容器，也由 GitHub 承担。

---

## 2. `ci`：门禁 + 真实数据库

工作流 `.github/workflows/ci.yml`，触发：push 到 `main`。

关键设计（这是本次口径调整的核心）：

- 启动 `postgres:16-alpine` service，健康检查 `pg_isready`，`ports: 5432:5432`。
- 环境里写死 `REQUIRE_DATABASE_URL=1`。集成测试在缺连接串时**直接抛错**，不会静默跳过——
  避免出现「本地没库所以绿了、上线才发现 SQL 不对」。
- 顺序：`lint` → `typecheck` → `db:migrate` → `test`（单元）→ `test postgres.integration`（真库）→
  `build:api` → `build:h5` → `node dist/index.js` 起服务并 `curl readyz` → `build:mp-weixin` → 上传产物。

实测输出（截取）：

```
services/api test:  Test Files  3 passed (3)
services/api test:       Tests  26 passed (26)      # 22 单元 + 4 真库
readyz ok (attempt 2)
```

真库用例覆盖：

1. 邮箱注册后用户落库，`uuidV7` 符合 RFC 9562（第 7 版、variant 10xx），`ulid` 26 位，`snowflake` 纯数字，`accountNo` 为 `MixmAPP-XXXX-XXXX-XXXX-X`。
2. 新连接上读到刚写入的用户，密码登录成功，`/me` 返回该邮箱。
3. 刷新令牌轮换后，旧刷新令牌重放返回 401（撤销生效）。
4. 下单写入 `payments`，同 `outTradeNo` 再下单被拒（唯一约束真实生效）。

## 3. `deploy`：发布包与静态产物

工作流 `.github/workflows/deploy.yml`，触发：push 到 `main`。

- `pnpm --filter @mixmapp/api deploy --prod out/api` 产出**自带 node_modules 的独立包**，再连同 `infra/`、`scripts/` 打成 `api-<sha>.tar.gz`；H5 打成 `h5-<sha>.tar.gz`，两者作为 artifact 保留 14 天。
- 静态端与 SSH 端在本轮**显式 SKIP**：没有 Cloudflare 凭据、没有 SSH 凭据，日志打印
  `SKIP 未配置 Cloudflare 凭据…` / `SKIP 未配置 DEPLOY_SSH_KEY…`，不用「绿勾」冒充已上线。

## 4. `Android`：云端出包

工作流 `.github/workflows/android.yml`，触发：push 命中 `apps/**`、`packages/**`、`pnpm-lock.yaml` 等路径，或手动 `workflow_dispatch`。

- 步骤：`build:h5` → `cap sync android` → `chmod +x gradlew` → `./gradlew assembleDebug --no-daemon` → 上传 APK。
- 实测：3m18s，产物 `mixmapp-debug-apk` 3.91 MB（本机产物为 4.15 MB，差异来自不同 SDK 版本压缩策略）。
- 未配置签名 secrets 时打印 `::warning::` 并只出 debug，release AAB 不构建。

---

## 5. 这一轮在平台上暴露并修掉的真问题

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | `deploy`、`ops-nightly` 一触发就失败，0 秒、无 job | `if:` 表达式里用了 `secrets`，GitHub 不允许（`Unrecognized named-value: 'secrets'`） | job 级 `env` 折算成布尔字符串（`CF_READY` / `SSH_READY`），step 里判断 `env.X == 'true'` |
| 2 | `Android` 工作流 12 秒失败 | `pnpm/action-setup` 传 `version: 9`，与 `package.json` 的 `packageManager: pnpm@9.12.0` 冲突 | 对齐为 `9.12.0` |
| 3 | `./gradlew: Permission denied`（exit 126） | Windows 提交的文件没有 755 可执行位 | `git update-index --chmod=+x gradlew`，并在 workflow 里 `chmod +x` 兜底 |
| 4 | `Java home supplied is invalid` | `gradle.properties` 写死了 `C:/Program Files/Microsoft/jdk-...`，Linux runner 上没有该路径 | 删掉写死配置，改用 `scripts/android-build.mjs` 运行时挑 JDK21（本地实测 BUILD SUCCESSFUL） |
| 5 | CI 健康检查 40 秒超时 | 断言写的是 `"status":"ok"`，而 `/readyz` 实际返回 `{"ready":true}` | 断言改为 `"ready":true`，并追加 `healthz` 校验 |

这 5 条都是「只有真跑到平台上才会暴露」的问题，本机门禁全绿时一个都看不见。

---

## 6. GitHub Pages：静态端真实上线（主仓托管）

私有仓库不能开免费 Pages（API 返回 422）。按「平台项目名统一为 MixmAPP」的规则，改为把主仓公开、Pages 直接挂在 `MixmAPP` 上，单文件产物由 `pages.yml` 在云端构建后发布：

- 托管方式：主仓 `https://github.com/afdk1991/MixmAPP`（`.github/workflows/pages.yml` 打单文件后发布，源码与产物同仓）
- 线上地址：<https://afdk1991.github.io/MixmAPP/>（HTTP 200，356,739 字节）
- 复核方式：浏览器打开即可；`/api` 未连，首页顶部会显示「未连上 API（先启动 services/api）」
- 原因：静态平台只托管 `index.html`，`/api/v1/...` 会落到平台域名上，平台没有该路由 → **所有接口 404**
- 接通方式：部署 API 后，用 `MIXMAPP_API_BASE=https://你的API域名 pnpm build:h5`（单文件版用 `MIXMAPP_API_BASE=... node scripts/build-h5-single.mjs`）重新构建；
  或直接改已部署 HTML 里的 `window.__MIXMAPP_API_BASE__`，无需重新构建

怎么生成的（源码仓内两条命令）：

```bash
node scripts/build-h5-single.mjs                       # 打进单文件 HTML
MIXMAPP_H5_BASE=/MixmAPP/ node scripts/build-h5-single.mjs   # 子路径托管时对齐路由 base
```

产物落在 `release/mixmapp-h5-single.html`（348 KB，JS/CSS 内联、图片转 data URI）。

途中踩到的真问题：uni-app H5 是多文件产物（`index.html` + `assets/*.js|css` + `static/*`），
而 EdgeOne Makers 只提供「单 HTML 内容 → 公网 URL」，多文件传不上去；单文件化后**第一次仍然白屏**，
原因是 `manifest.json` 的 `h5.router.base` 为 `/`，托管在 `/mixmapp-h5/` 子路径时路由匹配不到任何页面
（`<uni-app>` 里是空的）。把 `router.base` 对齐到部署子路径后，`data-page` 正常出现、页面渲染完整。

产物与源码同在主仓，Pages 走 `pages.yml`。

## 7. 尚未验证的部分（条件清单，不是结论）

| 项 | 缺什么 | 补齐后怎么验 |
|---|---|---|
| GitHub Pages 公网地址 | 已完成：主仓 `afdk1991/MixmAPP` + Pages | 见第 6 节 |
| Cloudflare Pages | `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` | 配好 secrets 后 `deploy` 的静态端会自动从 SKIP 转为实际发布 |
| 免费云 PostgreSQL（Neon/Supabase） | 账号与连接串 | 把 `DATABASE_URL` 指过去，跑 `db:migrate` + 集成测试 |
| 线上 API | 服务器 + SSH 私钥 + 域名 | 配 `DEPLOY_SSH_KEY`/`DEPLOY_HOST`/`DEPLOY_USER`，`deploy` 的 api job 走原子发布与健康校验 |
| 真实短信/支付/地图/推送/AI | 各平台商户号与密钥 | 填 `.env` 后 `/api/v1/meta` 对应能力变 `on`，再做真实回调 |
