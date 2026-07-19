# Scripts SQL de un solo uso

Scripts SQL históricos de un solo uso. **No ejecutarlos en producción.** La única
fuente autorizada del esquema es `supabase/migrations/`, aplicada primero en
staging y reconciliada con `supabase db diff`.

A diferencia de `supabase/migrations/` (versionadas, idempotentes y aplicadas con
`npx supabase db push`), estos scripts son puntuales y no se aplican
automáticamente.

> ⚠️ `limpieza_final.sql` es **DESTRUCTIVO** (borra pedidos y reinicia la
> numeración). **No re-ejecutar.**

## Scripts congelados

Todos los `.sql` de este directorio son históricos y abortan intencionalmente.
No ejecutar ninguno en producción, aunque el contenido antiguo aparezca debajo
del guard de seguridad.

- **`fix_prod_orders_schema.sql`** — CONGELADO: aborta intencionalmente. No usar.
- **`borrar_producto_test.sql`** — CONGELADO: no borrar productos manualmente.
- **`test_product_1sol.sql`** — CONGELADO: no crear productos de prueba.
- **`limpieza_final.sql`** — CONGELADO: limpieza destructiva bloqueada.
- **`limpieza_final.sql`** — ⚠️ DESTRUCTIVO. Borra TODOS los pedidos de prueba,
  reinicia la numeración (el próximo pedido será `HB-000001`) y limpia
  `backup_old`. Ejecutar una sola vez sobre PROD sin clientes reales.
- **`test_product_1sol.sql`** — Crea un producto de PRUEBA de S/1 (con 1 variante
  talla "Única" y stock) para probar el flujo de pago. Borrar después del test.
- **`borrar_producto_test.sql`** — Elimina el producto de prueba de S/1 (`slug =
  test-pago-1-sol`); su variante se borra en cascada. Incluye alternativa no
  destructiva (marcarlo `is_active = false`) comentada.
