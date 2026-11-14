-- 0017 购物车行状态四态 + 三层优惠（满减档位）
--
-- 源站口径（本批落地）：
-- 1. 行状态四态：R 需求 / L 缺货 / A 到货 / X 下架；只有 A 可勾选结算。
-- 2. 三层优惠：商城优惠（disD2N2）、特价优惠（tejiaD2N2）、满减优惠（min~max → percent%）。
-- 3. 下单拆有效行：失效行不进单，订单行落状态快照便于追溯。
--
-- 金额一律用整数最小单位（分）落库，禁止浮点累加。

-- ---------------------------------------------------------------------------
-- 1) 订单行状态快照
-- ---------------------------------------------------------------------------
alter table order_items add column if not exists line_status text not null default 'A';

comment on column order_items.line_status is
  '下单时的行状态快照：R 需求 / L 缺货 / A 到货 / X 下架；历史订单按 A 处理';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'order_items_line_status_chk'
  ) then
    alter table order_items
      add constraint order_items_line_status_chk check (line_status in ('R', 'L', 'A', 'X'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) 订单三层优惠快照（单位：分）
-- ---------------------------------------------------------------------------
alter table orders add column if not exists subtotal_fen integer not null default 0;
alter table orders add column if not exists mall_discount_fen integer not null default 0;
alter table orders add column if not exists tejia_discount_fen integer not null default 0;
alter table orders add column if not exists manjian_discount_fen integer not null default 0;
alter table orders add column if not exists discount_total_fen integer not null default 0;

comment on column orders.subtotal_fen is '面价小计（分），三层优惠的计算基数；历史订单为 0';
comment on column orders.mall_discount_fen is '商城优惠（分）：源站 disD2N2 折扣差额';
comment on column orders.tejia_discount_fen is '特价优惠（分）：源站 tejiaD2N2 折扣差额，与商城优惠取优不叠加';
comment on column orders.manjian_discount_fen is '满减优惠（分）：按命中档位 percent 向下取整计算';
comment on column orders.discount_total_fen is '优惠合计（分）= 商城 + 特价 + 满减；total_fen 为应付总额';

-- ---------------------------------------------------------------------------
-- 3) 满减梯度档位表（min~max → percent%）
-- ---------------------------------------------------------------------------
-- 说明：源站未开放满减档位接口，这里先落「可配置档位表」；
-- min_fen 含、max_fen 不含，max_fen 为 null 表示无上限。
-- 以下种子值是本地占位配置，待源站档位数据开放后由运营在此表校正（改数据不改代码）。
create table if not exists mall_manjian_tiers (
  id          text primary key,
  min_fen     integer not null check (min_fen >= 0),
  max_fen     integer,
  percent     numeric(5, 2) not null check (percent >= 0 and percent <= 100),
  label       text not null default '',
  enabled     boolean not null default true,
  sort_no     integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint mall_manjian_tiers_range_chk check (max_fen is null or max_fen > min_fen)
);

comment on table mall_manjian_tiers is '满减梯度档位：金额落在 [min_fen, max_fen) 命中，percent 为减免百分比';
comment on column mall_manjian_tiers.min_fen is '档位下限（分），含';
comment on column mall_manjian_tiers.max_fen is '档位上限（分），不含；null 表示无上限';
comment on column mall_manjian_tiers.percent is '档位折扣百分比：2 表示减免 2%';
comment on column mall_manjian_tiers.label is '档位展示文案';
comment on column mall_manjian_tiers.enabled is '是否启用；停用档位不参与匹配';

insert into mall_manjian_tiers (id, min_fen, max_fen, percent, label, enabled, sort_no)
values
  ('mj_tier_1', 50000,  100000, 1.00, '满 500 元减免 1%', true, 1),
  ('mj_tier_2', 100000, 300000, 2.00, '满 1000 元减免 2%', true, 2),
  ('mj_tier_3', 300000, null,   3.00, '满 3000 元减免 3%', true, 3)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4) 订单原子落库函数扩展：追加 p_discounts（三层优惠快照）+ 订单行状态
-- ---------------------------------------------------------------------------
drop function if exists place_order(text, text, text, text, integer, text, text, text, text, timestamptz, timestamptz, jsonb, text, text, text);

create or replace function place_order(
  p_id              text,
  p_order_no        text,
  p_user_id         text,
  p_status          text,
  p_total_fen       integer,
  p_receiver_name   text,
  p_receiver_phone  text,
  p_address         text,
  p_remark          text,
  p_created_at      timestamptz,
  p_paid_at         timestamptz,
  p_items           jsonb,
  p_address_id      text,
  p_delivery_method text,
  p_delivery_slot   text,
  p_discounts       jsonb default '{}'::jsonb
) returns void
language plpgsql
as $$
begin
  insert into orders (id, order_no, user_id, status, total_fen, receiver_name,
    receiver_phone, address, remark, created_at, paid_at,
    address_id, delivery_method, delivery_slot,
    subtotal_fen, mall_discount_fen, tejia_discount_fen,
    manjian_discount_fen, discount_total_fen)
  values (p_id, p_order_no, p_user_id, p_status, p_total_fen, p_receiver_name,
    p_receiver_phone, p_address, p_remark, p_created_at, p_paid_at,
    p_address_id, p_delivery_method, p_delivery_slot,
    coalesce((p_discounts->>'subtotalFen')::integer, 0),
    coalesce((p_discounts->>'mallDiscountFen')::integer, 0),
    coalesce((p_discounts->>'tejiaDiscountFen')::integer, 0),
    coalesce((p_discounts->>'manjianDiscountFen')::integer, 0),
    coalesce((p_discounts->>'discountTotalFen')::integer, 0));

  insert into order_items (id, order_id, product_id, title, price_fen, quantity, subtotal_fen, line_status)
  select x.id, x.order_id, x.product_id, x.title, x.price_fen, x.quantity, x.subtotal_fen,
    coalesce(x.line_status, 'A')
  from jsonb_to_recordset(p_items) as x(
    id text, order_id text, product_id text, title text,
    price_fen integer, quantity integer, subtotal_fen integer, line_status text
  );
end;
$$;
