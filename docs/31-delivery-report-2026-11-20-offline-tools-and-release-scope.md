# 31 · 交付报告：图片跨域与打包修复上线、离线工具入库、发布口径收敛

- 日期：2026-11-20
- 范围：`infra/nginx/img.mixm.top.conf`、`scripts/package-installer.mjs`、离线目录/图片工具、`.gitignore`
- 线上环境：腾讯云 CVM `115.159.159.11`，壳 `https://cloud.mixm.top/`，API `https://api.mixm.top/mixmapp/api/v1`，媒体 `https://img.mixm.top`
- 状态：**代码 / 配置侧已上线并复核**；凭据依赖项按卡点登记，未凭空闭环；小程序端与 Android 应用商店上架明确不纳入本期

## 1. 结论先说

| 类别 | 状态 | 证据 |
| --- | --- | --- |
| 图片域跨域读取 | 已上线生效 | `https://img.mixm.top/media/products/<sha1>.jpg` 返回 200，`Access-Control-Allow-Origin: *`、`Allow-Methods: GET, HEAD, OPTIONS`；OPTIONS 预检 204 |
| Windows 安装包打包崩溃 | 已修复 | `package-installer.mjs` 改相对路径 deploy、以 deploy 产物为根打包、目录复制走 `cp -r`、tar `--force-local`；`node --check` 通过 |
| 离线目录 / 图片工具 | 已入库 | `reimage-offline.mjs`、`fill-series-images.mjs`、`catalog-merge/merge.mjs` |
| 并行迁移线与产物 | 已隔离出 main | `.gitignore` 忽略 `tools/hznzcn-importer/` 整目录与 egluosi source 备份 `.bak`；cookie jar / 图片 / 游标产物不入库 |
| 本地门禁 | 全绿 | 169 passed / 8 skipped；typecheck 全包 Done；lint 通过 |
| 线上验收 | 16/16 通过 | 2 项演示沙箱口径 SKIP（幂等键、库存扣减） |
| ci / deploy | success | 提交 `42d4791` 两条 run 均 completed success |

## 2. 本轮纳入主分支的修复

### 2.1 图片域公开跨域放行（`infra/nginx/img.mixm.top.conf`）

- `/media/` 增加 CORS：`Access-Control-Allow-Origin "*"`、`Access-Control-Allow-Methods "GET, HEAD, OPTIONS"`，头均 `always` 下发；`OPTIONS` 预检直接返回 204，避免落到静态文件的 405。
- 口径：公开图片、无凭据，不设 `Allow-Credentials`；长缓存 `immutable` 与 `nosniff` 保持不变。
- 线上实测（真实商品图）：

```
HTTP/1.1 200 OK
Content-Type: image/jpeg
Cache-Control: public, max-age=2592000, immutable
X-Content-Type-Options: nosniff
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
OPTIONS 预检 → 204
```

- 说明：nginx 配置由初始化/手工落位到 `/etc/nginx/sites-available/img.mixm.top.conf`，`atomic-release.sh` 不负责同步 nginx conf 与 reload；线上配置已与仓库新版一致并生效。

### 2.2 安装包 Windows 打包崩溃修复（`scripts/package-installer.mjs`）

- `pnpm deploy --prod` 改用相对 repo 根路径，避免 pnpm 9 在 Windows 把绝对路径拼进 workspace 子包目录。
- 以 `deployDir` 作为发布根组装，**不再** `fs.cpSync(deployDir/node_modules)`：pnpm deploy 产出的 `node_modules` 含大量符号链接，Windows 上 recursive 复制跟随链接会让 Node 原生崩溃（无 JS 异常、exit 127）。
- 目录复制统一走 shell `cp -r`（本环境 Node 22 的 `fs.cpSync(recursive)` 连普通目录也会原生崩溃）；文件复制仍用 `fs.copyFileSync`。
- tar 加 `--force-local`，避免 GNU tar 在 Windows 把 `F:\...` 绝对路径当「远程主机:路径」去调 rsh。

## 3. 入库的离线工具与隔离的并行产物

### 3.1 入库源码（无生产直连、无机密）

| 文件 | 用途 | 安全口径 |
| --- | --- | --- |
| `scripts/catalog/reimage-offline.mjs` | 无库环境把 80×80 `_s` 缩略图离线升级为 `_l` 高清 | 只改 `images[].remote/staged`；先下载校验非占位再改 catalog；`--dry-run` 可复核；可重复执行 |
| `scripts/catalog/fill-series-images.mjs` | 用同品牌同品类系列真图填充 staged 空位 | 已有真图字节不动；不删任何引用；cover 位只用系列 cover 真图；原文件备份 `.pre-fillseries.bak` |
| `tools/catalog-merge/merge.mjs` | 多来源目录合并与校验 | `sourceKey` / `categoryCode` 前缀去重；按 sourceKey 幂等覆盖式更新；只合并校验，不抓取、不下载图片、不改库 |

### 3.2 隔离出 main（`.gitignore`）

