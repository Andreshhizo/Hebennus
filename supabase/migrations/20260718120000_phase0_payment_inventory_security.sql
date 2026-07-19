-- Phase 0 — contención de pagos, inventario, abuso e idempotencia.
--
-- Esta migración es deliberadamente fail-closed:
--   * una respuesta Izipay solo confirma un pedido después de validar en BD
--     comercio, monto, moneda, método, operación y transacción única;
--   * cada notificación firmada se persiste antes de procesarse;
--   * el stock descontado/restaurado queda registrado por order_item;
--   * pedidos legacy cuyo movimiento exacto no puede reconstruirse se bloquean
--     para reposición automática hasta conciliación manual;
--   * los endpoints públicos disponen de un rate-limit durable compartido;
--   * pedidos y tickets admiten idempotencia atómica.

begin;

-- ── 1. Eventos de pago durables ──────────────────────────────────────────────

create table if not exists public.payment_events (
  id                       uuid primary key default gen_random_uuid(),
  provider                 text not null,
  source                   text not null,
  event_key                text not null,
  signature_valid          boolean not null default false,
  raw_payload              text not null,
  payload                  jsonb,
  order_number             text,
  transaction_id           text,
  shop_id                  text,
  transaction_shop_id      text,
  order_amount_minor       bigint,
  paid_amount_minor        bigint,
  transaction_amount_minor bigint,
  order_currency           text,
  transaction_currency     text,
  payment_method_type      text,
  operation_type           text,
  provider_status          text,
  transaction_status       text,
  processing_status        text not null default 'received',
  attempts                 integer not null default 0,
  last_error               text,
  received_at              timestamptz not null default now(),
  processed_at             timestamptz,
  constraint payment_events_provider_check check (provider in ('izipay')),
  constraint payment_events_source_check check (source in ('callback', 'ipn')),
  constraint payment_events_processing_check
    check (processing_status in ('received', 'processing', 'processed', 'rejected', 'failed')),
  constraint payment_events_dedupe unique (provider, source, event_key)
);

create index if not exists payment_events_pending_idx
  on public.payment_events (processing_status, received_at)
  where processing_status in ('received', 'failed');
create index if not exists payment_events_order_idx
  on public.payment_events (order_number, received_at desc);
create index if not exists payment_events_transaction_idx
  on public.payment_events (transaction_id)
  where transaction_id is not null;

alter table public.payment_events enable row level security;
revoke all on table public.payment_events from public, anon, authenticated;
grant select, insert, update on table public.payment_events to service_role;

-- Una transacción del proveedor solo puede quedar asociada a un pedido.
do $$
begin
  if exists (
    select 1
      from public.orders
     where nullif(btrim(payment_txn_id), '') is not null
     group by payment_txn_id
    having count(*) > 1
  ) then
    raise exception 'PHASE0_DUPLICATE_PAYMENT_TXN: conciliar payment_txn_id antes de aplicar';
  end if;
end
$$;

create unique index if not exists orders_payment_txn_id_unique
  on public.orders (payment_txn_id)
  where nullif(btrim(payment_txn_id), '') is not null;

-- ── 2. Ledger exacto por ítem ────────────────────────────────────────────────

create table if not exists public.order_item_inventory (
  id             bigint generated always as identity primary key,
  order_id       bigint not null references public.orders(id) on delete cascade,
  order_item_id  bigint not null references public.order_items(id) on delete restrict,
  variant_id     uuid references public.product_variants(id) on delete restrict,
  requested_qty  integer not null check (requested_qty > 0),
  deducted_qty   integer not null default 0 check (deducted_qty >= 0),
  restored_qty   integer not null default 0 check (restored_qty >= 0),
  source         text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint order_item_inventory_item_unique unique (order_item_id),
  constraint order_item_inventory_deducted_check check (deducted_qty <= requested_qty),
  constraint order_item_inventory_restored_check check (restored_qty <= deducted_qty)
);

create index if not exists order_item_inventory_order_idx
  on public.order_item_inventory (order_id);

alter table public.order_item_inventory enable row level security;
revoke all on table public.order_item_inventory from public, anon, authenticated;
grant select, insert, update on table public.order_item_inventory to service_role;

alter table public.orders
  add column if not exists inventory_reconciliation_required boolean not null default false;

