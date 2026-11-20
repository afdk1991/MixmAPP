# 33 · 交付报告：桶根逐子域引用清单、凭据接入点复核、hznzcn 并行线盘点与演示账号清理

- 日期：2026-11-20
- 范围：CloudBase 共享静态托管桶根、`services/api/src/config.ts` 凭据接入点、`tools/hznzcn-importer/` 并行迁移线、线上库演示 / 测试账号
- 线上环境：腾讯云 CVM `115.159.159.11`，壳 `https://cloud.mixm.top/`，API `https://api.mixm.top/mixmapp/api/v1`，媒体 `https://img.mixm.top`
- 状态：**凭据复核、hznzcn 盘点、演示账号清理已闭环**；桶根候选资源仍为外部云资源，引用清单已出，删除留待拍板

## 1. 结论先说

| 类别 | 状态 | 证据 |
| --- | --- | --- |
| 桶根逐子域引用清单 | 已爬取落档 | 四个共用桶根入口根路径返回同一内联壳；壳内根级 `assets/`、`static/`、`download/`、`privacy`、`404`、`apk`、`splash`、`manifest` 实际资源引用 0；候选残留已分层 |
| 凭据接入点复核 | 已闭环（代码 / 安全态） | 线上 `/meta` 第三方快照全部处于安全回退；服务器 env 26 个第三方键位全部空值，无占位、无真实密钥；代码扫描无硬编码密钥；真实凭证边界如实标注 |
| hznzcn 女装迁移线 | 已盘点，整目录隔离未入库 | `.gitignore:43` 整目录忽略；本地为导入器脚本 / 日志 / 原图包；本轮不执行生产导入，收口后逐文件评估入库 |
| 演示 / 测试账号清理 | **已执行闭环** | 清理前 44 用户；备份后级联删除 43 个验收 / 测试账号与 3 条测试短信码；保留 `mixowner`；复核关联表残留为 0（除 owner 自身会话 1 条） |
| 线上健康 | 正常 | `healthz status=ok`；`demoMode=on`、`storage=local`、支付 `off/off` |

## 2. 桶根逐子域引用清单（#29）

### 2.1 入口与共用关系

CloudBase 静态托管 6 个入口，按 Prefix Rewrite 分两类（沿用 32 号报告 4.1 路由表）：

- **共用桶根（Prefix `/` 或无 Rewrite）**：默认托管域 `*.tcloudbaseapp.com`、`youxuan-h5-*`、`youxuan-*`、`appsp-*` 三个 webapps 子域。
- **他项目独立子目录（Prefix 回源子目录，不动）**：`priceprobe-web/`、`pp-worker/`、`__auth/`、`cloud-admin/`、`youxuan-h5-v6test2/`。

### 2.2 爬取与解析证据

- 四个共用桶根入口根路径实测均为 HTTP 200、len=367963、`<title>MixmAPP</title>`，返回同一旧壳。
- 默认域根壳落临时文件做内联扫描：`import(`=0；无任何 `.js` 文件名 token；module body 265179 字符全部内联；favicon 为内联 base64 `<link rel=icon>`；`data:image` 仅 2 处。
- 根级路径关键词命中：`assets/`=0、`download/`=0、`privacy`=0、`404.html`=0、`app.apk`=0、`favicon`=0、`splash`=0、`manifest`=0；`static/` 命中 1 处，经上下文核对为 JS 路径前缀判断逻辑字符串（`./static/` / `assets/` 前缀判断），**不是实际资源引用**。
- 壳内 `logo` 出现 60 处但无外部 `src`/`href`；`/mixmapp`=2、`cloud.mix.top`=2，位于 API base 常量 `https://cloud.mix.top/mixmapp/api/v1`（旧失效域残留配置，非静态资源引用）。
- 他项目子目录页面（`priceprobe-web/index.html`、`cloud-admin/index.html`、`__auth/` 各页、`youxuan-h5-v6test2/index.html` 等）根级 `src`/`href` 外部引用均为 0；`v6test2/assets/index-DfEGOWOE.js` 命中的 `assets/`、`static/` 经上下文核对为 `new URL(..., document...)` 相对自身子目录与路径判断逻辑，不指向桶根 `/assets/`、`/static/`。
- `websiteConfig`：`IndexDocument=index.html`、`ErrorDocument=404.html`，这两个根文件被托管配置直接引用。

