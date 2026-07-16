// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: izipay-validate  (corre en el servidor)
//   Tras pagar, el formulario embebido de Izipay/Lyra dispara KR.onSubmit en el
//   NAVEGADOR con { krAnswer, krHash }. El front nos lo manda aquí.
//
//   1) Verifica la FIRMA de la respuesta con la clave HMAC (IZIPAY_HMAC) →
//      imposible falsear "pagado" sin la clave secreta.
//   2) Si la firma es válida y orderStatus === 'PAID', confirma el pedido de forma
//      IDEMPOTENTE (marcar_pedido_pagado: marca pagado/confirmado + descuenta stock)
//      y envía el correo de confirmación.
//
//   Es seguro porque la firma se valida en el servidor. La IPN (izipay-ipn) sigue
//   siendo el respaldo servidor-a-servidor; como marcar_pedido_pagado es idempotente,
//   si ambos llegan no hay doble efecto.
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const HMAC = Deno.env.get('IZIPAY_HMAC')
  if (!HMAC) {
    console.error('[izipay-validate] Falta secret IZIPAY_HMAC')
    return json({ error: 'Pasarela no configurada' }, 500)
  }

  let body: { krAnswer?: string; krHash?: string }
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }

  const krAnswer = String(body?.krAnswer ?? '')
  const krHash   = String(body?.krHash ?? '')
  if (!krAnswer || !krHash) return json({ valid: false, paid: false })

  // La respuesta del navegador se firma con la clave HMAC.
  const valid = await verifyHmac(krAnswer, HMAC, krHash)
  if (!valid) return json({ valid: false, paid: false })

  let answer: {
    orderStatus?: string
    orderDetails?: { orderId?: string }
    transactions?: Array<{ uuid?: string }>
  }
  try {
    answer = JSON.parse(krAnswer)
  } catch {
    return json({ valid: true, paid: false })
  }

  const paid = answer?.orderStatus === 'PAID'
  if (!paid) return json({ valid: true, paid: false })

  // Firma válida + pagado → registrar el pago (idempotente) y enviar el correo
  // que corresponda. `oversold` viaja al navegador para avisar en la UI. Si el
  // RPC falla o no devuelve nada, oversold queda en false.
  let oversold = false
  try {
    const orderId = answer?.orderDetails?.orderId
    const txn     = answer?.transactions?.[0]?.uuid ?? null
    if (orderId) {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data: result, error: rpcErr } = await admin.rpc('marcar_pedido_pagado', {
        p_order_number: orderId,
        p_txn_id: txn,
      })
      if (rpcErr) console.error('[izipay-validate] marcar_pedido_pagado:', rpcErr.message)
      oversold = result?.oversold === true

      // Correo según el RESULTADO del RPC (nunca por excepción). Nunca enviamos
      // "Confirmación" si el RPC falló o si hubo sobreventa:
      //   • RPC con error       → no enviamos nada.
      //   • idempotent === true → notificación repetida: no reenviamos.
      //   • oversold  === true  → pagó sin stock: aviso suave cliente + alerta tienda.
      //   • resto (1ª vez, OK)  → correo de confirmación normal.
      if (!rpcErr && result && result.idempotent === false) {
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
            // Pagó sin stock: NO confirmamos; aviso suave al cliente + alerta a la tienda.
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
    }
  } catch (e) {
    // No rompemos la UX: el pago fue válido; la IPN servirá de respaldo.
    console.error('[izipay-validate] confirmación:', (e as Error).message)
  }

  return json({ valid: true, paid: true, oversold })
})
