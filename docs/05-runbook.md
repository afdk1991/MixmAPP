# 运维手册

## 1. 首次上线清单

- [ ] 服务器：Ubuntu 22.04+、Node 22、PostgreSQL 15+、Nginx、systemd
- [ ] 建用户与目录：`mixmapp` 用户、`/opt/mixmapp/{releases,deploy}`、`/var/log/mixmapp`
- [ ] `/etc/mixmapp/api.env` 权限 600，至少含 `JWT_SECRET`、`DATABASE_URL`、`PUBLIC_BASE_URL`、`ID_STRATEGY`、`SNOWFLAKE_WORKER_ID`
- [ ] 数据库建库建号，跑过 `node dist/db/migrate.js`（或首次发布时由流程自动跑）
- [ ] systemd 单元装好并 `enable --now`
- [ ] Nginx 反代 `/api/` → `127.0.0.1:8080`，`client_max_body_size` 按上传需求调
- [ ] 端口只对内网开放；对外只暴露 443
- [ ] 远端 `curl https://<域名>/api/v1/healthz` 返回 `{"status":"ok"}`
- [ ] CI secrets 配置齐全（见 `04-ci-cd.md`）
- [ ] 备份任务已跑通一次，并**实际恢复**到临时库验证可用

## 2. 日常发版

```bash
git push origin main          # 触发 deploy.yml
```

观察顺序：`build` 绿 → `static` / `api` 绿 → 远端 `healthz` 绿。三者缺一都不算发布成功。

手工发布（应急）：

```bash
# CI 产物下载后
scp api-<sha>.tar.gz deploy-user@host:/tmp/api.tar.gz
ssh deploy-user@host 'sudo ARTIFACT=/tmp/api.tar.gz bash /opt/mixmapp/deploy/atomic-release.sh'
```

## 3. 回滚

```bash
bash /opt/mixmapp/deploy/rollback.sh       # 回上一版
bash /opt/mixmapp/deploy/rollback.sh 2     # 回两版
```

回滚只换符号链接 + 重启，**不动数据库**。如果事故由迁移引起，只能前滚修复（迁移脚本必须只增不改）。

## 4. 巡检

| 频率 | 动作 | 命令 |
|---|---|---|
| 每次发布 | 健康检查 | `curl -fsS https://<host>/api/v1/healthz` |
| 每日 | 自动巡检 + 备份 | `ops-nightly.yml` |
| 每周 | 看错误日志聚合 | `journalctl -u mixmapp-api --since "7 days ago" \| grep '"level":50'` |
| 每月 | 恢复演练 | 从 `backups/` 取一份恢复到临时库，跑 `select count(*) from users` |

`/api/v1/readyz` 会检查数据库连通性，`/api/v1/healthz` 只报进程存活与能力快照。探活用 healthz，排障用 readyz。

## 5. 备份与恢复

```bash
# 备份（S3/本地皆可，默认 backups/，保留 14 天）
DATABASE_URL=postgres://... node scripts/backup.mjs

# 恢复
gunzip -c backups/mixmapp-20261112-0220.sql.gz | psql "$DATABASE_URL"
```

备份文件含用户手机号/邮箱（掩码存储的是脱敏值，但库内是原值），按敏感数据保管，禁止进 Git。

## 6. 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 启动即退出，日志「JWT_SECRET 太短」 | 密钥不足 32 字节 | 换 `openssl rand -base64 48` |
| 全部接口 401 | 端侧令牌过期且刷新失败 | 查 `refresh_tokens` 是否被撤销；确认 `JWT_SECRET` 未在发布间改变 |
| 微信回调 400 / 验签失败 | 未保留 raw body，或 APIv3 Key 不是 32 字节 | 确认回调路由在独立作用域内注册；核对 key 长度 |
| 支付宝通知一直重试 | 返回体不是纯文本 `success` | 检查适配器返回值与 Nginx 是否改写响应 |
| 迁移失败 | SQL 非幂等、或并发两个实例同时迁移 | 迁移只用 `if not exists`；发布串行，勿并行触发 |
| 端口被占用 | 旧进程未退 | `systemctl status mixmapp-api`；必要时 `systemctl restart` |
| 发布后 502 | 服务未起来 / 端口不匹配 | 看 `journalctl -u mixmapp-api -n 100`；核对 `PORT` 与 Nginx upstream |
| CI 安装依赖失败 | 锁文件与 `package.json` 不一致 | 本地 `pnpm install` 后提交 `pnpm-lock.yaml` |
| Android release 包被 Play 拒 | 未签名或用 debug 签名 | 配 `ANDROID_KEYSTORE_*` secrets，确认 `hasReleaseSigning` 生效 |

## 7. 扩容与多实例

单实例够用时不必扩容。要上多实例，先解决三件事：

1. **发号机器号**：每个实例 `SNOWFLAKE_WORKER_ID` 必须不同（0..1023），否则撞号。
2. **限流**：当前是进程内固定窗口，多实例会放大额度；换 Redis 计数或网关限流。
3. **刷新令牌与会话**：已存 PostgreSQL，天然共享；内存模式多实例不可用。

## 8. 已知边界（事实陈述，未验证项）

| 项 | 现状 | 要补齐的条件 |
|---|---|---|
| iOS 打包 | 未验证 | macOS + Xcode + 证书/描述文件；本地为 Windows，无法出包 |
| Android release 签名 | 未验证 | keystore 及四个 secrets；当前只验证了 debug APK |
| 鸿蒙上架包 | 未验证 | HBuilderX / DevEco Studio 账号与签名 |
| 微信小程序发布 | 未验证 | 小程序 AppID、开发者工具上传、审核 |
| 线上部署 | 未执行 | Cloudflare / SSH 凭据、服务器与域名 |
| 支付宝/微信真实收款 | 未验证 | 商户号、证书、回调域名备案 |
| 高德/极光/FCM/OSS 真实调用 | 未验证 | 各家密钥与配额 |
| 短信真实下发 | 未验证 | 阿里云短信签名与模板审核 |

以上都已在代码层留好接入点，缺的是**凭据与外网环境**，不是代码。
