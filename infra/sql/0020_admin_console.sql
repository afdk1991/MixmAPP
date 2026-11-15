-- 0020 后台运营台写操作审计
--
-- 目的：后台运营台（/admin/console）的每一次写操作都要可追溯 —— 谁、何时、对什么、改前改后。
-- 口径：
-- 1. 只新增一张审计表，不改动任何既有业务表（商品、订单、用户、收藏、满减全部不动）；
-- 2. 全部 create ... if not exists，生产重复执行无副作用；
-- 3. 不建种子数据；审计是「写多读少」的流水，读侧只取最近若干条；
-- 4. before/after 用 jsonb 存快照，便于后续做回滚或差异展示；
-- 5. 批量操作（批量上下架）共用同一 batch_id，方便按批次回溯。

create table if not exists admin_audit_logs (
  id          text primary key,
  action      text not null,
  target_type text not null,
  target_id   text not null,
  summary     text not null default '',
  before      jsonb,
  after       jsonb,
  actor       text not null default 'admin',
  ip          text not null default '',
  user_agent  text not null default '',
  request_id  text not null default '',
  batch_id    text,
  created_at  timestamptz not null default now()
);

comment on table admin_audit_logs is '后台运营台写操作审计流水：谁/何时/对什么/改前改后';
comment on column admin_audit_logs.id is '审计记录主键（服务端生成 uuid）';
comment on column admin_audit_logs.action is '动作标识，如 product.unlist / product.list / order.transition / order.cancel';
comment on column admin_audit_logs.target_type is '目标类型：product / order';
comment on column admin_audit_logs.target_id is '目标主键（商品 id 或订单 id）';
comment on column admin_audit_logs.summary is '人可读摘要，后台列表直接展示';
comment on column admin_audit_logs.before is '改前快照（jsonb），无改前值时为空';
comment on column admin_audit_logs.after is '改后快照（jsonb）';
comment on column admin_audit_logs.actor is '操作者标识：当前只有单一管理员身份，固定为 admin';
comment on column admin_audit_logs.ip is '操作来源 IP（取 x-forwarded-for 首段或直连地址）';
comment on column admin_audit_logs.user_agent is '操作来源 UA';
comment on column admin_audit_logs.request_id is '请求 id，便于和服务端日志对齐';
comment on column admin_audit_logs.batch_id is '批量操作批次号；单条操作为空';
comment on column admin_audit_logs.created_at is '写入时间';

-- 审计列表：按时间倒序取最近若干条
create index if not exists admin_audit_logs_created_idx
  on admin_audit_logs (created_at desc);

-- 按目标回溯：某个商品/订单被谁改过
create index if not exists admin_audit_logs_target_idx
  on admin_audit_logs (target_type, target_id, created_at desc);