- `tools/hznzcn-importer/` 整目录：hznzcn 女装全站生产库增量导入线，含 SSH 隧道直连生产 PG 的导入器、WAF cookie jar、图片 / 游标 / 状态产物、抓取日志。属并行数据迁移线（14.5 万商品、跨天累积），收口前不纳入 main；后续逐文件评估哪些源码可入库。
- `tools/egluosi-importer/source/*.bak`：离线修复脚本落的原文件备份，可重跑重建，不入库。
- 现有 `.gitignore` 已覆盖 `cookies.txt` / `*.token` / `*.log` / `storage/` / `release/` / `source/catalog.json` / `source/images/` 等，本轮未重复添加。

## 4. 发布口径收敛：小程序端、Android 上架不纳入本期

按本轮决定，以下两项**不再作为待凭据 / 待渠道闭环项**：

| 项 | 处置 | 现状保留 |
| --- | --- | --- |
| 微信小程序 AppID | 不纳入本期；`mp-weixin.appid` 留空占位，不再等待小程序凭据 | uni-app 多端骨架与 `mp-weixin` 构建命令保留；首页端矩阵该端维持 `planned` 规划占位 |
| Android 应用商店上架 | 不走上架渠道；不配置 release 签名与商店发布 | `android.yml` 默认只出 debug APK（内部验证 artifact，90 天过期）；release AAB 段在无签名 Secrets 时不触发；无任何商店上传步骤 |

> 若后续重新启用小程序或 Android 上架，再回补 AppID / 签名 Secrets 与对应发布流程；当前不为此预留待办。

## 5. 门禁与验收记录

- `node --check`：`package-installer.mjs`、`reimage-offline.mjs`、`fill-series-images.mjs`、`catalog-merge/merge.mjs` 全部通过。
- `pnpm lint`：通过（docs 22 两篇撞号为 Mim 并行会话豁免项，`reviewBy=2026-11-21`，到期需由 Mim 线改号；商城线不代改）。
- `pnpm typecheck`：contracts / ids / api / app 全包 Done。
- `pnpm test`：169 passed / 8 skipped（177 用例）。
- 线上验收 `scripts/acceptance.mjs https://cloud.mixm.top/mixmapp`：**16/16 通过**；`/healthz` version=0.0.2、db=ok、catalogSync=success。

## 6. 剩余卡点（凭据 / 外部资源 / 待拍板，本地无法闭环）

| 项 | 卡点 | 需要什么 |
| --- | --- | --- |
| CloudBase 云 PG 权威库 | `DATABASE_URL_CLOUDBASE` 为空；当前落自建 PG（`dbTarget=server`、source=DATABASE_URL_LOCAL） | 云 PG 连接串；接入后 `/admin/db` 可热切换 |
| 微信 / 支付宝真实回调 | `wechatPay=off`、`alipay=off`；适配器为骨架，验签 / 金额比对 / 重复回调幂等未接 | 商户号、APIv3 密钥、证书序列号、支付宝 appId / 私钥 / 公钥 |
| 三方服务 | sms=console、onekey/map/push/ai=dev、storage=local、OAuth 全 off | 短信 / 一键登录 / 地图 / 推送 / AI / 云存储真实提供者与凭据；OAuth 凭据 |
| 商品价格 / 库存 / 上下架 / 原图 | 源站匿名视图无价格、库存、在售状态（`price_fen=0`、`stock=0`、`stock_source=unknown`）；抓取受公开分页上限约束，非全量；仍有无图商品与变体 404 | 商品原图包或高清图库授权；AI 生成额度；源站可鉴权通路 |
| 线上测试数据 | 验收产生的演示账号待清；演示单在 demoMode 不落库 | 定期清理窗口（删除用户不可逆，需确认口径） |
| 共享静态桶根残留 | `youxuan-h5` / `youxuan` / `appsp` 共用桶根，归属混杂，批量删除有误伤他项目风险 | 拍板：只删明确归属 MixmAPP 的根级文件，或保留桶根不动 |
| `mixmapp-api-proxy` 函数本体 | 当前仅路由禁用、函数保留作回滚 | 拍板是否删除 CloudBase 函数本体（删除不可逆） |
| hznzcn 迁移线 | 并行会话在途，源码与产物均未入库 | 并行会话收口后再评估入库与生产导入范围 |
| docs 22 撞号豁免 | `reviewBy=2026-11-21` 到期；属 Mim 并行会话产物 | Mim 线自行改号；到期未改 lint 会失败 |

## 7. 提交与产物

- 提交 `78caca7` fix(media/pkg): 图片域公开跨域放行 + installer Windows 打包崩溃修复（2 files, +33/-12）。
- 提交 `42d4791` chore(tools): 入库离线图片回填 / 系列填充 / 多源目录合并工具，gitignore 隔离 hznzcn 迁移线（4 files）。
- 版本：工作号 0.0.2（release）；已发布登记 `released=["0.0.1"]`；tag `v0.0.1` 指向 `7528029`。
- 部署：ci / deploy `42d4791` success；线上 version=0.0.2、db=ok；验收 16/16。
