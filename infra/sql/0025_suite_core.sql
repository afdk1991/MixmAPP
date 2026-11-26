-- 0025 业务套件（Suite）通用台账
--
-- 口径：
-- 1. 13 个业务领域共用四张台账：交互（评论/点赞/收藏/评分）、进度、看板、台账事件。
--    领域之间的差异全部落在「领域模块」的纯逻辑里，不额外开业务表。
-- 2. 全部语句幂等（if not exists），重复执行无副作用；迁移按文件名顺序执行。
-- 3. 用户自有行 user_id 挂 on delete cascade：账号注销时随 users 行一并物理删除，
--    不留可回连个人身份的数据（与 carts / favorites 同口径）。
-- 4. payload / meta 走 jsonb：领域附加结构由应用层定义，检索不依赖这些列。

-- ---------------------------------------------------------------------------
-- 1) 交互：评论 / 点赞 / 收藏 / 评分共用一张表，靠 kind 区分
-- ---------------------------------------------------------------------------
create table if not exists suite_interactions (
  id         text primary key,
  domain_id  text not null,
  entry_id   text not null,
  user_id    text references users (id) on delete cascade,
  kind       text not null,
  body       text not null default '',
  rating     integer,
  parent_id  text,
  status     text not null default 'visible',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 同一用户对同一条目同一类交互只保留一行（点赞/收藏幂等靠它兜底）
create unique index if not exists suite_interactions_user_kind_idx
  on suite_interactions (user_id, domain_id, entry_id, kind)
  where user_id is not null;

-- 列表主路径：按领域 + 条目取可见交互，按时间倒序
create index if not exists suite_interactions_entry_idx
  on suite_interactions (domain_id, entry_id, created_at desc)
  where status = 'visible';

create index if not exists suite_interactions_user_idx
  on suite_interactions (user_id)
  where user_id is not null;

-- ---------------------------------------------------------------------------
-- 2) 进度：一个用户对一条目只保留一行，重复提交即更新
-- ---------------------------------------------------------------------------
create table if not exists suite_progress (
  id           text primary key,
  user_id      text not null references users (id) on delete cascade,
  domain_id    text not null,
  entry_id     text not null,
  status       text not null default 'todo',
  value        integer not null default 0,
  notes        text not null default '',
  due_at       timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists suite_progress_user_entry_idx
  on suite_progress (user_id, domain_id, entry_id);

create index if not exists suite_progress_user_domain_idx
  on suite_progress (user_id, domain_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- 3) 看板：任务 / 工单 / 账单行 / 稿件 …… 领域自解释 stage
-- ---------------------------------------------------------------------------
create table if not exists suite_boards (
  id         text primary key,
  domain_id  text not null,
  user_id    text not null references users (id) on delete cascade,
  title      text not null,
  stage      text not null,
  priority   text not null default 'normal',
  amount_fen bigint not null default 0,
  payload    jsonb not null default '{}'::jsonb,
  due_at     timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists suite_boards_user_domain_idx
  on suite_boards (user_id, domain_id, updated_at desc);

create index if not exists suite_boards_user_stage_idx
  on suite_boards (user_id, domain_id, stage);

-- ---------------------------------------------------------------------------
-- 4) 台账事件：账单 / 预约 / 订单 / 发票 …… 统一事件台账
-- ---------------------------------------------------------------------------
create table if not exists suite_events (
  id          text primary key,
  domain_id   text not null,
  user_id     text not null references users (id) on delete cascade,
  kind        text not null,
  subject     text not null,
  amount_fen  bigint not null default 0,
  status      text not null default 'pending',
  out_trade_no text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists suite_events_user_domain_idx
  on suite_events (user_id, domain_id, created_at desc);

create index if not exists suite_events_user_kind_idx
  on suite_events (user_id, domain_id, kind, status);

-- 支付对账：同一用户下 out_trade_no 唯一，避免重复入账
create unique index if not exists suite_events_trade_no_idx
  on suite_events (user_id, out_trade_no)
  where out_trade_no is not null;
