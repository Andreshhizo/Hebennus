-- ─────────────────────────────────────────────────────────────────────────────
-- Cuentas de cliente — vincular pedidos a usuarios, profiles, RLS y descuento
--
-- Permite que cada cliente vea SUS pedidos (en curso / entregados / pasados),
-- guarda el 10% de bienvenida auditado, y crea un perfil al registrarse.
-- IDEMPOTENTE. RLS: cliente ve solo lo suyo; admin ve todo (ya existía).
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1) Vincular pedidos al usuario (NULL = compra de invitado) ────────────────
alter table public.orders add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists orders_user_id_idx on public.orders(user_id);

-- Descuento de bienvenida (auditado en el propio pedido).
alter table public.orders add column if not exists discount        numeric(10,2) not null default 0;
alter table public.orders add column if not exists discount_reason text;

-- ── 2) Perfil del cliente (datos para boleta/entrega) ────────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  phone      text,
  doc_tipo   text,   -- DNI | RUC | CE
  doc_numero text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Crear el perfil automáticamente al registrarse (toma nombre/teléfono del signup).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 3) RLS de profiles: cada quien gestiona SOLO su propio perfil ────────────
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_self_select') then
    create policy profiles_self_select on public.profiles for select to authenticated using (id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_self_update') then
    create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_self_insert') then
    create policy profiles_self_insert on public.profiles for insert to authenticated with check (id = auth.uid());
  end if;
end $$;

-- ── 4) RLS de pedidos para el CLIENTE: ve los suyos (por user_id o su correo) ─
-- (El admin ya tiene su política orders_admin_select de antes.)
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='orders_customer_select') then
    create policy orders_customer_select on public.orders for select to authenticated
      using ( user_id = auth.uid() or lower(customer_email) = lower(auth.jwt() ->> 'email') );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='order_items' and policyname='order_items_customer_select') then
    create policy order_items_customer_select on public.order_items for select to authenticated
      using ( exists (
        select 1 from public.orders o
        where o.id = order_items.order_id
          and ( o.user_id = auth.uid() or lower(o.customer_email) = lower(auth.jwt() ->> 'email') )
      ) );
  end if;
end $$;

-- ── 5) create_order: guarda user_id, descuento y datos de comprobante ────────
-- Se actualiza la función para registrar todo lo nuevo en una sola transacción.
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
  insert into public.orders (
    customer_name, customer_phone, customer_email, notes,
    subtotal, shipping, discount, discount_reason, total,
    user_id, comprobante_tipo, doc_tipo, doc_numero, razon_social
  )
  values (
    payload->'cliente'->>'customer_name',
    payload->'cliente'->>'customer_phone',
    payload->'cliente'->>'customer_email',
    payload->'cliente'->>'notes',
    (payload->>'subtotal')::numeric,
    (payload->>'shipping')::numeric,
    coalesce((payload->>'discount')::numeric, 0),
    payload->>'discount_reason',
    (payload->>'total')::numeric,
    nullif(payload->>'user_id', '')::uuid,
    coalesce(payload->'cliente'->>'comprobante_tipo', 'boleta'),
    payload->'cliente'->>'doc_tipo',
    payload->'cliente'->>'doc_numero',
    payload->'cliente'->>'razon_social'
  )
  returning id into v_order_id;

  v_order_number := 'HB-' || lpad(v_order_id::text, 6, '0');
  update public.orders set order_number = v_order_number where id = v_order_id;

  for v_item in select * from jsonb_array_elements(payload->'items')
  loop
    insert into public.order_items (order_id, product_id, name, size, color, qty, unit_price, subtotal)
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

-- ── 6) Solo la Edge Function (service_role) puede crear pedidos ───────────────
-- Cierra el vector de que alguien llame al RPC directo para auto-aplicarse el
-- descuento o falsear precios. Todo pedido pasa por el servidor.
-- Nota: hay que revocar de PUBLIC (anon/authenticated lo heredan de ahí) y
-- otorgar explícitamente a service_role.
revoke execute on function public.create_order(jsonb) from public;
revoke execute on function public.create_order(jsonb) from anon, authenticated;
grant  execute on function public.create_order(jsonb) to service_role;

commit;
