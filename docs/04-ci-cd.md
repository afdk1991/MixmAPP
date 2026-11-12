# 构建、测试、部署、运维自动化

目标：**提交代码 → 门禁 → 多端产物 → 静态发布 → API 原子发布 → 线上校验**，全程无需人工步骤；凭据缺失时显式 SKIP，绝不假绿。

---

## 1. 流水线总览

```
push / PR
   │
   ├─ ci.yml            门禁（规则/类型/测试/构建）+ 三端产物 artifact
   ├─ android.yml       H5 → Capacitor sync → gradlew → APK/AAB artifact
   └─ deploy.yml（仅 main / tag）
        ├─ build                重新跑门禁并打发布包
        ├─ static               Cloudflare Pages 发布 H5
        └─ api                  SSH 上传 → 原子发布 → 线上健康校验
                                    
schedule（每日 02:20）
   └─ ops-nightly.yml   健康巡检 + 远端数据库备份
```

本地等价入口只有一个：`pnpm verify`（lint → typecheck → test → build:api → build:h5）。

---

## 2. 工作流明细

### `ci.yml`

- 触发：push 到 `main` / `develop`、`v*` tag、向 `main` 的 PR。
- 环境：`ubuntu-latest`、Node 22、pnpm 9.12.0（`--frozen-lockfile`）。
- 步骤：`lint` → `typecheck` → `test` → `build:api` → `build:h5` → `build:mp-weixin` → 上传 `mixmapp-artifacts`（api dist、h5、mp-weixin）。
- 并发：同一 ref 只跑一次，新提交自动取消旧任务。

### `android.yml`

- 触发：`apps/**` 或 `apps/mobile/**` 变更，或手动。
- 步骤：`build:h5` → `cap sync android` → `gradlew assembleDebug`（无签名时）→ `assembleRelease`（签名 secrets 齐备时）→ 上传 APK/AAB。
- Android SDK 用 runner 自带，JDK 固定 17（`actions/setup-java`）。

### `deploy.yml`

| Job | 内容 | 失败影响 |
|---|---|---|
| `build` | 完整门禁 + 打包 `api-<sha>.tar.gz`（含 `dist`、`node_modules`、`infra/sql`、`scripts`）与 `h5-<sha>.tar.gz` | 阻断发布 |
| `static` | 解包 H5 → `node scripts/deploy-static.mjs` 发 Cloudflare Pages | 只影响静态端 |
| `api` | scp 发布包与 `deploy/` 脚本 → 远端 `atomic-release.sh` → `healthcheck.mjs` | 自动回滚 |

### `ops-nightly.yml`

- 每天 02:20（北京时间）跑一次健康巡检与数据库备份。
- 备份命令在服务器上执行：`pg_dump | gzip` → `backups/` → 保留 14 天。

### `.gitee/pipeline.yml`

- 两 stage：`gates`（同 ci.yml 的门禁与三端构建）、`publish`（重建 H5 并发布 Pages）。
- Gitee Go 的变量需在仓库「流水线 → 变量」里配置，见下表。

---

## 3. 需要的 Secrets / Variables

| 名称 | 类型 | 用途 | 缺失时 |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | Pages 发布 | 静态发布 SKIP |
| `CLOUDFLARE_ACCOUNT_ID` | secret | Pages 发布 | 静态发布 SKIP |
| `DEPLOY_SSH_KEY` | secret | API 服务器登录（无口令私钥） | API 发布 SKIP |
| `DEPLOY_HOST` | secret | 目标主机 | API 发布 SKIP |
| `DEPLOY_USER` | secret | 登录用户 | API 发布 SKIP |
| `ANDROID_KEYSTORE_BASE64` | secret | release 签名 | 只出 debug APK |
| `ANDROID_KEYSTORE_PASSWORD` | secret | 签名库口令 | 同上 |
| `ANDROID_KEY_ALIAS` | secret | 签名别名 | 同上 |
| `ANDROID_KEY_PASSWORD` | secret | 签名口令 | 同上 |
| `CF_PAGES_PROJECT` | var | Pages 项目名（默认 `mixmapp`） | 用默认 |
| `HEALTH_BASE_URL` | var | 线上健康校验基址 | 跳过校验 |
| `MIXMAPP_API_BASE` | var | 静态端使用的 API 绝对地址（如 `https://api.mixm.app`） | 构建保持同源 `/api/v1`；静态平台会全量 404 |

