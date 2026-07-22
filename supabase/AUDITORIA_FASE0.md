# Auditoría Fase 0 (hardening de pagos/inventario/seguridad de Codex)

Revisión de solo lectura (2 microagentes) del trabajo SIN desplegar en la rama
`codex-fase0-seguridad-pagos`. `main`/prod NO fueron tocados.

## 🔴 CRÍTICO — bloquea el despliegue

**C1. El monto pagado mapea un campo que Izipay NO envía → rechaza el 100% de los pagos.**
- `supabase/functions/_shared/izipay-event.ts:87` usa `orderDetails.orderPaidAmount`,
  que **no existe** en Lyra/Izipay V4 (el campo real es `orderEffectiveAmount`).
- Efecto: `paid_amount_minor` queda SIEMPRE `NULL` → el RPC `process_izipay_payment_event`
  (migración `20260718120000...:592-597`) da `AMOUNT_MISMATCH` en todos los eventos.
- Impacto: el cliente paga, Izipay cobra, pero el pedido nunca pasa a `pagado`, no se
  descuenta stock ni se envía correo. Afecta TODOS los métodos.
- Fix: leer `orderEffectiveAmount` para `paid_amount_minor`. (`orderTotalAmount` y
  `transaction.amount` sí están bien mapeados.)
- ✅ **RESUELTO (2026-07-22):** `_shared/izipay-event.ts` ahora lee
  `orderDetails.orderEffectiveAmount` (interfaz + mapeo). Pendiente: confirmar el nombre
  contra un payload real de sandbox y re-desplegar `izipay-ipn` / `izipay-validate`.

## 🟠 ALTO

**A1. Regresión admin: la nueva RLS de `product_variants` oculta variantes de productos INACTIVOS al admin.**
- Migración `...:804-812` cambia la política a exigir `products.is_active = true`, y NO
  existe una `product_variants_admin_select`.
- Impacto: en `/admin`, un producto desactivado (fuera de temporada) devuelve
  `product_variants: []` → no se puede ver/editar su stock/tallas
  (`AdminProducts.vue`, `AdminProductEditor.vue`, `AdminDashboard.vue`).
- Fix: añadir política `product_variants_admin_select` con `is_admin()`.
- ✅ **RESUELTO (2026-07-22):** política `product_variants_admin_select`
  (`for select to authenticated using (public.is_admin())`) añadida a la migración
  `20260718120000_phase0...sql`. Pendiente: aplicar la migración en el SQL Editor.

**A2. Confirmar el string de `paymentMethodType` para Yape/QR.**
- `_shared/izipay-event.ts:58-63` (default `CARD,YAPE,QR`) + RPC `...:588-589`.
- Tarjeta = `CARD` (ok). El valor exacto para Yape/QR vía Izipay no está verificado; si
  difiere, esos pagos se rechazan (`PAYMENT_METHOD_NOT_ALLOWED`) aun tras arreglar C1.
- Acción: capturar un evento real de Yape o confirmar con Izipay antes de habilitar.

## 🟡 MEDIO

- **M1. Método NULL evade la lista blanca (fail-open puntual).** `...:588-589`: si
  `payment_method_type` es NULL, no se asigna error (a diferencia del resto, que usa
  `is distinct from`). Fix: `upper(coalesce(v_event.payment_method_type,''))`.
  Explotabilidad baja (requiere firma HMAC válida + resto de checks).
- **M2. El backfill del ledger asume descuento exacto para contraentrega antiguo.**
  `...:112-148`. `create_order` solo descuenta stock desde Sprint 1
  (`20260624130000`); pedidos contraentrega anteriores quedan registrados como
  "descontados" → al cancelarlos, `admin_set_order_status` repondría stock que nunca se
  descontó (inflado). Verificar en prod si hay `orders` contraentrega con `created_at`
  anterior a Sprint 1.
- **M3. `create_order` exige variante ÚNICA.** `...:369-378`. Si el catálogo tiene
  variantes duplicadas `(product_id,size,color)`, se bloquean pedidos contraentrega
  válidos. Fix: índice único de variantes (con color normalizado).
- **M4. Confirmar que `transaction.shopId` viene en el payload de Izipay Perú.**
  `_shared/izipay-event.ts:85` + RPC `...:583-584` exigen shop_id Y transaction_shop_id;
  si el segundo falta → `SHOP_MISMATCH` (rechazo total). Verificar con evento real.
- **M5. Rate-limit de la IPN por IP.** `izipay-ipn:190`: todas las IPN vienen del mismo
  servidor de Izipay → mismo bucket; en picos podría auto-throttlear (503 → más
  reintentos). Considerar exceptuar/afinar la IPN (la firma ya es la barrera real).

## 🟢 BAJO
- Fijar `IZIPAY_SHOP_ID` explícito (= `86755123`); hoy cae a `IZIPAY_USERNAME`
  (correcto porque el username ES el shopId, pero frágil).
- IPN ignora `kr-hash-key` (ok en la práctica; usa PASSWORD).
- `src/lib/izipay.js:84` fallback de `rawClientAnswer` (UX puntual, no rompe el pago).
- `ALLOWED_ORIGINS` por defecto no cubre previews `*.vercel.app`.
- `edge_rate_limits` sin limpieza de ventanas viejas (crecimiento de tabla).
- Bordes: 2 transacciones PAID en el array; flag de reconciliación se marca ancho para
  ítems legacy sin `product_id`.

## ✅ Revisado y CORRECTO
Idempotencia (orders/tickets/eventos), verificación HMAC (IPN=PASSWORD, validate=HMAC,
timing-safe), locks/races de transacción y reutilización de txn, reposición exacta desde
el ledger, bloqueo de reactivación, wiring durabilidad-primero del flujo Izipay,
`track-product-view` (UUID + rate-limit + RPC service-role).

## Veredicto
~~**NO desplegar** hasta arreglar **C1** (obligatorio — sin esto no entra ningún pago) y
**A1** (regresión de gestión de stock en admin).~~ ✅ **C1 y A1 corregidos en código
(2026-07-22).** Antes de desplegar a prod: aplicar la migración, re-desplegar
`izipay-ipn`/`izipay-validate`, y **confirmar A2/M4 con un evento real de Izipay**. El
resto son mejoras recomendadas, no bloqueantes.
