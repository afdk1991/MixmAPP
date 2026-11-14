-- 详情页结构化补齐（PostgreSQL 14+，可重复执行）。
-- 设计：通用字段走列，类目特有属性（等级/材质/标准/牙别/表面处理/品名…）统一进 attributes jsonb，
-- 避免给「成品刃具」这类目留下 5 个恒空列。全部新增列可空或带默认值，旧数据零影响。

alter table products add column if not exists attributes        jsonb not null default '{}'::jsonb;
-- 面价：源站 basePrcD3N2 单位「元/千支」，数值上等于「厘/支」，用整数存可精确计价（1 分 = 10 厘）。
alter table products add column if not exists price_li          integer;
-- 折扣百分比（disD2N2），100 = 无折扣；小额零售折扣（lowDqDisc）不在此列，保留在 attributes。
alter table products add column if not exists discount_pct       numeric(6, 2);
-- 特价（tejiaD2N2，厘/支），源站无特价时为 null。
alter table products add column if not exists sale_price_li      integer;
-- 优惠活动/促销文案数组：[{ text, validFrom?, validTo?, kind }]，源站无活动时为空数组。
alter table products add column if not exists promotions         jsonb not null default '[]'::jsonb;
-- 包装换算文案原文，如「1箱=16盒,1盒=2000支」。
alter table products add column if not exists packaging_desc     text;
-- 购买方式：units 原样 [{code,name}]，如 [{code:'BX',name:'盒'},{code:'CA',name:'箱'}]。
alter table products add column if not exists unit_options       jsonb not null default '[]'::jsonb;
-- 单位换算：convs 原样 {BX:2000, CA:32000, EA:1}，需求支数 = 包装数 × convs[选中单位]。
alter table products add column if not exists unit_conversions   jsonb not null default '{}'::jsonb;
-- 商品详图：源站按三级类目共享 static/uploads/item/c3/<c3>/spec，落地成本地静态路径。
alter table products add column if not exists spec_image         text;
-- 源站详情键（列表行 no，非项目号 code），用于二次抓取与对账。
alter table products add column if not exists source_item_no     text;
-- 数量规则：默认 1、步长 1、最小 1、最大 1,000,000（与源站 JS 口径一致）。
alter table products add column if not exists min_order_qty      integer not null default 1;
alter table products add column if not exists qty_step           integer not null default 1;
alter table products add column if not exists max_order_qty      integer not null default 1000000;

create index if not exists products_source_item_no_idx on products (source_item_no);

-- 购物车：按箱/盒购买时 quantity 语义为「支数」（1 箱可能 32000 支），原 99 上限必须放宽。
alter table carts add column if not exists pack_unit text;
alter table carts add column if not exists pack_qty  integer;
alter table carts drop constraint if exists carts_quantity_check;
alter table carts add constraint carts_quantity_check check (quantity > 0 and quantity <= 100000000);

-- 订单行：记录购买方式与精确单价（厘/支），小计仍以分为单位存。
alter table order_items add column if not exists pack_unit text;
alter table order_items add column if not exists pack_qty  integer;
alter table order_items add column if not exists price_li  integer;

-- 订单原子落库函数同步接收购买方式与精确单价（网关模式仍走这个函数）。
create or replace function place_order(
  p_id             text,
  p_order_no       text,
  p_user_id        text,
  p_status         text,
  p_total_fen      integer,
  p_receiver_name  text,
  p_receiver_phone text,
  p_address        text,
  p_remark         text,
  p_created_at     timestamptz,
  p_paid_at        timestamptz,
  p_items          jsonb
) returns void
language plpgsql
as $$
begin
  insert into orders (id, order_no, user_id, status, total_fen, receiver_name,
    receiver_phone, address, remark, created_at, paid_at)
  values (p_id, p_order_no, p_user_id, p_status, p_total_fen, p_receiver_name,
    p_receiver_phone, p_address, p_remark, p_created_at, p_paid_at);

  insert into order_items (id, order_id, product_id, title, price_fen, quantity, subtotal_fen,
    pack_unit, pack_qty, price_li)
  select x.id, x.order_id, x.product_id, x.title, x.price_fen, x.quantity, x.subtotal_fen,
    x.pack_unit, x.pack_qty, x.price_li
  from jsonb_to_recordset(p_items) as x(
    id text, order_id text, product_id text, title text,
    price_fen integer, quantity integer, subtotal_fen integer,
    pack_unit text, pack_qty integer, price_li integer
  );
end;
$$;
