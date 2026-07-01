-- ─────────────────────────────────────────────────────────────────────────────
-- Yape manual (WhatsApp) + confirmación de pago por el admin
--
-- 1) marcar_pedido_pagado: ahora acepta p_provider (antes 'izipay' fijo) para
--    poder confirmar también pagos por Yape ('yape'). Sigue IDEMPOTENTE y con
--    descuento de stock atómico. Las llamadas con 2 args (IPN/validate) siguen
--    funcionando: p_provider toma su valor por defecto 'izipay'.
-- 2) admin_marcar_pagado(order_number): wrapper SECURITY DEFINER que verifica
--    is_admin() y luego confirma el pago derivando el provider del payment_method
--    del pedido (yape_manual → 'yape'). Permite al dueño marcar pagado un pedido
--    Yape manual desde /admin SIN abrir el RPC sensible a todo 'authenticated'.
--
-- IDEMPOTENTE: drop if exists + create or replace. Seguro de re-ejecutar.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1) marcar_pedido_pagado con provider parametrizable ──────────────────────
-- Cambia la firma (agrega p_provider con default) → hay que DROP la versión vieja.
drop function if exists public.marcar_pedido_pagado(text, text);

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
  v_order_id       bigint;
  v_payment_status text;
  v_item           public.order_items%rowtype;
  v_afectadas      int;
begin
  select id, payment_status
    into v_order_id, v_payment_status
    from public.orders
   where order_number = p_order_number;

  if v_order_id is null then
    raise exception 'PEDIDO_NO_ENCONTRADO: %', p_order_number;
  end if;

  -- IDEMPOTENTE: si ya está pagado, no hacer nada (evita doble descuento).
  if v_payment_status = 'pagado' then
    return jsonb_build_object(
      'order_number', p_order_number,
      'payment_status', 'pagado',
      'idempotent', true
    );
  end if;

  update public.orders
     set payment_status   = 'pagado',
         status           = 'confirmado',
         payment_provider = coalesce(p_provider, 'izipay'),
         payment_txn_id   = p_txn_id
   where id = v_order_id;

  -- Descuento de stock atómico por cada item.
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

-- Permisos: solo la Edge Function (service_role) procesa IPN/validate de Izipay.
revoke execute on function public.marcar_pedido_pagado(text, text, text) from public;
revoke execute on function public.marcar_pedido_pagado(text, text, text) from anon, authenticated;
grant  execute on function public.marcar_pedido_pagado(text, text, text) to service_role;

-- ── 2) admin_marcar_pagado: wrapper que solo pueden usar los admins ──────────
create or replace function public.admin_marcar_pagado(p_order_number text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_method   text;
  v_provider text;
begin
  -- Frontera de seguridad: solo administradores.
  if not public.is_admin() then
    raise exception 'NO_AUTORIZADO';
  end if;

  -- Provider derivado del método de pago del pedido.
  select payment_method into v_method
    from public.orders
   where order_number = p_order_number;

  v_provider := case
    when v_method = 'yape_manual' then 'yape'
    when v_method = 'izipay'      then 'izipay'
    else coalesce(v_method, 'manual')
  end;

  return public.marcar_pedido_pagado(p_order_number, null, v_provider);
end;
$$;

-- El wrapper SÍ se concede a 'authenticated' porque valida is_admin() por dentro.
revoke execute on function public.admin_marcar_pagado(text) from public, anon;
grant  execute on function public.admin_marcar_pagado(text) to authenticated, service_role;

commit;
