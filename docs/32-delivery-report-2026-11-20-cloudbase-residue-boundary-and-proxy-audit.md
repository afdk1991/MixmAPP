# 32 · 交付报告：CloudBase 桶根残留归属边界、proxy 函数本体盘点与凭据键对齐

- 日期：2026-11-20
- 范围：`.env.example`、`docs/archive/mim/`、`scripts/repo-lint-exemptions.json`、CloudBase 静态托管桶根、`mixmapp-api-proxy` 云函数
- 线上环境：腾讯云 CVM `115.159.159.11`，壳 `https://cloud.mixm.top/`，API `https://api.mixm.top/mixmapp/api/v1`，媒体 `https://img.mixm.top`
- 状态：**代码 / 文档侧已闭环并推送**；桶根与函数本体属外部云资源删除项，盘点出归属与依赖依据后保留待拍板，未擅自删除

## 1. 结论先说

| 类别 | 状态 | 证据 |
| --- | --- | --- |
| `.env.example` 凭据键对齐 | 已闭环 | 与 `services/api/src/config.ts` 实际读取的 env 全量 diff，missing 为空；补齐 OAuth / CloudBase PG / 存储签名 / 会话 TTL / 商城策略等键，删除无效占位 `S3_ENDPOINT_PLACEHOLDER` |
| docs 22 撞号 | 已闭环（本仓库侧） | 三篇 Mim 审计快照 `git mv` 到 `docs/archive/mim/`，脱离顶层编号序列；豁免清单 `docNumberCollisions` 清空为 `[]`；`pnpm lint` 通过，无撞号警告、无豁免提示 |
| 共享静态桶根归属边界 | 已盘点，**建议保留不动** | 三个在线子域与默认托管域共用桶根，根路径实测返回同一 MixmAPP 旧壳；批量删根级文件 / assets 有误伤他项目风险 |
| `mixmapp-api-proxy` 函数本体 | **已删除闭环**（函数 + 网关路由 + 仓库源码与清单登记） | 拍板后删除线上函数 `lam-al3uwrhf` 与 `/mixmapp` 路由；复核环境仅剩他项目 3 个函数；本地源码目录与版本纳管 / 域名校验 / 域名表条目一并移除 |
| 本地门禁 | 全绿 | `pnpm lint` 通过；改动不触 TS / 测试，基线 169 passed / 8 skipped、typecheck 全包 Done |

## 2. 凭据键对齐（`.env.example`）

通读 `services/api/src/config.ts`，所有第三方凭据均走环境变量读取，缺省时 provider 回退 dev / console / local，OAuth 渠道缺凭证则 `enabled=false`、登录页不渲染。对照发现 `.env.example` 漏列了部分 config 实际读取的 env，本轮补齐：

- 微信公众号 / 小程序 / 移动应用：`OAUTH_WECHAT_MP_APP_ID/SECRET`、`OAUTH_WECHAT_MINI_APP_ID/SECRET`、`OAUTH_WECHAT_MOBILE_APP_ID/SECRET`
- 华为 / 飞书：`OAUTH_HUAWEI_CLIENT_ID/SECRET`、`OAUTH_FEISHU_APP_ID/SECRET`
- CloudBase PG 网关：`CLOUDBASE_PG_GATEWAY/API_KEY/SCHEMA`
- 其他：`STORAGE_SIGN_SECRET`、`ADMIN_SESSION_TTL_SEC`、`MALL_CATALOG_SOURCE/MALL_CATALOG_FILE/MALL_DEMO_MODE/MALL_SOURCE_STOCK_GATE/ORDER_TTL_MINUTES`、`DATABASE_URL_SERVER` 别名
- 删除无效占位 `S3_ENDPOINT_PLACEHOLDER`

> 真实凭据仍待提供，未凭空填写；代码侧骨架完整，接入只需在服务器 env / CloudBase 环境变量落值。

## 3. docs 22 撞号归档（本仓库侧闭环）

三篇 `22-*` 文件实为 Mim 项目（`F:\合并项目\Mim`）只读审计快照，误落在 MixmAPP `docs/` 顶层并被本仓库 git 跟踪；Mim/docs 下无副本。lint 的编号唯一性检查只 `readdirSync(DOCS)` 顶层、非递归扫子目录，因此移入子目录即脱离撞号序列：

