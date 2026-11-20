# 33 · 交付报告：桶根逐子域引用清单、凭据接入点复核、hznzcn 并行线盘点与演示账号清理

- 日期：2026-11-20
- 范围：CloudBase 共享静态托管桶根、`services/api/src/config.ts` 凭据接入点、`tools/hznzcn-importer/` 并行迁移线、线上库演示 / 测试账号
- 线上环境：腾讯云 CVM `115.159.159.11`，壳 `https://cloud.mixm.top/`，API `https://api.mixm.top/mixmapp/api/v1`，媒体 `https://img.mixm.top`
- 状态：**凭据复核、hznzcn 盘点、演示账号清理已闭环**；桶根候选资源仍为外部云资源，引用清单已出，删除留待拍板

## 1. 结论先说

| 类别 | 状态 | 证据 |
| --- | --- | --- |
| 桶根逐子域引用清单与残留清理 | **已删除闭环** | 四个共用桶根入口根路径返回同一内联壳；壳内根级 `assets/`、`static/`、`download/`、`privacy`、`404`、`apk`、`splash`、`manifest` 实际资源引用 0；拍板后按清单删除 94 个无引用对象，复核剩余 18 个（根兜底 2 + 他项目子目录 16） |
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
| 无引用候选（**已删除**） | `assets/` hash js/css | 前缀条目 85（含 1 个目录占位），文件 84，10-06 ~ 11-12 多版本 | 壳不加载外部 chunk；2026-11-20 整目录删除 |
| 无引用候选（**已删除**） | `static/` 图片 | 前缀条目 6（含 1 个目录占位），文件 5：`favicon.png`(2996)、`logo-192.png`(11570)、`logo-48.png`(2307)、`logo.png`(92660)、`splash.png`(42142) | 壳 favicon / logo 走内联；2026-11-20 整目录删除 |
| 无引用候选（**已删除**） | `download/app.apk` | 22257B（10-10） | 壳无 APK 下载引用；2026-11-20 整目录删除 |
| 无引用候选（**已删除**） | `privacy.html` | 11738B（10-23） | 壳与子目录无隐私协议链接引用；2026-11-20 单文件删除 |
| 他项目独立目录（不动） | `__auth/`、`cloud-admin/`、`pp-worker/`、`priceprobe-web/`、`youxuan-h5-v6test2/` | 见 2.1 | 归属他项目，不在 MixmAPP 清理范围；`v6test2/static/logo.png`(4023B) 为子目录自有资源，未被误删 |

### 2.5 删除执行与复核（2026-11-20 拍板后执行）

- 删除前复核：四个共用根壳 200、len=367963 同壳；候选文件名（`favicon.png`/`logo-192.png`/`logo-48.png`/`logo.png`/`splash.png`/`app.apk`/`privacy.html`）在壳内命中 0；`/static/` 仅 1 处为 JS 路径判断逻辑字符串；子目录页面 / 脚本对根级 `assets/`、`static/`、`download/` 引用均为 0，v6test2 两处命中为相对自身子目录路径与判断逻辑。
- 删除动作（`manageHosting delete`，confirm=true，逐目录限速）：
  - `privacy.html` 单文件删除；
  - `download/` 目录递归删除（占位 + `app.apk`）；
  - `static/` 目录递归删除（占位 + 5 张图）；
  - `assets/` 目录递归删除（占位 + 84 个 hash chunk）。
  - 合计删除 94 个对象，返回 `Error: []`、`verified: true`。
- 删除后 `listFiles` 复核：剩余 18 个对象 = 根兜底 `index.html`/`404.html` 2 个 + 他项目子目录 16 个（`__auth/` 5、`cloud-admin/` 1、`pp-worker/` 1、`priceprobe-web/` 3、`youxuan-h5-v6test2/` 6）。
- 在线可达复核：四个共用根壳 200（367963）、`priceprobe-web` 200、`v6test2` 200、`404.html` 200；已删候选路径由 `404.html` 兜底返回，文件本体不在托管清单。
- 回滚边界：托管文件删除不可逆，无回收桶；被删均为历史构建 hash chunk 与旧调试包，线上壳为单文件内联、不依赖这些对象。

### 2.4 风险与边界

- 服务端取证范围内，上述候选资源无任何在线页面 / 脚本引用；历史外链、旧版本浏览器 / APK 缓存命中风险无法从服务端排除，但线上壳为单文件内联、不加载这些对象，删除不影响当前在线可达性。
- 删除为不可逆外部写操作；执行前已按 2.5 复核引用清单，仅删明确无引用的 hash 资源、图片、旧调试包与隐私页；`index.html` / `404.html` 在三在线子域仍兜底期间保留。

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

### 3.5 个人开发者（无营业执照）准入矩阵（2026-11-20 复核）