-- Backfill seguro: solo pedidos para los que la lógica histórica garantiza que
-- todos los ítems fueron descontados y cuya variante se resuelve sin ambigüedad.
insert into public.order_item_inventory (
  order_id, order_item_id, variant_id, requested_qty, deducted_qty, restored_qty, source
)
select
  oi.order_id,
  oi.id,
  resolved.id,
  oi.qty,
  oi.qty,
  case when coalesce(o.stock_restored, false) then oi.qty else 0 end,
  'legacy_safe_backfill'
from public.order_items oi
join public.orders o on o.id = oi.order_id
join lateral (
  select pv.id
    from public.product_variants pv
   where oi.product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and pv.product_id = oi.product_id::uuid
     and pv.size is not distinct from oi.size
     and pv.color is not distinct from nullif(oi.color, '')
   order by pv.id
   limit 1
) resolved on true
where (
    o.payment_method = 'contraentrega'
    or o.payment_status = 'pagado'
  )
  and coalesce(o.oversold, false) = false
  and 1 = (
    select count(*)
      from public.product_variants pv2
     where oi.product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and pv2.product_id = oi.product_id::uuid
       and pv2.size is not distinct from oi.size
       and pv2.color is not distinct from nullif(oi.color, '')
  )
on conflict (order_item_id) do nothing;

-- Todo pedido que históricamente tomó stock pero no pudo reconstruirse de forma
-- exacta requiere conciliación; la RPC admin bloqueará su reposición automática.
update public.orders o
   set inventory_reconciliation_required = true
 where (
    o.payment_method = 'contraentrega'
    or o.payment_status = 'pagado'
  )
   and exists (
     select 1
       from public.order_items oi
      where oi.order_id = o.id
        and not exists (
          select 1 from public.order_item_inventory oii where oii.order_item_id = oi.id
        )
   );

-- ── 3. Rate limit durable para Edge Functions ───────────────────────────────

create table if not exists public.edge_rate_limits (
  scope           text not null,
  identifier_hash text not null,
  window_start    timestamptz not null,
  request_count   integer not null default 1 check (request_count > 0),
  updated_at      timestamptz not null default now(),
  primary key (scope, identifier_hash, window_start)
);

alter table public.edge_rate_limits enable row level security;
revoke all on table public.edge_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.edge_rate_limits to service_role;

