# egluosi → MixmAPP 商品导入契约（冻结版）

本文件是抓取端、导入端、前端三方的唯一字段口径。任何一方都不得自行改字段名或含义；
需要变更时先改本文件，再改实现。

来源站点：`https://eg.egluosi.com/b2b/`（鹏驰五金 EGM/EG/OSG 目录站，B2B 目录型）

## 1. 目录约定

```
tools/egluosi-importer/
├── CONTRACT.md                     # 本文件
├── source/                         # 抓取端产物（只由抓取端写）
│   ├── catalog.json                # 规范化产物（见 §2）—— 导入端唯一输入
│   ├── crawl-report.json           # 抓取统计与逐条跳过/失败原因
│   ├── api-notes.md                # 抓到的接口/参数说明，供复跑
│   └── images/                     # 原始图落盘，文件名 = §2.4 的 staged
├── import.mjs                      # 导入端入口（读 catalog.json → store）
└── out/                            # 导入端产物：import-report.json、图片落盘清单
```

## 2. catalog.json（抓取端 → 导入端）

```jsonc
{
  "meta": {
    "source": "https://eg.egluosi.com/b2b/",
    "crawledAt": "2026-11-14T12:00:00.000Z",
    "pricePolicy": "anonymous | login | inquiry", // 整体判断：匿名可见价/需登录/只能询价
    "totalScanned": 0,                            // 站点上枚举到的商品条数（含被跳过的）
    "totalImported": 0                            // products 数组长度
  },
  "categories": [
    {
      "code": "egm-screw",       // 一级分类稳定短码，≤32 字符，写入 products.category
      "name": "EGM螺丝类",        // 一级分类中文名，写入 products.category_name
      "siteValue": "123",        // 站点侧分类 id/value（可空字符串）
      "path": ["EGM螺丝类"]      // 该分类自身的路径
    }
  ],
  "products": [ /* 见 §2.1 */ ],
  "skipped": [{ "sourceUrl": "…", "reason": "…" }],
  "failed": [{ "sourceUrl": "…", "reason": "…" }]
}
```

