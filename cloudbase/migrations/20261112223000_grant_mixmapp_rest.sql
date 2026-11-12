-- 让网关的 PostgREST 角色可访问 mixmapp schema（表由 cloudbase_postgres_* 拥有）
grant usage on schema mixmapp to service_role, authenticated, anon;

grant select, insert, update, delete on all tables in schema mixmapp to service_role, authenticated;
grant select on all tables in schema mixmapp to anon;

grant usage, select on all sequences in schema mixmapp to service_role, authenticated;
grant execute on all functions in schema mixmapp to service_role, authenticated;
