# 46 · 账号与个人数据生命周期：自助注销 / 最小留存 / 到期清理（2026-11-24）

- 规格冻结稿：`.tmp/spec-account-data-lifecycle.md`
- 唯一政策口径：`apps/app/src/pages/legal/privacy.vue`
- 版本常量：`apps/app/src/privacy.ts`（`PRIVACY_POLICY_VERSION = '2026-11-24.1'`）
- 记录日期：2026-11-24
- 本轮范围边界：落地「账号自助注销、服务端最小留存、定期到期清理」三条能力及其前端面板、契约、测试与政策同步；**不引入任何第三方 SDK、外链字体、CDN、云存储**。本轮未执行生产库迁移，未 push。

## 1. 一句话结论

本轮把此前「无自助注销入口、无自动清理任务」的缺口补齐：**已登录用户可在应用内分级校验后永久注销账号及服务端个人数据；服务端只保留履约 / 对账 / 合规 / 安全所必需的最小字段，个性化数据到期自动脱敏；另有一条与订单超时扫描完全独立的留存清理定时器按期限回收过期令牌、票据、快照与草稿。**

三条落地的完成状态：

| 落地 | 状态 | 主要落点 |
| --- | --- | --- |
| ① 用户可自助永久删除账号及服务端个人数据（不可恢复级联删除 + 全部会话立即失效） | 已完成（后端三接口 + 级联函数 + 前端注销页 + 测试） | `modules/account-deletion.ts`、`routes/account-delete.ts`、`infra/sql/0022_*.sql`、`pages/settings/account-delete.vue` |
| ② 服务端只保留履约与合规必需的最小字段，个性化数据到期自动脱敏 | 已完成（订单 / 支付留行脱敏；180 天到期脱敏任务；前端本机数据面板） | `modules/retention.ts`、`db/types.ts` 各 `anonymize*` / `purge*` 方法、`pages/settings/local-data.vue`、`storage-map.ts` |
| ③ 按留存期限的定期清理任务（幂等、可关闭、日志脱敏） | 已完成（独立定时器，7 类任务，第二轮全部 0 行，测试覆盖） | `modules/retention.ts`、`index.ts:87-95`、`test/retention.test.ts` |

## 2. 需求边界：为什么不是「零服务端数据」

本轮口径不是「个人数据全部只存设备」，那样会直接打断登录与下单链路：

- **账号凭证与登录会话必须在服务端**：密码哈希、刷新令牌、第三方绑定、设备快照是登录、多端在线、会话校验与风控的基础；纯设备端撑不起登录，也无法在其它设备上使已泄露会话失效。
- **交易订单是履约 / 对账凭证，不能整体只留设备**：订单号、金额、商品快照、时间、状态、支付流水要支撑售后、发货、对账与争议处理；设备丢失或更换后，履约凭证不能随之丢失。

因此拆成三条落地，本轮均按此口径实现：

1. **自助注销**：身份分级校验通过后，账号行与个人数据在服务端不可恢复级联删除，全部刷新令牌立即失效；客户端清空本地态并回登录页。
2. **最小留存 + 到期脱敏**：订单 / 支付不删行，只留交易凭证必需的最少字段；收货人姓名、电话、地址、备注等可识别字段在注销时立即清除，未注销账号的完结订单满留存期后自动不可逆脱敏。
3. **到期自动清理**：过期 / 已撤销令牌、过期 OAuth state、过期验证码、超期设备快照、超期购物车草稿、超期挑战票据按配置期限自动回收；任务可整体关闭，单任务失败不影响其它任务。

## 3. 自助注销实现

### 3.1 三个端点

统一前缀 `/me`，均挂 `app.requireAuth`；对外挂载在既有 `/api/v1` scope 下（测试请求路径为 `/api/v1/me/account/...`）。

