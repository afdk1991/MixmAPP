-- 收货地址簿（结算必填项 P0）。
-- 源站口径：收货地址为「省 / 市 / 区 + 详细地址」四级录入，收货人与手机号随地址保存；
-- 下单时取该地址的快照写入订单，地址后续被编辑/删除不影响历史订单。
create table if not exists mall_addresses (
  id             text primary key,
  user_id        text not null references users (id) on delete cascade,
  receiver_name  text not null,
  receiver_phone text not null,
  province       text not null,
  city           text not null,
  district       text not null,
  detail         text not null,
  -- 默认地址：同一用户只保留一条，由「单条 update 整体改写」保证，不加部分唯一索引
  -- （CloudBase PG 网关无跨语句事务，逐行更新时唯一索引可能被瞬时冲突打断）
  is_default     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- 列表按用户取、默认地址排最前；删除用户时地址随之清理
create index if not exists mall_addresses_user_idx on mall_addresses (user_id, is_default desc, created_at desc);

comment on table mall_addresses is '收货地址簿（源站结算页地址管理口径：省/市/区 + 详细地址）';
comment on column mall_addresses.id is '地址主键（服务端 snowflake 生成）';
comment on column mall_addresses.user_id is '所属用户 id';
comment on column mall_addresses.receiver_name is '收货人姓名（随地址保存）';
comment on column mall_addresses.receiver_phone is '收货人手机号（11 位大陆手机号）';
comment on column mall_addresses.province is '省/直辖市/自治区，参与源站配送可达性判断';
comment on column mall_addresses.city is '市，省市区三级必填（源站地址为三级联动）';
comment on column mall_addresses.district is '区/县，省市区三级必填';
comment on column mall_addresses.detail is '详细地址（街道、门牌号等）';
comment on column mall_addresses.is_default is '是否默认地址：同一用户至多一条，由服务端单语句整体改写';
comment on column mall_addresses.created_at is '创建时间';
comment on column mall_addresses.updated_at is '最后修改时间';