复核口径：通读 `services/api/src/adapters/` 下 `map / ai / storage / push / sms / oauth-generic / oauth / pay / onekey`，个人可自助渠道的适配器均为**完整实现、无空桩**；缺凭证时抛 `PROVIDER_DISABLED` 或回退 `dev / console / local`，登录页不渲染未启用渠道。门禁：lint ✓、typecheck 全包 Done、test 169 passed / 8 skipped。

#### A. 个人可自助申请，代码已就位，填 Key 即开通（无执照门槛）

| 能力 | 平台与个人准入 | 代码实现 | 落地 env |
| --- | --- | --- | --- |
| GitHub 登录 | GitHub OAuth Apps，个人账号可建 | `oauth-generic` 配置化端点 + 字段映射 | `OAUTH_GITHUB_CLIENT_ID/SECRET` |
| Gitee 登录 | Gitee 开放应用，个人可注册 | 同上 | `OAUTH_GITEE_CLIENT_ID/SECRET` |
| Google / Facebook | 个人账号，需域名验证与网络条件 | 同上 | `OAUTH_GOOGLE/FACEBOOK_*` |
| 微博 / 抖音 / 华为 / QQ | 各开放平台个人开发者注册，审核松紧不一 | 同上 | 对应 `OAUTH_*` |
| Apple 登录 | Apple 开发者账号，个人可购 **$99/年** | `oauth.ts` ES256 私钥换 client secret | `OAUTH_APPLE_CLIENT_ID/TEAM_ID/KEY_ID/PRIVATE_KEY` |
| 地图定位 | 高德 Web 服务 Key，个人免费申请 | `AmapProvider` 逆地理 + 路径规划完整 | `MAP_PROVIDER=amap`、`AMAP_KEY` |
| AI | 豆包方舟 / OpenAI 兼容协议，个人实名领 Key | `OpenAiCompatProvider`（含用量回传） | `AI_PROVIDER`、`AI_API_KEY`、`AI_MODEL` |
| 对象存储 | COS / OSS / R2 / MinIO（S3 兼容），个人实名开通有额度 | `S3Storage` SigV4 query 预签名 PUT | `STORAGE_PROVIDER=s3`、`S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY/PUBLIC_BASE_URL` |
| 推送 | 极光免费版 / FCM（Google 账号） | `JPushProvider` REST v3、`FcmProvider` HTTP v1 | `PUSH_PROVIDER=jpush/fcm`、`JPUSH_*` / `FCM_*` |

#### B. 纯个人（无执照）受限或不可闭环，需个体工商户 / 企业资质

| 能力 | 政策事实（2026-11 检索） |
| --- | --- |
| 微信支付商户 | 普通商户主体限个体工商户 / 企业 / 政府 / 事业 / 社会组织；纯个人只能经服务商进件"小微 / 个人卖家"，且个人卖家需电商经营满 6 个月、累计收入超 20 万元，**无法自助开通普通商户号**。 |
| 支付宝收单 | 手机网站支付个人账号名义可签，但需提供营业执照且 ICP 备案主体与账号一致；无执照则收款额度受限（单笔 ≤2000、单日 ≤20000）。 |
| 国内短信 | 个人认证无法通过签名实名制报备，须企业资质或他用企业授权；个人仅可改用免签名的号码认证产品。 |
| 一键登录 / 本机号码认证 | 运营商商务签约 + 次数套餐（三网百万次套包 3 万元档），面向企业；未签约每 AppID 每日限 1000 次。 |
| 企业微信 / 钉钉 / 飞书登录 | 需企业组织主体，个人无法创建组织。 |
| 微信扫码 / 公众号授权 | 开放平台可个人认证，但需开发者资质认证（软著 + 手持身份证）审核通过；公众号网页授权仅已认证服务号可用，个人订阅号不支持。 |

#### C. 与资质无关的数据 / 并行线阻塞

- 无图商品约 3817 个待补图（#35，需原图包 / 图库授权，离线脚本已入库可重跑）。
- hznzcn 女装迁移线待并行会话收口后评估源码入库与生产导入（#34）。

> 政策来源：微信支付商户主体规则 `pay.weixin.qq.com/doc/v3/merchant/4012071573`；支付宝手机网站支付条件 `opendocs.alipay.com/b/03ah67`、`ideservice.alipay.com/cms/site/0j3pig`；阿里云短信个人资质公告 `help.aliyun.com/zh/sms/product-overview/announcement-on-sms-not-supporting-application-for-personal-use-qualification`；移动号码认证 `dev.10086.cn/numIdentific`；微信开放平台应用审核规范 `developers.weixin.qq.com/doc/oplatform/Website_App/operation.html`。

### 3.6 前后端端点覆盖对照（2026-11-20 审计）

**已闭环（前端页面 ↔ 后端路由一一对应）：**

