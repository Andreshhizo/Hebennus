// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: izipay-formtoken  (corre en el servidor)
//   Genera el formToken de Izipay/Lyra (Embedded Form / Web Core V4) a partir de
//   un pedido YA creado (por create-order con payment_method='izipay', estado
//   'pendiente' y stock diferido). El front llama aquí con el order_number, recibe
//   el formToken + publicKey + endpoint y monta el formulario de pago.
//
//   Las credenciales (USERNAME/PASSWORD = autenticación HTTP Basic contra la API
//   REST de Lyra) viven SOLO aquí; el navegador solo recibe el formToken y la
//   public key (que es pública por diseño).
//
// Secrets: IZIPAY_USERNAME, IZIPAY_PASSWORD, IZIPAY_PUBLIC_KEY.
//          SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
// Deploy:  supabase functions deploy izipay-formtoken
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  assertAllowedOrigin,
  corsHeaders,
  enforceRateLimit,
  handleRequestError,
  jsonResponse,
  readJsonLimited,
} from '../_shared/security.ts'

const IZIPAY_ENDPOINT = 'https://api.micuentaweb.pe'

// Separa "Nombre Apellido(s)" en firstName / lastName para billingDetails.
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
    assertAllowedOrigin(req)
    if (req.method !== 'POST') return jsonResponse(req, { error: 'Método no permitido' }, 405)

    const body = await readJsonLimited<{ order_number?: string }>(req, 8_192)
    const orderNumber = String(body?.order_number ?? '').trim()
    if (!/^HB-\d{6,12}$/.test(orderNumber)) {
      return jsonResponse(req, { error: 'No se pudo iniciar el pago para este pedido' }, 400)
    }

    const USERNAME   = Deno.env.get('IZIPAY_USERNAME')
    const PASSWORD   = Deno.env.get('IZIPAY_PASSWORD')
    const PUBLIC_KEY = Deno.env.get('IZIPAY_PUBLIC_KEY')
    if (!USERNAME || !PASSWORD || !PUBLIC_KEY) {
      console.error('[izipay-formtoken] Faltan secrets IZIPAY_USERNAME/PASSWORD/PUBLIC_KEY')
      return jsonResponse(req, { error: 'Pasarela no configurada' }, 500)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    await enforceRateLimit(admin, req, 'izipay-formtoken', 20, 600)

    // Leer el pedido por order_number (datos validados en create-order).
    const { data: order, error: orderError } = await admin
      .from('orders')
      .select('total, customer_email, customer_name, doc_numero, doc_tipo, customer_phone, notes, payment_status, status, payment_method')
      .eq('order_number', orderNumber)
      .maybeSingle()

    if (orderError) {
      console.error('[izipay-formtoken] Error leyendo pedido:', orderError.message)
      return jsonResponse(req, { error: 'No se pudo leer el pedido' }, 500)
    }
  // Mensaje genérico ante pedido inexistente: no confirmamos si el número existe
  // (order numbers secuenciales → evita enumeración/IDOR).
    if (!order) return jsonResponse(req, { error: 'No se pudo iniciar el pago para este pedido' }, 404)

  // ── Guard IDOR (M1) ──────────────────────────────────────────────────────────
  // Sin JWT de usuario garantizado en guest checkout, la defensa principal es el
  // ESTADO del pedido: solo generamos form-token (CreatePayment real) para pedidos
  // pagables. Un pedido ya 'pagado' (o con payment_status distinto de 'pendiente')
  // o 'cancelado' NO debe poder generar cobros nuevos. Rechazamos ANTES de llamar
  // a Izipay, con mensaje genérico (sin filtrar el estado interno al cliente).
    const paymentStatus = String(order.payment_status ?? '')
    const orderStatus   = String(order.status ?? '')
    if (paymentStatus !== 'pendiente' || orderStatus === 'cancelado' || order.payment_method !== 'izipay') {
    console.error(
      `[izipay-formtoken] Pedido no pagable ${orderNumber}: payment_status=${paymentStatus} status=${orderStatus}`,
    )
      return jsonResponse(req, { error: 'Este pedido no admite pago en este momento' }, 409)
    }

    const total = Number(order.total)
    if (!(total > 0)) return jsonResponse(req, { error: 'Monto de pedido inválido' }, 400)

    const { firstName, lastName } = splitName(order.customer_name)

  // Solo mandamos el documento si el pedido lo tiene (factura RUC / boleta con DNI).
  // Para boleta a consumidor final (sin DNI) omitimos identityType/identityCode.
    const billingDetails: Record<string, unknown> = {
    firstName,
    lastName,
    phoneNumber: order.customer_phone,
    country: 'PE',
    language: 'es',
  }
    if (order.doc_numero) {
    billingDetails.identityType = order.doc_tipo === 'RUC' ? 'RUC' : 'DNI'
    billingDetails.identityCode = order.doc_numero
  }

  // amount va en CÉNTIMOS (S/ 1.00 → 100).
    const izipayBody = {
    amount: Math.round(total * 100),
    currency: 'PEN',
    orderId: orderNumber,
    customer: {
      email: order.customer_email,
      billingDetails,
    },
  }

    let response: Response
    try {
      response = await fetch(`${IZIPAY_ENDPOINT}/api-payment/V4/Charge/CreatePayment`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${USERNAME}:${PASSWORD}`),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(izipayBody),
    })
    } catch (error) {
      console.error('[izipay-formtoken] No se pudo contactar a Izipay:', String(error))
      return jsonResponse(req, { error: 'No se pudo contactar a la pasarela de pago' }, 502)
    }

    const data = await response.json().catch(() => null)
    const formToken = data?.answer?.formToken

    if (data?.status === 'SUCCESS' && formToken) {
      return jsonResponse(req, { formToken, publicKey: PUBLIC_KEY, endpoint: IZIPAY_ENDPOINT })
    }

  // Loguear el detalle real solo en consola; nunca exponerlo crudo al navegador.
    console.error('[izipay-formtoken] CreatePayment no exitoso:', response.status, JSON.stringify(data))
    return jsonResponse(req, { error: 'No se pudo iniciar el pago' }, 502)
  } catch (error) {
    return handleRequestError(req, error)
  }
})
