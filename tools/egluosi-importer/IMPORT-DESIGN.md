# 商品导入通道实现说明（egluosi catalog → MixmAPP 商城库）

字段口径以 `CONTRACT.md` 冻结版为准，本文只记录落地实现、规则与幂等证据。

## 1. 两种入口，同一段业务逻辑

校验、图片本地化、upsert、统计全部收口在 `MallService.importCatalog`
（`services/api/src/modules/mall.ts`），两个入口都只做薄封装：

| 入口 | 触发方式 | 说明 |
| --- | --- | --- |
| HTTP 管理面 | `POST /api/v1/admin/mall/import`（`x-admin-token` 守卫） | body ① 直接给 catalog 对象；② 给 `{ "file": "tools/.../catalog.json" }`，服务端按 `process.cwd()` 解析并限制在仓库根目录内 |
| CLI 复跑 | `node tools/egluosi-importer/import.mjs [catalog.json 路径]` | 默认读 `tools/egluosi-importer/source/catalog.json`；复用 `module-api` 导出的 `MallService`，规则与 HTTP 一致；报告写 `out/import-report.json` |
| 启动期导入 | env `MALL_IMPORT_CATALOG=<相对或绝对路径>` | 服务起来后自动导入一次并 `log.info` 统计；设了它且为内存库时**跳过 demo seed**，避免示例商品污染真实目录 |

> CLI / HTTP 不各写一套入库规则；差异仅在「catalog 从哪里来、报告写到哪里」。

## 2. 表结构（`infra/sql/0006_products_import.sql`，幂等）

对既有 `products` 表只增可空列与索引，不动既有列，旧数据零影响：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `source_key` | text，唯一索引 `products_source_key_idx` | 幂等稳定键（`sku:<型号>` / `url:<规范化URL>`）；NULL 不参与唯一约束 |
| `source_url` | text | 详情页原文 URL，详情页「来源链接」用 |
| `source_id` | text | 站点 SKU / 货号原文，可空 |
| `brand` | text | 品牌原文 EGM / EG / OSG / … |
| `category_path` | text | 完整分类路径，`/` 连接；读出时再拆分数组 |
| `category_name` | text | 一级分类中文名 |
| `specs` | jsonb，默认 `{}` | 结构化规格键值 |
| `unit` | text | 支 / 个 / 套 / 盒 |
| `pack_qty` | integer，可空 | 包装量 |
| `price_source` | text | `anonymous` / `login` / `inquiry` |
| `price_captured_at` | timestamptz | 价格抓取时刻（ISO） |
| `stock_source` | text | `anonymous` / `unknown` |
| `import_batch` | text | 导入批次号；人工改过后置为 `manual`（见下） |

迁移可重复执行：`add column if not exists` + `create unique index if not exists`。

## 3. Upsert 规则（按 `source_key`）

- **键**：`source_key`。内存与 PG 两个实现行为一致。
- **不存在**：整行插入，`action = inserted`。
- **已存在**：只刷新导入侧字段——副标题、价格、划线价、封面、图集、标签、描述、来源、品牌、分类路径/名、规格、单位、包装量、价格来源/时刻、库存来源、批次号。
- **运营侧字段保护**：`title` / `category` / `stock` / `sortNo` 仅当记录**未被人工标记**时随导入刷新；记录被后台人工改过后 `import_batch` 置为 `manual`，此后重复导入保留这些字段，不覆盖人工改动。
- 重复导入同一批：商品总数不变，报告里 `updated` 增加、`inserted = 0`。
- 无公开价：`priceFen` 落库/下发归一为 `0`；能否下单必须同时看 `priceSource === 'inquiry'` 或 `priceFen <= 0`，不能只判 0。服务端在加购与下单两处都有兜底拦截（见 §8）。

## 4. 图片落地（§6）

