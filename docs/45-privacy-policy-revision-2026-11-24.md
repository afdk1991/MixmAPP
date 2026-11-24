# 45 · 隐私政策改版记录（2026-11-24 版）

- 政策版本：`2026-11-24`（上一版 `2026-11-15`，见政策页首行）
- 唯一口径文件：`apps/app/src/pages/legal/privacy.vue`
- 版本常量：`apps/app/src/privacy.ts:23`（`PRIVACY_POLICY_VERSION = '2026-11-24'`）
- 记录日期：2026-11-24
- 本轮范围边界：**只做隐私政策披露与各端同步口径核对**；未改动后端字段含义、未改动权限声明、未改动支付与后台功能，也未新增收集项。文档不构成对既有功能的验收结论。

## 1. 一句话结论

这次补的是「**已上线功能未被披露**」的缺口——设备与网络快照、IP 产生口径、后台可见范围、凭证期限、权限实测清单这些代码里已经在跑的行为，上一版政策没有逐字段说清；本轮把这些事实性断言逐条补进政策并回挂到代码依据，**不是文案美化**。政策里每一句「我们做什么 / 不做什么」都在第 2 节给出可核验的代码位置；验证不了的表述一律按第 4 节「仍是限制」单列，不混进已验证结论。

## 2. 新增 / 修改条款 vs 代码依据

下表逐条对应政策正文（`privacy.vue`）中的事实性断言。「可核验方式」给出在仓库根目录 `F:\合并项目\MixmAPP` 下可直接执行的检索命令或检索词；行号均来自本轮真读的文件内容。

### 2.1 设备与网络信息（政策第二节）

