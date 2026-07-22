-- Estado de PAGO manual (solo Yape) — separa el ciclo de pago del ciclo logístico
-- (orders.status). Reutiliza la lógica probada del ledger de Fase 0:
--   • 'pagado'      → marcar_pedido_pagado (descuenta stock exacto + confirma, idempotente)
--   • 'reembolsado' → repone el stock exacto desde order_item_inventory y cancela el pedido
--   • 'pendiente'   → solo si aún no se cobró (no se "des-paga" un pedido pagado)
-- Idempotente / re-ejecutable: usa create or replace.

begin;

create or replace function public.admin_set_payment_status(p_order_number text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order     public.orders%rowtype;
  v_move      public.order_item_inventory%rowtype;
  v_remaining integer;
  v_held      boolean;
begin
  if not public.is_admin() then raise exception 'NO_AUTORIZADO'; end if;
  if p_status not in ('pendiente','pagado','reembolsado') then
    raise exception 'ESTADO_PAGO_INVALIDO: %', p_status;
  end if;

  select * into v_order from public.orders
   where order_number = p_order_number for update;
  if not found then raise exception 'PEDIDO_NO_ENCONTRADO: %', p_order_number; end if;

  -- El control manual de pago es solo para Yape manual; la tarjeta (izipay) la
  -- confirma el IPN server-to-server, no el admin.
  if v_order.payment_method <> 'yape_manual' then
    raise exception 'PAGO_MANUAL_SOLO_YAPE: %', p_order_number;
  end if;

  -- ── pagado: descuenta stock + confirma (delega en la RPC ya probada) ──────
  if p_status = 'pagado' then
    return public.marcar_pedido_pagado(p_order_number, null, 'yape');
  end if;

  -- ── reembolsado: repone stock exacto desde el ledger y cancela ────────────
  if p_status = 'reembolsado' then
    -- Solo hay stock que reponer si el pedido llegó a pagarse (Yape difiere stock).
    v_held := v_order.payment_status = 'pagado';
    if v_held and not coalesce(v_order.stock_restored, false) then
      if v_order.inventory_reconciliation_required or exists (
        select 1 from public.order_items oi
         where oi.order_id = v_order.id
           and not exists (
             select 1 from public.order_item_inventory oii where oii.order_item_id = oi.id
           )
      ) then
        raise exception 'INVENTARIO_LEGACY_REQUIERE_CONCILIACION: %', p_order_number;
      end if;

      for v_move in
        select * from public.order_item_inventory where order_id = v_order.id order by id for update
      loop
        v_remaining := v_move.deducted_qty - v_move.restored_qty;
        if v_remaining > 0 then
          if v_move.variant_id is null then
            raise exception 'VARIANTE_INVENTARIO_NO_RESUELTA: %', v_move.order_item_id;
          end if;
          update public.product_variants set stock = stock + v_remaining where id = v_move.variant_id;
          if not found then raise exception 'VARIANTE_INVENTARIO_NO_ENCONTRADA: %', v_move.variant_id; end if;
          update public.order_item_inventory
             set restored_qty = deducted_qty, updated_at = now()
           where id = v_move.id;
        end if;
      end loop;
    end if;

    -- Reembolso = terminal: pago reembolsado, stock repuesto y pedido cancelado.
    update public.orders
       set payment_status = 'reembolsado',
           stock_restored = v_held or coalesce(stock_restored, false),
           status = 'cancelado'
     where id = v_order.id;

    return jsonb_build_object(
      'order_number', p_order_number, 'payment_status', 'reembolsado',
      'status', 'cancelado', 'stock_restored', v_held or coalesce(v_order.stock_restored, false)
    );
  end if;

  -- ── pendiente: solo si aún no se cobró ────────────────────────────────────
  if v_order.payment_status = 'pagado' then
    raise exception 'NO_SE_PUEDE_REVERTIR_PAGO: %', p_order_number;
  end if;
  update public.orders set payment_status = 'pendiente' where id = v_order.id;
  return jsonb_build_object('order_number', p_order_number, 'payment_status', 'pendiente');
end;
$$;

revoke execute on function public.admin_set_payment_status(text, text) from public, anon;
grant  execute on function public.admin_set_payment_status(text, text) to authenticated, service_role;

commit;
