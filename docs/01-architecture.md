# 架构

## 1. 一张图

```
┌──────────────────────────── 端（apps/app，uni-app 单码多端）────────────────────────────┐
│  页面层  index / register / login / me / tools-ids / settings-about                      │
│  状态层  stores/session.ts（令牌持久化、401 自动刷新、并发请求合并）                        │
│  传输层  api/client.ts（uni.request 封装、ApiError 归一化、Bearer 注入）                  │
└───────────────────────────────────┬───────────────────────────────────────────────────┘
                                    │  HTTPS  /api/v1/*
┌───────────────────────────────────▼───────────────────────────────────────────────────┐
│  services/api（Fastify 5）                                                             │
│  app.ts        : 限流钩子 → 路由 → requireAuth → 统一错误体 → 404/健康/根               │
│  routes/*      : auth / me / integrations / meta   （只做校验与编排，不含业务细节）      │
│  modules/*     : AuthService（注册登录令牌绑定发号）、PayService（下单回调对账）          │
│  adapters/*    : sms oauth map storage push ai pay/{wechat,alipay}（每家一个实现）       │
│  db/*          : Store 接口 + MemoryStore / PgStore + migrate                           │
│  lib/*         : errors crypto(scrypt) jwt(jose) validate(zod+fastify 声明)              │
└───────────────────────────────┬──────────────────────────────┬──────────────────────────┘
                                │                              │
                   PostgreSQL（可选）                    第三方 HTTP API
```

`packages/contracts` 被端与服务端同时引用，保证请求体/响应体的形状只有一个定义；`packages/ids` 被服务端引用，保证发号逻辑只有一份。

## 2. 依赖方向（硬约束）

```
apps/app ─┐
          ├─→ packages/contracts   （纯 schema，禁止引入 DOM / Node 依赖）
services/api ─┘   └─→ packages/ids（只依赖 node:crypto）
```

- 反向依赖一律禁止：`contracts`、`ids` 不认识业务，也不认识 Fastify / Vue。
- 跨包引用只用包名（`@mixmapp/ids`），不用相对路径穿越 workspace。
- 端侧不直接读数据库、不持有第三方密钥；所有第三方调用都在服务端适配器里。

## 3. 请求生命周期

1. `uni.request` 发出，`client.ts` 从持久化令牌注入 `Authorization: Bearer …`。
2. Fastify 全局 `preHandler` 做**单 IP 每分钟固定窗口限流**（`/healthz`、`/readyz` 放行）。
3. 路由用 zod 解析入参（`lib/validate.ts` 把校验失败统一转成 `VALIDATION_FAILED` 400）。
4. 需要登录的路由走 `requireAuth`：校验 HS256 访问令牌，写 `request.userId`，并把 `x-account-no` 回写到响应头。
5. 业务在 `modules/*` 完成，落到 `Store` 接口或第三方适配器。
6. 统一响应形状：成功 `{ data: … }`，失败 `{ error: { code, message, requestId, details? } }`。
7. 端侧收到 401 时，用刷新令牌换新令牌并**重放原请求**；并发请求共用同一次刷新。

## 4. 存储层：一个接口，两套驱动

`db/types.ts` 定义 `Store`，`db/memory.ts` 与 `db/postgres.ts` 各实现一份；`index.ts` 按 `DATABASE_URL` 是否存在选择驱动。

- 好处：本机没有 PostgreSQL 也能跑全部接口测试与契约测试，CI 不必挂服务容器。
- 代价：内存模式重启即丢数据，启动时打印警告；生产必须配 `DATABASE_URL`。
- `PgStore` 用 `pg` 连接池 + 手写 SQL，表的 `snake_case` 在映射层转成 `camelCase`，不引 ORM，避免迁移和类型两套真相。

数据表（`infra/sql/0001_init.sql`）：

| 表 | 用途 | 关键约束 |
|---|---|---|
| `users` | 账号主体 | `id` 主键、`account_no` 唯一、`phone`/`email` 唯一（可空） |
| `bindings` | 第三方身份绑定 | `(provider, open_id)` 唯一 |
| `refresh_tokens` | 刷新令牌 | 只存 `sha256` 哈希、`revoked`、`replaced_by` 实现轮换 |
| `sms_codes` | 验证码 | `phone + purpose`、过期时间、一次性消费 |
| `payments` | 支付订单 | `out_trade_no` 唯一、金额用分、状态机 |
| `push_tokens` | 推送设备号 | `(user_id, token)` 唯一 |
| `schema_migrations` | 迁移记录 | 文件名主键，幂等 |

## 5. 端侧结构

- `pages.json` 注册 6 个页面，`manifest.json` 写全 H5 / 小程序 / App-Plus / Harmony 四套配置，并关闭 uni 统计（不向 DCloud 上报）。
- `stores/session.ts` 是唯一状态源：令牌、当前用户、`ready` 标记；登录/注册/刷新/退出都走这里。
- `api/client.ts` 只做 HTTP，不写业务判断；`ApiError` 把网络错误、业务错误、401 统一成一种可判断的对象。
- 样式集中在 `styles/theme.scss` + `uni.scss`，页面只写布局，换肤不用逐页改。

## 6. 关键设计取舍

| 取舍 | 理由 |
|---|---|
| 密码用 Node 内置 `scrypt`，不用 argon2 | argon2 需原生编译，Windows 上极易失败；scrypt 自带参数前缀，未来可平滑升级 |
| JWT 用 `jose`，不用 jsonwebtoken | ESM 原生、无 CJS 互操作坑、Web Crypto 兼容 |
| 支付签名手写（node:crypto），不引官方 SDK | 少一层依赖与证书管理；签名串格式固定，测试可覆盖 |
| 发号器一次产出五种形态 | 主键、对外号码、排查用雪花值、两种标准 ID 同源，避免多套生成器互相打架 |
| 限流内置固定窗口，不引 `@fastify/rate-limit` | 单实例足够；多实例时应换成 Redis 计数（见运维手册） |
| API 构建把 workspace 包打进 dist | 线上 release 只需第三方依赖，不需要 TS 源码与构建工具 |

## 7. 相关文件

| 关注点 | 入口 |
|---|---|
| 启动与装配 | `services/api/src/index.ts`、`src/app.ts` |
| 配置与能力快照 | `services/api/src/config.ts` |
| 契约 | `packages/contracts/src/index.ts` |
| 发号 | `packages/ids/src/index.ts` |
| 端侧入口 | `apps/app/src/main.ts`、`src/pages.json`、`src/manifest.json` |