| # | 政策条款摘要 | 代码依据（文件:行号） | 可核验方式 |
|---|---|---|---|
| 1 | **设备标识来源**：Android 优先取系统分配的 `ANDROID_ID`；取不到时回落本机首次生成并持久保存的随机 UUID；网页与小程序使用保存在本地存储的随机 UUID，同一设备后续复用。 | `apps/mobile/android/app/src/main/java/top/mixm/app/MainActivity.java:873-896`（`resolveDeviceId`：`ANDROID_ID` 在 876-877，SP 持久 UUID 在 884-891）；`apps/app/src/device.ts:112-128`（本地存储读取）、`147-152`（`crypto.randomUUID` 不可用时退化时间戳+随机串）、`165-169`（优先壳设备号，缺失读本地或生成并回写） | `Select-String -Path apps\mobile\android\app\src\main\java\top\mixm\app\MainActivity.java -Pattern "ANDROID_ID|UUID.randomUUID"`；`Select-String -Path apps\app\src\device.ts -Pattern "DEVICE_ID_KEY|generateDeviceId"` |
| 2 | **机型 / 系统名 / 系统版本来源**：Android 读取系统属性（`Build.MODEL`、`Build.VERSION.RELEASE`）；网页端从浏览器 User-Agent 尽力解析，解析不到留空，不填假值。 | `MainActivity.java:849-855`（`getDeviceInfo`：model 取 `Build.MODEL` 在 853，osVersion 取 `Build.VERSION.RELEASE` 在 855）；`apps/app/src/device.ts:157-161`（UA 解析结果与壳字段合并，`asString` 空值兜底） | `Select-String -Path apps\mobile\android\app\src\main\java\top\mixm\app\MainActivity.java -Pattern "Build.MODEL|Build.VERSION.RELEASE"`；`Select-String -Path apps\app\src\device.ts -Pattern "parseUa|osName|osVersion"` |
| 3 | **网络类型**：Wi-Fi / 移动网络 / 以太网 / 未连接；取不到一律记为「未连接」，不猜测。 | `MainActivity.java:903-919`（`resolveNetworkType`：WIFI/CELLULAR/ETHERNET 映射，兜底 `none`）；`apps/app/src/device.ts:100-110`、`163`（前端同类映射与兜底） | `Select-String -Path apps\mobile\android\app\src\main\java\top\mixm\app\MainActivity.java -Pattern "TRANSPORT_WIFI|TRANSPORT_CELLULAR|TRANSPORT_ETHERNET|none"` |
| 4 | **运营商**：仅 Android 原生壳可读取运营商名称；网页与小程序取不到时留空。 | `MainActivity.java:925-936`（`resolveCarrier`：`TelephonyManager.getNetworkOperatorName()` 在 930，空/异常返回空串；注释明确不申请 `READ_PHONE_STATE`）；`apps/app/src/device.ts:162`（壳 `carrier` 透传，无壳端兜底取值） | `Select-String -Path apps\mobile\android\app\src\main\java\top\mixm\app\MainActivity.java -Pattern "getNetworkOperatorName|resolveCarrier"` |
| 5 | **IP 只由服务端产生**：客户端上报的同名字段一律丢弃；采集时间取服务端写入时间，不采信客户端上报时间。 | `services/api/src/routes/device.ts:11-21`（POST 接口 `requireAuth` 鉴权，`ip = clientIpOf(request)` 在 13，不落客户端 body 里的 ip）；`services/api/src/modules/device.ts:28-43`（`record` 服务端补 `clientIp` 与 `updatedAt = new Date()` 在 38-39）；`infra/sql/0021_device_context.sql:8`（口径注释：`client_ip` 不采信客户端上报）、`:48`（`updated_at` 为服务端写入时间） | `Select-String -Path services\api\src\routes\device.ts -Pattern "requireAuth|clientIpOf"`；`Select-String -Path services\api\src\modules\device.ts -Pattern "clientIp|updatedAt"` |
| 6 | **IP 取转发头首跳，缺失回落直连地址；转发头可被伪造**（限制，详见第 4 节①）。 | `services/api/src/lib/device-context.ts:71-76`（`clientIpOf`：`x-forwarded-for` 首段 `fromForwarded`，缺失回落 `request.ip`，取不到空串） | `Select-String -Path services\api\src\lib\device-context.ts -Pattern "x-forwarded-for|request.ip"` |
| 7 | **日志脱敏**：IPv4 只保留前两段、IPv6 只保留前两组，设备号只保留前 6 位；原始值不落日志。 | `services/api/src/lib/device-context.ts:79-89`（`maskIp`：IPv4 `a.b.*.*`，IPv6 前两组 + `****`）、`92-95`（`maskDeviceId`：前 6 位 + `****`）；`services/api/src/routes/device.ts:16-19`（日志只打脱敏后的设备号与 IP）；`services/api/src/app.ts:62-69`（访问日志序列化器 `remoteAddress` 经 `maskIp` 处理，`app.ts:66`） | `Select-String -Path services\api\src\lib\device-context.ts -Pattern "maskIp|maskDeviceId"`；`Select-String -Path services\api\src\app.ts -Pattern "remoteAddress|maskIp"` |
| 8 | **写入位置**：每个账号、每台设备仅保留最近一条快照；登录令牌记录中同时保存该次登录的设备快照；后台写操作审计另记操作者 IP 与浏览器标识。 | `infra/sql/0021_device_context.sql:10-16`（`refresh_tokens` 增 7 列：device_id/device_model/os_name/os_version/network_type/carrier/client_ip）、`:26-37`（`user_devices` 表，主键 `(user_id, device_id)`，`user_id` 外键 `on delete cascade` 在 27）；`services/api/src/modules/auth.ts:679-707`（签发令牌写令牌行 686-692，`normalized` 存在时 upsert `user_devices` 695-707）；`services/api/src/modules/device.ts:41`（`userDevices.upsert` 覆盖最近一条）；`infra/sql/0020_admin_console.sql:11-24`（`admin_audit_logs`：`actor`/`ip`/`user_agent` 在 19-21） | `Select-String -Path infra\sql\0021_device_context.sql -Pattern "refresh_tokens|user_devices|cascade"`；`Select-String -Path services\api\src\modules\auth.ts -Pattern "userDevices.upsert|deviceModel|clientIp"`；`Select-String -Path infra\sql\0020_admin_console.sql -Pattern "actor|ip|user_agent"` |
| 9 | **后台会话摘要最多 10 条**：运营后台按单个用户查看最近会话，写死上限 10 条。 | `services/api/src/routes/admin-console.ts:229-234`（`/admin/console/users/:id/sessions`，`requireSession` 校验）；`services/api/src/modules/admin-console.ts:435-439`（`userSessions` 调 `listUserSessions(userId, 10)`，10 在 438）；`services/api/src/db/postgres.ts:1878-1891`（`refresh_tokens r left join user_devices d`，`order by r.created_at desc limit $2`） | `Select-String -Path services\api\src\modules\admin-console.ts -Pattern "listUserSessions\(userId, 10\)"`；`Select-String -Path services\api\src\db\postgres.ts -Pattern "listUserSessions|left join user_devices"` |
| 10 | **可见范围**：快照仅在「星际联邦通行证 → 设备与网络」与「关于与能力 → 本机信息」向本人展示，以及后台「用户最近会话」向已登录管理员展示；不进入公开页面。 | 本人可见面：`apps/app/src/pages/me/index.vue:68-106`（设备号/机型/系统/IP/网络/运营商/采集时间行）；`apps/app/src/pages/settings/about.vue:43-65`（本机信息块，设备号仅显示后 6 位在 51）；后台可见面：`routes/admin-console.ts:229-234`（见上条）；公众不可见：政策第七节（`privacy.vue:128-130`），仓库内无他人手机号/设备标识的公开展示路由 | `Select-String -Path apps\app\src\pages\me\index.vue -Pattern "deviceSnapshot|设备与网络"`；`Select-String -Path apps\app\src\pages\settings\about.vue -Pattern "本机信息|slice(-6)"` |
| 11 | **登录凭证 30 天**：刷新凭证自签发起 30 天到期；退出登录即在本机清除；服务端只保存凭证哈希，不保存原文；应用已关闭系统自动备份。 | `services/api/src/config.ts:447`（`refreshTtlDays: num('JWT_REFRESH_TTL_DAYS', 30)`）；`services/api/src/modules/auth.ts:675`（`expiresAt = now + refreshTtlDays*24*3600*1000`）、`:680`（`tokenHash: sha256Hex(raw)`，只存哈希）；`apps/app/src/stores/session.ts:107-120`（`logout` 清本地令牌与用户缓存）；`apps/mobile/android/app/src/main/AndroidManifest.xml:35-36`（`allowBackup="false"`、`fullBackupContent="false"`） | `Select-String -Path services\api\src\config.ts -Pattern "refreshTtlDays"`；`Select-String -Path services\api\src\modules\auth.ts -Pattern "tokenHash|expiresAt"`；`Select-String -Path apps\mobile\android\app\src\main\AndroidManifest.xml -Pattern "allowBackup|fullBackupContent"` |
| 12 | **通知权限**：安装包已声明通知权限，但当前版本启动时不主动弹出授权框，也没有启用推送通道；未授权不影响任何功能。 | `AndroidManifest.xml:7-9`（`POST_NOTIFICATIONS` 声明，注释说明本版本不主动申请）；Android 壳源码内无 `requestPermissions` 调用（本轮检索仅命中 manifest 注释本身）；推送适配器为开发态：`services/api/src/adapters/push.ts:129`（`[push:dev]` 控制台输出，不外发） | `Select-String -Path apps\mobile\android\app\src\main\java\top\mixm\app\*.java -Pattern "requestPermissions"`；`Select-String -Path services\api\src\adapters\push.ts -Pattern "push:dev"` |
| 13 | **剪贴板只写不读**：仅在点击「复制设备号」「复制订单编号」等按钮时写入；代码中没有任何读取剪贴板的调用。 | 写入 6 处：`apps/app/src/pages/mall/detail.vue:557`、`pages/settings/about.vue:117`、`pages/me/index.vue:622` 与 `:696`、`pages/research/detail.vue:336` 与 `:344`（均为 `uni.setClipboardData`）；读取 0 处：全 `apps/app/src` 检索 `getClipboardData` 无命中 | `Select-String -Path apps\app\src\*.vue,apps\app\src\**\*.vue -Pattern "setClipboardData"`；`Select-String -Path apps\app\src\*.vue,apps\app\src\**\*.vue -Pattern "getClipboardData"`（应无结果） |
| 14 | **位置仅用于定位填充**：购物车填写收货地址、点击「定位填充」时由用户主动触发，回填省市区；不点击则不调用，也不在后台定位。Android 安装包当前未声明定位权限，App 内该按钮提示「定位不可用，请手动填写」；小程序端声明了位置用途，地图服务当前未启用。 | 唯一定位调用：`apps/app/src/pages/cart/index.vue:766-789`（`fillByLocation`，`uni.getLocation` 在 772；逆地理在 778；失败兜底提示在 785）；Android 壳无定位权限：`AndroidManifest.xml:4-32`（权限清单仅三条，无 `ACCESS_FINE/COARSE_LOCATION`）；小程序声明：`apps/app/src/manifest.json:56-61`（`scope.userLocation` 描述在 57-59，`requiredPrivateInfos: ["getLocation"]` 在 61）；地图开发态：`services/api/src/adapters/map.ts:87-99`（`DevMapProvider.reverseGeo` 不访问外网，返回占位结果） | `Select-String -Path apps\app\src\pages\cart\index.vue -Pattern "getLocation|fillByLocation"`；`Select-String -Path apps\app\src\manifest.json -Pattern "scope.userLocation|requiredPrivateInfos"`；`Select-String -Path services\api\src\adapters\map.ts -Pattern "DevMapProvider|不访问外网"` |
| 15 | **不接入广告 / 统计 / 用户画像 SDK，并如实披露一处框架自带的 CDN 预载引用**。政策第六节（提交 `c31a5bb` 后最终口径）原文：「页面所用的 JS、CSS 与图片由自有服务器提供；页面加载约 3 秒后，uni-app 框架默认样式会向 DCloud 官方 CDN 请求两张阴影预载图片，该请求只带图片地址、不携带账号或设备信息。除此之外不加载第三方统计、广告或热更新 SDK。站外链接由系统浏览器打开，适用该网站自己的隐私政策。」 | ① 框架预载触发器：`node_modules/@dcloudio/uni-h5/style/framework/shadow.css:1-8`（`body::after{animation:shadow-preload .1s;animation-delay:3s}`；`body::after` 常驻，延迟 3 秒后动画必然跑一次，**属必然触发、不是条件触发**——这正是政策措辞写成「页面加载约 3 秒后」的原因，而非「仅对应样式被触发时」）；构建产物 CSS 内 `@keyframes shadow-preload` 含两条 DCloud 阴影图 `url()` 引用——H5 `apps/app/dist/build/h5/assets/index-*.css`（`https://cdn.dcloud.net.cn/img/shadow-grey.png`），鸿蒙 `apps/app/dist/build/app-harmony/app.css`（`https://cdn400.dcloud.net.cn/.../img/shadow-grey.png`）；该请求只带图片地址，不携带账号或设备信息。② 前端依赖清单无统计/广告 SDK：`apps/app/package.json:15-23`（仅 `@dcloudio/uni-app*`、`vue`、`@mixmapp/contracts`）。③ 统计开关关闭：`apps/app/src/manifest.json:87-89`（`uniStatistics.enable: false`）。补充：后端依赖清单同样无分析/广告 SDK：`services/api/package.json:21-29`（`fastify`、`jose`、`pg`、`zod`、`@fastify/cors`、工作区包） | 检索触发器：`Select-String -Path node_modules\@dcloudio\uni-h5\style\framework\shadow.css -Pattern "shadow-preload|animation-delay"`；检索产物引用：`Select-String -Path apps\app\dist\build\h5\assets\*.css,apps\app\dist\build\app-harmony\app.css -Pattern "cdn.dcloud|shadow-preload"`；核对两份 `package.json` 的 `dependencies` 段与 `manifest.json` 的 `uniStatistics` |
| 16 | **第三方渠道全部未启用 / 开发态**：短信验证码、一键登录、地图、推送、AI、对象存储、微信支付、支付宝；未启用时不向任何第三方传输个人信息。 | 默认值：`services/api/src/config.ts:466`（sms=`console`）、`:490`（onekey=`dev`）、`:513`（map=`dev`）、`:518-519`（storage=`local`）、`:532`（push=`dev`）、`:540`（ai=`dev`）、`:606-607`（wechatPay/alipay 仅在配置了商户号/应用号时为 `on`，否则 `off`）；`.env.example:52,128,154,160,175,183` 与支付凭据留空（140、147）；适配器：`adapters/sms.ts:21-25`（`ConsoleSms` 仅 `console.info`）、`adapters/map.ts:88-99`、`adapters/push.ts:129`；`/meta` 下发快照：`services/api/src/routes/meta.ts:25`（`thirdParty: capabilitySnapshot(app.cfg)`）；快照口径：`config.ts:595-613` | `Select-String -Path services\api\src\config.ts -Pattern "SMS_PROVIDER|ONEKEY_PROVIDER|MAP_PROVIDER|STORAGE_PROVIDER|PUSH_PROVIDER|AI_PROVIDER|wechatPay|alipay"`；`Select-String -Path .env.example -Pattern "PROVIDER|MCH_ID|APP_ID"` |
| 17 | **无自助注销入口**：应用内目前没有自助注销功能；如需删除账号及数据，通过政策页联系方式提出，核实身份后处理。 | 前端无注销路由/按钮：`apps/app/src` 全量检索 `deleteAccount`/`deactivate`/`注销账号` 仅命中政策页自身文案（`privacy.vue:179`）；后端无注销接口：`services/api/src` 检索 `deactivate`/`deleteAccount`/`注销` 无业务命中 | `Select-String -Path apps\app\src\**\*.vue -Pattern "deleteAccount|deactivate|注销"`；`Select-String -Path services\api\src\**\*.ts -Pattern "deleteAccount|deactivate"` |
| 18 | **无自动清理任务**：设备快照每设备保留最近一次；订单与收货信息为履约、售后与对账长期保留；仓库内没有固定天数的数据自动清理任务。 | 服务端唯一定时器：`services/api/src/index.ts:74-85`（`setInterval` 每分钟扫描超时未支付订单并取消、归还库存；`ORDER_TTL_MINUTES=0` 可关闭）——这是订单状态流转，不是个人数据留存清理；`services/api/src` 检索 `retention`/`prune`/`delete where`/自动清理无数据保留策略命中；政策第八节如实写明「当前没有自动清除任务」（`privacy.vue:142,150,154`） | `Select-String -Path services\api\src\index.ts -Pattern "setInterval|sweepExpiredOrders"`；`Select-String -Path services\api\src\**\*.ts -Pattern "retention|prune|autoClean"` |
| 19 | **同意门禁在注册环节**：注册提交前必须勾选；未勾选点提交会被拦下并高亮；政策版本失效后旧同意记录随即失效。 | 门禁模式：`apps/app/src/privacy.ts:11`（`PRIVACY_GATE_MODE = 'register'`）；注册页勾选框与版本号、链接：`apps/app/src/pages/auth/register.vue:173-184`（勾选框 174-183，版本号 181，政策链接 180）；未勾选拦截：`register.vue:269-291`（`consent`/`consentError`，`290-291` 拦截置错）；上报凭证：`register.vue:355,415`（`buildPrivacyConsent`）；版本失效机制：`privacy.ts:20-23`（注释：升级版本号后旧同意记录失效）、`:122-139`（`hasPrivacyConsent`/`resolvePrivacyConsent` 比对 `version === PRIVACY_POLICY_VERSION`，版本不符视为未同意）；启动拦截仅 `launch` 模式触发：`apps/app/src/App.vue:21-28` | `Select-String -Path apps\app\src\privacy.ts -Pattern "PRIVACY_GATE_MODE|PRIVACY_POLICY_VERSION|hasPrivacyConsent"`；`Select-String -Path apps\app\src\pages\auth\register.vue -Pattern "consentError|privacyVersion|buildPrivacyConsent"` |
| 20 | **后台鉴权与安全措施**：后台入口需独立令牌或会话，未登录相关接口一律返回 404，不暴露接口是否存在；会话 Cookie 不可被脚本读取、仅同站发送；密码仅保存哈希。 | 会话校验失败抛 404：`services/api/src/routes/admin-console.ts:91-95`（`requireSession` → `scope.adminConsole.verify`）；`services/api/src/modules/admin-console.ts:152-161`（`verify`：未启用/无 token/无条目/失效均 `AppError.notFound()`）；Cookie 属性：`routes/admin-console.ts:53-64`（`HttpOnly` 在 57、`SameSite=Strict` 在 59，安全请求追加 `Secure` 在 62）；密码哈希：`modules/auth.ts:206,225,585,599`（`hashPassword`）、`:304`（`verifyPassword`） | `Select-String -Path services\api\src\modules\admin-console.ts -Pattern "AppError.notFound"`；`Select-String -Path services\api\src\routes\admin-console.ts -Pattern "HttpOnly|SameSite"` |
| 21 | **同意记录双写**：本机记录与账号记录同步保存，用于证明同意发生在何时、哪个版本、哪个环节；随账号存续保留。 | 本机双写通道：`privacy.ts:142-156`（`recordPrivacyConsent`：先写 WebView 存储，再写原生 Preferences 兜底）；服务端落库：`modules/auth.ts:131,153-158`（注册/登录入参 `privacyConsent`，写入 `version/acceptedAt/channel/source`）；库列映射：`services/api/src/db/postgres.ts:74-77,310-328`（`privacy_consent_version/at/channel/source`） | `Select-String -Path services\api\src\modules\auth.ts -Pattern "privacyConsent|acceptedAt"`；`Select-String -Path services\api\src\db\postgres.ts -Pattern "privacy_consent"` |
| 22 | **联系与备案主体**：运营主体以 ICP 备案登记主体为准；页脚提供 ICP 备案号与公安备案号。 | `apps/app/src/site-footer.ts:11`（`ICP_NO = 苏ICP备2025161175号-2`）、`:14`（`PSB_NO = 苏公网安备32072202010511号`）；政策第十三节同口径：`privacy.vue:214` | `Select-String -Path apps\app\src\site-footer.ts -Pattern "ICP_NO|PSB_NO"` |

