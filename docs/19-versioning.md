# 版本号规约（三段式 V0.0.0 起）

> 单一事实源：`version.json`
> 执行脚本：`scripts/version.mjs`
> 门禁：`pnpm version:check`（`ci.yml` 在安装依赖后第一道跑，失败即整条流水线红）
> 基线确立：2026-11-14，全平台 / 全渠道强制重置到 `V0.0.0`

---

## 1. 规则

| 场景 | 版本形态 | 说明 |
|---|---|---|
| 基线（全平台 / 全渠道） | `V0.0.0` | 2026-11-14 强制重置，release / preview / dev 都从这一点起算 |
| 正式发布递增 | `V0.0.0` → `V0.0.1` | 只递增第三段，不跳号 |
| 预览期 | `0.0.0-preview`、`0.0.0-preview.1`、`.2`…… | `channel=preview`，后缀计数独立 |
| 开发期 | `0.0.0-dev`、`0.0.0-dev.1`、`.2`…… | `channel=dev`，后缀计数独立 |
| 三段基线 | 不随后缀计数变化 | 预览 / 开发只动后缀，不动 `X.Y.Z` |
| npm 包版本 | `X.Y.Z` | 就是三段号本身，不再做截断映射 |
| Android / uni-app `versionCode` | 整数 | `versionCode = 1 + major*10000 + minor*100 + patch`（`0.0.0 → 1`、`0.0.1 → 2`） |

三条硬约束：

1. **发布前不得占用正式版本号**——没真正对外发布，`version.json` 的 `released` 里不能出现该号，仓库里也不能存在同名 git tag。
2. **渠道必须可区分**——预览 / 开发一律带 `-preview[.N]` / `-dev[.N]`；正式发布态不带任何后缀。
3. **与 README 同步**——README 顶部的版本块由脚本生成，手改会被 `version:check` 判红。

> **强制重置态（2026-11-14）**：`version.json` 为 `version: "0.0.0"`、`channel: "release"`、`released: []`、`counters: { preview: 0, dev: 0 }`。此时 release 展示 `0.0.0`、preview 展示 `0.0.0-preview`、dev 展示 `0.0.0-dev`；**下一个号才是递增后的值**（`0.0.0-preview.1` / `0.0.0-dev.1` / release 的 `0.0.1`）。

---

## 2. 数据结构

`version.json`：

```json
{
  "version": "0.0.0",        // 当前三段工作号
  "channel": "release",      // release | preview | dev
  "released": [],            // 已正式发布的三段号，只增不减
  "counters": {              // 非正式通道的后缀计数器，各自独立
    "preview": 0,
    "dev": 0
  }
}
```

- 展示号：`release` → `version`；`preview` / `dev` → `version-channel`，计数 > 0 时追加 `.N`。
- `released` 只用于记录「哪些号真正对外发过」与 tag 校验；它不影响当前构建的展示号。
- `version` 是唯一递增位：release 走第三段，preview / dev 走后缀计数。
- `build.gradle` 构建期直接解析根 `version.json` 计算 `versionName` / `versionCode`，不写字面量。

---

## 3. 命令

```bash
pnpm version:show           # 打印状态（含展示号 / versionCode）
pnpm version:check          # 一致性门禁（CI 用）
pnpm version:sync           # 同步到 7 个包 / .env.example / config.ts / install/server.mjs / README / manifest / version.ts
pnpm version:bump           # release：第三段 +1（0.0.0 → 0.0.1）
pnpm version:bump:preview   # preview：后缀计数 +1（0.0.0-preview → 0.0.0-preview.1）
pnpm version:bump:dev       # dev：后缀计数 +1（0.0.0-dev → 0.0.0-dev.1）
pnpm version:release        # 正式发布：把当前号登记进 released（不改号），提示打 tag
```

`version:release` 只做登记与文件同步，**不会自动打 tag**——tag 一旦推送会触发 `deploy` 上线，必须由发布流程显式执行，避免误触发。

---

## 4. 一次正式发布的完整动作

```bash
pnpm version:bump               # 0.0.0 → 0.0.1（第一次发布可跳过，直接用 0.0.0）
pnpm version:release            # 登记 0.0.1 进 released
git add -A
git commit -m "release: V0.0.1"
git tag -a v0.0.1 -m "MixmAPP V0.0.1"
git push origin main v0.0.1     # 推送 tag 才会触发部署
```

基线 `V0.0.0` 尚未登记 `released`、远端也**没有**任何 tag；按用户约束，远端 tag 只列建议不擅自创建。

---

## 5. 覆盖的文件

