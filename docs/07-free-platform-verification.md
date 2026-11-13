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
## 8. 腾讯云 CloudBase 真实 PostgreSQL 取证（免费额度内）

CloudBase 环境 `cs-1-d5g815slocb5a611a` 本身带 PostgreSQL（实例 `cloudbase-pg`，`RuntimeMode=cloudbase-manager`，角色 `cloudbase_postgres`），
因此「一库到底」不必再找 Neon/Supabase：**库是真库，且已把 MixmAPP 的表建进去了**。

隔离决策：该环境的 `public` 已有另一个项目的 36 张表（`articles`/`posts`/`mall_orders`…），
所以 MixmAPP 的所有对象都放进独立 schema **`mixmapp`**，不写 `public`。

已应用的迁移（均 `Status=Succeed` 且 `verified=true`，走 `PushPGUserMigrations`）：

| migrationVersion | 名称 | TaskId | 内容 |
|---|---|---|---|
| 20261112105000 | `mixmapp_init` | `task-623c2c71e0814a81` | `users`（含 `snowflake`/`ulid`/`uuid_v7`/`account_no`）、`bindings`、`refresh_tokens`、`sms_codes`、`payments`、`push_tokens` |
| 20261112105500 | `mixmapp_mall` | `task-402b21b6891f46c5` | `products`、`carts`、`orders`、`order_items` + 6 条演示商品 |
| 20261112105600 | `mixmapp_signup` | `task-61065491dc644ab0` | `users.username`、`users.guest`、用户名小写唯一索引、`bindings(provider,open_id)` 索引 |

复核结果（`queryPgDatabase` 只读 SQL）：`mixmapp` 下 10 张表（`users` 16 列、`orders` 11 列、`payments` 11 列、`products` 13 列…），
`products=6`、`users=0`。

自动分配 ID 的真实落库验证：用 `packages/ids` 的 `IdFactory({ strategy: 'snowflake', workerId: 1 })` 生成一组号，
`INSERT` 进 `mixmapp.users` 再读回，四个标识全部一致——

```
id        114314899022155776
accountNo MixmAPP-035H-0SE2-C040-0
ulid      01M77NVNGKTVVNEFTV62YPW2D2
uuid_v7   01a1cf5d-d614-74cf-9309-309d8cd1366b
```

验证完立即删除该探针行，库里不留假账号。

第 9 个上云真故障：`managePgDatabase(applyMigration)` 传 `defaultSchema="mixmapp"` **不会**改变迁移任务的 `search_path`，
首条迁移把 6 张表建进了 `public`。修法是用 `DO $$ BEGIN EXECUTE 'ALTER TABLE public.users SET SCHEMA mixmapp'; … END $$` 逐表搬到 `mixmapp`，
此后所有 DDL/DML 一律显式写 `mixmapp.` 前缀，不再依赖 `defaultSchema`。

仍未接上：Fastify API 还没连到这个云库——CloudBase PG 的连接串只在控制台可见，MCP 不返回。
拿到连接串后即可把 `DATABASE_URL` 指过去跑 `db:migrate` 与 4 个 PG 集成测试（`REQUIRE_DATABASE_URL=1`），
那就是「云平台侧真库 + 真 API」的闭环取证。
## 9. 线上路由与页面取证（GitHub Pages）

H5 是 history 模式（`manifest.json` 的 `h5.router.mode=history`），而 Pages 只有一份 `index.html`，
所以 `/MixmAPP/pages/auth/register` 这类深链接在没有兜底页时直接 404，页面打不开。

修法：`pages.yml` 在组装 `_site` 时把同一份单文件再复制成 `404.html`（提交 `83eda73`，run `43205130469` 绿）。
验证结果：

| 地址 | HTTP | 渲染 |
|---|---|---|
| <https://afdk1991.github.io/MixmAPP/> | 200 | 首页（hero / 未连上 API 提示 / 四宫格） |
| `/MixmAPP/pages/auth/register` | 404（Pages 用 404.html 兜底） | 创建账号页正常：手机号/邮箱/用户名/一键登录分段、验证码、游客身份进入 |
| `/MixmAPP/pages/mall/index` | 404 | 商城页壳正常，但商品区显示「请求失败(404)」——因为没有部署 API |

截图：`docs/screenshots/live-home.png`、`live-register.png`、`live-mall.png`。

