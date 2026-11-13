# 交付报告 16 · 第三方登录真实闭环（2026-11-13）

> 版本：**V0.0.0-preview**（未对外发布，不占用正式版本号 `V0.0.0`）
> 范围：登录页四个第三方入口从「装饰性跳转符」变成可真实发起授权的闭环，并如实呈现未配置 / 不可达两种状态。

## 1. 问题与根因

用户观察到登录页 GitHub / 微信 / QQ / Apple 四个按钮都带 `↗`，看起来能跳转。核查后确认那是纯装饰符：

- `apps/app/src/pages/auth/login.vue` 的 `oauthLogin()` 直接调 `loginByOAuth(provider)`；
- `stores/session.ts` 的 `getOAuthCode()` 从当前 URL 取 `code`，取不到就抛「未获取到第三方授权 code」；
- 前端从未把用户送到渠道授权页，所以 `code` 永远不存在，四个按钮 100% 失败。

后端此时已有 `exchange()`（四个渠道的换码与验签）与 `POST /auth/login/oauth`，唯独缺「发起授权」这一跳。

## 2. 实现

### 后端

| 文件 | 变更 |
|---|---|
| `services/api/src/adapters/oauth.ts` | `OAuthProvider` 增可选 `authorizeUrl(redirectUri, state)`；GitHub → `github.com/login/oauth/authorize`、微信 → `open.weixin.qq.com/connect/qrconnect` + `#wechat_redirect`、QQ → `graph.qq.com/oauth2.0/authorize`；Apple 在 H5 只能端侧 JS 拉起，返回 `null` |
| `services/api/src/routes/oauth.ts`（新增） | `GET /auth/oauth/:provider/start`：未配置 → 503 `PROVIDER_DISABLED`；已配置 → 生成 48 位 hex `state`（内存 map、TTL 10 分钟、上限 2000、过期清理）并 302 到授权页，`redirect_uri` 固定回本站 `/auth/oauth/:provider/callback`，回跳地址只放行 http/https（防开放重定向）。`GET /auth/oauth/:provider/callback`：校验 `state` 与 provider 匹配并一次性消费，把 `code` 或 `oauthError` 拼回原页面，不在服务端换码（保持既有 `POST /auth/login/oauth` 契约） |
| `services/api/src/app.ts` | 在 `/api/v1` scope 内注册 `oauthRoutes` |
| `services/api/src/modules/auth.ts` | 换码阶段的底层异常（网络不可达、证书失败）统一收敛为 `PROVIDER_ERROR(502)`，不再漏出 500 |

回调基址优先读 `PUBLIC_BASE_URL`；仍是本地默认值时按请求 `Host` 与路径前缀反推，兼容 `https://cloud.mix.top/mixmapp/api/v1` 这类带前缀部署。

### 前端

- `apps/app/src/api/client.ts` 新增 `oauthStartUrl(provider, redirect?)`；
- `login.vue` 按 `/api/v1/meta` 的 `thirdParty` 开关渲染：
  - 已启用 → 显示 `↗`，点击 H5 整页跳 `/auth/oauth/:provider/start`；非 H5 提示需接对应 SDK（不做假跳转）；
  - 未配置 → 显示「未启用」灰态，**不显示箭头**，点击只提示未启用；
  - `/meta` 拉取失败 → 显示「不可用」+「登录服务暂不可达，渠道状态无法确认」，不把「拿不到状态」伪装成「未启用」；
- `readOAuthReturn()` 在 `onMounted` 读回 `code` / `oauthProvider` / `oauthError`，带 `code` 时自动完成登录，带 `error` 时提示授权被取消。

## 3. 静态检查与自测（命令取证）

| 检查 | 命令 | 结果 |
|---|---|---|
| API 类型 | `pnpm --filter @mixmapp/api typecheck` | EXIT=0 |
| 前端类型 | `pnpm --filter @mixmapp/app typecheck` | EXIT=0 |
| 单元测试（全量） | `pnpm --filter @mixmapp/api test` | **68 passed / 6 skipped**（改动前 62 passed） |
| 本次新增用例 | `vitest run test/oauth.test.ts` | **7 passed** |
| H5 单文件重建 | `node scripts/build-h5-single.mjs` | DONE，`release/mixmapp-h5-single.html` 473,049 B |

