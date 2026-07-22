import { sha256Hex } from './security.ts'

export interface IzipayTransaction {
  shopId?: string
  uuid?: string
  amount?: number
  currency?: string
  paymentMethodType?: string
  status?: string
  operationType?: string
}

export interface IzipayAnswer {
  shopId?: string
  orderStatus?: string
  orderDetails?: {
    orderId?: string
    orderTotalAmount?: number
    orderEffectiveAmount?: number
    orderCurrency?: string
  }
  transactions?: IzipayTransaction[]
}

export interface PaymentEventResult {
  accepted?: boolean
  idempotent?: boolean
  oversold?: boolean
  order_number?: string
  error?: string
}

function finiteInteger(value: unknown): number | null {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

export function parseIzipayAnswer(raw: string): IzipayAnswer {
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('IZIPAY_ANSWER_INVALID')
  }
  return parsed as IzipayAnswer
}

function paidTransaction(answer: IzipayAnswer): IzipayTransaction | null {
  const paid = (Array.isArray(answer.transactions) ? answer.transactions : [])
    .filter((transaction) => transaction?.status === 'PAID')
  return paid.length === 1 ? paid[0] : null
}

export function expectedShopId(): string {
  const shopId = (Deno.env.get('IZIPAY_SHOP_ID') ?? Deno.env.get('IZIPAY_USERNAME') ?? '').trim()
  if (!shopId) throw new Error('IZIPAY_SHOP_ID_NOT_CONFIGURED')
  return shopId
}

export function allowedPaymentMethods(): string[] {
  const configured = Deno.env.get('IZIPAY_ALLOWED_PAYMENT_METHODS') ?? 'CARD,YAPE,QR'
  const methods = configured.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean)
  if (!methods.length) throw new Error('IZIPAY_ALLOWED_PAYMENT_METHODS_EMPTY')
  return [...new Set(methods)]
}

export async function persistIzipayEvent(
  admin: any,
  source: 'callback' | 'ipn',
  rawPayload: string,
  answer: IzipayAnswer,
): Promise<string> {
  const transaction = paidTransaction(answer)
  const orderDetails = answer.orderDetails ?? {}
  const transactionId = String(transaction?.uuid ?? '').trim() || null
  const eventKey = await sha256Hex(`${source}|${transactionId ?? ''}|${rawPayload}`)
  const row = {
    provider: 'izipay',
    source,
    event_key: eventKey,
    signature_valid: true,
    raw_payload: rawPayload,
    payload: answer,
    order_number: String(orderDetails.orderId ?? '').trim() || null,
    transaction_id: transactionId,
    shop_id: String(answer.shopId ?? '').trim() || null,
    transaction_shop_id: String(transaction?.shopId ?? '').trim() || null,
    order_amount_minor: finiteInteger(orderDetails.orderTotalAmount),
    paid_amount_minor: finiteInteger(orderDetails.orderEffectiveAmount),
    transaction_amount_minor: finiteInteger(transaction?.amount),
    order_currency: String(orderDetails.orderCurrency ?? '').trim().toUpperCase() || null,
    transaction_currency: String(transaction?.currency ?? '').trim().toUpperCase() || null,
    payment_method_type: String(transaction?.paymentMethodType ?? '').trim().toUpperCase() || null,
    operation_type: String(transaction?.operationType ?? '').trim().toUpperCase() || null,
    provider_status: String(answer.orderStatus ?? '').trim().toUpperCase() || null,
    transaction_status: String(transaction?.status ?? '').trim().toUpperCase() || null,
  }

  const { data: inserted, error: insertError } = await admin
    .from('payment_events')
    .upsert(row, { onConflict: 'provider,source,event_key', ignoreDuplicates: true })
    .select('id')
    .maybeSingle()
  if (insertError) throw new Error(`PAYMENT_EVENT_PERSIST_FAILED: ${insertError.message}`)
  if (inserted?.id) return inserted.id

  const { data: existing, error: selectError } = await admin
    .from('payment_events')
    .select('id')
    .eq('provider', 'izipay')
    .eq('source', source)
    .eq('event_key', eventKey)
    .maybeSingle()
  if (selectError || !existing?.id) {
    throw new Error(`PAYMENT_EVENT_LOOKUP_FAILED: ${selectError?.message ?? 'sin id'}`)
  }
  return existing.id
}

export async function processIzipayEvent(
  admin: any,
  eventId: string,
): Promise<PaymentEventResult> {
  const { data, error } = await admin.rpc('process_izipay_payment_event', {
    p_event_id: eventId,
    p_expected_shop_id: expectedShopId(),
    p_allowed_payment_methods: allowedPaymentMethods(),
  })
  if (error) {
    await admin.from('payment_events').update({
      processing_status: 'failed',
      last_error: String(error.message ?? 'RPC_FAILED').slice(0, 500),
    }).eq('id', eventId)
    throw new Error(`PAYMENT_EVENT_PROCESS_FAILED: ${error.message}`)
  }
  return (data ?? {}) as PaymentEventResult
}
