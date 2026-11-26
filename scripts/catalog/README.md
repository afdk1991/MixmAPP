# catalog 采集器（egluosi / hznzcn 双货源站）

把 `https://eg.egluosi.com/b2b` 的目录树、类目商品、规格筛选项、商品详情、类目画廊图
抓下来，按 `source_key` 幂等写入 `products`，变更写字段级流水。
第二个源 `https://www.hznzcn.com/` 走独立适配器（`sites/hznzcn.mjs`），共用入库/图片/断点续跑。

## 怎么跑

```bash
pnpm catalog:sync                      # 全量抓取 → 比对 → 入库（egluosi）
pnpm catalog:sync --site hznzcn        # 只跑 hznzcn：全部分页（pages=0）+ 全部叶子类目（per-cat=0）
pnpm catalog:sync --dry-run            # 只对账不写库（不碰 products / 流水 / runs 表）
pnpm catalog:sync --resume             # 断点续跑上一次未完成的运行（14 天内有效）
pnpm catalog:sync --limit 3            # 只处理前 3 个三级类目（调试）
pnpm catalog:sync --max-runtime-min 90 # 单轮最多 90 分钟，到点优雅收尾，下一轮续跑
pnpm catalog:sync --no-delist          # 本轮不下架任何已有商品（定时任务默认开启）
pnpm catalog:sync --no-images          # 不下载图片
pnpm catalog:sync --filters-only       # 只抓目录树与规格筛选项
pnpm catalog:sync --catalog-only --site hznzcn  # 只枚举目录（摸清全量规模），不抓详情不写库
pnpm catalog:inspect --item-no 764393  # 只读对账：单件
pnpm catalog:inspect --brand EGM --spec M6-1.0x8 --dims 6 --lens 8
pnpm catalog:inspect --item-no 764393 --no-db   # 不读库，只看源站映射结果
pnpm catalog:inspect --show-mapping    # 附打印字段映射表
```

常用参数：`--base-url` `--concurrency` `--delay-ms` `--list-delay-ms` `--pages` `--per-cat`
`--state-dir` `--storage-dir`。`node scripts/catalog/cli.mjs --help` 有完整列表。

## 定时与手动

- **定时只跑 egluosi**：生产 `run.sh` 的 `SITES` 默认值就是 `egluosi`，**每日 02:30（Asia/Shanghai）**
  无人值守续抓，默认全量全分类覆盖，按 `source_key` 幂等累积。单轮默认上限
  `CATALOG_MAX_RUNTIME_MIN=150` 分钟，到点优雅收尾，次日 `--resume` 接着跑，**逐日累积到全量**。
- **已有商品不下架**：定时任务默认带 `--no-delist`（`CATALOG_NO_DELIST=0` 可关闭），只 upsert，
  不会把源站暂时没抓到的商品标停售。
- **hznzcn 不做定时，只按需手动**：它是独立适配器（`--site hznzcn`），状态文件
  `hznzcn-state.json`、快照 `hznzcn-*.json` 与 egluosi 完全分开；`source_key` 前缀 `hzn:`，
  id 前缀 `hzn-`，不会覆盖或撞号 egluosi 的既有商品。`--site hznzcn` 默认 `pages=0`（抓完为止）、
  `per-cat=0`（不限件数），即全部分页 × 全部叶子类目。
- 生产机 IP 被源站 WAF 封，手动同步必须**本地采集 + SSH 隧道写库 + 图片推送**，
  完整可粘贴命令见 [`deploy/CATALOG-DEPLOY.md`](../../deploy/CATALOG-DEPLOY.md)「11. hznzcn 手动同步」。
- 手动有界运行（带 `--per-cat` / `--max-items` / `--limit` / `--pages`）时 `delistSafe=false`，
  **永远不会下架任何商品**；新增走 `on conflict (source_key) do nothing`，重跑不产生重复行。

生产机上（库连接在 `/etc/mixmapp/api.env`）手动触发一轮（与定时任务同参数）：

```bash
set -a; . /etc/mixmapp/api.env; set +a
/opt/mixmapp/catalog-sync/run.sh          # 等价于下面的 cli 命令，带 flock/预算/续跑
node /opt/mixmapp/current/scripts/catalog/cli.mjs sync --resume --max-runtime-min 150 --no-delist
```

## 图片尺寸策略

源站同一张图实测有 4 档（2026-11 抽样 9 个三级类目）：

| 档位 | 尺寸 | 说明 |
| --- | --- | --- |
| `img1`~`img4`（无后缀） | 1000×1000 | **原图质量，文件最大 → 采集器默认取这档** |
| `img1_l` 等 | 1000×1000 | 二次压缩，只作 404 降级 |
| `img1_m` 等 | 800×800 | 降级档 |
| `img1_s` 等 | 80×80 | 旧采集器用过的小图 |
| `_xl` / `_b` / `_o` | — | 源站不存在（404） |

- 同一 c3 的多张图内容是同一张时，按 SHA1 去重，详情页不再出现 4 张重复图。
- 旧小图回填：
  - egluosi：`node scripts/catalog/reimage.mjs`（按 344 个三级类目重拉原图，只更新 images/cover/spec_image）
  - hznzcn：`node scripts/catalog/reimage.mjs --site hznzcn`（按商品重抓详情页原图，
    **只有新图确实更大才写库**，默认阈值 `--reimage-min-side 800`，可 `--resume` 跨多次跑）

## 跑多久

