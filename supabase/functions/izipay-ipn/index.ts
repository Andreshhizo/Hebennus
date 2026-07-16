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
import { buildHtml, enviarResend, type ItemPedido } from '../_shared/email.ts'

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

  // 4) Confirmar el pago + descuento de stock (idempotente). Atrapamos errores
  //    para no romper: respondemos 200 igual y revisamos en logs si falla.
  let yaProcesado = false
  try {
    const { data, error } = await admin.rpc('marcar_pedido_pagado', {
      p_order_number: orderId,
      p_txn_id: txnId,
    })
    if (error) {
      console.error(`[izipay-ipn] marcar_pedido_pagado falló (${orderId}):`, error.message)
    } else {
      yaProcesado = data?.idempotent === true
      console.log(`[izipay-ipn] Pedido ${orderId} confirmado (idempotent=${yaProcesado})`)
    }
  } catch (e) {
    console.error(`[izipay-ipn] Excepción en marcar_pedido_pagado (${orderId}):`, (e as Error).message)
  }

  // 5) Correo de confirmación. Si el pedido ya estaba pagado (notificación
  //    repetida), no reenviamos para no duplicar el correo.
  if (!yaProcesado) {
    try {
      const { data: order } = await admin
        .from('orders')
        .select('id, customer_name, customer_phone, customer_email, notes, doc_tipo, doc_numero, comprobante_tipo, razon_social, subtotal, shipping, discount, total')
        .eq('order_number', orderId)
        .maybeSingle()

      const { data: rows } = order
        ? await admin
            .from('order_items')
            .select('product_id, name, size, color, qty, unit_price, subtotal')
            .eq('order_id', order.id)
        : { data: [] }

      const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
      if (order && RESEND_API_KEY) {
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

        // Correo al cliente.
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
        // Copia a la tienda.
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
      } else if (!RESEND_API_KEY) {
        console.error('[izipay-ipn] RESEND_API_KEY no configurada — no se envía correo')
      }
    } catch (e) {
      console.error(`[izipay-ipn] Excepción armando correo (${orderId}):`, (e as Error).message)
    }
  }

  // Siempre 200 con firma válida, para que Izipay no reintente en bucle.
  return new Response('OK', { status: 200 })
})
