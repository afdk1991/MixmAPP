# 49 · 业务套件（Suite）架构与领域实现规约

> 基线：`F:\合并项目\MixmAPP`，版本 `0.0.2`。
> 本文件是 13 个业务领域的**实现契约**：各领域只按这里写的三条交付物施工，不需要改动共享骨架。

## 1. 为什么这样分层

需求同时提了三件互相拉扯的事：**极致速度 + SEO**、**复杂业务逻辑 + 用户系统 + 海量数据**、
以及**内容更新频率不高**。对应的拆法是：

| 层 | 内容 | 载体 | 特点 |
|---|---|---|---|
| 静态层 | 领域说明、条目清单、FAQ | `apps/app/src/content/suite/<id>.json` | 构建期内联进产物，首屏零请求，可被预渲染成独立 HTML |
| 动态层 | 进度、看板、台账、评论 | `services/api/src/modules/domains/<id>.ts` + 四张通用台账表 | 真实落库、按账号隔离、写操作幂等 |

**静态层**决定「打开就有内容」与 SEO。**动态层**决定「用起来是真的」。两者用 `entryId` 对齐：
内容包里 `entries[].id` 就是动态交互的 `entryId`，评论 / 点赞 / 收藏 / 评分都挂在它上面。

## 2. 共享骨架（已就位，领域不要改）

| 位置 | 作用 |
|---|---|
| `packages/contracts/src/index.ts` | 全部 DTO 与 zod 入参契约（`Suite*` 前缀） |
| `services/api/src/modules/suite/registry.ts` | 13 个领域的元信息登记表（服务端白名单） |
| `services/api/src/modules/suite/domain.ts` | `SuiteDomainModule` 契约 + `createBoardDomain` 工厂 |
| `services/api/src/modules/suite/service.ts` | 通用台账读写、幂等、鉴权口径收口 |
| `services/api/src/routes/suite.ts` | 全部路由（`/api/v1/suite/*`） |
| `services/api/src/db/types.ts` · `memory.ts` · `postgres.ts` | 四张台账表的 Memory / PostgreSQL 双驱动 |
| `infra/sql/0025_suite_core.sql` | 四张台账表 + 索引（幂等，可重复执行） |
| `apps/app/src/api/suite.ts` | 前端动态数据层 |
| `apps/app/src/components/suite/suite-detail-shell.vue` | 13 个领域共用的页面外壳（版式只有这一处） |
| `apps/app/src/components/suite/suite-interaction-bar.vue` | 条目级点赞 / 收藏 / 评论（已内置，无需各领域重写） |
| `apps/app/src/pages/suite/index.vue` | 套件中心（13 领域目录） |
| `scripts/prerender-suite.mjs` | 预渲染独立静态 HTML + `sitemap.xml` + `robots.txt` |

**领域只允许改自己那三个文件**（见 §3），以及可选的新增测试文件。
共享骨架由集成方统一维护，领域并行修改会造成冲突。

## 3. 三个交付物

### 3.1 内容包 `apps/app/src/content/suite/<id>.json`

静态层。**必须是真实、专业、可核验的中文内容**，不是占位文案。

字段与长度要求：

| 字段 | 要求 |
|---|---|
| `id` | 与文件名、领域 id 完全一致（`office` / `finance` / …） |
| `title` | 领域中文名 |
| `category` | 归属分类中文名（与后端 registry 一致） |
| `tagline` | 一句话定位，20–40 字 |
| `accent` | 1–6，配色槽位，保持与后端 registry 相同 |
| `hero.lead` | **长句**，120–220 字，含该领域的核心关键词，自然成段，不堆砌关键词 |
| `hero.points` | 恰好 3 条，每条 12–30 字 |
| `highlights` | 3–5 条，每条 `title` 8–16 字、`detail` 40–90 字 |
| `sections` | 3–5 节，每节 `id`（英文 kebab，唯一）、`title`、`body`（150–400 字）、可选 `bullets`（3–6 条） |
| `faq` | 4–6 条，`q` 问、20–40 字；`a` 答，60–160 字 |
| `entries` | **5–10 条**。`id` 用 `<domainId>-<语义短名>`（英文 kebab，领域内唯一）；`title` 12–24 字；`summary` 50–120 字；`tags` 2–4 个；`meta` 2–5 组 `{label,value}`；`checklist` 2–5 条（该条目的行动要点）；`note` 可选（提醒/限制说明） |
| `updatedAt` | `"2026-11-26"` |