注意：深链接的状态码仍是 404（内容由 `404.html` 提供），浏览器能正常渲染，但爬虫/监测会看到 404。
要 200 语义，得换到支持 SPA rewrite 的宿主（Cloudflare Pages 的 `_redirects`、CloudBase 的路由规则、nginx 的 `try_files`）。

商城页那条「请求失败(404)」就是 API 缺位的直接证据，和本文第 8 节的结论一致：库有了，服务还没上。
## 10. 线上全链路 E2E 取证（前端 → API → PostgreSQL）

平台接线已完成，链路是：GitHub Pages（单文件 H5）→ `https://cloud.mixm.top/mixmapp/api/v1` → 服务器上的 Fastify API → PostgreSQL。
部署方式：`deploy.yml` 的 `api` job 走 SSH 原子发布（secrets `DEPLOY_HOST`/`DEPLOY_USER`/`DEPLOY_SSH_KEY_B64`，
变量 `HEALTH_BASE_URL=https://cloud.mixm.top/mixmapp`、`MIXMAPP_API_BASE=https://cloud.mixm.top/mixmapp/api/v1`）。

用真实 HTTP 请求打线上，结果如下（2026-11-12）：

| 请求 | 结果 |
|---|---|
| `GET /healthz` | 200，`{"status":"ok","version":"0.0.0-preview","checks":{"db":"postgres"}}` |
| `GET /api/v1/meta` | 200，`appName=MixmAPP`，ID 策略 `snowflake`，第三方能力矩阵完整 |
| `GET /api/v1/mall/products` | 200，6 条商品真实从库里读回（2.1 KB） |
| `POST /api/v1/auth/register/username` | 201，**自动分配** `id=114341178375143424`、`accountNo=MixmAPP-035H-RP8M-4000-0` |
| `POST /api/v1/auth/login/password` | 200，返回同一 `accountNo`，`isNewUser=false` |
| `GET /api/v1/me`（Bearer） | 200，`accountNo/nickname/username` 与注册时一致 |
| 同用户名再注册 | 409（唯一约束生效，证明是真落库不是内存态） |
| `POST /api/v1/auth/refresh` | 200，换发新 access/refresh |
| 旧 refreshToken 重放 | 401（轮换生效，旧令牌立即失效） |

前端侧：商城页已从「请求失败(404)」变为真实渲染 6 件商品（价格 ¥299/¥459/¥89/¥39…），
说明 `MIXMAPP_API_BASE` 已正确烤进 H5 并跨域可用。截图见 `docs/screenshots/live-mall.png`。

留痕：本次验收在线上库创建了测试账号 `qa_probe_1112`（`accountNo=MixmAPP-035H-RP8M-4000-0`），
用于证明注册→分配 ID→登录全链路；该账号未删除，需要时可在 `/me` 里改名或后续清理。

尚未真实接入的第三方（`/api/v1/meta` 里仍是 dev/console/off）：短信 `console`、一键登录 `dev`、
微信/QQ/GitHub/Apple OAuth `off`、微信支付/支付宝 `off`、地图/存储/推送/AI `dev`。
这些改成 `on` 需要各平台商户号与密钥，属于外部凭据缺口，不是代码缺口。
## 11. 最小闭环：数据库落点开关 + 线上验收 12/12

### 11.1 数据库落点可切换（云 PG 权威 / 本机 PG 自由开关）

`services/api/src/config.ts` 新增 `DB_TARGET`：

| 环境变量 | 作用 |
|---|---|
| `DB_TARGET=cloudbase`（默认） | 权威库：取 `DATABASE_URL_CLOUDBASE` |
| `DB_TARGET=local` | 备援：取 `DATABASE_URL_LOCAL` |
| `DATABASE_URL` | 上面两个都没配时的兜底，保持旧部署兼容 |

两个连接串可同时存在于 `/etc/mixmapp/api.env`，切换只改一个变量，不用动 GitHub secrets。
`/healthz` 现在如实报出落点，避免「以为在云库、其实连本机」：

```json
{"status":"ok","checks":{"db":"postgres","dbTarget":"cloudbase","dbHost":"127.0.0.1:5432","dbSource":"DATABASE_URL"}}
```

服务器侧开关脚本 `deploy/db-target.sh`（随发布包落在 `/opt/mixmapp/deploy/`）：