| 文件 | 字段 | 写法 | 由脚本写入 |
|---|---|---|---|
| `version.json` | `version` / `channel` / `released` / `counters` | 三段式 | — |
| `package.json`、`apps/*/package.json`、`services/*/package.json`、`packages/*/package.json` | `version` | 三段号 `X.Y.Z` | ✅ |
| `cloudbase/functions/mixmapp-api-proxy/package.json` | `version` | 三段号 `X.Y.Z` | ✅ |
| `.env.example` | `APP_VERSION` | 展示号（可能带 `-channel[.N]`） | ✅ |
| `services/api/src/config.ts` | `str('APP_VERSION', '…')` 默认值 | 展示号 | ✅ |
| `apps/app/src/version.ts` | `APP_VERSION`（页面展示兜底） | 展示号 | ✅（整文件生成，勿手改） |
| `install/server.mjs` | `APP_VERSION=…` | 展示号 | ✅ |
| `apps/app/src/manifest.json` | `versionName` / `versionCode` | 三段号 / 整数 | ✅（只改这两字段，保留原格式） |
| `apps/mobile/android/app/build.gradle` | `versionName` / `versionCode` | 运行时解析根 `version.json` | ✅（消费侧取号，脚本只校验接线、不回写） |
| `README.md` | `<!-- version:begin -->` 与 `<!-- version:end -->` 之间 | 带 `V` 前缀 | ✅ |

新增工作区包或独立部署包时，把它的 `package.json` 路径补进 `scripts/version.mjs` 的 `PKG_FILES`，否则 `version:check` 不会覆盖它。

### 各端 / 各渠道映射

| 端 / 渠道 | 版本落点 | 当前值（重置态） |
|---|---|---|
| Web / H5（uni-app H5） | `APP_VERSION`（API 运行时） + 前端 `version.ts` | `0.0.0` |
| 微信小程序（mp-weixin） | 构建产物 `version.js` ← `version.ts`；平台版本在开发者后台另填 | `0.0.0` |
| Android（Capacitor 壳） | `versionName` = `version[-channel[.N]]`；`versionCode` = 公式 | `0.0.0` / `1` |
| Android / iOS（HBuilderX 云打包） | `manifest.json` 的 `versionName` / `versionCode` | `0.0.0` / `1` |
| iOS 原生工程 | 仓库内无 `ios/` 工程；若启用，`CFBundleShortVersionString` 用三段号，`CFBundleVersion` 用公式值 | 预留映射 |
| Harmony | 仓库内无 `app.json5` 原生工程，走 uni-app `build:app-harmony`，版本取 `manifest.json` | `0.0.0` |
| API | `APP_VERSION` 环境变量 / `config.ts` 默认值 | `0.0.0` |
| CloudBase 云函数 | `package.json.version` | `0.0.0` |
| 安装包 / 桌面壳 | 无桌面端（Tauri/Electron）工程；安装包命名取展示号 | `mixmapp-install-0.0.0.tar.gz` |
| 渠道 preview / dev | `version.json.channel` + `counters[channel]` | `0.0.0-preview` / `0.0.0-dev` |

> iOS / App Store 注意：`CFBundleShortVersionString` 只接受三段数字，当前版本号本就三段，无适配负担。preview / dev 带后缀的展示号只用于内部构建，不提交商店。

---

## 6. 历史文档与构建产物

- `docs/09`、`10`、`11`、`13`、`15`、`16`、`17`、`23`、`24`、`27`、`2026-11-14/` 等带日期的交付 / 取证 / 诊断报告是**历史证据链**，其中的旧版本号（四段式、`-preview`、`build=101` 等）保持原样，不代表当前版本；当前口径只认 `version.json` + README 版本块 + 本文件。
- `release/`、`out/`、`apps/app/dist/`、`apps/mobile/android/app/src/main/assets/public/`、`apps/mobile/android/app/build/` 下的产物由构建生成，不手工编辑；版本重置后必须按 `build:api → build:h5 → sync:android` 顺序全链重建，否则线上 / APK 仍可能内嵌旧号。
- **仓库已 `V0.0.0` ≠ 线上回包 / APK 已 `V0.0.0`**，收尾以生产 `/healthz`、`/meta` 回包与 APK badging 为准。

---

## 7. 常见误操作

| 误操作 | 结果 |
|---|---|
| 连续跑两次 `version:release`（中间没 bump） | 第二次直接报错：当前号已登记为 released |
| 连续跑两次 `version:release`（中间没打 tag） | 再 bump 后发布时报错：上一版还没打 tag，说明并未真正发布 |
| 手工把 `version` 改成已发布的号 | `version:check` 报「已登记为 released，工作号必须前进」 |
| 只改 `package.json` 不改 README | `version:check` 红：README 版本块不同步 |
| 把四段号写进任何版本位 | `version:check` 直接拒绝：`version.json version 不是合法三段式 X.Y.Z` |
| 只改 manifest 不改 Android gradle（或反之） | `version:check` 红：两处 `versionCode` / `versionName` 必须相等 |
| 先打 tag 再发布 | `version:check` 红：`tag v… 已存在，但尚未发布（不得提前占用）` |
