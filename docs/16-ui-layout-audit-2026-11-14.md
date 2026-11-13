# 全站界面布局与排版审计（2026-11-14）

## 一、审计范围

| 界面 | 位置 | 规模 |
|---|---|---|
| App / H5 / 小程序共用前端 | `apps/app/src/pages` | 10 个页面（首页、商城、商品详情、购物车、订单、我的、登录、注册、关于、数据库落点） |
| 全局组件 | `apps/app/src/components` | `mx-bar`（品牌栏）、`mx-logo`（标志）、`nav-back`（无页面引用的残留） |
| 原生壳 | `apps/mobile/android` | 启动图（port/land 各 5 档）、自适应图标前景、状态栏/导航栏主题 |
| 安装向导 | `install/ui.html` | 5 步桌面向导（环境检查、数据库、站点账号、安装、完成） |

`release/*.html` 是构建产物，不是独立界面，未单独审。

## 二、方法与判据

- 自动化：Edge headless + CDP，三档视口 **320×640 / 390×844 / 1440×900**，逐页导航后测量：
  - 横向溢出（元素超出视口、文档横向滚动）
  - 文字被裁（`nowrap` + `scrollWidth > clientWidth`）
  - 纵向内容被隐藏裁掉（`overflow:hidden` + `scrollHeight > clientHeight`）
  - 过小字号（< 10.5px）
- 人工复核：390 宽度逐页截图；安装向导 1440 与 420 两档截图；原生资源尺寸核算。
- 不覆盖：小程序真机（appid 仍为 `touristappid`）、iOS、横屏。

## 三、结论

| 视口 | 修复前问题数 | 修复后问题数 | 剩余性质 |
|---|---|---|---|
| 390×844 | 12 | 6 | 全部为被父容器裁掉的装饰元素 |
| 320×640 | 25 | 6 | 同上 |
| 1440×900 | 6 | 0 | — |

修复后 **没有一处文字被裁、没有一处字号低于 10.5px、没有横向滚动**；剩余 6 条是首页轨道光晕与通行证水印，父级 `overflow:hidden` 已裁切，不影响阅读与点击。

## 四、本轮修复

提交 `2fdfb34 fix(ui): 全站排版审计修复——后台页字号与按钮、长标题两行、底部安全区、触控面积`

1. **数据库落点页（admin）整页排版重写**
   - 原样式全用 `rem`，在 390/320 宽度被压成 10px 级小字；`0.6875rem` 内边距的按钮高度 46px，文字实际需要 50px，出现上下裁字。
   - 改为 rpx 体系：正文 26rpx、标题 40rpx、输入框 84rpx 高、按钮 84rpx 高 / 26rpx 字、卡片 24rpx 圆角、头部 32rpx 圆角；主按钮由青底改为与全站一致的墨色。
2. **长商品名不再一行截死**
   - 购物车、订单条目由 `nowrap + ellipsis` 改为两行 `line-clamp`，长标题能读全两行再截。
3. **底部安全区**
   - 购物车内容留白由固定 240rpx 改为 `calc(200rpx + env(safe-area-inset-bottom))`；商品详情改为 `calc(240rpx + env(safe-area-inset-bottom))`，手势条机型最后一行不会压在操作栏下。
4. **品牌微标字号**
   - `mx-logo` 小字 15/17/20rpx → 16/18/26rpx，`MX` 标志 22 → 26rpx；320 宽度下从 8.5px 提到 11.1px，不再糊成一条。
5. **触控面积**
   - 商城卡片加购圆钮 72 → 88rpx；购物车加减 64 → 80rpx、数量列 84rpx；详情加减 72 → 80rpx，减少误触。
6. **安装向导完成面板**
   - 完成信息长值加 `white-space:pre-wrap; word-break:break-all`，不再横向溢出。

## 五、仍需你决定的项

### P1
- **小程序真机**：代码已通过 H5 与编译级验证，但 `project.config.json` 的 appid 仍是 `touristappid`，无法出真机预览码；需要正式 AppID 才能验 rpx 在微信里的实际渲染。
- **H5 全屏场景顶部安全区**：品牌栏在 H5 上按设计把 `statusBarHeight` 取 0（否则手机浏览器会多出 42px 空白）。若用户把 H5「添加到主屏幕」全屏打开，刘海会压住品牌栏。修法是给 H5 模板加 `viewport-fit=cover` 并只在全屏态补 `env(safe-area-inset-top)`，需要 iOS 真机确认后再动。
- **原生启动图比例**：竖屏启动图是 1280×1920（2:3），主流手机是 9:20（0.45）。按 FIT 会留黑边，按 CROP 会裁掉上下。建议让出图侧按 9:20（1080×2400 / 1260×2800）重出一套 `drawable-port-*`。

### P2
- **我的页长编号**：320 宽度下 `MixmAPP-XXXX-XXXX-XXXX-X` 在资料行贴近换行临界，通行证卡内仍保持单行省略。需要定口径：允许两行，还是缩字号保单行。
- **商品详情角标**：右下 `NO. P-001` 与下方 sheet 圆角相切，视觉上像被切掉一角；可上移 12rpx。
- **首页装饰轨道线**：一条轨道弧线穿过首屏正文，属于设计意图，但在 320 小屏上正好压住两三行字；可把该弧线透明度降一档。

### P3
- **安装向导**：顶部步骤条已被并行会话刻意移除（`b98c01f`），本轮不恢复；仍存在只读输入框与可编辑框外观一致、420 宽度下按钮换行的问题。
- **并行遗留**：`components/nav-back/nav-back.vue` 无页面引用；`docs/screenshots/*.png` 仍是旧图；`release/` 下有 6 份 `index.html` 构建产物，若部署取错会看到旧 UI。
- **我的页真机顶部**：真机截图里通行证头被品牌栏截掉一截，H5 复测正常，暂判为滚动位置继承；下次真机若复现再按布局 bug 查。

## 六、复现

```powershell
# 1. 构建并同步隔离快照（mock API 同源）
pnpm --filter @mixmapp/app build:h5
# 把 apps/app/dist/build/h5 覆盖到 ui-review/site

# 2. mock 服务（8090）已在跑时，直接扫三档
node ui-review/audit2.mjs     # 输出 audit/layout-audit.json + audit/*-390.png

# 3. 安装向导
node ui-review/shot-install.mjs   # 依赖 install/ui.html，输出 audit/install-*.png
```
