-- 下单幂等：同一个用户 + 同一个 Idempotency-Key 只允许落一张订单
-- 先 claim（占位）再 attach（回写 order_no），并发重试时后到的请求拿到已有 order_no 而不是再扣一次库存
create table if not exists order_requests (
  user_id text not null,
  key text not null,
  order_no text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- 超时取消扫描：按状态 + 创建时间找待支付订单
create index if not exists orders_status_created_idx on orders (status, created_at);