### 2.3 桶根 112 文件分层

| 分层 | 文件 / 前缀 | 数量与大小 | 处置口径 |
| --- | --- | --- | --- |
| 配置 / 兜底（强引用，保留） | `index.html`、`404.html` | `index.html` 372653B（11-13 14:19）；`404.html` 469133B（11-13 13:54） | websiteConfig 索引页 / 错误页，三在线子域兜底期间保留 |
| 当前在线页面无引用候选（待拍板） | `assets/` hash js/css | 前缀条目 85（含 1 个目录占位），文件 84，10-06 ~ 11-12 多版本 | 壳不加载外部 chunk；倾向历史残留 |
| 当前在线页面无引用候选（待拍板） | `static/` 图片 | 前缀条目 6（含 1 个目录占位），文件 5：`favicon.png`(2996)、`logo-192.png`(11570)、`logo-48.png`(2307)、`logo.png`(92660)、`splash.png`(42142) | 壳 favicon / logo 走内联，无根级引用 |
| 当前在线页面无引用候选（待拍板） | `download/app.apk` | 22257B（10-10） | 壳无 APK 下载引用；内部 debug 验证包 |
| 当前在线页面无引用候选（待拍板） | `privacy.html` | 11738B（10-23） | 壳与子目录无隐私协议链接引用；页面仅外部 GitHub issue 链接 |
| 他项目独立目录（不动） | `__auth/`、`cloud-admin/`、`pp-worker/`、`priceprobe-web/`、`youxuan-h5-v6test2/` | 见 2.1 | 归属他项目，不在 MixmAPP 清理范围 |

### 2.4 风险与边界

- 服务端取证范围内，上述候选资源无任何在线页面 / 脚本引用；但**历史外链、旧版本浏览器 / APK 缓存命中风险无法从服务端排除**。
- 删除属不可逆外部写操作；本轮不删任何桶根文件。后续若清理，只删明确无引用的 hash 资源与图片，`index.html` / `404.html` 在三在线子域仍兜底期间保留；执行前应再按子域复核一次引用清单。

## 3. 凭据接入点复核（#30）

### 3.1 代码侧接入点现状

通读 `services/api/src/config.ts`：所有第三方凭据均走环境变量读取，缺省时 provider 回退 `dev` / `console` / `local`；OAuth 渠道缺 `clientId`+`clientSecret` 则 `enabled=false`，登录页不渲染；支付宝渠道缺公钥额外判为未配置，避免不安全信任响应；生产 `JWT_SECRET` 未设置会启动抛错。

### 3.2 线上第三方能力快照（`/meta`，匿名可读）

| 能力 | 线上状态 | 说明 |
| --- | --- | --- |
| 短信 `sms` | `console` | 控制台回显，不发送真实短信 |
| OAuth 渠道 | 17 个全 `off` | wechat / wechat_mp / wechat_mini / wechat_app / huawei / feishu / qq / weibo / alipay / douyin / dingtalk / wecom / apple / google / facebook / github / gitee；`mock` 生产 `off` |
| 一键登录 `onekey` | `dev` | 未接本机号码认证网关 |
| 微信支付 / 支付宝 | `off` / `off` | 无商户号 / appId，支付链路未启用 |
| 地图 `map` | `dev` | 未接高德 key |
| 存储 `storage` | `local` | 本地磁盘 `/var/lib/mixmapp/storage`，未接 S3 / 云存储 |
| 推送 `push` | `dev` | 未接极光 / FCM |
| AI `ai` | `dev` | 未接大模型 API |
| 演示沙箱 `demoMode` | `on` | 下单只做流程校验与预览，不写真实订单、不扣库存、不调支付 |

### 3.3 服务器 env 键位空值审计（只看存在性与长度，不回显值）

对 26 个第三方键位逐项输出长度与占位判定，结果**全部 `empty`（len=0）**，无占位残留、无真实密钥：

