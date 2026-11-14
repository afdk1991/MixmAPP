# 交付报告：egluosi 全站五金目录导入商城（2026-11-14）

> 编号说明：`23`、`24` 已分别被《项目接管报告》与《全平台连通性审计》占用（lint 要求 docs 编号唯一），本篇取空号 **25**。

## 0. 一句话结论

`https://eg.egluosi.com/b2b/` 全站 **15,037 条商品**（6 个一级类 / 53 个二级类 / 344 个末级类，分类差额全为 0）
已**幂等、可追溯、带本地图**地导入本机 PG 库 `mixmapp`，商城列表可按分类 + 关键字分页翻到第 15,043 条，
详情页图文与规格表可用；询价商品在前后端双向禁购。**线上 `cloud.mixm.top` 仍是旧构建**，需重新部署才生效。

## 1. 总量与覆盖度

| 指标 | 数值 | 证据 |
| --- | --- | --- |
| 站点扫描条数 | 15,037 | `source/crawl-report.json` `counts.scanned` |
| 成功导入 | 15,037 | `out/import-report.json` `updated=15037` |
| 跳过 skipped | **0** | 同上 |
| 失败 failed | **0** | 同上 |
| 一级 / 二级 / 末级分类 | 6 / 53 / 344 | `crawl-report.perCategory`，344 行 |
| 分类条数差额 | **全部 diff=0** | 344 行逐行 `siteCount` vs `count` |
| 有商品的末级类 / 空类 | 282 / 62 | 空类不产出商品，也不下载图 |
| 商品 JSON 体积 | 35.6 MB | `source/catalog.json` |
| 库内总行数 | **15,043** | 15,037 导入 + 6 条 `0002_mall.sql` 自带演示品 |

覆盖度不是「只抓首页推荐」：抓取端先枚举完整分类树（`api/ctg/ccc`），再对每个末级类按
`api/mall/ccc_items?c3=&offset=&limit=200` 翻页到底，最后做「站点条数 vs 实际抓取条数」逐类对账，
`perCategory` 里每一行都能看到 `siteCount / count / diff`。

## 2. 分类分布（导入部分）

| 一级分类 code | 名称 | 条数 |
| --- | --- | --- |
| `eg-screw` | EG螺丝类 | 6,160 |
| `cutting-tool` | 成品刀刃具类 | 5,947 |
| `egm-screw` | EGM螺丝类 | 2,251 |
| `hand-tool` | 手工具类 | 253 |
| `expansion` | 膨胀类 | 249 |
| `auto-screw` | 汽车螺丝类 | 177 |
| **合计** | | **15,037** |

`GET /api/v1/mall/categories` 返回的是**全库**聚合（含 6 条演示品所在小类）：
10 类、`sum(count)=15043`，与 `select category, count(*) from products group by 1` 逐行一致。

## 3. 价格口径（这是最重要的一条业务事实）

站点是**千支面价**体系，不是「一口价」：

- 匿名可见：千支面价 `basePrcD3N2`（元/千支）与折扣率 → 换算成 **分/支**：
  `priceFen = round(元/千支 ÷ 10)`。原始面价保留在 `specs["千支面价(元/千支)"]` 与 `specs["折扣(%)"]`。
- **14,720 条** 有匿名面价 → `priceSource: "anonymous"`。
- **317 条** 无面价（站点标记缺货/下架）→ `priceFen: null` + `priceSource: "inquiry"`。
- **折后千支价、需求支数、真实库存数量需登录才可见** —— 本批**未抓取、未绕过登录**；
  因此全部商品 `stock = 0`、`stockSource: "unknown"`，前端不展示库存数字，只展示「询价 / 联系报价」或面价换算价。
- 没有任何一条价格是编造的：无面价就标询价，有面价就保留原始面价字段可复核。

## 4. 图片本地化

| 指标 | 数值 |
| --- | --- |
| `source/images/` 唯一落盘文件 | **871** 张（按内容 sha1 命名，天然去重） |
| 落地到 `STORAGE_DIR/products/` | 871 张（复跑不重复拷贝） |
| 有本地封面的商品 | **11,233** 条（`cover = /media/products/<sha1>.jpg`） |
| 无图商品 | **3,804** 条（站点该分类本身没有画廊图，或全部变体 404 → `staged: null`） |
| 站点缺失变体（404/1×1 占位） | 661 个变体 URL，逐条记入 `crawl-report.errors` |