> 路径勘误：任务线索中曾记为 `apps/app/src/app.ts:57-75`，本轮回读确认访问日志脱敏与 `trustProxy` 的实际文件是 **`services/api/src/app.ts`**（`remoteAddress` 脱敏在 66 行，`trustProxy: true` 在 73 行），上表已按真实路径登记。

## 3. 同时修正的旧表述：上一版「不申请位置」与新代码冲突

### 3.1 旧版原话（2026-11-15 版，提交 `dad08f9`）

> 「本应用不申请相机、麦克风、通讯录、**位置**与存储读取权限。」

### 3.2 冲突点（本轮回读确认）

1. 代码里存在唯一一次定位调用：`apps/app/src/pages/cart/index.vue:772`（`uni.getLocation`，位于「定位填充」按钮流程 `766-789`）。
2. 微信小程序端声明了位置用途：`apps/app/src/manifest.json:56-61`（`scope.userLocation` 描述在 57-59，`requiredPrivateInfos: ["getLocation"]` 在 61）。

旧版「不申请位置」把「没有后台定位、没有持续收集位置」与「完全不存在定位调用」混为一谈，与上述两处实现不一致。

### 3.3 改为限定表述的理由与当前口径

政策第四节（`privacy.vue:101-104`）改为按端限定：

