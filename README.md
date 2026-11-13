# MixmAPP

一个账号跑通所有端：**uni-app 单码多端（Vue 3 + TypeScript）** + **Fastify API** + **全局自动发号** + **四类第三方能力** + **提交到交付的全链路自动化**。

> 仓库定位：绿地项目。全部代码在本仓 `F:\合并项目\MixmAPP` 内自洽，不依赖任何外部旧仓。

<!-- version:begin -->
当前构建版本：**V0.0.0-preview**（内部预览构建，未对外发布）
已发布版本：无
版本规约：首发 `V0.0.0`，之后按补丁递增；发布前不占用正式版本号；与 README 同步，细则见 [docs/19-versioning.md](docs/19-versioning.md)
<!-- version:end -->

---

## 它能做什么

| 能力 | 落地方式 |
|---|---|
| Web / H5 / PWA | `uni build` → `apps/app/dist/build/h5`，可直接托管到 Cloudflare Pages / Nginx |
| Android / iOS 原生 | `uni build -p app` 产出 App-Plus 资源，交由 HBuilderX 云打包或本地打包 |
| Android 本地出包 | `apps/mobile`（Capacitor 壳）装载同一份 H5 产物，`gradlew assembleDebug/Release` 直接出 APK/AAB |
| 微信小程序 | `uni build -p mp-weixin` → `dist/build/mp-weixin` |
| HarmonyOS | `uni build -p app-harmony` → `dist/build/app-harmony` |
| 用户体系 | 手机验证码 / 邮箱密码 / 用户名密码 / 本机号码一键登录 / 游客账号 / 微信·QQ·GitHub·Apple OAuth 注册登录，注册即分配全局唯一 MixmAPP 号码 |
| 商城 | 商品列表 / 详情（分类 + 关键词 + 库存），购物车加购·改量·删除，下单扣库存与订单查询；`products / carts / orders / order_items` 四表，Memory 与 PostgreSQL 双驱动，H5 端商城·详情·购物车·订单四页 |
| 自动分配 ID | 雪花 ID、ULID、UUIDv7 三策略并存，一次发号同时产出主键 + MixmAPP 号码 + 雪花值 + ULID + UUIDv7 |
| 支付 | 微信支付 APIv3（JSAPI 下单、回调验签、AES-256-GCM 解密）、支付宝 RSA2（下单、异步通知验签） |
| 定位导航 | 高德 Web 服务（逆地理、路径规划）；配置北斗坐标系入参即可直接复用 |
| 存储 / 推送 / AI | S3 兼容（AWS S3 / R2 / OSS）SigV4 预签名、极光 / FCM 推送、豆包 / OpenAI 兼容 Chat |
| 自动化 | 规则→类型→测试→构建门禁，CI 三端构建，Cloudflare Pages 静态发布，SSH 原子发布 + 自动回滚，每日巡检与备份 |

---

## 快速开始

```powershell
# 1. 安装依赖（Node ≥ 20.11，pnpm 9.12）
pnpm install

# 2. 准备环境变量：必须给一个真实 PostgreSQL 连接串
Copy-Item .env.example .env
#    DATABASE_URL=postgres://user:pass@host:5432/db
#    免费云端可直接用 Neon / Supabase 的免费实例

# 3. 建表（幂等，可重复执行）
pnpm db:migrate

# 4. 起后端（默认 http://127.0.0.1:8080）
pnpm dev:api

# 5. 起 H5（默认 http://127.0.0.1:5173，已把 /api 代理到 8080）
pnpm dev:h5
```

**没有 `DATABASE_URL` 时会直接拒绝启动**，这是刻意的：持久化只有 PostgreSQL 一条路径，不存在「看起来在跑真库、其实在跑内存」的隐式降级。确实要做一次性临时联调，才显式设 `ALLOW_MEMORY_STORE=1`，控制台会打印「重启即丢数据」的警告，且该模式不作为任何验证结论的依据。

---

## 视觉与品牌（2026-11-13 重设计）

