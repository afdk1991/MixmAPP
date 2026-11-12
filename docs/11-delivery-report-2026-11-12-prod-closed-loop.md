# 交付报告 · 生产闭环打通（前端不再是静态壳）

- 日期：2026-11-12
- 版本：**V0.0.0-preview**（内部预览，正式首发 V0.0.0 尚未占用，见 `docs/08-versioning.md`）
- 结论：**前端已连到真实生产 API 与云端数据库，并在公网域名完成“注册 → 加购 → 下单 → 幂等复放 → 我的订单 → 个人中心”全链路取证。**

---

## 1. 这轮修掉的真问题

### 1.1 生产注册 500（根因：SQL 桥参数替换把 bcrypt 哈希当占位符）

- 现象：`POST /api/v1/auth/register/username` 返回 500，日志 `syntax error at or near "114373126342574080"`（`/var/log/mixmapp/api.log`）。
- 根因：CloudBase PG SQL 桥 `public.mix_exec` 用文本 `replace()` 逐个替换 `$n`。当某个参数值本身是 bcrypt 哈希（`$2b$10$...`）时，它被插进 SQL 字面量后，后续再替换 `$2` 会把哈希里的 `$2b$` 二次替换，字符串引号被打断，SQL 语法错误。
- 修复：新增 `public.mix_literal(jsonb)` + `public.mix_bind(text, jsonb)`，改成**引号感知的逐字符扫描**——只在字符串字面量之外识别 `$n`（含 `''` 转义处理），`mix_exec` 先 bind 再执行。
- 迁移：`cloudbase/migrations/20261112234000_mix_exec_bind.sql`，已通过 `applyMigration` 应用到远端（`verified=true`，远端 17 条）。函数热替换，无需重启服务。

### 1.2 GitHub Pages H5 构建红灯（Undefined variable）

- 现象：`pages.yml` 在 `04ef41b` 上失败：`[vite:css] [sass] Undefined variable`，位置 `src/pages/admin/index.vue:18 background: $paper`。
- 根因：管理页 scoped SCSS 用了 `$paper / $sp-* / $r-*` 等变量，但仓库全局 `theme.scss` 里**没有定义任何 SCSS 变量**（只有字面色值），页面级样式不可能继承到。
- 修复：提交 `223a73b fix(admin): 管理页样式自带字面量`，把页面样式改成自包含字面量；本机在 `56dc545` 上重建 `build:h5` 通过（`DONE Build complete.`）。
- 验证：`pages.yml` 在 `28cb0ea` 上 **success**（run 43240472661）。

---

## 2. 生产环境事实与取证

### 2.1 生产 API

- 地址：`https://cloud.mixm.top/mixmapp/api/v1`（systemd 服务 `mixmapp-api`，env `/etc/mixmapp/api.env`，日志 `/var/log/mixmapp/api.log`）。
- 数据层：CloudBase 云 PG（实例 `pgdb-l81psxxv`）经 `public.mix_exec` SQL 桥读写；`switchable.ts` 中网关优先于 `DATABASE_URL`。
- 云端库事实：`mixmapp` schema 自有表 + 6 条种子；`public` 下另有 36 张别的业务表，未混用。

### 2.2 API 级 E2E（公网域名，真实云端库）

| 步骤 | 结果 |
|---|---|
| 用户名注册（bcrypt 哈希入库） | 成功，`prode2e86017`，user `114373453791887360`，号码 `MixmAPP-035J-P1KE-G000-0` |
| 加购 | `POST /mall/cart` → `45900` 分、1 行 |
| 下单 | `MOMWDNLVJN047617`，`45900` 分，`pending`，items=1，remark `prod e2e` |
| 同 `Idempotency-Key` 复放 | 返回同一 `MOMWDNLVJN047617`（未重复扣库存） |
| 我的订单 | `GET /mall/orders` → 1 条 |
| 个人中心 | `GET /me` → 该账号 |

云端库回查（只读 SQL）：

```
order_no           total_fen  status   remark     items  stock(mix-p-1002)
MOMWDNLVJN047617   45900      pending  prod e2e   1      63
```

### 2.3 浏览器级 E2E（真实点击，Pages 生产站）

站点：`https://afdk1991.github.io/MixmAPP/`（构建注入 API 源 `https://cloud.mixm.top/mixmapp/api/v1`）

