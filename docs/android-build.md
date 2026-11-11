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

# 2) 构建 H5（uni-app）
pnpm --filter @mixmapp/app build:h5        # 产物：apps/app/dist/build/h5

# 3) 同步到 Android 工程
pnpm --filter @mixmapp/mobile exec cap sync android

# 4) 打包
cd apps/mobile/android
.\gradlew.bat assembleDebug                 # 产物：app/build/outputs/apk/debug/app-debug.apk
```

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

流程：`pnpm install --frozen-lockfile` → `build:h5` → `cap sync android` → `setup-java 21` → `assembleDebug` → （有签名 Secrets 时）`bundleRelease` → 上传 artifact。

判定口径：

- 没有签名 Secrets 时只产出 debug APK，且工作流输出 `::warning::未配置签名 Secrets……不得视为可发布产物`。
- 有签名 Secrets 时才产出 release AAB，缺失则作业失败（`if-no-files-found: error`）。

---

## 6. 尚未做的部分

- 未配置真实 keystore（需要你生成或提供，建议 `keytool -genkeypair`，存放位置不入库）。
- 未接 `adb install` / 真机回归（本机 `adb` 已可用，但没有连接设备）。
- `apps/app` 的 uni-app 自带 `build:app` 仍存在；本手册走的是 Capacitor 路径，两者不要同时用于出 Android 包，否则会出现两套签名与两套产物口径。