| 端点 | 方法 | 作用 | 成功响应 |
| --- | --- | --- | --- |
| `/me/account/deletion-options` | GET | 返回当前账号可用的校验方式、掩码手机号、是否需要设备挑战 | `{ data: { methods: ['password','sms','device'], phone: '138****0000', requiresChallenge: true } }` |
| `/me/account/delete-challenge` | POST | 仅 `device` 方式：校验 deviceId 与最近设备快照一致后，下发一次性挑战票据 | `{ data: { challenge: '<票据>', expiresInSec: 300 } }` |
| `/me/account/delete` | POST | 逐字确认 + 分级身份校验通过后执行级联注销 | `{ data: { deleted: true, revokedSessions: 3, ordersAnonymized: 5, purged: { binds, devices, addresses, favorites, carts, pushTokens } } }` |

契约：`packages/contracts/src/index.ts` 的 `deleteAccountSchema`（`confirm` 为 zod 字面量 `'注销'`；`method ∈ password | sms | device`；`password / code / deviceId / challenge` 按方式可选），类型导出 `DeleteAccountInput`。

### 3.2 校验分级（服务端判定，前端不得自行放宽）

| 账号状态 | 可用方式 | 校验动作 |
| --- | --- | --- |
| 有 `passwordHash` | `password` | 校验当前密码哈希（`verifyPassword`） |
| 无密码、有绑定手机 | `sms` | 验证码发往绑定手机；复用现有 `smsCodes`，purpose 为新增的 `'delete'`（`app.ts:163` 注入 `verifySms: (phone, code) => app.auth.verifySmsCode(phone, 'delete', code)`） |
| 无密码、无手机（含游客 / 仅 OAuth） | `device` | deviceId 与 `user_devices` 最近快照严格比对；不一致返回 `DELETE_DEVICE_MISMATCH`；一致后换取绑定 `(userId, deviceId)` 的一次性票据，5 分钟过期、单次有效 |

兜底说明：有最近快照时做严格设备匹配；**没有任何快照**（游客 / 未带设备上下文的 OAuth 账号）时不做快照比对，设备一致性由票据绑定 `(userId, deviceId)` 兜底（`account-deletion.ts:82-103`、`158-176`）。`methods` 顺序固定 `password → sms → device`，`device` 恒存在兜底。

### 3.3 错误码与 HTTP 状态

错误码与状态映射在 `services/api/src/lib/errors.ts:36-42`；校验阶段任何失败都直接抛出，**不进入级联删除、不改动任何数据**。

| 错误码 | HTTP 状态 | 触发条件 | 是否改数据 |
| --- | --- | --- | --- |
| `DELETE_CONFIRM_REQUIRED` | 422 | `confirm` 不是逐字「注销」；路由层先于 zod 通用校验拦截，保证固定错误码 | 否 |
| `DELETE_VERIFY_FAILED` | 401 | 密码错误，或短信验证码错误 / 已过期（登录口径的 `CODE_INVALID` / `CODE_EXPIRED` 收敛为此码） | 否 |
| `DELETE_CHALLENGE_REQUIRED` | 422 | device 方式缺少票据或 deviceId | 否 |
| `DELETE_CHALLENGE_INVALID` | 410 | 票据无效、已使用、已过期，或票据归属用户 / 设备不匹配 | 否 |
| `DELETE_DEVICE_MISMATCH` | 422 | 携带的 deviceId 与最近登录设备快照不一致（挑战阶段或删除阶段均可触发） | 否 |
| `DELETE_METHOD_NOT_ALLOWED` | 403 | 请求方式不在该账号可用集合内（如邮箱账号走短信方式） | 否 |
| `ACCOUNT_ALREADY_DELETED` | 404 | 账号不存在 / 已注销；重复调用返回明确错误而非 500 | 否（账号已不存在） |

### 3.4 单事务级联：`delete_account` plpgsql 函数

级联实现在 `infra/sql/0022_account_deletion_retention.sql:54-135` 的 `delete_account(p_user_id)` 函数，返回 jsonb 各类清除 / 脱敏条数，供接口响应与对账使用。

**为什么用数据库函数而不是应用层多语句：**

- 经 CloudBase PG 网关时，一次 `mix_exec` 调用即一个事务；应用层多条语句桥接执行，中途失败会留下「令牌已删、地址未删」之类的中间态。把级联收进函数体，函数内单事务提交，天然规避多语句桥接下的半成品状态。
- 直连 PG 同样在函数内单事务提交；函数内各语句幂等（`if not exists` / `if exists` / `drop constraint if exists`），重复执行无副作用。
- PG 实现 `postgres.ts:379-411` 调用 `select delete_account($1) as result`，解析返回 jsonb；内存库 `memory.ts:170-197` 无事务，按同一口径顺序执行作为测试夹具实现。

