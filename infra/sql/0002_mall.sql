-- 商城域：商品 / 购物车 / 订单（PostgreSQL 14+，可重复执行）
create table if not exists products (
  id                 text primary key,
  title              text not null,
  subtitle           text not null default '',
  price_fen          integer not null check (price_fen >= 0),
  original_price_fen integer not null default 0,
  stock              integer not null default 0 check (stock >= 0),
  category           text not null default 'all',
  cover              text not null default '#0f9d8f',
  images             jsonb not null default '[]'::jsonb,
  tags               jsonb not null default '[]'::jsonb,
  description        text not null default '',
  sort_no            integer not null default 0,
  created_at         timestamptz not null default now()
);

create index if not exists products_category_idx on products (category, sort_no);

create table if not exists carts (
  id         text primary key,
  user_id    text not null references users (id) on delete cascade,
  product_id text not null references products (id) on delete cascade,
  quantity   integer not null check (quantity > 0 and quantity <= 99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index if not exists carts_user_idx on carts (user_id, created_at);

create table if not exists orders (
  id             text primary key,
  order_no       text not null unique,
  user_id        text not null references users (id) on delete cascade,
  status         text not null default 'pending',
  total_fen      integer not null check (total_fen >= 0),
  receiver_name  text not null,
  receiver_phone text not null,
  address        text not null,
  remark         text,
  created_at     timestamptz not null default now(),
  paid_at        timestamptz
);

create index if not exists orders_user_idx on orders (user_id, created_at desc);

create table if not exists order_items (
  id           text primary key,
  order_id     text not null references orders (id) on delete cascade,
  product_id   text not null,
  title        text not null,
  price_fen    integer not null,
  quantity     integer not null check (quantity > 0),
  subtotal_fen integer not null
);

create index if not exists order_items_order_idx on order_items (order_id);

-- 演示商品（固定 id，重复执行不覆盖已有数据）
insert into products (id, title, subtitle, price_fen, original_price_fen, stock, category, cover, images, tags, description, sort_no)
values
  ('mix-p-1001', 'MixmAPP 首发限定礼盒', '单码多端 · 全端通行', 29900, 39900, 120, 'featured', '#0f9d8f', '[]', '["首发","限定"]', '含品牌徽章、贴纸与全端通行卡，适合作为 MixmAPP 首个对外发布纪念。', 10),
  ('mix-p-1002', '石墨黑轻量冲锋衣', '通勤 / 露营两用', 45900, 59900, 64, 'wear', '#1f2937', '[]', '["防风","轻量"]', '三层复合面料，收纳后仅一瓶水大小，适合城市与短途户外。', 20),
  ('mix-p-1003', '桌面理线收纳坞', '一坞收齐所有线', 8900, 12900, 210, 'life', '#334155', '[]', '["桌面","收纳"]', '铝合金底座 + 硅胶卡槽，兼容常见充电头与线材。', 30),
  ('mix-p-1004', 'MIX 号码金属徽章', '专属号码定制', 3900, 0, 500, 'featured', '#b45309', '[]', '["定制","徽章"]', '可刻印你的 MIX 号码，磁吸式背面，不伤衣物。', 40),
  ('mix-p-1005', '便携氮化镓充电器 65W', '一个头搞定全端', 15900, 19900, 88, 'digital', '#0b1220', '[]', '["快充","GaN"]', '双 C 口 + 单 A 口，65W 总输出，手机/平板/轻薄本通用。', 50),
  ('mix-p-1006', '全端同步帆布托特包', '装得下 16 寸笔电', 9900, 13900, 150, 'life', '#7c3aed', '[]', '["帆布","通勤"]', '加厚帆布 + 内衬电脑仓，日常通勤与周末出行都够用。', 60)
on conflict (id) do nothing;
