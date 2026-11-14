# Mim 项目审计：社区论坛 + 商城与变现 + 知识付费 完成度核查

- 审计对象：`F:\合并项目\Mim`（monorepo：`services/mim-api` 后端 / `apps/web` 用户端 / `apps/admin` 后台）
- 审计日期：2026-11-14（周六，Asia/Shanghai）
- 工作树 HEAD：`f441dbb`（`refactor(web): 统一搜索说明文案同步改为社区商城`）；`git fetch` 受本机网络/权限阻断，结论以**工作树实际代码**为准，不引用历史报告。
- 审计方式：只读审计，未改代码、未提交。判定依据 = 代码位置 + 测试用例 + 本地可复现；**线上可用性一律标注阻断**（见文末「线上阻断记录」）。
- 判定口径四档：
  - ✅ **代码完成·本地测试通过**：链路在本地闭环并有对应用例；线上未验证（阻断）。
  - ⚙️ **代码完成·配置即启用**：代码闭环，缺外部凭证/环境变量才不可用，已注明缺哪些变量。
  - 🔶 **部分实现**：主体存在，缺明确一环（逐条注明）。
  - ❌ **未实现**：全仓无对应实现（附搜过的关键词）。

> 线上证据列统一写「线上不可用（主机侧阻断）」。2026-11-14 复核：`mim.mixm.top` TLS 证书 `CN=cloud.mixm.top` 域名不匹配；`/health` 回 SPA HTML；`/api/v1/*` 全部 404 且返回本站错误信封；最近三次 CI Deploy 卡在 scp 上传部署脚本，本机无主机 SSH 私钥。因此不在本表把「线上 200」当作任何能力闭环的依据。

---

## 一、总览

| 域 | ✅ 完成 | ⚙️ 配置即启用 | 🔶 部分实现 | ❌ 未实现 |
|---|---|---|---|---|
| A 社区论坛（11 项） | 8 | 1（A6 等级/数量限额，env 可调） | 0 | 0 |
| B 知识付费（6 项） | 4 | 0 | 1（B5 免登录购买） | 1（B6 移动端唤起支付宝） |
| C 独立商城（3 项） | 0 | 0 | 3（C1 商品无后台写入；C2 网盘缺失；C3 人工履约缺结构化单据） | 0 |
| D 营销与资金（9 项） | 3（D2、D6、D9） | 0 | 5（D1、D3、D5 在线收银台、D7、D8） | 1（D4 VIP 按模块/分类单独定价） |
| E 交易链路（9 项） | 0 | 7（E1–E5、E7、E8） | 2（E1/E2 无上游退款；E9 退货缺回寄履约） | 0 |

测试基线：`corepack pnpm --filter @mim/api test` → **56 个测试文件 / 669 个用例全部通过**（68.55s）。明细见第三节。

---

## 二、逐项判定表

### A. 社区论坛

