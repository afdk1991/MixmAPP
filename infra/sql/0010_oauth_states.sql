-- OAuth 一次性 state 票据：发起授权时写入，回跳时原子消费，防 CSRF 与重放。
create table if not exists oauth_states (
  state        text primary key,
  provider     text not null,
  redirect     text not null,
  redirect_uri text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  consumed_at  timestamptz
);

create index if not exists oauth_states_expires_idx on oauth_states (expires_at);

-- 第三方身份按 (provider, open_id) 唯一；0001 已有同名约束，这里只补齐按 union_id 的查询索引。
create index if not exists bindings_provider_union_idx
  on bindings (provider, union_id)
  where union_id is not null;
