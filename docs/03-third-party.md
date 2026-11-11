# 第三方能力接入

设计原则：**一家一个适配器，接口在内、实现在外**。业务模块只依赖接口，不 import 任何具体厂商；凭据全部走环境变量，未配置时自动降级为 `dev` 适配器（可跑通、不联网、不报错），因此本地开发不需要任何账号。

`GET /api/v1/meta` 会返回当前每家能力的状态（`on` / `off` 或 provider 名），端侧「关于」页直接读它。

---

## 1. 短信验证码

| 项 | 值 |
|---|---|
| 环境变量 | `SMS_PROVIDER`（`console` \| `aliyun`）、`DEV_ECHO_SMS_CODE`、`ALIYUN_SMS_ACCESS_KEY_ID`、`ALIYUN_SMS_ACCESS_KEY_SECRET`、`ALIYUN_SMS_SIGN_NAME`、`ALIYUN_SMS_TEMPLATE_CODE` |
| 实现 | `services/api/src/adapters/sms.ts` |
| 调用点 | `POST /auth/sms/code` |

- `console`：验证码打到服务端日志，并在响应 `devCode` 回显（仅开发态；`DEV_ECHO_SMS_CODE=0` 可关掉回显）。
- `aliyun`：走阿里云 Dysmsapi，签名 `HMAC-SHA1` + RPC 风格公共参数，模板变量只传 `code`。
- 无论哪家，验证码的生成、限频、一次性消费都在 `AuthService` 里，不依赖厂商行为。

上线前自检：`SMS_PROVIDER=aliyun` 后请求一次验证码，手机应能收到短信，且响应里**没有** `devCode`。

---

## 2. 第三方登录（OAuth）

| Provider | 环境变量 | 换取的身份 |
|---|---|---|
| 微信 | `OAUTH_WECHAT_APP_ID`、`OAUTH_WECHAT_APP_SECRET` | `openid` / `unionid` / 昵称 / 头像 |
| QQ | `OAUTH_QQ_APP_ID`、`OAUTH_QQ_APP_KEY` | `openid` / 昵称 / 头像 |
| GitHub | `OAUTH_GITHUB_CLIENT_ID`、`OAUTH_GITHUB_CLIENT_SECRET` | `id` / `login` / `name` / `avatar_url` |

实现：`adapters/oauth.ts`（`WechatOAuth` / `QqOAuth` / `GithubOAuth`，统一 `OAuthProvider` 接口）。

服务端只接收 `code`：`POST /auth/login/oauth { provider, code }`。端侧负责拉起授权页并回跳，H5 端从 `location.search` 取 `code`（见 `stores/session.ts` 的 `getOAuthCode()`），原生端需在各自 SDK 回调里把 `code` 传进来。

首次登录自动建号并分配 MIX 号码；已登录用户绑定走 `POST /me/bind/oauth`。

---

## 3. 支付

### 3.1 微信支付 APIv3

环境变量：`PAY_WECHAT_APP_ID`、`PAY_WECHAT_MCH_ID`、`PAY_WECHAT_SERIAL_NO`、`PAY_WECHAT_PRIVATE_KEY`（PEM，换行写 `\n`）、`PAY_WECHAT_API_V3_KEY`（**必须 32 字节**）、`PAY_WECHAT_PLATFORM_PUBLIC_KEY`、`PAY_WECHAT_NOTIFY_URL`。

实现要点（`adapters/pay/wechat.ts`）：

- 请求签名串：`METHOD\nURL\nTIMESTAMP\nNONCE\nBODY\n`，商户私钥 RSA-SHA256 签名，放进 `Authorization: WECHATPAY2-SHA256-RSA2048 ...`。
- 回调验签：用平台公钥验 `Wechatpay-Signature`，签名串为 `timestamp\nnonce\nbody\n`。
- 回调解密：`AEAD_AES_256_GCM`，key 为 APIv3 Key，`associated_data`/`nonce` 取回调 resource 字段。
- 回调路由单独注册作用域并保留 **raw body**（`addContentTypeParser('application/json', { parseAs: 'string' })`），否则验签必然失败。

### 3.2 支付宝

环境变量：`PAY_ALIPAY_APP_ID`、`PAY_ALIPAY_PRIVATE_KEY`、`PAY_ALIPAY_PUBLIC_KEY`、`PAY_ALIPAY_NOTIFY_URL`。

