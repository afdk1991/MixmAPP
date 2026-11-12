# API 参考

基址：`/api/v1`（本地 `http://127.0.0.1:8080/api/v1`）
鉴权：`Authorization: Bearer <accessToken>`
响应：成功 `{ "data": … }`；失败 `{ "error": { "code", "message", "requestId", "details?" } }`

## 1. 健康与元信息

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/healthz` | 否 | 存活 + 能力快照（根路径 `/healthz` 亦有） |
| GET | `/readyz` | 否 | 数据库连通性 |
| GET | `/meta` | 否 | 版本、端支持、第三方能力开关、发号策略 |
| GET | `/`（根） | 否 | 服务名、版本、健康入口 |

`healthz` 示例：

```json
{ "status": "ok", "version": "0.1.0", "uptimeSec": 4,
  "checks": { "db": "memory", "sms": "console", "pay": "dev", "storage": "dev", "push": "dev", "ai": "dev" } }
```

## 2. 认证

| 方法 | 路径 | 鉴权 | 请求体 | 说明 |
|---|---|---|---|---|
| POST | `/auth/sms/code` | 否 | `{ phone, purpose: register\|login\|bind }` | 发送验证码，60s 限频，返回 `ttlSec`（开发态含 `devCode`） |
| POST | `/auth/register/phone` | 否 | `{ phone, code, nickname? }` | 注册即分配 MixmAPP 号码，201 |
| POST | `/auth/register/email` | 否 | `{ email, password, nickname? }` | 邮箱注册，201 |
| POST | `/auth/register/username` | 否 | `{ username, password, nickname? }` | 用户名注册（3–20 位字母/数字/下划线），201 |
| POST | `/auth/register/guest` | 否 | `{ deviceId, nickname? }` | 游客注册，同设备复用同一账号（首次 201 / 复用 200） |
| POST | `/auth/onekey` | 否 | `{ token, nickname? }` | 一键登录：已注册即登录、未注册即建号 |
| POST | `/auth/login/password` | 否 | `{ account, password }`（账号可为用户名/邮箱/MixmAPP 号码） | 密码登录 |
| POST | `/auth/login/sms` | 否 | `{ phone, code }` | 验证码登录（未注册则自动建号） |
| POST | `/auth/login/oauth` | 否 | `{ provider: wechat\|qq\|github\|apple, code }` | 第三方登录，首次登录自动建号（Apple 的 code 传 identityToken） |
| POST | `/auth/refresh` | 否 | `{ refreshToken }` | 轮换刷新令牌 |
| POST | `/auth/logout` | 否 | `{ refreshToken }` | 撤销刷新令牌 |

认证成功统一返回：

```json
{ "data": { "user": { "id": "…", "accountNo": "MixmAPP-…", … },
            "tokens": { "accessToken": "…", "refreshToken": "…", "expiresIn": 900, "tokenType": "Bearer" },
            "isNewUser": true } }
```

## 3. 我的

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/me` | 是 | 当前用户（手机号/邮箱掩码） |
| PATCH | `/me` | 是 | 改 `nickname` / `avatarUrl` / `bio` |
| POST | `/me/bind/phone` | 是 | `{ phone, code }` 绑定手机号 |
| POST | `/me/bind/email` | 是 | `{ email, password }` 绑定邮箱 |
| POST | `/me/bind/username` | 是 | `{ username, password }` 补设用户名（游客升级为正式账号） |
| POST | `/me/bind/oauth` | 是 | `{ provider, code }` 绑定第三方 |
| POST | `/me/push-token` | 是 | `{ token, platform: android\|ios\|harmony\|web, provider?: fcm\|jpush }` 上报设备 |
| POST | `/me/push-test` | 是 | 向本人设备发测试推送 |

## 4. 发号

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/ids/preview` | 否 | `{ strategy?: snowflake\|ulid\|uuidv7 }`，一次返回 `id` / `snowflake` / `accountNo` / `ulid` / `uuidV7` |

## 5. 支付

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/pay/orders` | 是 | `{ channel: wechat\|alipay, amountFen, subject, outTradeNo? }`，201 返回订单与支付参数 |
| GET | `/pay/orders/:outTradeNo` | 是 | 查单，返回状态 `pending`/`paid`/`closed`/`refunded` |
| POST | `/pay/notify/wechat` | 否（验签） | 微信异步通知，返回 `{ code: "SUCCESS" }` |
| POST | `/pay/notify/alipay` | 否（验签） | 支付宝异步通知，返回纯文本 `success` / `fail` |

## 6. 定位与存储、AI

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/map/regeo` | 是 | `{ longitude, latitude }` 逆地理 |
| POST | `/map/route` | 是 | `{ origin, destination, mode }` 路径规划 |
| POST | `/storage/presign` | 是 | `{ key, contentType, expiresIn? }` 返回预签名 URL 与 `publicUrl`，key 落在 `u/{userId}/` |
| POST | `/ai/chat` | 是 | `{ messages, model?, temperature? }` OpenAI 兼容对话 |

## 7. 错误码

| code | HTTP | 触发 |
|---|---|---|
| `VALIDATION_FAILED` | 400 | zod 校验失败，`details` 给出字段与原因 |
| `UNAUTHORIZED` | 401 | 缺令牌、令牌过期或无效 |
| `FORBIDDEN` | 403 | 无权访问该资源 |
| `NOT_FOUND` | 404 | 路由或资源不存在 |
| `ACCOUNT_EXISTS` | 409 | 手机号/邮箱/第三方身份已注册 |
| `CODE_INVALID` | 400 | 验证码错误、过期或已消费 |
| `CODE_RATE_LIMITED` | 429 | 验证码 60 秒限频 |
| `RATE_LIMITED` | 429 | 单 IP 请求超限，带 `retry-after: 60` |
| `PROVIDER_ERROR` | 502 | 第三方返回错误（短信/支付/地图/推送/AI） |
| `INTERNAL` | 500 | 未预期异常，`requestId` 用于对照日志 |

## 8. 调试建议

```powershell
# 能力快照
curl http://127.0.0.1:8080/api/v1/meta

# 发号试算（不需要登录）
curl -X POST http://127.0.0.1:8080/api/v1/ids/preview -H "content-type: application/json" -d '{\"strategy\":\"uuidv7\"}'

# 登录后取我
curl http://127.0.0.1:8080/api/v1/me -H "Authorization: Bearer <token>"
```

响应头里的 `x-account-no` 是当前令牌对应的 MixmAPP 号码，联调时可直接确认账号身份。