| # | 能力项 | 代码位置 | 测试 | 线上证据 | 判定 |
|---|---|---|---|---|---|
| A1 | 论坛首页/板块页 Tab 栏目 + 模块化自由组合 | `services/mim-api/src/community/tabs.ts`（`DEFAULT_TABS` / `loadBoardTabs` / `saveBoardTabs` / `SORT_BY_KEYS`）；`routes/community.ts` `GET /community/boards/:slug/tabs`（L170）、`PUT /community/boards/:slug/tabs`（L800）；`routes/appearance.ts` `GET /pages/:page`（L69）、`POST/PUT/DELETE /pages/:page/blocks`、`PUT /pages/:page/reorder`；前端 `apps/web/src/views/Community.tsx:750` `<PageBlocks page="forum">`、`Store.tsx:861` `<PageBlocks page="home">`、`PageBlocks.tsx` | `community-limits.test.ts`「缺省返回一套默认 Tab；创建者可持久化调整顺序与显隐」；`commerce.test.ts`「外观设置与页面区块可读可改可排序」；`appearance.test.ts` 7 例 | 线上不可用（主机侧阻断） | ✅ 代码完成·本地测试通过 |
| A2 | 可把论坛设为网站首页 | `community/settings.ts`（`readHomeSetting` / `writeHomeSetting`，`home=community\|portal`）；`routes/community.ts` `GET /community/home-setting`（L165）；`routes/appearance.ts` `GET /site/config`（L30，回 `home_view`）；前端 `App.tsx` 按 `home_view` 路由 | `community-limits.test.ts`「匿名可读当前指向；运营写入 community 后公开配置同步为论坛首页」；`community-phase2.test.ts`「公开站点配置返回 home_view 且无需会话」 | 线上不可用（主机侧阻断） | ✅ 代码完成·本地测试通过 |
| A3 | 板块（列表/详情/创建/审核） | `routes/community.ts` `GET /community/overview`（L256，公开）、`GET /community/boards`（L283）、`GET /community/boards/:slug`、`POST /community/boards`（L767）、`GET /community/boards/pending`（L186）、`POST /:slug/approve`（L199）、`POST /:slug/reject`（L208）；表 `community_boards`（schema.sql L577 起） | `community.test.ts`「种子数据齐备：6 板块…」；`community-limits.test.ts` 等级/重复 slug/名称冲突 409、敏感词 400、审核 pending→通过上架 4 例 | 线上不可用（主机侧阻断） | ✅ 代码完成·本地测试通过 |
| A4 | 圈子（成员制社群，区别于板块） | `routes/circles.ts`（list / create / join / leave / members / posts / notices / approve / reject）；`circles/service.ts`（`open/approve/invite` 加入方式、`private` 可见性、成员上限、创建等级与数量限额）；表 `community_circles` / `community_circle_members`；前端 `views/Circles.tsx` | `circles.test.ts` 18 例（公开列表 401、owner 自动入圈、数量上限 `CIRCLE_CREATE_LIMIT`、等级门槛 `CIRCLE_CREATE_LEVEL`、approve 通过/拒绝、invite 码、成员上限 409、private 读写 403、圈内动态/公告权限、幂等回放） | 线上不可用（主机侧阻断） | ✅ 代码完成·本地测试通过。注：圈子表**无价格字段**，不支持付费入圈 |
| A5 | 发帖限制（频率/每日/累计） | `community/limits.ts` `enforcePostLimit`（窗口 `rate_window_minutes/rate_window_max`、`daily_max`、`total_max`）；`routes/community.ts` `POST /community/threads`（L468）发帖前调用；env `MIM_COMMUNITY_RATE_WINDOW_MINUTES / RATE_MAX / DAILY_MAX / TOTAL_MAX`；表加列见 `schema.d/10-community-phase3.sql` | `community-limits.test.ts`：窗口超限 429 带 `Retry-After`、版主放宽配额、每日配额次日零点重置、累计配额 429 共 4 例 | 线上不可用（主机侧阻断） | ✅ 代码完成·本地测试通过 |
| A6 | 创建板块限制（等级/数量） | `routes/community.ts` `createLimits`（L96）：`create_min_level` / `create_max_per_user`，回落 env `MIM_COMMUNITY_CREATE_MIN_LEVEL`（默认 Lv5）、`MIM_COMMUNITY_CREATE_MAX`（默认 3）；`POST /community/boards`（L767–773）等级不足 403 `BOARD_CREATE_FORBIDDEN`、超量 400 `BOARD_CREATE_LIMIT`；VIP 豁免等级 | `community-limits.test.ts`「等级不足创建被 403；达标后可建；slug 与名称重复均 409」 | 线上不可用（主机侧阻断） | ⚙️ 代码完成·配置即启用（阈值走 env/板块字段；无后台限额编辑端点，默认 Lv5 / 3 个） |
| A7 | 付费加入板块 | `routes/community.ts` `POST /community/boards/:slug/join`；`hasBoardAccess`（L67，付费门槛 + VIP 免单 + 余额扣款写流水）；表 `community_board_memberships` | `community-phase2.test.ts`「付费板块需先加入；加入扣余额后可见帖子并可发帖」；`community-limits.test.ts`「种子付费板块 price_cents > 0，且不新增板块行数」 | 线上不可用（主机侧阻断） | ✅ 代码完成·本地测试通过 |
| A8 | 付费查看（帖子/资产付费解锁） | 帖子：`routes/community.ts` `POST /community/threads/:id/unlock`（L584）；资产：`routes/assets.ts` `POST /assets/:code/purchase`（L163）；表 `community_purchases`（schema.sql L622）、`asset_purchases`；未解锁只回 220 字试读、隐藏 `file_url`/`media` | `community.test.ts`「付费帖未解锁隐藏正文；充值卡兑换后可解锁并读到正文，余额正确扣减」；`commerce.test.ts`「付费资产种子齐备；未购买只给试读，购买后解锁正文」 | 线上不可用（主机侧阻断） | ✅ 代码完成·本地测试通过 |
| A9 | 关注后可见 | 板块 `visibility='followers'`；`routes/community.ts` `POST /community/boards/:slug/follow`（L739，关注/取关）；`hasBoardAccess` followers 分支（L78，查 `community_board_follows`）；组合门槛顺序：付费会员 → 付费加入 → 关注 | `community-limits.test.ts`「未关注：详情隐藏正文；关注后可读；取关后重新锁定」「先过付费门槛再过关注门槛：两者齐备可读正文」；`community-phase2.test.ts`「followers 板块关注后才可见与可发帖」 | 线上不可用（主机侧阻断） | ✅ 代码完成·本地测试通过 |
| A10 | 帖子排序：时间/浏览量/评分/回帖/收藏/推荐指数 | `community/tabs.ts` `SORT_BY_KEYS = latest / hot / views / replies / favorites / rating / recommend`；`routes/community.ts` `GET /community/threads`（L301）sort 分支；表列 `community_threads.recommend_score`；`community/recommend.ts` 推荐权重可运营调整 | `community-limits.test.ts`「互动累积的帖子推荐分更高；rating 与 favorites 排序各自生效」「权重向回复倾斜后，回复多的帖子排在收藏多的帖子之前」「推荐权重可由运营持久化调整」 | 线上不可用（主机侧阻断） | ✅ 代码完成·本地测试通过（7 种排序键全覆盖；`latest`=时间、`views`=浏览量、`replies`=回帖、`favorites`=收藏、`rating`=评分、`recommend`=推荐指数、`hot`=热门聚合） |
| A11 | 帖子形态：视频封面、图集封面、剧集视频、问答、投票 | `routes/community.ts` kind 枚举 `text/video/gallery/series/qa/poll`（L476）；媒体表 `community_thread_media`；剧集表 `community_series_episodes`（L541–576，标题/媒体/封面/排序，≤100 集）；投票表 `community_poll_options / community_poll_votes`；问答采纳 `accepted_reply_id`；前端 `Community.tsx` 全形态表单与渲染（L39–43、L356 vote、L461 poll、L469 episodes） | `community-phase2.test.ts`：图集帖媒体回写 + 收藏评分聚合排序；投票选项/计票/改投 + 视频帖缺地址 400；问答仅提问者可采纳；`community.test.ts` 视频/图集种子帖 | 线上不可用（主机侧阻断） | ✅ 代码完成·本地测试通过。注：剧集帖仅有后端强校验（至少一集）与种子数据，**无独立剧集播放/目录前端用例** |

