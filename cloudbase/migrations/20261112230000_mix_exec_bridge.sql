-- 1) mixmapp schema 内的原子下单函数（网关每次调用是单条语句）
create or replace function mixmapp.place_order(
  p_id             text,
  p_order_no       text,
  p_user_id        text,
  p_status         text,
  p_total_fen      integer,
  p_receiver_name  text,
  p_receiver_phone text,
  p_address        text,
  p_remark         text,
  p_created_at     timestamptz,
  p_paid_at        timestamptz,
  p_items          jsonb
) returns void
language plpgsql
security definer
set search_path = mixmapp, public
as $$
begin
  insert into orders (id, order_no, user_id, status, total_fen, receiver_name,
    receiver_phone, address, remark, created_at, paid_at)
  values (p_id, p_order_no, p_user_id, p_status, p_total_fen, p_receiver_name,
    p_receiver_phone, p_address, p_remark, p_created_at, p_paid_at);

  insert into order_items (id, order_id, product_id, title, price_fen, quantity, subtotal_fen)
  select x.id, x.order_id, x.product_id, x.title, x.price_fen, x.quantity, x.subtotal_fen
  from jsonb_to_recordset(p_items) as x(
    id text, order_id text, product_id text, title text,
    price_fen integer, quantity integer, subtotal_fen integer
  );
end;
$$;

-- 2) 服务端专用 SQL 桥：PostgREST RPC 只暴露给 service_role（API Key）
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
      v_sql := regexp_replace(v_sql, '\$' || (v_i + 1) || '\b', v_lit, 'g');
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

revoke all on function public.mix_exec(text, jsonb) from public, anon, authenticated;
grant execute on function public.mix_exec(text, jsonb) to service_role;
grant execute on function mixmapp.place_order(text,text,text,text,integer,text,text,text,text,timestamptz,timestamptz,jsonb) to service_role, authenticated;
