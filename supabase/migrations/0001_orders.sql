-- ─────────────────────────────────────────────────────────────────────────────
-- Pedidos Hebennus — tablas + función transaccional + RLS
-- Ejecuta este SQL en tu proyecto Supabase (SQL Editor) o con `supabase db push`.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.orders (
  id             bigint generated always as identity primary key,
  order_number   text unique,
  customer_name  text not null,
  customer_phone text not null,
  customer_email text not null,
  notes          text,
  subtotal       numeric(10,2) not null,
  shipping       numeric(10,2) not null default 0,
  total          numeric(10,2) not null,
  status         text not null default 'pendiente',
  payment_method text not null default 'contraentrega',
  created_at     timestamptz not null default now()
);

create table if not exists public.order_items (
  id         bigint generated always as identity primary key,
  order_id   bigint not null references public.orders(id) on delete cascade,
  product_id text,
  name       text not null,
  size       text,
  color      text,
  qty        int not null check (qty > 0),
  unit_price numeric(10,2) not null,
  subtotal   numeric(10,2) not null
);

create index if not exists order_items_order_id_idx on public.order_items(order_id);

-- RLS activo y SIN políticas para anon: los clientes NO leen ni escriben pedidos
-- directamente. Solo la Edge Function (service_role) puede operar sobre estas tablas.
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- Inserción atómica de un pedido + sus ítems en una sola transacción.
-- Devuelve el número de pedido generado (ej. HB-000123).
create or replace function public.create_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id     bigint;
  v_order_number text;
  v_item         jsonb;
begin
  insert into public.orders
    (customer_name, customer_phone, customer_email, notes, subtotal, shipping, total)
  values (
    payload->'cliente'->>'customer_name',
    payload->'cliente'->>'customer_phone',
    payload->'cliente'->>'customer_email',
    payload->'cliente'->>'notes',
    (payload->>'subtotal')::numeric,
    (payload->>'shipping')::numeric,
    (payload->>'total')::numeric
  )
  returning id into v_order_id;

  v_order_number := 'HB-' || lpad(v_order_id::text, 6, '0');
  update public.orders set order_number = v_order_number where id = v_order_id;

  for v_item in select * from jsonb_array_elements(payload->'items')
  loop
    insert into public.order_items
      (order_id, product_id, name, size, color, qty, unit_price, subtotal)
    values (
      v_order_id,
      nullif(v_item->>'product_id', ''),
      v_item->>'name',
      v_item->>'size',
      v_item->>'color',
      (v_item->>'qty')::int,
      (v_item->>'unit_price')::numeric,
      (v_item->>'subtotal')::numeric
    );
  end loop;

  return jsonb_build_object('order_number', v_order_number, 'id', v_order_id);
end;
$$;
