-- 修正 SQL 桥的参数替换：PostgreSQL 正则里 \b 不是单词边界，改用降序字面替换
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

  v_kind := lower(substring(btrim(v_sql) from 1 for 6));
  if v_kind like 'select%' or v_kind like 'with %' then
    execute 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (' || v_sql || ') t' into v_result;
  else
    execute v_sql;
    v_result := '[]'::jsonb;
  end if;
  return v_result;
end;
$$;
