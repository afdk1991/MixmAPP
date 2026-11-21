# 42 · 设备与网络快照实施说明（2026-11-22）

> 契约冻结件：`docs/39-device-context-2026-11-22.md`（数据模型 / 接口形状 / 隐私边界以 39 为准）。
> 本文件只记录**落地位置、字段口径、复跑命令与证据索引**；与 39 冲突时以 39 为准。
> 本轮为纯新增：不改既有协议字段语义、不动域名与版本号、不做原生重写，改动可按文件回退。

## 1. 结论与本轮范围

**一句话结论**：「设备与网络快照」已在原生壳、H5、服务端、后台四线按契约 39 落地——端上采集本地可见字段，服务端补 IP 与采集时间，本人「我的 / 关于」页与后台会话视图按权限展示；本机内存驱动实例已跑通 API 取证（401 / 200 / 稳定性 / 伪造 IP 剥离 / 后台 404），AVD 装机截图、线上 H5 联调、后台会话视图、出包哈希、CI 三绿与线上换包指纹证据均已归档，见 §8 证据索引表。

本轮覆盖范围：

| 线 | 落点 |
| --- | --- |
| 用户端 H5 / 小程序 / 鸿蒙共用页面 | 「我的」页设备与网络信息块、设置 / 关于页本机信息摘要、管理后台用户会话视图 |
| API 层 | `POST /device/context`、`GET /device/context` 两个只读 / 上报接口；登录三路（密码 / 短信 / OAuth）可选携带 `device`；后台会话摘要端点 |
| 原生壳 | `MainActivity.java` 既有 `MixmShell` 桥扩展 `getDeviceInfo()`，无壳环境 H5 自动降级 Web 值 |
| 存储 | 迁移 `infra/sql/0021_device_context.sql`：`refresh_tokens` 增 7 个 nullable 列，新表 `user_devices` |

范围外：未改既有登录 / 注册 / 订单等接口的响应字段；未新增公开接口；未申请新权限；未 commit（与并行发布线保持独立可回滚）。

## 2. 字段口径（8 个固定字段）

快照字段名固定（camelCase 传输，snake_case 落库），来源端与取不到时的表现如下；`ip`、`updatedAt` **只由服务端产生**，客户端 schema 不含这两个字段，上报即被 zod 剥离。

| 字段 | 来源端 | 取值规则 | 取不到时的表现 |
| --- | --- | --- | --- |
| `deviceId` | 原生：`Settings.Secure.ANDROID_ID`；H5：localStorage 持久 UUID | 原生 ANDROID_ID 为空 / 异常时回落私有 SP（`mixmapp_shell` / `device_id`）持久 UUID；H5 读 localStorage key `mixmapp:device-id`，无则 `crypto.randomUUID()` 生成并写回，不可用退化为时间戳(36 进制)-随机串；裁剪 64 字符 | 仍取不到返回空串，不编造；同一设备多次访问以持久化值为准，稳定不变 |
| `model` | 原生：`Build.MODEL`；Web：UA 解析 | H5 从 Android UA `Android x.y; <机型>` / iOS UA `iPhone/iPad 型号` 尽力截取；trim 后裁剪 64 字符 | 空串 `""`，界面显示 `—`，不填「未知」 |
| `osName` | 原生：固定 `"Android"`；Web：UA 判定 | 只认 `Android` / `iOS` / `Web`；服务端归一化时其余值降级 `Web` | 兜底 `Web` |
| `osVersion` | 原生：`Build.VERSION.RELEASE`；Web：UA 解析 | Android 取 `Android ([0-9.]+)`；iOS 取 `iPhone OS ([0-9_]+)`，`_` 替换为 `.` | 空串 `""` |
| `ip` | **仅服务端** | 取 `X-Forwarded-For` 首跳（Nginx 反代已注入），缺失回落 `request.ip`；客户端 body / query 里的同名 `ip` 不进 schema，一律剥离，不落库 | 取不到为空串；前端不产出、不上报、不编造 |
| `networkType` | 原生：`ConnectivityManager` capabilities；H5：`navigator.connection?.type` | 枚举 `wifi` / `cellular` / `ethernet` / `none`；未知传输层与取不到连接信息一律 `none`，不在枚举内不归一为其它值 | `none`（界面显示「未连接」） |
| `carrier` | 原生：`TelephonyManager.getNetworkOperatorName()`；Web 无对应 API | trim 后裁剪 64 字符；未申请 `READ_PHONE_STATE`，无权限时系统返回空串 | 空串 `""`；我的页运营商行为空则整行隐藏，不写「未知运营商」 |
| `updatedAt` | **仅服务端** | 服务端写入时间（`new Date()` → ISO8601）；客户端上报的时间只作参考、不采信 | 服务端落库时刻即采集时间 |

