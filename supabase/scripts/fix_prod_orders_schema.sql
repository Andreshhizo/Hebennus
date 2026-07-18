-- ═══════════════════════════════════════════════════════════════════════
-- FIX PROD — orders/order_items tenían esquema viejo (id uuid, sin product_id)
-- incompatible con el código (espera id bigint + order_items.product_id text).
-- Síntoma: create-order 500 → 'invalid input syntax for type bigint: "<uuid>"'.
--
-- PASO A (este archivo): mueve las tablas rotas a un schema backup_old (NO
--   destructivo — conserva datos, índices y constraints, y libera los nombres
--   en public para poder recrearlas limpias).
-- PASO B: volver a ejecutar supabase/deploy_prod_consolidado.sql, que recreará
--   public.orders / public.order_items con el esquema correcto.
--
-- Ejecutar en el SQL Editor del proyecto PROD (Hebennus / lvodqgscealzkjywhyas).
-- ═══════════════════════════════════════════════════════════════════════

create schema if not exists backup_old;

-- Mover order_items primero (tiene FK a orders), luego orders.
alter table if exists public.order_items set schema backup_old;
alter table if exists public.orders      set schema backup_old;

-- Verificación: en public NO deberían existir; en backup_old SÍ.
-- select table_schema, table_name from information_schema.tables
--   where table_name in ('orders','order_items') order by 1;