函数内执行顺序与口径：

1. **订单留行脱敏**：`user_id` 置空；`receiver_name / receiver_phone / address` 清空，`remark` 置 null，`address_id` 置 null；商品快照（`order_items`）、金额、优惠、时间戳、状态、取消原因与发起方保留不动。
2. **支付留行对账**：`payments.user_id` 置空；流水号、金额、渠道、主题保留。
3. **物理删除**：`bindings` → `refresh_tokens` → `user_devices` → `mall_addresses` → `mall_favorite_items` → `mall_favorite_folders` → `carts` → `push_tokens` → `order_requests` → `deletion_challenges`，最后删除 `users` 账号行本身。子表已清、订单 / 支付已置空 `user_id`，不依赖外键级联兜底。
4. 0022 同时把 `orders / payments` 的 `user_id` 改为可空并改为 `on delete set null`；`users` 增加可空 `deleted_at` 仅供审计 / 后台统计展示，物理删除后该行不保留任何 PII。

## 4. 留存字段清单

### 4.1 注销后仍留在服务端的字段与理由

| 留行实体 | 保留字段 | 保留理由 |
| --- | --- | --- |
| `orders`（订单留行） | 订单号 `order_no`；金额（含优惠与实付）；商品快照（productId / 标题 / 数量 / 单价，见 `order_items`）；下单 / 支付 / 发货 / 完成时间；订单状态；取消原因与取消方 | 履约、售后、发货与对账凭证；设备端不可独立承担 |
| `payments`（支付留行） | 支付流水号 `out_trade_no / transaction_id`；金额；渠道；主题 | 支付对账、争议与退款核查 |
| 订单 / 支付归属 | `user_id` 置空（不再可识别到个人）；未注销账号到期脱敏时 `user_id` 仍保留归属，历史订单可在「我的订单」查看（`retention.test.ts:260-270`） | 对账归属与本人历史订单视图 |
| `account_merges` 合并快照 | 账号合并审计记录 | 账号合并操作审计，按规格保留，不随注销清除（见第 10 节待办） |
| `admin_audit_logs` | 后台写操作审计历史（操作者、IP、浏览器标识，IP / 设备号已脱敏） | 合规审计与安全追溯，按规格保留，不随注销清除 |
| 运行日志 | 容器标准输出访问日志；IP 与设备号已脱敏；保留天数由部署环境日志轮转决定 | 运维排障与安全追溯；仓库内不固定天数 |

### 4.2 注销时已删除或不可逆脱敏的字段

| 实体 / 字段 | 处置 |
| --- | --- |
| `users` 账号行 | 物理删除：昵称、头像、简介、用户名、手机号、邮箱、密码哈希、隐私同意版本 / 时间 / 通道 / 来源一并消失 |
| `bindings`（OAuth 绑定） | 物理删除全部渠道绑定与 openId / unionId 关联 |
| `refresh_tokens` | 物理删除全部刷新令牌；现有与后续会话立即失效，旧令牌换取新令牌返回 401 |
| `user_devices` 设备快照 | 物理删除机型、系统、网络、运营商、IP 等全部快照 |
| `mall_addresses` 地址簿 | 物理删除收货人姓名、手机号、省市区、详细地址、默认标记 |
| `mall_favorite_items / folders` 收藏 | 物理删除全部收藏条目与收藏夹 |
| `carts` 购物车 | 物理清空该用户购物车行 |
| `push_tokens` 推送令牌 | 物理删除 |
| `order_requests` 下单幂等占位 | 物理删除 |
| `deletion_challenges` 挑战票据 | 物理删除 |
| `orders` 可识别字段 | 收货人姓名、手机号、地址文本、备注、地址簿引用不可逆清空 |
| `payments` 归属 | `user_id` 置空；不保留与个人的直接关联 |

### 4.3 到期自动脱敏口径（180 天）

