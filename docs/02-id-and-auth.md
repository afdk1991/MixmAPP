# ID 与鉴权

## 1. 三套 ID，一次发号

`@mixmapp/ids` 的 `IdFactory.next()` 一次调用同时产出：

| 字段 | 形态 | 用途 |
|---|---|---|
| `id` | 按 `ID_STRATEGY` 决定（雪花数字串 / ULID / UUIDv7） | 数据库主键、对外 API 标识 |
| `accountNo` | `MixmAPP-XXXX-XXXX-XXXX-X` | 用户在界面看到的唯一号码，可复制、可展示 |
| `snowflake` | 19 位十进制 | 分片、排查、日志关联 |
| `ulid` | 26 位 Crockford Base32 | 可排序、无中心依赖的备用标识 |
| `uuidV7` | 标准 36 位 UUID | 与外部系统互操作 |

### 1.1 雪花

- 位宽：41 位毫秒时间 + 10 位机器号 + 12 位序列。
- 纪元：`Date.UTC(2026, 0, 1)`，约可用 69 年。
- `SNOWFLAKE_WORKER_ID` 取值 `0..1023`，多实例部署时必须互不相同，否则同毫秒同序列会撞号。
- 同毫秒内序列自增，序列耗尽则自旋等待下一毫秒。

### 1.2 ULID

26 位 Crockford Base32：10 位时间戳 + 16 位随机。字典去掉了 `I/L/O/U`，因此不会与数字 `1/0` 混淆。

### 1.3 UUIDv7

布局：48 位毫秒时间 + 版本位 `7` + 12 位 `rand_a` + 变体位 `10xx` + 62 位 `rand_b`。

> 踩坑记录：初版用 JS 32 位位运算处理 48 位随机数，`& 0xffffffff` 在符号位上返回负数，`toString(16)` 带出负号，产出过 `ad83--65aa127d0000` 这种双连字符、末段 13 位的非法值。现版本改为 `BigInt` 全链路（8 字节随机 → 62 位），并由 `isUuidV7()` 在测试里守住格式。

### 1.4 MixmAPP 号码

`snowflake`（最大 63 位有效值）转 Crockford Base32，需要 13 个字符（65 位容量），按 `4-4-4-1` 分组，前缀 `MixmAPP`。

> 为什么不是 8 位：8 位 Base32 只有 40 位，装不下 63 位雪花，必然撞号。13 位是能整段装下的最小长度。

生成逻辑在 `packages/ids/src/crockford.ts`，号码与雪花值可互相还原，便于客服凭号码反查主键。

> 登录时号段大小写不敏感：用户输入 `mixmapp-7k2q-…` 也能命中同一账号（`findByAccountNo` 两侧统一大写比较）。

### 1.5 策略切换

```ini
ID_STRATEGY=snowflake   # snowflake | ulid | uuidv7
```

- 只影响**新写入**的主键形态；`accountNo` 永远由雪花派生，不随策略变化。
- 切换策略属于数据面变更，已有主键不会重写；如需统一形态，必须走一次性迁移脚本，不能热切。

---

## 2. 注册即分配号码

### 2.1 手机号注册

```
POST /api/v1/auth/sms/code        { phone, purpose: "register" }
POST /api/v1/auth/register/phone  { phone, code, nickname? }
```

1. 校验手机号格式（`1[3-9]\d{9}`），同号码同用途 60 秒内只能发一次，验证码有效期 300 秒。
2. 开发态（`SMS_PROVIDER=console`）验证码直接打印到服务端日志，并在响应里回显 `devCode`，方便本地联调；生产必须换成阿里云短信等真实通道。
3. 注册成功后：建用户 → 发号 → 写 `bindings`（phone）→ 发访问令牌与刷新令牌 → 返回 `user + tokens + isNewUser`。
4. 同号码重复注册返回 `409 ACCOUNT_EXISTS`，且验证码只能消费一次。

### 2.2 邮箱注册

```
POST /api/v1/auth/register/email  { email, password, nickname? }
```

密码用 `scrypt`（`N=16384, r=8, p=1`，32 字节盐），存储格式自带参数前缀，未来调参不影响老用户校验。

### 2.3 用户名注册

```
POST /api/v1/auth/register/username  { username, password, nickname? }
```

- 用户名 2–20 个字符，支持中文、字母、数字、下划线，不能纯数字，`admin/root/system/support/official/guest/mixm/mixmapp` 为保留名。
- 内容合规：不得使用管理员/官方/客服等平台身份类名称，不得使用国家机关与公职身份类名称，不得包含违法低俗词；`USERNAME_DENYLIST` 可按监管要求外挂补充词库。
- 校验前会做归一化（全角转半角、去分隔符与零宽字符、数字替字母还原），拦截 `Ａｄｍｉｎ`、`4dm1n` 这类伪装。
- 唯一性大小写不敏感（Postgres 用 `lower(username)` 唯一索引），撞名返回 `409 CONFLICT`。
- 注册后可用「用户名 + 密码」或 MixmAPP 号码登录；不绑定手机/邮箱也能独立使用。

