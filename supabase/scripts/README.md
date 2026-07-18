# Scripts SQL de un solo uso

Scripts SQL de un solo uso (deploy / limpieza / pruebas). **NO son migraciones.**
Ejecutar manualmente en el **SQL Editor** del proyecto (Supabase) si aplica.

A diferencia de `supabase/migrations/` (versionadas, idempotentes y aplicadas con
`npx supabase db push`), estos scripts son puntuales y no se aplican
automáticamente.

> ⚠️ `limpieza_final.sql` es **DESTRUCTIVO** (borra pedidos y reinicia la
> numeración). **No re-ejecutar.**

## Scripts

- **`fix_prod_orders_schema.sql`** — Fix PROD: mueve las tablas `orders` /
  `order_items` con esquema viejo a un schema `backup_old` (no destructivo) para
  liberar los nombres en `public` y poder recrearlas limpias con
  `deploy_prod_consolidado.sql`.
- **`limpieza_final.sql`** — ⚠️ DESTRUCTIVO. Borra TODOS los pedidos de prueba,
  reinicia la numeración (el próximo pedido será `HB-000001`) y limpia
  `backup_old`. Ejecutar una sola vez sobre PROD sin clientes reales.
- **`test_product_1sol.sql`** — Crea un producto de PRUEBA de S/1 (con 1 variante
  talla "Única" y stock) para probar el flujo de pago. Borrar después del test.
- **`borrar_producto_test.sql`** — Elimina el producto de prueba de S/1 (`slug =
  test-pago-1-sol`); su variante se borra en cascada. Incluye alternativa no
  destructiva (marcarlo `is_active = false`) comentada.