| 令牌 | 值 | 用法 |
|---|---|---|
| 画布 | `#f4f4f1` 暖白纸 | 页面底，替代旧冷灰 |
| 深场 | `#0b0f0e → #17322c` 石墨-墨绿 | 首屏、通行证、商品主图 |
| 强调 | `#0f9d8f` 品牌青 | 唯一强调色，只用于可交互与状态 |
| 展示字体 | 系统无衬线，800 字重 + 负字距 | 所有标题（弃用衬线） |
| 控件圆角 | `$r-control` 12rpx / 卡片 24rpx | 按钮、输入框、缩略图 |

标志由 `apps/app/src/components/mx-logo/` 统一提供（方框 MX 连字 + 品牌青底线，`sm/md/lg`、`ink/light` 两套色调），顶栏、首屏、关于页共用同一份实现；应用图标由 `python scripts/brand-icon.py` 生成，母版见 `docs/brand/logo-1024.png`。

## 界面预览（本地 H5 实测截图，390 × 844）

| 首页 | 注册 |
|---|---|
| ![首页](docs/screenshots/home.png) | ![注册](docs/screenshots/register.png) |

截图来源：`pnpm build:h5` 产物 + `node scripts/serve-h5.mjs` 本地预览 + 系统 Edge 无头截图，页面上的「服务在线 · development 环境」是真实调用 `/api/v1/meta` 的结果。