### B. 知识付费四件套

| # | 能力项 | 代码位置 | 测试 | 线上证据 | 判定 |
|---|---|---|---|---|---|
| B1 | 付费阅读 | 付费帖：A8 解锁链路；付费文章资产：`routes/assets.ts` `kind='article'`（L205），未购回 220 字试读（L141）；表 `paid_assets` | `community.test.ts` 付费帖解锁；`commerce.test.ts` `paid-article-store` 试读→解锁→正文/`file_url` 回写 | 线上不可用（主机侧阻断） | ✅ 代码完成·本地测试通过 |
| B2 | 付费下载/资源 | `routes/assets.ts` `kind='download'`（L205），`file_url` 未购置 null（L156）；`POST /assets` 作者发布（L200）；`assertMediaUrl` SSRF 校验 | `commerce.test.ts` L71 创建 `kind=download`「作者工具包」；购买解锁复用通用 purchase 链路（article 用例覆盖同一 `POST /assets/:code/purchase`） | 线上不可用（主机侧阻断） | ✅ 代码完成·本地测试通过（download 类型创建有例；下载直链解锁走通用链路，无 download 专属断言） |
| B3 | 付费图库 | `routes/assets.ts` `kind='gallery'`，未购 `media=[]`（L157），图库至少一张图片（L218） | `community-phase2.test.ts`「付费图库未解锁不返回媒体，余额购买后返回 9 张封面图片」（定价 ¥39 断言） | 线上不可用（主机侧阻断） | ✅ 代码完成·本地测试通过 |
| B4 | 付费视频 | `routes/assets.ts` `kind='video'`，需视频地址或媒体（L219），解锁后回视频直链与封面 | `community-phase2.test.ts`「付费视频解锁后返回视频直链与封面」（`media[0].kind=video`、`.mp4` 直链断言） | 线上不可用（主机侧阻断） | ✅ 代码完成·本地测试通过 |
| B5 | 免登录购买 | 访客会话：`routes/auth.ts` `POST /auth/guest`（L401，`is_guest=1`，双令牌，IP 频控）；`middleware.ts` `requireAuth`（L65）只校验令牌与账号状态，**不拒绝访客**；前端 `api.ts` `ensureGuestSession()`（L278）启动自动建会话；购买端点（`/assets/:code/purchase`、`/shop/orders`、`/vip/subscribe`）均挂 `requireAuth`，访客令牌可通过 | `guest-auth.test.ts` 4 例：不传参拿访客会话、区域切换、访客令牌可访问 `/me`、同 IP 建号超限 429。**无访客直接下单/购买的端到端用例** | 线上不可用（主机侧阻断） | 🔶 **部分实现**。边界：① 不存在「无会话匿名下单」——必须先 `POST /auth/guest` 拿访客 token；② 访客钱包 0 余额，余额/积分链路可走，在线支付意图后端存在但前端无调用入口（见 B6/E 域）；③ 支付前无强制绑定手机；④ 未找到访客→正式账号的订单/购物车/资产数据接管（合并）逻辑。关键词：`guest`、`anonymous`、`checkout`、`merge`、`link_account` |
| B6 | 移动端唤起支付宝（`alipays://` 之类） | 全仓源码 grep `alipays` / `weixin://` / `taobao://` / `upay` / `intent` scheme：**0 命中**（仅 docs 文字提及）。后端：`payments.ts` 当面付 `precreate` 只回 `qr_text` 扫码串；`adapters/alipay-ent.ts` 电脑/手机网站支付回 `gateway.do` H5 跳转 URL（网页跳转，非 App scheme）。前端：`api.ts:1870` `createIntent` 定义后**无任何调用方**；`CommerceCenter.tsx` / `Store.tsx` 无收银台、无二维码渲染、无跳转承接 | 无唤起相关用例；`payments-channels.test.ts` 14 例仅覆盖下单/回调/退款/配置判定 | 线上不可用（主机侧阻断） | ❌ **未实现**。前端无 `alipays://` 唤起、无支付回跳页、无收银台调用；后端仅具备 H5 跳转串与扫码串生成能力 |

### C. 独立商城

