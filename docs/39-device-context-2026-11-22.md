# 39 · 设备与网络快照契约（2026-11-22）

本文件冻结「设备与网络快照」的**唯一数据模型、字段来源、接口形状、降级与隐私边界**。
三端（原生壳 / H5 / 服务端）与后台都按本文件实现，任何一端自行改名或加字段都视为破坏契约。

---

## 1. 统一数据模型

一个快照，字段固定、命名固定（camelCase 传输，snake_case 落库）：

| 字段 | 类型 | 必填 | 来源 | 说明 |
| --- | --- | --- | --- | --- |
| `deviceId` | string | 是 | Android `Settings.Secure.ANDROID_ID`；取不到时持久 UUID；H5 用 localStorage 持久 UUID | 同一设备多次访问必须稳定不变；长度上限 64 |
| `model` | string | 否 | `Build.MODEL`；Web 从 UA 解析 | 取不到留空字符串，不填「未知」 |
| `osName` | string | 是 | `"Android"` / `"iOS"` / `"Web"` | H5 从 UA 判定 |
| `osVersion` | string | 否 | `Build.VERSION.RELEASE`；Web 从 UA 解析 | 取不到留空 |
| `ip` | string | 是 | **仅服务端**：`X-Forwarded-For` 首跳，缺失回落 socket 地址 | 前端不得上报、不得编造；入参里的 `ip` 一律忽略 |
| `networkType` | string | 是 | 原生 `ConnectivityManager`；H5 `navigator.connection.type` | 枚举 `wifi` / `cellular` / `ethernet` / `none`；未知按 `none` |
| `carrier` | string | 否 | 原生 `TelephonyManager.networkOperatorName` | 取不到留空字符串，不填「未知运营商」 |
| `updatedAt` | string(ISO8601) | 是 | 服务端写入时间 | 客户端上报的时间只作参考，不采信 |

约束：
- `ip` 只在服务端产生。客户端 POST 里带 `ip` 会被丢弃（防伪造）。
- `carrier` / `networkType` 在 Web 端不可靠，允许空字符串与 `none`，**不得编造**。
- 所有字符串字段裁剪到 64 字符以内后再入库。

## 2. 落库（迁移 `0021_device_context.sql`）

1. `refresh_tokens` 增列（全部 nullable，向后兼容）：
   `device_id`、`device_model`、`os_name`、`os_version`、`network_type`、`carrier`、`client_ip`。
   → 语义：**该次登录发生时**的设备与网络。
2. 新表 `user_devices`：
   `user_id`、`device_id`、`device_model`、`os_name`、`os_version`、`network_type`、`carrier`、`client_ip`、`updated_at`，主键 `(user_id, device_id)`。
   → 语义：该用户每个设备的**最近一次**快照（upsert），供后台「最近一次登录设备」与用户端展示。

## 3. 接口（均在 `/api/v1`，均为新增，不改既有字段语义）

### 3.1 登录写入（在既有登录路由上新增可选入参）
- `POST /auth/login/password`、`/auth/login/sms`、`/auth/login/oauth` 的 body 增加**可选** `device`：
  `{ deviceId, model?, osName?, osVersion?, networkType?, carrier? }`
- 服务端补 `ip` 后写入本次 `refresh_tokens` 行，并 upsert `user_devices`；`device` 缺省时行为与现在完全一致（老客户端不受影响）。`ip` 无论有无 `device` 都写（用于会话视图）。

### 3.2 上报 / 刷新当前快照（需登录）
- `POST /device/context`，body = 快照去掉 `ip` / `updatedAt` 的字段。
  响应：`{ data: { deviceId, model, osName, osVersion, ip, networkType, carrier, updatedAt } }`
  未登录 / 无效令牌 → `401 UNAUTHORIZED`（沿用既有鉴权中间件口径）。
- `GET /device/context?deviceId=<可选>`（需登录）只读查询；不传 `deviceId` 时返回该用户最近一条（按 `updated_at`）。
  无记录 → `200` + `data.device = null`（不报 404，避免前端分支出错）。

### 3.3 后台（沿用 `/admin/console/*` 的 Cookie 会话 + 404 口径）
- `GET /admin/console/users/:id/sessions`：返回该用户最近 N（默认 10）条 `refresh_tokens` 会话摘要，字段：
  `{ id(哈希前缀 8 位，不返原文), createdAt, revokedAt, deviceId, model, osName, osVersion, networkType, carrier, ip, lastSeenAt }`
  `lastSeenAt` = 该 deviceId 在 `user_devices` 的 `updated_at`（没有则回该会话 `created_at`）。
