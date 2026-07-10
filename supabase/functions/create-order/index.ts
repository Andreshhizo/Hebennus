// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: create-order  (corre en el servidor)
//   1) Identifica al usuario por su JWT (si inició sesión) → vincula el pedido.
//   2) VALIDA precios contra la BD (no confía en el navegador).
//   3) VALIDA el 10% de bienvenida (solo usuario autenticado, 1ª compra).
//   4) Inserta pedido + ítems de forma atómica vía RPC create_order.
//   5) Guarda el contacto de marketing si dio consentimiento.
//   6) Contraentrega: envía el correo (cliente + copia tienda) vía _shared/email.ts.
//      Izipay: NO envía correo aquí (lo hace izipay-ipn al confirmar el pago).
// La service_role y la RESEND_API_KEY viven SOLO aquí; nunca llegan al navegador.
//
// Secrets: RESEND_API_KEY (obligatorio para correo), RESEND_FROM, STORE_EMAIL.
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
// Deploy: supabase functions deploy create-order
//
// Pago Izipay (diferido): si payment_method === 'izipay', el pedido se crea como
// 'pendiente', el stock NO se descuenta (defer_stock=true) y NO se envía correo
// aquí. El correo y el descuento de stock los hace izipay-ipn al confirmar el pago.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildHtml, buildHtmlYapePendiente, enviarResend, type ItemPedido } from '../_shared/email.ts'

const ENVIO_GRATIS_DESDE = 119  // Lima: gratis desde este subtotal; por debajo, COSTO_ENVIO.
const COSTO_ENVIO        = 10
const WELCOME_PCT        = 0.10

interface Pedido {
  cliente: {
    customer_name: string
    customer_phone: string
    customer_email: string
    notes?: string
    doc_tipo?: string | null
    doc_numero?: string | null
    comprobante_tipo?: string | null
    razon_social?: string | null
  }
  items: ItemPedido[]
  quiere_descuento?: boolean
  consent?: boolean
  payment_method?: string
}

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