字段校验 schema：`packages/contracts/src/index.ts` `deviceContextSchema`（L150–157），`deviceId` 非空且 ≤64，其余字段可选并裁剪长度；`ip` / `updatedAt` 不在 schema 内。

## 3. 三端落点（文件 + 行号）

### 3.1 原生壳

文件：`apps/mobile/android/app/src/main/java/top/mixm/app/MainActivity.java`（纯新增，既有 `notifyTheme` / `notifyThemePref` 桥方法签名与行为未改）。

| 位置 | 行号 | 说明 |
| --- | --- | --- |
| `import SharedPreferences` / `TelephonyManager` / `java.util.UUID` | L7 / L20 / L54 | 持久设备号、运营商读取、回落 UUID 生成 |
| `SHELL_PREFS_NAME = "mixmapp_shell"` / `PREF_DEVICE_ID = "device_id"` | L83 / L84 | 私有 SP 文件名与 key，与既有版本提示 SP（`"mixmapp"`）分文件 |
| `@JavascriptInterface getDeviceInfo()` | L848–863 | 挂在既有 `ShellBridge`（`addJavascriptInterface` 名 `MixmShell`）；整体 try/catch，异常回 `fallbackDeviceJson()`，不抛穿到 WebView |
| `resolveDeviceId()` | L873–896 | ANDROID_ID → SP 持久 UUID；SP 也不可用返回空串 |
| `resolveNetworkType()` | L903–919 | `getActiveNetwork()` + `getNetworkCapabilities`，按 `TRANSPORT_WIFI / CELLULAR / ETHERNET` 映射；无网 / 未命中 / 异常 → `none`；未使用已废弃的 `getType()` 唯一路径 |
| `resolveCarrier()` | L925–936 | 运营商名；null / 异常 → 空串 |
| `safeDeviceString()` / `fallbackDeviceJson()` | L939–941 / L944–956 | 系统属性归一化；全链路异常兜底 JSON（六字段齐全，失败字段空串 / `none`） |

未改 `AndroidManifest.xml`，未新增权限；既有 Manifest 仅 `INTERNET` / `ACCESS_NETWORK_STATE`，minSdk 23。

### 3.2 服务端

| 文件 | 行号 | 说明 |
| --- | --- | --- |
| `infra/sql/0021_device_context.sql` | L10–16；L26–37；L50 | `refresh_tokens` 增 7 个 nullable 列；新表 `user_devices`，主键 `(user_id, device_id)`；索引 `user_devices_user_idx`；全部 `if not exists`，幂等可重放 |
| `packages/contracts/src/index.ts` | L150–157；L159–163；L165–169；L171–176；L258 | `deviceContextSchema`；密码 / 短信 / OAuth 三路登录 schema 可选 `device`；`DeviceContextInput` 类型 |
| `services/api/src/lib/device-context.ts` | L59–68；L71–76；L79–89；L92–95 | 归一化；`clientIpOf()`（XFF 首跳 → `request.ip`）；`maskIp()` / `maskDeviceId()` 日志脱敏 |
| `services/api/src/modules/device.ts` | L24–70 | `DeviceContextService`：`record()` upsert 快照（L28–43）、`latest()` 只读查询（L46–50）、`toDto()` 记录 → DTO（L53–64） |
| `services/api/src/routes/device.ts` | L11–21；L23–28 | `POST /device/context`（`requireAuth`，上报后回写快照）；`GET /device/context?deviceId=<可选>`（无记录 `data.device = null`，不 404） |
| `services/api/src/modules/auth.ts` | L666–714 | `issueTokens()`：令牌行写设备 / IP 列（L679–693），有 `device` 时 upsert `user_devices`（L695–707）；不传 `device` 行为与旧版一致 |
| `services/api/src/routes/auth.ts` | L16；L61–65；L67–70；L72–84 | 三路登录注入 `clientIpOf(request)` 并透传可选 `device`；IP 无论有无 `device` 都写 |
| `services/api/src/modules/admin-console.ts` | L435–439 | `userSessions()`：用户不存在仍 404；固定最近 10 条（L438） |
| `services/api/src/routes/admin-console.ts` | L230–234 | `GET /admin/console/users/:id/sessions`，沿用既有后台 Cookie 会话门禁 |
| `services/api/src/db/types.ts` | L69–83；L90–100；L103–117；L462–468；L675 | `RefreshTokenRecord` 设备 / IP 字段；`UserDeviceRecord`；`AdminUserSessionSummary`；store 契约 `userDevices` 与 `admin.listUserSessions` |
| `services/api/src/db/memory.ts` | L237–257；L926–948 | 内存驱动 `userDevices` 与会话摘要同口径实现 |
| `services/api/src/db/postgres.ts` | L112–130；L130–144；L494–540；L1878–1912 | PG 驱动：`mapRefreshToken` / `mapUserDevice`、`userDevices` upsert / find / latest / list、会话摘要 join `user_devices`；upsert 走 `on conflict (user_id, device_id)` |
| `services/api/src/db/gateway.ts` | L22–39（`user_devices` L34） | 云 PG 网关表名白名单补 `user_devices` |
| `services/api/src/lib/validate.ts` | L29 | Fastify 实例装饰类型补 `deviceContext` |
| `services/api/src/app.ts` | L22；L33；L66；L154；L249 | `maskIp` 引入；`deviceRoutes` 引入；访问日志直连地址脱敏；`deviceContext` 服务装饰；设备路由挂载 |

