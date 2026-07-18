-- Quita el producto de prueba (S/1) para que nadie lo compre.
-- Borra el producto; su variante se elimina en cascada (FK on delete cascade).
-- order_items.product_id es TEXT (no FK) → el pedido de prueba no se rompe.
-- Ejecutar en el SQL Editor del proyecto PROD (Hebennus).

delete from public.products where slug = 'test-pago-1-sol';

-- Alternativa NO destructiva (si preferís solo ocultarlo y poder re-testear):
-- update public.products set is_active = false where slug = 'test-pago-1-sol';