- 源图：`tools/egluosi-importer/source/images/<sha1>.<ext>`（`staged` 相对 `source/` 目录）。
- 目标：`STORAGE_DIR/products/<sha1>.<ext>`；对外地址 `/media/products/<sha1>.<ext>`。
- 已存在即跳过拷贝（幂等，重复导入不重复落盘）。
- 商品 `cover` / `images` **只写 `/media/...` 本地地址**，绝不保留站点图床热链。
- `staged: null`（抓取端下载失败）或源图缺失：该图跳过，不塞坏 URL；无图商品仍入库，封面走默认占位色。
- 本地直出：仅 `storage.provider === 'local'` 时注册 `GET /media/*`；key 过 `isSafeStorageKey` 校验并二次确认解析后路径仍在 `localDir` 内，防目录穿越。生产由 nginx 直出。

## 5. 导入报告字段

`ImportReport`：

```jsonc
{
  "batch": "import-xxxx",
  "source": "https://eg.egluosi.com/b2b/",   // 可空
  "crawledAt": "ISO 时间",                  // 可空
  "inserted": 0,
  "updated": 0,
  "skipped": 0,
  "failed": 0,
  "imagesLocalized": 0,
  "byCategory": [{ "code": "egm-screw", "name": "EGM螺丝类", "count": 1 }],
  "failures": [{ "sourceKey": "…", "reason": "…" }]
}
```

## 6. 对外接口清单（前端消费）

公开读（无需登录）：

- `GET /api/v1/mall/products?category=<code>&keyword=<词>&page=1&pageSize=20`
  - 分页：`page` 1–100，`pageSize` 1–50。
  - 返回 `ProductDto[]`，在既有字段基础上增补可选字段：
    `brand`、`categoryPath`、`categoryName`、`specs`、`unit`、`packQty`、
    `priceSource`、`priceCapturedAt`、`sourceUrl`。
- `GET /api/v1/mall/products/:id` → 单个 `ProductDto`。
- `GET /api/v1/mall/categories` → `[{ code, name, count }]`，供分类 tab。

展示规则（契约 §4）：

- `priceSource === 'inquiry'` 或 `priceFen === 0` → 显示「询价」，禁用加购/下单。
- 有 `unit` / `packQty` → 价格旁显示 `元/支`、`100 支/包`。
- `sourceUrl` 仅详情页显示为「来源：站点链接」，标注「内部选品底稿，非对外报价」。

管理面（前端不调用，`x-admin-token` 守卫，未配置令牌整组 404）：

- `POST /api/v1/admin/mall/import`，body 上限 64MB，返回上述 `ImportReport`。

## 7. 自测与幂等证据（本地内存库实测）

- `pnpm build:api` 通过；`pnpm --filter @mixmapp/api typecheck` 通过；api 单测 75 passed / 6 skipped。
- 第一轮喂 fixture：`inserted=3, updated=0, failed=0`；商品列表 3 条，含 `brand / specs / priceSource / categoryName / unit / packQty`。
- 第二轮同一份 fixture：`inserted=0, updated=3`，商品总数仍为 3（幂等）。
- `GET /mall/categories` 返回 3 个分类，各 `count=1`。
- 造 sha1 命名测试图并导入：`imagesLocalized=1`，`cover/images` 指向 `/media/products/<sha1>.png`，该地址 `200 image/png`；穿越路径与缺失图均 `404`。
- 启动期 `MALL_IMPORT_CATALOG` 自动导入 `inserted=3`，同时跳过 demo seed，总数 3。
- CLI 对 fixture 复跑：`inserted=3, updated=0, failed=0`，报告见 `out/import-report.json`。

## 8. 验收回捞缺陷复核（本轮）

### 8.1 启动期导入落到同一 serving store，demo seed 真跳过

- 装配顺序（`services/api/src/index.ts`）：`createStoreSwitcher(config)` 得到稳定 Proxy → 同一个 `store` 传给 `buildApp`；`MallService` 与 `app.store` 都持有该 Proxy，启动期导入调 `app.mall.importCatalog`，复用对外服务的同一实例，不存在第二个 CLI 新实例。
- seed 跳过条件：`SEED_DEMO_PRODUCTS === '1' && store.driver === 'memory' && !MALL_IMPORT_CATALOG`。
- 内存库实测（8095）：仅设 `MALL_IMPORT_CATALOG` → 日志 `inserted=3`，列表 3 条；叠加 `SEED_DEMO_PRODUCTS=1` 仍总数 3、demo 混入 0、日志无 `[seed]` 注入行。
- 边界：PG / 网关落点下「启动期导入可见性」需在有凭据的线上环境复验；本环境无 `CLOUDBASE_PG_API_KEY`，网关序列化层未能本地复现。