### 3.3 前端

| 文件 | 行号 | 说明 |
| --- | --- | --- |
| `apps/app/src/device.ts`（新增，193 行） | L9–18；L22–23；L53–65；L79–92；L97–110；L112–145；L147–153；L155–180；L182–193 | 类型定义；持久 ID key / 64 字符上限；`readShellInfo()` 原生桥读取；`parseUa()` UA 降级；`readNetworkType()`；localStorage / uni 存储持久 ID 读写；`generateDeviceId()`；`getDeviceSnapshot()` 组装；`networkTypeLabel()` 中文标签 |
| `apps/app/src/api/client.ts` | L17；L396–404；L409–421；L457–461；L463–467；L469–473；L524–534；L536；L538–557；L658–670；L747–751 | 读取模块接入；`DeviceLoginInput`；`loginDevicePayload()`；三路登录带可选 `device`；`DeviceContextDto` / `DeviceContextQueryResult`；`deviceApi.reportContext()` / `getContext()`；`AdminUserSessionDto`；`adminApi.userSessions()` |
| `apps/app/src/pages/me/index.vue` | L68–106；L411–416；L462–463；L566–596；L598–613；L615–622；L852–857；L1170–1187 | 设备块模板（设备号 / 机型 / 系统 / IP / 网络 / 运营商 / 采集时间）；未登录访客行；导入；state 与派生值；`loadDeviceContext()` 本地快照 → 上报 → 响应回填；`copyDeviceId()`；`onShow` 上报 / 清空；等宽字体与可选择样式 |
| `apps/app/src/pages/settings/about.vue` | L43–66；L75；L102–123；L191；L381–393 | 本机信息小节；导入；state / 派生 / 复制；仅登录态取快照；样式 |
| `apps/app/src/pages/admin/index.vue` | L182–232；L274；L279；L301–306；L342–376；L725–732 | 登录设备与网络区段（最近一次摘要 + 会话列表）；DTO 与标签导入；区段 state；派生值与 `loadUserSessions()`；错误 / 空态样式 |

读取优先级（`device.ts` `getDeviceSnapshot()` L155–180）：原生桥 `MixmShell.getDeviceInfo()` → 桥缺字段用 UA 解析补缺 → `deviceId` 原生值优先，否则持久 UUID；桥 JSON 非法 / 解析异常 / 非对象一律按无壳处理。

## 4. 接口契约（均在 `/api/v1`，全部新增）

### 4.1 登录三路可选 `device`

`POST /auth/login/password`、`/auth/login/sms`、`/auth/login/oauth` 的 body 增加**可选** `device`；缺省时行为与旧版完全一致。`ip` 由服务端从 `clientIpOf(request)` 补齐，不读客户端入参。

请求示例（`05-login-password-with-device.req.json`）：

```json
{
  "account": "device-evidence@mixm.app",
  "password": "Evidenc123!",
  "device": {
    "deviceId": "dev-nexus-0001",
    "model": "Pixel 8",
    "osName": "Android",
    "osVersion": "14",
    "networkType": "wifi",
    "carrier": "China Mobile"
  }
}
```

响应仍为既有 `AuthResult` 形状（`data.user` / `data.tokens` / `data.isNewUser`），未新增响应字段；证据 `04-login-password-no-device.resp.json`（不带 `device`，200）、`05-login-password-with-device.resp.json`（带 `device`，200）。

### 4.2 `POST /device/context`（需登录）

上报 / 刷新当前快照。body 只接受 `deviceId / model / osName / osVersion / networkType / carrier`；夹带的 `ip`、`updatedAt` 被 schema 剥离。

请求示例（`06-context-post-1.req.json`，body 故意带伪造 `ip:"1.2.3.4"` 与 `updatedAt`）：