```bash
sudo bash /opt/mixmapp/deploy/db-target.sh status      # 看当前落点与两个连接串是否就绪
sudo bash /opt/mixmapp/deploy/db-target.sh cloudbase   # 切云 PG
sudo bash /opt/mixmapp/deploy/db-target.sh local       # 切本机 PG
```

行为：改 `DB_TARGET` 前先备份 `api.env`，重启服务后轮询 `/healthz` 25 秒，
只有报出对应 `dbTarget` 才算成功；不通过则自动回退到上一个落点并重启，避免把线上切成不可用状态。

现状如实说明：`dbTarget=cloudbase` 但 `dbHost=127.0.0.1:5432`、`dbSource=DATABASE_URL`，
说明 `DATABASE_URL_CLOUDBASE` 还没填，当前实际仍跑在本机 PG 上。填上云连接串后再执行 `db-target.sh cloudbase` 才算真正切过去。

### 11.2 并发重名从 500 改判 409（线上验收抓出的真 bug）

首轮线上验收里「8 个同名并发注册」的结果是 `201=1 / 409=0 / 其他=7`——先查后插在并发下漏判，
数据库唯一约束的 `23505` 直接冒到 Fastify，变成 500。修法：`createUser` 兜住 `23505`，
按约束名映射成 409（用户名/邮箱/手机号/账号号段各给一句人话），其余错误照旧抛出。
同时在 `services/api/test/postgres.integration.test.ts` 加了 6 并发同名注册的回归测试（CI 的真 PG service 上跑）。
修复后线上复测：`201=1 409=7 其他=0`。

### 11.3 线上验收脚本与结果

`scripts/acceptance.mjs`（任何一套已部署的 API 都能跑）：

```bash
node scripts/acceptance.mjs https://cloud.mixm.top/mixmapp
```

覆盖 5 条核心路由的边界：真库连通、能力矩阵、并发重名只成功一次、注册自动分配 ID、
密码登录、`/me` 一致、令牌有效期、伪造令牌 401、刷新轮换、旧令牌重放 401、游客注册幂等、限流触发。

2026-11-12 修复后线上结果：**12/12 通过**

```
✓ 健康检查与真库连通      db=postgres dbTarget=cloudbase dbHost=127.0.0.1:5432
✓ Meta 能力矩阵          appName=MixmAPP
✓ 并发重名只成功一次      201=1 409=7 其他=0
✓ 注册自动分配 ID         id=114355518453055488 accountNo=MixmAPP-035J-5QKV-R000-0
✓ 密码登录              isNewUser=false
✓ /me 与注册一致
✓ access token 有效期     exp-iat=900s
✓ 伪造令牌被拒            401
✓ 刷新换发新令牌          200
✓ 旧 refreshToken 重放    401
✓ 游客注册幂等            同一 deviceId 两次同号
✓ 限流触发               第 45 次请求
```
## 12. 第二批：商城下单链路（含一个库存泄漏真 bug）

### 12.1 库存泄漏：多行下单中途失败，前面扣掉的库存没还

`createOrder` 原先逐行扣库存，任一行失败就整单失败，但**已经扣过的行不回滚**：
两行商品里第一行够、第二行不够时，第一行的库存就凭空消失了。修法：记录已扣行，
失败时逐行 `restoreStock` 归还；`Store` 接口新增 `restoreStock`（内存实现与 PG 实现各一份，
PG 侧是 `update products set stock = stock + $2 where id = $1`）。
回归测试 `mall.test.ts`：A 库存 5、B 库存 1，下单 A×2 + B×2 得 409，读回 A 仍为 5、B 仍为 1。

### 12.2 线上验收扩到 15 项（新增商城写链路）

`scripts/acceptance.mjs` 增加：商品列表、加入购物车、下单 201、下单后库存真的减少 1。
2026-11-12 线上结果 **15/15 通过**，其中商城三项：

```
✓ 商品列表可读           count=6
✓ 购物车加入 + 下单成功   orderNo=MOMWDLTRHA624705 status=201
✓ 下单后库存真的减少 1    before=120 after=119
```

### 12.3 仍然没做到的（明确记账，不算完成）

- **下单幂等**：同一用户网络重试会生成两张订单并重复扣库存。需要给 `POST /mall/orders`
  加 `Idempotency-Key`，落一张 `order_requests(user_id, key)` 唯一表；目前未做。
