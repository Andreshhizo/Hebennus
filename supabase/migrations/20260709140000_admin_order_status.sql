-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint 3 — Gestión de estados de pedido con reconciliación de stock
--
-- 1) orders.stock_restored (bool): marca si ya se repuso el stock del pedido
--    (idempotencia: evita doble reposición y controla el re-descuento al reactivar).
-- 2) RPC admin_set_order_status(order_number, status): cambia el estado logístico
--    y reconcilia el stock:
--    - al cancelar/reembolsar un pedido que tenía stock tomado → REPONE stock.
--    - al reactivar un pedido que había repuesto stock → vuelve a DESCONTAR
--      (si no alcanza, lanza STOCK_INSUFICIENTE y aborta, no cambia el estado).
--    SECURITY DEFINER + gate is_admin(). NO toca payment_status (eso es de
--    admin_marcar_pagado / Izipay).
--
-- IDEMPOTENTE: add column if not exists + create or replace. Seguro de re-ejecutar.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

alter table public.orders add column if not exists stock_restored boolean not null default false;

create or replace function public.admin_set_order_status(p_order_number text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id        bigint;
  v_payment_status  text;
  v_payment_method  text;
  v_restored        boolean;
  v_held            boolean;
  v_item            public.order_items%rowtype;
  v_afectadas       int;
  v_did_restore     boolean := false;
  v_did_redecrement boolean := false;
  v_final_restored  boolean;
begin
  if not public.is_admin() then
    raise exception 'NO_AUTORIZADO';
  end if;

  if p_status not in ('pendiente','confirmado','enviado','entregado','cancelado','reembolsado') then
    raise exception 'ESTADO_INVALIDO: %', p_status;
  end if;

  select id, payment_status, payment_method, stock_restored
    into v_order_id, v_payment_status, v_payment_method, v_restored
    from public.orders
   where order_number = p_order_number;

  if v_order_id is null then
    raise exception 'PEDIDO_NO_ENCONTRADO: %', p_order_number;
  end if;

  -- ¿El pedido tenía stock tomado? (contraentrega descuenta al crear; el resto al pagar).
  v_held := (v_payment_method = 'contraentrega') or (v_payment_status = 'pagado');

  -- Cancelar / reembolsar → reponer stock (una sola vez).
  if p_status in ('cancelado','reembolsado') and v_held and not v_restored then
    for v_item in select * from public.order_items where order_id = v_order_id loop
      if nullif(v_item.product_id, '') is not null then
        update public.product_variants
           set stock = stock + v_item.qty
         where product_id = v_item.product_id::uuid
           and size  is not distinct from v_item.size
           and color is not distinct from nullif(v_item.color, '');
        -- best-effort: si la variante ya no existe, no falla (no se repone ese item).
      end if;
    end loop;
    v_did_restore := true;

  -- Reactivar un pedido que había repuesto stock → volver a descontar.
  elsif p_status not in ('cancelado','reembolsado') and v_restored then
    for v_item in select * from public.order_items where order_id = v_order_id loop
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
    v_did_redecrement := true;
  end if;

  v_final_restored := case
    when v_did_restore then true
    when v_did_redecrement then false
    else v_restored
  end;

  update public.orders
     set status = p_status,
         stock_restored = v_final_restored
   where id = v_order_id;

  return jsonb_build_object(
    'order_number', p_order_number,
    'status', p_status,
    'stock_restored', v_final_restored
  );
end;
$$;

revoke execute on function public.admin_set_order_status(text, text) from public, anon;
grant  execute on function public.admin_set_order_status(text, text) to authenticated, service_role;

commit;