一轮全量（15,037 条商品，默认 250ms/详情、400ms/列表）：

| 阶段 | 实测耗时 |
| --- | --- |
| 目录树 + 列表 + 筛选项 + 画廊 | ~824s（14 分钟） |
| 详情（15,037 件） | ~3,775s（63 分钟） |
| 比对入库 | ~7s |

合计约 77 分钟。限频由 `--delay-ms` / `--list-delay-ms` 控制，调小会更快但更容易被限流。

## 失败了怎么续

- 状态、抓取快照、日志、报告都在 `--state-dir`（默认 `<repo>/.catalog-sync`，生产 `/var/lib/mixmapp/catalog-sync`）：
  - `state.json` 阶段进度（`phase` = catalog / detail / apply / done）
  - `catalog.json` 列表阶段快照、`details.json` 详情快照、`gallery.json` 画廊、`filters.json` 筛选项
  - `reports/<runId>.json` 本次汇总，`reports/<runId>.log` 本次日志（保留最近 30 份）
  - `sync.log` 由 `run.sh` 追加写，超过 5MB 轮转为 `sync.log.1`
- 失败后直接 `pnpm catalog:sync --resume`：14 天内且未 `done` 的运行会从断点继续，
  已抓到的详情按货号跳过；列表阶段每个三级类目抓完即落盘（`partial=true`），中断后从**未抓类目**继续。
- 生产 `run.sh` 每轮都带 `--resume`：上一轮没跑完就接着跑，上一轮已完成就自然开新一轮全量。
- 达到 `--max-runtime-min` 预算时优雅收尾（退出码 0，`catalog_sync_runs.status='paused'`），
  下一轮继续，不会被系统超时掐断丢进度。
- 生产 `run.sh` 还会在首次失败（非 0 退出码）30s 后自动 `--resume` 一次，并有 flock 防重入。
- 列表阶段有类目抓取失败时，本轮不做下架判定（`delistSafe=false`），避免把"没抓到"误判为"源站下架"。
- `--limit N` 是局部抓取（只覆盖前 N 个三级类目），本轮同样**跳过下架判定**，不会把未抓到的商品标成下架。

## 幂等与写库规则

- 唯一键 `source_key`：有源站 `code` 用 `sku:<code>`，否则 `url:<站点>/b2b/mall/item?itemNo=<no>`。
- 新增 `on conflict (source_key) do nothing`；已存在按字段 diff 后只更新真正变化的列，并逐字段写 `product_change_log`。
- 源站消失只置 `listed=false` + `source_status='delisted'`，**不物理删除**。
- 库存 `stock` 不由本采集器编造：按箱规 × 10 支估算，`stock_source='assumed-box10'`，无价格/无箱规为 0（`unknown`）。

## 字段映射改哪里

**唯一事实源是 [`mapping.mjs`](./mapping.mjs)**：

- `FIELD_MAP`：源站字段 → 库列（含类型与口径说明）。加字段先改这里。
- `ATTRIBUTE_MAP`：商品属性（规格/标准/等级/材质/牙别/表面处理/包装）的中文标题 ← 源站字段。
- `normalizePrice`：价格与折扣口径。
- `deriveStock` / `buildAttributes` / `buildPromotions` / `buildCatalogItem` / `buildDetail` / `diffProduct`：派生与比对规则。

`collect.mjs` 只负责取数，`store.mjs` 只负责写库，两者都不写字段规则。

### 两处容易踩的口径

1. **折扣**：`disD2N2=100` 是合法值（100% = 无折扣），此时 `discount_pct=100`、
   `sale_price_li` 等于面价；只有源站确实没有 `disD2N2` 字段时才留 `null`。
2. **库存状态**：源站 `invStatusDesc` 落 `source_inv_status`，语义上**优先于**假设库存。
   注意：源站对匿名访问几乎把所有商品都标成"缺货"（15,037 条里 14,720 条），
   因此线上**按信号可信度分级**处理（`MALL_SOURCE_STOCK_GATE` 是唯一总闸）：

   | 取值 | 行为 |
   | --- | --- |
   | `true` / 未设置（默认） | **分级**：`下架/停售/无货` 才硬拦下单；只有 `缺货` 或库存为 0（匿名视图推断）放行，前端标「货源待确认」，不扣估算库存，下单行记 `stock_unconfirmed=true` |
   | `strict` | 旧口径：`缺货/无货/下架/停售` 一律拦截 |
   | `false` | 一律不按源站库存拦截 |

   同步运行结果（run_id、起止时间、成败、失败摘要）可从 `GET /api/v1/healthz` 的
   `catalogSync` 字段读取。

## 结构

```
config.mjs    参数/环境变量解析（CLI > env > 默认）
site.mjs      唯一出网入口：CSRF 握手、限频、重试、图片 SHA1 落盘
mapping.mjs   字段映射与派生规则（改口径只看这里）
collect.mjs   目录树 / 列表 / 筛选项 / 详情 / 画廊 取数
store.mjs     唯一碰库模块：runs 记账、upsert、流水、下架标记
util.mjs      writeAtomic / readJson / rotateLog
cli.mjs       入口：sync / inspect（--site 分流到对应适配器）
sites/hznzcn.mjs  hznzcn 适配器：拓扑解析、字段映射、WAF 限速、图片原图
run.sh        生产 cron 入口（默认只跑 egluosi；flock + 轮转 + 失败续跑 + webhook）
```