硬性要求：

- 不写「待补全」「示例」「TODO」「待定」这类占位词；
- 不与其他领域重复同一段话（各领域正文互相独立）；
- 涉及数字、法规、剂量、税率时给**区间与适用条件**，并说明依据来源类型（如「按现行增值税一般计税口径」），不要编造具体法条编号或临床结论；
- 医疗、财税、法律三类必须带免责边界（以专业人员意见为准 / 以主管机关口径为准），写在 `hero.lead` 或某个 `section` 里。

### 3.2 领域模块 `services/api/src/modules/domains/<id>.ts`

动态层。基线已用 `createBoardDomain` 给出「条目 + 阶段状态机」，**在此之上加领域自己的业务逻辑**。

### 3.3 领域页面 `apps/app/src/pages/suite/<id>.vue`

在 `#dynamic` 插槽里放该领域的动态面板（进度、看板、台账、领域专属动作）。
页面外壳 `suite-detail-shell` 不要改，版式由它统一保证。

## 4. 领域模块写法

### 4.1 可用上下文

```ts
type SuiteDomainReadContext = {
  userId: string | null;   // 领域动作里一定非空
  store: Store;            // 含 store.suite.{interactions,progress,boards,events}
  config: Config;
  ids: IdFactory;          // ctx.ids.next().id 生成主键
};
```

### 4.2 基线工厂

```ts
import { createBoardDomain, type SuiteDomainModule } from '../suite/domain.js';

const base = createBoardDomain({
  id: 'finance' as SuiteDomainId,
  stages: [
    { key: 'planned', label: '计划中' },
    { key: 'approved', label: '已审批' },
    { key: 'executing', label: '执行中' },
    { key: 'settled', label: '已结清' },
  ],
  transitions: { planned: ['approved'], approved: ['executing', 'planned'], executing: ['settled', 'approved'], settled: [] },
  initialStage: 'planned',
  eventKind: 'finance-item',
  describe: (board) => ({ summary: '…', meta: [{ label: '资金账户', value: '…' }] }),
});
```

工厂已实现的动作（**幂等**，重复提交返回 `changed: false`）：

| action | 行为 |
|---|---|
| `create` | 新建看板条目（`note` 或 `payload.title` 作为标题），并落一条台账事件 |
| `advance` | 推进到当前阶段的**下一个**允许阶段 |
| `setStage` | 跳到 `payload.stage` 指定阶段（不在允许迁移边内则拒绝） |
| `remove` | 删除条目 |

入参统一为 `SuiteActionInput`：

```ts
{ action: string; entryId?: string; amount?: number; note?: string; at?: string; payload?: Record<string, unknown> }
```

### 4.3 扩展方式

领域模块导出的是一个 `SuiteDomainModule` 对象，可以直接包住基线：

```ts
export const financeModule: SuiteDomainModule = {
  id: 'finance',
  // 读：在基线之上补充领域字段
  async list(ctx) {
    const items = await base.list(ctx);
    // 例：把 payload 里的账期算成「距今还剩几天」放进 meta
    return items.map((item) => ({
      ...item,
      meta: [...item.meta, { label: '账期', value: String(item.payload['period'] ?? '—') }],
    }));
  },
  // 写：先处理领域专属动作，未命中再回落基线
  async act(ctx) {
    if (ctx.input.action === 'split_tax') {
      // 领域专属：价税分离
      const amount = Number(ctx.input.payload?.['amount'] ?? 0);
      const rate = Number(ctx.input.payload?.['rate'] ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, changed: false, message: '金额需要是大于 0 的数字', item: null };
      }
      const net = Math.round((amount * 100) / (100 + rate));
      return {
        ok: true,
        changed: true,
        message: `不含税 ${(net / 100).toFixed(2)} 元，税额 ${((amount - net) / 100).toFixed(2)} 元`,
        item: null,
        data: { netFen: net, taxFen: amount - net },
      };
    }
    return base.act(ctx);
  },
  // 统计：基线指标 + 领域指标
  async stats(ctx) {
    const baseStats = await base.stats(ctx);
    const boards = await ctx.store.suite.boards.listByUser(ctx.userId as string, { domainId: 'finance' });
    const total = boards.reduce((sum, b) => sum + b.amountFen, 0);
    return [
      ...baseStats,
      { label: '在账金额', value: `${(total / 100).toFixed(2)} 元`, hint: '全部条目金额合计' },
    ];
  },
};
```

