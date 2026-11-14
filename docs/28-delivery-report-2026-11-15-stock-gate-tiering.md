# 28 · 交付报告：库存拦截从「布尔闸」改为「按信号可信度分级」+ 目录同步可见化

- 日期：2026-11-15
- 范围：`services/api`、`packages/contracts`、`apps/app`（H5/Android 壳共用）、`scripts/catalog`、`infra/sql`
- 线上环境：腾讯云 `115.159.159.11`，`https://www.mixm.top/`、`https://api.mixm.top/mixmapp/api/v1`、Android 壳 `top.mixm.app`
- 状态：**已上线**（API + H5 原子发布、迁移 0012 已执行、健康检查通过）

## 1. 结论先说

原来的二选一是错的，已拆成分级判定：

| 信号 | 判定 | 行为 |
| --- | --- | --- |
| 源站明确状态含「无货 / 下架 / 停售」 | 不可售 | 继续拦截（禁止加购、禁止结算、详情显示缺货） |
| 源站状态仅「缺货」，或库存 ≤ 0，但没有停售类真实状态 | 可售但待确认 | 不硬拦，前端标「货源待确认」，允许加购/下单，订单行打标 |
| 源站状态缺失且库存 > 0 | 正常 | 原样可售 |

线上实测（生产库 15,037 件）：列表页 20 条中 19 条为「货源待确认」，0 条误判「缺货」；`下架` 商品加购返回 409 被拒。

## 2. 根因

- 生产商城的商品读源是 **DB**（`/healthz` → `catalogSource.source = "db"`），所以分级逻辑必须落在 `services/api/src/modules/mall.ts` 的 DB 商品路径，而不是内嵌目录源 `catalog-source.ts`。
- 旧实现 `sourceUnavailable()` 用 `/缺货|无货|下架|停售/` 一律硬拦；而 DB 里 `source_inv_status` 绝大多数是「缺货」——这是源站匿名视图的可见性限制，不是真实停售。库存则是由箱规×10 推算（`stock_source='assumed-box10'`）。
- 结果：`MALL_SOURCE_STOCK_GATE=true` 时 14,715 / 15,037 件不可售（等于商城停业），`false` 时真停售商品也可能被下单。

## 3. 我替你定了什么（以及怎么改回去）

以下每一项都是按「最保守默认」自定的，不需要你批准，但都可以单点回退。

### 决策 A：一个环境变量三档，默认走分级

`MALL_SOURCE_STOCK_GATE` 从布尔升级为三值，**不再新增开关**：

| 值 | 行为 |
| --- | --- |
| 不设置 / 空 / `true` | **分级（当前线上状态）** ← 默认 |
| `strict` | 旧的全拦截（缺货/无货/下架/停售一律拦） |
| `false` / `0` / `off` / `no` | 一律不按源站库存拦截（旧放行行为） |

**理由**：线上 `/etc/mixmapp/api.env` 原本没有这个变量，缺省即分级，等于「改代码上线即生效」，不需要动 env，也留了 `strict` 一键回旧。
**改回去**：见 §7-①。

### 决策 B：推断缺货不设硬上限，只打标

加购数量上限（`maxOrderQty`）仍然生效；但对「推断缺货」商品不再用 `stock` 做数量上限校验，也不在结算时扣减该行库存（避免把推算库存扣成负数）。
**理由**：`stock` 是箱规×10 的估算值，用它卡数量只会制造假性拦截；真实约束交给人工确认货源。
**改回去**：把 `MALL_SOURCE_STOCK_GATE` 设为 `strict` 即可恢复旧的全部硬拦；若只想恢复数量上限，见 §7-① 的代码回退。

### 决策 C：`catalog-source.ts`（内嵌只读目录源）不动

该路径下 `buildIndex()` 写死 `stock: 0 / inStock: false`，本轮**刻意不改**。
**理由**：生产 `catalogSource.source = "db"`，该路径未启用；而且目录源商品不在 DB 里，即使改成「可售」也会在下单时 404——改了反而制造「能加购但下不了单」的假象。
**改回去**：本就未改，无需回退。

### 决策 D：同步结果只进「日志 + 健康检查」，不造 webhook

没有 webhook 地址，就不凭空造一个。最近一次目录同步通过 `GET /api/v1/healthz` 的 `catalogSync` 字段暴露（公网可达），失败摘要同时落到同步日志与服务日志。
**改回去**：见 §7-④。

### 决策 E：取调用方传入的 `stockUnconfirmed` 落库，而不是事后按状态重算

订单行在下单那一刻判定并写 `order_items.stock_unconfirmed`，后续源站状态变化不回溯改写历史订单。
**理由**：这是「下单时的履约风险标记」，用于客服/仓储筛选，必须可审计、可复盘。
**改回去**：见 §7-③（保留列、停用写入）。