- 认证：密码 / 短信 / 邮箱 / 用户名 / 游客注册登录、OAuth 发起-回调-换码、刷新、登出、一键登录。
- 账号：资料读取、用户名绑定、OAuth 绑定 / 解绑。
- 商城：商品列表 / 详情 / 类目树 / 规格，购物车增删改清空，下单，订单列表 / 详情 / 取消，收藏夹 CRUD / 复制 / 设默认，首页广告位与推荐分类。
- 地址：地址簿 CRUD / 设默认 / 可达性校验 / 配送方式。
- 元信息：`/meta` 能力快照与演示标记、健康检查。
- 管理面：DB 落点读取 / 切换、超时订单清扫（admin token）。

**本轮已离线落地（2026-11-20，门禁全绿）：**

| 端点 | 落地内容 |
| --- | --- |
| `PATCH /me`、`POST /me/bind/email`、`/me/bind/phone` | 「我的」页资料编辑（昵称 / 简介）+ 邮箱 / 手机补绑表单；手机补绑触发账号合并时自动回写主账号资料与新令牌 |
| `POST /me/bind/oauth`、`/me/push-token`、`/me/push-test` | meApi 封装对齐契约（linkOAuth / pushToken / pushTest） |
| `/admin/merges*`、`/admin/oauth/providers*`、`/admin/mall/import` | 管理后台新增：OAuth 渠道注册表（状态 / 缺失配置 / 启停）、账号合并审计（候选 / 记录 / 回滚）、目录导入面板 |
| `/map/*`、`/storage/presign`、`/pay/orders`、`/ai/chat` | integrationsApi 封装就位；`/meta` 第三方快照回填前端，`providerLive()` 按快照判定入口显隐 |

**仍未挂页面交互入口（约束归属，非代码缺口）：**

| 能力 | 约束 |
| --- | --- |
| 地图选点 / 路径规划 | 待高德 Key + 端侧地图组件 / 定位权限；dev 回退仅返回坐标占位 |
| 头像 / 图片上传 | 待 S3 凭证 + 文件选择控件；local 直传走 presign.url 二进制 PUT |
| 收银台支付调起 | B 类商户资质；沙箱模式不产生真实待支付订单，调起需端侧支付 SDK |
| 通用 AI 对话页 | 待 AI Key；独立对话页属后续产品页 |
| 调研 `/ai/research` | 后端研究编排未实现；research 前端保持 mock 演示态 |

**结论**：主链路 + 账号完善 + 管理进阶前后端对齐，离线可闭环的代码已全部落地；剩余入口挂在外部凭证、商户资质、端侧 SDK 或后续产品规划上，与 3.5 的 A / B / C 分层一致。门禁：lint ✓、typecheck 全包 Done、test 169 passed / 8 skipped（177）。

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
| ~~桶根候选残留~~ | **已删除闭环**（2026-11-20）：94 个无引用对象清理完毕，剩余 18 个为根兜底 + 他项目子目录 | 无；历史外链 / 旧缓存命中不影响当前在线壳 |
| 第三方真实凭证 | 代码骨架 + 安全回退就位，线上全空值安全态；按 3.5 分 A 类个人可自助 / B 类需个体户或企业资质 | A 类在个人平台领 Key 落 env 即开；B 类需先办执照或改走合规收款 / 认证方案 |
| hznzcn 迁移线 | 整目录隔离在途 | 收口后评估源码入库范围与是否执行生产导入 |
| 商品原图 / 图库授权 | 线上仍有无图商品与变体 404 | 待原图包或高清图库授权；离线修复脚本已入库可重跑 |

## 7. 提交与产物

- 提交 `76f4574` docs(delivery-report): 桶根逐子域引用清单、凭据接入点复核、hznzcn 盘点与演示账号清理（1 file，+159）。
- 提交 `3a2ce11` docs: 33 号报告回填桶根残留清理执行与复核记录（1 file，+24/-10）。
- 桶根残留清理（外部云资源，2026-11-20 拍板后执行）：删除 `assets/`、`static/`、`download/` 三目录与 `privacy.html`，共 94 个对象；复核剩余 18 个（根兜底 2 + 他项目子目录 16），四共用壳与他项目子域在线 200。
- 本轮仓库侧无源码改动：凭据复核为线上 / 只读审计，账号清理在 CVM 库内执行，桶根清理在 CloudBase 托管侧执行，hznzcn 保持 gitignore 隔离；产物为本报告与服务器备份 / 清单。
- 服务器产物：`/var/lib/mixmapp/backups/pre-user-cleanup-20261120-204603.dump`、`pre-user-cleanup-20261120-204603.users.csv`。
- 版本：工作号 0.0.2（release）；线上 `db=ok`、`demoMode=on`；基线 169 passed / 8 skipped、typecheck 全包 Done。
- 部署：本轮不触发 CVM 重新发布；生产 API 直连 `api.mixm.top`，账号清理与凭据复核未改动发布产物。
