-- 0019 收藏夹（多收藏夹 + 条目 + 默认收藏夹）
--
-- 源站口径（本批落地）：
-- 1. 收藏以「收藏夹」组织：一个用户可以有多个收藏夹，其中恰好一个为默认收藏夹；
-- 2. 条目挂在收藏夹下，同一收藏夹内同一商品只能出现一次（不同收藏夹可重复收藏同一商品）；
-- 3. 支持复制收藏夹、设为默认、清空条目；条目只存商品引用，商品标题/价格/图片读时从 products 取，
--    与购物车同口径，不落价格快照（避免价格变动后收藏夹展示与实际不一致）。
--
-- 口径约定：
-- - 本迁移只新增两张表与索引，不改任何既有表、不改金额与库存口径；
-- - 全部 create ... if not exists，生产重复执行无副作用；
-- - 不建种子数据：默认收藏夹由服务端在用户首次使用收藏功能时按需创建（避免给存量用户批量插行）。

-- ---------------------------------------------------------------------------
-- 1) 收藏夹
-- ---------------------------------------------------------------------------
create table if not exists mall_favorite_folders (
  id          text primary key,
  user_id     text not null references users (id) on delete cascade,
  name        text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint mall_favorite_folders_name_chk check (char_length(btrim(name)) between 1 and 40)
);

comment on table mall_favorite_folders is '收藏夹：一个用户可建多个，恰好一个为默认收藏夹；条目见 mall_favorite_items';
comment on column mall_favorite_folders.id is '收藏夹主键';
comment on column mall_favorite_folders.user_id is '归属用户；用户注销时级联删除其全部收藏夹';
comment on column mall_favorite_folders.name is '收藏夹名称，1–40 字符（去首尾空格后校验）';
comment on column mall_favorite_folders.is_default is '是否默认收藏夹：加收藏未指定收藏夹时落到这里；同一用户最多一个为 true';
comment on column mall_favorite_folders.created_at is '创建时间';
comment on column mall_favorite_folders.updated_at is '最后更新时间（改名、设默认、复制等写操作都会刷新）';

-- 列表读法：按用户查全量收藏夹
create index if not exists mall_favorite_folders_user_idx
  on mall_favorite_folders (user_id, created_at);

-- 「同一用户最多一个默认收藏夹」由数据库兜底：部分唯一索引只约束 is_default = true 的行
create unique index if not exists mall_favorite_folders_default_uq
  on mall_favorite_folders (user_id)
  where is_default;

-- ---------------------------------------------------------------------------
-- 2) 收藏条目
-- ---------------------------------------------------------------------------
create table if not exists mall_favorite_items (
  id         text primary key,
  folder_id  text not null references mall_favorite_folders (id) on delete cascade,
  user_id    text not null references users (id) on delete cascade,
  product_id text not null references products (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- 同一收藏夹内同一商品只保留一条；重复收藏按幂等处理（不报错、不重复计数）
  constraint mall_favorite_items_folder_product_uq unique (folder_id, product_id)
);

comment on table mall_favorite_items is '收藏条目：商品引用，标题/价格/图片读时从 products 取，不落快照';
comment on column mall_favorite_items.folder_id is '所属收藏夹；收藏夹删除时级联删除条目';
comment on column mall_favorite_items.user_id is '冗余归属用户：用于「跨收藏夹查某商品是否已收藏」与越权校验，避免每次多一次 join';
comment on column mall_favorite_items.product_id is '商品 id；商品下架删除时级联删除收藏条目';
comment on column mall_favorite_items.created_at is '收藏时间，列表按此倒序';

-- 条目列表：按收藏夹倒序分页
create index if not exists mall_favorite_items_folder_idx
  on mall_favorite_items (folder_id, created_at desc);

-- 「这个商品我收藏了吗 / 在哪些收藏夹」：按用户 + 商品过滤
create index if not exists mall_favorite_items_user_product_idx
  on mall_favorite_items (user_id, product_id);