> 静态托管平台只发前端文件，没有 `/api/v1` 路由。`MIXMAPP_API_BASE` 会在构建时写入
> `window.__MIXMAPP_API_BASE__`，前端优先读取它；也可以部署后直接改 HTML 里的这一行，
> 不必重新构建。API 侧记得把静态站域名加进 `CORS_ORIGINS`（默认 `*` 时无需配置）。

> 私钥一旦带口令，`ssh -i` 在非交互环境无法签名，会表现为「服务端 Accepted 但客户端 Permission denied」；CI 必须用**无口令**私钥。

---

## 4. 部署拓扑

```
/opt/mixmapp/
├─ releases/            每次发布一个时间戳目录，保留最近 5 个
├─ current -> releases/<stamp>   （符号链接，原子切换）
└─ deploy/              发布与回滚脚本（由 CI 同步）
/etc/mixmapp/api.env    运行环境变量（systemd EnvironmentFile）
/var/log/mixmapp/       应用日志
```

服务：`mixmapp-api.service`（systemd，`Restart=always`，读取 `/etc/mixmapp/api.env`，暴露 8080）。
反代：`infra/nginx/mixmapp-api.conf`（`/api/` → 127.0.0.1:8080，静态端可由 Nginx 或 Pages 承担）。

### 原子发布流程（`deploy/atomic-release.sh`）

1. 解包到 `releases/<stamp>`，校验 `dist/index.js` 存在。
2. `ln -sfn` 切换 `current`（原子操作，切换前线上仍在跑旧版）。
3. `node dist/db/migrate.js` 执行迁移（幂等，失败即停）。
4. `systemctl restart mixmapp-api`。
5. 连续 20 次 `/api/v1/healthz` 探活（1 秒间隔）。
6. 任一步失败 → 把 `current` 切回上一版 → 重启 → 退出码非 0。
7. 成功后清理，只保留最近 5 个 release。

### 回滚

```bash
bash /opt/mixmapp/deploy/rollback.sh      # 回退 1 个版本
bash /opt/mixmapp/deploy/rollback.sh 2    # 回退 2 个版本
```

回滚只切符号链接并重启，不回滚数据库迁移（迁移必须是只增不改的幂等脚本）。

---

## 5. 部署前的一次性准备

```bash
# 服务器（Ubuntu 22.04 示例）
sudo useradd -r -s /usr/sbin/nologin mixmapp
sudo mkdir -p /opt/mixmapp/{releases,deploy} /var/log/mixmapp /etc/mixmapp
sudo cp infra/systemd/mixmapp-api.service /etc/systemd/system/
sudo cp infra/nginx/mixmapp-api.conf /etc/nginx/conf.d/
sudo systemctl daemon-reload && sudo systemctl enable mixmapp-api

# 环境变量（权限 600）
sudo install -m 600 .env.example /etc/mixmapp/api.env
sudo editor /etc/mixmapp/api.env    # 填 JWT_SECRET / DATABASE_URL / 各家凭据
```

发布用户在 `/etc/sudoers.d/mixmapp-deploy` 里只授权执行发布与回滚脚本所需命令，不给完整 root。

---

## 6. 门禁为什么这样定

| 关卡 | 拦什么 | 成本 |
|---|---|---|
| `lint`（自写 5 条规则） | `console.log`、`.only`、硬编码密钥、TODO/FIXME、Vue 标签未闭合 | 0.5s，不引 ESLint 全家桶 |
| `typecheck` | 跨包类型漂移（尤其 `contracts` 改动未同步端侧） | 5s |
| `test` | 发号碰撞、鉴权流程、支付签名往返与篡改检测 | 7s |
| `build:api` / `build:h5` | 构建期错误、依赖缺失 | 12s |

全量 `pnpm verify` 在本机约 **25 秒**，因此可以放进 pre-push 或本地循环，而不是只在 CI 里跑。