- **支付真实回调**：`modules/pay.ts` 的微信/支付宝适配器只有骨架，回调验签、金额比对、
  重复回调幂等都没有真凭据可验（`/meta` 里 `wechatPay/alipay` 仍是 `off`）。
- **CloudBase 云 PG 仍未接**：`DATABASE_URL_CLOUDBASE` 缺值，`dbTarget` 是 cloudbase 但实际连本机。
## 13. 数据库权威落点确认 + 管理后台热切换

### 13.1 结论

- **CloudBase 云 PG 是权威库**：`DB_TARGET` 默认就是 `cloudbase`，不带任何参数启动即按权威库解析连接串。
- **云服务器自建 PG 是备援**：`DB_TARGET=server`（旧值 `local` 保留为等价别名，线上 env 不用改也不会失效）。
- 两个连接串可同时存在于 `/etc/mixmapp/api.env`：`DATABASE_URL_CLOUDBASE` 与 `DATABASE_URL_LOCAL`（也接受 `DATABASE_URL_SERVER`）。

### 13.2 管理后台直接切换（不重启、不改文件）

新增管理面接口（挂在 `/api/v1` 下）：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/admin/db` | 查看当前落点、驱动、host、连接串来源，以及两套库是否已配置（只给 host:port，不回传连接串） |
| POST | `/admin/db/switch` | body `{"target":"cloudbase"|"server"}`，现场切换 |

鉴权：请求头 `x-admin-token` 必须等于 `ADMIN_TOKEN`。**未设置 `ADMIN_TOKEN` 时整组路由返回 404**，不暴露管理面存在；令牌错误同样 404，不返回 401 去提示“口令存在”。

热切换靠 `db/switchable.ts` 里的一层 Proxy：AuthService / MallService 拿到的 Store 引用不变，
每次属性访问都落到“当前实现”上；切换时先建新连接池、`ping` 验证通过才原子换指针，然后把旧池异步关闭。
**新库连不通就不换指针**，旧库继续服务——不存在“切一半把服务切死”的状态。

### 13.3 上线现状与仍缺的东西

服务端脚本仍然保留（`deploy/db-target.sh [status|cloudbase|server|local]`），用于“服务已经起不来”时的兜底，
它的行为不变：备份 env → 重启 → 轮询 `/healthz` 25 秒确认 `dbTarget` → 失败自动回退。

当前线上仍是：

```json
{"dbTarget":"cloudbase","dbHost":"127.0.0.1:5432","dbSource":"DATABASE_URL"}
```

即**权威落点已声明，但权威库连接串还没值**，实际落在云服务器自建 PG。要真正切过去需要两件事，都不是代码工作：

1. 把 CloudBase 控制台里的连接串写进 `api.env` 的 `DATABASE_URL_CLOUDBASE`（控制台可见，MCP 不回传）。
2. 设置 `ADMIN_TOKEN`，管理接口才会从 404 变成可用。

填好后两种切法等效：`sudo bash /opt/mixmapp/deploy/db-target.sh cloudbase`，或带令牌调 `POST /api/v1/admin/db/switch`（后者不重启进程）。
## 14. 下单幂等、超时取消、管理面启用（2026-11-12）

### 14.1 下单幂等：同一 Idempotency-Key 只落一张单

客户端在 `POST /api/v1/mall/orders` 带上 `Idempotency-Key` 头。服务端流程是
**抢占 → 落单 → 回写**：先往 `order_requests(user_id, key)` 插一行占位，插不进去说明这个键
已被用过——若已有 `order_no` 就直接返回那张单，若还没有（并发请求正在处理）返回 409 让客户端稍后重试。
下单本身失败时释放占位，允许用同一个键重试；成功则把 `order_no` 回写进占位行。
因为扣库存发生在「抢占成功之后」，所以重试不会重复扣库存。

迁移：`infra/sql/0004_order_requests.sql`（建表 + `orders(status, created_at)` 索引）。
两套库都已落下：VPS 自建 PG 由 `RUN_MIGRATIONS=1` 自动执行；CloudBase 云 PG 走
`applyMigration`（版本 `20261112141000`，任务 `task-abf52e109daa48bf`，Status=Succeed），
复核 `information_schema.tables` 显示 `mixmapp` 下 **11 张表**，`order_requests` 已在列。

### 14.2 待支付订单超时取消

`ORDER_TTL_MINUTES`（默认 30，0 表示关闭）。API 进程内每分钟扫一次：取 `status=pending`
且 `created_at` 早于 TTL 的订单，用**条件状态流转**（`update ... where id=$1 and status=$2`）
把 pending 改成 cancelled，只有真正改成功的那张才按 `order_items` 逐行归还库存。
条件流转保证「刚好在这一秒支付成功」的订单不会被误取消。

管理面提供手动触发：`POST /api/v1/admin/orders/sweep`（同样需要 `x-admin-token`），返回本次取消的订单号。

### 14.3 管理面已启用（不再是 404）

`ADMIN_TOKEN` 已写入服务器 `/etc/mixmapp/api.env`（令牌只保存在服务器与本机
`%USERPROFILE%\.mixmapp\admin_token.txt`，**不进仓库、不写文档**），服务重启后生效：

```
GET /api/v1/admin/db  (带 x-admin-token)
→ {"data":{"target":"cloudbase","driver":"postgres","host":"127.0.0.1:5432","source":"DATABASE_URL",
          "available":{"cloudbase":{"configured":false,"host":"none"},"server":{"configured":false,"host":"none"}}}}