| # | 能力项 | 代码位置 | 测试 | 线上证据 | 判定 |
|---|---|---|---|---|---|
| C1 | 实物商品（快递发货） | `routes/community.ts` `POST /shop/orders`（L1037）：`kind='physical'` 强制 `shipping`（姓名/电话/地址，L1057）、库存校验（L1058）；`routes/fulfillment.ts` 运营 `POST /shop/orders/:id/ship`、`GET /shop/orders/:id/shipment`（L70）；表 `shipments`；物流适配见 E8 | `community.test.ts`「实物订单：优惠码立减、地址必填、确认收货」；`commerce.test.ts`「发货、轨迹、评价、售后退款串成完整闭环」；`logistics.test.ts` 4 例 | 线上不可用（主机侧阻断；提示：生产 `shop_products` 当前 0 条） | 🔶 **部分实现**。下单/地址/库存/发货/轨迹闭环；**商品本身无后台写入 API**——全仓无 `INSERT INTO shop_products` 的路由（仅 `db.ts` 种子 3 件），`apps/admin` 也无商品管理视图，新增商品需直接写库 |
| C2 | 自动发货虚拟（卡密/网盘） | 卡密：`community.ts` `kind='virtual_auto'`，下单取未用 `shop_card_keys` 标记 `used` 回显卡密（L1079–1087），库存按未用卡密计算（L1028）。网盘：表 `shop_products` 仅有 `delivery_note` 文本（schema.sql L809），**无网盘链接字段**；全仓 grep `netdisk / 网盘 / pan. / quark / aliyundrive / download_url`（商城域）无下发逻辑 | `community.test.ts`「自动发卡订单返回真实卡密并可退款」；`community-shop-points.test.ts` 全额抵扣即时发卡 1 例 | 线上不可用（主机侧阻断） | 🔶 **部分实现**。卡密自动发货闭环；**网盘链接自动发货未实现**（需求列表与 `schema.d/08` 公告文案写了「卡密/网盘」，代码无网盘交付通道） |
| C3 | 手动发货虚拟（远程指导/代充） | `community.ts` `kind='virtual_manual'`：下单落 `paid` + 静态说明「客服将在 24 小时内联系你安排远程时间」（L1088–1089）；人工确认 `POST /shop/orders/:id/confirm`（L1153）；`delivery_note` 展示备注 | `community.test.ts` 确认收货环节；人工发货无独立履约用例 | 线上不可用（主机侧阻断） | 🔶 **部分实现**。有人工确认收货环节；**无结构化人工履约单据**：无工单、排期时间、远程链接、代充账号/卡密备注、履约进度状态机，仅静态文案 + 确认动作 |

### D. 营销与资金

