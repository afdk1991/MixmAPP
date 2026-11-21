# 自动部署引擎（V0.0.2，2026-11-22）

## 结论

上线从「一堆手敲命令」变成一条命令，且每步都有退出码、产物哈希与台账：

```bash
pnpm deploy:plan    # 演练：真构建、真抽检、真打包，不碰生产
pnpm deploy:apply   # 正式发布（工作树必须干净）
pnpm deploy:head    # 用 HEAD 干净副本构建后发布（工作树有别人未提交改动时用这个）
pnpm deploy:verify  # 只做线上断言（CI 用同一条）
```

引擎入口是 `scripts/deploy-engine.mjs`，八个阶段顺序执行、失败即停，退出码 0/1/2/4 分别代表成功、阶段失败、预检不通过、本机已有部署在跑。

## 八个阶段与各阶段的真实职责

| 阶段 | 做的事 | 失败后果 |
|---|---|---|
| 1 preflight | 分支必须是 main、工作树干净、私钥存在、生产 SSH 可达、`version:check` + `lint` | 直接退出，不产生任何产物 |
| 2 build | `build:api` + `build:h5`，强制注入 `api.mixm.top/mixmapp/api/v1` 与 `img.mixm.top` | 不产出包 |
| 3 verify | `deploy/check-h5-artifacts.mjs` 抽检 + 入口内断言基址/媒体源/无「预览」字样/`version.ts` 号一致 | 拦在打包前，避免坏包上传 |
| 4 package | `pnpm deploy --prod` + `version.json`/`infra`/`scripts` 入包 + tar + sha256 | 不上传 |
| 5 ship | scp 到 `/tmp`，并按字节数比对远端落地大小 | 上传不完整即停 |
| 6 release | 远端 `deploy/atomic-release.sh`（flock 互斥、切 symlink、迁移、重启、健康检查） | 脚本内部已回滚，引擎再补一道断言 |
| 7 assert | 线上 `meta.version` == 期望、`env=production`、`demoMode=false`、`healthz ok`、站点首页 200 | 自动 `rollback.sh 1` 回上一版并复检 |
| 8 ledger | 追加 `release/deploy-ledger.jsonl`，覆盖 `release/deploy-last.json` | 只告警，不影响发布结论 |

三道护栏值得单独记：

1. **脏工作树禁止发布**。未提交的改动不配上生产，这条会直接把 `--apply` 拦在 preflight（实测 exit 2）。要给并行会话留空间又要发版，用 `--from-head`：`git archive HEAD` 出干净副本、单独 `pnpm install` 后再构建，发出去的一定是已提交内容。
2. **远端排他**。沿用 `atomic-release.sh` 的 `flock`（`/var/lock/mixmapp-deploy.lock`，等待窗口 600s），手工发布、CI 发布、数据直送三路不会互相覆盖 symlink。
3. **断言失败自动回滚**。不是「报个错让人上去看」：引擎调 `deploy/rollback.sh 1` 切回上一版、同步 `APP_VERSION`、重启并复检；`--no-rollback` 只用于排查时保留现场。

## 实测证据（2026-11-22 本地跑）

演练全链路（`node scripts/deploy-engine.mjs`）：API + H5 构建成功 → 抽检「47 个文本文件，无公网 IP / 无内部服务域名 / 无凭据 / 无预览残留 / 基址 api.mixm.top / 媒体 img.mixm.top」→ 打包完成：

```
api-20261121161526.tar.gz  11,950 KB  sha256 DAEF1CB7…
h5-20261121161526.tar.gz      243 KB  sha256 4A00FAF7…
```

包内结构已核对：`./dist/index.js` 存在，`node_modules/`、`version.json`、`infra/`、`scripts/` 齐全。

线上断言（`--verify-only`，目标 `https://cloud.mixm.top`）6 条全过：meta 200、版本 0.0.2、env=production、demoMode=false、healthz ok、首页 200。

两个反例也跑过：

- `--apply` 在脏工作树上 → exit 2，提示「用 --from-head 只发布已提交的 HEAD，或先提交」。
- `--verify-only --expect-version=any` → 6 条全过，供回滚后不知道目标号时使用。

## 台账格式

`release/deploy-ledger.jsonl` 每行一条，`release/deploy-last.json` 是最新一条的可读副本（两者都在 gitignore 覆盖的 `release/` 下，属运行记录而非仓库源码）。一条 apply 记录包含：时间、版本与 versionCode、commit、分支、源码来源（工作树 / HEAD 副本）、两个产物的字节数与 sha256、远端 release 目录、六条断言结果、各阶段耗时、最终结论（`success` / `rolled-back` / `rollback-failed`）。排障时先看这里，不必再猜「线上是哪次构建」。

## 与 CI 的关系

- `.github/workflows/deploy.yml` 仍是 push main 自动发，新增「发布后版本断言」step：调 `deploy-engine.mjs --verify-only --expect-version=<version.json 解析值>`，让「线上是不是这一版」变成会变红的断言，不再依赖人工 curl。
- 新增 `.github/workflows/rollback.yml`：手动触发、可指定回退几个版本，复用 `deploy/rollback.sh`，回滚后用 `--expect-version=any` 断言「线上是正式号且健康」。
- 两条工作流共用 `concurrency: deploy-production`，与远端 flock 形成双保险。

## 边界（明确不做的事）

- **本轮没有用它发过生产**。核查时生产 `current` 指向 `releases/20261121191911`，是并行会话约一小时前刚发的版本；此时用 `--from-head` 覆盖，会把对方尚在工作树里的品牌改动从线上顶掉。引擎已就绪、演练与断言都验过，正式那一发留到改动定稿后再执行（一条命令，失败自动回滚）。
- 引擎只发「API + H5 目录产物」这一条链路；单文件 `release/mixmapp-h5-single.html` 与安装包 `mixmapp-install-<ver>.tar.gz` 仍由 `build:h5:single` / `package-installer.mjs` 产出，不随引擎上传。
- 不替用户 push 代码。`pnpm deploy:apply` 只部署，不改远端仓库；push main 仍会各自触发 CI 与 deploy。
- 引擎不做数据库写操作，除 `atomic-release.sh` 里既有的 `dist/db/migrate.js`（幂等迁移）。
- `--from-head` 会额外做一次 `pnpm install --frozen-lockfile`，比在工作树上直接构建慢；它是「工作树不干净时唯一正确的发版姿势」，不是默认路径。