- 未注销账号：已完结（`completed` / `cancelled`）订单的完结时间早于 `RETENTION_ORDER_PII_DAYS`（默认 **180 天**）后，收货可识别字段自动不可逆脱敏；金额、商品快照、状态、时间、流水号保留，`user_id` 保留归属。
- 注销账号：收货 PII 在注销时**立即**脱敏，不等到期。
- 待支付 / 进行中订单的 PII 原样保留（`retention.test.ts:274-279`）。

### 4.4 服务端个性化数据本地化的现状（据实，不美化）

- 本轮新增「本机数据」自助面板与本机存储登记映射（`storage-map.ts`），登录态、同意记录、设备标识、主题偏好、一次性跳转参数、启动信息、调试基址覆盖均登记为本机项。
- 既有服务端个性化数据（收藏、购物车、地址簿、设备快照）**本轮未整体迁机**：它们仍留服务端以支撑多端同步、下单结算与地址回显。搜索历史、浏览记录、购物车草稿三类当前**还没有落本机的 key**，面板先保留分类位，后续新增本机草稿时在 `storage-map.ts` 补登记即可（`storage-map.ts:74-78` 注释）。

## 5. 留存清理任务

`RetentionService`（`modules/retention.ts`）与订单超时扫描是**两条独立定时器**：`index.ts:75-85` 为待支付订单每分钟超时取消（订单状态流转）；`index.ts:88-95` 为个人数据留存清理，按 `sweepMinutes` 周期驱动，两条均 `timer.unref()`。`RETENTION_SWEEP_MINUTES=0` 时 `retention.enabled` 为 false，不注册定时器。

| 任务名 | 环境变量 | 默认值 | 清理对象 | 幂等 / 关闭 |
| --- | --- | --- | --- | --- |
| `refreshTokens` | `RETENTION_REFRESH_TOKEN_DAYS` | 7 天 | 已过期或已撤销的 `refresh_tokens` 行物理删除 | 幂等；第二轮 0 行 |
| `oauthStates` | `RETENTION_OAUTH_STATE_DAYS` | 1 天 | 已消费或已过期的 `oauth_states` | 幂等；第二轮 0 行 |
| `smsCodes` | `RETENTION_SMS_CODE_DAYS` | 7 天 | 已消费 / 已过期短信验证码 | 幂等；第二轮 0 行 |
| `userDevices` | `RETENTION_DEVICE_SNAPSHOT_DAYS` | 180 天 | `updated_at` 早于期限且无活跃会话的设备快照 | 幂等；第二轮 0 行 |
| `carts` | `RETENTION_CART_DAYS` | 90 天 | 超过期限未变动的购物车行 | 幂等；第二轮 0 行 |
| `ordersPii` | `RETENTION_ORDER_PII_DAYS` | 180 天 | 已完结且超期订单的收货可识别字段脱敏 | 幂等；第二轮 0 行 |
| `deletionChallenges` | `RETENTION_DELETION_CHALLENGE_DAYS` | 1 天 | 已消费 / 已过期的注销挑战票据 | 幂等；第二轮 0 行 |
| 总开关 | `RETENTION_SWEEP_MINUTES` | 360 分钟 | 扫描周期；`0` 关闭整体任务 | 关闭后不注册定时器 |

其它要求的实现口径：

- **幂等**：连跑两轮，第二轮各任务影响行数全部为 0（`retention.test.ts:282-289`）。
- **单任务隔离**：某个任务抛错只记 `-1` 并打错误概要，不中断后续任务（`retention.ts:55-67`）。
- **日志脱敏**：日志只带任务名与影响行数（失败时带错误概要），绝不输出手机号、地址、令牌、用户 id 等标识。
- **不触碰订单状态流转**：本任务只做数据回收 / 脱敏，不改订单状态、不扣减或归还库存。

## 6. 前端实现

### 6.1 注销页 `pages/settings/account-delete.vue`

交互流程：