- 微信支付：`PAY_WECHAT_APP_ID / MCH_ID / SERIAL_NO / PRIVATE_KEY / API_V3_KEY / PLATFORM_PUBLIC_KEY`
- 支付宝：`PAY_ALIPAY_APP_ID / PRIVATE_KEY / PUBLIC_KEY`
- OAuth：`OAUTH_WECHAT_APP_ID / APP_SECRET`、`OAUTH_QQ_APP_ID / APP_KEY`、`OAUTH_GITHUB_CLIENT_ID / SECRET`、`OAUTH_APPLE_CLIENT_ID`
- 其他：`AMAP_KEY`、`AI_API_KEY`、`S3_ACCESS_KEY_ID / SECRET_ACCESS_KEY / BUCKET`、`JPUSH_APP_KEY / MASTER_SECRET`、`ONEKEY_APP_ID / APP_SECRET / ENDPOINT`、`DATABASE_URL_CLOUDBASE`

- 代码硬编码密钥扫描：无 `sk-*` / `AKID*` / 非空 accessKeySecret / 私钥块命中；docs 中命中的 `task-*` 为迁移任务 ID，非密钥。
- `JWT_SECRET`、`ADMIN_TOKEN` 已设置（服务 `active`，admin 健康检查可返回详情；未回显值）。

### 3.4 真实凭证边界（不可凭空生成）

以下凭证需在对应平台以主体资质申请 / 审核 / 签发，本地无法闭环，也不得编造占位：

- CloudBase 云 PG 连接串 / 网关 API Key（当前权威库为 CVM 自建 PG，CloudBase PG 仅作可选备援保留）
- 微信开放平台 / 公众号 / 小程序 / 移动应用 AppID+Secret；微信支付商户号、证书序列号、私钥、APIv3 密钥、平台公钥
- 支付宝应用 AppId、应用私钥、支付宝公钥
- 阿里云短信 AccessKey、签名、模板码；一键登录网关 AppID/Secret
- 高德 Key；极光 / FCM 推送凭证；大模型 API Key；S3 / 云存储 AccessKey 与桶配置；其余 OAuth 渠道凭证
- 商品原图包 / 高清图库授权、AI 生成额度

接入方式：凭证申请到位后，在服务器 `/etc/mixmapp/api.env`（600 root root）或 CloudBase 环境变量落值，切换对应 `*_PROVIDER` 开关即可；代码骨架与安全回退已就位。

## 4. hznzcn 女装迁移线盘点（#31）

- 隔离口径：`.gitignore:41-43` 注释说明并整目录忽略 `tools/hznzcn-importer/`（含生产库增量导入器、SSH 隧道直连逻辑、WAF cookie jar、图片 / 游标 / 状态产物）。
- 本地目录内容（未入库，`git status` 干净）：
  - 脚本 / 配置：`categories.mjs`、`crawl.mjs`、`orchestrate.mjs`、`prod-import.mjs`、`push-images.sh`、`resume.sh`、`test-parse.mjs`、`test-parse-full.mjs`、`README.md`
  - 运行日志：`enumerate.log`、`orchestrate.log`、`prod-import-run.log`
  - 产物：`source/` 原图包与 `.img-*` 缓存
- 本轮动作：**不执行生产导入，不把源码纳入 main**；收口后再逐文件评估哪些导入器脚本可入库、哪些数据 / 隧道 / cookie 产物继续隔离。
- 并行线提示：docs 22 撞号豁免已于 32 号报告在本仓库侧闭环（三篇快照移入 `docs/archive/mim/`，豁免清单清空为 `[]`），lint 不再依赖 2026-11-21 到期豁免；Mim 项目自身同号问题由 Mim 线处理，商城线不代改。

## 5. 演示 / 测试账号清理（#31）

### 5.1 清理前盘点（只读）

- 用户共 44：注册（guest=f）18、游客（guest=t）26。
- 订单 4 笔，**全部 `cancelled`**，归属 3 个 `acc_*` 验收账号与 1 个 `domain-switch-e2e` 游客；`payments=0`，无真实成交单。
- 关联表：`bindings` 26（全部 `guest` provider，归属游客验收账号）、`refresh_tokens` 110、`carts` 18、`orders` 4、`order_items` 4、`push_tokens` 0、`payments` 0；`sms_codes` 3 条（测试号段 `13800000000`×1、`19900000001`×2）。
- 外键关系：`bindings / refresh_tokens / push_tokens / payments / carts / orders` 均 `references users(id) on delete cascade`；`order_items` 级联 `orders`。删除用户自动级联清理关联数据。

