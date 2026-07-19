// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: izipay-validate  (corre en el servidor)
//   Tras pagar, el formulario embebido de Izipay/Lyra dispara KR.onSubmit en el
//   NAVEGADOR con { krAnswer, krHash }. El front nos lo manda aquí.
//
//   1) Verifica la FIRMA de la respuesta con la clave HMAC (IZIPAY_HMAC) →
//      imposible falsear "pagado" sin la clave secreta.
//   2) Si la firma es válida y orderStatus === 'PAID', persiste un evento y el RPC
//      valida monto/moneda/comercio/método/transacción antes de confirmar de forma
//      idempotente y descontar stock mediante el ledger exacto.
//
//   Es seguro porque la firma se valida en el servidor. La IPN (izipay-ipn) sigue
//   siendo el respaldo servidor-a-servidor; el lock del pedido y la transacción
//   única evitan doble efecto si ambos llegan concurrentemente.
//
// Secrets: IZIPAY_HMAC, RESEND_API_KEY (correo). SUPABASE_* los inyecta Supabase.
// Deploy:  supabase functions deploy izipay-validate
// ─────────────────────────────────────────────────────────────────────────────

import { verifyHmac } from '../_shared/hmac.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  buildHtmlSobreventa,
  enviarCorreoConfirmacion,
  enviarResend,
  type ClientePedido,
  type ItemPedido,
} from '../_shared/email.ts'
import {
  assertAllowedOrigin,
  corsHeaders,
  enforceRateLimit,
  handleRequestError,
  jsonResponse,
  readJsonLimited,
} from '../_shared/security.ts'
import {
  parseIzipayAnswer,
  persistIzipayEvent,
  processIzipayEvent,
} from '../_shared/izipay-event.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Correos de SOBREVENTA (el pedido se PAGÓ pero faltó stock): aviso suave al
// cliente (SIN confirmar) + alerta a la tienda para reposición/reembolso.
// Best-effort: no lanza. Mismo patrón que enviarCorreoConfirmacion.
// ─────────────────────────────────────────────────────────────────────────────
async function enviarCorreosSobreventa(
  cliente: ClientePedido,
  items: ItemPedido[],
  orderNumber: string,
): Promise<void> {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  if (!RESEND_API_KEY) {
    console.error('[izipay-validate] RESEND_API_KEY no configurada — no se envía correo')
    return
  }
  const FROM  = Deno.env.get('RESEND_FROM') ?? 'Hebennus <onboarding@resend.dev>'
  const STORE = Deno.env.get('STORE_EMAIL')

  // Aviso suave al cliente (SIN confirmar el pedido).
  try {
    await enviarResend(RESEND_API_KEY, {
      from: FROM,
      to: [cliente.customer_email.trim()],
      subject: `Recibimos tu pago ${orderNumber} — Hebennus`,
      html: buildHtmlSobreventa(cliente, items, orderNumber, 'cliente'),
      reply_to: STORE || undefined,
    })
  } catch (e) {
    console.error(`[izipay-validate] Aviso sobreventa cliente falló (${orderNumber}):`, (e as Error).message)
  }

  // Alerta a la tienda (reposición o reembolso).
  if (STORE) {
    try {
      await enviarResend(RESEND_API_KEY, {
        from: FROM,
        to: [STORE],
        subject: `⚠️ Pedido ${orderNumber} PAGADO SIN STOCK — ${cliente.customer_name}`,
        html: buildHtmlSobreventa(cliente, items, orderNumber, 'tienda'),
        reply_to: cliente.customer_email.trim(),
      })
    } catch (e) {
      console.error(`[izipay-validate] Alerta sobreventa tienda falló (${orderNumber}):`, (e as Error).message)
    }
  }
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
    assertAllowedOrigin(req)
    if (req.method !== 'POST') return jsonResponse(req, { error: 'Método no permitido' }, 405)

    const HMAC = Deno.env.get('IZIPAY_HMAC')
    if (!HMAC) {
      console.error('[izipay-validate] Falta secret IZIPAY_HMAC')
      return jsonResponse(req, { error: 'Pasarela no configurada' }, 500)
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    await enforceRateLimit(admin, req, 'izipay-validate', 30, 600)

    const body = await readJsonLimited<{ krAnswer?: string; krHash?: string }>(req, 300_000)
    const krAnswer = String(body?.krAnswer ?? '')
    const krHash = String(body?.krHash ?? '')
    if (!krAnswer || !krHash) return jsonResponse(req, { valid: false, paid: false }, 400)

    const valid = await verifyHmac(krAnswer, HMAC, krHash)
    if (!valid) return jsonResponse(req, { valid: false, paid: false }, 401)

    let answer
    try {
      answer = parseIzipayAnswer(krAnswer)
    } catch {
      return jsonResponse(req, { valid: true, paid: false, error: 'Respuesta inválida' }, 422)
    }

    // La firma ya es válida. Persistimos el evento ANTES de tocar pedido/stock.
    // Si la persistencia falla, respondemos 503 y nunca afirmamos que se confirmó.
    const eventId = await persistIzipayEvent(admin, 'callback', krAnswer, answer)
    const result = await processIzipayEvent(admin, eventId)
    if (result.accepted !== true) {
      console.error(`[izipay-validate] Evento rechazado ${eventId}: ${result.error}`)
      return jsonResponse(req, { valid: true, paid: false, confirmed: false }, 422)
    }

    const orderId = result.order_number ?? answer.orderDetails?.orderId ?? ''
    const oversold = result.oversold === true

    // Solo el primer procesador envía correo; callback e IPN concurrentes quedan
    // deduplicados por evento/transacción y por el lock del pedido.
    if (result.idempotent === false && orderId) {
      const { data: order } = await admin
        .from('orders').select('*, order_items(*)').eq('order_number', orderId).single()
      if (order) {
        const cliente = {
          customer_name: order.customer_name,
          customer_phone: order.customer_phone,
          customer_email: order.customer_email,
          notes: order.notes,
          doc_tipo: order.doc_tipo,
          doc_numero: order.doc_numero,
        }
        const items: ItemPedido[] = (order.order_items ?? []).map((it: ItemPedido) => ({
          product_id: it.product_id, name: it.name, size: it.size, color: it.color,
          qty: it.qty, unit_price: it.unit_price, subtotal: it.subtotal,
        }))

        if (oversold) {
          await enviarCorreosSobreventa(cliente, items, orderId)
        } else {
          const totals = {
            subtotal: Number(order.subtotal), shipping: Number(order.shipping),
            discount: Number(order.discount ?? 0), total: Number(order.total),
          }
          await enviarCorreoConfirmacion(cliente, items, totals, orderId)
        }
      }
    }

    return jsonResponse(req, { valid: true, paid: true, confirmed: true, oversold })
  } catch (error) {
    console.error('[izipay-validate] procesamiento:', (error as Error).message)
    return handleRequestError(req, error)
  }
})