- **触发方式**：仅在购物车填写收货地址、用户主动点击「定位填充」时调用；不点击不调用，不在后台定位。
- **Android 原生壳**：`AndroidManifest.xml:4-32` 权限清单只有 `INTERNET`、`ACCESS_NETWORK_STATE`、`POST_NOTIFICATIONS` 三条，未声明定位权限；因此 App 内该按钮走失败兜底，提示「定位不可用，请手动填写」（`cart/index.vue:785`）。
- **微信小程序**：按平台要求声明位置用途；地图 provider 当前为 `dev`（`config.ts:513`、`adapters/map.ts:87-99`），逆地理不访问外网。
- **未使用不影响下单**。

### 3.4 一处需要留待核对的源码差异

`apps/app/src/manifest.json:27-28` 的 `app-plus.distribute.android.permissions` 列表里写了 `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`，但实际随 Android 壳打包的 `AndroidManifest.xml` 并未包含这两条（该壳为手写 Capacitor 原生壳，不走 uni-app 云打包权限注入）。本轮政策口径以原生壳 `AndroidManifest.xml` 实测三条权限为准；`manifest.json` 内这两条列表项是否清理，不在本轮披露范围内，登记为后续待核对项。

## 4. 仍是限制的四项（已验证存在、但尚未闭环）

