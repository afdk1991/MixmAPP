# 交付报告 · 线上内容一致性修复（2026-11-12）

> 目标：用户指出「整个项目在所有平台的访问页中的内容不对」。本报告记录根因、修复、两平台重发与逐项取证，以及一个在验证过程中暴露出来的基础设施缺陷（如实记录，不粉饰）。

## 1. 根因

| 现象 | 根因 |
|---|---|
| GitHub Pages 与 CloudBase 都还是旧版白卡片界面（「第一步 创建账号 / 商城 MixmAPP 商城」） | 仓库工作树里已完成的全站改版（`apps/app/src` 14 个文件、约 3654 行）一直**没有提交、没有发版**；三端构建源仍是旧代码 |
| 新版首页「通行入口 / 05 ENTRIES」整块空白，`已接通的端` 却正常 | `.sheet.entries` 带 `animation: rise … both`，`@keyframes rise` 的 `from { opacity: 0 }`；浏览器把 CSS 动画冻结时（`getAnimations()` 的 `currentTime` 恒为 0、`playState` 仍 `running`），`fill: both` 让整块永久停在 0% 帧 → 内容永远不可见 |

## 2. 修复

1. `6ce6bb0` — `feat(ui): 全站改版为通行证视觉…`：提交 `App.vue`、`manifest.json`、`pages/auth/{login,register}.vue`、`pages/{cart,index,mall/detail,mall/index,me,orders,settings/about,tools/ids}.vue`、`styles/theme.scss`、`uni.scss`。提交前：`pnpm --filter @mixmapp/app typecheck` 通过、`node scripts/build-h5-single.mjs` 构建通过（462.1 KB）。
2. `1393512` — `fix(ui): rise 动效不再从透明起步…`：`@keyframes rise` 只保留 `translateY(18rpx) → 0`，删掉 `opacity` 起始帧。这样动画被冻结、或 `prefers-reduced-motion` 关闭动画时，内容也始终可见。

## 3. 部署取证（逐平台）

| 平台 | 动作 | 取证 |
|---|---|---|
| GitHub Pages | push `1393512` + `gh workflow run pages.yml` | run `43249567035` **success**；`curl https://afdk1991.github.io/MixmAPP/?v=fix2` 返回 473,145 B，产物内 `@keyframes rise{0%{transform:translateY(.5625rem)}to{transform:translateY(0)}`（已无 opacity） |
| CloudBase 静态托管 | `getUploadUrl` → `PUT` zip（368,900 B，HTTP 200）→ `deployApp` | 版本 `MixmAPP-004`，buildId `2612291692`，`Status=SUCCESS`，`https://mixmapp-cs-1-d5g815slocb5a611a.webapps.tcloudbase.com/` 展示同一新版 |

浏览器侧取证（同一浏览器、带 `?v=` 穿透 CDN 缓存）：

- Pages 首页：「MULTI-END IDENTITY / 通行证 · PASS / 一个账号 跑通所有端 / 覆盖 6 ENDS / 通行入口 05 ENTRIES（商城·登录·我的·ID 试算器·关于 五条全部可见）/ 已接通的端 COVERAGE 六端卡片 / BUILD · TEST · SHIP · OPS」，状态 `ONLINE`，已登录态显示「SIGNED IN 回到我的通行证」。
- Pages 登录页：`SIGN IN / 欢迎回来 / 密码·验证码·一键登录 / OAUTH`，与源码一致。
- Pages 商城页：`MIXMAPP STORE / 商城 / 6 ITEMS`，六件商品卡片与价格、库存渲染正常。

## 4. 门禁

- `deploy` 工作流 run `43250782370` 三个 job 全绿：`构建发布包`（`pnpm lint` / `typecheck` / `test` / `build:api` / `build:h5`）**success**、`API 原子发布（SSH）` **success**（健康检查 `状态：ok HTTP 200 版本 0.0.0-preview`、`db ok / dbTarget cloudbase`）、`静态端发布` **success**。
- `pages` run `43249567035` **success**（`@mixmapp/app` typecheck + 单文件 H5 构建 + Pages 发布）。

## 5. 暴露出的基础设施缺陷（未修完，如实记录）

现象：从中国大陆网络访问 `https://cloud.mix.top/mixmapp/api/v1/healthz`，TCP 可连但 TLS 握手被拒：

- `curl`（Windows schannel）：`SEC_E_ILLEGAL_MESSAGE`（fatal SSL/TLS alert）
- Node/OpenSSL：`ERR_SSL_TLSV1_UNRECOGNIZED_NAME`
- 服务器侧 `openssl s_client`：`tlsv1 unrecognized name`，`SSL alert number 112`
- 同一域名从 GitHub Actions runner（海外）健康检查 **HTTP 200** 通过，`deploy` 的 API 发布 job 也成功

解析层面：`cloud.mix.top` 与 `*.mix.top` 全部指向 AWS Global Accelerator 的 `13.248.169.48` / `76.223.54.146`，不是源站 IP；源站 nginx 正常监听 443（`server_name cloud.mix.top`，Certbot 证书），本机 `curl --resolve` 到 `127.0.0.1` 返回 200，说明源站本身健康，问题在加速链路的国内接入节点。

影响：国内用户打开 Pages / CloudBase 页面时，`/meta` 请求失败，首页状态显示 `OFFLINE`、商城走本地兜底数据、下单/登录不可用。这不是前端代码问题，改代码无法修复。

修复路径（都需要当前环境没有的凭据）：

1. 把 `cloud.mix.top`（或新增 `api.mix.top`）的 A 记录直接指向源站公网 IP，绕开 Accelerator；需要域名 DNS 管理权限。
2. 或把 API 部署到国内可直连的托管（CloudBase 云托管/云函数），并把前端 API 源切过去；需要 CloudBase 侧可用的容器/函数运行时配额与一次完整的数据库连接改造。

在此之前，前端已做降级：拿不到 `/meta` 时展示 `OFFLINE` 与「未连上 API（先启动 services/api）」提示，不伪造在线状态。

## 6. 结论

- 「所有平台访问页内容不对」的**内容层根因已消除**：两平台线上产物 = `1393512` 源码，逐页取证一致。
- 新发现的空白区块问题是动画实现缺陷，已修复并在两平台验证。
- 生产 API 的国内可达性属基础设施缺陷，已定位到加速节点层，需 DNS/托管权限才能闭环，本报告不宣称其已修复。