1. 进入页面先调 `GET /me/account/deletion-options` 读取可用方式；多方式时按 `password → sms → device` 渲染切换标签。
2. **密码方式**：输入当前密码。
3. **短信方式**：展示掩码绑定手机，点「获取验证码」以 purpose `delete` 发送，60 秒倒计时；开发态返回 `devCode` 时展示开发码提示。
4. **设备确认方式**：读取最近设备快照（机型 / 系统 / 网络 / 最近在线）；无快照时提示确认当前设备即常用设备；点「确认本机为最近登录设备」换取一次性挑战票据，票据就绪前不可提交。
5. **二次确认**：必须逐字输入「注销」；前端本地校验先拦一道，服务端 `DELETE_CONFIRM_REQUIRED` 兜底。
6. 成功后：清空本机令牌、账号缓存与后台令牌，重置内存会话；弹窗告知失效会话数与脱敏订单数，确认后 `reLaunch` 回登录页。

错误码 → 中文提示映射（`account-delete.vue:195-204`），校验类失败保留输入供原地重试，不删数据：

| 错误码 | 页面提示 |
| --- | --- |
| `DELETE_CONFIRM_REQUIRED` | 确认口令不正确，请逐字输入「注销」后再提交。 |
| `DELETE_VERIFY_FAILED` | 密码或验证码不正确，未删除任何数据；请核对后原地重试。 |
| `DELETE_CHALLENGE_REQUIRED` | 设备校验票据缺失，请先完成本机设备确认。 |
| `DELETE_CHALLENGE_INVALID` | 设备校验票据已过期或失效，请重新发起设备确认。 |
| `DELETE_DEVICE_MISMATCH` | 当前设备与最近登录设备不一致，无法通过设备校验。 |
| `DELETE_METHOD_NOT_ALLOWED` | 当前账号不支持该校验方式，请更换可用方式。 |
| `ACCOUNT_ALREADY_DELETED` | 账号已注销或不存在，请返回登录页重新登录。 |
| `NETWORK` | 网络异常，请稍后重试。 |

页面同时前置披露「服务端仍保留的订单凭证」清单与四条注销后果（账号永久删除不可恢复、全部会话立即失效、订单仅留最小凭证字段、本机登录态清空）。

### 6.2 本机数据面板 `pages/settings/local-data.vue`

- **纯本地、不依赖网络**：扫描与清理全部走本机存储（uni 存储 / WebView localStorage / Capacitor Preferences 兜底），页面无任何接口请求；占用按字符串长度估算，页面明示与系统实际占用可能存在偏差。
- 按分类展示条目数与估算占用，支持「清理本类」单类清理与「一键清空」；清理登录态后同步重置内存会话。
- 后果前置明示：清理「登录态」后需要重新登录；清理「隐私同意记录」后下次注册或相关流程会重新征得同意；一键清空会清除全部分类本机记录，服务端账号与订单不受影响。

### 6.3 存储 key → 分类映射（`storage-map.ts` 如实列出）

| 存储 key | 分类 | 通道 | 条目名 |
| --- | --- | --- | --- |
| `mixmapp:tokens` | 登录态 | uni | 登录凭证（访问 / 刷新令牌） |
| `mixmapp:user` | 登录态 | uni | 本机缓存的账号资料 |
| `mixmapp:adminToken` | 登录态 | uni | 后台管理令牌 |
| `mixmapp:privacy-consent` | 隐私同意记录 | local、preferences | 隐私同意记录 |
| `mixmapp:device-id` | 其它本机数据 | local、uni | 设备标识 |
| `mixmapp:deviceId` | 其它本机数据 | uni | 游客设备标识 |
| `mixmapp:theme` | 其它本机数据 | local | 主题偏好 |
| `mixmapp:tabQuery` | 其它本机数据 | uni | 一次性跳转参数 |
| `mixmapp:lastLaunch` | 其它本机数据 | uni | 上次启动信息 |
| `mixmapp:apiBase` | 其它本机数据 | uni | 调试 API 基址覆盖 |

分类元信息与后果文案见 `STORAGE_CATEGORY_META`（登录态 / 隐私同意记录 / 搜索历史 / 浏览记录 / 购物车草稿 / 其它本机数据）。**事实：搜索历史、浏览记录、购物车草稿三类当前还没有落本机的 key**，分类位先保留，后续补登记后面板自动出现对应条目。