实现要点（`adapters/pay/alipay.ts`）：

- 下单：公共参数 + 业务参数按 key 升序拼 `k=v&...`，RSA2（SHA256withRSA）签名，`sign_type=RSA2`。
- 异步通知：剔除 `sign`、`sign_type` 后用同样规则验签，金额按「元 → 分」换算并校验，防篡改。
- 返回 `success` / `fail` 纯文本，支付宝按此判定重试。

### 3.3 订单与对账

- `POST /pay/orders` 建单（金额单位为**分**），返回 `outTradeNo` 与前端拉起支付所需参数。
- `GET /pay/orders/:outTradeNo` 查单，状态机 `pending → paid → refunded/closed`。
- 回调幂等：以 `outTradeNo` 为唯一键，重复回调只更新状态，不重复记账。

> 测试覆盖：用运行时生成的 RSA 密钥对做「签名 → 验签」往返与「篡改后验签必须失败」，共 9 例，见 `services/api/test/adapters.test.ts`。

---

## 4. 定位与导航（高德 / 北斗）

环境变量：`MAP_PROVIDER`（`dev` \| `amap`）、`AMAP_KEY`。

- `POST /map/regeo { longitude, latitude }`：逆地理编码，返回结构化地址。
- `POST /map/route { origin, destination, mode }`：路径规划（驾车/步行/骑行）。
- 坐标系：入参按 WGS84 传，适配器内部按高德要求转 GCJ02（`dev` 适配器直接原样返回）。
- 北斗：定位硬件由端侧系统能力提供，只要把北斗模块输出的 WGS84 经纬度传进来即可，服务端不感知来源；如需北斗短报文，另接专用网关，不改现有契约。

---

## 5. 对象存储（S3 兼容：AWS S3 / Cloudflare R2 / 阿里云 OSS / MinIO）

环境变量：`STORAGE_PROVIDER`（`dev` \| `s3`）、`S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_PUBLIC_BASE_URL`。

- `POST /storage/presign`：服务端签名，客户端直传，不经过 API。
- key 规则：`u/{userId}/{key}`，天然按用户隔离。
- 自行实现 **SigV4** 预签名（不引 AWS SDK），兼容 S3 / R2 / OSS / MinIO。
- `publicUrl` 由 `S3_PUBLIC_BASE_URL` 拼出；配了 CDN 就填 CDN 域名。

---

## 6. 推送

| Provider | 环境变量 | 说明 |
|---|---|---|
| `dev` | — | 只记录日志，返回 accepted 数 |
| `jpush` | `JPUSH_APP_KEY`、`JPUSH_MASTER_SECRET` | 极光 REST API，Basic Auth，按 registration_id 批量下发，Android/iOS 同一份 payload |
| `fcm` | `FCM_SERVICE_ACCOUNT_JSON`、`FCM_PROJECT_ID` | HTTP v1：服务账号 JWT 换 access token，再逐个 token 发送 |

设备号通过 `POST /me/push-token` 上报，存 `push_tokens`；`POST /me/push-test` 给本人设备发一条测试消息。

---

## 7. AI（豆包 / OpenAI 兼容）

环境变量：`AI_PROVIDER`（`dev` \| `doubao` \| `openai`）、`AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`。

- `POST /ai/chat { messages, model?, temperature? }`：转发到 OpenAI 兼容 `/chat/completions`。
- 默认指向火山方舟 `https://ark.cn-beijing.volces.com/api/v3`，模型默认 `doubao-pro-32k`。
- 适配器只做协议转发与错误归一化，不缓存、不落库消息内容；涉及用户隐私的会话,应在业务侧另行约定留存策略。

---

## 8. 未配置时会怎样

| 能力 | 未配置行为 |
|---|---|
| 短信 | `console` 通道，日志 + `devCode` 回显 |
| OAuth | 对应 provider 不在 `/meta` 的 `on` 列表，端侧提示「未配置」 |
| 微信支付 / 支付宝 | 走 `dev` 支付适配器，生成模拟订单，不发起真实收款 |
| 地图 | `dev` 适配器返回可预测的假数据，便于端侧联调 |
| 存储 | `dev` 适配器返回本地占位 URL |
| 推送 | `dev` 适配器只记日志 |
| AI | `dev` 适配器返回固定文本 |

降级的意义是：`pnpm verify` 和端侧联调在任何机器上都能跑通，不需要采购或配置任何账号。