## 4. 改动清单

| 文件 | 改动 |
| --- | --- |
| `packages/contracts/src/index.ts` | `ProductDto`/`CartLineDto` 新增 `stockConfidence?: 'confirmed' \| 'inferred'`；`OrderItemDto` 新增 `stockUnconfirmed?: boolean` |
| `services/api/src/config.ts` | `sourceStockGate: boolean` → `sourceStockMode: 'off' \| 'tier' \| 'strict'`，同读 `MALL_SOURCE_STOCK_GATE` |
| `services/api/src/modules/mall.ts` | 新增 `explicitUnavailable` / `inferredScarce` / `stockConfidence` / `assertStockEnough`；`sourceUnavailable` 按三档分流；DTO 带 `stockConfidence`；下单/改数量/扣库存/取消归还全部按分级处理；落单后打印 `[order] 货源待确认 <orderNo>` |
| `services/api/src/db/types.ts` | `OrderItemRecord.stockUnconfirmed`、`CatalogSyncRunRecord`、`Store.ops.lastCatalogSyncRun()` |
| `services/api/src/db/postgres.ts` | `ops.lastCatalogSyncRun()`（查 `catalog_sync_runs` 最新一行，异常返回 null）；`order_items.stock_unconfirmed` 读写 |
| `services/api/src/db/memory.ts` | `ops.lastCatalogSyncRun()` 返回 null |
| `services/api/src/routes/meta.ts` | `healthz` 增加 `checks.catalogSync` 与 `catalogSync` 明细 |
| `infra/sql/0012_order_stock_unconfirmed.sql` | 新增 `order_items.stock_unconfirmed boolean not null default false` + 部分索引 |
| `scripts/catalog/store.mjs` | 同步失败摘要压成单行、截断 500 字后落库 |
| `scripts/catalog/README.md` | 三档口径说明 + `catalogSync` 字段说明 |
| `apps/app/src/api/mall.ts` | `isStockUnconfirmed()`、`STOCK_UNCONFIRMED_NOTICE` |
| `apps/app/src/pages/mall/index.vue` | 商品卡新增「货源待确认」徽章 |
| `apps/app/src/pages/mall/detail.vue` | 详情显示「货源待确认 · 可下单」+ 说明文案，购买按钮不置灰 |
| `apps/app/src/pages/cart/index.vue` | 行内「货源待确认 · 可结算」+ 结算面板汇总提示 |

## 5. 上线记录

- 构建：`pnpm build:api`、`pnpm build:h5`（注入 `MIXMAPP_API_BASE=https://api.mixm.top/mixmapp/api/v1`、`MIXMAPP_MEDIA_BASE=https://img.mixm.top`）
- 校验：`pnpm --filter @mixmapp/api typecheck` / `--filter @mixmapp/app typecheck` 0 error；`pnpm --filter @mixmapp/api test` 14 passed / 1 skipped（133 tests）
- 发布：远端 `deploy/atomic-release.sh` 原子切换（symlink + `node dist/db/migrate.js` + 20 次 healthz 探活 + 失败自动回滚），迁移 0012 已执行
- 环境变量：`/etc/mixmapp/api.env` 未改（本就没有 `MALL_SOURCE_STOCK_GATE`，缺省即分级）
- 未触碰：TLS 1.0/1.1、`img.mixm.top` 的 CORS（按既定决定保持现状）

## 6. 验证证据

### 6.1 Web 端（https://www.mixm.top/，真实浏览器）

- 商城列表：20 件商品里 19 个显示「货源待确认」徽章，**0 个**显示「缺货」，价格/分类正常
- 商品详情（`egl-110001030004`）：`¥0.085 元/支` + 「货源待确认 · 可下单」+ 说明文案「当前库存来自源站匿名视图推断，可正常下单，客服会在发货前与您确认货源」，`加入购物车` / `立即购买` 均可用

### 6.2 API 级端到端（生产库真实数据）

| 场景 | 结果 |
| --- | --- |
| 推断缺货商品加购（qty 3） | 200，购物车行带 `stockConfidence: "inferred"` |
| 明确「下架」商品加购 | 409 被拒 |
| 结算下单 | 201，`orderNo=MOMWGRR6KR068289`，`stockUnconfirmed: true`，`totalFen=26` |
| 落库 | `order_items.stock_unconfirmed = t` |
| 服务日志 | `[order] 货源待确认 MOMWGRR6KR068289（1 行）：EG 12.9级公制内六角圆柱头螺丝 M3-0.5x4×3` |

### 6.3 同步可见性

`GET https://api.mixm.top/mixmapp/api/v1/healthz` 实测返回：