```json
{
  "deviceId": "dev-nexus-0001",
  "model": "Pixel 8",
  "osName": "Android",
  "osVersion": "14",
  "networkType": "wifi",
  "carrier": "China Mobile",
  "ip": "1.2.3.4",
  "updatedAt": "2000-01-01T00:00:00Z"
}
```

响应示例（`06-context-post-1.resp.json`，200；`ip` 取 XFF 首跳 `203.0.113.32`，**不是**伪造的 `1.2.3.4`；`updatedAt` 为服务端生成时间）：

```json
{
  "statusCode": 200,
  "body": {
    "data": {
      "deviceId": "dev-nexus-0001",
      "model": "Pixel 8",
      "osName": "Android",
      "osVersion": "14",
      "ip": "203.0.113.32",
      "networkType": "wifi",
      "carrier": "China Mobile",
      "updatedAt": "2026-11-21T16:33:18.889Z"
    }
  }
}
```

未登录 / 无效令牌 → `401 UNAUTHORIZED`（证据 `01` GET、`02` POST）。

### 4.3 `GET /device/context?deviceId=<可选>`（需登录，只读）

不传 `deviceId` 返回该用户最近一条（按 `updated_at` 倒序）；指定 `deviceId` 取该设备；无记录返回 `200` + `data.device = null`，不报 404。

最近一条响应（`08-context-get-latest.resp.json`）：

```json
{
  "statusCode": 200,
  "body": {
    "data": {
      "device": {
        "deviceId": "dev-nexus-0001",
        "model": "Pixel 8",
        "osName": "Android",
        "osVersion": "14",
        "ip": "203.0.113.33",
        "networkType": "cellular",
        "carrier": "China Unicom",
        "updatedAt": "2026-11-21T16:33:18.922Z"
      }
    }
  }
}
```

无记录响应（`09-context-get-unknown.resp.json`）：

```json
{ "statusCode": 200, "body": { "data": { "device": null } } }
```

### 4.4 `GET /admin/console/users/:id/sessions`（后台 Cookie 会话）

返回该用户最近 10 条会话摘要；字段：`id`（刷新令牌哈希前 8 位，不返原文）、`createdAt`、`revokedAt`、`deviceId`、`model`、`osName`、`osVersion`、`networkType`、`carrier`、`ip`、`lastSeenAt`。`lastSeenAt` 取该 `deviceId` 在 `user_devices` 的 `updated_at`；无设备快照的会话回退该会话 `createdAt`。用户不存在 / 后台未登录 → 既有口径 `404 NOT_FOUND`，不暴露接口存在。

响应示例（`11-admin-sessions.resp.json`，200，节选）：

```json
{
  "statusCode": 200,
  "body": {
    "data": [
      {
        "id": "5d11cb3d",
        "createdAt": "2026-11-21T16:33:18.854Z",
        "revokedAt": null,
        "deviceId": "dev-nexus-0001",
        "model": "Pixel 8",
        "osName": "Android",
        "osVersion": "14",
        "networkType": "wifi",
        "carrier": "China Mobile",
        "ip": "203.0.113.31",
        "lastSeenAt": "2026-11-21T16:33:18.922Z"
      },
      {
        "id": "86043a15",
        "createdAt": "2026-11-21T16:33:18.767Z",
        "revokedAt": null,
        "deviceId": null,
        "model": "",
        "osName": null,
        "osVersion": "",
        "networkType": null,
        "carrier": "",
        "ip": "192.0.2.10",
        "lastSeenAt": "2026-11-21T16:33:18.767Z"
      }
    ]
  }
}
```

匿名访问响应（`12-admin-sessions-anon.resp.json`）：`404 NOT_FOUND`。

## 5. 隐私边界

| 边界项 | 口径 | 依据 |
| --- | --- | --- |
| 可见范围 | IP 与设备号只在「本人可见 + 后台可见」范围内：本人 `/device/context` 响应与「我的 / 关于」页；后台会话摘要视图。不进任何公开页面，不进对他人可见的接口响应 | 契约 39 §6；`routes/device.ts` 两个方法均 `requireAuth`；后台端点走 `requireSession` |
| 后台会话标识 | 只返刷新令牌哈希前 8 位（`id`），不返令牌原文 | `modules/admin-console.ts` L435–439；`AdminUserSessionDto` `id` 字段 |
| 关于页脱敏 | 关于页正文只显设备号后 6 位（`······` + `slice(-6)`）；复制按钮写入完整 deviceId | `about.vue` L50–52、L114–121 |
| 日志脱敏 · IPv4 | 保留前两段：`1.2.3.4` → `1.2.*.*`；`lib/device-context.ts` `maskIp()` L79–89；访问日志直连地址经 `app.ts` L66 序列化器统一打码 | 证据 `api/server.log`：`203.0.*.*`、`192.0.*.*`、`127.0.*.*` |
| 日志脱敏 · IPv6 | 保留前两组，其余 `****`；无法识别则整串打码 | `maskIp()` L81–85 |
| 日志脱敏 · 设备号 | 只打前 6 位，其余 `****`；日志示例 `dev-ne****` | `maskDeviceId()` L92–95；`routes/device.ts` L16–19 |
| 落库口径 | 数据库存原始 IP（本人 + 后台可见范围内）；日志不落完整 IP；XFF 头不进日志 | `report-api.md` §5 |
| 外发禁止 | 未做二维码；未把设备号 / IP 带入公开页；未新增公开接口；原生桥新增代码无网络请求 | `report-native.md` §5；`report-frontend.md` §7 |