| # | 能力项 | 代码位置 | 测试 | 线上证据 | 判定 |
|---|---|---|---|---|---|
| D1 | 优惠码 | `routes/community.ts` `couponDiscount`（L138，fixed/percent、门槛 `min_amount_cents`、上限 `max_uses`）；`POST /coupons/validate`（L1181）；下单核销写 `coupon_redemptions`、`used_count+1`（L1118–1122）；表 `coupons` | `community.test.ts`「优惠码立减」「优惠码门槛与重复签到冲突都被明确拒绝」 | 线上不可用（主机侧阻断） | 🔶 **部分实现**。校验/抵扣/核销闭环；**无后台优惠码创建/启停/编辑 API**（`admin.ts` 无 coupons 路由，`apps/admin` 无对应视图），仅种子 `MIM10` / `VIP20`，发行需直接写库 |
| D2 | 批量改价 | `commerce/price-batch.ts`（固定价/百分比/增减方向，模块 + 商品双目标，分类/编码过滤，快照留档，回滚恢复，幂等键回放）；`routes/admin.ts` `POST /admin/commerce/price-batches`（L480）、`GET` 列表（L511）、`GET /:id`（L516）、`POST /:id/rollback`（L524）；表 `price_batches` | `commerce-price-batch.test.ts` 10 例：固定价/百分比四舍五入/金额下调不为负/免费品跳过/商品批次/幂等回放/快照回滚/重复回滚 409/百分比越界 400/方向参数 400 | 线上不可用（主机侧阻断） | ✅ 代码完成·本地测试通过 |
| D3 | VIP 会员（多级） | 表 `vip_plans`（`level` 1/2/3，种子月卡/年卡/终身，`db.ts` L734–738）、`vip_memberships`；`routes/community.ts` `GET /vip/plans`（L940，公开）、`POST /vip/subscribe`（L948，余额扣款）；履约 `payments.ts` `fulfillIntent` purpose=vip 时长叠加续期（L262–274），`payments/fulfill.ts` ext 同口径（L79–91） | `community.test.ts`「VIP 开通扣余额并直接解锁付费帖」；`commerce.test.ts` VIP 权益判定 | 线上不可用（主机侧阻断） | 🔶 **部分实现**。多级模型 + 订阅 + 权益判定闭环；**无后台套餐 CRUD API**（套餐仅种子/SQL）；在线开通走支付意图，但前端未调用（见 B6） |
| D4 | VIP 单独定价（按模块/分类） | 资产侧仅有 `paid_assets.vip_free` 布尔（`assets.ts` L61/L175，VIP 免费）；`module_prices` 表无等级/角色维度（schema.sql L138–147：`module_id / currency / amount_minor / 时间窗`）；`commerce/category-access.ts` 是 RBAC 可见性 allow/deny，不是 VIP 差价。全仓 grep `vip_price / role_price / level_price / vip_scope`：无命中 | 无对应用例；`commerce-category-access.test.ts` 5 例为分类可见性拦截，非定价 | 线上不可用（主机侧阻断） | ❌ **未实现**。无「VIP 专属价 / VIP 按模块或分类定价」字段、计算分支与端点；现有仅「VIP 免费」开关 |
| D5 | 余额充值 / 消费 / 提现 | 充值：`payments.ts` `fulfillIntent` recharge 入钱包写流水（L246–251），`payments/fulfill.ts` ext 同口径（L63–67）；消费：资产购买 `assets.ts` 扣款、商城订单 `community.ts` `debit`（L1074）、VIP 订阅扣款；提现：`routes/finance.ts` `POST /wallet/withdrawals`（L36，最低 10 元 `MIN_WITHDRAW_CENTS=1000`，申请即冻结扣减）、`GET /wallet/withdrawals`（L60）、审核通过/驳回、标记打款；表 `wallets / wallet_transactions / withdrawals` | `commerce.test.ts`「沙箱支付：验签通过才充值，错误签名被 403 拒绝」「提现冻结余额、驳回退回、通过后可标记打款」 | 线上不可用（主机侧阻断） | 🔶 **部分实现**。充值记账/消费扣款/提现申请-审核-打款登记闭环；缺口：无提现手续费配置；打款为人工登记无上游代付；**在线充值前端无支付意图调用入口**（B6） |
| D6 | 积分消费与转账 | 消费：`commerce/points.ts` `computeDeduction` + `deductPoints`，商城订单同事务抵扣（`community.ts` L1064–1072，`points_spent / points_deduct_cents` 留痕，30% 单笔上限可配）；转账：`POST /wallet/points/transfer`（L906，按 Mim ID 到账、双方流水、不足/自转/收方不存在拒绝）；签到 `POST /wallet/checkin`（L987） | `commerce-points.test.ts` 14 例；`community-shop-points.test.ts` 6 例（截断/不足/超额/开关关闭/全额抵扣即时完成）；`community-phase2.test.ts`「积分转账按 Mim ID 到账，余额不足与转给自己被拒」 | 线上不可用（主机侧阻断） | ✅ 代码完成·本地测试通过 |
| D7 | 卡密充值 / 兑换 | `routes/community.ts` `POST /wallet/redeem`（L1006，校验 `unused`、充值余额写流水、重复使用 409）；表 `wallet_cards`；种子 `MIM-DEMO-100/500` | `community.test.ts`「充值卡兑换后可解锁并读到正文，余额正确扣减」 | 线上不可用（主机侧阻断） | 🔶 **部分实现**。兑换闭环；**无后台卡密批量生成/导入/作废 API**，发行需直接写库（`admin.ts` / `apps/admin` 无 card 路由与视图） |
| D8 | 推广返佣（分销，含结算） | 绑定：`GET /referral`（L1188，生成邀请码）、`POST /referral/bind`（L1201，重复绑定 409）；计佣：被邀请人首单，邀请人拿 5%，佣金**下单即直接入邀请人余额**、`referrals.status='settled'`（L1124–1131）；表 `referral_codes / referrals` | `community.test.ts`「推广绑定：邀请人获得被邀请人首单 5% 佣金」 | 线上不可用（主机侧阻断） | 🔶 **部分实现**（有绑定 + 计佣记录 + 即时入账）。缺口：① 仅**一级、首单一次性 5%**，无多级分销、无复购返佣、无佣金比例配置（0.05 硬编码）；② **无独立佣金结算周期/待结算佣金账户**——佣金下单即落余额，不存在「待结算→结算」状态机；③ 提现联动仅复用钱包提现，无分销专属结算单/对账 |
| D9 | 创作分成 | `payments.ts` `recordEarning`（L228：作者 70% `net` / 30% 平台费，`gross_cents / platform_fee_cents / net_cents`）；资产履约记账 `payments/fulfill.ts` L78；`routes/finance.ts` `GET /earnings`（L93，pending/settled 汇总）、`POST /earnings/settle`（L104，逐条 `pending→settled` 防重，净额入余额）；表 `creator_earnings` | `commerce.test.ts`「作者发布资产、他人购买后作者获得 70% 待结算收益」；同文件结算入余额用例 | 线上不可用（主机侧阻断） | ✅ 代码完成·本地测试通过。受限点：分成比例 70% 硬编码无后台配置；分成来源仅资产（付费帖/商城订单未计作者分成） |

### E. 交易链路

