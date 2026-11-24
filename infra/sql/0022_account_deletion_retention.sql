-- 0022 账号注销级联删除 + 留存脱敏（契约 .tmp/spec-account-data-lifecycle.md §1.5 / §2）
--
-- 口径：
-- 1. orders / payments 保留履约对账行，user_id 可空并改 on delete set null；
--    注销与到期脱敏只清可识别字段，金额、商品快照、时间、状态、支付流水号保留。
-- 2. delete_account(p_user_id) 单函数完成级联：CloudBase PG 网关一次 mix_exec 调用即一个事务，
--    规避多语句桥接下的中间态；直连 PG 同样在函数内单事务提交。
-- 3. 全部语句幂等（if not exists / if exists / drop constraint if exists），重复执行无副作用。

-- ---------------------------------------------------------------------------
-- 1) orders / payments 外键改为可空 + on delete set null
-- ---------------------------------------------------------------------------
alter table orders alter column user_id drop not null;
alter table payments alter column user_id drop not null;

alter table orders drop constraint if exists orders_user_id_fkey;
alter table orders add constraint orders_user_id_fkey
  foreign key (user_id) references users (id) on delete set null;

alter table payments drop constraint if exists payments_user_id_fkey;
alter table payments add constraint payments_user_id_fkey
  foreign key (user_id) references users (id) on delete set null;

-- users 注销标记（仅审计 / 后台统计展示用；物理删除后该行不保留任何 PII）
alter table users add column if not exists deleted_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2) 注销设备挑战票据：一次性、5 分钟过期，绑定 (user_id, device_id)
-- ---------------------------------------------------------------------------
create table if not exists deletion_challenges (
  challenge   text primary key,
  user_id     text not null references users (id) on delete cascade,
  device_id   text not null,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists deletion_challenges_user_idx on deletion_challenges (user_id);

-- ---------------------------------------------------------------------------
-- 3) 留存清理辅助索引（对应 §2 六个清理任务）
-- ---------------------------------------------------------------------------
create index if not exists refresh_tokens_retention_idx on refresh_tokens (revoked_at, expires_at);
create index if not exists sms_codes_retention_idx on sms_codes (consumed_at, expires_at);
create index if not exists user_devices_retention_idx on user_devices (updated_at);
create index if not exists carts_retention_idx on carts (updated_at);
create index if not exists orders_pii_retention_idx on orders (status, completed_at, cancelled_at);

-- ---------------------------------------------------------------------------
-- 4) 账号注销级联函数（单事务原子完成）
-- 返回 jsonb：各类清除 / 脱敏条数，供接口响应与对账使用。
-- ---------------------------------------------------------------------------
create or replace function delete_account(p_user_id text)
returns jsonb
language plpgsql
as $$
declare
  v_orders     integer := 0;
  v_payments  integer := 0;
  v_binds      integer := 0;
  v_tokens     integer := 0;
  v_devices    integer := 0;
  v_addresses  integer := 0;
  v_fav_items  integer := 0;
  v_fav_folders integer := 0;
  v_carts      integer := 0;
  v_push       integer := 0;
  v_requests   integer := 0;
begin
  -- 订单：留行脱敏，user_id 置空；收货人姓名 / 电话 / 地址 / 备注 / 地址簿引用不可逆清空。
  -- 商品快照（order_items）、金额、优惠、时间戳、状态、取消原因与发起方保留不动。
  update orders
     set user_id        = null,
         receiver_name  = '',
         receiver_phone = '',
         address        = '',
         remark         = null,
         address_id     = null
   where user_id = p_user_id;
  get diagnostics v_orders = row_count;

  -- 支付：留行对账，user_id 置空；流水号、金额、渠道、主题保留。
  update payments set user_id = null where user_id = p_user_id;
  get diagnostics v_payments = row_count;

  delete from bindings where user_id = p_user_id;
  get diagnostics v_binds = row_count;

  -- 全部刷新令牌物理删除：现有与后续会话立即失效。
  delete from refresh_tokens where user_id = p_user_id;
  get diagnostics v_tokens = row_count;

  delete from user_devices where user_id = p_user_id;
  get diagnostics v_devices = row_count;

  delete from mall_addresses where user_id = p_user_id;
  get diagnostics v_addresses = row_count;

  -- 收藏：先条目后收藏夹（条目外键挂在收藏夹上）。
  delete from mall_favorite_items where user_id = p_user_id;
  get diagnostics v_fav_items = row_count;

  delete from mall_favorite_folders where user_id = p_user_id;
  get diagnostics v_fav_folders = row_count;

  delete from carts where user_id = p_user_id;
  get diagnostics v_carts = row_count;

  delete from push_tokens where user_id = p_user_id;
  get diagnostics v_push = row_count;

  delete from order_requests where user_id = p_user_id;
  get diagnostics v_requests = row_count;

  delete from deletion_challenges where user_id = p_user_id;

  -- 最后删除账号行本身；上述子表已清，orders/payments 已置空 user_id，不依赖级联。
  delete from users where id = p_user_id;

  return jsonb_build_object(
    'binds', v_binds,
    'devices', v_devices,
    'addresses', v_addresses,
    'favorites', v_fav_items,
    'carts', v_carts,
    'pushTokens', v_push,
    'ordersAnonymized', v_orders,
    'paymentsAnonymized', v_payments,
    'revokedSessions', v_tokens,
    'favoriteFolders', v_fav_folders,
    'orderRequests', v_requests
  );
end;
$$;
