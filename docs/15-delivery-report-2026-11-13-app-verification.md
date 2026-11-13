# 交付报告 15 · 项目 APP 逐页验证（2026-11-13）

本轮只做验证与取证，不新增业务功能，因此版本号保持不变：**V0.0.0-preview**（`version.json` next 仍为 `0.0.0`，未占号）。
唯一的功能性改动是「本地联调示例商品种子」，只在显式开关下生效，不影响生产数据。

## 一、静态检查与构建（命令取证）

| 项 | 命令 | 结果 |
|---|---|---|
| 前端类型检查 | `pnpm --filter @mixmapp/app typecheck` | **EXIT=0** |
| API 类型检查 | `pnpm --filter @mixmapp/api typecheck` | **EXIT=0** |
| API 单元测试 | `pnpm --filter @mixmapp/api test` | **5 files passed / 1 skipped；62 passed / 6 skipped**（EXIT=0） |
| H5 单文件构建 | `node scripts/build-h5-single.mjs` | **DONE**，`release/mixmapp-h5-single.html` **472,994 B（461.9 KB）** |
| Android 构建 | CI `android.yml` run `43249554493` | conclusion **success**，artifact `mixmapp-debug-apk` **3,949,665 B** |

## 二、构建产物逐页渲染验证（本地 SPA 回退服务）

GitHub Pages 对深链接直接返回 GitHub 自身 404（不是 SPA 内容），因此线上直链无法验证页面。
本轮用 `scripts/preview-spa.mjs` 起了本地 SPA 回退服务（任意路径都返回单文件产物）：

```
GET /healthz        -> {"ok":true,"bytes":472994}
GET /pages/mall/index -> deep=200 size=472994
```

对 `release/mixmapp-h5-single.html` 的 11 个路由逐个渲染（浏览器取页面文本比对标识串）：

| 路由 | 标识串 | 结果 |
|---|---|---|
| pages/index/index | 通行证 | **OK**（通行证 · PASS / 6 ENDS / 05 ENTRIES 可见） |
| pages/auth/login | SIGN IN | **OK**（密码 / 验证码 / 一键登录 / OAUTH 三栏齐全） |
| pages/auth/register | 注册 | **OK**（手机号 / 邮箱 / 用户名注册表单齐全） |
| pages/me/index | 通行证 | **OK**（未登录态显示 NO PASS 引导，登录态显示真实通行证） |
| pages/mall/index | MIXMAPP STORE | **OK**（种子数据就位后 6 ITEMS，含价格与库存） |
| pages/mall/detail | 商品 | **OK**（详情页可渲染） |
| pages/cart/index | 购物车 | **OK**（空态 / 有货态均正常） |
| pages/orders/index | 订单 | **OK**（订单记录与状态渲染正确） |
| pages/tools/ids | ID FORGE | **OK**（雪花 / ULID / UUIDv7 切换 + 发号按钮） |
| pages/settings/about | 关于 | **OK**（v0.0.0-preview / 能力矩阵 / 运行环境） |
| pages/admin/index | ADMIN TOKEN | **OK**（落点读取 + 管理令牌表单） |

## 三、真实登录与购买闭环（本地 API + 浏览器，全链路点击）

本地 API 以 `ALLOW_MEMORY_STORE=1`、`SEED_DEMO_PRODUCTS=1`、`PORT=8099` 启动，浏览器把 API 基址指向它，
全程用真实点击（不注入数据、不伪造响应）：

1. 注册（API 层取证）：`POST /auth/register/username` → 账号号码 `MixmAPP-035W-1HMH-M000-0`，`isNewUser=true`。
2. 浏览器 UI 登录：登录页填账号密码点「登录」→ 跳转 `/pages/me/index`，页面显示
   `MIXMAPP PASS / MixmAPP-035W-1HMH-M000-0 / 持有者 MixmAPP用户0000 / 注册时间 2026/11/13 20:27:48`。
3. 商城加购：商城页点第一件商品「+」→ 提示「已加入购物车」→ 进购物车显示
   `1 件 · 1 个商品 / MixmAPP 首发限定礼盒 / ¥299.00 / 库存 120`。
4. 下单：点「去结算」→ 填收货人 / 手机号 / 地址 / 备注 → 提交 → 跳转
   `/pages/orders/index?orderNo=MOMWEYGJS5493121`，订单卡显示 `待支付 / ¥299.00 / 138****8000 / 浙江省宁波市鄞州区验证路 1 号`。