GET /admin/db（错误令牌）→ 404
POST /admin/db/switch {"target":"cloudbase"} → 409 "cloudbase 还没有配置连接串，先写入环境变量再切换"
```

`available.cloudbase.configured=false` 就是「云 PG 连接串还没填」的机器可读证据。

### 14.4 线上验收 18/18

```
✓ 商品列表可读                 count=6
✓ 购物车加入 + 下单成功         orderNo=MOMWDMMSX8948481 status=201
✓ 同一幂等键重试返回同一单       retry=MOMWDMMSX8948481
✓ 下单后库存只减 1（重试未重复扣） before=118 after=117
✓ 管理面可读数据库落点           target=cloudbase host=127.0.0.1:5432 source=DATABASE_URL
✓ 管理面错误令牌被拒             status=404
✓ 限流触发（第 36 次请求）
合计：18/18 通过
```

单元测试同步扩到 62 例（新增：同键重试同单且库存只扣一次、不同键两笔独立单、超时取消后状态为
cancelled 且库存归位）。

### 14.5 仍然缺的一件（不是代码）

`DATABASE_URL_CLOUDBASE` 仍为空。云 PG 侧 schema 已经和代码对齐（11 张表、4 条迁移），
但连接串只在 CloudBase 控制台可见，MCP 不回传。填进 `api.env` 后，带令牌调
`POST /admin/db/switch {"target":"cloudbase"}` 即可热切，切成功判据是 `/healthz` 的
`dbSource` 变成 `DATABASE_URL_CLOUDBASE`、`dbHost` 变成云 PG 地址。
## 15. 超时取消的线上实证 + APP 内管理后台（2026-11-12）

### 15.1 为什么还要专门跑一次

14 章的超时取消只被单元测试覆盖（内存 Store，把 `now` 往后拨）。生产上真正危险的是
「扫描和支付同时发生」和「库存归还重复执行」，这两点在内存测试里看不出来。所以临时把
线上 TTL 压到 1 分钟，跑真实链路，跑完立刻恢复默认 30。

### 15.2 做法与结果

1. `api.env` 追加 `ORDER_TTL_MINUTES=1`，`systemctl restart mixmapp-api`；
2. 探针脚本：注册新账号 → 读商品库存 → 下单 1 件 → 等 70s → `POST /api/v1/admin/orders/sweep`
   → 读订单状态与库存；
3. 取证（订单号 `MOMWDN2Q1E798913`）：

```text
[1] 商品 MixmAPP 首发限定礼盒 库存 before=120
[2] 注册成功 accountNo=MixmAPP-035J-JMK3-R000-0
[3] 下单 MOMWDN2Q1E798913 后库存 after=119（比 before 少 1）
[5] sweep → ttlMinutes=1 取消 1 单：["MOMWDN2Q1E798913"]
[6] 订单状态 status=cancelled
[7] 库存：sweep 前 119 → sweep 后 120（本单取消 +1）
✓ TTL 取消 + 库存归还 在线上成立（+1 与本单取消数量一致）
```

4. 随后删掉 `ORDER_TTL_MINUTES` 行、重启，`/healthz` 恢复 `dbTarget=cloudbase` / `dbHost=127.0.0.1:5432`，
   线上 TTL 回到默认 30 分钟。

### 15.3 两条真实的判定经验（写进脚本，避免下次误判）

- **不能断言「库存回到下单前」**。库里还躺着历史遗留的待支付订单（历次验收只下单不付款），
  它们会被同一轮扫描批量取消，库存一次多补好几件，看起来像「归还错了」。
  正确判据是：`sweep` 返回的 `cancelled` 里含本单，且库存增量 = 本单取消的数量（±1 核对）。
- **第一次跑真的踩到了**：before=117、下单后 116、sweep 后 120。多出来的 3 件正是三轮历史
  验收遗留的 pending 单被同一扫描顺带取消。行为是对的，断言是错的。

### 15.4 APP 内管理后台

`apps/app/src/pages/admin/index`（`pages.json` 已注册，`pages/settings/about` 有入口）：

| 能力 | 实现 |
| --- | --- |
| 令牌 | 输入后只存本机 `mixmapp:adminToken`；服务端 `ADMIN_TOKEN` 才是权威 |
| 读落点 | `GET /admin/db`，展示 target / host / source / 云 PG 是否已配置 |
| 热切换 | `POST /admin/db/switch`，两个按钮切 cloudbase / server |
| 手动扫单 | `POST /admin/orders/sweep`，显示本次取消数量与 TTL |

`apiRequest` 增加 `headers` 入参承载 `x-admin-token`；页面样式不依赖全局 SCSS 令牌（写死字面量），
避免被其他分支的设计令牌改动牵连。

线上取证（GitHub Pages，`/MixmAPP/pages/admin/index`，390×844 手机视口）：

```text
titles: 管理令牌 / CloudBase 云 PG（权威） / 切换落点 / 超时订单扫描
rows:   驱动 postgres ｜ 实际主机 127.0.0.1:5432 ｜ 连接串来源 DATABASE_URL ｜ 云 PG 已配置：未配置连接串
```

这与 `/healthz` 完全一致：权威落点已声明为 cloudbase，但 `DATABASE_URL_CLOUDBASE` 仍缺值，
所以实际仍落在云服务器自建 PG。管理页把这个「声明与实际」的差异直接摆在界面上，不需要再 SSH 查。

### 15.5 顺手修掉的一个预览坑

`scripts/serve-h5.mjs` 的代理原来用 `new URL(req.url, API_ORIGIN)`，当 `API_ORIGIN` 带路径前缀
（线上是 `https://cloud.mixm.top/mixmapp`）时前缀会被丢掉，请求打到 `https://cloud.mixm.top/api/v1/...`
而不是 `/mixmapp/api/v1/...`。已改为拼接 `base + req.url`，本地预览可直接打线上 API。