### 5.2 清理口径

- **保留**：`mixowner`（id `114760430185873408`，种子 / 管理账号，0 绑定、0 购物车、0 订单）。
- **删除（43）**：
  - 注册 17：14 个 `acc_*` 验收账号、`uitest1115`（UI 测试）、`qa_footer_1116`（QA 页脚验收）、手机号 `13800000000` 测试号段账号；
  - 游客 26：`验收游客`、`存储验收`、`详情验收`、`domain-switch-e2e`、乱码昵称、默认 `MixmAPP用户0000` 等历史验收 / e2e 游客。
- 短信码：删除 `13800000000`、`19900000001` 两条测试号段共 3 条 `sms_codes`（该表无 `user_id`，不随用户级联）。

### 5.3 备份与执行

- 删除前全库 `pg_dump -Fc` 备份：`/var/lib/mixmapp/backups/pre-user-cleanup-20261120-204603.dump`（2528781B）；待删清单导出 `pre-user-cleanup-20261120-204603.users.csv`（COPY 43，含表头 44 行），与备份同目录，`chown mixmapp:mixmapp`。
- 事务内执行：`DELETE FROM users WHERE id <> '114760430185873408'`（级联）；`DELETE FROM sms_codes WHERE phone IN (...)`；复核计数后 `COMMIT`。

### 5.4 清理后复核

| 表 | 清理后行数 | 说明 |
| --- | --- | --- |
| `users` | 1 | 仅剩 `mixowner`（guest=f） |
| `bindings` | 0 | 验收第三方绑定级联清空 |
| `refresh_tokens` | 1 | 仅 `mixowner` 自身会话 |
| `push_tokens` | 0 | — |
| `carts` | 0 | — |
| `orders` / `order_items` | 0 / 0 | 4 笔 cancelled 测试单级联清空 |
| `payments` | 0 | — |
| `sms_codes` | 0 | 测试短信码清空 |

- 线上复核：`healthz status=ok`；`/meta` `demoMode=on`、`storage=local`、微信支付 / 支付宝 `off/off`，清理未影响生产服务。
- 回滚边界：如需恢复被删账号，用 5.3 的 `.dump` 在对应时间点前恢复；当前演示沙箱模式下新访客注册会重新落库，属正常业务行为。

## 6. 剩余卡点

| 项 | 现状 | 待决定 / 待提供 |
| --- | --- | --- |
| 桶根候选残留 | 引用清单已出（2.3），无在线引用；历史外链 / 缓存风险未排除 | 拍板是否只删明确无引用的 `assets/` hash、`static/` 5 图、`download/app.apk`、`privacy.html`；删除前再按子域复核引用 |
| 第三方真实凭证 | 代码骨架 + 安全回退就位，线上全空值安全态 | 按 3.4 清单在各平台申请后落 env |
| hznzcn 迁移线 | 整目录隔离在途 | 收口后评估源码入库范围与是否执行生产导入 |
| 商品原图 / 图库授权 | 线上仍有无图商品与变体 404 | 待原图包或高清图库授权；离线修复脚本已入库可重跑 |

## 7. 提交与产物

- 本轮仓库侧无源码改动：凭据复核为线上 / 只读审计，账号清理在 CVM 库内执行，hznzcn 保持 gitignore 隔离；产物为本报告与服务器备份 / 清单。
- 服务器产物：`/var/lib/mixmapp/backups/pre-user-cleanup-20261120-204603.dump`、`pre-user-cleanup-20261120-204603.users.csv`。
- 版本：工作号 0.0.2（release）；线上 `db=ok`、`demoMode=on`；基线 169 passed / 8 skipped、typecheck 全包 Done。
- 部署：本轮不触发 CVM 重新发布；生产 API 直连 `api.mixm.top`，账号清理与凭据复核未改动发布产物。
