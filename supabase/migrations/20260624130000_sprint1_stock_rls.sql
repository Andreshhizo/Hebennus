-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint 1 — Descuento de stock atómico + arreglo de fuga de pedidos por correo
--
-- 1) create_order ahora descuenta stock de la variante DENTRO de la misma
--    transacción. Si una variante no tiene stock suficiente, lanza excepción y
--    aborta TODO el pedido (no se inserta nada) → previene sobreventa.
-- 2) Las políticas RLS de cliente (orders / order_items) ya no exponen pedidos
--    de invitado por simple coincidencia de correo: ahora exigen que el correo
--    del JWT esté verificado (email_verified = true).
--
-- IDEMPOTENTE: create or replace + drop policy if exists. Seguro de re-ejecutar.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1) create_order: copia EXACTA de la versión actual (20260622170000) ───────
-- + descuento atómico de stock por variante dentro del bucle de items.
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
begin
  insert into public.orders (
    customer_name, customer_phone, customer_email, notes,
    subtotal, shipping, discount, discount_reason, total,
    user_id, comprobante_tipo, doc_tipo, doc_numero, razon_social
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
    payload->'cliente'->>'razon_social'
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

    -- ── Descuento de stock atómico ────────────────────────────────────────────
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
  end loop;

  return jsonb_build_object('order_number', v_order_number, 'id', v_order_id);
end;
$$;

-- Permisos: solo la Edge Function (service_role) ejecuta el RPC (igual que antes).
revoke execute on function public.create_order(jsonb) from public;
revoke execute on function public.create_order(jsonb) from anon, authenticated;
grant  execute on function public.create_order(jsonb) to service_role;

-- ── 2) RLS cliente: exigir correo VERIFICADO en la rama de email ──────────────
-- Antes: lower(customer_email) = lower(jwt email)  → cualquiera con ese correo en
-- el JWT (aunque no estuviera verificado) podía ver pedidos de invitado.
-- Ahora: además del user_id propio, se exige email_verified = true.

drop policy if exists orders_customer_select on public.orders;
create policy orders_customer_select on public.orders
  for select to authenticated
  using (
    user_id = auth.uid()
    OR (
      lower(customer_email) = lower(auth.jwt() ->> 'email')
      AND coalesce((auth.jwt() ->> 'email_verified'), 'false') = 'true'
    )
  );

drop policy if exists order_items_customer_select on public.order_items;
create policy order_items_customer_select on public.order_items
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (
          o.user_id = auth.uid()
          OR (
            lower(o.customer_email) = lower(auth.jwt() ->> 'email')
            AND coalesce((auth.jwt() ->> 'email_verified'), 'false') = 'true'
          )
        )
    )
  );

commit;
