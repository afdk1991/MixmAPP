# 商城页商品列表不渲染（骨架屏常驻）修复报告 · 2026-11-21

## 结论

- 用户反馈“商城里看不到商品”，根因不在数据：线上库里 18,416 条商品、`/mall/products` 与 `/mall/categories` 都正常返回；
  问题在商城页前端 —— **首屏被反复重置成 loading 态**，骨架屏盖住了已经返回的 20 条商品。
- 修复后线上 `https://cloud.mixm.top/pages/mall/index` 首屏直接显示商品卡片，上拉可正常分页（20 → 40 → 60…），分类 chip 切换会带上 `ctgs` 重新拉取。
- “预览版”文案已不存在：线上页脚显示 `版本 0.0.2 · 正式发布`，源码中 `apps/` 下已无“预览版”字样。

## 根因

1. **骨架屏条件过宽**：模板用 `v-if="loading"` 整块替换列表。只要 `loading` 为真，已加载的商品就完全不可见。
2. **H5 上 `onShow` 被重复触发**：`onShow` 里无条件 `refresh()`，页面滚动/切页/重进都会再触发一次首屏请求，
   于是 `loading` 反复置真，列表在“数据已到”和“又被打回骨架屏”之间来回跳，最终多数时刻停在骨架屏。
   实测在页面里滚动数秒即可产生十余次 `page=1&pageSize=20` 请求，且始终没有 `page=2`。
3. **缺少兜底**：`fetchPage` 只靠 `finally` 复位 `loading`；一旦 `uni.request` 回调丢失，`loading` 会永久为真，
   不仅列表卡骨架，`loadMore()` 的 `loading` 守卫也会把上拉分页彻底锁死。

## 改动

`apps/app/src/pages/mall/index.vue`

- 骨架屏条件改为 `loading && products.length === 0`：有数据就立即出列表，刷新期间保留旧列表而不是白屏/骨架。
- `onShow` 增加节流：只有“从未成功加载 / 距上次成功超过 60s / 带 keyword·category 深链”才 `refresh()`，
  其余仅刷新分类与购物车角标，避免滚动导致的重复首屏请求。
- 记录 `lastLoadedAt`，首屏成功落定后更新，作为节流依据。
- `fetchPage` 包一层 20s 看门狗 `withDeadline`：请求悬挂时也会 reject 并走 `finally` 复位 `loading`，
  上拉分页不会因一次异常请求被永久锁住。
- 一并落地商城页购物车角标（`apps/app/src/stores/cart-badge.ts`：进页拉 `GET /mall/cart` 自恢复，加购后 `syncCartBadge`）。

## 验证

本地（`pnpm build:h5` + `scripts/serve-h5.mjs`，API 指向 `https://api.mixm.top/mixmapp/api/v1`）：

- 首屏：`商品 · 20 件`，卡片 20 张，骨架元素 0 个，`list-head` 正常。
- 滚动到底：触发 `page=2&pageSize=20`，列表 40 件；继续到 60 件。

线上（`https://cloud.mixm.top/pages/mall/index`）：

- 首屏 20 张商品卡（首条 `EG 12.9级公制内六角圆柱头螺丝 M3-0.5x4`）。
- 滚动后依次出现 `page=2`、`page=3`，计数 40 → 60。
- 分类 chip：`EG螺丝类` → `ctgs=c1%3A002`；多选 `女装` → `ctgs=c1%3A002,hz1%3A150`（一级类目 OR 语义符合设计）。

分类规模（`GET /mall/categories?parent=root` 汇总，共 15,463 件可浏览）：

| 分类 | code | 件数 |
| --- | --- | --- |
| EG螺丝类 | 002 | 6,160 |
| 成品刀刃具类 | 006 | 5,947 |
| EGM螺丝类 | 001 | 2,251 |
| 男装 | 151 | 294 |
| 手工具类 | 004 | 253 |
| 膨胀类 | 005 | 249 |
| 汽车螺丝类 | 003 | 177 |
| 女装 | 150 | 132 |

## 发布

- 提交：`2dce26b fix(mall): 首屏不再被重复 onShow 刷新打回骨架屏，列表与分页恢复`
- CI：`deploy` run 44894738429 成功；`Android`、`ci` 同批成功。
- 生产 release：`/opt/mixmapp/releases/20261121183505`（`/opt/mixmapp/current` 指向该目录）。
- 版本：`/meta` 返回 `version 0.0.2`、`env production`；页脚文案 `0.0.2 · 正式发布`。

## 遗留建议

- 商城页头部 `商品 · N 件` 目前是“已加载条数”，不是类目总数；如需显示总量，需要接口在列表响应里带 `total`，
  避免用户误以为整站只有 20 件。
- `onShow` 在 H5 的重复触发值得再做一次全局排查（首页当前只刷角标，未受影响）。
