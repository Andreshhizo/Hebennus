-- ═══════════════════════════════════════════════════════════════════════
-- FIX PROD — orders/order_items tenían esquema viejo (id uuid, sin product_id)
-- incompatible con el código (espera id bigint + order_items.product_id text).
-- Síntoma: create-order 500 → 'invalid input syntax for type bigint: "<uuid>"'.
--
-- HISTÓRICO: antes movía las tablas a backup_old y luego dependía del consolidado.
-- Ese procedimiento quedó obsoleto y está bloqueado por el guard de abajo.
--
-- Ejecutar en el SQL Editor del proyecto PROD (Hebennus / lvodqgscealzkjywhyas).
-- ═══════════════════════════════════════════════════════════════════════

-- CONGELADO EN FASE 0. Este procedimiento puede separar tablas productivas del
-- esquema activo y ya no representa el historial real de migraciones.
do $phase0_guard$
begin
  raise exception 'SCRIPT_CONGELADO: usa migraciones versionadas + db diff; no ejecutar en producción';
end
$phase0_guard$;

/*
   HISTORICAL CONTENT RETAINED FOR REFERENCE ONLY. The guard above is terminal;
   all former ALTER TABLE statements stay commented so an SQL runner that
   continues after an error cannot move or overwrite production tables.
*/
/*
create schema if not exists backup_old;

-- Mover order_items primero (tiene FK a orders), luego orders.
alter table if exists public.order_items set schema backup_old;
alter table if exists public.orders      set schema backup_old;

-- Verificación: en public NO deberían existir; en backup_old SÍ.
-- select table_schema, table_name from information_schema.tables
--   where table_name in ('orders','order_items') order by 1;
*/
