-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 1 — Datos: comprobante (boleta/factura), contactos de marketing y admin
--
-- Migración IDEMPOTENTE (segura de re-ejecutar). No borra ni altera datos.
-- Prepara el terreno para:
--   • Emisión de boleta/factura SUNAT (campos listos; la emisión se cablea luego).
--   • Base de clientes para marketing (con consentimiento — Ley 29733).
--   • Panel de administración (acceso vía RLS para usuarios admin).
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1) Campos de comprobante en `orders` (boleta-ready) ──────────────────────
-- Se capturan desde el checkout aunque la emisión fiscal aún no esté activa,
-- para no tener que migrar pedidos viejos cuando lleguen las credenciales SUNAT.
alter table public.orders add column if not exists comprobante_tipo   text not null default 'boleta';
alter table public.orders add column if not exists doc_tipo           text;   -- DNI | RUC | CE
alter table public.orders add column if not exists doc_numero         text;
alter table public.orders add column if not exists razon_social       text;   -- obligatorio si comprobante_tipo = 'factura'
alter table public.orders add column if not exists boleta_status      text not null default 'no_emitida'; -- no_emitida | pendiente | emitida | error
alter table public.orders add column if not exists boleta_url         text;   -- PDF/enlace que devuelve el proveedor
alter table public.orders add column if not exists boleta_external_id text;   -- id del comprobante en SUNAT/proveedor

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.orders'::regclass and conname = 'orders_comprobante_tipo_chk') then
    alter table public.orders add constraint orders_comprobante_tipo_chk
      check (comprobante_tipo in ('boleta','factura'));
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.orders'::regclass and conname = 'orders_boleta_status_chk') then
    alter table public.orders add constraint orders_boleta_status_chk
      check (boleta_status in ('no_emitida','pendiente','emitida','error'));
  end if;
end $$;

-- Índices para el panel admin (listar/filtrar/ordenar pedidos).
create index if not exists orders_status_idx     on public.orders(status);
create index if not exists orders_created_at_idx on public.orders(created_at desc);

-- ── 2) Contactos de marketing (con consentimiento explícito) ─────────────────
create table if not exists public.marketing_contacts (
  id              bigint generated always as identity primary key,
  email           text not null unique,
  name            text,
  phone           text,
  consent         boolean not null default false,    -- el cliente aceptó recibir promos
  consent_at      timestamptz,                       -- cuándo lo aceptó (prueba de consentimiento)
  source          text,                              -- 'checkout' | 'popup' | ...
  unsubscribed_at timestamptz,                       -- baja voluntaria
  created_at      timestamptz not null default now()
);

-- RLS activo. La inserción la hace la Edge Function (service_role, omite RLS).
-- Los anónimos NO pueden leer la lista de correos.
alter table public.marketing_contacts enable row level security;

-- ── 3) Identificación de administradores ─────────────────────────────────────
-- Un usuario es admin si su id está en esta tabla. Para dar de alta a alguien:
--   insert into public.admins (user_id) values ('<uuid del usuario en auth.users>');
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- ── 4) Políticas RLS para el panel admin ─────────────────────────────────────
-- anon sigue sin acceso a pedidos; solo usuarios autenticados que sean admin.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='orders' and policyname='orders_admin_select') then
    create policy orders_admin_select on public.orders
      for select to authenticated using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='orders' and policyname='orders_admin_update') then
    create policy orders_admin_update on public.orders
      for update to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='order_items' and policyname='order_items_admin_select') then
    create policy order_items_admin_select on public.order_items
      for select to authenticated using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='marketing_contacts' and policyname='mc_admin_select') then
    create policy mc_admin_select on public.marketing_contacts
      for select to authenticated using (public.is_admin());
  end if;

  -- Cada admin puede comprobar su propia membresía (necesario para is_admin desde el cliente).
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='admins' and policyname='admins_self_select') then
    create policy admins_self_select on public.admins
      for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

commit;
