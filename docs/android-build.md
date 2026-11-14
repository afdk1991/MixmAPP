# Android 构建手册（Capacitor 壳）

> 适用范围：`apps/mobile`（Capacitor 7.6.10 壳）+ `apps/app`（uni-app H5 产物）
> 本机验证时间：2026-11-14（UTC+8），debug APK 产出并通过模拟器冒烟

---

## 1. 版本钉住

| 组件 | 版本 | 位置 |
|---|---|---|
| Node | 22 | 本机 / CI `setup-node@v4` |
| pnpm | 9.12.0 | `packageManager` 字段 |
| JDK | **21**（Capacitor 7 的 `sourceCompatibility = VERSION_21`） | `android/gradle.properties` → `org.gradle.java.home` |
| Gradle | 8.14.3 | `android/gradle/wrapper/gradle-wrapper.properties` |
| AGP | 8.7.2 | `android/build.gradle` |
| compileSdk / targetSdk | 35 | `android/variables.gradle` |
| minSdk | 23 | 同上 |
| applicationId | `top.mixm.app` | `android/app/build.gradle` |

> JDK 17 **不够**：Capacitor 7 的 `capacitor-android` 模块按 Java 21 编译，用 17 会报 `无效的源发行版: 21`。

---

## 2. 本地构建

```powershell
# 0) 终端已具备：ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
#    PATH 含 platform-tools / build-tools\36.0.0 / emulator / cmdline-tools\latest\bin

# 1) 装依赖（首次或锁文件变化后）
pnpm install --frozen-lockfile

# 2) 构建 H5（uni-app）
node scripts/build-h5.mjs                    # 产物：apps/app/dist/build/h5

# 3) 同步到 Android 工程 + 注入 API 源（一步到位，别再裸跑 cap sync）
pnpm --filter @mixmapp/mobile sync:android

# 4) 壳产物体检（可选，sync 脚本已内置同样的检查）
node scripts/android-inject-base.mjs --check

# 5) 打包
node scripts/android-build.mjs assembleDebug
```

> **为什么必须注入**：壳的 WebView 从 `https://localhost` 加载 `assets/public` 里的本地 H5。
> 不注入 API 源时，客户端按"生产态同源"退回 `/api/v1`，实际请求打到 `https://localhost/api/v1`，
> 结果是装出来的 APP 全站离线（首页状态一直 `OFFLINE · 未连上 API`）。
> 2026-11-13 的 debug APK 就是这个状态。现在注入由 `sync:android` 兜住（读 `apps/mobile/api-base.json`，
> 可用环境变量 `MIXMAPP_API_BASE` 覆盖）：缺注入、取值不是绝对地址、缺 `/api/v1` 后缀，三种情况都 exit 1。


产物（本机实测）：

| 文件 | 体积 | 说明 |
|---|---|---|
| `app/build/outputs/apk/debug/app-debug.apk` | 4.13 MB | 含 24 个 `assets/public/*` H5 资源，可直接安装 |
| `app/build/outputs/bundle/release/app-release.aab` | 3.03 MB | 签名随构建环境而定：本机有 `.secrets` 凭证时自动签（见第 3 节）；CI 需配置签名 Secrets，否则为未签名包、不可上架 |

---

## 3. release 签名

优先读环境变量（CI Secrets），四项不全时回退到仓库根 `.secrets/`：`keystore.properties`（口令/别名）+ `release.keystore`（证书本体）。该目录已 gitignore，凭证明文不入库；本机这两个文件已就位。

| 变量 | 含义 |
|---|---|
| `ANDROID_KEYSTORE_PATH` | keystore 绝对路径 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 口令 |
| `ANDROID_KEY_ALIAS` | 别名 |
| `ANDROID_KEY_PASSWORD` | 别名口令 |

四项齐全 → `signingConfigs.release` 生效，`bundleRelease` 产出已签名 AAB；缺任意一项 → 不配置签名，产物为未签名包，CI 会打 `::warning::` 并明确「不得视为可发布产物」。

CI Secrets 名称（`.github/workflows/android.yml`）：

- `ANDROID_KEYSTORE_BASE64`（keystore 的 base64，工作流内解码为 `release.keystore`）
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

---

## 4. 两个环境坑（已在仓库内处理）

1. **仓库路径含中文**
   `F:\合并项目\MixmAPP` 触发 AGP 的 `Your project path contains non-ASCII characters`。
   处理：`android/gradle.properties` 增加 `android.overridePathCheck=true`。CI 是纯 ASCII 路径，不受影响。

