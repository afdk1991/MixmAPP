# Android 构建手册（Capacitor 壳）

> 适用范围：`apps/mobile`（Capacitor 7.6.10 壳）+ `apps/app`（uni-app H5 产物）
> 本机验证时间：2026-11-12 02:14（UTC+8），debug APK 与 release AAB 均产出

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

# 2) 构建 H5（uni-app），**必须注入 API 源**
$env:MIXMAPP_API_BASE='https://cloud.mixm.top/mixmapp/api/v1'
node scripts/build-h5.mjs                    # 产物：apps/app/dist/build/h5，index.html 里带 window.__MIXMAPP_API_BASE__

# 3) 同步到 Android 工程
pnpm --filter @mixmapp/mobile exec cap sync android

# 4) 壳产物体检（漏注入会在这里红，不用等装到手机上才发现）
node scripts/android-check-assets.mjs

# 5) 打包
node scripts/android-build.mjs assembleDebug
```

> **为什么必须注入**：壳的 WebView 从 `https://localhost` 加载 `assets/public` 里的本地 H5。
> 不注入 API 源时，客户端按"生产态同源"退回 `/api/v1`，实际请求打到 `https://localhost/api/v1`，
> 结果是装出来的 APP 全站离线（首页状态一直 `OFFLINE · 未连上 API`）。
> 2026-11-13 的 debug APK 就是这个状态，现已修正，并由 `scripts/android-check-assets.mjs` 兜住：
> 缺注入、取值不是绝对地址、缺 `/api/v1` 后缀，三种情况都会 exit 1。


产物（本机实测）：

| 文件 | 体积 | 说明 |
|---|---|---|
| `app/build/outputs/apk/debug/app-debug.apk` | 4.13 MB | 含 24 个 `assets/public/*` H5 资源，可直接安装 |
| `app/build/outputs/bundle/release/app-release.aab` | 3.03 MB | **未签名**（未提供签名环境变量），不可上架 |

---

## 3. release 签名

签名信息全部来自环境变量，代码里不写死、不入库：

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

流程：`pnpm install --frozen-lockfile` → `node scripts/build-h5.mjs`（带 `MIXMAPP_API_BASE`）→ `cap sync android` → `node scripts/android-check-assets.mjs` → `setup-java 21` → `assembleDebug` → （有签名 Secrets 时）`bundleRelease` → 上传 artifact。

CI 里的 API 源：默认 `https://cloud.mixm.top/mixmapp/api/v1`，可用仓库变量 `vars.MIXMAPP_API_BASE` 覆盖（换域名不用改工作流）。

判定口径：

- 没有签名 Secrets 时只产出 debug APK，且工作流输出 `::warning::未配置签名 Secrets……不得视为可发布产物`。
- 有签名 Secrets 时才产出 release AAB，缺失则作业失败（`if-no-files-found: error`）。
- 壳产物体检失败（H5 没注入 API 源）时，工作流在打包前就红。

---

## 6. 版本号：只有一个事实源

`apps/mobile/android/app/build.gradle` 不再写死版本号，改为构建期读仓库根 `version.json`：

| gradle 字段 | 来源 |
|---|---|
| `versionCode` | `version.json.build`（单调递增，Play 要求只增不减） |
| `versionName` | `version.json.next` + `--channel`（非 `stable` 追加 `-<channel>`，如 `0.0.0-preview`） |

实测（2026-11-13）：`version.json` = `{next:0.0.0, build:100, channel:preview}` → APK badging `versionCode='100' versionName='0.0.0-preview'`；
临时改成 `build:101 / channel:stable` → `versionCode='101' versionName='0.0.0'`，改回即复原。文件缺失时构建直接抛 `GradleException`，不会再静默退化成 1。

---

## 7. 尚未做的部分

- **真实 keystore 未配**（需生成或提供，`keytool -genkeypair`，不入库；缺它只能出 debug APK + 未签名 AAB）。
- **图标/启动图仍是 Capacitor 默认占位**：`res/mipmap-*` 与 `res/drawable-*splash.png` 都是模板素材，没换成这一轮的 MX 徽标/星际联邦视觉，装出来和品牌对不上。
- **物理返回键与外链**未做专门处理：`MainActivity` 只是空壳 `BridgeActivity`；H5 内部靠 history 退栈，从外部链接（OAuth 授权页等）进来时没有明确策略，也没有把站外链接交给系统浏览器的分流。
- **没有真机回归**：`adb` 可用但未接设备，CI 只 `assembleDebug`，不安装、不启动、不验证 API 连通性。
- **两套打包路径并存**：`apps/app` 的 uni-app 自带 `build:app` 与本手册的 Capacitor 路径，不要同时用来出 Android 包，否则会出现两套签名与两套产物口径。
- `allowBackup` 已从 `true` 改为 `false`（本地存着令牌，不该被云备份带走到另一台设备上）。