### 8.2 PG 路径「列表能查、详情 404」复核

在独立隔离库 `mixmapp_import_test`（不触碰共享库与无关 `mim` 库）跑通 `0001–0006` 迁移后实测：

- 首轮 CLI 导入 `inserted=3`；库内 `id` 列为 `text`，值为完整雪花串，`source_key` 对齐。
- 二轮同 fixture 走 upsert update 分支 `inserted=0, updated=3`：`id` 保持不变，仅 `import_batch` 刷新；三条记录 `GET /mall/products/:id` 均 `200`，`brand/specs/categoryPath/unit/packQty/priceSource/sourceUrl` 字段完整。
- 据此排除：id 落库不一致、`mapProduct` 读列错位、update 分支改写 id 三种假设。
- 两处防御性修正（`db/postgres.ts` `mapProduct`）：`id` 强制 `String(...)`，避免个别驱动把纯数字 id 以 number 回传；`priceCapturedAt` 为 `Date` 时走 `toISOString()`，保证下发恒为 ISO。
- 未闭环项：线上数据层走 CloudBase PG HTTP 桥 `public.mix_exec`，本环境无 API Key，网关回传行的 id 类型无法本地核对；雪花 id 量级约 1.1e17，超过 `Number.MAX_SAFE_INTEGER`，若桥层把 text 数字串以 JSON number 回传会丢精度导致详情按 id 查不到——需在有凭据环境核对回传行 id 是字符串还是 number。另：只读访问线上公开接口时，当前部署的仍是旧构建（DTO 无 `brand/specs/priceSource` 等新字段），导入行也已清空。

### 8.3 服务端拦截询价 / 0 元商品加购与下单

- `MallService.assertOrderable(product)`：`priceSource === 'inquiry' || priceFen <= 0` 抛 `AppError.conflict`，文案「`<title>` 需询价，暂不支持直接下单」。
- 接入点：`addToCart`（存在性校验之后）、`placeOrder` 逐行循环（存在性校验之后、库存判断之前）。`updateCartQuantity` 不在本需求范围内，未加拦截。
- 单测：询价商品与匿名 0 元商品加购、立即下单均 `409`，订单列表为空；公开价商品加购 `200` 作正向对照。
- 契约注释：`ProductDto.priceFen` 已注明询价 null → 0，且判断可下单必须同时看 `priceSource`。

## 9. 万级目录分页 / 分类聚合 / 批量导入复核（15,037 条实测）

落点：本地 PG `mixmapp` 库（15,037 导入 + 6 条 0002 演示品 = 15,043）。

### 9.1 分页上界放开（问题 A）

- `productQuerySchema.page` 上界由 `100` 提到 `100000`；`pageSize` 上限保持 `50`（前端首屏 20 + 触底翻页不放大）。数据层 `list(limit, offset)` 本就按 offset 翻页，无 5000 内置截断。
- 实测（`pageSize=50`）：`page=1` 50 条、`page=101` 50 条（旧上界会被 422 拒）、`page=301`（末页）43 条；第 1 页与第 301 页 id 交集 0。末页 43 = 37 导入 + 6 演示品（演示品 id `mix-p-1001..1006` 落在末页）。`page=302` 返回空；`pageSize=51` 仍 `422`。

### 9.2 分类改真聚合（问题 B）

- `Store.mall.products` 新增 `aggregateCategories()`：PG `group by category, category_name`；memory 直接统计 Map。`listCategories()` 不再用 `list(limit:5000)` 分页凑数。
- 实测 `GET /mall/categories`：10 类，`sum(count)=15043`，逐行对齐 PG：

  | code | name | count |
  | --- | --- | --- |
  | eg-screw | EG螺丝类 | 6160 |
  | cutting-tool | 成品刀刃具类 | 5947 |
  | egm-screw | EGM螺丝类 | 2251 |
  | hand-tool | 手工具类 | 253 |
  | expansion | 膨胀类 | 249 |
  | auto-screw | 汽车螺丝类 | 177 |
  | featured | featured | 2 |
  | life | life | 2 |
  | digital | digital | 1 |
  | wear | wear | 1 |

