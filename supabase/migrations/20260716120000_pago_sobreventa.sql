-- ─────────────────────────────────────────────────────────────────────────────
-- FIX H1 — Pago diferido / sobreventa: el pago SIEMPRE queda registrado
--
-- PROBLEMA (bug H1):
--   La versión efectiva de marcar_pedido_pagado
--   (supabase/migrations/20260626120000_yape_manual_admin_pago.sql:20-93) marcaba
--   primero payment_status='pagado' + status='confirmado' y LUEGO descontaba stock
--   en un loop. Si algún ítem no tenía stock suficiente hacía
--   `raise exception 'STOCK_INSUFICIENTE'`, lo que provocaba el ROLLBACK de toda la
--   transacción → se perdía el registro del pago aunque el dinero ya se había
--   cobrado (Izipay/Yape). Resultado: cliente pagó pero el pedido quedaba sin pagar.
--
-- SOLUCIÓN:
--   Nunca abortar por falta de stock. Se descuenta el stock que se pueda (ítem por
--   ítem, sin negativos gracias a `and stock >= qty`) y, si algún ítem no alcanzó,
--   se marca el pedido como sobreventa (oversold=true) dejándolo en estado
--   'pendiente' para que el admin lo gestione manualmente. El pago se registra
--   SIEMPRE (payment_status='pagado'), pase lo que pase con el inventario.
--
--   - Si TODO tenía stock  → oversold=false, status='confirmado'.
--   - Si faltó algún ítem  → oversold=true,  status='pendiente' (revisión admin).
--
-- IDEMPOTENTE: alter ... if not exists + create or replace. Seguro de re-ejecutar.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1) Marca de sobreventa en el pedido ──────────────────────────────────────
-- oversold = el pago se registró pero no se pudo descontar todo el stock.
alter table public.orders
  add column if not exists oversold boolean not null default false;

-- ── 2) marcar_pedido_pagado: registra el pago SIEMPRE (sin raise por stock) ───
create or replace function public.marcar_pedido_pagado(
  p_order_number text,
  p_txn_id       text default null,
  p_provider     text default 'izipay'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id        bigint;
  v_payment_status  text;
  v_oversold_actual boolean;   -- valor de oversold ya persistido (para idempotencia)
  v_item            public.order_items%rowtype;
  v_afectadas       int;
  v_oversold        boolean := false;  -- se vuelve true si algún ítem no tuvo stock
begin
  -- FOR UPDATE: bloquea la fila del pedido para SERIALIZAR llamadas concurrentes
  -- (izipay-validate desde el navegador + izipay-ipn servidor-a-servidor sobre el
  -- MISMO pedido). Sin este lock, ambas podrían pasar el chequeo de idempotencia y
  -- descontar stock dos veces. Con el lock, la 2.ª espera, re-lee 'pagado' y sale
  -- por la rama idempotente. `order_number` es UNIQUE → bloquea 1 fila exacta.
  select id, payment_status, oversold
    into v_order_id, v_payment_status, v_oversold_actual
    from public.orders
   where order_number = p_order_number
   for update;

  if v_order_id is null then
    raise exception 'PEDIDO_NO_ENCONTRADO: %', p_order_number;
  end if;

  -- IDEMPOTENTE: si ya está pagado, no hacer nada (evita doble descuento de stock).
  if v_payment_status = 'pagado' then
    return jsonb_build_object(
      'order_number', p_order_number,
      'payment_status', 'pagado',
      'idempotent', true,
      'oversold', coalesce(v_oversold_actual, false)
    );
  end if;

  -- Descuento de stock ítem por ítem, SIN raise. El `and stock >= v_item.qty`
  -- garantiza que el stock nunca quede negativo: si no alcanza, ese update no
  -- afecta filas (row_count = 0) y marcamos sobreventa, pero seguimos con el resto.
  for v_item in
    select * from public.order_items where order_id = v_order_id
  loop
    -- Guard de formato UUID: order_items.product_id es TEXT. Si trae un valor
    -- no-UUID, el cast ::uuid lanzaría y haría rollback de TODO el pago. Validamos
    -- el formato antes de castear para que el pago SIEMPRE quede registrado.
    if v_item.product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      update public.product_variants
         set stock = stock - v_item.qty
       where product_id = v_item.product_id::uuid
         and size  is not distinct from v_item.size
         and color is not distinct from nullif(v_item.color, '')
         and stock >= v_item.qty;
      get diagnostics v_afectadas = row_count;
      -- Sin stock para este ítem: NO abortamos, solo marcamos sobreventa.
      if v_afectadas = 0 then
        v_oversold := true;
      end if;
    end if;
  end loop;

  -- El pago se registra SIEMPRE (nunca llegamos aquí con un raise pendiente).
  -- Si hubo sobreventa, el pedido queda 'pendiente' para revisión del admin;
  -- si todo tuvo stock, queda 'confirmado'.
  update public.orders
     set payment_status   = 'pagado',
         payment_provider = coalesce(p_provider, 'izipay'),
         payment_txn_id   = p_txn_id,
         oversold         = v_oversold,
         status           = case when v_oversold then 'pendiente' else 'confirmado' end
   where id = v_order_id;

  return jsonb_build_object(
    'order_number', p_order_number,
    'payment_status', 'pagado',
    'status', case when v_oversold then 'pendiente' else 'confirmado' end,
    'idempotent', false,
    'oversold', v_oversold
  );
end;
$$;

-- Permisos: solo la Edge Function (service_role) procesa IPN/validate de Izipay.
-- Se mantienen EXACTAMENTE los mismos grants que la versión anterior, sobre la
-- misma firma (text, text, text). admin_marcar_pagado NO se redefine: sigue
-- llamando a este RPC y hereda el nuevo comportamiento sin cambios.
revoke execute on function public.marcar_pedido_pagado(text, text, text) from public;
revoke execute on function public.marcar_pedido_pagado(text, text, text) from anon, authenticated;
grant  execute on function public.marcar_pedido_pagado(text, text, text) to service_role;

commit;