### 15.6 截图法的一个坑（避免再次误判成 CSS 溢出）

Edge 无头模式的 `--window-size=430,932` 会被钳制到约 492 CSS px 宽，但 `--screenshot` 仍按 430 裁图，
于是页面右侧看起来「被截断」，很容易误判成布局溢出。用 CDP 的
`Emulation.setDeviceMetricsOverride` 精确设视口（390×844、DPR=2）再 `Page.captureScreenshot`，
量出来的 `innerWidth` 与页面元素 `getBoundingClientRect()` 才是可信的。
## §16 商城链路返回闭环（2026-11-13）

**用户报告**：进入商城后无法返回首页。

**代码层事实**（排查时不猜、只读代码与线上 DOM）：
- 全项目此前没有任何 `navigateBack` / `reLaunch` 调用，所有页面只用 `navigateTo` 往下钻；
- 首页使用 `navigationStyle: custom`（自绘 hero），商城页虽为默认导航栏，但深度链接进入时栈里只有一页，导航栏不会渲染返回键；
- 商城页自绘头只有标题与「购物车」，没有页内返回入口；详情、购物车、订单、我的、管理页同理。
- 结论：返回能力 100% 依赖系统导航栏的历史栈，一旦入口来自深链、分享链接或自定义头覆盖，就没有任何可点的回首页入口。

