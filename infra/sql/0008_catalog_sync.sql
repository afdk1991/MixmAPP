-- 0008: 源站每周增量对齐（emarket catalog sync）
-- 目的：源站下架只标记不可售，不物理删除；变更可追溯（字段级 before/after + 时间）。
-- 幂等：全部 if not exists，可重复执行。

alter table products add column if not exists listed boolean not null default true;
alter table products add column if not exists source_status text;
alter table products add column if not exists source_status_at timestamptz;
alter table products add column if not exists synced_at timestamptz;
alter table products add column if not exists price_changed_at timestamptz;
-- 源站原始在售/库存状态（用于区分「下架」与「缺货」，变更时写流水）
alter table products add column if not exists source_on_sale boolean;
alter table products add column if not exists source_inv_status text;

create index if not exists products_listed_idx on products (listed);

-- 字段级变更流水：每次同步只记录真正变化的字段
create table if not exists product_change_log (
  id bigserial primary key,
  run_id text not null,
  product_id text,
  source_key text not null,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  changed_at timestamptz not null default now()
);

create index if not exists product_change_log_key_idx
  on product_change_log (source_key, changed_at desc);
create index if not exists product_change_log_run_idx
  on product_change_log (run_id);

-- 每次同步的汇总；供「上次执行结果 / 下次执行时间」查询
create table if not exists catalog_sync_runs (
  run_id text primary key,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null default 'running',
  stats jsonb not null default '{}'::jsonb,
  report_path text,
  error text
);