---

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm verify` | 一键门禁：规则检查 → 类型检查 → 全部测试 → API 构建 → H5 构建 |
| `pnpm lint` | 仓库规则（禁 `console.log`、禁 `.only`、禁硬编码密钥、禁 TODO/FIXME、Vue 单文件标签闭合） |
| `pnpm typecheck` | 全 workspace 类型检查（含 `vue-tsc`） |
| `pnpm test` | `packages/ids` 11 例 + `services/api` 22 例单元 + 4 例真实库集成（无 `DATABASE_URL` 时这 4 例跳过，CI 里强制跑） |
| `pnpm build:api` | tsup 打包 API（含 `dist/db/migrate.js` 迁移入口） |
| `pnpm build:h5` / `build:mp-weixin` / `build:app` / `build:harmony` | 分端构建 |
| `pnpm db:migrate` | 执行 `infra/sql/*.sql`（需 `DATABASE_URL`） |
| `pnpm ops:health` | 线上健康巡检（可传 base URL） |
| `pnpm ops:backup` | PostgreSQL 备份（`pg_dump` + gzip + 14 天清理） |
| `node scripts/serve-h5.mjs` | 本地预览 H5 产物，并把 `/api/*` 反代到 8080 |
| `node scripts/build-h5-single.mjs` | 把 H5 压成单文件 HTML（`release/mixmapp-h5-single.html`），用于只支持单文件托管的平台；子路径托管加 `MIXMAPP_H5_BASE=/MixmAPP/` |

---

## 目录结构

```
MixmAPP/
├─ apps/
│  ├─ app/                 # @mixmapp/app：uni-app 单码多端（6 个页面）
│  └─ mobile/              # @mixmapp/mobile：Capacitor 安卓壳（装 H5 产物出 APK/AAB）
├─ services/api/           # @mixmapp/api：Fastify 5 + zod + jose + pg
├─ packages/
│  ├─ ids/                 # @mixmapp/ids：雪花 / ULID / UUIDv7 / Crockford MixmAPP 号码
│  └─ contracts/           # @mixmapp/contracts：zod schema 与 DTO 契约
├─ infra/                  # SQL 迁移、Nginx、systemd
├─ install/                # WordPress 式安装向导（server.mjs + ui.html）
├─ deploy/                 # 原子发布、回滚脚本
├─ scripts/                # 门禁、健康检查、备份、静态发布、品牌素材、H5 预览、install.sh、打包安装器
├─ docs/                   # 架构、ID 与鉴权、第三方、CI/CD、运维手册、API 参考、免费平台取证
├─ .github/workflows/      # ci.yml / deploy.yml / android.yml / ops-nightly.yml
└─ .gitee/pipeline.yml     # Gitee Go 流水线
```

---

## 一键安装（WordPress 式）

新服务器上只需两步：`bash install.sh <安装包>`，然后在浏览器里点完 5 步（环境检查 → 数据库 → 站点与账号 → 安装 → 完成）。
向导会自动写 `/etc/mixmapp/api.env`、建库迁移、起 systemd 服务、发 HTTPS、部署入口首页，装完自动失效。

```bash
node scripts/package-installer.mjs          # 产出 release/mixmapp-install-<ver>.tar.gz
bash scripts/install.sh mixmapp-install-<ver>.tar.gz   # 服务器上（root）
```

原理、安全模型、腾讯云 CVM/轻量应用服务器落地步骤、镜像制作与验收清单见
[`docs/21-wordpress-style-installer.md`](docs/21-wordpress-style-installer.md)。

---

## 多端构建矩阵

| 目标 | 命令 | 产物 | 后续动作 |
|---|---|---|---|
| H5 / PWA | `pnpm build:h5` | `apps/app/dist/build/h5` | `node scripts/deploy-static.mjs` 发 Pages；或交给 Nginx |
| 微信小程序 | `pnpm build:mp-weixin` | `apps/app/dist/build/mp-weixin` | 微信开发者工具导入 |
| Android / iOS | `pnpm build:app` | `apps/app/dist/build/app` | HBuilderX 导入后云打包 / 本地打包 |
| HarmonyOS | `pnpm build:harmony` | `apps/app/dist/build/app-harmony` | HBuilderX / DevEco 导入 |
| 安卓 APK / AAB | `pnpm build:h5` → `pnpm --filter @mixmapp/mobile sync:android` → `pnpm --filter @mixmapp/mobile build:debug` | `apps/mobile/android/app/build/outputs/...` | 签名后发布 |

四个 uni-app 目标都已在本地编译通过；Android debug APK 已实际产出（约 4.1 MB）。

---

## 环境变量

完整清单见 [`.env.example`](.env.example)。最小可跑集合：

```ini
JWT_SECRET=至少 32 字节的随机串
PUBLIC_BASE_URL=http://127.0.0.1:8080
ID_STRATEGY=snowflake        # snowflake | ulid | uuidv7
SNOWFLAKE_WORKER_ID=1        # 0..1023，多实例必须互不相同
```

第三方按需开启：填了对应凭据，`/api/v1/meta` 的能力矩阵会变成 `on`，未填则自动退化为 dev 适配器（不报错、不联网）。

第三方登录是**真实闭环**（2026-11-13）：`GET /api/v1/auth/oauth/:provider/start` 校验渠道后 302 到官方授权页（`redirect_uri` 固定回本站 `/auth/oauth/:provider/callback`，带一次性 `state`），回跳把 `code` 带回原页面，再由 `POST /auth/login/oauth` 换令牌建号。未配置渠道直接返回 `PROVIDER_DISABLED`，前端渲染「未启用」且不显示跳转箭头、不发假跳转。部署在带前缀的域名时，`PUBLIC_BASE_URL` 要写到 API 前缀（例：`https://cloud.mix.top/mixmapp/api/v1`），未配置则按请求 `Host` 反推。

---

## 状态与边界（事实陈述，2026-11-12）

**生产闭环已打通**（前端不是静态壳）：生产 API `https://cloud.mixm.top/mixmapp/api/v1` 的数据层走 CloudBase 云 PG（`public.mix_exec` SQL 桥），公网域名上已完成「用户名注册 → 加购 → 下单 → 同 Idempotency-Key 幂等复放 → 我的订单 → `/me`」API 级取证，以及 Pages 生产站浏览器点击级取证（订单 `MOMWDO6PT5181888`、库存 63→62 均可在云端库回查）。详见 [`docs/11-delivery-report-2026-11-12-prod-closed-loop.md`](docs/11-delivery-report-2026-11-12-prod-closed-loop.md)。

**本地已验证**：`pnpm install` / `lint` / `typecheck` / **68 例通过（6 例需真库跳过）** / `build:api` / `build:h5` / `build:mp-weixin` / `build:app` / `build:harmony` / Android debug APK 构建 / 注册→分配 MixmAPP 号码→`/me`→三策略试算→刷新令牌 的端到端调用。

**免费平台已验证**：

| 平台 / 工作流 | 结果 | 证明的事 |
|---|---|---|
| 生产 API（云服务器 + CloudBase PG） | ✅ 线上可用 | `cloud.mixm.top` 上真实注册、加购、下单、幂等、订单查询、个人中心全通过；2026-11-13 国内家用网络严格校验 TLS 复核 `/meta` 200、`/healthz` db=ok |
| `ci` | ✅ 1m18s | 规则/类型/单元测试/**真实 PostgreSQL 集成测试**/API 构建/H5 构建/小程序构建/`dist` 启动后 `readyz` 就绪 |
| `deploy` | ✅ 1m10s | 独立发布包（`pnpm deploy --prod`）+ H5 打包 + SSH 原子发布（`/opt/mixmapp/current`） |
| `Android` | ✅ 3m18s | H5 → `cap sync` → `assembleDebug`，产出 `mixmapp-debug-apk`（3.91 MB） |
| GitHub Pages | ✅ 已上线 | <https://afdk1991.github.io/MixmAPP/>，单文件 H5 注入生产 API 源，新版「通行证 PASS」界面 run `43249567035` success |
| CloudBase 静态托管 | ✅ 已上线 | <https://mixmapp-cs-1-d5g815slocb5a611a.webapps.tcloudbase.com/>，当前版本 `mixmapp-007`（buildId `2612465058`）SUCCESS；2026-11-13 首发修正产物内嵌的 API 基址（原为错误的 `cloud.mix.top`），随后两次重发带上新版首页 |
| 生产机自托管入口 | ✅ 已上线 | <https://cloud.mixm.top/>，nginx `location = /` 直接返回 `/var/www/mixmapp-site/index.html`（与 Pages / CloudBase 同一份单文件 H5，同源调用 `/mixmapp/api/v1`），根路径不再落回 Mim 的 8787 返回 404 |

