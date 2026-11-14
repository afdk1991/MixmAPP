-- 账号合并审计表：每一次破坏性合并都必须先落快照，再迁移，最后标记结果。
-- 同一 merge_key 只允许一条记录，保证重放（回调重试 / 用户重复提交）不会二次迁移数据。

create table if not exists account_merges (
  id text primary key,
  merge_key text not null unique,
  primary_user_id text not null,
  secondary_user_id text not null,
  reason text not null check (reason in ('bind_phone', 'oauth_union', 'admin')),
  status text not null check (status in ('pending', 'completed', 'failed', 'rolled_back')),
  -- 合并前两个账号的完整快照（users / bindings / carts / 订单、支付、推送 id 列表）
  snapshot jsonb not null,
  -- 实际迁移明细：绑定/购物车/订单/支付/推送数量、冲突与丢弃项
  moved jsonb,
  -- 冲突策略文本快照，审计时不用回看代码
  conflict_strategy jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  rolled_back_at timestamptz
);

create index if not exists account_merges_primary_idx on account_merges (primary_user_id, created_at desc);
create index if not exists account_merges_secondary_idx on account_merges (secondary_user_id, created_at desc);

-- union_id 归并查询：绑定表已有列，这里补齐查询索引（0010 只建了部分索引）。
create index if not exists bindings_union_id_idx on bindings (union_id) where union_id is not null;
