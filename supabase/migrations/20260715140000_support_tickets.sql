-- ─────────────────────────────────────────────────────────────────────────────
-- Reclamos / tickets de soporte Hebennus — tabla + RPCs + RLS
--
-- Migración IDEMPOTENTE (segura de re-ejecutar): begin;/commit;, create table
-- if not exists, índices if not exists, políticas con guard sobre pg_policies y
-- funciones con create or replace.
--
-- Diseño (espejo de `orders`):
--   • La tabla queda RLS-cerrada: los clientes NO leen ni escriben reclamos
--     directamente. La creación la hace la Edge Function create-ticket con
--     service_role (omite RLS) vía la RPC create_ticket.
--   • El panel admin (usuarios autenticados que sean admin) lee y actualiza los
--     reclamos gracias a las políticas *_admin_* con public.is_admin().
--
-- Ejecuta en Supabase (SQL Editor) o con `supabase db push`.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1) Tabla de reclamos ─────────────────────────────────────────────────────
create table if not exists public.support_tickets (
  id            bigint generated always as identity primary key,
  ticket_number text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  status        text not null default 'nuevo',
  name          text not null,
  email         text not null,
  phone         text,
  order_number  text,
  category      text,
  message       text not null,
  user_id       uuid,            -- opcional: vincula el reclamo a la cuenta si inició sesión
  admin_note    text             -- nota interna del panel admin
);

-- Índices para el panel admin (listar / filtrar / ordenar reclamos).
create index if not exists support_tickets_status_idx     on public.support_tickets(status);
create index if not exists support_tickets_created_at_idx  on public.support_tickets(created_at desc);

-- ── 2) RLS activo y SIN políticas para anon ──────────────────────────────────
-- Los clientes NO leen ni escriben reclamos directamente: solo la Edge Function
-- (service_role) crea filas vía create_ticket. El admin lee/actualiza vía las
-- políticas *_admin_* de abajo.
alter table public.support_tickets enable row level security;

-- ── 3) Políticas RLS para el panel admin ─────────────────────────────────────
-- anon sigue sin acceso; solo usuarios autenticados que sean admin.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='support_tickets' and policyname='support_tickets_admin_select') then
    create policy support_tickets_admin_select on public.support_tickets
      for select to authenticated using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='support_tickets' and policyname='support_tickets_admin_update') then
    create policy support_tickets_admin_update on public.support_tickets
      for update to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
end $$;

-- ── 4) Creación atómica de un reclamo ────────────────────────────────────────
-- `create or replace` refresca la función a esta versión aunque ya exista una
-- antigua desplegada. Devuelve el número de reclamo generado (ej. R-000123).
-- La llama la Edge Function create-ticket (service_role) tras validar el payload.
create or replace function public.create_ticket(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id            bigint;
  v_ticket_number text;
  v_name          text := payload->>'name';
  v_message       text := payload->>'message';
begin
  -- Validación mínima (defensa en profundidad; la Edge Function ya valida antes).
  if v_name is null or btrim(v_name) = '' then
    raise exception 'NOMBRE_REQUERIDO';
  end if;
  if v_message is null or btrim(v_message) = '' then
    raise exception 'MENSAJE_REQUERIDO';
  end if;

  insert into public.support_tickets
    (name, email, phone, order_number, category, message, user_id)
  values (
    v_name,
    payload->>'email',
    nullif(payload->>'phone', ''),
    nullif(payload->>'order_number', ''),
    nullif(payload->>'category', ''),
    v_message,
    nullif(payload->>'user_id', '')::uuid
  )
  returning id into v_id;

  v_ticket_number := 'R-' || lpad(v_id::text, 6, '0');
  update public.support_tickets set ticket_number = v_ticket_number where id = v_id;

  return jsonb_build_object('ticket_number', v_ticket_number, 'id', v_id);
end;
$$;

-- Solo el service_role (Edge Function) puede crear reclamos.
revoke execute on function public.create_ticket(jsonb) from public, anon;
grant  execute on function public.create_ticket(jsonb) to service_role;

-- ── 5) Cambio de estado del reclamo (panel admin) ────────────────────────────
-- Espejo de admin_set_order_status: SECURITY DEFINER + gate is_admin() + whitelist.
create or replace function public.admin_set_ticket_status(p_ticket_number text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_afectadas int;
begin
  if not public.is_admin() then
    raise exception 'NO_AUTORIZADO';
  end if;

  if p_status not in ('nuevo','en_proceso','resuelto','cerrado') then
    raise exception 'ESTADO_INVALIDO: %', p_status;
  end if;

  update public.support_tickets
     set status = p_status,
         updated_at = now()
   where ticket_number = p_ticket_number;

  get diagnostics v_afectadas = row_count;
  if v_afectadas = 0 then
    raise exception 'RECLAMO_NO_ENCONTRADO: %', p_ticket_number;
  end if;

  return jsonb_build_object('ticket_number', p_ticket_number, 'status', p_status);
end;
$$;

revoke execute on function public.admin_set_ticket_status(text, text) from public, anon;
grant  execute on function public.admin_set_ticket_status(text, text) to authenticated, service_role;

commit;