**修复**：
- 新增 `apps/app/src/components/nav-back/nav-back.vue`（easycom 组件，样式全字面量，不依赖未提交的 SCSS 令牌）：
  - 栈内多于一层 → `uni.navigateBack({ delta: 1 })`，失败回落 `reLaunch` 首页；
  - 栈内只有当前页 → 直接 `reLaunch('/pages/index/index')`；
  - 文案随栈深切换：「返回」/「首页」。
- 接入 7 个二级页：`mall/index`、`mall/detail`、`cart/index`、`orders/index`、`me/index`、`admin/index`、`settings/about`。

**验证（本地构建 + CDP 真实点击，390×844）**：
- 首页点「商城」进入 → `location=/pages/mall/index`，页内控件文案「返回」，点击后回到 `/`；
- 直接打开 `/pages/mall/index`（模拟深链，栈深 1）→ 控件文案「首页」，点击后 `reLaunch` 到 `/`；
- `uni build` 通过；`nav-back` 样式进入产物 `nav-back-*.css`。

**线上复验（Pages run 43433292684，commit 7d5f209）**：docs/screenshots/live-mall-back.png 为线上商城首屏，标题栏下即「‹ 首页」控件；首页→商城「返回」回首页、直开商城「首页」eLaunch 回首页，两条路径均在线上点通。

**顺带记一笔**：本机 4173 端口被并行会话的 Mim 预览占用，`serve-h5` 起来后 `EADDRINUSE` 静默失败，打开的是别人的产物（页面标题「欢迎使用 Mim」、路由 `/marketplace`）。判断「构建产物是不是自己的」不要只看端口活着：先看产物 JS 里有没有本项目标识，再用 `H5_PORT=4199` 另起一份。
## §17 收敛为「只用腾讯云服务器」单入口（2026-11-13）

**决策**：暂停所有平台托管，唯一对外入口 = 腾讯云 CVM `115.159.159.11` + 域名 `cloud.mixm.top`。

**做了什么**：
1. `gh workflow disable` 关掉 `Pages`（GitHub Pages 部署）与 `Image`（ghcr 镜像推送）；保留 `ci`（测试）、`deploy`（服务器原子发布）、`Android`（原生壳构建）、`ops-nightly`（服务器探活）。
2. `deploy.yml` 删掉 Cloudflare `static` job；H5 不再需要外部平台，改用 `MIXMAPP_API_BASE` 默认值 `/mixmapp/api/v1`，与 API 同域。
3. `deploy/atomic-release.sh` 新增 `WEB_ARTIFACT`：H5 与 API 在同一个 release 目录内（`releases/<STAMP>/dist` 与 `releases/<STAMP>/web`），入口缺失即视为发布失败、不切 symlink，回滚沿用原来的「指回上一版」。
4. nginx `cloud-mixmapp.conf` 重写为单站：
   - `/` → `root /opt/mixmapp/current/web`，`try_files $uri $uri/ /index.html`（history 深链接可用）；
   - `/mixmapp/` → `127.0.0.1:8080`（API 前缀剥掉）；
   - 删掉「其余路径 proxy 到 8787」的旧行为——那是另一个项目（Mim）的进程，会让两个站串台。
   旧配置已备份到 `/root/cloud-mixmapp.conf.bak-<时间戳>`，`nginx -t` 通过后 reload。

**线上验证**（`deploy` run 43434486004，commit 6b4058f）：
- `https://cloud.mixm.top/` → 200，472,024 字节，`text/html`；
- `https://cloud.mixm.top/pages/mall/index`（history 深链接）→ 200，同一份 HTML；
- `https://cloud.mixm.top/mixmapp/api/v1/healthz` → 200 `{"status":"ok",...}`，`dbTarget=cloudbase`；
- CDP 390×844 真实点击：首页点「商城」→ `/pages/mall/index`，控件「返回」→ 回到 `/`；直开商城 → 控件「首页」→ `reLaunch` 回到 `/`。

**截图**：`docs/screenshots/live-tx-home.png`（首页，右侧状态为 `ONLINE / production`，说明同域 API 已连通）、`live-tx-mall.png`（商城首屏，标题栏下即「‹ 首页」）。

**仍留在外部平台的残留（未删，仅停用）**：GitHub Pages 站点、CloudBase 静态托管、ghcr 镜像。真要删除需再确认，避免误删仍在被引用的地址。