### 2.4 一键登录（本机号码认证）

```
POST /api/v1/auth/onekey  { token, nickname? }
```

- `token` 由端侧本机号码认证 SDK 下发，服务端交给 `ONEKEY_PROVIDER` 解析成手机号：
  - `dev`：token 形如 `dev:13800001234`，仅非生产环境可用，方便本地联调；
  - `http`：POST `ONEKEY_ENDPOINT`，请求体 `{ token }`，期望返回 `{ "phone": "13800001234" }`。
- 手机号已注册则直接登录（`isNewUser=false`），未注册则建号并返回 201 语义（接口统一 200，靠 `isNewUser` 区分）。
- 解析失败返回 `422 CODE_INVALID`，网关不可达返回 `502 PROVIDER_ERROR`，未配置返回 `503 PROVIDER_DISABLED`。

### 2.5 游客账号

```
POST /api/v1/auth/register/guest  { deviceId, nickname? }
```

- 同一设备重复调用复用同一账号（设备号哈希存在 `bindings` 的 `provider='guest'`），首次返回 201、复用返回 200。
- 游客用户 `isGuest=true`，绑定手机号/邮箱/第三方或补设用户名后自动置 `false`。
- 游客升级：`POST /me/bind/phone`、`POST /me/bind/email`、`POST /me/bind/username` 任一即可。

### 2.6 第三方首次登录

```
POST /api/v1/auth/login/oauth  { provider: "wechat"|"qq"|"github"|"apple", code }
```

- 用 `code` 换 `open_id`；`(provider, open_id)` 命中 `bindings` 则登录，未命中则**自动建号并分配 MixmAPP 号码**。
- Apple 走 `identityToken`（`code` 字段承载 JWT）：服务端用 Apple 公钥验签，并校验 `iss=https://appleid.apple.com`、`aud=OAUTH_APPLE_CLIENT_ID`。
- 已登录用户可通过 `POST /api/v1/me/bind/oauth` 把第三方身份挂到现有账号。
- 未配置对应 OAuth 凭据时，该 provider 在 `/meta` 里显示 `off`，端侧按钮会给出明确提示而不是静默失败。

---

## 3. 令牌模型

| 令牌 | 形态 | 有效期 | 存储 |
|---|---|---|---|
| 访问令牌 | JWT（HS256，claims：`sub`=用户 ID、`acc`=MixmAPP 号码、`typ`=`access`） | 15 分钟（`JWT_ACCESS_TTL_SEC`） | 端侧内存 + 本地持久化 |
| 刷新令牌 | 32 字节随机串（base64url） | 30 天（`JWT_REFRESH_TTL_DAYS`） | 服务端只存 `sha256` 哈希 |

刷新即轮换：旧令牌置 `revoked=true` 并记录 `replaced_by`，新令牌返回给端侧。重复使用已轮换的令牌会被拒绝，可用于发现令牌泄露。

端侧刷新策略（`apps/app/src/api/client.ts`）：

- 收到 401 → 用刷新令牌换新对 → 重放原请求；
- 同一时刻多个 401 共用**一次**刷新（避免并发轮换把彼此踢下线）；
- 刷新本身失败 → 清空本地令牌，回到未登录态。

```ini
JWT_SECRET=至少 32 字节随机串
JWT_ACCESS_TTL_SEC=900
JWT_REFRESH_TTL_DAYS=30
RATE_LIMIT_PER_MINUTE=60
```

---

## 4. 账号绑定与资料

| 接口 | 说明 |
|---|---|
| `GET /me` | 返回当前用户（手机号/邮箱做掩码） |
| `PATCH /me` | 改昵称、头像、简介（zod 限长） |
| `POST /me/bind/phone` | 短信验证码绑定手机号 |
| `POST /me/bind/email` | 邮箱 + 密码绑定 |
| `POST /me/bind/username` | 补设用户名 + 密码（游客升级为正式账号） |
| `POST /me/bind/oauth` | 绑定第三方身份 |
| `POST /me/push-token` | 上报设备推送 token |
| `POST /me/push-test` | 向本人设备发一条测试推送 |

---

## 5. 安全基线

- 所有写接口必须过 `requireAuth`（除注册、登录、发验证码）。
- 验证码：一次性、5 分钟过期、同号码 60 秒限频、错误次数不额外放行。
- 密码：`scrypt` + 随机盐，比较用 `timingSafeEqual`。
- 刷新令牌：只存哈希，轮换 + 撤销链。
- 限流：单 IP 每分钟固定窗口（`RATE_LIMIT_PER_MINUTE`，默认 60 次），超限返回 `429 RATE_LIMITED` 并带 `retry-after`。
- 日志：`requestId` 贯穿请求；不打印令牌、验证码、支付密钥。
- 错误体：生产环境不外泄堆栈，只返回 `code + message + requestId`。
