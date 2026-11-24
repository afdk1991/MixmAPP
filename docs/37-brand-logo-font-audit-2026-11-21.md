# 37 · 品牌 Logo 图片与字体现状审计（2026-11-21）

> 范围：MixmAPP 全端（H5 / Android）的标志、图标、启动屏图片与字体栈。
> 口径：只做现状盘点、派生链厘清与问题分级；品牌造型、字体选型、旧资源删除属决策项，未擅自改动。

## 1. 结论速览

- **现行视觉体系**：纸底 `#F4F4F1` + “MixmAPP” 整词黑字 `#111111` + 品牌青底线 `#0F9D8F`。矢量唯一源 `apps/mobile/branding/mixm-logo.svg`，PNG 由 `apps/mobile/branding/generate-icons.py` 派生。
- **运行时 logo**：顶栏 / 首页 / 关于页用 `components/mx-logo/mx-logo.vue` 纯 CSS 复刻 svg 版式，不引用任何 PNG。
- **Android 图标与启动屏**：mipmap 启动器图标、自适应前景、drawable 启动屏均为现行浅底体系，链路一致。
- **字体未打包**：`$font-display` 首项 `Inter Tight`、`$font-mono` 首项 `JetBrains Mono` 在仓内无 `@font-face`、无 woff/woff2、无 CDN 引入，设备上并不存在，标题与等宽数字实际回退系统字体。
- **发现两套旧体系残留脚本与图片**（深底 MX 方框 / 几何 M 渐变），CI 不调用；处置需拍板。
- 本轮已落地一处低风险修正：H5 favicon 由 1024 大图改指 48 小图，并补 `apple-touch-icon`（本地构建 + lint 通过，**尚未推送上线**）。

## 2. 资源清单与引用点

### 2.1 H5 静态图标（`apps/app/src/static/`，构建整体拷入产物 `/static/`）

| 文件 | 尺寸 | 体系 | 引用点 | 状态 |
| ---- | ---- | ---- | ---- | ---- |
| `logo.png` | 1024×1024 | 现行浅底整词 | 旧 `index.html` favicon（本轮已改指他图） | 保留为 PWA 大图标母版 |
| `logo-192.png` | 192×192 | 现行浅底整词 | 本轮新增 `apple-touch-icon` | 正常 |
| `logo-48.png` | 48×48 | 现行浅底整词 | 无直接引用 | 与 favicon 同图（969B 重复） |
| `favicon.png` | 48×48 | 现行浅底整词 | 本轮改后 `rel=icon` | 正常 |
| `splash.png` | 1242×2688 | **旧深底 MX/MIXMAPP** | H5 代码与 manifest 均未引用 | 死资源残留，见 §5-B3 |
| `tab/home|mall|cart|me.png` | 81×81 透明 | 现行灰 `#8A938F` | `pages.json` tabBar `iconPath` | 正常 |
| `tab/*-active.png` | 81×81 透明 | 现行青 `#0F9D8F` | `pages.json` tabBar `selectedIconPath` | 正常 |

线上实测（`https://cloud.mixm.top/static/`）：上述五张 PNG 全部 200，`Content-Type: image/png`。

### 2.2 品牌母版与上架图（`apps/mobile/branding/`）

| 文件 | 尺寸 | 体系 | 说明 |
| ---- | ---- | ---- | ---- |
| `mixm-logo.svg` | 900×300 矢量 | 现行 | 全项目唯一矢量源，注释内含几何/取色/派生常量 |
| `icon-512.png` | 512×512 | 现行浅底整词 | 上架商店图 |
| `preview-mixm.png` | 1130×420 | **旧深底三格预览** | 中间 48dp 格发虚；已过时 |

### 2.3 Android（`apps/mobile/android/app/src/main/res/`）

| 资源 | 体系 | 引用 |
| ---- | ---- | ---- |
| `mipmap-*/ic_launcher.png` | 现行浅底圆角方块整词 | `AndroidManifest.xml` `android:icon` |
| `mipmap-*/ic_launcher_round.png` | 现行浅底圆形裁切 | `android:roundIcon` |
| `mipmap-*/ic_launcher_foreground.png` | 现行透明前景整词 | `windowSplashScreenAnimatedIcon` |
| `drawable{,-port,-land}-*/splash.png` | 现行浅底整词 + `MIXMAPP ACCOUNT` | `windowBackground` 兜底 |
| `values/ic_launcher_background.xml` | 纸底 `#F4F4F1` | 自适应图标背景 / 启动屏背景 |

### 2.4 运行时标志组件

- `components/mx-logo/mx-logo.vue`：白底圆角胶囊 + “MixmAPP”（800 字重、字距 -0.03em）+ 品牌青下划线；尺寸 `sm/md/lg`，色调 `ink/light`，可选等宽副标 `sub`。
- 引用点：`mx-bar.vue`（顶栏 `sm`）、`pages/index/index.vue`（首屏 `sm`）。

## 3. 派生脚本与现行判定

仓内共 5 个品牌/图标脚本，**CI workflow 与 package.json 均不调用**，均为本地手动执行。

