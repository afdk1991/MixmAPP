-- SQL 桥补上 DML 语义：带 RETURNING 的写语句按 CTE 收集返回行，
-- 普通写语句返回 affected 行数（供 PgStore 判断条件更新是否命中）。
create or replace function public.mix_exec(p_sql text, p_params jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, mixmapp
as $$
declare
  v_sql    text := p_sql;
  v_i      int;
  v_item   jsonb;
  v_lit    text;
  v_result jsonb;
  v_kind   text;
  v_rows   bigint;
begin
  if v_sql is null or btrim(v_sql) = '' then
    raise exception 'empty sql';
  end if;

  if p_params is not null then
    for v_i in reverse (jsonb_array_length(p_params) - 1)..0 loop
      v_item := p_params -> v_i;
      case jsonb_typeof(v_item)
        when 'string'  then v_lit := quote_literal(v_item #>> '{}');
        when 'number'  then v_lit := v_item #>> '{}';
        when 'boolean' then v_lit := v_item #>> '{}';
        when 'null'    then v_lit := 'NULL';
        else                v_lit := quote_literal(v_item::text) || '::jsonb';
      end case;
      v_sql := replace(v_sql, '$' || (v_i + 1), v_lit);
    end loop;
  end if;

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
