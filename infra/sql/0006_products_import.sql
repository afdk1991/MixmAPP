-- 目录导入增补列（PostgreSQL 14+，可重复执行）。
-- 仅新增可空列与唯一索引，不动既有列；旧商品这些列保持 NULL / 默认值，零影响。

alter table products add column if not exists source_key          text;
alter table products add column if not exists source_url          text;
alter table products add column if not exists source_id           text;
alter table products add column if not exists brand               text;
alter table products add column if not exists category_path       text;
alter table products add column if not exists category_name       text;
alter table products add column if not exists specs               jsonb not null default '{}'::jsonb;
alter table products add column if not exists unit                text;
alter table products add column if not exists pack_qty            integer;
alter table products add column if not exists price_source        text;
alter table products add column if not exists price_captured_at   timestamptz;
alter table products add column if not exists stock_source        text;
alter table products add column if not exists import_batch        text;

-- 幂等稳定键：同一实体只允许一条；NULL 不参与唯一约束（PG 唯一索引允许多个 NULL）。
create unique index if not exists products_source_key_idx on products (source_key);

create index if not exists products_category_code_idx on products (category);