## 6. 降级行为表

| 场景 | 端上行为 | 依据 |
| --- | --- | --- |
| 有原生壳（Android） | 优先读 `MixmShell.getDeviceInfo()` JSON；桥字段缺省再用 UA / 浏览器口径补缺；`osName=Android` | `device.ts` `readShellInfo()` L53–65、`getDeviceSnapshot()` L155–180 |
| 无原生壳（纯 H5 / 小程序 / 鸿蒙 WebView） | `osName` 由 UA 判定（其余兜底 `Web`）；`model` / `carrier` 空；`deviceId` 用 localStorage（uni 存储兜底）持久 UUID；`networkType` 由 `connection.type` 映射 | `device.ts` `parseUa()` L79–92、`readStoredDeviceId()` L112–145 |
| 无 `navigator.connection` 或类型不可识别 | `networkType=none`（界面「未连接」），不编造类型 | `device.ts` `readNetworkType()` L97–110 |
| 桥返回非法 JSON / 非对象 / 抛异常 | 忽略桥结果，按无壳走 UA 降级；页面不崩 | `readShellInfo()` L57–64；原生侧 `fallbackDeviceJson()` L944–956 |
| `/device/context` 接口失败 | 本地快照字段照常展示；IP 显「不可用」（上报中先显「获取中」）；采集时间「—」；不阻塞页面、不整页报错 | `me/index.vue` `deviceIpText` L580–583、`loadDeviceContext()` L598–613 |
| 未登录 | 我的页不渲染设备块，访客区显「设备与网络 · 登录后查看设备与网络」；关于页显「登录后查看本机设备信息。」；不发起 `/device/context` 请求；服务端两个设备接口返 401 | `me/index.vue` L411–416、L852–857；`about.vue` L191；`01` / `02` 401 证据 |
| 后台未登录 / 无会话 | 后台会话端点 404（既有口径）；前端区段显示空态 / 错误文案，不清整页 | `12-admin-sessions-anon.resp.json`；`admin/index.vue` L362–375 |
| 存储不可用（隐私模式等） | localStorage 写失败回落 uni 存储；再不可用本次会话持内存值，不阻断 | `device.ts` `writeStoredDeviceId()` L130–145 |

**硬性约束**：禁止页面直接 import Capacitor 插件；页面不直接依赖原生对象，统一经 `device.ts` 的 `window.MixmShell?.getDeviceInfo?.()` 可选调用；无壳环境函数照常返回值。原生侧同样未引入插件通道（理由见 `report-native.md` §7）。

## 7. 可复现命令清单

### 7.1 门禁（仓库根目录 `F:\合并项目\MixmAPP`）

| 命令 | 期望结果 | 本机记录 |
| --- | --- | --- |
| `pnpm run lint` | 规则检查通过；本轮服务端 / 前端改动文件 0 告警（既有 `ui-review/` 运行时目录告警被 gitignore 整体忽略） | 见 `report-api.md` §7、`report-frontend.md` §6 |
| `pnpm run typecheck` | 全 workspace 类型检查通过 | 同上 |
| `pnpm run verify` | 规则检查 → 类型检查 → 自动化测试 → API 构建 → H5 构建，五段全绿（脚本 `scripts/verify.mjs` L10–14） | 编排线干净工作树复跑全绿；verify 独立日志未留存 `ui-review/`，结论以该记录为准 |
| `pnpm run build:h5` | H5 产物构建成功（`node scripts/build-h5.mjs`） | 含在 `verify` 的 H5 构建段 |
| `pnpm run build:mp-weixin` | 小程序构建成功 | 待回填（发布 / 验收线） |
| `pnpm run build:harmony` | 鸿蒙构建成功 | 待回填（发布 / 验收线） |
| `pnpm --filter @mixmapp/api test` | 单测通过；内存驱动新增设备快照用例全绿，PG 集成用例无 `DATABASE_URL` 时按既有机制跳过 | `report-api.md` §7：175 passed / 9 skipped（含新增 6 例） |