| # | 能力项 | 代码位置 | 测试 | 线上证据 | 判定 |
|---|---|---|---|---|---|
| E1 | 微信企业支付 | `payments.ts` wechat Native：商户号/证书序列号/私钥/APIv3 回调验签 + AES-256-GCM 解密 + 金额/`trade_state` 校验；registry `id=wechat`「微信企业支付（Native）」；回调 `POST /payments/wechat/notify`。缺变量：`MIM_WECHAT_MCH_ID / MIM_WECHAT_APP_ID / MIM_WECHAT_SERIAL_NO / MIM_WECHAT_PRIVATE_KEY / MIM_WECHAT_PLATFORM_PUBLIC_KEY / MIM_WECHAT_NOTIFY_URL` | `payments-channels.test.ts` 渠道矩阵/配置判定；验签解密在 `payments.ts` 内核；sandbox 用例对照（`commerce.test.ts` L83–89） | 线上不可用（主机侧阻断；空 env 时 `configured=false`，下单 503） | ⚙️ 代码完成·配置即启用。缺口：legacy 内核**无上游退款调用**（售后只能退余额）；前端无收银台调用入口 |
| E2 | 支付宝当面付 | `payments.ts` alipay `precreate`（RSA2 预下单，回 `qr_text` 扫码串）；registry `id=alipay`「支付宝当面付」；回调 `POST /payments/alipay/notify`。缺变量：`MIM_ALIPAY_APP_ID / MIM_ALIPAY_PRIVATE_KEY / MIM_ALIPAY_PUBLIC_KEY / MIM_ALIPAY_NOTIFY_URL` | `payments-channels.test.ts` 矩阵配置判定；签名/验签内核单测 | 线上不可用（主机侧阻断；空 env `configured=false`） | ⚙️ 代码完成·配置即启用。缺口：无上游退款；前端不唤起 |
| E3 | 支付宝企业支付 | `payments/adapters/alipay-ent.ts`（电脑网站/手机网站 `wap/pay` 签名跳转，`alipay_ent` 适配器）；`payments/router.ts` ext 下单/回调/退款；缺变量：`MIM_ALIPAY_ENT_APP_ID / MIM_ALIPAY_ENT_PRIVATE_KEY / MIM_ALIPAY_ENT_PUBLIC_KEY / MIM_ALIPAY_ENT_NOTIFY_URL / MIM_ALIPAY_ENT_RETURN_URL / MIM_ALIPAY_ENT_GATEWAY / MIM_ALIPAY_ENT_SANDBOX` | `payments-channels.test.ts` 14 例 ext 链路：下单 201 落跳转串、回调入账、重放幂等、错签 403、金额不符 409、退款冲正幂等 | 线上不可用（主机侧阻断） | ⚙️ 代码完成·配置即启用。缺口：前端无 H5 跳转承接页与支付回跳处理 |
| E4 | 虎皮椒 | `payments/adapters/hupijiao.ts`（xunhupay 网关，HMAC 验签，跳转串/二维码，退款 `/payment/refund.html`）；缺变量：`MIM_HUPIJIAO_APP_ID / MIM_HUPIJIAO_APP_KEY / MIM_HUPIJIAO_NOTIFY_URL / MIM_HUPIJIAO_RETURN_URL / MIM_HUPIJIAO_API_BASE` | `payments-channels.test.ts`「配齐虎皮椒凭证后 configured=true」「虎皮椒下单→201 并落跳转串；退款成功→余额冲正，幂等回放不重复退款」「签名错误 403」「金额不符 409」「上游退款失败 502 且退款记录 failed」 | 线上不可用（主机侧阻断；空 env `configured=false`） | ⚙️ 代码完成·配置即启用（缺 `MIM_HUPIJIAO_APP_ID/APP_KEY`） |
| E5 | 讯虎 | `payments/adapters/xunhu.ts`（聚合支付，签名验签，退款 `/api/refund`）；缺变量：`MIM_XUNHU_APP_ID / MIM_XUNHU_APP_KEY / MIM_XUNHU_NOTIFY_URL / MIM_XUNHU_RETURN_URL / MIM_XUNHU_API_BASE` | `payments-channels.test.ts` 矩阵配置判定；验签/幂等/退款走通用 ext 用例 | 线上不可用（主机侧阻断；默认网关为占位 `api.xunhu-pay.example`，需真实地址） | ⚙️ 代码完成·配置即启用（缺 `MIM_XUNHU_APP_ID/APP_KEY` 与真实网关地址） |
| E6 | PayPal | `payments/adapters/paypal.ts`（Orders 创建/捕获、Webhook 验签、退款 `/v2/payments/captures/:id/refund`）；缺变量：`MIM_PAYPAL_CLIENT_ID / MIM_PAYPAL_CLIENT_SECRET / MIM_PAYPAL_MODE / MIM_PAYPAL_CURRENCY / MIM_PAYPAL_RETURN_URL / MIM_PAYPAL_CANCEL_URL / MIM_PAYPAL_WEBHOOK_ID` | `payments-channels.test.ts` ext webhook 入账/重放/错签 403 框架用例；adapter 签名为纯函数单测 | 线上不可用（主机侧阻断） | ⚙️ 代码完成·配置即启用（缺 `MIM_PAYPAL_CLIENT_ID/SECRET` 等；Webhook 需公网可达） |
| E7 | Stripe | `payments/adapters/stripe.ts`（PaymentIntent 创建、Webhook `t.v1` HMAC 验签 5 分钟时间戳容忍、退款 `/v1/refunds` + Idempotency-Key）；缺变量：`MIM_STRIPE_SECRET_KEY / MIM_STRIPE_WEBHOOK_SECRET / MIM_STRIPE_CURRENCY / MIM_STRIPE_RETURN_URL / MIM_STRIPE_API_BASE` | `payments-channels.test.ts` L293–312：Stripe Webhook 正确签名入账、重放不重复加钱、错签 403 | 线上不可用（主机侧阻断） | ⚙️ 代码完成·配置即启用（缺 `MIM_STRIPE_SECRET_KEY/WEBHOOK_SECRET`；Webhook 需公网可达） |
| E8 | 物流快递查询接口 | `logistics.ts` 快递100 适配：MD5(`param+key+customer`) 大写签名、轨迹按时间倒序归一、`state=3` 映射已签收、网络异常降级不抛错；`fulfillment.ts` `GET /shop/orders/:id/shipment`；缺变量：`MIM_KUAIDI100_CUSTOMER / MIM_KUAIDI100_KEY` | `logistics.test.ts` 4 例：未配置凭证 `provider=none` 不发请求、签名规则一致、成功响应轨迹归一与签收映射、网络异常返回 error 不 500 | 线上不可用（主机侧阻断；缺凭证时仅回本地登记轨迹） | ⚙️ 代码完成·配置即启用（缺 `MIM_KUAIDI100_CUSTOMER/KEY`） |
| E9 | 售后退款 / 退货 / 评价 | `routes/fulfillment.ts` `POST /shop/orders/:id/after-sales`（L87，`kind=refund/return`，仅 paid/delivered 可申请，金额取实付）、`GET /after-sales/mine`（L103）、`POST /after-sales/:id/review`（L111，通过退余额关单/驳回保留原状态）、`POST /shop/orders/:id/review`（L133，一单一评 1–5 星）、`GET /shop/products/:code/reviews`（L146 聚合）；`community.ts` `POST /shop/orders/:id/refund`（L1165）；表 `after_sales / product_reviews` | `commerce.test.ts`「发货、轨迹、评价、售后退款串成完整闭环」 | 线上不可用（主机侧阻断） | 🔶 **部分实现**。退款 + 评价闭环；**退货(return)缺回寄履约**：无退货物流单号、退货地址、验货入库、二次发货流程；审核通过一律按退款处理，`return` 与 `refund` 在审核侧无分支差异 |

