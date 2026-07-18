-- ═══════════════════════════════════════════════════════════════════════
-- Producto de PRUEBA para test de pago (S/1). Borrar después del test.
-- Crea el producto + 1 variante (talla "Única", sin color) con stock.
-- Ejecutar en el SQL Editor del proyecto PROD (Hebennus).
-- ═══════════════════════════════════════════════════════════════════════

with new_product as (
  insert into public.products
    (name, slug, description, price, is_active, category, tipo_prenda, images)
  values (
    'TEST — Pago de prueba (S/1)',
    'test-pago-1-sol',
    'Producto temporal para probar el pago con tarjeta. Borrar después del test.',
    1.00, true, 'Sport', 'polo',
    array['https://lvodqgscealzkjywhyas.supabase.co/storage/v1/object/public/productos/polo-compresion/poloblanco1.webp']
  )
  returning id
)
insert into public.product_variants (product_id, size, color, stock)
select id, 'Única', null, 20 from new_product
returning product_id, size, color, stock;
