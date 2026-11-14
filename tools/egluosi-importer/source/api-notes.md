# egluosi B2B 站点接口嗅探笔记（抓取端复跑依据）

> 嗅探时间：2026-11-14（Asia/Shanghai）。目标站 `https://eg.egluosi.com/b2b/`（鹏驰五金 EGM/EG/OSG 目录站，上海埃林哲 pjax + bootstrap-table 风格 SPA）。
> 本批数据仅作内部选品/报价底稿；商品图与文案版权归原站，对外展示必须带来源与抓取时间戳；不绕过登录、不做高频请求。

## 1. 基址与握手

| 项 | 值 |
| --- | --- |
| 页面根 | `https://eg.egluosi.com/b2b/` |
| 业务接口基址 | `https://eg.egluosi.com/b2b-svr/` |
| 静态图床基址 | `https://eg.egluosi.com/b2b/static/uploads/` |
| 页面 HTML 标记 | `<html data-root=/b2b/ data-svr=https://eg.egluosi.com:443/b2b-svr/ data-csrf=1>` |

**CSRF / 放行条件（关键）**：直接请求业务接口会返回 `404`（空 body），必须先做握手：

1. `GET /b2b-svr/csrf`（带 `X-Requested-With: XMLHttpRequest`、`Referer: https://eg.egluosi.com/b2b/`）。
2. 响应头 `el-result-code` 给出 token；同时 `Set-Cookie: el-xsrf=<token>; Path=/b2b-svr/; HttpOnly`。
3. 后续所有业务请求同时携带：
   - 请求头 `el-xsrf: <token>`
   - Cookie `el-xsrf=<token>`
   - 请求头 `X-Requested-With: XMLHttpRequest`、`Referer`（对应列表/详情页）、浏览器 UA。
4. 框架封装见站点 `static/global/js/app.js`：`$.ajaxSetup` 的 `beforeSend` 里 `xhr.setRequestHeader(EL.CTXT.csrf.key, EL.CTXT.csrf.token)`，`key='el-xsrf'`，token 取自 csrf 响应头 `el-result-code`（`rstCode`）。
5. 未登录匿名会话即可浏览目录、列表、详情与面价；无需登录态 Cookie。若运行中 token 失效（404/401），重新走第 1 步握手刷新。

## 2. 分类树

- `GET /b2b-svr/api/ctg/ccc`
- 返回：数组，三级嵌套。节点结构：

```jsonc
{
  "ctg": { "code": "110001", "name": "12.9级内六角", "pcode": "1100", "value": "007" },
  "subs": [ /* 下一级节点，叶子级为 null */ ]
}
```

- 层级：`c1`（一级，`subs` = 二级）→ `c2`（二级，`subs` = 三级）→ `c3`（三级叶子）。
- 2026-11-14 枚举结果：**6 个一级 / 53 个二级 / 344 个三级叶子**。
- 一级清单（站点 `ctg.value` / 名称）：
  - `002` EG螺丝类
  - `001` EGM螺丝类
  - `003` 汽车螺丝类
  - `004` 手工具类
  - `005` 膨胀类
  - `006` 成品刀刃具类
- 备用导航：按标准浏览 `api/ctg/std?c1=<c1.value>`；本批抓取不依赖该入口，三级叶子已覆盖全部目录。

## 3. 商品列表（按三级分类）

- `GET /b2b-svr/api/mall/ccc_items?c3=<叶子value>&offset=0&limit=200`
- 浏览器原始请求还带 `sort=id&order=desc&sortBy=id&sortDirection=DESC&_=<毫秒时间戳>`；非必需，服务端按 `offset/limit` 分页，`limit` 最大可到 200+（实测 200、500 均按总量返回）。
- 返回：

```jsonc
{
  "total": 152,            // 该三级分类站点条数（覆盖度核对基准）
  "rows": [ /* 见下行字段 */ ]
}
```

- 备用入口：`api/mall/std_items?c1=<c1>&std=<标准>`（标准视图，未使用）；筛选条件 `api/mall/ccc_filter?c3=`、`api/mall/std_filter?c1=&std=`。

### 3.1 行字段（实测样例）