```json
"catalogSync": {
  "runId": "20261114175003",
  "startedAt": "2026-11-14T17:50:03.530Z",
  "finishedAt": "2026-11-14T17:51:43.323Z",
  "status": "rolled-back",
  "reportPath": "/var/lib/mixmapp/catalog-sync/reports/20261114175003.json",
  "error": " [--limit 局部抓取误判下架，已按 product_change_log 回滚 14684 条]",
  "stats": { "...": "新增 0 / 下架 14684 / 改价 353 / 未变 0 ……" }
}
```

失败摘要单行、≤500 字，直接可读；同时 `checks.catalogSync` 给出粗粒度状态供探活。

### 6.4 Android 壳（top.mixm.app，模拟器 emulator-5554）

- 已装新包（`app-debug.apk`，其 `assets/public` 内 H5 与 www 部署产物同一批 hash，含「货源待确认」文案）
- **列表页已验证**：商城页渲染 20 件商品，「货源待确认」徽章与价格正常显示
- **详情 / 购物车 / 结算未取得端侧截图**：本轮并发有另一个进程在重建 Android 包（`capacitor sync android` 与 `pm clear`），App 被反复 force-stop / 清数据，模拟器 x86_64 冷启动 WebView 亦极慢，交互无法稳定完成。
- 风险判断：Android 端与 www 使用**同一份 H5 产物**，仅 WebView 运行时不同；详情/购物车的分级渲染已在 www 真实浏览器验证通过。建议在并发重建结束后，于真机补一次「详情 → 加购 → 结算」点击验收。

## 7. 回退操作（逐项）

**① 回到旧的全拦截（最快，一步，无需发版）**

```bash
ssh root@115.159.159.11
echo 'MALL_SOURCE_STOCK_GATE=strict' >> /etc/mixmapp/api.env
systemctl restart mixmapp-api
curl -s https://api.mixm.top/mixmapp/api/v1/healthz | head -c 200
```

撤销：删掉该行并重启即可回到分级。同理 `MALL_SOURCE_STOCK_GATE=false` 可回到「一律不拦」。

**② 回退代码（回到发布前的 release）**

```bash
ssh root@115.159.159.11
ls -1 /opt/mixmapp/releases | tail -3      # 找上一个版本
bash /opt/mixmapp/deploy/rollback.sh        # 或手动把 current 指回上一个 release 后 systemctl restart mixmapp-api
```

H5 与 API 同包回退，无需单独处理。注意：回退后 `stockConfidence` / `stockUnconfirmed` 字段客户端会忽略（新增字段，无破坏性）。

**③ 回退数据表（仅当要彻底移除打标）**

```sql
-- 保留历史数据时只停用：不回退 SQL，直接 §7-② 回退代码即可（旧代码不写该列）
-- 彻底移除：
drop index if exists idx_order_items_stock_unconfirmed;
alter table order_items drop column if exists stock_unconfirmed;
```

**④ 回退同步可见性**

- 只想去掉 healthz 字段：`services/api/src/routes/meta.ts` 删除 `catalogSync` 两项，重新发布。
- 失败摘要截断改回原文：`scripts/catalog/store.mjs` 的 `markRunFinished` 去掉 `replace(/\s+/g,' ').trim().slice(0,500)`。
- 数据不受影响（`catalog_sync_runs` 是历史既有表，本轮未改结构）。

**⑤ 回退前端文案（只想恢复旧显示）**

- `apps/app/src/pages/mall/index.vue` 删除 `v-else-if="isStockUnconfirmed(product)"` 徽章分支；
- `detail.vue` 删除 `stockUnconfirmed` 相关两处；`cart/index.vue` 删除 `isStockUnconfirmedLine` 及两处提示；
- `apps/app/src/api/mall.ts` 的 `isStockUnconfirmed` / `STOCK_UNCONFIRMED_NOTICE` 可一并删除；
- 重新 `pnpm build:h5` 发布。API 端仍返回 `stockConfidence`，旧前端会直接忽略。

**⑥ 验收产生的测试数据**

- 测试订单：`MOMWGRR6KR068289`（guest 单，3 支，26 分），如需清理：

```sql
delete from order_items where order_id = (select id from orders where order_no = 'MOMWGRR6KR068289');
delete from orders where order_no = 'MOMWGRR6KR068289';
```

- 测试账号：`verifytier01`（用户名注册，无绑定），如需清理删除 `users` 对应用户即可。

## 8. 未做 / 后续

1. 内嵌只读目录源（`catalog-source.ts`）的可售口径未动（见决策 C）。
2. Android 真机的详情/加购/结算点击验收待并发重建结束后补做。
3. 目录同步若再跑全量，请勿使用 `--limit`（上一轮误判 14,684 件下架，已回滚；这正是本轮把失败摘要做进 healthz 的直接动因）。