---

## 三、测试真实输出摘要

命令（在仓库根目录）：

```powershell
corepack pnpm --filter @mim/api test
```

- 运行器：vitest run（`@mim/api@0.0.10`）
- **结果：Test Files 56 passed (56)；Tests 669 passed (669)；Duration 68.55s**（transform 81.58s，setup 0ms，import 417.28s，tests 184.45s，environment 33ms）。无 failed / 无 skipped 计入失败。
- 首次沙箱内运行报 `EPERM: operation not permitted, open '...node_modules\.vite-temp\vitest.config.ts.timestamp-*.mjs'`（vitest 需在 `node_modules\.vite-temp` 写临时配置），提权后重跑通过。

与本次审计域直接相关的测试文件与用例数：

| 测试文件 | 用例数 | 覆盖项 |
|---|---|---|
| `community.test.ts` | 8 | 付费帖解锁、回复点赞计数、VIP 解锁、实物/自动发卡订单、优惠码门槛、推广 5% 佣金 |
| `community-phase2.test.ts` | 10 | 图集/收藏/评分、投票/视频校验、付费板块加入、积分转账、付费图库、付费视频、home_view、followers 可见、问答采纳、验证码/举报限流 |
| `community-limits.test.ts` | 16 | 关注可见性、窗口/每日/累计限额、板块创建等级与数量、敏感词、审核队列、首页指向、Tab 持久化、推荐分/rating/favorites 排序、权重调整、付费板块种子、组合门槛顺序、验证码开关 |
| `community-shop-points.test.ts` | 6 | 积分抵扣截断/不足/超额/开关关闭/全额抵扣即时发卡 |
| `circles.test.ts` | 18 | 圈子创建/加入方式/审批/邀请码/成员上限/私密可见/动态公告权限/幂等 |
| `commerce.test.ts` | 8 | 付费资产试读解锁、作者 70% 待结算收益、沙箱充值验签、发货-轨迹-评价-售后闭环、提现冻结/退回/打款、外观区块、等级徽章私信、翻译降级 |
| `cart.test.ts` | 9 | 购物车加购/去重/解锁拦截/免费结算/ pending 订单/依赖跳过/重复结算 |
| `payments-channels.test.ts` | 14 | 九渠道矩阵、未配置 503、下单/回调/退款/重放幂等/错签 403/金额不符 409、虎皮椒与 Stripe 入账冲正 |
| `logistics.test.ts` | 4 | 快递100 降级、签名、轨迹归一、异常降级 |
| `commerce-price-batch.test.ts` | 10 | 固定价/百分比/增减/免费跳过/商品批次/幂等/回滚/边界 |
| `commerce-points.test.ts` | 14 | 积分抵扣口径、上限截断、不足截断、开关、超额/不足拒绝、全额抵扣 |
| `commerce-category-access.test.ts` | 5 | 分类 allow/deny、前缀覆盖、角色并集拦截（RBAC，非定价） |
| `guest-auth.test.ts` | 4 | 访客会话签发、区域、访客令牌访问 `/me`、IP 建号频控 |

其余 43 个文件覆盖账号/OAuth/IM/搜索/安全/漫画/任务/工具等域，不在本次审计范围。

## 四、线上阻断记录（2026-11-14 复核，按要求未重跑线上）

