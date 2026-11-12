-- 订单原子落库：CloudBase PG 网关每次调用是独立语句，没有跨语句事务，
-- 因此把「订单 + 明细」收进一个 plpgsql 函数，保证一次调用内原子完成。
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

  insert into order_items (id, order_id, product_id, title, price_fen, quantity, subtotal_fen)
  select x.id, x.order_id, x.product_id, x.title, x.price_fen, x.quantity, x.subtotal_fen
  from jsonb_to_recordset(p_items) as x(
    id text, order_id text, product_id text, title text,
    price_fen integer, quantity integer, subtotal_fen integer
  );
end;
$$;