新增用例覆盖：未配置 503、Apple H5 不支持 503、已配置 302 且 `redirect_uri` 指向本站 callback、回跳带回 `code` 且 `state` 一次性（重放 422）、伪造 state 与 `javascript:` 回跳被挡、渠道回传 `error` 转成 `oauthError`、换码异常收敛 502。

## 4. 浏览器取证（本地真实链路）

本地 API（8099，注入假 GitHub 凭据以便验证「已配置」分支）+ 单文件预览（8124）：

| 场景 | 实测结果 |
|---|---|
| 已配置渠道 | GitHub 显示 `↗`，点下后整页跳到 `https://github.com/login/oauth/authorize?client_id=test-client-id&redirect_uri=…%2Fauth%2Foauth%2Fgithub%2Fcallback&state=…` |
| 未配置渠道 | 微信 / QQ / Apple 显示「未启用」，点击后 URL 仍停在登录页，不发任何跳转 |
| 授权回跳 | 访问 `/auth/oauth/github/callback?code=…&state=…` → 302 回 `pages/auth/login?code=…&oauthProvider=github`，页面自动发起换令牌；假凭据下服务端返回 502 `PROVIDER_ERROR` 并如实提示 |
| 服务不可达 | 把 API 基址指向不存在端口 → 四个按钮显示「不可用」+「登录服务暂不可达，渠道状态无法确认」 |

`state` 一次性已验证：同一 state 第二次回跳返回 422 `CODE_INVALID`。

## 5. 部署取证

| 平台 / 工作流 | run / 版本 | 结论 |
|---|---|---|
| `ci` | `43435404865`（4c1a3cc） | completed **success** |
| `Android` | `43435404857`（4c1a3cc） | completed **success**（产出 debug APK 链路可跑） |
| `deploy` | `43435404927`（4c1a3cc） | completed **success**，job 全绿：构建发布包 / API + H5 原子发布（腾讯云服务器） |
| `Pages` | `43435814133`（4c71400） | completed **success**（workflow 之前被置为 disabled，已用 API 重新启用后发布） |
| GitHub Pages | <https://afdk1991.github.io/MixmAPP/> | 首页为最新「星际联邦通行证」主题；点 `02 SIGN 登录` 进入登录页，四个渠道显示「未启用」、无 `↗`，与生产 `/meta` 的 `thirdparty` 全 off 一致 |
| CloudBase 静态站 | `MixmAPP-010`（buildId `2612468490`） | 构建 **SUCCESS**；带 `?cb=` 绕过 CDN 缓存后为最新主题，登录页显示四个「不可用」+「登录服务暂不可达」（本机到 `cloud.mix.top` TLS 被拦时的如实提示） |

过程中修掉的两个真实红灯：

1. `Android` run `43435214507`、`Pages` 同批次失败：`Could not resolve "../../routes"`。根因是 `login.vue` 已引用 `ROUTES`，但 `apps/app/src/routes.ts` 未入库。补提交后（`4c1a3cc`）`ci` 与 `Android` 双双转绿。
2. `Pages` 工作流被置为 `disabled`，push 不再触发发布。已 `PUT /actions/workflows/{id}/enable` 重新启用并手动 dispatch，run `43435814133` 发布成功。

## 6. 仍然受阻的一环（需要用户提供，不是我能自造的东西）

1. **渠道凭据**：GitHub OAuth App、微信开放平台、QQ 互联、Apple Service ID。填进 `OAUTH_*` 后 `/meta` 自动变 `on`，按钮即从「未启用」变 `↗` 并真实跳转。当前四个渠道全 off，所以线上点击只会显示「未启用」。
2. **`cloud.mix.top` 国内可达性**：本机严格 TLS 校验仍报 `SEC_E_ILLEGAL_MESSAGE` / `ERR_SSL_UNRECOGNIZED_NAME_ALERT`，即历史记录里的 TLS alert 112。`*.mix.top` 指向 AWS Global Accelerator，缺 `mix.top` 的 DNS 编辑权就无法改成国内可解析的地址。生产 API 本身已部署成功（SSH 原子发布 job 绿、远端健康检查通过），只是国内网络到该域名被拦。
