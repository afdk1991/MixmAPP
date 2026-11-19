# 29 · 交付报告：外部托管下线收尾 + 版本回退根因修复

- 日期：2026-11-19
- 范围：`.github/workflows/deploy.yml`、`deploy/rollback.sh`、GitHub Pages / ghcr、CloudBase 静态应用与网关路由
- 线上环境：腾讯云 CVM `115.159.159.11`，壳 `https://cloud.mixm.top/`，API `https://api.mixm.top/mixmapp/api/v1`，媒体 `https://img.mixm.top`
- 状态：**纯代码 / 配置侧已上线并复核**；凭据依赖项按卡点登记，未凭空闭环

## 1. 结论先说

| 类别 | 状态 | 证据 |
| --- | --- | --- |
| 版本号被旧包覆盖 | 已修复并回到 0.0.2 | `/healthz` version=0.0.2、db=ok；`/meta` version=0.0.2、demoMode=true |
| 外部自动发布链路 | 已禁用 | 最近 run 仅 ci / deploy / Android；无 pages、无 image；Pages 站点 404 |
| GitHub 容器包 | MixmAPP 已删 | ghcr 仅剩他项目 `mim-api` |
| CloudBase 独立静态应用 | MixmAPP 已删 | listApps 5 个，无 MixmAPP |
| CloudBase 旧代理路由 | 已禁用 | `/mixmapp` Enable=false，探测 423 Locked |
| 本地门禁 | 全绿 | 169 passed / 8 skipped；typecheck 全包 Done；lint 通过；版本一致性 check 通过 |
| 线上验收 | 16/16 通过 | 2 项演示沙箱口径 SKIP（幂等键、库存扣减） |

## 2. 本轮发现并修复的真实缺陷：旧包部署把线上版本号覆盖回退

### 根因

- `deploy.yml` 原先同时由 `push: branches main` 和 `push: tags v*` 触发。打 tag `v0.0.1`（指向旧提交 `7528029`）时，流水线用旧提交的包（包内 `version.json` = 0.0.1）重新部署，把线上版本从 0.0.2 覆盖回 0.0.1。
- 进程版本号只从环境变量 `APP_VERSION` 读取（`services/api/src/config.ts`：`version: str('APP_VERSION', '0.0.2')`）。`rollback.sh` 只切 symlink 并重启，不同步 env，代码切回旧版后 env 仍是另一版本号，二者脱节。
- 实测：重复 deploy 完成后线上 `version=0.0.1`、`uptime` 重置；`/etc/mixmapp/api.env` 里 `APP_VERSION=0.0.1`。

### 改动（提交 `6b646e7`）

1. `deploy.yml`：移除 `tags: ['v*']` 触发。tag 是不可变历史快照，不再触发生产部署；保留 `branches main` 与 `workflow_dispatch`。
2. `deploy/rollback.sh`：回滚切到历史 release 后，解析目标包 `version.json`（口径与 `atomic-release.sh` 一致：release 取 `version`，其余渠道追加后缀），把 `APP_VERSION` 同步写回 env，避免代码与版本号脱节。
3. 线上即时纠正：备份 `api.env` 后将 `APP_VERSION` 改为 0.0.2 并重启；复核 healthz / meta 均为 0.0.2。回滚脚本已同步到服务器 `/opt/mixmapp/deploy/rollback.sh`，`bash -n` 通过。

### 改回去

- 若需恢复 tag 触发部署，取消 `deploy.yml` 中 tags 段注释即可；回滚脚本的版本同步逻辑不影响旧行为。

## 3. 外部平台旧产物清理（除腾讯云服务器外暂停）

### GitHub 侧

- **Pages**：站点 `https://afdk1991.github.io/MixmAPP/` 实测 404；仓库 Pages 配置查询返回 Not Found。`pages.yml` 的 `push` 触发段整段注释，仅留 `workflow_dispatch` 手动入口。
- **ghcr**：MixmAPP 容器包已删除；当前容器包列表仅剩他项目 `mim-api`（保留）。`image.yml` 的 `push` 触发段整段注释，仅留手动入口。
- **Actions 现状**：最近流水线只有 `ci`、`deploy`（腾讯云 SSH 原子发布）、`android`（产物留存为 Actions artifact，90 天过期，不上架外部商店）；无新 Pages / Image run。`ops-nightly` 为 SSH 到腾讯云的健康巡检与库备份，不向外部平台发布产物。

### CloudBase 侧（环境 `cs-1-d5g815slocb5a611a`，ap-shanghai）

