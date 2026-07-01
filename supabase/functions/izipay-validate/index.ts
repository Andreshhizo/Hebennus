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
import { enviarCorreoConfirmacion, type ItemPedido } from '../_shared/email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  // Firma válida + pagado → confirmar el pedido (idempotente) y enviar correo.
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

      // Solo en la PRIMERA confirmación (no idempotente) enviamos el correo.
      if (result && result.idempotent === false) {
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
          const totals = {
            subtotal: Number(order.subtotal), shipping: Number(order.shipping),
            discount: Number(order.discount ?? 0), total: Number(order.total),
          }
          await enviarCorreoConfirmacion(cliente, items, totals, orderId)
        }
      }
    }
  } catch (e) {
    // No rompemos la UX: el pago fue válido; la IPN servirá de respaldo.
    console.error('[izipay-validate] confirmación:', (e as Error).message)
  }

  return json({ valid: true, paid: true })
})