2. **`services.gradle.org` 证书链**
   本机 wrapper 下载 Gradle 8.11.1 时报 `PKIX path building failed`（中间证书链不全），而 npm / dl.google.com 正常。
   处理：wrapper 版本改为 **8.14.3**（本机 `~/.gradle/wrapper/dists` 已有缓存，wrapper 直接命中，不再联网）；CI 无此问题，正常下载。
   若换机器且无缓存：用 Android Studio 自带的 Gradle 或手动放置发行版，别硬走 wrapper 下载。

---

## 5. CI

`android.yml` 触发：`apps/app/**`、`apps/mobile/**`、`packages/**` 变更，或手动 dispatch（可勾选 release）。

流程：`pnpm install --frozen-lockfile` → `node scripts/build-h5.mjs`（带 `MIXMAPP_API_BASE`）→ `pnpm --filter @mixmapp/mobile sync:android`（sync + 注入）→ `node scripts/android-inject-base.mjs --check` → `setup-java 21` → `assembleDebug` → （有签名 Secrets 时）`bundleRelease` → 上传 artifact。

CI 里的 API 源：默认 `https://cloud.mixm.top/mixmapp/api/v1`，可用仓库变量 `vars.MIXMAPP_API_BASE` 覆盖（换域名不用改工作流）。

判定口径：

- 没有签名 Secrets 时只产出 debug APK，且工作流输出 `::warning::未配置签名 Secrets……不得视为可发布产物`。
- 有签名 Secrets 时才产出 release AAB，缺失则作业失败（`if-no-files-found: error`）。
- 壳产物体检失败（H5 没注入 API 源）时，工作流在打包前就红。

> **为什么注入要放在 sync 之后**：任何人只要跑一次裸的 `pnpm --filter @mixmapp/app build:h5` + `cap sync android`，就会把注入覆盖掉（2026-11-14 在真机上复现过一次：装上去 `injectedBase="(未注入)"`、首页恒 OFFLINE）。
> 所以 `apps/mobile` 的 `sync:android` = `cap sync android && node ../../scripts/android-inject-base.mjs`，注入值来自 `apps/mobile/api-base.json`（可用环境变量覆盖）。走这条脚本，谁构建都不会漏。

---

## 6. 版本号：只有一个事实源

`apps/mobile/android/app/build.gradle` 不再写死版本号，改为构建期读仓库根 `version.json`：

| gradle 字段 | 来源 |
|---|---|
| `versionCode` | `1 + major*10000 + minor*100 + patch`（由 `version.json.version` 推导，单调递增，Play 要求只增不减） |
| `versionName` | `release` 取 `version.json.version`（三段裸号）；`preview` / `dev` 追加 `-<channel>`，计数 > 0 时再加 `.N`（如 `0.0.0-preview.1`） |

**重置态口径（2026-11-14）**：`version.json` 为
`{version:"0.0.0", channel:"release", released:[], counters:{preview:0,dev:0}}`，`node scripts/version.mjs show`
的 display 是 `V0.0.0`。此时 APK 的 `versionName` 必须是 **`0.0.0`**、`versionCode=1`，
与展示层、README、manifest、7 个包（含 CloudBase 云函数）对齐到同一个号。

三段号与整数的映射：`versionCode = 1 + major*10000 + minor*100 + patch`
（`0.0.0 → 1`、`0.0.1 → 2`、`0.1.0 → 101`、`1.0.0 → 10001`）；每次出包必须用 APK/AAB badging 复核。
文件缺失时构建直接抛 `GradleException`，不会静默退化成 1。

> 门禁接线约束：`scripts/version.mjs check()` 会用正则校验本文件必须保留
> `rootProject.file('../../../version.json')`、`new groovy.json.JsonSlurper().parseText`、
> `mixmVersion.version` 读取、`versionCode mixmVersionCode` + `mixmVersionCode = 1 +`、
> `versionName mixmVersionName` + **`mixmVersionName = mixmBaseVersion`** 这些接线。
>
> 注意：`check()` **只校验接线、不校验 `versionName` 的最终取值**，门禁全绿不代表出包版本名正确；
> **出包时必须用 APK/AAB badging 复核** `versionName` / `versionCode`。

---

## 7. 图标与启动图

不再是 Capacitor 模板素材，画法取自 `apps/app/src/components/mx-logo/mx-logo.vue`（方框内 MX 连字 + 品牌青底线），色值取自 `uni.scss`（`$deep #0b0f0e` / `$paper #f4f4f1` / `$brand #0f9d8f`）。

单一事实源是生成脚本，**不要手改 PNG**：

```bash
python apps/mobile/branding/generate-icons.py
```

产物（27 个文件）：

