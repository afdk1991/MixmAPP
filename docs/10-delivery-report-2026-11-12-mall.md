# 交付报告 · 商城 / 购物车 / 个人中心（2026-11-12）

版本口径：**V0.0.0-preview**（`version.json` 仍为 `next=0.0.0`、`channel=preview`、`released=[]`）。
首个对外正式版本仍是 V0.0.0，本轮不占用 0.0.1；`pnpm version:check` 已核对包版本、env、config、README 与 tag。

## 1. 本轮交付范围

| 层 | 内容 |
|---|---|
| 数据库 | `infra/sql/0002_mall.sql`：`products / carts / orders / order_items` 四表 + 索引 + 6 条幂等种子商品（`mix-p-1001…1006`） |
| 契约 | `packages/contracts`：`productQuerySchema / cartAddSchema / cartUpdateSchema / orderCreateSchema` 与 `ProductDto / CartLineDto / CartDto / OrderItemDto / OrderDto` |
| 存储 | `Store.mall` 抽象；MemoryStore 与 PgStore 双实现（PG 下单走事务、库存用条件更新防超卖） |
| 服务 | `MallService`：商品列表/详情、加购（累加 + 99 件上限 + 库存校验）、改量、删除、清空、下单（扣库存、清购物车）、订单列表/详情 |
| 路由 | `/api/v1/mall/products`、`/products/:id`（公开）；`/cart`（GET/POST/PATCH/DELETE）、`/orders`（POST/GET）、`/orders/:orderNo`（需登录） |
| 前端 | `pages/mall/index`、`pages/mall/detail`、`pages/cart/index`、`pages/orders/index`；首页与个人中心新增商城/购物车/订单入口；`api/client.ts` 新增 `mallApi` |
| 测试 | 新增 `test/mall.test.ts` 4 条；PG 集成测试新增商城四表写入用例（商品落库、条件扣库存、购物车 upsert、订单事务 + 明细） |

## 2. 本轮修掉的真 BUG

1. **HEAD 被并发写入截断**：`config.ts` 停在 `candidates.find((dir`、`test/helpers.ts` 停在 `buildApp({ config: testCo`，CI `Type '...' is missing ...'` 与 `TS1005` 双红。已按完整内容重建并提交（`937aaff`）。
2. **登录域半成品拼盘**：HEAD `UserRecord` 已加 `username/guest`、`routes/auth` 已列 `apple`，但 `modules/auth.ts`、`oauth.ts` 未同步，CI 报 4 处类型错误。已把工作树中自洽的一版整体收敛（`186914b`）。
3. **个人中心 `upgradeGuest` 未定义**：模板引用升级函数但脚本未落，`vue-tsc` 报 `Property 'upgradeGuest' does not exist`。已补齐实现（`a1a6b14`）。
4. **测试工厂未跟 Apple 登录**：`OAuthProviderName` 扩到 `apple` 后 `makeApp` 少一项，已补 FakeOAuth('apple')。

## 3. 门禁取证（本机，提交前）

| 检查 | 结果 |
|---|---|
| `pnpm lint` | ✓ 规则检查通过 |
| `pnpm typecheck` | ✓ contracts / ids / api / app 全通过 |
| `pnpm test` | ✓ 37 passed / 4 skipped（含商城 4 条） |
| `pnpm build:api` | ✓ `dist/index.js` 103.78 KB |
| `pnpm build:h5` | ✓ Build complete |
| `node scripts/build-h5-single.mjs` | ✓ `release/mixmapp-h5-single.html` 396.5 KB |
| `node scripts/version.mjs check` | ✓ V0.0.0-preview（6 包 / env / config / README / tag） |

## 4. 线上部署取证

### CloudBase（生产静态端）

- 上传：`getUploadUrl` → `curl -X PUT -T release/site-mall.zip` → **HTTP 200**（zip 208,904 B）
- 部署：`deployApp(cosTimestamp=1794477425)` → buildId **2612272144**（versionName `mixmapp-h5-002`）→ 轮询状态 **SUCCESS**
- 域名：`https://mixmapp-h5-cs-1-d5g815slocb5a611a.webapps.tcloudbase.com`
- 复验：首页 200；SPA 壳引用 `/assets/index-Bda0_l2t.js`，该资产 **200 / 240,911 B**，内容含 `MixmAPP 商城`、`pages/cart/index`、`pages/orders/index`、`/mall/products`

### GitHub Pages

- 主仓直接托管（`pages.yml`，产物为单文件 H5）：`https://afdk1991.github.io/MixmAPP/`
- `a1a6b14` 的 Pages run **success**；实测 **200 / 411,525 B**，内容含 `MixmAPP 商城`、`pages/cart/index`、`data-page`
- 旧地址 `https://afdk1991.github.io/mixmapp-h5/` 为历史产物仓，停留在大促前的 356 KB 版本，已非当前发布源

### 镜像 / Android

- Image 与 Android 工作流随新提交重跑；Android 走 CI 出包（本机无 SDK 的历史结论已被后续本机 SDK 安装取代，本机可 `gradlew` 出包）。

## 5. 事实边界（未完成项，不冒充完成）

- **API 线上实例未部署**：缺宿主与 PostgreSQL 连接串（免费组合建议 Neon/Supabase + CloudBase 云托管或 Sealos 拉 `ghcr.io/afdk1991/mixmapp-api:latest`），`deploy` 工作流因此在无 SSH secrets 时跳过。
- **Cloudflare Pages** 缺 `CLOUDFLARE_API_TOKEN / ACCOUNT_ID`，工作流跳过。
- **EdgeOne Pages** 仅有 `deploy-html`（内联正文），无法直传 396 KB 单文件，已如实标注平台接口限制。
- **自定义域名 `mixm.top`** 尚未分配；Android release keystore 与 4 个 secrets 未配置；短信/支付/地图/推送/AI 真实密钥未填。
- 订单当前只到 `pending`，未接支付回调置 `paid`；收货地址为下单时手填，未做地址簿。
