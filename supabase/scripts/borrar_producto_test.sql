-- Quita el producto de prueba (S/1) para que nadie lo compre.
-- Borra el producto; su variante se elimina en cascada (FK on delete cascade).
-- order_items.product_id es TEXT (no FK) → el pedido de prueba no se rompe.
-- Ejecutar en el SQL Editor del proyecto PROD (Hebennus).

do $phase0_guard$
begin
  raise exception 'SCRIPT_CONGELADO: no ejecutar scripts manuales en producción; usa migraciones versionadas y db diff';
end
$phase0_guard$;

/* HISTÓRICO — mantenido solo como referencia; no ejecutar.
delete from public.products where slug = 'test-pago-1-sol';

-- Alternativa NO destructiva (si preferís solo ocultarlo y poder re-testear):
-- update public.products set is_active = false where slug = 'test-pago-1-sol';
*/
