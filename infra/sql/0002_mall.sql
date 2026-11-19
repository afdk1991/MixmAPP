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

-- 扩样演示商品（家居/个护/食品/运动/数码/穿戴/生活/精选），固定 id，重复执行不覆盖
insert into products (id, title, subtitle, price_fen, original_price_fen, stock, category, cover, images, tags, description, sort_no)
values
  ('mix-p-1007', '可调光桌面台灯', '三档色温 · 无频闪', 12900, 16900, 76, 'home', '#0e7490', '[]', '["照明","书桌"]', '触控调光，暖光/自然光/冷光三档，折叠臂夹式底座，适合书桌与床头。', 70),
  ('mix-p-1008', '香薰收纳托盘', '一物多用置物', 4900, 0, 188, 'home', '#57534e', '[]', '["收纳","木质"]', '胡桃木纹理托盘，放香薰、首饰与钥匙，圆角打磨不划手。', 80),
  ('mix-p-1009', '声波电动牙刷', '清洁 / 敏感双模式', 18900, 23900, 62, 'beauty', '#0891b2', '[]', '["个护","电动"]', '声波震动，配两支替换刷头，IPX7 防水，Type-C 充电。', 90),
  ('mix-p-1010', '冷香滚珠香氛', '随身淡香', 6900, 8900, 130, 'beauty', '#a21caf', '[]', '["香氛","随身"]', '木质调滚珠香氛，10ml 随身装，涂抹于腕部与耳后。', 100),
  ('mix-p-1011', '挂耳黑咖啡礼盒', '中度烘焙 · 12 片装', 5900, 7900, 240, 'food', '#92400e', '[]', '["咖啡","礼盒"]', '中度烘焙阿拉比卡挂耳，独立包装，热水冲泡即可，12 片入礼盒。', 110),
  ('mix-p-1012', '每日坚果混合装', '独立小包 30 袋', 7900, 9900, 165, 'food', '#65a30d', '[]', '["坚果","代餐"]', '核桃、巴旦木、腰果与蔓越莓干混合，每日一小包，30 袋整箱。', 120),
  ('mix-p-1013', '防滑加厚瑜伽垫', '6mm · 含背带', 13900, 17900, 54, 'sports', '#16a34a', '[]', '["健身","瑜伽"]', '6mm 加厚防滑双面，带体位线与便携背带，居家训练与拉伸适用。', 130),
  ('mix-p-1014', '便携运动水壶 750ml', 'Tritan 材质', 4900, 0, 210, 'sports', '#0284c7', '[]', '["水壶","户外"]', '750ml 透明 Tritan 壶身，弹扣杯盖防漏，适配骑行包侧袋。', 140),
  ('mix-p-1015', '半入耳无线耳机', '蓝牙 5.3 · 长续航', 22900, 29900, 71, 'digital', '#1e3a8a', '[]', '["耳机","蓝牙"]', '蓝牙 5.3，通话降噪，充电盒总续航约 30 小时，半入耳佩戴稳固。', 150),
  ('mix-p-1016', '紧凑机械键盘', '68 键 · 热插拔', 32900, 39900, 38, 'digital', '#334155', '[]', '["键盘","机械轴"]', '68 键紧凑布局，三模连接，热插拔轴座，铝合金上盖。', 160),
  ('mix-p-1017', '刺绣棒球帽', '可调节帽围', 5900, 7900, 120, 'wear', '#3f3f46', '[]', '["帽饰","休闲"]', '纯棉斜纹面料，正面 MIX 刺绣，后部金属扣可调节帽围。', 170),
  ('mix-p-1018', '宽松休闲卫衣', '落肩廓形 · 加绒', 19900, 25900, 46, 'wear', '#52525b', '[]', '["卫衣","加绒"]', '落肩宽松廓形，内里薄绒，罗纹袖口与下摆，多色可选。', 180),
  ('mix-p-1019', '316 不锈钢保温杯', '500ml · 长效保温', 8900, 11900, 156, 'life', '#0f766e', '[]', '["水杯","保温"]', '316 不锈钢内胆，500ml，保温 12 小时，弹跳盖单手开合。', 190),
  ('mix-p-1020', '联名贴纸包', '全端通行主题', 1900, 0, 300, 'featured', '#db2777', '[]', '["贴纸","联名"]', '12 枚全端通行主题贴纸，防水覆膜，适合贴在笔电、水杯与行李箱。', 200)
on conflict (id) do nothing;
