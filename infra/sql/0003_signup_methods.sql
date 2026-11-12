-- 新增注册方式支撑：用户名注册、游客账号
alter table users add column if not exists username text;
alter table users add column if not exists guest boolean not null default false;

-- 用户名唯一（大小写不敏感），空值不占用唯一索引
create unique index if not exists users_username_lower_idx
  on users (lower(username))
  where username is not null;

-- 游客按设备号绑定，绑定表里 provider='guest'，设备号哈希做 open_id
create index if not exists bindings_provider_open_idx on bindings (provider, open_id);
