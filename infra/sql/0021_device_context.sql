-- 0021 设备与网络快照（契约 docs/39-device-context-2026-11-22.md §2）
--
-- 目的：记录「该次登录发生时」的设备与网络，并为每个用户的每台设备保留最近一次快照。
-- 口径：
-- 1. refresh_tokens 只增 nullable 列，老库、老客户端不受影响；
-- 2. user_devices 以 (user_id, device_id) 为主键 upsert，存最近一次快照；
-- 3. 全部 if not exists / add column if not exists，生产重复执行无副作用；
-- 4. client_ip 只由服务端从反代首跳或直连地址产生，客户端上报的 ip 一律不落库。

alter table refresh_tokens add column if not exists device_id   text;
alter table refresh_tokens add column if not exists device_model text;
alter table refresh_tokens add column if not exists os_name      text;
alter table refresh_tokens add column if not exists os_version   text;
alter table refresh_tokens add column if not exists network_type text;
alter table refresh_tokens add column if not exists carrier      text;
alter table refresh_tokens add column if not exists client_ip     text;

comment on column refresh_tokens.device_id   is '登录设备号（ANDROID_ID / 持久 UUID）；取不到为 null';
comment on column refresh_tokens.device_model is '机型（Build.MODEL / UA 解析）；取不到为空串';
comment on column refresh_tokens.os_name      is '系统名：Android / iOS / Web';
comment on column refresh_tokens.os_version   is '系统版本；取不到为空串';
comment on column refresh_tokens.network_type  is '网络类型：wifi / cellular / ethernet / none';
comment on column refresh_tokens.carrier       is '运营商名；取不到为空串，不填假值';
comment on column refresh_tokens.client_ip     is '服务端看到的来源 IP（XFF 首跳回落直连地址），不采信客户端上报';

create table if not exists user_devices (
  user_id       text not null references users (id) on delete cascade,
  device_id     text not null,
  device_model  text not null default '',
  os_name       text not null default 'Web',
  os_version    text not null default '',
  network_type  text not null default 'none',
  carrier       text not null default '',
  client_ip     text not null default '',
  updated_at    timestamptz not null default now(),
  primary key (user_id, device_id)
);

comment on table user_devices is '用户每台设备的最近一次设备与网络快照（upsert）';
comment on column user_devices.user_id      is '归属用户 id';
comment on column user_devices.device_id    is '设备号';
comment on column user_devices.device_model is '机型';
comment on column user_devices.os_name      is '系统名：Android / iOS / Web';
comment on column user_devices.os_version   is '系统版本';
comment on column user_devices.network_type is '网络类型：wifi / cellular / ethernet / none';
comment on column user_devices.carrier      is '运营商名，取不到为空串';
comment on column user_devices.client_ip    is '服务端看到的来源 IP';
comment on column user_devices.updated_at   is '快照采集时间（服务端写入时间，不采信客户端时间）';

create index if not exists user_devices_user_idx on user_devices (user_id, updated_at desc);