以下四项在政策中已如实标注为限制或现状，**不计入「已验证可兑现的承诺」**，启用或改造前不得对外表述为已完成。

### 4.1 ① XFF 转发头可被伪造，IP 不等于真实来源

- 后端取值：`services/api/src/lib/device-context.ts:71-76`，优先取 `x-forwarded-for` 首跳，缺失回落 `request.ip`。
- 反代蓝本：`infra/nginx/api.mixm.top.conf:53` 与 `:66`，两条 `location` 均 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`——该指令把请求方自带的 XFF 一并追加，客户端可在头里构造首跳地址。
- 现状口径：刻意构造请求时，记录的 IP 可能不等于真实来源；IP 只作为辅助线索，不作为限制账号的唯一依据（`privacy.vue:81`）。
- 待办：后端改为只取直连地址（`request.ip` / 反代注入的可信地址），不再解析请求方携带的转发头；改造完成前保留当前限定表述。

### 4.2 ② 第三方渠道全部未启用 / 开发态，启用前不传输个人信息

- 基线（代码默认值 + `.env.example` + 适配器实现，见 2.1 第 16 行）：sms=`console`、onekey=`dev`、map=`dev`、storage=`local`、push=`dev`、ai=`dev`、wechatPay/alipay=`off`。
- 边界：本轮**未对线上运行环境发请求核对 `/meta`**；线上快照以部署环境 `api.env` 实际配置为准。上线前应调用 `/meta` 核对 `thirdParty` 快照与代码默认值一致。
- 约束：任一能力启用前，不向该第三方传输个人信息；启用时需按政策第六节（`privacy.vue:121`）在本页更新受托方名称、处理目的与字段范围后再生效。

### 4.3 ③ 微信小程序 AppID 为空，平台侧隐私保护指引无法提交

- `apps/app/src/manifest.json:49`：`"appid": ""`。
- 源码目录无 `project.config.json`（仅 `apps/app/dist/build/mp-weixin/project.config.json` 为构建产物，不属源码）。
- 现状：小程序隐私保护指引无法在微信平台侧完成提交与配置，政策只能随包内置声明；拿到正式 AppID 并补建 `project.config.json` 后，需在小程序后台补提隐私指引并与本页口径对齐。

### 4.4 ④ 应用内无自助注销入口，也无数据自动清理任务

- 注销：前端无注销路由/按钮，后端无注销接口（检索依据见 2.1 第 17 行）；目前只能通过政策页联系方式提出、核实身份后人工处理。
- 清理：服务端唯一定时器是超时未支付订单取消（`index.ts:74-85`），不属于个人数据留存清理；设备快照、订单与收货信息、同意记录均无固定天数的自动过期任务（政策第八节已如实写明，`privacy.vue:142,150,154`）。
- 待办：后续如提供自助注销或定期清理，需同步更新政策「保存期限」与「你的权利」两节。

## 5. 各端一致性

### 5.1 仓库内四端共用同一构建产物

- 单一来源：`apps/app/src/pages/legal/privacy.vue`；路由注册仅一处：`apps/app/src/routes.ts:12`（`legalPrivacy`）与 `pages.json:14`。
- 构建链路（`apps/app/package.json:5-13`、根 `package.json:14-17`）：
  - H5：`build:h5` → `dist/build/h5`
  - App 内 WebView：`build:app`（原生壳加载本地 H5）
  - 微信小程序：`build:mp-weixin` → `dist/build/mp-weixin`
  - 鸿蒙：`build:harmony` → `dist/build/app-harmony`
- 四个端编译同一份 `src`，政策文案、版本号（`privacy.ts:23`）与同意门禁口径（`privacy.ts:11`）天然一致；改政策只需改 `privacy.vue` 与版本常量，不需要逐端维护文案。

### 5.2 外部 WordPress 站点（laal.top）已同步完成

- `laal.top` 是外部 WordPress（WordPress 7.1.5 + 子比主题 zibll）站点，不在本仓库 uni-app 构建链路内；仓库口径见 `docs/43-project-closeout-audit-2026-11-23.md` §5.13，巡检留档位于被 `.gitignore` 排除的 `reports/laal-top-settings-20261120/`。
- 隐私政策已于 **2026-11-24** 同步完成：目标为 WordPress page id 3（slug `privacy-policy`），前台 https://laal.top/privacy-policy/ 。改前备份 `ui-review/privacy-2026-11-24/laal-backup-page3-202611242022.html`（3573 字节，UTF-8，1433 字符）；改后前台源码核对：十三节齐全、收集清单表格 `<tr>` 14 行（1 表头 + 13 数据行）、`2026-11-24` 命中 6 次；注册页勾选框 `#user_agreement` 的《隐私声明》链接仍指向 page 3，落地为 2026-11-24 新版文本，链路完好。复核明细见 `ui-review/privacy-2026-11-24/laal-verify-report-20261124.md`。
- 该站是外部 WordPress，**不在本仓库闭环分母内**；文案一致性由人工同步维护，本仓库后续改版不会自动作用于该站，再次改版时需先备份现网页面再单独同步。

