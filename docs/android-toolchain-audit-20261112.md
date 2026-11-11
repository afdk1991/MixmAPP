# Android 工具链审计与落地记录（2026-11-12）

> 范围：本机（`DESKTOP-76LMJJU` / Windows）+ `F:\合并项目\MixmAPP`
> 方式：只读盘点 → 用户确认「全部实现」后执行修复与构建 → 实测取证
> 结论：**SDK / adb 本来就有，缺的是 PATH、cmdline-tools、JDK 21 与 Android 工程；四项均已补齐，debug APK 与 release AAB 已在本机产出。**

---

## 1. 工具链现状（修复后）

| 组件 | 状态 | 证据 |
|---|---|---|
| Android SDK | ✅ 已装 | `%LOCALAPPDATA%\Android\Sdk`，`ANDROID_HOME`/`ANDROID_SDK_ROOT` 均指向 |
| adb | ✅ 已装且**已在 PATH** | `adb version` → 1.0.41 / 37.0.1-15733141 |
| sdkmanager | ✅ **新装到当前 SDK** | `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat`，`--version` → 1.1.16717390 |
| emulator | ✅ 已在 PATH | 37.2.12.0，system-image `android-37.0\google_apis_playstore` |
| Gradle | ⚠️→✅ 无全局命令，**wrapper 可用** | `android/gradle/wrapper` 指向 8.14.3；本机命中缓存，`gradlew.bat` 直接构建成功 |
| JDK | ✅ 17 与 **21 并存** | 17 = `jdk-17.0.20.101-hotspot`；21 = `jdk-21.0.13.21-hotspot`（本次安装） |

SDK 组件：build-tools `35.0.0` / `36.0.0`，platforms `android-36` / `android-37.0`，platform-tools 含 `adb`/`fastboot`。

---

## 2. 执行过的修复

| # | 动作 | 结果 |
|---|---|---|
| 1 | 用户 PATH 追加 `platform-tools`、`build-tools\36.0.0`、`emulator`、`cmdline-tools\latest\bin` | 新终端 `adb`/`emulator`/`sdkmanager` 可直接调用 |
| 2 | 用**旧 SDK** 的 sdkmanager 带 `--sdk_root` 把 `cmdline-tools;latest` 装进**当前 SDK** | 当前 SDK 补齐 `cmdline-tools`，未污染旧 SDK |
| 3 | 安装 Microsoft OpenJDK 21 | `C:\Program Files\Microsoft\jdk-21.0.13.21-hotspot` |
| 4 | 新建 `apps/mobile`（Capacitor 7.6.10 壳），`cap add android` 生成原生工程 | `apps/mobile/android` 落地，含 gradlew |
| 5 | `gradle.properties` 固定 `org.gradle.java.home` 为 JDK 21 | 避开用户级 `JAVA_HOME`（Android Studio 的 JBR 25） |
| 6 | wrapper 版本改为 8.14.3（与缓存一致） | 本地不再触发下载；CI 正常下载 |
| 7 | 增加 `android.overridePathCheck=true` | 绕过 AGP 对中文路径的硬拦截 |
| 8 | `app/build.gradle` 增加 release 签名块（读环境变量） | 无 Secrets 时不签名，有 Secrets 时签 AAB |
| 9 | 新增 `.github/workflows/android.yml` | push/PR/dispatch 构建，产物上传，缺签名显式告警 |

---

## 3. 三个坑与最终结论

1. **PATH 缺 SDK 子目录** → 已补（用户级持久化）。
2. **cmdline-tools 只在旧 SDK**（`C:\Program Files (x86)\Android\android-sdk\cmdline-tools\latest`）→ 已用 `--sdk_root` 装进当前 SDK。
3. **Java 版本**：原判断是「JDK 17 足够、JBR 25 有风险」，实测更正为——**Capacitor 7 的 `capacitor-android` 模块 `sourceCompatibility = VERSION_21`**，JDK 17 直接报 `无效的源发行版: 21`；JBR 25 也不合适。最终固定 JDK 21。

补充两个只在本机会出现的坑：

4. **仓库路径含中文**（`F:\合并项目\...`）→ AGP 拒绝构建，需 `android.overridePathCheck=true`。
5. **`services.gradle.org` 证书链不全**（PKIX handshake failed）→ wrapper 下载 8.11.1 失败；改用本机已缓存的 8.14.3 后不再联网。npm 与 `dl.google.com` 不受影响。

---

## 4. 实测产物

| 文件 | 体积 | 说明 |
|---|---|---|
| `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` | 4.13 MB | 含 24 个 `assets/public/*` H5 资源 |
| `apps/mobile/android/app/build/outputs/bundle/release/app-release.aab` | 3.03 MB | `jarsigner -verify` 显示**未签名**（无签名 Secrets，符合预期） |

构建命令与 CI 口径见 `docs/android-build.md`。

---

## 5. 插件/技能侧

- 已安装插件中没有 Android/Gradle 相关项（EdgeOne、Etsy、GitHub、GitLab、Gitee、Playwright、Todoist、cartula、qveris、cloudbase、地图、蜂鸟）。
- 插件市场检索 `Android SDK Gradle build` 无可安装项。
- 结论：Android 能力来自本机 SDK 与项目 wrapper，插件无法替代 `sdkmanager` / `adb` / Gradle。

---

## 6. 仍未做

- 真实 keystore 未生成/未配置（`ANDROID_KEYSTORE_BASE64` 等 4 个 Secrets 为空）。
- 未执行真机安装（`adb devices` 当前无设备）。
- 未在真实 CI 上跑过（仓库尚未 push，工作流未经远端验证）。
- uni-app 自带的 `build:app` 未关闭；Android 出包口径以 Capacitor 为准，两者不可并行。