**图片是「分类级画廊」**：站点没给单品独立图，同一三级分类下商品共用
`img1_l / img1_m / img2_s~img4_s / spec` 六张。所以你会看到同一类目下多条商品同封面——这是源站结构，不是导入 bug。
商品数据里**只出现 `/media/products/...` 本地地址**，全库没有任何 `egluosi.com` 图床热链。

## 5. 幂等与命名

- **稳定键**：`sourceKey` = `sku:<项目号>`；无项目号时退化为 `url:<规范化 URL>`。全库 `count(distinct source_key)=15037`。
- **复跑幂等**：连跑两轮全量 → `inserted=0, updated=15037, skipped=0, failed=0`，库总行数仍 15,043，商品不增不减。
- **不覆盖人工字段**：upsert 只刷新导入侧字段；`title` 一旦被人工改过（`importBatch='manual'`）不再被覆盖。
- **同类同名单卡去重**：站点存在 14 组「同分类、同名字、不同项目号、不同价格」的商品
  （如 `UTOOL机用铰刀 4.5` 有 2200 分与 2500 分两个货号）。导入侧按
  「包装优先、货号兜底」加后缀消歧：`UTOOL机用铰刀 4.5 · 货号045000` / `· 货号045002`。
  复跑后 `count(*)=15037` 且 `count(distinct title)=15037`，同名同分类分组 **0 行**，后缀不叠层。

## 6. 接口与前端改动

新增/变更（前缀 `/api/v1`）：

| 接口 | 说明 |
| --- | --- |
| `GET /mall/products?category&keyword&page&pageSize` | `pageSize` 1–50，`page` 上界已放开到 100000（此前 100 页封顶只能翻 5000 条） |
| `GET /mall/products/:id` | 返回导入增补字段 |
| `GET /mall/categories` | 真聚合 `[{code,name,count}]`（此前假数：只回 1 类、count=5000） |
| `POST /admin/mall/import` | `x-admin-token` 守卫，body 支持 catalog 对象或 `{file}`（限仓库根内）；内部按 5000/批自动分片，15k 一把过 |

`ProductDto` 增补可选字段：`brand / categoryPath / categoryName / specs / unit / packQty / priceSource / priceCapturedAt / sourceUrl`。
**询价语义**：`priceFen` 为 `number`，询价映射为 `0` 且同时 `priceSource='inquiry'`——
判「能不能买」必须两者并看，不能只判 0。服务端已兜底：询价或 0 元商品加购/下单返回 **409**。

前端（`apps/app`）：分类 tab 由 `/mall/categories` 驱动并带真实计数；首屏 20 条 + 触底翻页；
询价商品显示「询价 / 联系报价」且隐藏加购（详情页、购物车结算双重拦截）；
详情页按 `categoryPath` 面包屑 + `specs` 规格表 + `unit/packQty` + SOURCE 来源块（含抓取时间与「内部选品底稿，非对外报价」声明）。
分类 tab 只渲染 6 个真实五金类目，迁移自带的 `featured/life/digital/wear` 演示分类不再以英文代码露头。

### 6.1 收尾复验逼出来的两个硬 bug（都已修）

1. **全域限流 60/分把商城掐死**：`app.ts` 的固定窗口限流原先对所有路径生效，
   而 15k 目录要 301 页、且每张封面图都是一次请求——量测时扫到第 61 页就 `429`，
   真实用户翻两屏就会断。改为「只读 GET `/api/v1/mall*` 与 `/media/*` 不计入限流」，
   登录/下单等写路径的限流保持不变。
2. **分页排序不稳定，出现重复卡片 + 漏商品**：原排序 `sort_no asc, created_at desc`，
   批量导入的 `created_at` 大量相同，`limit/offset` 在不同请求间漂移。
   全量扫页实测 **301 页只取到 15,039 个唯一 id（4 重复 / 4 漏）**；
   排序补上 `id desc` 稳定兜底后复测：**301 页 / 15,043 唯一 id / 0 重复**。

## 7. 复跑命令（真跑得起来的完整口径）