- 复核结论：**线上不可用（主机侧阻断）**，本表所有「线上证据」列均不构成已上线证明。
- 已知现象（复核记录，非本次新测）：
  1. `mim.mixm.top` TLS 证书 `CN=cloud.mixm.top`，域名不匹配，正常 HTTPS 客户端握手失败，只能 `curl -k`。
  2. `curl -k https://mim.mixm.top/health` 返回 200 但 body 是 SPA HTML，不是 JSON——`/health` 已不再反代到 mim-api。
  3. `curl -k https://mim.mixm.top/api/v1/*` 全部 404，body 为本站错误信封 `{"error":{"code":"NOT_FOUND","message":"未找到路由 GET /api/v1/xxx"}}`——mim-api 在跑但路由未挂载 / 反代指错。
  4. CI 最近三次 Deploy「发布到生产服务器」失败，最新一次卡在 scp「上传本次提交的部署脚本」；本地无主机 SSH 私钥，无法修复。
- 因此：历史文档 / `AGENTS.md` / README 中写「已上线」的条目，在当前生产状态下**不成立**；本表 ✅ 仅表示「代码完成 + 本地测试通过」。
- 未执行线上实测端点：`/api/v1/community/overview`、`/api/v1/shop/orders`、`/api/v1/payments/channels`、`/api/v1/vip/plans` 等；按复核记录 `/api/v1` 整体 404，访客 token 链路本次未在线上验证。

## 五、「文档/入口说有、代码里找不到」清单

| # | 文档/入口说法 | 代码核查结论 | 检索关键词 |
|---|---|---|---|
| 1 | 自动发货虚拟「卡密 / **网盘**」（需求列表、`schema.d/08-announcements-project-content.sql` 公告文案） | 🔶 网盘通道未实现：`shop_products` 无网盘链接字段，`virtual_auto` 只下发 `shop_card_keys` 卡密；无网盘链接生成/校验/下发端点 | `netdisk`、`网盘`、`pan.`、`quark`、`115.`、`aliyundrive`、`download_url`（商城域） |
| 2 | 「VIP 单独定价（按模块/分类）」标部分闭环，称 `module_prices + 等级` 已覆盖 | ❌ `module_prices` 无等级/角色维度；无 VIP 差价字段与端点；资产侧只有 `vip_free` 布尔 | `vip_price`、`role_price`、`level_price`、`vip_scope`、`vip_discount` |
| 3 | 「移动端唤起支付宝 `alipays://`」 | ❌ 前端 0 命中；后端只有扫码串/H5 跳转串；`createIntent` 前端定义后无调用方 | `alipays`、`weixin://`、`taobao://`、`upay`、`intent://` |
| 4 | 后台可维护商城商品 / 优惠码 / 充值卡密 / VIP 套餐 | 🔶 后端无对应写路由，`apps/admin` 无对应视图；数据仅种子或需直接写库 | `INSERT INTO shop_products`、`INSERT INTO coupons`、`INSERT INTO wallet_cards`、`INSERT INTO vip_plans`（路由文件内 0 命中）；`admin.ts` 无 products/coupons/cards/plans 路由 |
| 5 | 「推广返佣（分销）」含结算 | 🔶 仅一级首单 5% 即时入余额；无多级分销、无复购返佣、无比例配置、无待结算佣金账户与结算周期、无分销专属提现/对账 | `commission_rate`、`level2`、`sub_referral`、`pending_commission`、`settlement`（分销域） |
| 6 | 售后「退款 / **退货**」 | 🔶 `return` 仅登记类型；无回寄物流单号、退货地址、验货入库、二次发货流程；审核侧 refund/return 无分支差异 | `return_tracking`、`return_address`、`restock`、`inspect` |
| 7 | 在线支付收银台（充值/VIP/资产/订单唤起支付） | 🔶 后端 intent + 回调 + 退款链路齐备（9 渠道），但 `apps/web` / `apps/admin` 无 `createIntent` / ext intents 调用，无二维码/跳转承接 UI | `createIntent`、`ext/intents`、`pay_url`、`qr_text` 在视图层 0 调用 |
| 8 | 免登录后升级正式账号承接数据 | 🔶 未找到访客→正式账号的订单/购物车/资产/积分合并（link/merge）逻辑；访客会话可被正式登录覆盖，但历史归属迁移未见代码 | `merge`、`link_account`、`migrate_guest`、`takeover` |
| 9 | 手动发货支持「远程指导 / **代充**」结构化履约 | 🔶 `virtual_manual` 仅静态文案 + 确认收货；无工单、排期、远程链接、代充账号备注等字段与状态机 | `fulfillment_note`、`ticket`、`schedule`、`remote_link`、`topup_account` |
| 10 | 支付宝/微信上游退款 | 🔶 legacy 两渠道无退款端点；退款仅 ext 五渠道适配器 + 售后退余额 | legacy `payments.ts` 内 `refund` 0 命中 |

## 六、附：本次未纳入判定的相邻域（仅记录存在性）

- 登录注册 / 社交 OAuth 14 家 / 代理登录（SSO）：属「用户体系」域，本次未逐项审计；`oauth/providers` 代码在 `src/oauth/`，测试 `oauth.test.ts` / `oauth-providers.test.ts` / `sso.test.ts`。
- 搜索（Meilisearch）、多语言机器翻译、安全加固（验证码/审核/SSRF/限流）、Redis/opcache/CDN 性能项：属「扩展与运维」域，本次未逐项判定。
- 自研工具（Quick Build WP、换域名插件、流盾 WAF）：见 `src/routes/tools.ts` 与 `schema.d/21-tools.sql`，未纳入本次商城/付费域评分。
