-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 4 — Campañas de marketing (email masivo vía Resend)
--
-- Migración IDEMPOTENTE (segura de re-ejecutar): begin;/commit;, add column if
-- not exists, create index if not exists, guards sobre pg_constraint / pg_policies.
-- No borra ni altera datos existentes.
--
-- Añade a `marketing_contacts` un token de baja (para el enlace "Darme de baja"
-- y la cabecera List-Unsubscribe) y crea la tabla `campaigns` con el registro de
-- cada envío. El envío real lo hace la Edge Function admin-enviar-campana
-- (service_role); el panel admin solo lee (política *_admin_select).
--
-- ⚠️ IMPORTANTE (privacidad / Ley 29733):
--   El upsert de create-order (onConflict='email') NO toca `unsubscribed_at`, así
--   que una baja se conserva aunque el mismo cliente vuelva a comprar. La query de
--   envío filtra SIEMPRE por `consent = true AND unsubscribed_at IS NULL`, de modo
--   que quien se dio de baja no vuelve a recibir correos aunque re-compre.
--
-- Ejecuta en Supabase (SQL Editor) o con `supabase db push`.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1) Token de baja por contacto ────────────────────────────────────────────
-- Un UUID por contacto que va en el enlace de baja y en la cabecera
-- List-Unsubscribe. Se autogenera para las filas existentes (default).
alter table public.marketing_contacts
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

-- Único: cada token identifica a un solo contacto (baja por token → 1 fila).
create unique index if not exists marketing_contacts_unsub_token_idx
  on public.marketing_contacts(unsubscribe_token);

-- Índice parcial para el conteo/selección de destinatarios del envío
-- (consent = true AND unsubscribed_at IS NULL). Acelera "¿a cuántos les llega?".
create index if not exists marketing_contacts_envio_idx
  on public.marketing_contacts(consent) where unsubscribed_at is null;

-- ── 2) Registro de campañas enviadas ─────────────────────────────────────────
create table if not exists public.campaigns (
  id               bigint generated always as identity primary key,
  subject          text not null,      -- asunto del correo
  title            text,               -- título mostrado en el cuerpo
  body             text,               -- texto plano del cuerpo (sin HTML crudo)
  cta_text         text,               -- etiqueta del botón (opcional)
  cta_url          text,               -- enlace del botón (opcional)
  status           text not null default 'enviada',  -- 'enviada' | 'error'
  recipients_count int  not null default 0,          -- destinatarios elegibles
  sent_count       int  not null default 0,          -- entregados a Resend OK
  failed_count     int  not null default 0,          -- lotes/correos que fallaron
  created_by       uuid,               -- admin que disparó el envío (auth.users)
  created_at       timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.campaigns'::regclass and conname = 'campaigns_status_chk') then
    alter table public.campaigns add constraint campaigns_status_chk
      check (status in ('enviada','error'));
  end if;
end $$;

-- ── 3) RLS: el admin solo lee; el INSERT lo hace la Edge Function (service_role,
--     omite RLS), por eso no hace falta política de INSERT ─────────────────────
alter table public.campaigns enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='campaigns' and policyname='campaigns_admin_select') then
    create policy campaigns_admin_select on public.campaigns
      for select to authenticated using (public.is_admin());
  end if;
end $$;

commit;
