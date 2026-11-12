# 版本号规约（V0.0.0 起）

> 单一事实源：`version.json`
> 执行脚本：`scripts/version.mjs`
> 门禁：`pnpm version:check`（`ci.yml` 在安装依赖后第一道跑，失败即整条流水线红）

---

## 1. 规则

| 场景 | 版本形态 | 说明 |
|---|---|---|
| 首个对外正式发布 | `V0.0.0` | 只有真正上线那一刻才占用 |
| 之后每次功能 / 模块更新 | `V0.0.1`、`V0.0.2`…… | 只递增补丁位，不跳号 |
| 内部 / 预览 / 草稿构建 | `V0.0.0-preview` | 默认状态，任何人任何时候看到的都不是正式号 |
| 正式上线 | `V0.0.0`（去掉 `-preview`） | 同时打 `v0.0.0` tag |

三条硬约束：

1. **发布前不得占用正式版本号**——没真正对外发布，`version.json` 的 `released` 里不能出现该号，仓库里也不能存在同名 git tag。
2. **预览与正式必须可区分**——预览构建一律带 `-preview`，不允许拿 `V0.0.0` 冒充未发布版本。
3. **与 README 同步**——README 顶部的版本块由脚本生成，手改会被 `version:check` 判红。

---

## 2. 数据结构

`version.json`：

```json
{
  "next": "0.0.0",        // 下一个待发布号（也是当前工作版本号）
  "channel": "preview",   // preview | release
  "released": []          // 已正式发布的号，只增不减
}
```

- `next` 同时写进 6 个 `package.json`（npm 只接受裸 semver，不能带 `V` 前缀）。
- 展示层（QPS 横幅、README、`APP_VERSION`）才用 `V0.0.0-preview` 这种带前缀 + 后缀的形式。
- `released` 是「已占用」的账本；`next` 一旦出现在 `released` 里，`version:check` 直接失败。

---

## 3. 命令

```bash
pnpm version:show      # 打印状态与展示版本
pnpm version:check     # 一致性门禁（CI 用）
pnpm version:sync      # 把 version.json 同步到 6 个包 / .env.example / config.ts / README
pnpm version:bump      # 递增补丁号（要求当前号已发布，否则拒绝）
pnpm version:release   # 正式发布：登记 released、推进 next、重写展示版本
```

`version:release` 只做登记与文件同步，**不会自动打 tag**——tag 一旦推送会触发 `deploy` 上线，必须由发布流程显式执行，避免误触发。

---

## 4. 一次正式发布的完整动作

```bash
pnpm version:release            # 登记 V0.0.0，工作版本推进到 V0.0.1-preview
git add -A
git commit -m "release: V0.0.0"
git tag -a v0.0.0 -m "MixmAPP V0.0.0"
git push origin main v0.0.0     # 推送 tag 才会触发部署
```

发布后的状态：`released: ["0.0.0"]`、`next: "0.0.1"`、`channel: "preview"`，
README 显示「当前构建版本 V0.0.1-preview / 已发布版本 V0.0.0」。

功能/模块更新按同样方式继续：`version:release` → 提交 → 打下一个 tag。

---

## 5. 覆盖的文件

| 文件 | 字段 | 写法 | 由脚本写入 |
|---|---|---|---|
| `version.json` | `next` / `channel` / `released` | — | ✅ |
| `package.json`、`apps/*/package.json`、`services/*/package.json`、`packages/*/package.json` | `version` | 裸 `X.Y.Z` | ✅ |
| `.env.example` | `APP_VERSION` | `X.Y.Z-preview` | ✅ |
| `services/api/src/config.ts` | `str('APP_VERSION', '…')` 默认值 | `X.Y.Z-preview` | ✅ |
| `apps/app/src/version.ts` | `APP_VERSION`（页面展示兜底） | `X.Y.Z-preview` | ✅（整文件生成，勿手改） |
| `apps/app/src/manifest.json` | `versionName` | 裸 `X.Y.Z` | ✅（只改该字段，保留原格式） |
| `apps/mobile/android/app/build.gradle` | `versionName` | 裸 `X.Y.Z` | ✅（只改该字段） |
| `README.md` | `<!-- version:begin -->` 与 `<!-- version:end -->` 之间 | 带 `V` 前缀 | ✅ |

两类写法不能混：**构建元数据用裸版本号**（npm、`manifest.versionName`、Android `versionName`——应用商店与 Gradle 只认数字形态），**展示层带 `-preview`**（README、API `APP_VERSION`、前端 `version.ts`、关于页/首页）。页面不再手写版本字面量，统一 `import { APP_VERSION } from '../../version'`。

`versionCode`（`manifest.json` 的 `100`、Android 的 `1`）是构建号不是版本号，每次发版才递增，暂未纳入本脚本统一；发版时两处需手工对齐。

新增工作区包时，把它的 `package.json` 路径补进 `scripts/version.mjs` 的 `PKG_FILES`，否则 `version:check` 不会覆盖它。

---

## 6. 常见误操作

| 误操作 | 结果 |
|---|---|
| 未发布就 `version:bump` | 直接报错：`还没正式发布，不能先占用下一个号` |
| 手工把 `next` 改成 `0.0.1` 再发布 | `version:check` 报 `0.0.1 已在 released`（若已登记）或与 README 不一致 |
| 只改 `package.json` 不改 README | `version:check` 红：README 版本块不同步 |
| 先打 tag 再发布 | `version:check` 红：`tag v0.0.0 已存在，但尚未发布（不得提前占用）` |
| 预览包直接对外宣称 `V0.0.0` | 违反可区分约束，发布记录里没有该号即为未发布 |