| 类别 | 文件 | 规格 |
|---|---|---|
| 传统图标 | `mipmap-{mdpi..xxxhdpi}/ic_launcher.png` | 48/72/96/144/192，深底圆角方块 |
| 圆形图标 | 同上目录 `ic_launcher_round.png` | 同尺寸，圆形裁切 |
| 自适应前景 | 同上目录 `ic_launcher_foreground.png` | 108/162/216/324/432，透明层，内容收在 66% 安全区 |
| 启动图 | `drawable`/`drawable-port-*`/`drawable-land-*/splash.png` | 11 张，深底 + MX 方框 + MixmAPP 字标 + MULTI-END IDENTITY |
| 底色 | `values/ic_launcher_background.xml` | `#0B0F0E` |

---

## 8. 返回键与外链

`MainActivity` 不再是空壳，两件事都在原生层兜住：

**返回键**：Android 15+ 对 targetSdk 35 默认开启预测性返回，`Activity.onBackPressed()` **不再被调用**（本项目实测 API 36 上改造前返回键完全失效）。现在走 `OnBackPressedDispatcher`：
1. `webView.canGoBack()` 为真 → `goBack()`（pushState 的页面跳转也算在历史栈里）；
2. 否则按 `location.pathname` 判断当前 H5 路由（uni-app H5 未暴露全局 `getCurrentPages`）：
   不在首页就 `history.replaceState('/pages/index/index')` + 派发 `popstate` 回到首页 tab；
3. 到根部 → 弹「再按一次退出」，2 秒内再按才 `finish()`。
4. 首启隐私同意页（`/pages/legal/privacy?mode=gate`）上按返回键只提示「请先阅读并同意隐私政策」，不能用返回绕过门禁。

实测：`我的`/`商城` → 返回落到首页；首页按一次不退出、连按两次回到桌面；首启同意页返回不跳首页。

**外链**：壳的 WebView 只服务本地 H5（`https://localhost` / `127.0.0.1` / `file:` / `about:` / `capacitor:`），命中站外地址时用 `ACTION_VIEW` 交系统浏览器，壳本身不被导航走。实测 `https://example.com/x?from=mixmapp` 跳进 vivo 浏览器，回到 App 仍在原页。

---

## 9. 真机冒烟

```bash
node scripts/android-smoke.mjs                        # 第一台在线设备 + debug APK
node scripts/android-smoke.mjs --serial 10AE3Y0LGQ0018Z
node scripts/android-smoke.mjs --require-api         # API 不可达也判失败（CI 用）
```

检查项：设备在线 → APK 存在 → 装 → 启 → 进程存活 → logcat 无本应用 FATAL → WebView 可调试 → API 源已注入 → 壳内 `fetch /healthz` → 截图（`apps/mobile/android/app/build/smoke/smoke.png`）。

判定：装不上/启不来/崩溃/没注入 = 失败；抓不到调试通道、`/healthz` 不通 = 告警（生产会短时抖动，加 `--require-api` 才判死）。

2026-11-14 实测输出：

```
✓ 设备在线：10AE3Y0LGQ0018Z
✓ 安装：Success
✓ 启动：TotalTime: 609
✓ 进程存活：8019
✓ logcat 无本应用崩溃
✓ 壳内 WebView 可调试：https://localhost/
✓ API 源已注入：https://cloud.mixm.top/mixmapp/api/v1
✗ 壳内探活 /healthz：fetch 失败: Failed to fetch
冒烟结果：9/10 通过
```

`/healthz` 那一条是当时线上 443 短暂拒连（同一时刻本机 `Test-NetConnection cloud.mixm.top -Port 443` 也是 False，恢复后 WebView 内 `fetch` 返回 `200 application/json`）。**这说明冒烟脚本能抓到后端抖动，而不是只看 APK 装成功了事。**

---

## 10. 尚未做的部分

- **release 签名核验尚未做**：本机 keystore 已就位（`.secrets/keystore.properties` + `.secrets/release.keystore`，目录已 gitignore、不入库），`bundleRelease` 会自动使用它；但「用正式 keystore 出包并核验签名/指纹」这一步还没执行，需等确认后再做。CI 侧仍依赖签名 Secrets。
- **OAuth 回跳还没有深链**：站外链接现在交给浏览器，但授权完成后不会自动回到 App（需要 `intent-filter` + `appUrlOpen` 处理，且要和服务端 redirect_uri 对齐）。
- **两套打包路径并存**：`apps/app` 的 uni-app 自带 `build:app` 与本手册的 Capacitor 路径，不要同时用来出 Android 包，否则会出现两套签名与两套产物口径。
- `allowBackup` 已从 `true` 改为 `false`（本地存着令牌，不该被云备份带走到另一台设备上）。