```powershell
# 1) 抓取（限速 400ms、并发≤2；--limit N 可小样本，--c3 值 可单分类）
node tools/egluosi-importer/crawl.mjs

# 2) 建库 + 迁移（本地 PG）
psql -h 127.0.0.1 -U postgres -c "create database mixmapp;"
$env:DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/mixmapp"
node services/api/dist/db/migrate.js

# 3) 全量导入（CLI，内部自动分片；幂等，可反复跑）
$env:DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/mixmapp"
node tools/egluosi-importer/import.mjs
# → 导入完成：inserted=0 updated=15037 skipped=0 failed=0 imagesLocalized=64576

# 4) 起服务看商城（本地）
$env:PORT="8094"; $env:DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/mixmapp"
$env:ADMIN_TOKEN="import-token"; $env:STORAGE_DIR="F:\合并项目\MixmAPP\storage"
node services/api/dist/index.js

# 5) 也可以走 HTTP 通道（内存库演示时唯一可行的路径，因为内存库随进程消失）
Invoke-RestMethod -Uri "http://127.0.0.1:8094/api/v1/admin/mall/import" -Method Post `
  -Headers @{ "x-admin-token"="import-token" } -ContentType "application/json" `
  -Body '{"file":"tools/egluosi-importer/source/catalog.json"}'
```

> `imagesLocalized=64576` 是**商品-图引用**累计条数（15037 条商品 × 平均约 4.3 张引用），
> 磁盘上唯一图片文件是 871 张，两者口径不同，别当成「拷了 6 万张图」。

## 8. 已知限制（不藏）

1. **线上未部署**：`cloud.mixm.top` 当前跑的是旧构建（DTO 还没有 `brand/specs/priceSource`）。本批改动要生效必须重新部署 API。
2. **CloudBase PG 网关链路未复验**：线上走 `public.mix_exec` HTTP 桥，本机无 `CLOUDBASE_PG_API_KEY`。
   若桥层把雪花 id（约 1.1e17，超过 `Number.MAX_SAFE_INTEGER`）按 JSON number 回传会丢精度，导致按 id 查详情失败——
   代码侧已加 `String(id)` 兜底，但拿到凭据后仍需先确认回传行的 id 是字符串还是 number。
3. **6 条迁移自带演示品**（`mix-p-1001..1006`，分类 `featured/wear/life/digital`）与五金目录混排，都在末页。
   建议后续打 `isDemo` 标记或从公开列表过滤；本轮**未删任何库内数据**。
4. **库存/折后价未取**：需登录，属站点风控范围，未绕过。
5. **3,804 条无图**：源站该类目无画廊图，前端走占位色兜底，不是导入漏映射。
6. 抓取端 `imagesFailed` 的 661 个变体是站点 404 或 1×1 透明占位图，已逐条记录并过滤，未热链。

## 9. 合规边界（写进产品口径）

- 商品图与文案版权归原站（鹏驰五金 EGLUOSI），本批数据**只作内部选品/报价底稿**。
- 对外展示时必须带来源 URL 与抓取时间戳，**不得当作正式对外报价**。
- 抓取全程未绕过登录/风控，限速 ≥400ms、并发 ≤2；317 条需登录才可见价的商品一律标「询价」，没有编造价格。

## 10. 验收自查

| 验收项 | 结果 | 证据位置 |
| --- | --- | --- |
| 全分类全分页覆盖 | ✅ 344 类 diff 全 0 | `crawl-report.json` |
| 可追溯（来源 URL + 货号 + 抓取时间 + 价格来源） | ✅ 全字段落库 | `products.source_url/source_id/price_source/price_captured_at` |
| 字段完整（名称/品牌/路径/规格/单位/包装/价/图/描述） | ✅ | 见 §2 样例与 DTO |
| 幂等 | ✅ 复跑 `inserted=0 updated=15037` | §5 |
| 命名唯一 / 无同款重复卡 | ✅ 15037/15037 唯一，0 重复组 | §5 |
| 前端可用（分页到第 15043 条、详情不崩、空态兜底） | ✅ 301 页扫完 15,043 唯一 id、0 重复；末日 3 条详情 200 | §6.1 |
| 只读目录不被限流误杀 | ✅ `GET /mall*` 与 `/media/*` 免限流，同刻写路径仍 60/分 | §6.1 |
| 图片本地化、无热链 | ✅ 871 张落盘，0 外部图床 | §4 |
| lint | ✅ 仅剩 `docs/22-audit-*` 两篇（他人未提交在途文件）；本轮撞 16 的两篇已改号为 26 | 见 §12 |
| 本地实跑截图 | ✅ | §11 |