### 6.4 路由与入口

- `routes.ts:22-23` 新增 `accountDelete: '/pages/settings/account-delete'`、`localData: '/pages/settings/local-data'`；`pages.json:57-64` 注册两条页面，导航标题沿用现有 `MixmAPP` 写法。
- 入口放在隐私政策第九节两行链接（`privacy.vue:197`「打开本机数据面板」、`:202`「进入注销账号页」）。按规格未改 `me/index.vue`、`settings/about.vue`（两文件属并行改版线，详见第 9、10 节）。

## 7. 隐私政策同步

### 7.1 第八节「保存期限与安全」（`privacy.vue:153-177`）

五条口径与实现对齐：

- **登录凭证**：「过期或已撤销的登录凭证在服务端留存 7 天后自动删除（默认值，可由部署配置调整）；退出登录即在本机清除，服务端只保存凭证哈希，不保存原文。应用已关闭系统自动备份，避免凭据随设备迁移被带出。」
- **设备与网络快照**：「每账号每设备仅保留最近一次，新快照覆盖旧快照；超过 180 天未使用的快照自动删除；账号注销时立即删除。」
- **同意记录**：「本机记录与账号记录同步保存，用于证明同意发生在何时、哪个版本；随账号存续保留，账号注销即删除。」
- **订单与收货信息**：「为履约、售后与对账保留；订单完结满 180 天后，收货人姓名、电话、地址、备注等信息自动不可逆脱敏；账号注销时立即脱敏。」
- **运行日志**：沿用原文（IP 与设备号已脱敏；保留天数由部署环境日志轮转决定，仓库内无固定天数配置）。

### 7.2 第九节「你的权利」（`privacy.vue:179-212`）

- **删除**行补本机数据面板入口：「收藏、购物车条目与收货地址可在对应页面直接删除；本机保存的搜索、浏览记录、草稿及其它本机数据，可在『本机数据』自助面板中分类清理。」附「打开本机数据面板」链接。
- **注销账号**行改为：「应用内『注销账号』页可自助永久删除账号及其服务端个人数据；需二次确认与身份校验；注销后订单仅保留交易凭证必需字段（订单号、金额、商品、时间、状态），收货人姓名、电话、地址、备注等不可识别化删除，全部登录会话立即失效。」附「进入注销账号页」链接。

### 7.3 版本号 bump 决定

`PRIVACY_POLICY_VERSION` 从 `'2026-11-24'` 改为 **`'2026-11-24.1'`**（`privacy.ts:23`）。

- **理由一**：同日第二次实质修订——第八节留存期限、第九节注销权利与本轮实现对齐，旧版本同意记录按等值比较口径随即失效，需要用户在下次相关流程重新同意。
- **理由二**：避免与并行改版线撞号——另一条改版线也在同日改动政策页，`.1` 后缀把本轮修订与该线区分开。
- **比较方式**：版本号只做等值比较（`hasPrivacyConsent` / `resolvePrivacyConsent` 用 `version === PRIVACY_POLICY_VERSION` 判断），格式安全，不做语义化解析。
- **未动项**：`PRIVACY_GATE_MODE` 仍为 `'register'`（注册环节征得同意），本轮未改门禁模式。

## 8. 验证证据

以下为门禁命令的真实结果，数字未改动。

### 8.1 `node scripts/repo-lint.mjs`

- 退出码 **1**；共 **96 处红点，全部位于 `tools/hznzcn-importer/`**（本地草稿，本轮之前既存）。
- 本轮文件（`services/api/**`、`packages/contracts`、`infra/sql/0022`、`apps/app` 三个新文件 + `client.ts / routes.ts / pages.json / privacy.ts`）**零命中**。
- `apps/app/src/pages/mall/index.vue:687` 那条历史红点（调试 `console.log`）属并行改版线，本轮未触碰也未修。

### 8.2 `pnpm typecheck`

- `packages/ids` **Done**；`packages/contracts` **Done**；`services/api` **Done**；`apps/app` **Failed**。
- `apps/app` 共 **4 个错误**：
  - `src/components/mx-icon/mx-icon.vue(38,7)`、`(38,27)`、`(39,22)` 三个；
  - `src/pages/legal/privacy.vue(286,26)` `TS2554` 一个。