**线上内容一致性（2026-11-12 复核）**：三端静态站此前展示的是旧版白卡片界面，仓库里的全站改版未入库。已提交 `6ce6bb0`（14 个文件、全站通行证视觉）与 `1393512`（`rise` 动效去掉 `opacity` 起始，避免动画被浏览器冻结时「通行入口」整块永久空白），Pages 与 CloudBase 均已按修复版重发并逐页取证（首页 / 登录 / 商城）。详见 [`docs/12-delivery-report-2026-11-12-ui-consistency.md`](docs/12-delivery-report-2026-11-12-ui-consistency.md)。

**基础设施缺陷（2026-11-13 已修，结论更正）**：此前记录为「`cloud.mix.top` 解析到 AWS Global Accelerator、国内 TLS alert 112」——该域名少写一个 m，`mix.top` 是另一个域名（停放服务，13.248.169.48 / 76.223.54.146），与本项目无关。真实主机名是 `cloud.mixm.top`，一直解析到源站 115.159.159.11。国内打不开的真实原因是生产机 nginx 的 vhost 把 `server_name` 写成了 `cloud.mix.top`（SNI 永不匹配，回落 Mim 默认站 → alert 112），且部分静态产物内嵌的 API 基址也写错。两处均已修正：nginx 改由 `/etc/nginx/conf.d/cloud-mixmapp.conf` 接管 443（`nginx -t` 通过），CloudBase 静态站重发 `mixmapp-005`。现网实测（宁波家用网络、不跳过证书校验）：`/meta` 200 JSON、`/healthz` db=ok、证书 CN/SAN = `cloud.mixm.top`、两个静态站首页状态 `ONLINE`。**2026-11-13 21:14 追加**：`https://cloud.mixm.top/` 根路径原先转发给 Mim 的 8787，访客拿到 404；现已改为 nginx `location = /` 直接返回自托管的单文件 H5（`/var/www/mixmapp-site/index.html`），域名根即项目入口首页。取证与整改全过程见 [`docs/14-access-domains.md`](docs/14-access-domains.md) 与 [`docs/20-entry-hosting.md`](docs/20-entry-hosting.md)。


**未验证**（缺外部条件，不做假绿）：iOS 打包（需 macOS + 证书）、Android release 签名（需 keystore）、鸿蒙上架包（需 DevEco / HBuilderX）、Cloudflare Pages（需 API Token）、真实短信/支付/地图/推送/AI（需商户号与密钥；生产手机验证码注册因无短信通道暂不可用，可用用户名密码注册）。

取证细节与每条失败的真实原因见 [`docs/07-free-platform-verification.md`](docs/07-free-platform-verification.md)。


详见 [`docs/05-runbook.md`](docs/05-runbook.md) 的「已知边界」一节。
