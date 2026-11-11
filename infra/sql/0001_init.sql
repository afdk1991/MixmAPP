-- MixmAPP 初始结构（PostgreSQL 14+）
create table if not exists users (
  id            text primary key,
  account_no    text not null unique,
  snowflake     text not null unique,
  ulid          text not null,
  uuid_v7       text not null,
  nickname      text not null,
  avatar_url    text,
  bio           text,
  phone         text unique,
  email         text unique,
  password_hash text,
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists users_created_at_idx on users (created_at desc);

create table if not exists bindings (
  id         text primary key,
  user_id    text not null references users (id) on delete cascade,
  provider   text not null,
  open_id    text not null,
  union_id   text,
  nickname   text,
  avatar_url text,
  created_at timestamptz not null default now(),
  unique (provider, open_id)
);

create index if not exists bindings_user_idx on bindings (user_id);

create table if not exists refresh_tokens (
  token_hash  text primary key,
  user_id     text not null references users (id) on delete cascade,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  replaced_by text,
  created_at  timestamptz not null default now()
);

create index if not exists refresh_tokens_user_idx on refresh_tokens (user_id);

create table if not exists sms_codes (
  id          text primary key,
  phone       text not null,
  purpose     text not null,
  code_hash   text not null,
  attempts    integer not null default 0,
  consumed_at timestamptz,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists sms_codes_lookup_idx on sms_codes (phone, purpose, created_at desc);

create table if not exists payments (
  id             text primary key,
  out_trade_no   text not null unique,
  user_id        text not null references users (id) on delete cascade,
  channel        text not null,
  amount_fen     integer not null,
  subject        text not null,
  status         text not null default 'pending',
  prepay         jsonb,
  transaction_id text,
  paid_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists payments_user_idx on payments (user_id, created_at desc);

create table if not exists push_tokens (
  id         text primary key,
  user_id    text not null references users (id) on delete cascade,
  provider   text not null,
  platform   text not null,
  token      text not null,
  created_at timestamptz not null default now(),
  unique (user_id, token)
);