### 7.2 构建链

| 命令 | 期望结果 | 备注 |
| --- | --- | --- |
| `pnpm run build:api` | API 构建成功 | 含在 `verify` 的 API 构建段 |
| `cd apps/mobile/android; .\gradlew.bat :app:compileDebugJavaWithJavac --console=plain` | `BUILD SUCCESSFUL`；只编 Java，不出包 | `report-native.md` §6；「过时 API」注记来自既有 `ws.setForceDark(...)`，本轮新增代码未用废弃 API |
| `.\gradlew.bat :app:assembleDebug` / `:app:assembleRelease` | debug / release 重新出包成功 | 待回填（发布线统一出包，本轮不抢占产物） |

### 7.3 服务端取证脚本

脚本：`ui-review/device-2026-11-22/api/collect.ps1`（PowerShell + `curl.exe`，按 01→12 顺序落盘请求 / 响应 JSON，并生成 `stability-check.json`）。

先起内存驱动实例（端口 8121）：

```powershell
cd F:\合并项目\MixmAPP\services\api
$env:NODE_ENV='development'
$env:JWT_SECRET='evidence-secret-0123456789abcdefghijklmnop'
$env:ALLOW_MEMORY_STORE='1'
$env:ADMIN_TOKEN='ops-device-2026'
$env:PORT='8121'
$env:MALL_CATALOG_SOURCE='off'
$env:RATE_LIMIT_PER_MINUTE='100000'
npx tsx src/index.ts
```

另开终端执行取证：

```powershell
cd F:\合并项目\MixmAPP\ui-review\device-2026-11-22\api
./collect.ps1
```

期望结果：`01` / `02` 状态码 401；`03` 注册 200 拿到 token；`04` 不带 device 200；`05` 带 device 200；`06` / `07` 上报 200 且 `deviceId` 一致；`08` 回读最近快照 200；`09` 无记录 `device:null`；`10` 后台会话 200；`11` 会话摘要 200；`12` 匿名 404；`stability-check.json` `deviceIdStable: true`。

### 7.4 前端截图脚本

脚本：`ui-review/device-2026-11-22/shot-device.mjs`（Edge headless + CDP，视口 390×844，deviceScaleFactor 2；浏览器 profile 落系统临时目录，不进仓库）。

```powershell
pnpm --filter @mixmapp/app dev:h5 -- --port 5191
node ui-review/device-2026-11-22/shot-device.mjs
```

环境变量：`BASE_URL`（默认 `http://localhost:5191`）、`EDGE_PATH`（Edge 可执行文件覆盖）。注意本机 Vite 只监听 IPv6 `::1`，用 `localhost` 访问，`127.0.0.1` 会被拒绝。当前截图为「本地无真后端、上报失败」的降级态（`report-frontend.md` §5.2 备注）；联调真实响应截图待发布 / 验收线回填。

## 8. 证据索引表

证据根目录：`ui-review/device-2026-11-22/`（该目录整体在 `.gitignore` L53 `/ui-review/` 内，不入库；本表路径相对仓库根）。