| 字段 | 含义 | 备注 |
| --- | --- | --- |
| `no` | 商品内部号（详情 `itemNo`） | 数字，如 `764393` |
| `code` | 项目号 / 货号原文 | 如 `100001060008`；可能为空 |
| `name` | 品名（站点原始标题） | 如 `EGM-14.9级公制内六角圆柱头螺丝` |
| `brand` | 品牌原文 | `EGM牌` / `EG牌` / 空串；空串需从品名前缀兜底识别（OSG/UTOOL/ET/U-POWER/MH/SKC 等） |
| `std` | 标准 | `DIN912`、`GB5783`；部分为 `无` |
| `spec` | 规格 | `M6-1.0x8`、`M1.2x0.25xOH1`、`1.3`；**每个尺寸是独立行** |
| `grade` | 等级 / 材质牌号 | `14.9`、`12.9`、`CR-V` |
| `treat` | 表面处理 | `发黑`、`镀锌`、`镀镍`；可能为空 |
| `teeth` | 牙别 | `全牙`；可能为 null |
| `material` | 材质 | `40CrMoV`、`ML40Cr`、`普料`；可能为 null |
| `c3` | 所属三级分类 value | 与树叶子一致 |
| `convs` | 包装换算 | `{"BX":500,"EA":1,"CA":6000}`，单位→支数 |
| `convsDesc` | 包装描述原文 | `1箱=12盒,1盒=500支` |
| `units` | 可售单位 | `[{"code":"BX","name":"盒"},{"code":"CA","name":"箱"}]`；`EA`=支 |
| `basePrcD3N2` | **千支面价（元/1000 支），匿名可见** | 如 `420.00`；可能为 0/空 |
| `disD2N2` | 商城折扣（%） | 如 `100.00` |
| `tejiaD2N2` | 特价折扣 | `0` 表示非特价 |
| `invStatus` / `invStatusDesc` | 库存状态码 / 文案 | 如 `3` / `缺货`；真实库存数登录后才可见 |
| `invQtys` | 库存数 | 匿名恒为 `0`，不作为公开库存 |
| `onSale` | 是否在售 | 布尔 |
| `manjianTipTexts` / `tipText` | 满赠/提示文案 | 数组/字符串 |

### 3.2 价格口径（重要）

- 匿名可见的只有 **千支面价 `basePrcD3N2`（元/千支）** 与折扣率；**折后千支价、需求支数、真实库存均显示「登录可见」**，不绕过登录。
- 抓取端换算：面价折成「分/支」= `round(basePrcD3N2 / 10)`（元/千支 ÷1000 = 元/支，×100 = 分/支）；原始千支面价保留在 `specs.千支面价(元/千支)`。
- 面价为空 / 0 → `priceFen: null`、`priceSource: "inquiry"`，绝不编造。
- 金额试算接口 `api/mall/amtN2?itemNo=&packQty=&packUnit=` 返回纯十进制字符串（如 `210.00`），由面价 × 包装换算得出，不作为独立报价依据。

## 4. 商品详情

- 页面：`/b2b/mall/item?itemNo=<no>`
- 接口：`GET /b2b-svr/api/mall/item?itemNo=<no>`
- 返回对象结构与列表行一致，额外字段：
  - `auxItems`：配套商品（`{no,name,spec,c3}`）
  - `prevSubItem` / `nextSubItem`：替代商品
- 列表行已包含目录所需全部结构化字段；配套/替代商品不纳入本批 catalog。
- 详情页无独立商品描述长文，规格信息以页面「商品规格」表为准（品牌/等级/包装/项目号/规格/品名/材质/标准/牙别/表面处理）。

## 5. 图片规律

- 图床相对路径：`item/c3/<c3.value>/<变体>`，完整地址前缀 `https://eg.egluosi.com/b2b/static/uploads/`。
- 变体（分类级画廊，同三级分类下所有商品共用）：

| 变体 | 用途 |
| --- | --- |
| `img1_l` | 大图 / 主图（封面） |
| `img1_m` | 中图 |
| `img1_s` | 缩略图 |
| `img2_s` / `img3_s` / `img4_s` | 画廊缩略图 |
| `spec` | 规格详图 |

- 实测图片**不需要 Referer** 即可访问；响应 `Content-Type: application/octet-stream`，扩展名按魔数判定：`ffd8ff` → jpg，`89504e47` → png，`47494638` → gif，`52494646` + `webp` → webp。
- 部分变体在某些分类下不存在（404 / 空文件），该图 `staged: null` 并计入报告失败数，不留 remote 热链。
- 图片按内容 sha1 落盘：`source/images/<sha1>.<ext>`，同名天然去重。

## 6. 抓取纪律（脚本必须遵守）

- 请求间隔 ≥ 400ms，并发 ≤ 2；遇 429 / 403 立即退避（≥2s 重试，最多 3 次）并记入 `crawl-report.json.errors`。
- 编码：接口 JSON 为 UTF-8；落盘统一 UTF-8（无 BOM）。
- 覆盖度：每个三级分类都要翻完全部分页；`rows.length` 与 `total` 的差额逐条/分类记入报告。
- 不抓取登录后才可见的折扣价与真实库存；不解析、不存储登录凭据。