- `docs/archive/mim/22-audit-mim-community-mall-paid-2026-11-14.md`
- `docs/archive/mim/22-audit-mim-tools-appearance-content-security-2026-11-14.md`
- `docs/archive/mim/22-tools-test-raw-2026-11-14.txt`

`scripts/repo-lint-exemptions.json` 的 `docNumberCollisions` 清空为 `[]`。原 31 号报告中「豁免 `reviewBy=2026-11-21` 到期、需 Mim 线改号」的前提在本仓库已不再成立：文件已移出顶层编号，lint 不再依赖豁免。Mim 项目自身 docs 若存在同号问题，由 Mim 线自行处理，商城线不代改。

## 4. 共享静态桶根残留归属边界（盘点结论：保留不动）

### 4.1 路由与共用关系

CloudBase 静态托管共 6 个入口，按 PathRewrite 前缀分两类：

| 入口 | Prefix | 归属 |
| --- | --- | --- |
| `priceprobe-web-*.webapps.tcloudbase.com` | `/priceprobe-web` | 他项目独立子目录 |
| `pp-worker-*.webapps.tcloudbase.com` | `/pp-worker` | 他项目独立子目录 |
| `youxuan-h5-*.webapps.tcloudbase.com` | `/` | **共用桶根** |
| `youxuan-*.webapps.tcloudbase.com` | `/` | **共用桶根** |
| `appsp-*.webapps.tcloudbase.com` | `/` | **共用桶根** |
| 默认托管域 `*.tcloudbaseapp.com` | `/`（无 Rewrite） | **共用桶根** |

### 4.2 实测归属

- 四个共用桶根的入口，根路径实测返回**同一页面**：HTTP 200、len=367963、`<title>MixmAPP</title>`，正文命中 MIXM / Mixm / mixm / `cloud.mix.top`（旧失效域）。即三个他项目在线子域当前根响应，实际就是这个 MixmAPP 历史旧壳，自身并无独立根 index。
- 根 `index.html` 为内联打包：解析 `src/href` 外部引用，`assets/`、`.apk`、`privacy`、`404` 命中 **0 条**。
- 桶根散落：`index.html`(372653B, 11-13 14:19)、`404.html`(469133B, 11-13 13:54)、`privacy.html`(11738B, 10-23)、`download/app.apk`(22257B, 10-10)、`assets/` 多版本 hash js/css（10-06 ~ 11-12）。
- 他项目独立子目录：`__auth/`、`cloud-admin/`、`pp-worker/`、`priceprobe-web/`，与桶根文件不混。

### 4.3 处置口径

- **本轮不删除桶根任何文件。** 根 `index.html` 同时是三个在线子域 `/` 的当前唯一根响应，删除会让它们根路径 404；`404.html` 被 websiteConfig 错误文档引用。
- 根 `assets/` 多版本 hash、`download/app.apk`、`privacy.html` 当前根壳不引用，倾向历史残留，但缺少他项目子页是否引用的证据，不擅删。
- 若后续要清理：先逐子域爬取页面收集真实引用清单，只删无任何引用的 hash 资源；`index.html` / `404.html` 在三在线子域仍兜底期间保留。外部入口下线已由「独立应用删除 + 代理路由禁用」完成，桶根残留不对外形成 MixmAPP 新入口（生产壳在 `cloud.mixm.top`）。

## 5. `mixmapp-api-proxy` 函数本体盘点与删除闭环

### 5.1 函数现状

| 项 | 值 |
| --- | --- |
| FunctionId / 资源 | `lam-al3uwrhf` / `scf-sh-al3uwrhf` |
| 运行时 / 类型 | Nodejs18.15 / HTTP，256MB，超时 20s |
| 代码体积 | 1527B；`Environment.Variables=null`；`Triggers=[]`；`Layers=[]` |
| 创建 / 修改 | 2026-11-13 00:27:44，之后未再改动；状态 Active |
| 网关入口 | HTTPSERVICE 默认域 `/mixmapp` → 本函数，**Enable=false**（探测 423 Locked），`EnablePathTransmission=true` |

### 5.2 代码职责与依赖

