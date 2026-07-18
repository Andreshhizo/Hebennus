-- ═══════════════════════════════════════════════════════════════════════
-- LIMPIEZA FINAL — borrar pedidos de prueba + reiniciar numeración + backup_old
-- Ejecutar en el SQL Editor del proyecto PROD (Hebennus). NO hay clientes reales.
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- 1) Borrar TODOS los pedidos (son todos de prueba/diagnóstico).
--    order_items se borra solo (FK on delete cascade).
delete from public.orders;

-- 2) Reiniciar la numeración → el PRÓXIMO pedido (el primer real) será HB-000001.
alter table public.orders alter column id restart with 1;

-- 3) Borrar las tablas viejas rotas (backup del fix de esquema uuid→bigint).
--    El pago ya está verificado con el esquema nuevo, así que no se necesitan.
--    ⚠️ Si preferís conservarlas un tiempo más como red de seguridad,
--       borrá (comentá) esta línea y la corrés más adelante.
drop schema if exists backup_old cascade;

commit;
