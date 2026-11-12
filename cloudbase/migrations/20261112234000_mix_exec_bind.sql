-- 修复 SQL 桥参数替换：bcrypt 哈希等字面量里含有 `$2b$`、`$10$`，
-- 直接对整条 SQL 做 replace 会把已插入的字符串内容当成占位符再替换一次，导致语法错误。
-- 这里改为「引号感知」的逐字符扫描：只在字符串字面量之外识别 $n。
create or replace function public.mix_literal(p_value jsonb)
returns text
language sql
immutable
as $$
  select case jsonb_typeof(p_value)
    when 'string'  then quote_literal(p_value #>> '{}')
    when 'number'  then p_value #>> '{}'
    when 'boolean' then p_value #>> '{}'
    when 'null'    then 'NULL'
    else                quote_literal(p_value::text) || '::jsonb'
  end;
$$;

create or replace function public.mix_bind(p_sql text, p_params jsonb)
returns text
language plpgsql
immutable
as $$
declare
  v_out      text := '';
  v_in_quote boolean := false;
  v_len      int := length(p_sql);
  v_i        int := 1;
  v_c        text;
  v_next     text;
  v_num      text;
  v_idx      int;
  v_count    int := coalesce(jsonb_array_length(p_params), 0);
begin
  while v_i <= v_len loop
    v_c := substr(p_sql, v_i, 1);
    if v_c = '''' then
      v_out := v_out || v_c;
      v_next := substr(p_sql, v_i + 1, 1);
      if v_in_quote and v_next = '''' then
        v_out := v_out || '''';
        v_i := v_i + 2;
        continue;
      end if;
      v_in_quote := not v_in_quote;
      v_i := v_i + 1;
    elsif v_c = '$' and not v_in_quote then
      v_num := '';
      v_i := v_i + 1;
      while v_i <= v_len and substr(p_sql, v_i, 1) ~ '[0-9]' loop
        v_num := v_num || substr(p_sql, v_i, 1);
        v_i := v_i + 1;
      end loop;
      if v_num <> '' and v_num::int between 1 and v_count then
        v_out := v_out || public.mix_literal(p_params -> (v_num::int - 1));
      else
        v_out := v_out || '$' || v_num;
      end if;
    else
      v_out := v_out || v_c;
      v_i := v_i + 1;
    end if;
  end loop;
  return v_out;
end;
$$;

create or replace function public.mix_exec(p_sql text, p_params jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, mixmapp
as $$
declare
  v_sql    text;
  v_result jsonb;
  v_kind   text;
  v_rows   bigint;
begin
  if p_sql is null or btrim(p_sql) = '' then
    raise exception 'empty sql';
  end if;

  v_sql := public.mix_bind(p_sql, coalesce(p_params, '[]'::jsonb));

  if v_sql ~* '\mreturning\M' then
    execute 'with __mix_r as (' || v_sql || ') select coalesce(jsonb_agg(t), ''[]''::jsonb) from __mix_r t'
      into v_result;
  else
    v_kind := lower(substring(btrim(v_sql) from 1 for 6));
    if v_kind like 'select%' or v_kind like 'with %' then
      execute 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (' || v_sql || ') t'
        into v_result;
    else
      execute v_sql;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        v_result := jsonb_build_array(jsonb_build_object('affected', v_rows));
      else
        v_result := '[]'::jsonb;
      end if;
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.mix_bind(text, jsonb) from public, anon, authenticated;
revoke all on function public.mix_literal(jsonb) from public, anon, authenticated;
grant execute on function public.mix_exec(text, jsonb) to service_role;