- 已用 `git diff` 证实：`mx-icon` 是并行改版线新建的未跟踪组件；`privacy.vue:286` 的 `jumpTo/selectViewport().scrollOffset()` 是并行改版线新增代码；**均非本轮改动**。
- 工作区实际参与 typecheck 的是 **4 个包**（`apps/app`、`services/api`、`packages/contracts`、`packages/ids`），不是 5 个，按实记录。

### 8.3 `pnpm test`

- 退出码 **0**。
- `services/api`：**Test Files 19 passed | 1 skipped (20)**；**Tests 182 passed | 9 skipped (191)**。
- `packages/ids`：**11 passed**。
- `packages/contracts`：无测试文件。
- 基线 **169 passed / 8 skipped** 已被超过，无回归。
- 本轮新增测试：`test/account-deletion.test.ts`（密码 / 短信 / 设备 / 游客兜底四条链路级联删除与脱敏、令牌失效、重复调用 404、校验失败不删数据、可选性查询）；`test/retention.test.ts`（首轮清理到期数据并保留活跃 / 近期数据，第二轮全部 0 行幂等）。

### 8.4 `node scripts/build-h5.mjs`

- 退出码 **0**；产物输出 **"DONE Build complete."**。

## 9. 本轮变更文件清单

### 9.1 新增文件

| 路径 | 内容 |
| --- | --- |
| `infra/sql/0022_account_deletion_retention.sql` | 外键可空 + `on delete set null`、`deleted_at`、`deletion_challenges` 表与索引、留存辅助索引、`delete_account` 级联函数 |
| `services/api/src/modules/account-deletion.ts` | 注销服务：可选方式、设备挑战票据、分级校验、级联调用与错误码 |
| `services/api/src/modules/retention.ts` | 留存清理服务：7 类任务扫描、幂等、单任务隔离、日志脱敏、总开关 |
| `services/api/src/routes/account-delete.ts` | 注销三端点路由（`requireAuth` + 请求体校验） |
| `services/api/test/account-deletion.test.ts` | 注销级联 / 令牌失效 / 校验失败不删数据测试 |
| `services/api/test/retention.test.ts` | 清理任务首轮回收 + 第二轮幂等测试 |
| `apps/app/src/pages/settings/account-delete.vue` | 注销页：后果与凭证清单、分级校验、逐字确认、成功清本地态 |
| `apps/app/src/pages/settings/local-data.vue` | 本机数据面板：分类扫描、单类清理、一键清空 |
| `apps/app/src/storage-map.ts` | 本机存储 key → 分类映射、扫描 / 清理辅助与占用估算 |

### 9.2 修改文件

| 路径 | 本轮改动 | 提交注意 |
| --- | --- | --- |
| `packages/contracts/src/index.ts` | 新增 `deleteAccountSchema` 与 `DeleteAccountInput` 类型 | 与他线改动叠加，提交时逐 hunk 剥离 |
| `services/api/src/app.ts` | 装配 `deletion` / `retention` 服务，注册注销路由；短信校验注入 `'delete'` purpose | 本轮独占（改前无他线改动） |
| `services/api/src/config.ts` | `retention` 配置段类型与 8 个 env 默认值 | 本轮独占（改前无他线改动） |
| `.env.example` | 补登 `RETENTION_*` 共 8 个变量的注释样例与默认值 | 本轮独占（改前无他线改动） |
| `services/api/src/index.ts` | 新增独立留存清理定时器（`unref`，`enabled` 判关） | 本轮独占（改前无他线改动） |
| `services/api/src/db/types.ts` | Store 新方法签名：`accountChallenges`、`accountDeletion`、各 `deleteByUser`、`purgeStale`、`anonymizeByUser`、`anonymizeStaleCompleted` | 本轮独占（改前无他线改动） |
| `services/api/src/db/postgres.ts` | PG 实现：挑战票据消费 / 回收、`delete_account` 函数调用解析、各级联与留存 SQL | 本轮独占（改前无他线改动） |
| `services/api/src/db/memory.ts` | 内存库对应实现（测试夹具口径） | 本轮独占（改前无他线改动） |
| `services/api/src/db/gateway.ts` | 网关 `delete_account` 函数名 schema 前缀替换 | 本轮独占（改前无他线改动） |
| `services/api/src/lib/errors.ts` | 7 个注销错误码与 HTTP 状态映射 | 本轮独占（改前无他线改动） |
| `apps/app/src/api/client.ts` | 注销相关类型与 `accountApi` 三方法（`deletionOptions / deleteChallenge / delete`） | 本轮独占（改前无他线改动） |
| `apps/app/src/routes.ts` | 两条新路由常量 | 本轮独占（改前无他线改动） |
| `apps/app/src/pages.json` | 两条新页面注册 | 本轮独占（改前无他线改动） |
| `apps/app/src/privacy.ts` | 版本号 `'2026-11-24'` → `'2026-11-24.1'`；`PRIVACY_GATE_MODE` 未动 | 本轮独占（改前无他线改动） |
| `apps/app/src/pages/legal/privacy.vue` | 第八、九节口径与两条入口链接（s9 / s10 两节） | **见下方纠缠说明，本轮不单独提交** |