- 函数是 CloudBase 过渡桥：把 `/mixmapp/*` 反代到 CVM `115.159.159.11` 的 `api.mixm.top`（https 443 / http 80 双上游，失败回退 502）。
- 生产 H5 直连 `api.mixm.top`，不走此桥；路由禁用后无在线入口。
- 无定时触发器、无层绑定、无环境变量；环境日志服务未开通，历史调用记录不可查（未为此开通 CLS）。
- 仓库源码保留在 `cloudbase/functions/mixmapp-api-proxy/`（`index.js` / `package.json` / `scf_bootstrap`），如需回滚可重新部署，不依赖云端函数本体留存。
- 本地仓库引用均为非运行时：`scripts/version.mjs` 将其 `package.json` 纳入版本号纳管；`scripts/domains.mjs` 将源码纳入域名一致性校验；`deploy/domains.json` 为文档化记录。无部署链路或其他代码调用本函数。
- 环境内其余 3 个函数 `mim-api`（Event，他项目保留）、`priceprobe-api`（他项目保留，历史 UpdateFailed）、`amap-proxy`（他项目保留），无函数间 invoke 证据。

### 5.3 删除执行与复核（2026-11-20 拍板后执行）

- 删除网关路由：HTTPSERVICE 默认域 `/mixmapp`（WEB_SCF → mixmapp-api-proxy）`deleteRoute` 成功；复核 listRoutes，HTTPSERVICE 仅剩 `amap-proxy`、`mim-api`、`priceprobe-api` 三条他项目路由。
- 删除函数本体：`deleteFunction mixmapp-api-proxy`（confirm=true）成功；异步 `Deleting` 后轮询 listFunctions，环境 `totalCount` 由 4 降为 3，仅剩 `mim-api`、`priceprobe-api`、`amap-proxy`（他项目保留），proxy 已彻底消失。
- 仓库侧同步清理：
  - `git rm` 删除 `cloudbase/functions/mixmapp-api-proxy/`（`index.js` / `package.json` / `scf_bootstrap`）；
  - `scripts/version.mjs` 移除该函数 `package.json` 的版本纳管条目；
  - `scripts/domains.mjs` 移除两条域名一致性校验清单条目；
  - `deploy/domains.json` 移除 landing 引用与域名表中该函数的 `reconfigured` 状态行。
- 复核：`domains.json` JSON 合法；`version.mjs` / `domains.mjs` `node --check` 通过；`pnpm lint` 通过；`version.mjs check` 版本一致性通过（0.0.2 / versionCode 3）。仓库内运行与配置侧已无 `mixmapp-api-proxy` 引用，剩余仅 docs 历史交付快照（不改写）。
- 回滚边界：函数代码包体积 1527B、逻辑为单文件反代；云端函数本体删除不可逆，如需重建需按旧源码重新部署（历史源码见 git 历史与本节 5.2 职责描述）。

## 6. 剩余卡点（凭据 / 外部资源 / 待拍板）

凭据类与数据侧约束沿用 31 号报告第 6 节，本轮无变化：CloudBase 云 PG 连接串、微信 / 支付宝商户凭据、短信 / 一键登录 / 地图 / 推送 / AI / 云存储 / OAuth 凭据、商品原图包或高清图库授权；源站匿名无价格 / 库存 / 上下架；线上演示账号待清（删除不可逆，需确认口径）。

待拍板外部资源项：

| 项 | 现状 | 待决定 |
| --- | --- | --- |
| 共享静态桶根 | 建议保留不动；三在线子域共用兜底 | 是否只删明确无引用的根级 hash 资源（需先爬取收集引用清单） |
| ~~`mixmapp-api-proxy` 函数本体~~ | **已删除闭环**（2026-11-20）：线上函数、`/mixmapp` 路由、仓库源码与纳管条目均已清理 | 无（如需重建，按 5.3 回滚边界重新部署） |
| hznzcn 女装迁移线 | 并行会话在途，整目录 gitignore 隔离未入库 | 收口后再评估源码入库与生产导入范围 |

## 7. 提交与产物

- 提交 `8adde60` chore(docs/env): `.env.example` 对齐 config 全量凭据键，Mim 审计快照归档脱离编号序列，清空撞号豁免（5 files，+37/-15）。
- 提交 `e839426` chore(cloudbase): 删除 proxy 云函数与 `/mixmapp` 路由，移除仓库源码及版本纳管 / 域名校验 / 域名表条目（7 files，+15/-70）。
- 版本：工作号 0.0.2（release）；线上 version=0.0.2、db=ok；验收 16/16。
- 部署：本轮为 CloudBase 旧代理下线与仓库清理，不触发 CVM 重新发布；生产 API 直连 `api.mixm.top`，未受影响。
