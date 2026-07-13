-- ─────────────────────────────────────────────────────────────────────────────
-- product_views — tracking de vistas de la ficha de producto (métricas del panel)
--
-- La ESCRITURA es pública pero solo vía la RPC `log_product_view` (anon +
-- authenticated). La LECTURA es solo del admin, agregada, vía `admin_product_views`.
-- La tabla queda CERRADA por RLS (sin políticas para anon/authenticated): nadie
-- lee ni inserta filas directamente; todo pasa por las RPC SECURITY DEFINER.
--
-- No guardamos datos personales: solo el producto y la marca de tiempo. La
-- deduplicación por sesión la hace el frontend (una vista por producto/sesión),
-- así que `views` ≈ sesiones únicas que abrieron la ficha.
-- IDEMPOTENTE: seguro de re-ejecutar.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

create table if not exists public.product_views (
  id         bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists product_views_product_id_idx on public.product_views(product_id);
create index if not exists product_views_created_at_idx  on public.product_views(created_at);

alter table public.product_views enable row level security;
-- Sin políticas: la tabla no es accesible directamente por anon/authenticated.

-- ── Registrar una vista (público) ────────────────────────────────────────────
-- SECURITY DEFINER: inserta aunque la tabla esté cerrada por RLS. Valida que el
-- producto exista y esté activo, para no acumular basura desde llamadas sueltas.
create or replace function public.log_product_view(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_product_id is null then
    return;
  end if;
  if not exists (select 1 from public.products where id = p_product_id and is_active = true) then
    return;
  end if;
  insert into public.product_views (product_id) values (p_product_id);
end;
$$;

revoke execute on function public.log_product_view(uuid) from public;
grant  execute on function public.log_product_view(uuid) to anon, authenticated;

-- ── Agregación para el panel (solo admin) ────────────────────────────────────
-- Top productos por vistas en el rango [p_desde, p_hasta). NULL en cualquiera de
-- los dos extremos = sin límite por ese lado. Devuelve nombre para el ranking.
create or replace function public.admin_product_views(
  p_desde timestamptz default null,
  p_hasta timestamptz default null,
  p_limit int default 20
)
returns table (product_id uuid, name text, views bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NO_AUTORIZADO';
  end if;
  return query
    select pv.product_id, p.name, count(*)::bigint as views
    from public.product_views pv
    join public.products p on p.id = pv.product_id
    where (p_desde is null or pv.created_at >= p_desde)
      and (p_hasta is null or pv.created_at <  p_hasta)
    group by pv.product_id, p.name
    order by views desc
    limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$$;

revoke execute on function public.admin_product_views(timestamptz, timestamptz, int) from public;
grant  execute on function public.admin_product_views(timestamptz, timestamptz, int) to authenticated;

-- ── Total de vistas en el rango (para la tasa de conversión) ─────────────────
-- Devuelve el conteo total de vistas de producto en [p_desde, p_hasta). El panel
-- lo cruza con los pedidos del período para estimar la conversión.
create or replace function public.admin_product_views_total(
  p_desde timestamptz default null,
  p_hasta timestamptz default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint;
begin
  if not public.is_admin() then
    raise exception 'NO_AUTORIZADO';
  end if;
  select count(*)::bigint into v_total
  from public.product_views pv
  where (p_desde is null or pv.created_at >= p_desde)
    and (p_hasta is null or pv.created_at <  p_hasta);
  return coalesce(v_total, 0);
end;
$$;

revoke execute on function public.admin_product_views_total(timestamptz, timestamptz) from public;
grant  execute on function public.admin_product_views_total(timestamptz, timestamptz) to authenticated;

commit;
