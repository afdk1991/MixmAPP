# MixmAPP

一个账号跑通所有端：**uni-app 单码多端（Vue 3 + TypeScript）** + **Fastify API** + **全局自动发号** + **四类第三方能力** + **提交到交付的全链路自动化**。

> 仓库定位：绿地项目。全部代码在本仓 `F:\合并项目\MixmAPP` 内自洽，不依赖任何外部旧仓。

<!-- version:begin -->
当前构建版本：**V0.0.0-preview**（内部预览构建，未对外发布）
已发布版本：无
版本规约：首发 `V0.0.0`，之后按补丁递增；发布前不占用正式版本号；与 README 同步，细则见 [docs/08-versioning.md](docs/08-versioning.md)
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
| 用户体系 | 手机验证码 / 邮箱密码 / 微信·QQ·GitHub OAuth 注册登录，注册即分配全局唯一 MixmAPP 号码 |
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

## 界面预览（本地 H5 实测截图，390 × 844）

| 首页 | 注册 | ID 试算器 |
|---|---|---|
| ![首页](docs/screenshots/home.png) | ![注册](docs/screenshots/register.png) | ![ID 试算器](docs/screenshots/ids.png) |

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
├─ deploy/                 # 原子发布、回滚脚本
├─ scripts/                # 门禁、健康检查、备份、静态发布、品牌素材、H5 预览
├─ docs/                   # 架构、ID 与鉴权、第三方、CI/CD、运维手册、API 参考、免费平台取证
├─ .github/workflows/      # ci.yml / deploy.yml / android.yml / ops-nightly.yml
└─ .gitee/pipeline.yml     # Gitee Go 流水线
```

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

---

## 状态与边界（事实陈述，2026-11-12）

**本地已验证**：`pnpm install` / `lint` / `typecheck` / 26 例测试（22 单元 + 4 真库跳过）/ `build:api` / `build:h5` / `build:mp-weixin` / `build:app` / `build:harmony` / Android debug APK 构建 / 注册→分配 MixmAPP 号码→`/me`→三策略试算→刷新令牌 的端到端调用。

**免费平台已验证（GitHub 云端 runner，非本机）**：

| 工作流 | 结果 | 证明的事 |
|---|---|---|
| `ci` | ✅ 1m18s | 规则/类型/22 例单元测试/**4 例真实 PostgreSQL 集成测试**/API 构建/H5 构建/小程序构建/`dist` 启动后 `readyz` 就绪 |
| `deploy` | ✅ 1m10s | 独立发布包（`pnpm deploy --prod`）+ H5 打包 + 产物上传；静态端与 SSH 端因无凭据显式 SKIP |
| `Android` | ✅ 3m18s | H5 → `cap sync` → `assembleDebug`，产出 `mixmapp-debug-apk`（3.91 MB） |
| GitHub Pages | ✅ 已上线 | 静态端真实公网地址 <https://afdk1991.github.io/MixmAPP/>（主仓直接托管） |

**未验证**（缺外部条件，不做假绿）：iOS 打包（需 macOS + 证书）、Android release 签名（需 keystore）、鸿蒙上架包（需 DevEco / HBuilderX）、Cloudflare Pages（需 API Token）、真实短信/支付/地图/推送/AI（需商户号与密钥）、线上 API 部署（需服务器与 SSH 凭据）。

取证细节与每条失败的真实原因见 [`docs/07-free-platform-verification.md`](docs/07-free-platform-verification.md)。


详见 [`docs/05-runbook.md`](docs/05-runbook.md) 的「已知边界」一节。