### 2.1 单条商品

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sourceKey` | string | 是 | 幂等稳定键。优先 `sku:<站点SKU/型号原文>`；没有 SKU 用 `url:<规范化URL>`。**同一实体只允许一个 key** |
| `sourceId` | string \| null | 是 | 站点 SKU / 产品型号 / 货号原文 |
| `sourceUrl` | string | 是 | 该商品详情页完整 URL |
| `name` | string | 是 | 商品名（去重后的唯一叫法，见 §3） |
| `subtitle` | string | 是 | 一句话规格摘要，如 `M6×20 · 14.9级 · 合金钢`；无信息时用 `品牌 + 分类名` |
| `brand` | string | 是 | `EGM` / `EG` / `OSG` / 其他站点品牌原文 |
| `categoryPath` | string[] | 是 | 完整分类路径，从一级到三级；只有一级就给 1 个元素 |
| `categoryCode` | string | 是 | 一级分类短码，必须出现在 `categories[].code` 里 |
| `specs` | object<string,string> | 是 | 结构化规格，键用中文短名：`规格`/`等级`/`材质`/`标准`/`螺纹`/`长度` 等；无则 `{}` |
| `unit` | string | 否 | `支`/`个`/`套`/`盒`；未知给 `""` |
| `packQty` | number \| null | 否 | 包装量（每包/盒数量），未知 null |
| `priceFen` | number \| null | 是 | 分。`null` = 无任何公开价 |
| `priceSource` | `anonymous` \| `login` \| `inquiry` | 是 | 价格来源。无公开价一律 `inquiry` |
| `priceCapturedAt` | string | 是 | ISO 时间，抓取该价格的时刻 |
| `stock` | number | 是 | 公开库存数；不可见给 `0` |
| `stockSource` | `anonymous` \| `unknown` | 是 | 库存来源 |
| `images` | array | 是 | 见 §2.4，可为空数组 |
| `description` | string | 是 | 描述要点，多条用 `\n` 分隔；无则 `""` |
| `rawName` | string | 是 | 站点原始标题（排查用，前端不展示） |

### 2.2 价格纪律（硬约束）

- 匿名可见的价格 → `priceFen` 为真实分值，`priceSource: "anonymous"`。
- 需要登录才可见 → **不要编造**：`priceFen: null`、`priceSource: "inquiry"`，并在 `crawl-report.json` 记录需要登录的条目数。
- 页面写「询价/请联系」→ `priceFen: null`、`priceSource: "inquiry"`。
- `priceFen: 0` 只允许表示「真实免费」，本项目不使用。

### 2.3 字段缺失的兜底

- `name` 缺失 → 用分类路径最后一段 + 规格拼；仍拼不出则整条进 `skipped`，写明原因。
- `sourceUrl` 缺失 → 整条进 `failed`，不要凭空造 URL。

### 2.4 图片

```jsonc
{ "remote": "https://…原始地址", "staged": "images/<sha1>.<ext>", "role": "cover | gallery" }
```

- 抓取端负责把原图下载到 `source/images/`，文件名 = 内容 sha1 + 扩展名（同名即同一张图，天然去重）。
- 下载失败的图：`staged` 给 `null`，并计入 `crawl-report.json.failedImages`；**不得**保留不可达的 remote 让前端热链。
- 第一张 `role: "cover"`，其余 `gallery`。没有图的商品也要能进库（前端兜底占位）。

## 3. 命名与去重（单一事实源）

- 商品名去掉站点标题里的营销前缀/后缀（如 `新品`、`热卖`、`促销`），保留「品牌 + 等级 + 品类 + 规格」。
- 同一 `sourceKey` 只出现一次；同款不同规格（M6×20 / M8×30）是不同商品，靠规格区分，名字里必须带规格。
- 分类名只在 `categories[]` 里定义一次；商品侧只引用 `categoryCode`，不得自造同义名。

## 4. 商城侧 DTO 扩展（导入端实现，前端消费）

`ProductDto` 增补以下**可选**字段（不动既有字段，旧数据零影响）：

```ts
brand?: string;
categoryPath?: string[];
categoryName?: string;                                  // 一级分类中文名
specs?: Record<string, string>;
unit?: string;
packQty?: number;
priceSource?: 'anonymous' | 'login' | 'inquiry';
priceCapturedAt?: string;                               // ISO
sourceUrl?: string;
```

展示规则（前端）：
- `priceSource === 'inquiry'` 或 `priceFen === 0` → 显示「询价」，并**禁用加购/下单**（避免 0 元订单）。
- 有 `unit`/`packQty` → 价格旁显示 `元/支`、`100 支/包`。
- `sourceUrl` 仅在详情页显示为「来源：站点链接」，文案标注「内部选品底稿，非对外报价」。

## 5. 数据库增补（导入端实现）

`products` 增列（幂等迁移 `infra/sql/0006_products_import.sql`）：

`source_key`（唯一索引）、`source_url`、`source_id`、`brand`、`category_path`（text，`/` 连接）、
`category_name`、`specs`（jsonb）、`unit`、`pack_qty`、`price_source`、`price_captured_at`、
`stock_source`、`import_batch`。

幂等 upsert 规则：
- 键 = `source_key`；已存在则只更新**导入侧字段**（价格、图片、规格、描述、来源），
  人工改过的 `title`/`category`/`stock`/`sortNo` 不覆盖（若有 `import_batch` 之外的修改痕迹）。
- 重复导入同一批 → 商品总数不变，`import-report.json` 里 `updated` 增加、`inserted` 为 0。

## 6. 图片落地

- 落盘位置：`STORAGE_DIR/products/<sha1>.<ext>`；对外地址 `/media/products/<sha1>.<ext>`。
- 商品数据里 **只出现 `/media/...` 本地地址**，绝不出现 `egluosi.com` 图床地址（前端不得热链）。
- 已在 `source/images/` 里的 sha1 直接复用，重复导入不重复拷贝。