- 该接口只对后台会话开放；未登录 / 无 `x-mixm-console` 的写操作口径不变。

## 4. 原生桥（在既有 `MixmShell` 上扩展，不改已有方法）

新增 `@JavascriptInterface String getDeviceInfo()` 返回 JSON 字符串：

```json
{"deviceId":"...","model":"...","osName":"Android","osVersion":"...","networkType":"wifi","carrier":"China Mobile"}
```

- `deviceId`：`Settings.Secure.ANDROID_ID`；为空时读私有存储里的持久 UUID（首次生成后写入 `SharedPreferences`），保证稳定。
- `networkType`：`ConnectivityManager.getNetworkCapabilities` — `TRANSPORT_WIFI` / `TRANSPORT_CELLULAR` / `TRANSPORT_ETHERNET`，无网络 `none`。
- `carrier`：`TelephonyManager.getNetworkOperatorName()`，空则空串；无权限也不崩（try/catch）。
- 本方法**必须** try/catch 包裹，任何异常返回仍合法的 JSON（字段可为空），不能抛穿到 WebView。

## 5. H5 统一读取（`apps/app/src/device.ts`）

```ts
getDeviceSnapshot(): DeviceSnapshot   // 同步，纯本地，不含 ip
```

读取顺序：
1. `window.MixmShell?.getDeviceInfo?.()` 存在 → 解析其 JSON（失败则忽略）；
2. 缺字段用 UA 解析（`osName` 由 UA 判定 Android/iOS/Web，`osVersion` 取 `Android x.y` 或 `iPhone OS x_y`，`model` 尽力取）；
3. `deviceId`：原生值优先；否则用 localStorage key `mixmapp:device-id` 的持久 UUID（不存在则 `crypto.randomUUID()` 生成并写回；不可用环境退化为时间戳+随机串）。

**禁止**页面直接 import Capacitor 插件；没有原生壳时函数必须照常返回值（`networkType` 由 `navigator.connection?.type` 映射，取不到 `none`）。

## 6. 展示位置与隐私边界

- 用户端：`pages/me/index.vue` 的「设备与网络」信息块 + `pages/settings/about.vue` 一处摘要；**仅登录态**渲染，未登录显示「登录后查看」。设备号给一键复制，IP 与设备号用等宽字体 + 可长按选择，不做二维码、不外发。
- 后台：`pages/admin/index.vue` 用户详情/会话区，展示最近一次会话的设备号、IP、网络、系统与采集时间。
- 隐私：IP 与设备号只在「本人可见 + 后台可见」范围内；**不进任何公开页面、不进他对他人可见的接口响应**；服务端日志打印 IP 一律脱敏（IPv4 保留前两段 `1.2.*.*`，IPv6 保留前两组），设备号日志只打前 6 位。
- 不新增公开接口；`/device/context` 两个方法都要求登录。

## 7. 降级行为（三端一致）

| 场景 | 行为 |
| --- | --- |
| 无原生壳（纯 H5） | `osName=Web`、`model`/`carrier` 空、`networkType` 由 connection.type 映射，`deviceId` 用 localStorage UUID |
| 原生壳但取不到某字段 | 该字段空串或 `none`，不填假值，不崩 |
| 未登录 | 端上不展示设备块；服务端 `/device/context` 返回 401 |
| 后台未登录 | 404（既有口径），不泄露接口存在 |

## 8. 验收要求（证据，不接受口头完成）

1. AVD 截图：我的页设备块浅色 + 深色各一张、后台用户详情一张、H5 一张。
2. API 证据：上报与查询真实响应样例（含 `x-forwarded-for` 来源头）；未登录 / 无令牌的状态码。
3. 稳定性：同设备两次 `deviceId` 一致（两次响应）。
4. 网络切换：Wi-Fi ↔ 移动网络后 `networkType` 变化；模拟器做不到时如实写明并给替代证据。
5. 门禁：lint / typecheck / verify / h5 / mp-weixin / harmony；debug 与 release 重出；CI 三条绿；线上 H5 换包用新组件名做指纹。
6. 说明文档按 docs 编号习惯落盘（本文件 39，实施说明由实施线追加，不新建 40）。
