-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint 2 — Gestión de productos desde /admin
--
-- 1) RPC atómica create_product(payload jsonb): crea un producto + sus variantes
--    en una sola transacción. SECURITY DEFINER + gate public.is_admin().
-- 2) Policies RLS de INSERT/DELETE en product_variants para el admin (agregar/
--    quitar tallas/colores de productos existentes). La edición de campos de
--    products y el toggle is_active ya los cubre products_admin_update.
-- 3) Bucket de Storage 'product-images' (lectura pública, escritura solo admin)
--    para subir fotos desde el panel en vez de pegar URLs.
--
-- IDEMPOTENTE: create or replace + guards sobre pg_policies + on conflict.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1) RPC atómica: crear producto + variantes ───────────────────────────────
create or replace function public.create_product(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name    text;
  v_price   numeric(10,2);
  v_id      uuid;
  v_variant jsonb;
  v_count   int := 0;
begin
  -- Solo admin.
  if not public.is_admin() then
    raise exception 'No autorizado';
  end if;

  v_name := trim(coalesce(payload->>'name', ''));
  if v_name = '' then
    raise exception 'El nombre es obligatorio';
  end if;

  v_price := coalesce((payload->>'price')::numeric, 0);
  if v_price < 0 then
    raise exception 'El precio no puede ser negativo';
  end if;

  if jsonb_typeof(payload->'variants') <> 'array'
     or jsonb_array_length(payload->'variants') = 0 then
    raise exception 'El producto debe tener al menos una variante';
  end if;

  insert into public.products (
    name, slug, description, price, images, images_by_color,
    is_active, category, tipo_prenda, is_launch, launch_order
  ) values (
    v_name,
    nullif(trim(coalesce(payload->>'slug', '')), ''),
    nullif(trim(coalesce(payload->>'description', '')), ''),
    v_price,
    coalesce(
      (select array_agg(u) from jsonb_array_elements_text(coalesce(payload->'images', '[]'::jsonb)) as u),
      '{}'::text[]
    ),
    case when jsonb_typeof(payload->'images_by_color') = 'object'
         then payload->'images_by_color' else null end,
    coalesce((payload->>'is_active')::boolean, true),
    nullif(trim(coalesce(payload->>'category', '')), ''),
    nullif(trim(coalesce(payload->>'tipo_prenda', '')), ''),
    coalesce((payload->>'is_launch')::boolean, false),
    nullif(payload->>'launch_order', '')::int
  )
  returning id into v_id;

  for v_variant in select * from jsonb_array_elements(payload->'variants')
  loop
    if trim(coalesce(v_variant->>'size', '')) = '' then
      raise exception 'Cada variante debe tener talla';
    end if;
    insert into public.product_variants (product_id, sku, size, color, stock)
    values (
      v_id,
      nullif(trim(coalesce(v_variant->>'sku', '')), ''),
      trim(v_variant->>'size'),
      nullif(trim(coalesce(v_variant->>'color', '')), ''),
      greatest(0, coalesce((v_variant->>'stock')::int, 0))
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('id', v_id, 'variants', v_count);
end;
$$;

grant execute on function public.create_product(jsonb) to authenticated;

-- ── 2) RLS: admin puede INSERT/DELETE variantes de productos existentes ───────
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='product_variants' and policyname='product_variants_admin_insert') then
    create policy product_variants_admin_insert on public.product_variants
      for insert to authenticated with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='product_variants' and policyname='product_variants_admin_delete') then
    create policy product_variants_admin_delete on public.product_variants
      for delete to authenticated using (public.is_admin());
  end if;
end $$;

-- ── 3) Bucket de Storage para fotos de producto ──────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images', 'product-images', true, 5242880,
  array['image/jpeg','image/png','image/webp','image/avif','image/gif']
)
on conflict (id) do nothing;

do $$
begin
  -- Lectura pública (el bucket es público; el catálogo muestra las fotos a todos).
  if not exists (select 1 from pg_policies where schemaname='storage'
                 and tablename='objects' and policyname='product_images_public_read') then
    create policy product_images_public_read on storage.objects
      for select to anon, authenticated using (bucket_id = 'product-images');
  end if;

  -- Escritura (subir): solo admin.
  if not exists (select 1 from pg_policies where schemaname='storage'
                 and tablename='objects' and policyname='product_images_admin_write') then
    create policy product_images_admin_write on storage.objects
      for insert to authenticated
      with check (bucket_id = 'product-images' and public.is_admin());
  end if;

  -- Actualizar: solo admin.
  if not exists (select 1 from pg_policies where schemaname='storage'
                 and tablename='objects' and policyname='product_images_admin_update') then
    create policy product_images_admin_update on storage.objects
      for update to authenticated
      using (bucket_id = 'product-images' and public.is_admin());
  end if;

  -- Borrar: solo admin.
  if not exists (select 1 from pg_policies where schemaname='storage'
                 and tablename='objects' and policyname='product_images_admin_delete') then
    create policy product_images_admin_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'product-images' and public.is_admin());
  end if;
end $$;

commit;
