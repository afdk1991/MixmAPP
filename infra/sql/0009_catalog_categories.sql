-- 三级分类层级（PostgreSQL 14+，可重复执行）。
-- 目标：用真实父子关系表达源站 c1 → c2 → c3，替代「名字拼接」；
--       商品通过 c3_id 关联三级分类；c1/c2 由 parent_id 逐级上卷，保留一级聚合供旧页面过渡。
-- 全部为新增表/可空列，旧数据零影响；失效分类只置 is_active=false，不物理删除。

create table if not exists catalog_categories (
  id            text primary key,
  source        text not null default 'egluosi',
  level         smallint not null check (level between 1 and 3),
  code          text not null,
  name          text not null,
  parent_id     text references catalog_categories(id),
  path_names    text[] not null default '{}',
  sort_no       integer not null default 0,
  product_count integer not null default 0,
  is_active     boolean not null default true,
  first_seen_at timestamptz not null default now(),
  synced_at     timestamptz not null default now()
);

create unique index if not exists catalog_categories_level_code_idx
  on catalog_categories (source, level, code);
create index if not exists catalog_categories_parent_idx on catalog_categories (parent_id);
create index if not exists catalog_categories_level_idx on catalog_categories (level, is_active);

-- 商品关联三级分类（c3_id）与一级聚合（c1_id），并落规格筛选值。
-- spec_dims / spec_lens 只写「源站 ccc_filter 选项里真实存在」的值，无法确认时为 null。
alter table products add column if not exists c3_id     text;
alter table products add column if not exists c1_id     text;
alter table products add column if not exists spec_dims text;
alter table products add column if not exists spec_lens text;

create index if not exists products_c3_idx on products (c3_id);
create index if not exists products_c1_idx on products (c1_id);
create index if not exists products_c3_spec_idx on products (c3_id, spec_dims, spec_lens);