### 9.3 `privacy.vue` 与并行改版线的 hunk 纠缠

该文件工作区 diff 为 **211 插入 / 63 删除，16 个 `@@` 块**，其中绝大多数属并行改版线（id 属性、TOC、`jumpTo/selectViewport` 等改动）；本轮的 s9 / s10 两节改动与他线的 id 属性 / TOC 改动**相邻，无法用 `git add` 干净剥离**。按提交纪律，本文件本轮**不单独提交**，留待 Main 裁决：要么由 Main 在两条线之间拆分 hunk，要么随并行线整体提交时复核本轮两节口径未被覆盖。

## 10. 待拍板 / 后续项（据实列出）

1. **`apps/app` 的 4 个 typecheck 红点属并行线**：`mx-icon.vue` 三个与 `privacy.vue:286` 一个，需该线修绿后才能满足「全绿」门禁；本轮未代改。
2. **`privacy.vue` 提交剥离问题**：见 9.3，留待 Main 裁决拆分或随并行线复核。
3. **生产库迁移未执行**：0022 脚本需 `RUN_MIGRATIONS=1` 或经管理面在生产库执行；本轮只在测试夹具与内存 / PG 实现上验证，未跑生产库。
4. **注销入口层级**：目前入口只放在隐私政策第九节两行；`me/index.vue` 与 `settings/about.vue` 因属并行改版线，本轮未加二级入口。是否在「我的」页或设置页补入口，待 Main 定。
5. **审计 / 合并快照保留**：`account_merges` 快照与 `admin_audit_logs` 审计历史按规格保留、不随注销清除；其中合并快照可能残留次账号标识文本，是否进一步脱敏需后续评估。
6. **网关计数口径**：经 CloudBase PG 网关时，普通 `deleteByUser` 的行数取 `rows.length` 可能偏小；注销级联计数以 `delete_account` 函数返回的 jsonb 为准，不依赖桥接语句的行数回填。
7. **OAuth 重新授权未实现**：作为无密码无手机账号的等价校验方式，本轮未接入「重新授权换 openId」复核；当前以设备一次性票据兜底。
8. **`.env.example` 补登已完成**：`RETENTION_SWEEP_MINUTES`、`RETENTION_REFRESH_TOKEN_DAYS`、`RETENTION_OAUTH_STATE_DAYS`、`RETENTION_SMS_CODE_DAYS`、`RETENTION_DELETION_CHALLENGE_DAYS`、`RETENTION_DEVICE_SNAPSHOT_DAYS`、`RETENTION_CART_DAYS`、`RETENTION_ORDER_PII_DAYS` 已连同注释与默认值写入 `.env.example`，与 `config.ts` 的默认值一致（不再是待办项）。
9. **本地化缺口**：搜索历史、浏览记录、购物车草稿尚无本机落盘 key；既有收藏 / 购物车 / 地址 / 快照仍留服务端支撑多端与下单，是否进一步本地化需结合多端一致性需求另议。
