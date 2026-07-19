# Política de despliegue de producción

Desde la Fase 0, `supabase/migrations/` es la única fuente autorizada del esquema.

- No ejecutar `deploy_prod_consolidado.sql` ni scripts de `supabase/scripts/`.
- No pegar SQL manual en producción.
- Probar `supabase db reset` y `supabase db push --dry-run` en un entorno aislado.
- Comparar staging/producción con `supabase db diff` antes de promover cambios.
- Crear backup y procedimiento de reversión antes de cada migración productiva.
- Desplegar Edge Functions después de la migración de la que dependen.
- Mantener ausentes `izipay-token` e `izipay-formtoken-test`.

Orden de la Fase 0:

1. Backup y preflight de transacciones duplicadas.
2. Migración `20260718120000_phase0_payment_inventory_security.sql`.
3. Edge Functions públicas y de pagos.
4. Configuración de IPN y secrets.
5. Smoke tests firmados en sandbox.
6. Frontend con `VITE_IZIPAY_ENABLED=true`.
