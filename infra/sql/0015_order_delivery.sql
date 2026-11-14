-- 订单补充「地址簿 id + 配送方式 + 配送时间段」（结算必填项 P0）。
-- 源站口径：结算页必须选配送方式，配送时间按方式给出可选时段；
-- 订单落库时把三者一起固化，便于履约与售后追溯。
-- 历史订单这三列为空（当时只有手填收货信息），读取侧按 null 兼容。
alter table orders add column if not exists address_id text;
alter table orders add column if not exists delivery_method text;
alter table orders add column if not exists delivery_slot text;

comment on column orders.address_id is '下单时选择的地址簿 id（手填地址的历史订单为 null）';
comment on column orders.delivery_method is '配送方式代码：express=快递配送 / pickup=门店自提';
comment on column orders.delivery_slot is '配送时间段代码，必须属于所选配送方式（见 deliveryOptions）';

-- 订单原子落库函数同步扩展：追加三个参数并写入 orders。
-- 旧 12 参版本先删掉，避免 create or replace 产生同名重载、调用侧二义。
drop function if exists place_order(text, text, text, text, integer, text, text, text, text, timestamptz, timestamptz, jsonb);

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
  p_delivery_slot   text
) returns void
language plpgsql
as $$
begin
  insert into orders (id, order_no, user_id, status, total_fen, receiver_name,
    receiver_phone, address, remark, created_at, paid_at,
    address_id, delivery_method, delivery_slot)
  values (p_id, p_order_no, p_user_id, p_status, p_total_fen, p_receiver_name,
    p_receiver_phone, p_address, p_remark, p_created_at, p_paid_at,
    p_address_id, p_delivery_method, p_delivery_slot);

  insert into order_items (id, order_id, product_id, title, price_fen, quantity, subtotal_fen)
  select x.id, x.order_id, x.product_id, x.title, x.price_fen, x.quantity, x.subtotal_fen
  from jsonb_to_recordset(p_items) as x(
    id text, order_id text, product_id text, title text,
    price_fen integer, quantity integer, subtotal_fen integer
  );
end;
$$;
