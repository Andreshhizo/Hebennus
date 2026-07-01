-- ─────────────────────────────────────────────────────────────────────────────
-- Izipay — pagos online + stock diferido
--
-- 1) Columnas de pago en orders (payment_status / payment_provider / payment_txn_id).
-- 2) create_order: copia EXACTA de Sprint 1 (20260624130000) + 2 cambios:
--      a. payment_method tomado del payload (coalesce a 'contraentrega').
--      b. STOCK DIFERIDO: si payload.defer_stock = true, NO descuenta stock al
--         crear el pedido (el descuento se hará al confirmar el pago vía IPN).
-- 3) marcar_pedido_pagado(order_number, txn_id): IDEMPOTENTE. Confirma el pago,
--    pasa el pedido a 'pagado'/'confirmado' y descuenta stock atómicamente.
--    Si el pedido ya está 'pagado', no hace nada (evita doble descuento si la
--    notificación IPN se repite).
--
-- IDEMPOTENTE: add column if not exists + create or replace. Seguro de re-ejecutar.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1) Columnas de pago en orders ────────────────────────────────────────────
-- payment_status: pendiente | pagado | fallido
alter table public.orders add column if not exists payment_status   text not null default 'pendiente';
alter table public.orders add column if not exists payment_provider text;
alter table public.orders add column if not exists payment_txn_id   text;

-- ── 2) create_order: copia EXACTA de Sprint 1 + payment_method + stock diferido ─
create or replace function public.create_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id     bigint;
  v_order_number text;
  v_item         jsonb;
  v_qty          int;
  v_afectadas    int;
  v_defer        boolean := coalesce((payload->>'defer_stock')::boolean, false);
begin
  insert into public.orders (
    customer_name, customer_phone, customer_email, notes,
    subtotal, shipping, discount, discount_reason, total,
    user_id, comprobante_tipo, doc_tipo, doc_numero, razon_social,
    payment_method
  )
  values (
    payload->'cliente'->>'customer_name',
    payload->'cliente'->>'customer_phone',
    payload->'cliente'->>'customer_email',
    payload->'cliente'->>'notes',
    (payload->>'subtotal')::numeric,
    (payload->>'shipping')::numeric,
    coalesce((payload->>'discount')::numeric, 0),
    payload->>'discount_reason',
    (payload->>'total')::numeric,
    nullif(payload->>'user_id', '')::uuid,
    coalesce(payload->'cliente'->>'comprobante_tipo', 'boleta'),
    payload->'cliente'->>'doc_tipo',
    payload->'cliente'->>'doc_numero',
    payload->'cliente'->>'razon_social',
    coalesce(payload->>'payment_method', 'contraentrega')
  )
  returning id into v_order_id;

  v_order_number := 'HB-' || lpad(v_order_id::text, 6, '0');
  update public.orders set order_number = v_order_number where id = v_order_id;

  for v_item in select * from jsonb_array_elements(payload->'items')
  loop
    insert into public.order_items (order_id, product_id, name, size, color, qty, unit_price, subtotal)
    values (
      v_order_id,
      nullif(v_item->>'product_id', ''),
      v_item->>'name',
      v_item->>'size',
      v_item->>'color',
      (v_item->>'qty')::int,
      (v_item->>'unit_price')::numeric,
      (v_item->>'subtotal')::numeric
    );

    -- ── Descuento de stock atómico (DIFERIDO si defer_stock=true) ──────────────
    -- Si defer_stock=true, NO se descuenta aquí: se hará en marcar_pedido_pagado
    -- al confirmar el pago. Si false, se descuenta como en Sprint 1.
    if not v_defer then
      -- Solo si el item referencia una variante real (product_id válido).
      v_qty := (v_item->>'qty')::int;

      if nullif(v_item->>'product_id', '') is not null then
        update public.product_variants
           set stock = stock - v_qty
         where product_id = (v_item->>'product_id')::uuid
           and size  is not distinct from (v_item->>'size')
           and color is not distinct from nullif(v_item->>'color', '')
           and stock >= v_qty;
        get diagnostics v_afectadas = row_count;
        if v_afectadas = 0 then
          raise exception 'STOCK_INSUFICIENTE: %', coalesce(v_item->>'name', 'producto');
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object('order_number', v_order_number, 'id', v_order_id);
end;
$$;

-- Permisos: solo la Edge Function (service_role) ejecuta el RPC (igual que antes).
revoke execute on function public.create_order(jsonb) from public;
revoke execute on function public.create_order(jsonb) from anon, authenticated;
grant  execute on function public.create_order(jsonb) to service_role;

-- ── 3) marcar_pedido_pagado: confirmación de pago IDEMPOTENTE + descuento stock ─
create or replace function public.marcar_pedido_pagado(p_order_number text, p_txn_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id      bigint;
  v_payment_status text;
  v_item          public.order_items%rowtype;
  v_afectadas     int;
begin
  -- Buscar el pedido por order_number.
  select id, payment_status
    into v_order_id, v_payment_status
    from public.orders
   where order_number = p_order_number;

  if v_order_id is null then
    raise exception 'PEDIDO_NO_ENCONTRADO: %', p_order_number;
  end if;

  -- IDEMPOTENTE: si ya está pagado, no hacer nada (evita doble descuento si la
  -- notificación IPN llega repetida).
  if v_payment_status = 'pagado' then
    return jsonb_build_object(
      'order_number', p_order_number,
      'payment_status', 'pagado',
      'idempotent', true
    );
  end if;

  -- Confirmar el pago.
  update public.orders
     set payment_status   = 'pagado',
         status           = 'confirmado',
         payment_provider = 'izipay',
         payment_txn_id   = p_txn_id
   where id = v_order_id;

  -- Descuento de stock atómico por cada item (misma lógica que Sprint 1).
  for v_item in
    select * from public.order_items where order_id = v_order_id
  loop
    if nullif(v_item.product_id, '') is not null then
      update public.product_variants
         set stock = stock - v_item.qty
       where product_id = v_item.product_id::uuid
         and size  is not distinct from v_item.size
         and color is not distinct from nullif(v_item.color, '')
         and stock >= v_item.qty;
      get diagnostics v_afectadas = row_count;
      if v_afectadas = 0 then
        raise exception 'STOCK_INSUFICIENTE: %', coalesce(v_item.name, 'producto');
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'order_number', p_order_number,
    'payment_status', 'pagado',
    'status', 'confirmado',
    'idempotent', false
  );
end;
$$;

-- Permisos: solo la Edge Function (service_role) procesa la IPN de Izipay.
revoke execute on function public.marcar_pedido_pagado(text, text) from public;
revoke execute on function public.marcar_pedido_pagado(text, text) from anon, authenticated;
grant  execute on function public.marcar_pedido_pagado(text, text) to service_role;

commit;