5. 库存回写取证：`GET /mall/products/mix-p-1001` → `stock` 由 **120 变 119**。

结论：商城 → 购物车 → 订单 → 库存扣减整条链路在真实代码上跑通，不是界面壳子。

## 四、线上平台验证（逐平台取证）

| 平台 | 观察点 | 结果 |
|---|---|---|
| GitHub Pages `https://afdk1991.github.io/MixmAPP/` | 首页状态行 | **ONLINE · 服务在线 · production 环境**（`/meta` 请求 `status=ok`） |
| GitHub Pages → 商城（从首页点 `01 商城`） | 商品列表 | **6 ITEMS**，六件商品价格与库存全部来自生产 API（`cloud.mix.top` 请求 `status=ok`） |
| GitHub Pages → 购物车 | 加购后进入 | **3 件 · 1 个商品 · ¥897.00**，生产购物车真实回显，`/mall/cart` 请求 `status=ok` |
| CloudBase `https://mixmapp-cs-1-d5g815slocb5a611a.webapps.tcloudbase.com` | 首页状态行 | **OFFLINE · 未连上 API**；`/meta` 返回 `net::ERR_SSL_UNRECOGNIZED_NAME_ALERT` |
| Android | CI 产物 | APK 3,949,665 B 可下载；AAB 仍缺 keystore |

同一套前端产物、同一份源码：Pages 能连上生产 API 并显示真实数据，CloudBase 域名下同一请求报 TLS 112 —— 差异在域名/链路，不在代码。

补充取证（部署后复核，commit `7e95353` / `d2037a0`）：

- `deploy.yml` run `43426421623`（`7e95353`）：**completed success**，三个 job 全绿
  —— 构建发布包 success / 静态端发布（Cloudflare Pages）success / API 原子发布（SSH）success。
- `deploy.yml` run `43426983222`（`d2037a0`，并行提交 nginx vhost 修正）：**completed success**，三个 job 同样全绿。
- `ci` run `43426421578`、`Image` run `43426421612` 均 success。
- 部署后再开 Pages 首页：`状态 ONLINE · 服务在线 · production 环境`；点 `01 商城` 仍为 **6 ITEMS** 且价格/库存与生产库一致，控制台无报错。
- 直接访问 `https://cloud.mix.top/` 根路径仍是 `ERR_SSL_UNRECOGNIZED_NAME_ALERT`；但页面内对 `https://cloud.mix.top/mixmapp/api/v1/*` 的请求返回 `ok` 并带回真实生产数据（两条路径的差异属域名/加速器链路问题，与前端无关）。

## 五、本轮发现与处置

| # | 发现 | 处置 |
|---|---|---|
| 1 | Pages 深链接直接 404，线上逐页验收无法用直链 | 新增 `scripts/preview-spa.mjs`，本地 SPA 回退验证 11 路由；线上改为从首页真实点击逐页验收 |
| 2 | 内存驱动无商品，本地商城/购物车/订单只能看空态与 401 | 新增 `services/api/src/db/demo-seed.ts`，种子与 `infra/sql/0002_mall.sql` 同源（同 id/价格/库存/排序），仅 `SEED_DEMO_PRODUCTS=1` 且内存驱动时注入，单元测试断言不受影响（62 passed） |
| 3 | 未登录访问购物车/订单时会先抛资源 401 再跳登录页，控制台留 3 条 Type{Error} 噪声 | 已确认页面有错误分支与跳登录逻辑，属预期的 401 表现，非页面崩溃；未改代码，记录在案 |
| 4 | CloudBase 域名下 API 恒不可达（TLS 112） | 本轮复核确认仍存在，根因与报告 13 一致（`*.mix.top` 在 AWS GA，国内节点不可用） |

## 六、版本号规约复核

- `version.json`：`next=0.0.0`、`build=100`、`channel=preview`、`released=[]`（未占号）
- 6 个工作区包 version 均为 `0.0.0`；`manifest.json` versionName `0.0.0` / versionCode `100`
- 展示版本 `apps/app/src/version.ts` → `0.0.0-preview`；README 版本块一致
- 本轮无 git tag、无 GitHub Release；对外正式发布仍为 0 次

## 七、残留与下一步

1. CloudBase 平台仍 OFFLINE：需 `mix.top` DNS 管理权（把 `cloud.mix.top` 指到自有反代）或换自定义域名，两项凭据当前均不可得。
2. Android AAB 缺 keystore，正式包无法签名发布。
3. 小程序 / 鸿蒙 / 快应用仅 manifest 已配，尚无对应 CI 产物。
