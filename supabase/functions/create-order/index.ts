// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: create-order  (corre en el servidor)
//   1) Identifica al usuario por su JWT (si inició sesión) → vincula el pedido.
//   2) VALIDA precios contra la BD (no confía en el navegador).
//   3) VALIDA el 10% de bienvenida (solo usuario autenticado, 1ª compra).
//   4) Inserta pedido + ítems de forma atómica vía RPC create_order.
//   5) Guarda el contacto de marketing si dio consentimiento.
//   6) Envía el correo de confirmación (cliente + copia a la tienda) por Resend.
// La service_role y la RESEND_API_KEY viven SOLO aquí; nunca llegan al navegador.
//
// Secrets: RESEND_API_KEY (obligatorio para correo), RESEND_FROM, STORE_EMAIL.
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
// Deploy: supabase functions deploy create-order
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ENVIO_GRATIS_DESDE = 149
const COSTO_ENVIO        = 10
const WELCOME_PCT        = 0.10

interface ItemPedido {
  product_id?: string | null
  name: string
  size: string
  color: string | null
  qty: number
  unit_price: number
  subtotal: number
}
interface Pedido {
  cliente: {
    customer_name: string
    customer_phone: string
    customer_email: string
    notes?: string
    doc_tipo?: string | null
    doc_numero?: string | null
  }
  items: ItemPedido[]
  quiere_descuento?: boolean
  consent?: boolean
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

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function buildHtml(
  c: Pedido['cliente'],
  items: ItemPedido[],
  totals: { subtotal: number; shipping: number; discount: number; total: number },
  orderNumber: string,
  dest: 'cliente' | 'tienda',
): string {
  const filas = items.map((it) => {
    const color = it.color ? ` / ${escapeHtml(it.color)}` : ''
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;">${escapeHtml(it.name)}
        <span style="color:#888;"> — Talla ${escapeHtml(it.size)}${color} × ${it.qty}</span></td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">S/ ${it.subtotal.toFixed(2)}</td>
    </tr>`
  }).join('')

  const intro = dest === 'cliente'
    ? `¡Gracias por tu pedido! 🎉 Tu número de pedido es <strong>${escapeHtml(orderNumber)}</strong>. Lo estamos preparando con cariño.`
    : `Nuevo pedido <strong>${escapeHtml(orderNumber)}</strong> de ${escapeHtml(c.customer_name)}.`

  const envio = totals.shipping > 0 ? `S/ ${totals.shipping.toFixed(2)}` : 'Gratis'
  const filaDesc = totals.discount > 0
    ? `<tr><td style="padding:0 0 8px;color:#2ecc8f;">Descuento bienvenida (10%)</td><td style="padding:0 0 8px;text-align:right;color:#2ecc8f;">- S/ ${totals.discount.toFixed(2)}</td></tr>`
    : ''

  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#0b0f1a;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <h1 style="font-size:22px;letter-spacing:3px;margin:0 0 4px;">HEBENNUS</h1>
    <p style="color:#5b8def;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:0 0 24px;">Confirmación de pedido · ${escapeHtml(orderNumber)}</p>
    <p style="font-size:14px;line-height:1.6;">${intro}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
      ${filas}
      <tr><td style="padding:8px 0;color:#555;">Subtotal</td><td style="padding:8px 0;text-align:right;color:#555;">S/ ${totals.subtotal.toFixed(2)}</td></tr>
      ${filaDesc}
      <tr><td style="padding:0 0 8px;color:#555;">Envío</td><td style="padding:0 0 8px;text-align:right;color:#555;">${envio}</td></tr>
      <tr><td style="padding:12px 0;font-weight:bold;border-top:1px solid #ddd;">TOTAL</td>
          <td style="padding:12px 0;text-align:right;font-weight:bold;border-top:1px solid #ddd;">S/ ${totals.total.toFixed(2)}</td></tr>
    </table>
    <h2 style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#888;margin:24px 0 8px;">Datos de envío</h2>
    <p style="font-size:14px;line-height:1.7;margin:0;">
      ${escapeHtml(c.customer_name)}<br/>
      ${escapeHtml(c.customer_email)} · ${escapeHtml(c.customer_phone)}<br/>
      ${escapeHtml(c.notes ?? '')}
    </p>
    <p style="font-size:12px;color:#888;margin-top:32px;">Te contactaremos para coordinar la entrega. — Hebennus, Lima.</p>
  </div></body></html>`
}

async function enviarResend(apiKey: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 300)}`)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  let pedido: Pedido
  try { pedido = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }

  // Validación mínima del payload.
  const c = pedido?.cliente
  const emailOk = typeof c?.customer_email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.customer_email)
  const phoneOk = typeof c?.customer_phone === 'string' && /^\d{9}$/.test(c.customer_phone)
  if (!c?.customer_name?.trim() || !emailOk || !phoneOk || !Array.isArray(pedido.items) || pedido.items.length === 0) {
    return json({ error: 'Pedido inválido' }, 400)
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

  // 3) Envío (server-side).
  const shipping = subtotal === 0 || subtotal >= ENVIO_GRATIS_DESDE ? 0 : COSTO_ENVIO

  // 4) Descuento de bienvenida (server-side): solo usuario autenticado, 1ª compra.
  let discount = 0
  let discountReason: string | null = null
  if (userId && pedido.quiere_descuento) {
    const { count } = await admin.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', userId)
    if ((count ?? 0) === 0) { discount = round2(subtotal * WELCOME_PCT); discountReason = 'bienvenida_10' }
  }
  const total = Math.max(0, round2(subtotal + shipping - discount))

  // 5) Inserción atómica vía RPC (con valores ya validados).
  const rpcPayload = {
    cliente: {
      customer_name: c.customer_name.trim(),
      customer_phone: c.customer_phone,
      customer_email: c.customer_email.trim(),
      notes: c.notes ?? '',
      doc_tipo: c.doc_tipo ?? null,
      doc_numero: c.doc_numero ?? null,
      comprobante_tipo: 'boleta',
    },
    items,
    subtotal, shipping, discount, discount_reason: discountReason, total,
    user_id: userId,
  }
  const { data: result, error: rpcError } = await admin.rpc('create_order', { payload: rpcPayload })
  if (rpcError) return json({ error: 'No se pudo registrar el pedido', detail: rpcError.message }, 500)
  const orderNumber: string = result?.order_number ?? '—'

  // 6) Contacto de marketing (con consentimiento, Ley 29733).
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

  // 7) Correo de confirmación (no debe tumbar el pedido si falla).
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
