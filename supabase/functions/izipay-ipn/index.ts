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
//     1) marcar_pedido_pagado (idempotente): pago 'pagado', estado 'confirmado',
//        descuento de stock.
//     2) correo de confirmación (cliente + tienda).
//   Siempre responde 200 'OK' cuando la firma es válida, para que Izipay no entre
//   en bucle de reintentos. Si la firma NO coincide → 401.
//
// Secrets: IZIPAY_PASSWORD (firma IPN), + RESEND_* (correo).
//          SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
// Deploy:  supabase functions deploy izipay-ipn --no-verify-jwt
//   (--no-verify-jwt: Izipay no manda Authorization; la seguridad es la firma HMAC.)
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyHmac } from '../_shared/hmac.ts'
import { buildHtml, buildHtmlSobreventa, enviarResend, type ItemPedido } from '../_shared/email.ts'

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

  const PASSWORD = Deno.env.get('IZIPAY_PASSWORD')
  if (!PASSWORD) {
    console.error('[izipay-ipn] Falta secret IZIPAY_PASSWORD')
    return new Response('Pasarela no configurada', { status: 500 })
  }

  // 1) Leer el cuerpo urlencoded.
  let form: FormData
  try { form = await req.formData() } catch {
    console.error('[izipay-ipn] Cuerpo inválido (no es formData)')
    return new Response('Bad request', { status: 400 })
  }

  const krAnswer = String(form.get('kr-answer') ?? '')
  const krHash   = String(form.get('kr-hash') ?? '')

  if (!krAnswer || !krHash) {
    console.error('[izipay-ipn] Faltan kr-answer / kr-hash')
    return new Response('Bad request', { status: 400 })
  }

  // 2) Validar la firma: la IPN usa la PASSWORD (no la clave HMAC).
  const firmaOk = await verifyHmac(krAnswer, PASSWORD, krHash)
  if (!firmaOk) {
    console.error('[izipay-ipn] Firma inválida — se rechaza la notificación')
    return new Response('Invalid signature', { status: 401 })
  }

  // 3) Parsear kr-answer.
  let answer: {
    orderStatus?: string
    orderDetails?: { orderId?: string }
    transactions?: Array<{ uuid?: string }>
  }
  try { answer = JSON.parse(krAnswer) } catch {
    console.error('[izipay-ipn] kr-answer no es JSON válido')
    // Firma válida pero payload corrupto: 200 para no provocar reintentos.
    return new Response('OK', { status: 200 })
  }

  const orderStatus = answer?.orderStatus
  const orderId     = answer?.orderDetails?.orderId ?? ''
  const txnId       = answer?.transactions?.[0]?.uuid ?? ''

  // Solo procesamos pagos confirmados. Cualquier otro estado se acusa con 200.
  if (orderStatus !== 'PAID') {
    console.log(`[izipay-ipn] Pedido ${orderId} con estado ${orderStatus} — sin acción`)
    return new Response('OK', { status: 200 })
  }
  if (!orderId) {
    console.error('[izipay-ipn] PAID sin orderId — no se puede confirmar')
    return new Response('OK', { status: 200 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  // 4) Registrar el pago + descuento de stock (idempotente). El RPC YA NO lanza
  //    por falta de stock: registra el pago siempre y devuelve oversold=true si
  //    faltó stock. Decidimos el correo por el RESULTADO del RPC (no por
  //    excepción): así NUNCA enviamos "Confirmación" si el RPC falla o si hubo
  //    sobreventa. Respondemos 200 igual al final para que Izipay no reintente.
  const { data: resultado, error: rpcError } = await admin.rpc('marcar_pedido_pagado', {
    p_order_number: orderId,
    p_txn_id: txnId,
  })

  if (rpcError) {
    // Fallo del RPC: NO enviamos correo de confirmación. Queda en logs.
    console.error(`[izipay-ipn] marcar_pedido_pagado falló (${orderId}):`, rpcError.message)
  } else if (resultado?.idempotent === true) {
    // Notificación repetida (el pedido ya estaba pagado): no reenviamos nada.
    console.log(`[izipay-ipn] Pedido ${orderId} ya estaba pagado — sin correo (idempotente)`)
  } else if (resultado?.oversold === true) {
    // El pago se registró pero faltó stock: alerta a la tienda + aviso suave al
    // cliente. NUNCA enviamos confirmación en este caso.
    console.warn(`[izipay-ipn] Pedido ${orderId} PAGADO SIN STOCK (sobreventa) — alertando`)
    await enviarCorreosPedido(admin, orderId, 'sobreventa')
  } else {
    // Primera confirmación con stock OK: correo de confirmación normal.
    console.log(`[izipay-ipn] Pedido ${orderId} confirmado — enviando correo`)
    await enviarCorreosPedido(admin, orderId, 'confirmacion')
  }

  // Siempre 200 con firma válida, para que Izipay no reintente en bucle.
  return new Response('OK', { status: 200 })
})
