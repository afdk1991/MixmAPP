# 交付报告 17 · 全站标志、字标与界面版式重设计

日期：2026-11-13
版本：`V0.0.0-preview`（未发布前功能补全，不占正式号）
范围：MixmAPP 全站（H5 / PWA / Android / iOS / 鸿蒙 / 小程序共用同一套 uni-app 页面）

## 1. 目标与判定

用户要求「整个项目所有 logo 字标重新设计 UI 布局排版界面等等」。据此拆成四件事，缺一不算完成：

1. **标志**：全站只有一套标志实现，不再各处手写「IF / MX」字样。
2. **字标**：`MixmAPP` 的字体、字重、字距、大小写规则统一。
3. **版式**：画布、深场、强调色、圆角、阴影、按钮高度、间距节奏统一到一组令牌。
4. **界面**：11 个路由逐页在真实浏览器里复核，视觉与源码一致。

## 2. 设计语言（本次改了什么）

| 维度 | 改前 | 改后 |
|---|---|---|
| 画布 | `#f2f5f3` 冷灰纸 | `#f4f4f1` 暖白纸 |
| 深场 | 蓝黑（`#05070f → #14234b`）+ 金色描边 | 石墨-墨绿（`#0b0f0e → #17322c`）+ 品牌青 |
| 强调色 | 青 + 金 + 天蓝三色并用 | 只保留 `#0f9d8f` 一色 |
| 展示字体 | 宋体衬线 600 | 系统无衬线 800 + `-2rpx` 负字距 |
| 控件圆角 | 按钮全部 `999rpx` 胶囊 | 统一 `12rpx`，仅状态 chip 保留胶囊 |
| 阴影 | 三层重投影 | 两层克制投影，卡片默认无影 |
| 标志 | 各处手写 `IF` / `MX` 文本 | 单一组件 `mx-logo`，方框 MX 连字 + 品牌青底线 |

设计令牌写在 `apps/app/src/uni.scss`，组件层写在 `apps/app/src/styles/theme.scss`——页面只做局部排版，不再写裸色值。

## 3. 改动清单

| 文件 | 改动 |
|---|---|
| `apps/app/src/uni.scss` | 重写色板 / 圆角 / 阴影 / 字体栈 / 字阶（新增 `$ls-tight`、`$ls-label`） |
| `apps/app/src/styles/theme.scss` | 重写按钮、字段、标签、空态、坞条、版心规则；eyebrow 改实心方块前导 |
| `apps/app/src/components/mx-logo/mx-logo.vue` | **新增**：`size=sm/md/lg`、`tone=ink/light`、可选字标与副标 |
| `apps/app/src/components/mx-bar/mx-bar.vue` | 顶栏标志改为引用 `mx-logo`，删掉手写 `MX` |
| `apps/app/src/pages/index/index.vue` | 首屏换 `mx-logo lg light`；底衬、Hero、CTA 三处配色统一到石墨/青 |
| `apps/app/src/pages/auth/login.vue`、`register.vue` | 标题 800 字重 + 负字距 |
| `apps/app/src/pages/me/index.vue` | 通行证深场、箔光、印章统一到石墨/青；证面标题 44rpx 800 |
| `apps/app/src/pages/mall/index.vue` | 商品封面从「每件一个亮色块」改为纸面索引卡（`$paper-2` + 墨色字 + 发丝环） |
| `apps/app/src/pages/mall/detail.vue` | 主视觉改石墨深场反白；标签、序列号、圆环全部换色 |
| `apps/app/src/pages/cart/index.vue` | 缩略图同纸面规则；结算条圆角收敛 |
| `apps/app/src/pages/settings/about.vue`、`admin/index.vue` | 深场配色对齐；关于页品牌区换 `mx-logo lg light` |
| `apps/app/src/static/logo.png|logo-192.png|logo-48.png|favicon.png` | 由 `scripts/brand-icon.py` 重新生成 |
| `scripts/brand-icon.py` | **新增**：按内框反解字号绘制图标，保证 MX 不越框 |
| `docs/brand/logo-1024.png` | 新增：标志母版 |

## 4. 门禁取证（命令）

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端类型 | `pnpm --filter @mixmapp/app typecheck` | EXIT=0，`vue-tsc --noEmit` 无输出 |
| 仓库规则 | `node scripts/repo-lint.mjs` | `✓ 规则检查通过` |
| 版本规约 | `pnpm version:check` | `✓ 版本一致：V0.0.0-preview`（包 6 个、env、config、manifest、gradle、前端常量、README、tag） |
| 单文件构建 | `node scripts/build-h5-single.mjs` | 364.0 KB（462.4 KB → 364.0 KB，图标资产瘦身约 98 KB） |
| 本地预览 | `GET http://127.0.0.1:8124/healthz` | `{"ok":true,"bytes":372753}` |

## 5. 浏览器逐页取证（本地预览，真实渲染）

| 页面 | 结果 |
|---|---|
| `/` 首页 | 顶栏 `mx-logo lg light`；Hero 石墨-青；CTA「查看联邦通行证」同色系；四个入口卡与六端覆盖正常 |
| `/pages/auth/login` | 标题 800 字重；GitHub 因本地注入测试凭据显示 `↗`，微信/QQ/Apple 显示「未启用」 |
| `/pages/auth/register` | 「创建 MixmAPP 账号」标题、四切成、游客入口、第三方区渲染正常 |
| `/pages/me/index` | 通行证深场、签发日期、6 ENDS、公民编号、账号资料 8 行、快捷入口、升级表单全部正常 |
| `/pages/mall/index` | 封面统一纸面索引卡；6 件商品价格/库存与 API 一致 |
| `/pages/mall/detail?id=mix-p-1001` | 主视觉深场反白，`¥299.00`、库存 120、商品说明、数量控件正常 |
| `/pages/cart/index` | 空态与 1 件商品两态均正常（加购后 `¥299.00 / 件`、小计、去结算） |
| `/pages/orders/index` | 空态「还没有订单 / 去商城」正常（游客账号真实无订单） |
| `/pages/settings/about` | 品牌区 `mx-logo lg light`；服务端能力 13 项（githubOAuth=on 等）、运行环境、管理后台入口正常 |
| `/pages/admin/index` | 数据库落点深场标题、管理令牌表单正常 |

## 6. 部署

| 平台 | 动作 | 结果 |
|---|---|---|
| GitHub Pages | push 触发 `pages.yml` | 待本轮 CI 结论（见报告末尾追加） |
| 腾讯云生产机 | push 触发 `deploy.yml`（API + H5 原子发布） | 待本轮 CI 结论 |
| CloudBase 静态站 | 本地按 `MIXMAPP_H5_BASE=/` + 生产 API 重建后 `manageApps` 重发 | 待本轮结论 |

## 7. 未解与边界

- 国内访问 `cloud.mix.top` 仍受 `*.mix.top → AWS Global Accelerator` 影响（TLS alert 112），属 DNS 权属问题，仓库侧无法自解。
- 四个第三方登录渠道的生产凭据仍需用户在平台侧创建；页面在未配置时如实显示「未启用」。
- 部分页面深场仍保留旧绿色调（`#08110f` 家族）的渐变残留，已统一替换为石墨家族；若后续要做第二套主题（浅色/高对比），令牌层已可复用。