## 11. 截图（全部为真实 15k 库 + 390 宽 H5 视口）

- `docs/screenshots/mall-import-live-list.png` — 列表首屏：分类 tab 带真实计数（全部 / EG螺丝类 6160 / 成品刀刃具类 5947）、真实五金商品与面价换算价（如 Wilson 洗石笔 ¥55.00 元/支）
- `docs/screenshots/mall-import-live-list-v2.png` — 终版列表（含上面两处修正后重拍）：分类 tab 只剩 6 个真实五金类目（迁移自带的 `featured/life/digital/wear` 演示分类不再显示英文代码）、卡片价格行与状态行不再重复输出「缺货」
- `docs/screenshots/mall-import-live-list-images.png` — 关键字 `UTOOL` 检索：真实钻头封面图 + 品牌角标 + `¥140.00 元/箱` + `1 箱/包`
- `docs/screenshots/mall-import-live-list-page2.png` — 触底翻到第二屏（SKC 美制丝锥系列），与首屏 id 交集 0
- `docs/screenshots/mall-import-live-detail.png` — 有图商品详情：主图 + 5 张缩略、品牌、面包屑「成品刀刃具类 / UTOOL钻头类 / UTOOL锥柄普长钻」、规格表、`¥1300.00 元/箱`、SOURCE 来源块（URL + 复制链接 + 抓取时间 + 底稿声明）
- `docs/screenshots/mall-import-live-detail-inquiry.png` — 询价商品：无图占位不破图、「询价 / 联系报价」、无步长/无加购
- `docs/screenshots/mall-import-live-detail-longtitle.png` — 长标题 + 长规格值：面包屑与副标题折行、`千支面价(元/千支)` 键列换行
- `docs/screenshots/mall-import-live-detail-outofstock.png` — 有价但缺货商品（`Wilson洗石笔 1/2x8x0.5`，id `114800787074318337`）：价格行右侧只标「缺货」，底部向左显示「库存状态 · 缺货」、右侧是**描边 ghost 按钮「询价确认」**（不是黑底购买按钮，点了弹缺货说明），不给必然失败的假购买入口
- `docs/screenshots/mall-import-mock-*.png` / `*-old8080.png` — 早期 fixture 验证样张与旧实例截图，保留备查

## 11.1 购买入口的状态口径（真实数据逼出来的）

源站**不公开真实库存**，且这批目录里大量商品源站标注「缺货」。所以落库后 `stock = 0 / stockSource = unknown`。
如果按普通电商逻辑「有价即可买」，点下去必然被服务端 `库存不足` 拒掉——那是假按钮。最终口径：

| 商品状态 | 列表/详情表现 |
| --- | --- |
| 询价（无面价，317 条） | 「询价 / 联系报价」，隐藏加购与下单 |
| 有面价 + `stock <= 0`（本批大多数） | 正常显示价格 + 「缺货」状态标记，底部「库存状态 缺货」+ 描边按钮「询价确认」，无步长、无加购、无立即购买 |
| 有面价 + `stock > 0` | 数量步长 + 加入购物车 + 立即购买（保留可用路径） |

也就是说：**这批目录当前是「可浏览、可询价、按面价参考」，不是「可直接下单」**——真实库存与折后价在源站需登录，
本项目没有绕过，这是数据事实，不是功能缺失。

## 12. lint 现状（如实说明）

`node scripts/repo-lint.mjs` 现在只剩 **1 处**：`docs/22-audit-*` 两篇撞 22。
这两篇是**另一个会话未提交的在途文件**（`git status` 里是 `??`，不是本轮的产物），
改名会把对方正在写的文件挪走，本轮只在本报告里登记，不越权处理。

原先撞 16 的两篇已按仓规处理：`docs/16-ui-layout-audit-2026-11-14.md` 已 `git mv` 为
`docs/26-ui-layout-audit-2026-11-14.md`（取当前最大号 25 之后的空号，历史保留），
另一篇 oauth 交付报告继续占 16。本轮新增代码与文档**零违规**。
