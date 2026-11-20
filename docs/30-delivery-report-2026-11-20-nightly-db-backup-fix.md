# 30 · 交付报告：夜间数据库备份失败根因修复并重新上线

- 日期：2026-11-20
- 范围：`scripts/backup.mjs`、`.github/workflows/ops-nightly.yml`（备份 job）
- 线上环境：腾讯云 CVM `115.159.159.11`，壳 `https://cloud.mixm.top/`，API `https://api.mixm.top/mixmapp/api/v1`，媒体 `https://img.mixm.top`
- 状态：**备份链路已在 CI 链路复跑转绿并复核**；凭据依赖项沿用 29 号报告卡点登记，本轮未凭空闭环

## 1. 结论先说

| 类别 | 状态 | 证据 |
| --- | --- | --- |
| 夜间备份 job 失败 | 已修复并转绿 | ops-nightly `44715448297`：健康巡检 success、数据库备份 success |
| 备份包落点 | 持久目录 | `/var/lib/mixmapp/backups/mixmapp-20261120-100035.sql.gz`（2266.0 KB） |
| 线上版本 / 真库 | 保持 0.0.2、db=ok | `/healthz` version=0.0.2、db=ok、dbTarget=server、catalogSync=success |
| 线上验收 | 16/16 通过 | 2 项演示沙箱口径 SKIP（幂等键、库存扣减） |
| 本地门禁 | 全绿 | 169 passed / 8 skipped；lint 通过；脚本语法检查通过 |
| ci / deploy | success | 提交 `7255532` 两条 run 均 completed success |

## 2. 失败现象

- `ops-nightly`（每日定时健康巡检 + 库备份）在 2026-11-20 00:37 的 run 中：健康巡检 job success，**数据库备份 job 的「远端备份」step failure**。
- 早期日志：`bash: line 1: /etc/mixmapp/api.env: Permission denied`。
- 手动复跑脚本时进程以退出码 13 结束，报 `Detected unsettled top-level await`；磁盘上却留下一个约 2.3 MB 的半截 gzip 包。

## 3. 根因（两个独立缺陷叠加）

### 3.1 权限：降权用户读不了 600 的 api.env

- `ops-nightly.yml` 备份命令原先用 `sudo -u mixmapp` 降权执行；而 `/etc/mixmapp/api.env` 属 `root:root`、权限 `600`，`mixmapp`（uid 998）无权读取，source env 时直接 `Permission denied`。

### 3.2 脚本：close 监听注册过晚，错过事件导致 TLA 挂起

- `scripts/backup.mjs` 原先在 `await pipeline(...)` **之后**才 `new Promise(res => dump.on('close', res))` 注册 close 监听。
- `pipeline` 完成时 `pg_dump` 进程已经退出、`close` 事件早已触发；等到注册监听时事件已经错过，Promise 永不 resolve，Node 以「unsettled top-level await」退出码 13 强杀进程。此时 gzip 流被截断，留下半截包。
- 排查对照：服务器 `/usr/bin/pg_dump` 在位；手动 `pg_dump ... "$DATABASE_URL" -f /tmp/mixmapp-test.sql` 成功（34 MB plain SQL，exit 0），证明数据库连接与 `pg_dump` 本身正常，问题在脚本编排而非数据通路。

## 4. 改动（提交 `7255532`，2 files, +10/-3）

1. **`scripts/backup.mjs`**：`spawn` 后立即注册 `closed` Promise（`dump.on('close')`）与 `spawnError` Promise（`dump.on('error')`）；`pipeline` 与 `spawnError` 竞速，任一先终结即落地。gzip 压缩、文件大小校验（<1024 字节判失败）、超期 `.sql.gz` 清理逻辑保持不变。
2. **`.github/workflows/ops-nightly.yml`**：
   - 备份 step 去掉 `sudo -u mixmapp`，由 SSH 对应用户（root）直接读取 `api.env`（注释说明 env 为 600 root）。
   - 显式 `BACKUP_DIR=/var/lib/mixmapp/backups` 持久目录，备份包不再写进随版本切换的 release 目录。
