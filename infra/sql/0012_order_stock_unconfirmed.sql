-- 货源待确认标记：下单时仅由源站匿名视图推断缺货（未扣估算库存）的订单行
alter table order_items add column if not exists stock_unconfirmed boolean not null default false;

create index if not exists idx_order_items_stock_unconfirmed
  on order_items (stock_unconfirmed)
  where stock_unconfirmed;
