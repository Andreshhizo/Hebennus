-- ─────────────────────────────────────────────────────────────────────────────
-- Inventario admin — imágenes por color + RLS de gestión para el admin
--
-- 1) products.images_by_color (jsonb): galería separada por color de variante.
--    Forma: {"Negro":["url1","url2"],"Blanco":["url3"]} (claves = product_variants.color)
-- 2) RLS para que el admin (public.is_admin()) gestione el inventario:
--    - vea TODOS los productos (incluso inactivos)
--    - actualice products y product_variants
--    (no se agregan políticas de insert/delete por ahora)
-- 3) Backfill del polo: separa las URLs existentes por patrón (blanco/negro).
--
-- IDEMPOTENTE: add column if not exists + guards sobre pg_policies + backfill
-- condicionado a que images_by_color esté vacío. Seguro de re-ejecutar.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1) Nueva columna: galería por color ──────────────────────────────────────
alter table public.products add column if not exists images_by_color jsonb;

-- ── 2) RLS de gestión para el admin ──────────────────────────────────────────
do $$
begin
  -- El admin ve TODOS los productos, incluso los inactivos (la política pública
  -- products_public_read solo expone is_active = true).
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='products' and policyname='products_admin_select') then
    create policy products_admin_select on public.products
      for select to authenticated using (public.is_admin());
  end if;

  -- El admin puede actualizar productos (precio, estado, imágenes por color, etc.).
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='products' and policyname='products_admin_update') then
    create policy products_admin_update on public.products
      for update to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;

  -- El admin puede actualizar variantes (stock, sku, etc.).
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='product_variants' and policyname='product_variants_admin_update') then
    create policy product_variants_admin_update on public.product_variants
      for update to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
end $$;

-- ── 3) Backfill del polo: separar la galería por patrón de URL ────────────────
-- Solo si images_by_color aún está vacío (null o {}). Re-ejecutar no sobrescribe.
update public.products set images_by_color = jsonb_build_object(
  'Blanco', (select coalesce(jsonb_agg(img), '[]'::jsonb) from unnest(images) img where img ilike '%blanco%'),
  'Negro',  (select coalesce(jsonb_agg(img), '[]'::jsonb) from unnest(images) img where img ilike '%negro%')
)
where id = '8e3da963-85af-41a7-b89e-c1f15f3aa72c'
  and (images_by_color is null or images_by_color = '{}'::jsonb);

commit;
