-- 探测 public schema 的 PostgREST 写通道（探测后可删除）
create table if not exists public.mix_probe (
  id text primary key,
  note text,
  created_at timestamptz not null default now()
);

grant usage on schema public to service_role, authenticated, anon;
grant select, insert, update, delete on public.mix_probe to service_role, authenticated;
