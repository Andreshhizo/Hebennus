// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: izipay-ipn  (webhook servidor-a-servidor de Izipay/Lyra)
//   Izipay notifica el resultado del pago a esta URL (configurada en el panel del
//   comercio como "URL de notificación de fin de pago" / IPN). Es la ÚNICA fuente
//   de verdad para confirmar el pago: no se debe confiar en la respuesta del
//   navegador (esa se valida en izipay-validate solo para feedback de UX).
//
//   La IPN llega como application/x-www-form-urlencoded con:
//     kr-answer     → JSON con el resultado del pago.
//     kr-hash       → firma HMAC-SHA256 hex de kr-answer.
//     kr-hash-key   → 'password' | 'sha256_hmac' (qué clave usó Izipay).
//   ⚠️ Para la IPN (servidor) la firma se calcula con la PASSWORD de la API REST,
//   NO con la clave HMAC (esa es para la respuesta del navegador).
//
//   Si la firma es válida y orderStatus === 'PAID':
//     1) persiste un payment_event durable antes de tocar el pedido;
//     2) valida monto/moneda/comercio/método/transacción y aplica el ledger;
//     3) envía el correo correspondiente (cliente + tienda).
//   Responde 200 solo cuando el evento quedó procesado o rechazado de forma
//   definitiva. Un fallo interno devuelve 503 para que Izipay reintente.
//   Si la firma NO coincide → 401.
//
// Secrets: IZIPAY_PASSWORD (firma IPN), + RESEND_* (correo).
//          SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
// Deploy:  supabase functions deploy izipay-ipn --no-verify-jwt
//   (--no-verify-jwt: Izipay no manda Authorization; la seguridad es la firma HMAC.)
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyHmac } from '../_shared/hmac.ts'
import { buildHtml, buildHtmlSobreventa, enviarResend, type ItemPedido } from '../_shared/email.ts'
import { enforceRateLimit, readBodyLimited } from '../_shared/security.ts'
import {
  parseIzipayAnswer,
  persistIzipayEvent,
  processIzipayEvent,
} from '../_shared/izipay-event.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Carga el pedido + ítems (con miniaturas) y envía el par de correos que
// corresponda:
//   • 'confirmacion' → compra OK (cliente + copia a la tienda).
//   • 'sobreventa'   → se PAGÓ sin stock: aviso suave al cliente (SIN confirmar)
//     + alerta a la tienda para reposición/reembolso.
// Best-effort: nunca lanza; los fallos quedan en logs. Los dos modos son
// excluyentes — quien llama decide cuál según el resultado del RPC.
// ─────────────────────────────────────────────────────────────────────────────
async function enviarCorreosPedido(
  admin: ReturnType<typeof createClient>,
  orderId: string,
  modo: 'confirmacion' | 'sobreventa',
): Promise<void> {
  try {
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    if (!RESEND_API_KEY) {
      console.error('[izipay-ipn] RESEND_API_KEY no configurada — no se envía correo')
      return
    }

    const { data: order } = await admin
      .from('orders')
      .select('id, customer_name, customer_phone, customer_email, notes, doc_tipo, doc_numero, comprobante_tipo, razon_social, subtotal, shipping, discount, total')
      .eq('order_number', orderId)
      .maybeSingle()
    if (!order) {
      console.error(`[izipay-ipn] Pedido ${orderId} no encontrado — no se envía correo`)
      return
    }

    const { data: rows } = await admin
      .from('order_items')
      .select('product_id, name, size, color, qty, unit_price, subtotal')
      .eq('order_id', order.id)

    const cliente = {
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      customer_email: order.customer_email,
      notes: order.notes ?? '',
      doc_tipo: order.doc_tipo,
      doc_numero: order.doc_numero,
      comprobante_tipo: order.comprobante_tipo,
      razon_social: order.razon_social,
    }

    // Miniaturas para el correo: traemos las imágenes de los productos (best-effort).
    const imgMap = new Map<string, string>()
    const pids = [...new Set((rows ?? []).map((r) => r.product_id).filter(Boolean))] as string[]
    if (pids.length) {
      const { data: prods } = await admin.from('products').select('id, card_images, images').in('id', pids)
      for (const p of prods ?? []) {
        const img = (Array.isArray(p.card_images) && p.card_images[0]) || (Array.isArray(p.images) && p.images[0]) || null
        if (img) imgMap.set(p.id, img)
      }
    }
    const items: ItemPedido[] = (rows ?? []).map((it) => ({
      product_id: it.product_id,
      name: it.name,
      size: it.size,
      color: it.color,
      qty: Number(it.qty),
      unit_price: Number(it.unit_price),
      subtotal: Number(it.subtotal),
      image: it.product_id ? (imgMap.get(it.product_id) ?? null) : null,
    }))
    const totals = {
      subtotal: Number(order.subtotal ?? 0),
      shipping: Number(order.shipping ?? 0),
      discount: Number(order.discount ?? 0),
      total: Number(order.total ?? 0),
    }

    const FROM  = Deno.env.get('RESEND_FROM') ?? 'Hebennus <onboarding@resend.dev>'
    const STORE = Deno.env.get('STORE_EMAIL')

    if (modo === 'sobreventa') {
      // Aviso suave al cliente (SIN confirmar el pedido).
      try {
        await enviarResend(RESEND_API_KEY, {
          from: FROM,
          to: [cliente.customer_email.trim()],
          subject: `Recibimos tu pago ${orderId} — Hebennus`,
          html: buildHtmlSobreventa(cliente, items, orderId, 'cliente'),
          reply_to: STORE || undefined,
        })
      } catch (e) {
        console.error(`[izipay-ipn] Aviso sobreventa cliente falló (${orderId}):`, (e as Error).message)
      }
      // Alerta a la tienda (reposición o reembolso).
      if (STORE) {
        try {
          await enviarResend(RESEND_API_KEY, {
            from: FROM,
            to: [STORE],
            subject: `⚠️ Pedido ${orderId} PAGADO SIN STOCK — ${cliente.customer_name}`,
            html: buildHtmlSobreventa(cliente, items, orderId, 'tienda'),
            reply_to: cliente.customer_email.trim(),
          })
        } catch (e) {
          console.error(`[izipay-ipn] Alerta sobreventa tienda falló (${orderId}):`, (e as Error).message)
        }
      }
      return
    }

    // modo === 'confirmacion': correo de confirmación normal (cliente + tienda).
    try {
      await enviarResend(RESEND_API_KEY, {
        from: FROM,
        to: [cliente.customer_email.trim()],
        subject: `Confirmación de tu pedido ${orderId} — Hebennus`,
        html: buildHtml(cliente, items, totals, orderId, 'cliente'),
        reply_to: STORE || undefined,
      })
    } catch (e) {
      console.error(`[izipay-ipn] Correo cliente falló (${orderId}):`, (e as Error).message)
    }
    if (STORE) {
      try {
        await enviarResend(RESEND_API_KEY, {
          from: FROM,
          to: [STORE],
          subject: `Nuevo pedido ${orderId} (pagado Izipay) — ${cliente.customer_name}`,
          html: buildHtml(cliente, items, totals, orderId, 'tienda'),
          reply_to: cliente.customer_email.trim(),
        })
      } catch (e) {
        console.error(`[izipay-ipn] Correo tienda falló (${orderId}):`, (e as Error).message)
      }
    }
  } catch (e) {
    console.error(`[izipay-ipn] Excepción armando correo (${orderId}):`, (e as Error).message)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Método no permitido', { status: 405 })

  try {
    const PASSWORD = Deno.env.get('IZIPAY_PASSWORD')
    if (!PASSWORD) {
      console.error('[izipay-ipn] Falta secret IZIPAY_PASSWORD')
      return new Response('Pasarela no configurada', { status: 500 })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    await enforceRateLimit(admin, req, 'izipay-ipn', 120, 600)

    const contentType = req.headers.get('Content-Type') ?? ''
    if (!contentType.toLowerCase().includes('application/x-www-form-urlencoded')) {
      return new Response('Bad request', { status: 400 })
    }
    const rawBody = await readBodyLimited(req, 300_000)
    const form = new URLSearchParams(rawBody)
    const krAnswer = form.get('kr-answer') ?? ''
    const krHash = form.get('kr-hash') ?? ''
    if (!krAnswer || !krHash) return new Response('Bad request', { status: 400 })

    const firmaOk = await verifyHmac(krAnswer, PASSWORD, krHash)
    if (!firmaOk) {
      console.error('[izipay-ipn] Firma inválida — se rechaza la notificación')
      return new Response('Invalid signature', { status: 401 })
    }

    let answer
    try {
      answer = parseIzipayAnswer(krAnswer)
    } catch {
      // Una carga firmada pero corrupta no puede considerarse procesada.
      console.error('[izipay-ipn] kr-answer firmado no es JSON válido')
      return new Response('Invalid payload', { status: 422 })
    }

    // Durabilidad primero: si este INSERT no confirma, devolvemos 503 para que
    // Izipay reintente. Nunca acusamos 200 por un evento no persistido.
    const eventId = await persistIzipayEvent(admin, 'ipn', krAnswer, answer)
    const result = await processIzipayEvent(admin, eventId)

    if (result.accepted !== true) {
      // El evento sí quedó durable, pero no cumple el contrato del pedido. Un
      // reintento idéntico no lo volverá válido; se acusa sin confirmar el pago.
      console.error(`[izipay-ipn] Evento rechazado ${eventId}: ${result.error}`)
      return new Response('REJECTED', { status: 200 })
    }

    const orderId = result.order_number ?? answer.orderDetails?.orderId ?? ''
    if (result.idempotent === true) {
      console.log(`[izipay-ipn] Pedido ${orderId} ya procesado — sin correo duplicado`)
    } else if (result.oversold === true) {
      console.warn(`[izipay-ipn] Pedido ${orderId} PAGADO SIN STOCK — alertando`)
      await enviarCorreosPedido(admin, orderId, 'sobreventa')
    } else {
      console.log(`[izipay-ipn] Pedido ${orderId} confirmado — enviando correo`)
      await enviarCorreosPedido(admin, orderId, 'confirmacion')
    }

    return new Response('OK', { status: 200 })
  } catch (error) {
    // El evento ya persistido queda en failed; si ni siquiera se pudo persistir,
    // también devolvemos no-2xx. En ambos casos Izipay debe reintentar.
    console.error('[izipay-ipn] Fallo interno:', (error as Error).message)
    return new Response('Temporary failure', { status: 503 })
  }
})