## 6. 验证命令附录

以下命令均在本轮于仓库根目录 `F:\合并项目\MixmAPP` 实际执行；输出为真实结果摘要，未编造。

### 6.1 三端构建（均通过）

```powershell
# H5
pnpm run build:h5
# 结果：Compiler version 5.36（vue3）→ DONE Build complete.
# [h5] 已复制公开静态页 public → dist/build/h5；API 源注入 https://api.mixm.top/mixmapp/api/v1

# 微信小程序
pnpm run build:mp-weixin
# 结果：Compiler version 5.36（vue3）→ DONE Build complete.
# Run method: open Weixin Mini Program Devtools, import dist\build\mp-weixin

# 鸿蒙
pnpm run build:harmony
# 结果：Compiler version 5.36（vue3）→ DONE Build complete.
# Run method: open HBuilderX, import dist\build\app-harmony
```

### 6.2 关键断言检索（逐条回挂）

```powershell
# 设备标识 / 机型 / 运营商（Android 壳）
Select-String -Path apps\mobile\android\app\src\main\java\top\mixm\app\MainActivity.java `
  -Pattern "ANDROID_ID|Build.MODEL|getNetworkOperatorName"
# 命中：853 Build.MODEL；869/877 ANDROID_ID；922/930 getNetworkOperatorName