- **独立静态应用 `MixmAPP`**：已 `deleteApp`；listApps 现剩 `priceprobe-web`、`pp-worker`、`youxuan-h5`、`youxuan`、`appsp`（均他项目，保留）。
- **旧过渡代理路由 `/mixmapp`**：上游云函数 `mixmapp-api-proxy`，已 `disableRoute`（Enable=false）；`disabledAccessUrls` 含该路径，带 cache-buster 探测返回 423。当前生产 H5 直连 `api.mixm.top`，不走此代理。
- **云函数本体 `mixmapp-api-proxy`**：保留未删（代码已入库 `cloudbase/functions/mixmapp-api-proxy/`，留作回滚；删除不可逆）。

### 未删：共享静态托管桶根目录残留（误伤边界，登记卡点）

- 桶内 `index.html`（title=MixmAPP，旧 API base `cloud.mix.top`）、`404.html`、`privacy.html`、`download/app.apk` 与 `assets/` 85 个多版本 hash 文件为历史各次部署残留；根 html 为内联打包，不引用 `assets/`。
- 判定：`youxuan-h5`、`youxuan`、`appsp` 三个在线独立子域的 `PathRewrite.Prefix = "/"`，共用桶根目录。在此混杂归属下批量删根级文件 / assets 有误伤他项目风险，本轮未执行删除。
- 入口侧下线已由「独立应用删除 + 代理路由禁用」完成；桶内残留文件不对外形成 MixmAPP 入口。

## 4. 门禁与验收记录

- `node scripts/version.mjs check`：通过，构建 0.0.2（versionCode 3）/ 展示 0.0.2（release）。
- `pnpm lint`：通过（docs 22 两篇撞号为 Mim 并行会话豁免项，复核至 2026-11-21）。
- `pnpm typecheck`：contracts / ids / api / app 全包 Done。
- `pnpm test`：169 passed / 8 skipped（177 用例）。
- 线上验收 `scripts/acceptance.mjs https://cloud.mixm.top/mixmapp`：**16/16 通过**；并发重名 201=1 / 409=7；商品列表 count=20；演示单 `DEMO-` 前缀不落库；管理面落点 server / 127.0.0.1:5432；限流第 39 次触发；幂等键与库存扣减两项按 demoMode 口径 SKIP。

## 5. 仍挂起（必须外部凭据 / 客观数据源约束，本地无法闭环）

| 项 | 卡点 | 需要什么 |
| --- | --- | --- |
| CloudBase 云 PG 权威库 | `DATABASE_URL_CLOUDBASE` 为空；当前落自建 PG（备援，`dbTarget=server`、source=DATABASE_URL_LOCAL） | 云 PG 连接串；接入后 `/admin/db` 可热切换 |
| 微信 / 支付宝真实回调 | `wechatPay=off`、`alipay=off`；适配器为骨架，验签 / 金额比对 / 重复回调幂等未接 | 商户号、APIv3 密钥、证书序列号、支付宝 appId / 私钥 / 公钥 |
| 三方服务 | sms=console、onekey/map/push/ai=dev、storage=local、OAuth 全 off | 短信 / 一键登录 / 地图 / 推送 / AI / 云存储真实提供者与凭据；OAuth 凭据 |
| 商品价格 / 库存 / 上下架 | 源站匿名视图无价格、库存、在售状态（`price_fen=0`、`stock=0`、`stock_source=unknown`）；抓取受公开分页上限约束，非全量；仍有无图商品与变体 404 | 商品原图包或高清图库授权；AI 生成额度；源站可鉴权通路 |
| 小程序 AppID | 为空 | 小程序注册与 AppID 配置 |
| Android 发布 | 仅 debug APK 留存；release AAB / 应用商店上架未接 | 签名 Secrets、上架渠道 |
| Gitee 镜像 | 未接 | 如需镜像再配置 |
| 线上测试数据 | 验收产生的演示账号 / 演示单待清 | 定期清理窗口 |
| 工作树在途改动 | `infra/nginx/img.mixm.top.conf`、`scripts/package-installer.mjs` 及若干未跟踪 tools/scripts 为并行会话产物，本轮未纳入提交 | 并行会话收口后再统一提交 |

## 6. 提交与产物

- 提交：`6b646e7` fix(deploy): 停止 tag push 触发生产部署，回滚时同步版本号写回 env（2 files, +18/-1）。
- 版本：工作号 0.0.2（release）；已发布登记 `released=["0.0.1"]`；tag `v0.0.1` 指向 `7528029`。
- 部署：deploy `44561795570` success；ci `44561795569` success。
