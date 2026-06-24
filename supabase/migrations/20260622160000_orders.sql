-- ─────────────────────────────────────────────────────────────────────────────
-- Pedidos Hebennus — tablas + función transaccional + RLS
--
-- Migración IDEMPOTENTE y AUTORREPARABLE: segura de re-ejecutar y diseñada para
-- arreglar bases de datos donde la tabla `orders` se creó con un esquema anterior
-- (le faltaban order_number / subtotal / shipping / payment_method).
--
-- Importante: `create table if not exists` NO modifica una tabla que ya existe,
-- así que las columnas que falten se agregan abajo con `alter table ... add column
-- if not exists`. Eso repara el esquema sin borrar ningún pedido existente.
--
-- Ejecuta en Supabase (SQL Editor) o con `supabase db push`.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1) Tablas (para una BD nueva) ────────────────────────────────────────────
create table if not exists public.orders (
  id             bigint generated always as identity primary key,
  order_number   text,
  customer_name  text not null,
  customer_phone text not null,
  customer_email text not null,
  notes          text,
  subtotal       numeric(10,2),
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

-- ── 2) Autorreparación del esquema (BD existente con tabla incompleta) ────────
-- Agrega solo las columnas que falten. No toca las que ya están ni sus datos.
alter table public.orders add column if not exists order_number   text;
alter table public.orders add column if not exists subtotal       numeric(10,2);
alter table public.orders add column if not exists shipping       numeric(10,2) not null default 0;
alter table public.orders add column if not exists payment_method text not null default 'contraentrega';
alter table public.orders add column if not exists status         text not null default 'pendiente';
alter table public.orders add column if not exists notes          text;

-- ── 3) Backfill de pedidos ya existentes ─────────────────────────────────────
-- subtotal: si quedó vacío en filas antiguas, derivarlo de total - shipping
-- (acotado a >= 0 por seguridad).
update public.orders
   set subtotal = greatest(coalesce(total, 0) - coalesce(shipping, 0), 0)
 where subtotal is null;

-- order_number: generar HB-000123 a partir del id para filas que no lo tengan.
update public.orders
   set order_number = 'HB-' || lpad(id::text, 6, '0')
 where order_number is null;

-- ── 4) Restricciones (una vez los datos están completos) ─────────────────────
alter table public.orders alter column subtotal set not null;

-- order_number único — idempotente (no falla si la restricción ya existe).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname  = 'orders_order_number_key'
  ) then
    alter table public.orders add constraint orders_order_number_key unique (order_number);
  end if;
end $$;

create index if not exists order_items_order_id_idx on public.order_items(order_id);

-- ── 5) RLS activo y SIN políticas para anon ──────────────────────────────────
-- Los clientes NO leen ni escriben pedidos directamente: solo la Edge Function
-- (service_role) puede operar sobre estas tablas.
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- ── 6) Inserción atómica de un pedido + sus ítems en una sola transacción ─────
-- `create or replace` refresca la función a esta versión aunque ya exista una
-- antigua desplegada. Devuelve el número de pedido generado (ej. HB-000123).
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

commit;