| # | 验收项 | 证据文件路径 | 结论 |
| --- | --- | --- | --- |
| 1 | AVD「我的」设备块 · 浅色 | `ui-review/device-2026-11-22/avd-me-device-light.png`；`api/13-prod-context-get.resp.json`（最近快照 200） | **PASS**：设备号 `47d733cffd06485a`、机型 `sdk_gphone64_x86_64`、Android 17、IP `60.178.223.243`、移动网络、T-Mobile、采集时间 `11/21/2026 5:08:24 PM` |
| 2 | AVD「我的」设备块 · 深色 | `avd-me-device-dark.png` | **PASS**：同字段，采集时间 `11/21/2026 5:16:14 PM`；`cmd uimode night yes` 切换取证后已 `night no` 复原 |
| 3 | 管理后台用户详情 / 会话视图 | `admin-user-sessions.png`；`api/14-admin-sessions-ui.resp.json`（200）；`api/15-admin-sessions-anon.resp.json`（404）；`api/11-admin-sessions.resp.json`（首套 200）；探针 `api/14-admin-sessions-ui.probe.json` | **PASS**：后台区块设备号 `dev-admin-ui-0001`、Pixel 8、Android 14、IP `203.0.113.40`、Wi-Fi · China Mobile、采集时间 `2026/11/22 01:32:19`；匿名访问 404 |
| 4 | H5 端设备块（线上联调） | `h5-prod-me-device.png`；`api/13-prod-h5-report.resp.json`（线上 POST `/device/context` 200）；旧 `h5-me-device-light.png` / `h5-me-device-dark.png` / `h5-me-device-guest.png` / `h5-about-device.png` / `h5-admin-sessions-empty.png` 为无真后端 headless 降级态，仅存档不作联调证据 | **PASS**：线上 H5 真实 IP `60.178.223.243`（非「不可用」）；Web 端机型 / 系统版本 / 运营商留空、网络 `none` 属契约降级口径 |
| 5 | API 上报响应（含 IP 来源头） | `api/06-context-post-1.req.json`（XFF `203.0.113.32`，body 夹带伪造 `ip:1.2.3.4`）；`api/06-context-post-1.resp.json`（200，`ip:203.0.113.32`）；`api/07-context-post-2.resp.json`（200，`ip:203.0.113.33`） | 伪造 `ip` / `updatedAt` 被剥离；IP 取 XFF 首跳 |
| 6 | API 查询响应 | `api/08-context-get-latest.resp.json`（最近一条 200）；`api/09-context-get-unknown.resp.json`（无记录 `device:null`，200 不 404） | 只读查询口径与契约 §3.2 一致 |
| 7 | 未登录 / 无令牌被拒 | `api/01-unauth-get-context.resp.json`（401 `UNAUTHORIZED`）；`api/02-unauth-post-context.resp.json`（401）；`api/12-admin-sessions-anon.resp.json`（404）；线上 `api/16-prod-anon-get.txt` / `api/17-prod-anon-post.txt`（均 401） | 设备接口 401；后台会话匿名 404（既有口径）；线上与本地口径一致 |
| 8 | 设备号稳定性（两次调用同一 deviceId） | 线上 `api/stability-prod.json`（`deviceIdPost1 == deviceIdPost2 == 47d733cffd06485a`，`deviceIdStable: true`）；`api/12-device-stability-1.resp.json` / `-2.resp.json`（均 200）；冷启动复核 `avd-me-device-second.png`、`api/cdp-bridge-second.json`；本地 `api/stability-check.json`（`dev-nexus-0001` 两次一致） | **PASS**：线上两次 POST 同 deviceId；强停冷启动后页面与桥快照同值；本地两次上报同值。端上 deviceId 与 shell `android_id` 不等属 SSAID 签名密钥作用域差异，详见 `report-device.md` §3.3 |
| 9 | 网络切换 Wi-Fi ↔ 移动网络 | 服务端 `api/06-context-post-1.resp.json`（`wifi` / China Mobile）→ `api/07-context-post-2.resp.json`（`cellular` / China Unicom）；端侧 `avd-net-cellular.png` + `api/net-cellular-dumpsys.txt`（默认网络 `MOBILE[NR]` / `CELLULAR`）；降级态 `avd-net-wifi.png` + `api/net-wifi-attempt-dumpsys.txt`（`Active default network: none`） | **PASS(降级说明)**：蜂窝态实测与 dumpsys 一致；断网后桥正确回落 `none`。模拟器无可用 Wi-Fi AP，Wi-Fi 侧无法关联实测；Wi-Fi→移动的服务端口径以 `06→07` 两次上报与原生 `getActiveNetwork()+NetworkCapabilities` 代码路径（`MainActivity.java` L903–919）为替代证据，未伪造 Wi-Fi 关联截图 |
| 10 | 门禁：lint / typecheck / verify / h5 | 发布线基线 `release/gate-lint.txt`、`gate-typecheck.txt`、`gate-verify.txt`（规则 / 类型 / 测试 175 passed·9 skipped / API 构建 / H5 构建全绿）；本轮复验 `release/gate-lint-rerun.txt`、`release/gate-verify-rerun.txt` | **PASS**：验收线首次复跑时 4 处告警全部来自从 debug APK 解包的 Capacitor 生成桥 `assets/native-bridge.js`（`Generated File. Do not edit.`，可再生的只读派生物）。该解包目录已删除，告警原文留档 `api/apk-extract-warnings.txt`；删除后重跑 `node scripts/repo-lint.mjs` → ✓ 规则检查通过，`pnpm verify` → 规则 / 类型 / 测试 / API 构建 / H5 构建 全部通过（43.3s）；源码 0 告警 |
| 11 | 门禁：mp-weixin / harmony | `release/gate-mp-weixin.txt`、`release/gate-harmony.txt`；`release/PUSH-CI-PROD.md` §6 | **PASS**：发布线 `build:mp-weixin` / `build:harmony` 均 DONE Build complete；本轮验收支线未重跑构建 |
| 12 | debug / release 重新出包 | `release/apk-evidence.txt`；本轮复算 `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`、`.../release/app-release.apk`；装机包留存 `api/installed-base.apk` | **PASS**：debug SHA-256 `a95698c29dbe97f6280842535933088316bc74ac6d862ef9727b566975f0444e`（4,736,066 B）；release `dce30b39fc7b687578a95fc219efbf1de042b7adb3253a2b2d24e3ffa047da47`（3,530,507 B）；`installed-base.apk` 与 debug 包同哈希，与基线一致 |
| 13 | CI 三条流水线绿 | `release/ci-final-summary.json` / `.txt`；`release/ci-watch-ci.txt`、`ci-watch-android.txt`、`ci-watch-deploy.txt`；`release/PUSH-CI-PROD.md` §3 | **PASS**：ci `44926948913`、android `44926948908`、deploy `44926948942` 全 success；CI 真库已应用迁移 0021，PG 集成 9 过，`device-context.test.ts` 6 过 |
| 14 | 线上 H5 换包指纹（新组件名） | `release/prod-index-DtAsuT32.js`；`release/PUSH-CI-PROD.md` §4.2 | **PASS**：线上主包 `/assets/index-DtAsuT32.js`，246,940 B，SHA-256 `b5372452ac97cd131777fd0407df1a6a28b9c4fbc2b263817596a7caacec79e3`；`device/context`、`mixmapp:device-id`、`reportContext`、`deviceId` 四指纹命中；线上真实联调见 #4 |
| 15 | 服务端单测与 PG 集成 | `services/api/test/device-context.test.ts`；`services/api/test/postgres.integration.test.ts` | 内存驱动 6 例新增用例；真库集成用例挂 PG 测试文件，无 `DATABASE_URL` 时跳过，CI 真库环境覆盖 |