3. **服务器准备**：新建 `/var/lib/mixmapp/backups` 并 `chown mixmapp:mixmapp`；修复前生成的两个失败半截包与 `/tmp` 测试 SQL、临时脚本已清理，目录只留成功包。

### 改回去

- 若要恢复降权执行，需先把 `api.env` 改为 `mixmapp` 可读（或抽出仅含 `DATABASE_URL` 的低权 env）；当前 600 root 口径下不宜再用 `sudo -u mixmapp` source env。

## 5. 验证记录

### 5.1 本地

- `node --check scripts/backup.mjs`：通过。
- 无 `DATABASE_URL` 的 SKIP 路径：输出 `SKIP 未配置 DATABASE_URL，本次不备份`，exit 0。
- `pnpm lint`：通过（docs 22 两篇撞号为 Mim 并行会话豁免项，复核至 2026-11-21）。
- `pnpm test`：169 passed / 8 skipped（177 用例）。

### 5.2 服务器真库（修复后脚本临时上传 `/tmp` 验证，未手改线上 current 包）

- `BACKUP_DIR=/var/lib/mixmapp/backups node /tmp/backup.mjs`：exit 0，`✓ 备份完成 ...mixmapp-20261120-095508.sql.gz (2265.4 KB)`，`✓ 已清理 0 个超过 14 天的备份`。

### 5.3 流水线与线上复核

- 提交 `7255532` push main 后：`ci` success、`deploy` success；deploy 将修复后的 `backup.mjs` 随包发布到 `current/scripts/backup.mjs`。
- `/healthz`（带 `x-admin-token`）：`status=ok`、`version=0.0.2`、`checks.db=ok`、`dbTarget=server`、`dbHost=127.0.0.1:5432`、`catalogSync=success`。
- 线上验收 `scripts/acceptance.mjs https://cloud.mixm.top/mixmapp`：**16/16 通过**；并发重名 201=1 / 409=7；商品列表 count=20；演示单 `DEMO-` 前缀不落库；管理面落点 server / 127.0.0.1:5432；限流触发；幂等键与库存扣减两项按 demoMode 口径 SKIP。
- 手动 `workflow_dispatch` 复跑 `ops-nightly`（run `44715448297`，ref main `7255532`）：健康巡检 success、数据库备份 success；备份 step 日志 `✓ 备份完成 ...mixmapp-20261120-100035.sql.gz (2266.0 KB)`、`✓ 已清理 0 个超过 14 天的备份`，`SSH_READY: true`，非 SKIP。

## 6. 仍挂起（必须外部凭据 / 客观数据源约束，本地无法闭环）

沿用 29 号报告第 5 节登记，本轮无变化：CloudBase 云 PG 连接串、微信 / 支付宝真实回调凭据、短信 / 一键登录 / 地图 / 推送 / AI / 云存储与 OAuth 凭据、商品原图包或高清图库授权、小程序 AppID、Android release 上架渠道、Gitee 镜像、线上测试数据清理窗口，以及工作树并行会话在途改动。

补充说明：

- 共享静态托管桶根目录残留文件、CloudBase 云函数本体 `mixmapp-api-proxy` 是否进一步删除，仍按 29 号报告口径保留待拍板（误伤边界 / 回滚保留）。

## 7. 提交与产物

- 提交：`7255532` fix(backup): 修复 pg_dump close 监听错过事件导致备份挂起，夜间备份改 root 直读 env 并落持久目录（2 files, +10/-3）。
- 版本：工作号 0.0.2（release）；已发布登记 `released=["0.0.1"]`；tag `v0.0.1` 指向 `7528029`。
- 部署：deploy / ci `7255532` success；ops-nightly `44715448297` success。
- 备份产物：`/var/lib/mixmapp/backups/` 下保留成功包；保留期 `BACKUP_KEEP_DAYS=14`，超期自动清理。