| 脚本 | 体系 | 产物 | 判定 |
| ---- | ---- | ---- | ---- |
| `apps/mobile/branding/generate-icons.py` | 现行浅底 “MixmAPP” 整词 | Android mipmap 15 + 启动屏 11 + 背景色 + icon-512 + H5 4 图 | **现行源**，与 svg 同源 |
| `scripts/brand-icon.py` | 旧深底 MX 方框 + `MIXMAPP` + `MULTI-END IDENTITY` | H5 4 图、Android 图标/启动屏、`docs/brand/` 母版 | **过时**（2026-11-14 体系，被 11-15 整词体系取代） |
| `scripts/gen-brand-assets.py` | 最旧：几何 M 多边形 + 墨蓝→青绿渐变 | H5 logo/192/48/favicon/splash | **过时遗留**，产物已被覆盖 |
| `scripts/gen-tab-icons.mjs` | 现行 tab 图标（灰/青两态） | `static/tab/` 8 张 | 现行 |
| `scripts/fit-splash-aspect.py` | 历史启动图比例校正工具 | 仅修尺寸，不画视觉 | 辅助工具 |

> 注：`docs/brand/logo-1024.png`、`wordmark-1024x256.png` 为 `brand-icon.py` 深底 MX 体系母版，与现行浅底整词不一致。

## 4. 字体栈现状

定义于 `apps/app/src/uni.scss`：

```scss
$font-display: 'Inter Tight', 'HarmonyOS Sans SC', 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif;
$font-body:    -apple-system, BlinkMacSystemFont, 'PingFang SC', 'HarmonyOS Sans SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
$font-mono:    'SF Mono', 'JetBrains Mono', 'Cascadia Mono', 'Roboto Mono', Consolas, 'Courier New', monospace;
```

- **无打包字体**：全仓无 `@font-face`、无 `.ttf/.otf/.woff/.woff2`、无 Google Fonts / 外链引入（已全量检索确认）。
- **悬空首项**：`Inter Tight`、`JetBrains Mono`、`SF Mono`、`Cascadia Mono`、`Roboto Mono` 在多数设备上不存在，浏览器按顺序回退到系统 PingFang / 雅黑 / Consolas。
- **使用场景**：`.serif`（展示标题 800 负字距）、`.mono`、`.micro`、`.eyebrow` 原子类，以及 mx-logo 字标与各页标题/数字/标签。
- 后果：设计稿“粗重、负字距的展示无衬线”与等宽数据字形，在未装对应字体的设备上由系统字体替代，字形宽度与字重观感存在偏差；不影响功能与可读性。

## 5. 问题分级

### 5.1 本轮已落地（本地，未推送）

- **P1 favicon 引用低效**：`index.html` 原先 `rel=icon` 指向 1024×1024（25KB）`logo.png`。已改为 48×48 `favicon.png`，并补 `<link rel="apple-touch-icon" href="/static/logo-192.png">`。本地 `build:h5` 构建通过，产物 `index.html` 两条 link 保留、static 五图全部拷入；`repo-lint` 通过。

### 5.2 建议低风险修正（不改造型/配色，待确认后一并提交）

- **B1 README 口径过时**：原写“方框 MX 连字 / `scripts/brand-icon.py` 生成 / 母版 `docs/brand/logo-1024.png`”。本轮已更正为现行 mx-logo 整词组件 + `generate-icons.py` + svg 矢量源。
- **B2 文档启动图描述过时**：`docs/android-build.md` §启动图 仍写“深底 + MX 方框 + MixmAPP + MULTI-END IDENTITY”，与现行浅底整词不符，需更新或加注。
- **B3 H5 `static/splash.png` 死资源**：旧深底体系残留，H5 未引用。三选一：① 从 `generate-icons.py` 补产出浅底 H5 splash；② 直接删除；③ 保留不动。
- **B4 重复小图**：`favicon.png` 与 `logo-48.png` 同图同体积，可合并只留一份并更新引用。

### 5.3 待拍板（品牌 / 选型决策，本轮未动）

- **C1 字体落地路径**
  - 路径①**打包 Web 字体**：取 Inter Tight（展示）与 JetBrains Mono（等宽）的 OFL woff2 子集入仓，`@font-face` 引入，字形贴合设计稿；代价是增加 H5 包体（需子集化拉丁/常用字符控制体积），并走离线自包含、不引外部 CDN。
  - 路径②**纯系统栈**：移除不存在的首项字体名，把可靠系统无衬线 / 等宽提到首位；零包体，字形随设备，放弃跨端字形一致性。
- **C2 字标大小写与副标文案统一**
  - 字标：svg / mx-logo / logo 系列 / Android 图标为 `MixmAPP`；旧 splash 残留与 privacy 页脚为全大写 `MIXMAPP`。需定唯一写法。
  - 副标三处不一致：`MIXMAPP ACCOUNT`（Android 启动屏）/ `SINGLE SIGN-ON · 多端通行同一账号`（svg）/ `MULTI-END IDENTITY`（旧深底体系）。需定唯一副标。
- **C3 旧脚本与旧母版处置**：`gen-brand-assets.py`、`brand-icon.py`、`docs/brand/` 两张深底母版、`branding/preview-mixm.png` 是否归档或删除，避免后人误跑出旧视觉。
- **C4 小尺寸辨识**：48dp/48px 下 7 字符整词偏挤（svg 注释亦注明“48dp 下整词会糊”）。是否在小尺寸改用缩写 mark（如 MX 方块）需品牌决策。

## 6. 复核记录

- 本地 `node scripts/build-h5.mjs`：DONE Build complete；产物 `dist/build/h5/index.html` 含两条图标 link，`static/` 五图齐全。
- `node scripts/repo-lint.mjs`：规则检查通过。
- 线上（改动前基线）：`/static/{logo,logo-192,logo-48,favicon,splash}.png` 全 200，`image/png`；H5 主包与 Android 壳内 H5 同 hash。
- 未做：字体打包、旧资源删除、造型重绘；本轮改动尚未 commit / push。