## 9. 遗留项与已知限制

1. **真实 PG 未在本机验证**：本机 PG 17 在跑但 `pg_hba.conf` 为 `scram-sha-256`，无连接串 / 密码可用，未尝试爆破；迁移 SQL 与 PG 驱动 SQL 待 CI 真库集成测试复核。内存驱动取证实例重启即丢。
2. **会话摘要固定 10 条**：`GET /admin/console/users/:id/sessions` 上限固定最近 10 条，未暴露分页参数（契约 §3.3 口径）。
3. **`GET /device/context` 页面暂未主动调用**：我的页当前直接使用 POST 响应回填 IP / 采集时间；GET 已接线（含 `?deviceId=` 与 `device:null` 口径），预留后续下拉刷新 / 冷启动补拉。
4. **模拟器网络切换能力待验收线确认**：服务端只存储客户端上报的 `networkType`；真实 Wi-Fi / 移动网络切换由端侧采集上报，headless 与当前 AVD 产物（改动前包）均未覆盖真机切换场景。
5. **登录 `device` 自动补齐口径**：client 层在调用方未显式传入 `device` 时自动取本地快照补齐；老字段未动、服务端缺省行为不受影响。如需严格「仅显式传入才带」，回退点为 `client.ts` `loginDevicePayload()`（L409–421）去掉快照兜底，页面无需改动。
6. **后台会话依赖 Cookie 会话**：前端未内置 console 登录流程，查询前需浏览器已持有 `/admin/console/*` 会话 Cookie；本地无后端时截图为空态。
7. **真机 / 模拟器桥接实测未执行**：在线 `emulator-5554` 上既有 APK 为改动前产物，不含本桥方法；按边界要求未跑 `assembleDebug` 重出包，桥接实测留待验收线统一出包后进行。
8. **端上不做 64 字符截断**：裁剪与入库归一化由服务端按契约 §1 执行，端上保留原始系统属性值以便排障。

## 10. 回滚方式

- **提交粒度**：本轮改动尚未 commit；形成提交后用 `git revert <本轮提交>` 整包回退，保留历史。
- **迁移 0021**：只做加列 / 加表（`alter table … add column if not exists`、`create table if not exists`、`create index if not exists`），幂等可重放；回滚代码即可停用新列新表，**不做破坏性数据删除**，既有库数据不受影响。
- **文件粒度**：前端改动按文件回退——`apps/app/src/device.ts`（新增，直接删除）、`api/client.ts`（撤 L17 / L396–421 / L457–473 / L524–557 / L658–670 / L747–751 新增段）、`pages/me/index.vue`、`pages/settings/about.vue`、`pages/admin/index.vue`；服务端撤 `routes/device.ts`、`modules/device.ts`、`lib/device-context.ts` 及 `auth.ts` / `admin-console.ts` / `db/*` / `contracts` 中的新增段；原生壳撤 `MainActivity.java` L7 / L20 / L54 / L83–84 / L848–956 新增段。既有方法签名与行为在本轮未改，回退不影响老链路。
- **数据库**：不提供 down 迁移；如需彻底清理新列新表，按 `0021_device_context.sql` 反向手工执行 `alter table … drop column` / `drop table`，属独立运维动作，不在应用回滚路径内。
