-- 0018 订单状态流转与取消规则
--
-- 源站口径（本批落地）：
-- 1. 订单状态六态：pending 待支付 → paid 已支付 → picking 已分配拣货 → shipped 已发货 → completed 已完成；
--    pending / paid 可取消 → cancelled；一旦进入 picking 即不可取消（源站「已分配拣货不可取消」）。
-- 2. 取消留痕：取消时间、取消原因、发起方（user 用户 / system 系统超时 / admin 后台）。
-- 3. 每段状态的时间单独落列，前端时间轴与超时判定都以这些列为准，不再靠日志反推。
--
-- 口径约定：
-- - 本迁移只扩列与收紧取值域，不改金额口径（total_fen 与 0017 的五个优惠列）与库存口径；
-- - 新列全部可空且无默认值：历史订单保持 null，表示「该节点未发生 / 时间未知」，不影响既有读写；
-- - 不需要改 place_order：下单仍只写 status = 'pending'，新列不在插入列清单里，函数签名不变。

-- ---------------------------------------------------------------------------
-- 1) 订单状态时间戳（各段只写一次，落列即审计）
-- ---------------------------------------------------------------------------
alter table orders add column if not exists picking_at    timestamptz;
alter table orders add column if not exists shipped_at    timestamptz;
alter table orders add column if not exists completed_at  timestamptz;
alter table orders add column if not exists cancelled_at  timestamptz;

comment on column orders.picking_at is
  '分配拣货时间；非空即代表已进入 picking，此后禁止取消（源站「已分配拣货不可取消」），历史订单为 null';
comment on column orders.shipped_at is
  '发货时间；由 paid/picking 进入 shipped 时写入，历史订单为 null';
comment on column orders.completed_at is
  '订单完成时间；由 shipped 进入 completed 时写入，历史订单为 null';
comment on column orders.cancelled_at is
  '取消时间；由 pending/paid 进入 cancelled 时写入，历史订单为 null（含 0018 之前已取消的订单）';

-- ---------------------------------------------------------------------------
-- 2) 取消留痕（原因与发起方）
-- ---------------------------------------------------------------------------
alter table orders add column if not exists cancel_reason text;
alter table orders add column if not exists cancelled_by  text;

comment on column orders.cancel_reason is
  '取消原因原文；用户取消取用户填写值，超时取消由系统写入固定文案，后台取消取操作备注；未取消为 null';
comment on column orders.cancelled_by is
  '取消发起方：user 用户 / system 系统超时 / admin 后台；未取消为 null';

-- ---------------------------------------------------------------------------
-- 3) 订单状态取值域收紧为六态
-- ---------------------------------------------------------------------------
comment on column orders.status is
  '订单状态：pending 待支付 / paid 已支付 / picking 已分配拣货 / shipped 已发货 / completed 已完成 / cancelled 已取消；合法迁移：pending→paid→picking→shipped→completed，pending|paid→cancelled，picking 之后不可取消';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_status_chk'
  ) then
    alter table orders
      add constraint orders_status_chk
      check (status in ('pending', 'paid', 'picking', 'shipped', 'completed', 'cancelled'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_cancelled_by_chk'
  ) then
    alter table orders
      add constraint orders_cancelled_by_chk
      check (cancelled_by is null or cancelled_by in ('user', 'system', 'admin'));
  end if;
end $$;