const round2 = (n: number) => Math.round(n * 100) / 100

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  let pedido: Pedido
  try { pedido = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }

  // Validación mínima del payload.
  const c = pedido?.cliente
  const emailOk = typeof c?.customer_email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.customer_email)
  const phoneOk = typeof c?.customer_phone === 'string' && /^9\d{8}$/.test(c.customer_phone)
  if (!c?.customer_name?.trim() || !emailOk || !phoneOk || !Array.isArray(pedido.items) || pedido.items.length === 0) {
    return json({ error: 'Pedido inválido' }, 400)
  }

  // Método de pago: 'izipay' (tarjeta/Yape automático), 'yape_manual' (WhatsApp)
  // o 'contraentrega' (default). En izipay y yape_manual el stock se DIFIERE.
  const ALLOWED_METHODS = ['izipay', 'yape_manual', 'contraentrega']
  const paymentMethod = ALLOWED_METHODS.includes(pedido.payment_method ?? '')
    ? (pedido.payment_method as string)
    : 'contraentrega'
  const deferStock = paymentMethod === 'izipay' || paymentMethod === 'yape_manual'

  // Comprobante: factura (RUC, 11 díg.) o boleta (consumidor final, SIN DNI).
  // Solo la factura exige documento; la boleta se emite sin DNI (SUNAT lo permite
  // para consumidor final < S/700).
  const comprobanteTipo = c?.comprobante_tipo === 'factura' ? 'factura' : 'boleta'
  const docNum = String(c?.doc_numero ?? '').replace(/\D/g, '')
  if (deferStock && comprobanteTipo === 'factura' && !/^\d{11}$/.test(docNum)) {
    return json({ error: 'RUC inválido (11 dígitos)' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  // 1) Usuario por JWT (si inició sesión; si es anon, queda null).
  let userId: string | null = null
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (jwt) {
    try { const { data } = await admin.auth.getUser(jwt); userId = data.user?.id ?? null } catch { /* anon */ }
  }

  // 2) Validar precios contra la BD (nunca confiar en el navegador).
  const ids = [...new Set(pedido.items.map((i) => i.product_id).filter(Boolean))] as string[]
  const priceMap = new Map<string, { price: number; is_active: boolean }>()
  if (ids.length) {
    const { data: prods } = await admin.from('products').select('id, price, is_active').in('id', ids)
    for (const p of prods ?? []) priceMap.set(p.id, { price: Number(p.price), is_active: p.is_active })
  }

  let subtotal = 0
  const items: ItemPedido[] = []
  for (const it of pedido.items) {
    const p = it.product_id ? priceMap.get(it.product_id) : null
    if (it.product_id && (!p || p.is_active === false)) {
      return json({ error: `Producto no disponible: ${it.name}` }, 409)
    }
    const qty  = Math.max(1, Math.min(50, Math.trunc(Number(it.qty) || 1)))
    const unit = p ? p.price : Number(it.unit_price)
    if (!(unit >= 0)) return json({ error: 'Precio inválido' }, 400)
    const sub  = round2(unit * qty)
    subtotal  += sub
    items.push({ ...it, qty, unit_price: unit, subtotal: sub })
  }
  subtotal = round2(subtotal)

  // 3) Envío (server-side): Lima gratis desde ENVIO_GRATIS_DESDE; si no, COSTO_ENVIO.
  //    Provincia se coordina aparte por WhatsApp.
  const shipping = subtotal === 0 || subtotal >= ENVIO_GRATIS_DESDE ? 0 : COSTO_ENVIO

  // 4) Descuento de bienvenida (server-side): 10% al PRIMER pedido de cada correo
  //    (con o sin cuenta). Autoritativo: recalcula e ignora el discount del cliente.
  let discount = 0
  let discountReason: string | null = null
  if (pedido.quiere_descuento) {
    // Escapamos los comodines de LIKE (% y _) para un match exacto case-insensitive.
    const emailLike = c.customer_email.trim().replace(/[%_]/g, '\\$&')
    const { count } = await admin.from('orders').select('id', { count: 'exact', head: true }).ilike('customer_email', emailLike)
    if ((count ?? 0) === 0) { discount = round2(subtotal * WELCOME_PCT); discountReason = 'bienvenida_10' }
  }
  const total = Math.max(0, round2(subtotal + shipping - discount))

  // 5) (paymentMethod y deferStock ya se determinaron arriba, junto a la validación.)

  // 6) Inserción atómica vía RPC (con valores ya validados).
  const rpcPayload = {
    cliente: {
      customer_name: c.customer_name.trim(),
      customer_phone: c.customer_phone,
      customer_email: c.customer_email.trim(),
      notes: c.notes ?? '',
      doc_tipo: comprobanteTipo === 'factura' ? 'RUC' : 'DNI',
      doc_numero: docNum || null,
      comprobante_tipo: comprobanteTipo,
      razon_social: comprobanteTipo === 'factura' ? (c.razon_social ?? null) : null,
    },
    items,
    subtotal, shipping, discount, discount_reason: discountReason, total,
    user_id: userId,
    payment_method: paymentMethod,
    defer_stock: deferStock,
  }
  const { data: result, error: rpcError } = await admin.rpc('create_order', { payload: rpcPayload })
  if (rpcError) return json({ error: 'No se pudo registrar el pedido', detail: rpcError.message }, 500)
  const orderNumber: string = result?.order_number ?? '—'

  // 7) Contacto de marketing (con consentimiento, Ley 29733).
  if (pedido.consent === true) {
    try {
      await admin.from('marketing_contacts').upsert(
        {
          email: c.customer_email.trim().toLowerCase(),
          name: c.customer_name.trim(),
          phone: c.customer_phone,
          consent: true,
          consent_at: new Date().toISOString(),
          source: 'checkout',
        },
        { onConflict: 'email' },
      )
    } catch { /* no debe tumbar el pedido */ }
  }

  // 8) Pago diferido (izipay / yape_manual): NO se envía correo aquí ni se descontó
  //    stock. El pedido queda 'pendiente'. Para izipay, izipay-ipn/izipay-validate
  //    confirmarán el pago (marcar_pedido_pagado) y enviarán el correo. Para
  //    yape_manual, el dueño confirma en /admin (admin_marcar_pagado). Devolvemos
  //    order_number + total para que el front pida el formToken (izipay) o arme el
  //    mensaje de WhatsApp con el monto real del servidor (yape_manual).
  if (deferStock) {
    // Yape manual: avisar a la TIENDA (para preparar el QR / no perder el pedido)
    // y al CLIENTE (pedido reservado, coordinar pago por WhatsApp). Best-effort:
    // no debe tumbar el pedido si Resend falla. Izipay NO envía aquí (lo hace la IPN).
    if (paymentMethod === 'yape_manual') {
      const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
      const FROM  = Deno.env.get('RESEND_FROM') ?? 'Hebennus <onboarding@resend.dev>'
      const STORE = Deno.env.get('STORE_EMAIL')
      if (RESEND_API_KEY) {
        // Cliente: pedido reservado.
        try {
          await enviarResend(RESEND_API_KEY, {
            from: FROM,
            to: [c.customer_email.trim()],
            subject: `Reservamos tu pedido ${orderNumber} — coordina tu pago Yape · Hebennus`,
            html: buildHtmlYapePendiente(rpcPayload.cliente.customer_name, orderNumber, total),
            reply_to: STORE || undefined,
          })
        } catch (_) { /* best-effort */ }
        // Tienda: nuevo pedido Yape con detalle (para coordinar el pago).
        if (STORE) {
          try {
            await enviarResend(RESEND_API_KEY, {
              from: FROM,
              to: [STORE],
              subject: `Nuevo pedido YAPE ${orderNumber} — ${c.customer_name} (coordinar pago)`,
              html: buildHtml(rpcPayload.cliente, items, { subtotal, shipping, discount, total }, orderNumber, 'tienda'),
              reply_to: c.customer_email.trim(),
            })
          } catch (_) { /* best-effort */ }
        }
      }
    }
    return json({ order_number: orderNumber, total, discount, payment_method: paymentMethod })
  }

  // 9) Correo de confirmación (contraentrega; no debe tumbar el pedido si falla).
  const totals = { subtotal, shipping, discount, total }
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  const FROM  = Deno.env.get('RESEND_FROM') ?? 'Hebennus <onboarding@resend.dev>'
  const STORE = Deno.env.get('STORE_EMAIL')
  let emailSent = false
  let emailError: string | null = null
  if (RESEND_API_KEY) {
    // Correo al cliente.
    try {
      await enviarResend(RESEND_API_KEY, {
        from: FROM,
        to: [c.customer_email.trim()],
        subject: `Confirmación de tu pedido ${orderNumber} — Hebennus`,
        html: buildHtml(rpcPayload.cliente, items, totals, orderNumber, 'cliente'),
        reply_to: STORE || undefined,
      })
      emailSent = true
    } catch (e) { emailError = (e as Error).message }
    // Copia a la tienda (independiente: se manda aunque la del cliente falle).
    if (STORE) {
      try {
        await enviarResend(RESEND_API_KEY, {
          from: FROM,
          to: [STORE],
          subject: `Nuevo pedido ${orderNumber} — ${c.customer_name}`,
          html: buildHtml(rpcPayload.cliente, items, totals, orderNumber, 'tienda'),
          reply_to: c.customer_email.trim(),
        })
      } catch (e) { if (!emailError) emailError = 'store: ' + (e as Error).message }
    }
  } else {
    emailError = 'RESEND_API_KEY no configurada'
  }

  return json({ order_number: orderNumber, total, discount, email_sent: emailSent, email_error: emailError })
})
