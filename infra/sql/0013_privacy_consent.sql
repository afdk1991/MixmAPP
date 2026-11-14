-- 隐私政策同意记录：注册环节取得，落在用户记录上供合规审计。
-- 版本号用于判断是否需要重新征得同意（政策升级后 version 变化即为未同意新版本）。
alter table users add column if not exists privacy_consent_version text;
alter table users add column if not exists privacy_consent_at timestamptz;
alter table users add column if not exists privacy_consent_channel text;
alter table users add column if not exists privacy_consent_source text;

comment on column users.privacy_consent_version is '隐私政策版本号（客户端 privacy.ts 的 POLICY_VERSION）';
comment on column users.privacy_consent_at is '用户点击同意的客户端时间';
comment on column users.privacy_consent_channel is '本机存储通道：web / native';
comment on column users.privacy_consent_source is '注册来源，如 register:phone/android';