# IP 取值与脱敏
Select-String -Path services\api\src\lib\device-context.ts -Pattern "x-forwarded-for|request.ip|maskIp|maskDeviceId"
Select-String -Path services\api\src\app.ts -Pattern "remoteAddress|maskIp|trustProxy"

# 快照落库与会话上限
Select-String -Path infra\sql\0021_device_context.sql -Pattern "refresh_tokens|user_devices|cascade"
Select-String -Path services\api\src\modules\auth.ts -Pattern "userDevices.upsert|tokenHash|expiresAt"
Select-String -Path services\api\src\modules\admin-console.ts -Pattern "listUserSessions\(userId, 10\)"
Select-String -Path services\api\src\db\postgres.ts -Pattern "listUserSessions|left join user_devices"

# 权限清单与定位调用
Select-String -Path apps\mobile\android\app\src\main\AndroidManifest.xml -Pattern "uses-permission"
Select-String -Path apps\app\src\pages\cart\index.vue -Pattern "getLocation|fillByLocation"
Select-String -Path apps\app\src\manifest.json -Pattern '"appid"|scope.userLocation|requiredPrivateInfos|uniStatistics'

# 剪贴板：写入应有 6 处，读取应 0 处
Select-String -Path apps\app\src\**\*.vue -Pattern "setClipboardData"
Select-String -Path apps\app\src\**\*.vue -Pattern "getClipboardData"   # 无命中