| 页面动作 | 取证 |
|---|---|
| 商城列表 | 渲染 6 个商品，库存显示 63 / 498（即云端库当前值，不是静态写死） |
| 用户名注册 | `ui415128` / 昵称“浏览器生产验证” → 自动分配 `MixmAPP-035J-SBX7-R000-0`，user `114377106435080192` |
| 加购 | 石墨黑轻量冲锋衣 1 件，购物车小计 ¥459.00 |
| 结算提交 | 跳转订单详情，订单号 `MOMWDO6PT5181888`，待支付，¥459.00 |
| 云端库回查 | `MOMWDO6PT5181888` / 45900 分 / pending / receiver 浏览器验证 / items=1 / **库存 63→62** |

### 2.4 静态端（免费平台，逐平台取证）

| 平台 | 结果 | 证据 |
|---|---|---|
| GitHub Pages | ✅ 已发布成功 | run `43240472661` success（sha `28cb0ea`）；线上单文件 426,759 B，注入 API 源正确，含 `pages/mall/index`、`pages/cart/index`、`pages/admin/index` 路由 |
| CloudBase 静态托管（MixmAPP） | ✅ 新版本已上线 | `deployApp` → version `MixmAPP-002`，buildId `2612306866`，`Status=SUCCESS`；`https://mixmapp-cs-1-d5g815slocb5a611a.webapps.tcloudbase.com/` 返回 200、426,750 B、API 源 `cloud.mix.top`、含商城路由 |

### 2.5 CloudRun

- 服务 `mixmapp-api` 长期卡在 `creating`（`DescribeVersion_internal_error_`），已判定为平台侧拉镜像失败，`DeleteCloudRunServer` 删除（RequestId `e25725f6-1700-4783-8840-4024d6c9ff27`），生产 API 不再依赖 CloudRun。

---

## 3. 门禁（本机命令取证，基线 `28cb0ea`）

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm -r typecheck` | contracts / ids / api / app 全部 Done |
| 单元与接口测试 | `pnpm -r test` | `5 passed | 1 skipped`，`62 passed | 6 skipped`（含商城 8 例、认证 31 例） |
| H5 构建 | `MIXMAPP_H5_BASE=/MixmAPP/ pnpm --filter @mixmapp/app build:h5` | DONE |
| 单文件构建 | `node scripts/build-h5-single.mjs` | 416.7 KB（根路径版） |

---

## 4. 版本号与 README 同步

- `version.json`：`next=0.0.0`、`channel=preview`；API 默认 `APP_VERSION=0.0.0-preview`。
- 本轮为功能修复与生产部署，**不占用 V0.0.0**；README 版本块保持 `V0.0.0-preview`，已发布版本「无」。
- 正式对外首发时才写 `V0.0.0`，下一版 `V0.0.1`，依次递增。

---

## 5. 已知边界（不做假绿）

1. **手机验证码注册在生产不可用**：`mixmapp.sms_codes` 只存 `code_hash`，生产未配真实短信通道，API 也不回显验证码。要闭环手机注册，需接真实短信服务商（免费额度平台）或临时开 `DEV_ECHO_SMS_CODE`（不建议长期开）。本轮用「用户名 + 密码」注册完成真实闭环，前端注册页本身提供该入口。
2. **深链接在 GitHub Pages 返回 HTTP 404**（内容仍是同一单文件，浏览器可渲染，但状态码是 404，影响分享预览与 SEO）。彻底修法是把子路径构建切到 hash 路由，或改用支持 SPA 回退的平台；已记入待办，未在本轮改路由（避免影响既有链接）。
3. **Cloudflare Pages 仍未验证**：缺 API Token，`deploy-static.mjs` 存在但未跑通。
4. **Android release 签名**仍缺 keystore；本机无 Android SDK/adb/gradle，原生构建只在 CI 跑。

---

## 6. 复现命令

```powershell
# 生产 API 全链路（用户名注册，无需短信）
$base='https://cloud.mixm.top/mixmapp/api/v1'
# 注册 → POST /auth/register/username {username,password}
# 加购 → POST /mall/cart {productId,quantity}
# 下单 → POST /mall/orders {receiverName,receiverPhone,address,remark} + Idempotency-Key
# 订单 → GET /mall/orders ；个人中心 → GET /me

# 静态端重建
$env:MIXMAPP_API_BASE='https://cloud.mixm.top/mixmapp/api/v1'
$env:MIXMAPP_H5_BASE='/MixmAPP/'   # Pages 子路径
node scripts/build-h5-single.mjs
```