create or replace function public.consume_edge_rate_limit(
  p_scope text,
  p_identifier_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if nullif(btrim(p_scope), '') is null
     or nullif(btrim(p_identifier_hash), '') is null
     or p_limit < 1 or p_limit > 10000
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'RATE_LIMIT_CONFIG_INVALID';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.edge_rate_limits (scope, identifier_hash, window_start, request_count)
  values (p_scope, p_identifier_hash, v_window_start, 1)
  on conflict (scope, identifier_hash, window_start)
  do update set
    request_count = public.edge_rate_limits.request_count + 1,
    updated_at = now()
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke execute on function public.consume_edge_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_edge_rate_limit(text, text, integer, integer)
  to service_role;

-- ── 4. Idempotencia de pedidos y tickets ────────────────────────────────────

alter table public.orders add column if not exists idempotency_key_hash text;
alter table public.orders add column if not exists idempotency_request_hash text;
create unique index if not exists orders_idempotency_key_unique
  on public.orders (idempotency_key_hash)
  where idempotency_key_hash is not null;

alter table public.support_tickets add column if not exists idempotency_key_hash text;
alter table public.support_tickets add column if not exists idempotency_request_hash text;
create unique index if not exists support_tickets_idempotency_key_unique
  on public.support_tickets (idempotency_key_hash)
  where idempotency_key_hash is not null;

-- create_order mantiene la API jsonb existente, pero ahora registra exactamente
-- el movimiento inicial y resuelve reintentos concurrentes por clave.
create or replace function public.create_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id       bigint;
  v_order_number   text;
  v_item           jsonb;
  v_order_item_id  bigint;
  v_qty            integer;
  v_afectadas      integer;
  v_defer          boolean := coalesce((payload->>'defer_stock')::boolean, false);
  v_key             text := nullif(payload->>'idempotency_key_hash', '');
  v_request_hash    text := nullif(payload->>'idempotency_request_hash', '');
  v_existing_hash   text;
  v_existing_total  numeric;
  v_existing_disc   numeric;
  v_existing_method text;
  v_variant_id      uuid;
  v_variant_count   integer;
begin
  if jsonb_typeof(payload->'items') is distinct from 'array'
     or jsonb_array_length(payload->'items') < 1
     or jsonb_array_length(payload->'items') > 20 then
    raise exception 'ITEMS_INVALIDOS';
  end if;
  if v_key is not null and v_request_hash is null then
    raise exception 'IDEMPOTENCY_REQUEST_HASH_REQUIRED';
  end if;

  if v_key is not null then
    select id, order_number, idempotency_request_hash, total, discount, payment_method
      into v_order_id, v_order_number, v_existing_hash, v_existing_total,
           v_existing_disc, v_existing_method
      from public.orders
     where idempotency_key_hash = v_key;
    if found then
      if v_existing_hash is distinct from v_request_hash then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
      return jsonb_build_object(
        'order_number', v_order_number, 'id', v_order_id, 'total', v_existing_total,
        'discount', coalesce(v_existing_disc, 0), 'payment_method', v_existing_method,
        'replayed', true
      );
    end if;
  end if;

  begin
    insert into public.orders (
      customer_name, customer_phone, customer_email, notes,
      subtotal, shipping, discount, discount_reason, total,
      user_id, comprobante_tipo, doc_tipo, doc_numero, razon_social,
      payment_method, idempotency_key_hash, idempotency_request_hash
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
      coalesce(payload->>'payment_method', 'contraentrega'),
      v_key,
      v_request_hash
    )
    returning id into v_order_id;
  exception when unique_violation then
    if v_key is null then
      raise;
    end if;
    select id, order_number, idempotency_request_hash, total, discount, payment_method
      into v_order_id, v_order_number, v_existing_hash, v_existing_total,
           v_existing_disc, v_existing_method
      from public.orders
     where idempotency_key_hash = v_key;
    if not found then
      raise;
    end if;
    if v_existing_hash is distinct from v_request_hash then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'order_number', v_order_number, 'id', v_order_id, 'total', v_existing_total,
      'discount', coalesce(v_existing_disc, 0), 'payment_method', v_existing_method,
      'replayed', true
    );
  end;

  v_order_number := 'HB-' || lpad(v_order_id::text, 6, '0');
  update public.orders set order_number = v_order_number where id = v_order_id;

  for v_item in select * from jsonb_array_elements(payload->'items')
  loop
    v_qty := (v_item->>'qty')::integer;
    if v_qty < 1 or v_qty > 50 then
      raise exception 'CANTIDAD_INVALIDA';
    end if;

    insert into public.order_items
      (order_id, product_id, name, size, color, qty, unit_price, subtotal)
    values (
      v_order_id,
      nullif(v_item->>'product_id', ''),
      v_item->>'name',
      v_item->>'size',
      v_item->>'color',
      v_qty,
      (v_item->>'unit_price')::numeric,
      (v_item->>'subtotal')::numeric
    )
    returning id into v_order_item_id;

    if not v_defer then
      if coalesce(v_item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'PRODUCTO_INVALIDO';
      end if;

      select count(*), (array_agg(pv.id order by pv.id))[1]
        into v_variant_count, v_variant_id
        from public.product_variants pv
       where pv.product_id = (v_item->>'product_id')::uuid
         and pv.size is not distinct from (v_item->>'size')
         and pv.color is not distinct from nullif(v_item->>'color', '');

      if v_variant_count <> 1 then
        raise exception 'VARIANTE_NO_UNICA: %', coalesce(v_item->>'name', 'producto');
      end if;

      update public.product_variants
         set stock = stock - v_qty
       where id = v_variant_id and stock >= v_qty;
      get diagnostics v_afectadas = row_count;
      if v_afectadas = 0 then
        raise exception 'STOCK_INSUFICIENTE: %', coalesce(v_item->>'name', 'producto');
      end if;

      insert into public.order_item_inventory (
        order_id, order_item_id, variant_id, requested_qty, deducted_qty, source
      ) values (
        v_order_id, v_order_item_id, v_variant_id, v_qty, v_qty, 'order_create'
      );
    end if;
  end loop;

  return jsonb_build_object(
    'order_number', v_order_number, 'id', v_order_id,
    'total', (payload->>'total')::numeric,
    'discount', coalesce((payload->>'discount')::numeric, 0),
    'payment_method', coalesce(payload->>'payment_method', 'contraentrega'),
    'replayed', false
  );
end;
$$;

revoke execute on function public.create_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_order(jsonb) to service_role;

create or replace function public.create_ticket(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id            bigint;
  v_ticket_number text;
  v_key           text := nullif(payload->>'idempotency_key_hash', '');
  v_request_hash  text := nullif(payload->>'idempotency_request_hash', '');
  v_existing_hash text;
begin
  if nullif(btrim(payload->>'name'), '') is null then raise exception 'NOMBRE_REQUERIDO'; end if;
  if nullif(btrim(payload->>'message'), '') is null then raise exception 'MENSAJE_REQUERIDO'; end if;
  if v_key is not null and v_request_hash is null then raise exception 'IDEMPOTENCY_REQUEST_HASH_REQUIRED'; end if;

  if v_key is not null then
    select id, ticket_number, idempotency_request_hash
      into v_id, v_ticket_number, v_existing_hash
      from public.support_tickets where idempotency_key_hash = v_key;
    if found then
      if v_existing_hash is distinct from v_request_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      return jsonb_build_object('ticket_number', v_ticket_number, 'id', v_id, 'replayed', true);
    end if;
  end if;

  begin
    insert into public.support_tickets (
      name, email, phone, order_number, category, message, user_id,
      idempotency_key_hash, idempotency_request_hash
    ) values (
      payload->>'name', payload->>'email', nullif(payload->>'phone', ''),
      nullif(payload->>'order_number', ''), nullif(payload->>'category', ''),
      payload->>'message', nullif(payload->>'user_id', '')::uuid,
      v_key, v_request_hash
    ) returning id into v_id;
  exception when unique_violation then
    if v_key is null then raise; end if;
    select id, ticket_number, idempotency_request_hash
      into v_id, v_ticket_number, v_existing_hash
      from public.support_tickets where idempotency_key_hash = v_key;
    if not found then raise; end if;
    if v_existing_hash is distinct from v_request_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('ticket_number', v_ticket_number, 'id', v_id, 'replayed', true);
  end;

  v_ticket_number := 'R-' || lpad(v_id::text, 6, '0');
  update public.support_tickets set ticket_number = v_ticket_number where id = v_id;
  return jsonb_build_object('ticket_number', v_ticket_number, 'id', v_id, 'replayed', false);
end;
$$;

revoke execute on function public.create_ticket(jsonb) from public, anon, authenticated;
grant execute on function public.create_ticket(jsonb) to service_role;

-- ── 5. Asignación exacta y procesamiento validado de Izipay ─────────────────

create or replace function public.phase0_allocate_order_inventory(
  p_order_id bigint,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item          public.order_items%rowtype;
  v_variant_id    uuid;
  v_variant_count integer;
  v_afectadas     integer;
  v_deducted      integer;
  v_oversold      boolean := false;
begin
  for v_item in
    select * from public.order_items where order_id = p_order_id order by id
  loop
    if exists (select 1 from public.order_item_inventory where order_item_id = v_item.id) then
      if exists (
        select 1 from public.order_item_inventory
         where order_item_id = v_item.id and deducted_qty < requested_qty
      ) then
        v_oversold := true;
      end if;
      continue;
    end if;

    v_variant_id := null;
    v_variant_count := 0;
    v_deducted := 0;

    if coalesce(v_item.product_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select count(*), (array_agg(pv.id order by pv.id))[1]
        into v_variant_count, v_variant_id
        from public.product_variants pv
       where pv.product_id = v_item.product_id::uuid
         and pv.size is not distinct from v_item.size
         and pv.color is not distinct from nullif(v_item.color, '');
    end if;

    if v_variant_count = 1 then
      update public.product_variants
         set stock = stock - v_item.qty
       where id = v_variant_id and stock >= v_item.qty;
      get diagnostics v_afectadas = row_count;
      if v_afectadas = 1 then v_deducted := v_item.qty; end if;
    end if;

    if v_deducted <> v_item.qty then v_oversold := true; end if;

    insert into public.order_item_inventory (
      order_id, order_item_id, variant_id, requested_qty, deducted_qty, source
    ) values (
      p_order_id, v_item.id, v_variant_id, v_item.qty, v_deducted, p_source
    );
  end loop;

  return jsonb_build_object('oversold', v_oversold);
end;
$$;

revoke execute on function public.phase0_allocate_order_inventory(bigint, text)
  from public, anon, authenticated;
grant execute on function public.phase0_allocate_order_inventory(bigint, text)
  to service_role;

create or replace function public.process_izipay_payment_event(
  p_event_id uuid,
  p_expected_shop_id text,
  p_allowed_payment_methods text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event           public.payment_events%rowtype;
  v_order           public.orders%rowtype;
  v_expected_amount bigint;
  v_error            text;
  v_allocation       jsonb;
  v_oversold         boolean;
  v_other_order      text;
begin
  select * into v_event
    from public.payment_events
   where id = p_event_id
   for update;

  if not found then raise exception 'PAYMENT_EVENT_NOT_FOUND'; end if;

  if v_event.processing_status = 'processed' then
    return jsonb_build_object(
      'accepted', true, 'idempotent', true, 'oversold', false,
      'order_number', v_event.order_number
    );
  end if;

  update public.payment_events
     set processing_status = 'processing', attempts = attempts + 1, last_error = null
   where id = p_event_id;

  select * into v_order
    from public.orders
   where order_number = v_event.order_number
   for update;

  if not found then v_error := 'ORDER_NOT_FOUND';
  elsif v_event.signature_valid is not true then v_error := 'INVALID_SIGNATURE';
  elsif v_event.provider_status is distinct from 'PAID' then v_error := 'ORDER_NOT_PAID';
  elsif v_event.transaction_status is distinct from 'PAID' then v_error := 'TRANSACTION_NOT_PAID';
  elsif nullif(v_event.transaction_id, '') is null then v_error := 'TRANSACTION_ID_REQUIRED';
  elsif v_event.shop_id is distinct from p_expected_shop_id
     or v_event.transaction_shop_id is distinct from p_expected_shop_id then v_error := 'SHOP_MISMATCH';
  elsif v_event.order_currency is distinct from 'PEN'
     or v_event.transaction_currency is distinct from 'PEN' then v_error := 'CURRENCY_MISMATCH';
  elsif v_event.operation_type is distinct from 'DEBIT' then v_error := 'OPERATION_MISMATCH';
  elsif coalesce(array_length(p_allowed_payment_methods, 1), 0) = 0
     or not (upper(v_event.payment_method_type) = any(p_allowed_payment_methods)) then v_error := 'PAYMENT_METHOD_NOT_ALLOWED';
  elsif v_order.payment_method is distinct from 'izipay' then v_error := 'ORDER_PAYMENT_METHOD_MISMATCH';
  else
    v_expected_amount := round(v_order.total * 100)::bigint;
    if v_event.order_amount_minor is distinct from v_expected_amount
       or v_event.paid_amount_minor is distinct from v_expected_amount
       or v_event.transaction_amount_minor is distinct from v_expected_amount then
      v_error := 'AMOUNT_MISMATCH';
    end if;
  end if;

  if v_error is null then
    select order_number into v_other_order
      from public.orders
     where payment_txn_id = v_event.transaction_id
       and id <> v_order.id
     limit 1;
    if found then v_error := 'TRANSACTION_ALREADY_USED'; end if;
  end if;

  if v_error is not null then
    update public.payment_events
       set processing_status = 'rejected', last_error = v_error
     where id = p_event_id;
    return jsonb_build_object(
      'accepted', false, 'idempotent', false, 'error', v_error,
      'order_number', v_event.order_number
    );
  end if;

  if v_order.payment_status = 'pagado' then
    if nullif(v_order.payment_txn_id, '') is not null
       and v_order.payment_txn_id is distinct from v_event.transaction_id then
      update public.payment_events
         set processing_status = 'rejected', last_error = 'ORDER_HAS_DIFFERENT_TRANSACTION'
       where id = p_event_id;
      return jsonb_build_object(
        'accepted', false, 'idempotent', false,
        'error', 'ORDER_HAS_DIFFERENT_TRANSACTION', 'order_number', v_event.order_number
      );
    end if;

    update public.orders
       set payment_txn_id = coalesce(nullif(payment_txn_id, ''), v_event.transaction_id),
           payment_provider = 'izipay'
     where id = v_order.id;
    update public.payment_events
       set processing_status = 'processed', processed_at = now(), last_error = null
     where id = p_event_id;
    return jsonb_build_object(
      'accepted', true, 'idempotent', true,
      'oversold', coalesce(v_order.oversold, false),
      'order_number', v_event.order_number
    );
  end if;

  v_allocation := public.phase0_allocate_order_inventory(v_order.id, 'izipay_payment');
  v_oversold := coalesce((v_allocation->>'oversold')::boolean, false);

  update public.orders
     set payment_status = 'pagado',
         payment_provider = 'izipay',
         payment_txn_id = v_event.transaction_id,
         oversold = v_oversold,
         status = case when v_oversold then 'pendiente' else 'confirmado' end,
         inventory_reconciliation_required = false
   where id = v_order.id;

  update public.payment_events
     set processing_status = 'processed', processed_at = now(), last_error = null
   where id = p_event_id;

  return jsonb_build_object(
    'accepted', true, 'idempotent', false, 'oversold', v_oversold,
    'order_number', v_event.order_number
  );
end;
$$;

revoke execute on function public.process_izipay_payment_event(uuid, text, text[])
  from public, anon, authenticated;
grant execute on function public.process_izipay_payment_event(uuid, text, text[])
  to service_role;

-- El RPC manual queda para pagos verificados por el administrador (Yape manual).
-- Los pedidos Izipay solo pueden pasar por process_izipay_payment_event.
create or replace function public.marcar_pedido_pagado(
  p_order_number text,
  p_txn_id text default null,
  p_provider text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_allocation jsonb;
  v_oversold boolean;
begin
  select * into v_order from public.orders
   where order_number = p_order_number for update;
  if not found then raise exception 'PEDIDO_NO_ENCONTRADO: %', p_order_number; end if;
  if v_order.payment_method = 'izipay' then raise exception 'IZIPAY_REQUIERE_EVENTO_VALIDADO'; end if;
  if v_order.payment_status = 'pagado' then
    return jsonb_build_object(
      'order_number', p_order_number, 'payment_status', 'pagado',
      'idempotent', true, 'oversold', coalesce(v_order.oversold, false)
    );
  end if;

  v_allocation := public.phase0_allocate_order_inventory(v_order.id, 'manual_payment');
  v_oversold := coalesce((v_allocation->>'oversold')::boolean, false);

  update public.orders
     set payment_status = 'pagado', payment_provider = coalesce(p_provider, 'manual'),
         payment_txn_id = nullif(p_txn_id, ''), oversold = v_oversold,
         status = case when v_oversold then 'pendiente' else 'confirmado' end,
         inventory_reconciliation_required = false
   where id = v_order.id;

  return jsonb_build_object(
    'order_number', p_order_number, 'payment_status', 'pagado',
    'status', case when v_oversold then 'pendiente' else 'confirmado' end,
    'idempotent', false, 'oversold', v_oversold
  );
end;
$$;

revoke execute on function public.marcar_pedido_pagado(text, text, text)
  from public, anon, authenticated;
grant execute on function public.marcar_pedido_pagado(text, text, text) to service_role;

-- ── 6. Reposición exacta; legacy ambiguo bloqueado ───────────────────────────

create or replace function public.admin_set_order_status(p_order_number text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order          public.orders%rowtype;
  v_move           public.order_item_inventory%rowtype;
  v_held           boolean;
  v_remaining      integer;
  v_final_restored boolean;
begin
  if not public.is_admin() then raise exception 'NO_AUTORIZADO'; end if;
  if p_status not in ('pendiente','confirmado','enviado','entregado','cancelado','reembolsado') then
    raise exception 'ESTADO_INVALIDO: %', p_status;
  end if;

  select * into v_order from public.orders
   where order_number = p_order_number for update;
  if not found then raise exception 'PEDIDO_NO_ENCONTRADO: %', p_order_number; end if;

  v_held := v_order.payment_method = 'contraentrega' or v_order.payment_status = 'pagado';
  v_final_restored := coalesce(v_order.stock_restored, false);

  if p_status in ('cancelado', 'reembolsado') and v_held and not v_final_restored then
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
    v_final_restored := true;
  elsif p_status not in ('cancelado', 'reembolsado') and v_final_restored then
    -- Contención temporal: no re-descontar hasta que Fase 1 modele ciclos de
    -- reserva/reposición explícitos en el ledger.
    raise exception 'REACTIVACION_BLOQUEADA_FASE0: %', p_order_number;
  end if;

  update public.orders
     set status = p_status, stock_restored = v_final_restored
   where id = v_order.id;

  return jsonb_build_object(
    'order_number', p_order_number, 'status', p_status,
    'stock_restored', v_final_restored
  );
end;
$$;

revoke execute on function public.admin_set_order_status(text, text) from public, anon;
grant execute on function public.admin_set_order_status(text, text) to authenticated, service_role;

-- Tracking deja de ser invocable directamente: la Edge Function rate-limited
-- track-product-view será la única entrada pública.
revoke execute on function public.log_product_view(uuid) from public, anon, authenticated;
grant execute on function public.log_product_view(uuid) to service_role;

-- Las variantes heredan la visibilidad del producto padre. La política histórica
-- usaba `using (true)`, lo que exponía tallas/SKUs de productos desactivados.
drop policy if exists product_variants_public_read on public.product_variants;
create policy product_variants_public_read on public.product_variants
  for select to anon, authenticated
  using (exists (
    select 1
      from public.products p
     where p.id = product_variants.product_id
       and p.is_active = true
  ));

commit;
