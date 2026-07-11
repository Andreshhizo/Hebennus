-- ─────────────────────────────────────────────────────────────────────────────
-- Categorías múltiples por producto (una prenda puede ser Sport Y Comfort).
--   1) products.categories text[] (además de la columna legacy `category`).
--   2) Backfill: categories = [category] para los productos existentes.
--   3) create_product acepta payload.categories (array) y las inserta; `category`
--      queda como la primera (compat con vistas que aún la muestran).
-- La edición desde el admin actualiza `categories` directo (RLS products_admin_update).
-- IDEMPOTENTE.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

alter table public.products add column if not exists categories text[] not null default '{}';

-- Backfill desde la columna legacy `category` (solo si categories está vacío).
update public.products
   set categories = array[category]
 where (categories is null or categories = '{}')
   and category is not null and category <> '';

create or replace function public.create_product(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name       text;
  v_price      numeric(10,2);
  v_id         uuid;
  v_variant    jsonb;
  v_count      int := 0;
  v_categories text[];
begin
  if not public.is_admin() then
    raise exception 'No autorizado';
  end if;

  v_name := trim(coalesce(payload->>'name', ''));
  if v_name = '' then raise exception 'El nombre es obligatorio'; end if;

  v_price := coalesce((payload->>'price')::numeric, 0);
  if v_price < 0 then raise exception 'El precio no puede ser negativo'; end if;

  if jsonb_typeof(payload->'variants') <> 'array'
     or jsonb_array_length(payload->'variants') = 0 then
    raise exception 'El producto debe tener al menos una variante';
  end if;

  v_categories := coalesce(
    (select array_agg(c) from jsonb_array_elements_text(coalesce(payload->'categories', '[]'::jsonb)) as c),
    '{}'::text[]
  );

  insert into public.products (
    name, slug, description, price, images, images_by_color,
    is_active, category, categories, tipo_prenda, is_launch, launch_order
  ) values (
    v_name,
    nullif(trim(coalesce(payload->>'slug', '')), ''),
    nullif(trim(coalesce(payload->>'description', '')), ''),
    v_price,
    coalesce((select array_agg(u) from jsonb_array_elements_text(coalesce(payload->'images', '[]'::jsonb)) as u), '{}'::text[]),
    case when jsonb_typeof(payload->'images_by_color') = 'object' then payload->'images_by_color' else null end,
    coalesce((payload->>'is_active')::boolean, true),
    coalesce(nullif(trim(coalesce(payload->>'category', '')), ''), v_categories[1]),
    v_categories,
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

commit;