### 4.4 领域模块必须遵守

1. **幂等**：同一 action + 同一入参重复提交，第二次必须 `changed: false`，不得重复建单 / 重复扣减。
2. **不抛异常**：业务上不成立时返回 `{ ok: false, changed: false, message: '给用户看的话', item: null }`。
   异常只留给真正的程序错误（由服务端统一转 500）。
3. **金额用分**：`amountFen` 是整数分；返回给用户看的文案自己换算元。
4. **不新增表**：所有数据落到 `store.suite.*` 四张通用台账，领域差异放进 `payload`。
5. **不引入新依赖**：不装 npm 包，不用 `Date.now()` 之外的时间源，不读文件。
6. **不碰共享骨架**：不改 `db/types.ts`、`memory.ts`、`postgres.ts`、`app.ts`、`contracts`、`registry.ts`、`suite/*`。
7. **阶段迁移**必须在 `transitions` 里声明；非法流转要拒绝并说明原因。

## 5. 领域页面写法

`apps/app/src/pages/suite/<id>.vue` 的骨架（已生成，直接改 `#dynamic` 部分）：

```vue
<template>
  <suite-detail-shell :content="content" @need-login="onNeedLogin">
    <template #dynamic>
      <!-- 你的领域面板 -->
    </template>
  </suite-detail-shell>
</template>
```

面板需要做到：

1. **异步加载**：页面渲染后调 `suiteApi.items(domainId)` 与 `suiteApi.stats(domainId)`，失败不阻断正文（正文是静态的）。
2. **三态齐全**：加载中 / 空态（还没有数据）/ 出错可重试。空态要给一句可执行的下一步。
3. **动作可见**：把该领域的关键动作做成按钮，调 `suiteApi.act(domainId, { action, entryId, ... })`，
   成功后用返回的 `message` 做轻提示，并刷新列表。
4. **进度可写**：用 `suiteApi.setProgress({ domainId, entryId, status, value })` 记录完成度。
5. **登录门禁**：未登录时不要发写请求；点动作先提示登录（`onNeedLogin` 已提供跳转）。
6. **状态用本地既有组件**：`mx-state`（loading / empty / error）、`.sheet`、`.btn`、`.tag`、`.field`、`.sec-title`、`.eyebrow`、`.micro`、`.hint`。

## 6. 前端约定（硬性）

- 页面跳转只能引用 `apps/app/src/routes.ts` 的 `ROUTES` / `SUITE_ROUTE_BY_DOMAIN`，
  **不许写 `'/pages/...'` 字面量**（`scripts/repo-lint.mjs` 会拦）。
- `src` 内**禁止 `console.log`**（用 `console.info` / `console.warn` / `console.error`）。
- 禁止 `TODO` / `FIXME` 残留；禁止 `.only` 测试。
- 只从 `apps/app/src/uni.scss` 的设计令牌取值（`$ink` / `$paper` / `$brand` / `$acc-1..6` / `$r-card` / `$r-control` / `$sp-*` / `$fs-*`），
  **不要写裸色值**，也不要写死 px 字号。
- 样式写在组件的 `<style scoped lang="scss">` 里；类名用小写短横线。
- 交互元素要补 `role` 与 `aria-label`（与全站现有页面同口径）。
- 动效只用位移，**不要把内容起始透明度设为 0**（动画被冻结时内容必须仍然可见）。

## 7. 验收

每个领域完成后跑：

```bash
pnpm --filter @mixmapp/api typecheck
pnpm --filter @mixmapp/app typecheck
node scripts/repo-lint.mjs
```

三项全绿才算完成。测试文件可放在 `services/api/test/`（命名 `<domain>.test.ts`）。