- 注意：导入报告 `byCategory` 只统计本次 catalog 内的 6 个导入类（合计 15037）；`GET /mall/categories` 统计全库（含 6 演示品，合计 15043），两者口径不同。

### 9.3 单批 5000 分片，一把跑 15k（问题 C）

- `importCatalogSchema.products` 数组上界由 `5000` 提到 `100000`；`MallService.importCatalog` 内部按 `5000/批` 循环切片，HTTP 与 CLI 共用；`inserted/updated/skipped/failed/imagesLocalized/byCategory` 跨片累加。
- 实测 CLI 一把全量：`node tools/egluosi-importer/import.mjs`（`DATABASE_URL=…/mixmapp`）→ `inserted=0 updated=15037 skipped=0 failed=0 imagesLocalized=64576`，无 400；复跑后库总数仍 15043（幂等，未重复插入）。

### 9.4 演示品与无图商品确认（不改数据）

- **6 条演示品**（`mix-p-1001..1006`，featured/wear/life/digital）目前与五金商品混排在公开列表里。建议（未执行删行）：后续给演示品打标记字段（如 `importBatch='seed'` 或独立 `isDemo` 布尔），公开目录可按标记过滤或加「示例」角标；是否下线由运营决定。
- **3,804 条无图商品**：catalog 内 `withImg=11233 / noImg=3804`，与库内一致。抽查 3 条（`sku:110607050000` / `110607100000` / `110607200000`）其 `images` 数组非空但**全部 `staged: null`**（站点画廊图下载失败），属预期无图兜底（封面走默认占位色），不是导入漏映射。

## 10. 同分类同名商品命名去歧义（数据质量收尾）

### 10.1 规则（`MallService.importCatalog`）

- 分组键：`categoryPath` 末级（空则退 `categoryCode`）+ catalog 原始 `item.name`。单条不冲突的原样保留，不给全量加后缀。
- 组内 >1 条时追加后缀：优先 `specs.包装`（` · <包装>`）；先统计组内包装取值出现次数，**包装在组内唯一**才用包装后缀，否则整组退化 ` · 货号<sourceId 末6位>`（sourceId 空则取 sourceKey 末 6 位）；货号仍撞再追加序号兜底。
- **幂等**：判重与拼后缀都基于 catalog 原始名，不读库里已加过后缀的标题；同一 sourceKey 复跑重算同一后缀，不会叠第二层。
- 本批 14 组 / 28 条，组内包装均为 `1箱=1支`（相同、无区分度），故实际全部走货号末 6 位后缀。

### 10.2 PG `mixmapp` 实测证据

- 复跑前基线：`count(*)=15037`，`count(distinct title)=15023`，重复组 14。
- CLI 全量复跑：`inserted=0 updated=15037 skipped=0 failed=0 imagesLocalized=64576`；第二轮再跑仍 `inserted=0 updated=15037`。
- 验收 SQL：
  - `select count(*), count(distinct title) from products where source_key is not null;` → **15037 / 15037**。
  - `select category_path, title, count(*) ... group by 1,2 having count(*)>1;` → **0 行**。
  - 加后缀 28 条；含两个「货号」的双层后缀 **0** 条。
- 4 条样例改后 title：

  | id | 改后 title | priceFen | sourceId |
  | --- | --- | --- | --- |
  | 114800781231652864 | UTOOL手用铰刀 1.5x55 · 货号015000 | 2200 | 190601015000 |
  | 114800781231652865 | UTOOL手用铰刀 1.5x55 · 货号015001 | 1280 | 190601015001 |
  | 114800781697220608 | UTOOL机用铰刀 4.5 · 货号045000 | 7200 | 190602045000 |
  | 114800781701414912 | UTOOL机用铰刀 4.5 · 货号045002 | 2500 | 190602045002 |

- 库总行数仍 **15043**，分类聚合仍 **10 类 / sum 15043**。
