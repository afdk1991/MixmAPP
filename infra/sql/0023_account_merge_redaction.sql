-- 0023 账号注销级联：account_merges 合并审计快照脱敏（沿用 0022 的 delete_account 口径）
--
-- 背景：0022 的 delete_account(p_user_id) 没有处理 account_merges。合并快照 snapshot
-- jsonb 里可能残留被删账号的 openId / 购物车行 / 地址等可识别文本。
--
-- 口径（不整行删除，否则会摧毁仍在存续的另一账号的合并审计链）：
-- 1. 对 primary_user_id 或 secondary_user_id 命中被删账号的行：snapshot 覆写为最小墓碑
--    {"redacted": true, "redactedAt": "<ISO 时间>"}；account_merges 表本身没有
--    nickname / accountNo / openId 之类的冗余可识别列，无需额外清空。
-- 2. 保留 id、merge_key、reason、status、moved、conflict_strategy、error、
--    created_at / completed_at / rolled_back_at 等审计骨架，保证幂等与可追溯。
-- 3. 本文件只重定义 delete_account 函数；0022 的表结构 / 索引 / 挑战票据表不动，
--    0022 那个已提交文件不修改。
-- 4. 全部语句幂等，重复执行无副作用。

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
  v_merge_redacted integer := 0;
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

  -- 合并审计：行保留，不整行删除。命中被删账号的行只把 snapshot 覆写为最小墓碑，
  -- 审计骨架（merge_key / status / reason / 迁移明细 / 冲突策略 / 时间戳）保留。
  update account_merges
     set snapshot = jsonb_build_object('redacted', true, 'redactedAt', now())
   where primary_user_id = p_user_id
      or secondary_user_id = p_user_id;
  get diagnostics v_merge_redacted = row_count;

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
    'orderRequests', v_requests,
    'mergeRecordsRedacted', v_merge_redacted
  );
end;
$$;