# 门禁与版本失效
Select-String -Path apps\app\src\privacy.ts -Pattern "PRIVACY_GATE_MODE|PRIVACY_POLICY_VERSION|hasPrivacyConsent"
Select-String -Path apps\app\src\pages\auth\register.vue -Pattern "consentError|privacyVersion|buildPrivacyConsent"

# 第三方渠道默认值
Select-String -Path services\api\src\config.ts -Pattern "SMS_PROVIDER|ONEKEY_PROVIDER|MAP_PROVIDER|STORAGE_PROVIDER|PUSH_PROVIDER|AI_PROVIDER|wechatPay|alipay"
```

### 6.3 本轮未执行 / 未核对项

- 未调用线上 `/meta` 核对部署环境的 `thirdParty` 快照（见 4.2）。
- 未执行后端测试与类型检查；本轮只改文档，未跑 `pnpm test` / `pnpm typecheck`。
- 本档案以 docs-only 提交 `3ab522a`（`docs: 45 号隐私政策改版说明`，提交信息带 `[skip ci]`）单独入库，未与功能提交混提交。

## 附：本轮未改动范围（避免被读成「顺手修了一堆功能」）

- 未新增或删除收集字段；未改 `user_devices` / `refresh_tokens` / `admin_audit_logs` 表结构与字段含义。
- 未改 Android / 小程序 / 鸿蒙的权限声明；未接入推送、地图、AI、存储、支付、短信、一键登录任一第三方渠道。
- 未改后台会话条数上限（仍为 10 条）、未改鉴权与 404 口径、未改支付与订单功能。
- 未改动 `docs/43-*`、未改 `.gitignore`、未在仓库内新增其他代码或配置文件。

## 变更记录

- **`1965788`** `fix(privacy): 第六节改为可验证表述（自有服务器 + DCloud CDN 预载引用如实披露）`
  - 改这一句的原因：旧版政策「应用仅连接自有服务端」在代码里**不完全成立**——uni-app 框架默认样式随构建产物带入了 DCloud 官方 CDN 阴影图的预载引用（依据见第 2 节第 15 条），旧表述把这一处第三方请求一并掩盖了。改为限定表述后，该 CDN 预载引用被如实披露；「除此之外不加载第三方统计、广告或热更新 SDK」的结论仍可在依赖清单与 `uniStatistics` 开关中核验。
  - 本档案（45 号文档）已按该提交口径同步更新第 15 条；本轮只改文档，未改代码、未提交 git。

- **`c31a5bb`** `fix(privacy): 第六节按实际触发条件写清 DCloud CDN 阴影预载（页面加载约 3 秒后请求）`
  - 改这一句的原因：`shadow.css:1-8` 的 `body::after{animation:shadow-preload .1s;animation-delay:3s}` 属**必然触发**（`body::after` 常驻，延迟 3 秒后动画必然跑一次），不是条件触发；上一版「仅对应样式被触发时才会请求图片」与代码不符。最终措辞如实写清触发时机（页面加载约 3 秒后请求两张阴影预载图）与请求范围（只带图片地址、不携带账号或设备信息）。
  - 本档案第 15 条已同步为该最终口径；本轮只改文档，未改代码、未提交 git。

- **`0a8afbf`** `fix(privacy): 字段块改用 .prow 前缀，避开全局 .field 表单高度规则造成的文字叠压`
  - 现象与根因：首轮上线后，政策第二节「设备与网络信息」的字段块与第四节权限清单在浏览器与真机上出现标签/正文互相叠压、文字被裁切。根因是页面自定的字段块类名 `.field / .field-k / .field-v` 与全局表单样式 `apps\app\src\styles\theme.scss:456-466` 的 `.field{width:100%; height:96rpx; padding:0 26rpx; ...}` 撞名，全局规则把每个字段块强压成 96rpx 高，块内正文溢出覆盖下一段。
  - 修复方式：模板与样式类名统一改为 `.prow / .prow-k / .prow-v`。纯样式改动，**未改任何政策文案**，第 2 节条款-代码依据表与政策正文口径全部不变。
  - 验证：本地 h5 产物 `assets/privacy-*.css` 含 `.prow` 规则；线上隐私 chunk 由 `pages-legal-privacy.DIR6-ACL.js`（21,984 B）换为 `pages-legal-privacy.BTKNoYzJ.js`（21,935 B），`prow`×54，原有断言（`2026-11-24`×2、`约 3 秒`×1、`设备与网络信息`×3、`DCloud 官方 CDN`×1）全部保持；ci `45398817405`、deploy `45398816428`、Android `45398816548` 三条 success。
