// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: create-order
// Operación sensible del checkout (corre en el servidor):
//   1) Inserta el pedido + ítems de forma ATÓMICA vía RPC public.create_order.
//   2) Envía el correo de confirmación (cliente + copia a la tienda) por Resend.
//   3) Devuelve { order_number }.
// La service_role y la RESEND_API_KEY viven SOLO aquí; nunca llegan al navegador.
//
// Secrets (supabase secrets set ...):
//   RESEND_API_KEY  (obligatorio)
//   RESEND_FROM     (remitente verificado, ej. "Hebennus <pedidos@tudominio.com>")
//   STORE_EMAIL     (opcional, copia del pedido a la tienda)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase automáticamente.
//
// Deploy:  supabase functions deploy create-order
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
  }
  items: ItemPedido[]
  subtotal: number
  shipping: number
  total: number
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

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function buildHtml(pedido: Pedido, orderNumber: string, dest: 'cliente' | 'tienda'): string {
  const c = pedido.cliente
  const filas = pedido.items.map((it) => {
    const color = it.color ? ` / ${escapeHtml(it.color)}` : ''
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;">${escapeHtml(it.name)}
        <span style="color:#888;"> — Talla ${escapeHtml(it.size)}${color} × ${it.qty}</span></td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">S/ ${Number(it.subtotal).toFixed(2)}</td>
    </tr>`
  }).join('')

  const intro = dest === 'cliente'
    ? `¡Gracias por tu pedido! Tu número de pedido es <strong>${escapeHtml(orderNumber)}</strong>.`
    : `Nuevo pedido <strong>${escapeHtml(orderNumber)}</strong> de ${escapeHtml(c.customer_name)}.`

  const envio = pedido.shipping > 0 ? `S/ ${Number(pedido.shipping).toFixed(2)}` : 'Gratis'

  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#0b0f1a;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <h1 style="font-size:22px;letter-spacing:3px;margin:0 0 4px;">HEBENNUS</h1>
    <p style="color:#5b8def;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:0 0 24px;">Confirmación de pedido · ${escapeHtml(orderNumber)}</p>
    <p style="font-size:14px;line-height:1.6;">${intro}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
      ${filas}
      <tr><td style="padding:8px 0;color:#555;">Subtotal</td><td style="padding:8px 0;text-align:right;color:#555;">S/ ${Number(pedido.subtotal).toFixed(2)}</td></tr>
      <tr><td style="padding:0 0 8px;color:#555;">Envío</td><td style="padding:0 0 8px;text-align:right;color:#555;">${envio}</td></tr>
      <tr><td style="padding:12px 0;font-weight:bold;border-top:1px solid #ddd;">TOTAL</td>
          <td style="padding:12px 0;text-align:right;font-weight:bold;border-top:1px solid #ddd;">S/ ${Number(pedido.total).toFixed(2)}</td></tr>
    </table>
    <h2 style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#888;margin:24px 0 8px;">Datos de envío · Pago contraentrega</h2>
    <p style="font-size:14px;line-height:1.7;margin:0;">
      ${escapeHtml(c.customer_name)}<br/>
      ${escapeHtml(c.customer_email)} · ${escapeHtml(c.customer_phone)}<br/>
      ${escapeHtml(c.notes ?? '')}
    </p>
    <p style="font-size:12px;color:#888;margin-top:32px;">Te contactaremos para coordinar la entrega. — Hebennus, Lima.</p>
  </div></body></html>`
}

async function enviarResend(apiKey: string, payload: Record<string, unknown>): Promise<void> {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  let pedido: Pedido
  try {
    pedido = await req.json()
  } catch {
    return json({ error: 'JSON inválido' }, 400)
  }

  // Validación mínima del payload.
  const c = pedido?.cliente
  const emailOk = typeof c?.customer_email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.customer_email)
  const phoneOk = typeof c?.customer_phone === 'string' && /^\d{9}$/.test(c.customer_phone)
  if (!c?.customer_name?.trim() || !emailOk || !phoneOk || !Array.isArray(pedido.items) || pedido.items.length === 0) {
    return json({ error: 'Pedido inválido' }, 400)
  }

  // 1) Inserción atómica vía RPC (service_role, solo servidor).
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  const { data: result, error: rpcError } = await admin.rpc('create_order', { payload: pedido })
  if (rpcError) {
    return json({ error: 'No se pudo registrar el pedido', detail: rpcError.message }, 500)
  }
  const orderNumber: string = result?.order_number ?? '—'

  // 2) Correo de confirmación (no debe tumbar el pedido si el correo falla).
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  const FROM  = Deno.env.get('RESEND_FROM') ?? 'Hebennus <onboarding@resend.dev>'
  const STORE = Deno.env.get('STORE_EMAIL')
  let emailSent = false
  if (RESEND_API_KEY) {
    try {
      await enviarResend(RESEND_API_KEY, {
        from: FROM,
        to: [pedido.cliente.customer_email],
        subject: `Confirmación de tu pedido ${orderNumber} — Hebennus`,
        html: buildHtml(pedido, orderNumber, 'cliente'),
        reply_to: STORE || undefined,
      })
      if (STORE) {
        await enviarResend(RESEND_API_KEY, {
          from: FROM,
          to: [STORE],
          subject: `Nuevo pedido ${orderNumber} — ${pedido.cliente.customer_name}`,
          html: buildHtml(pedido, orderNumber, 'tienda'),
          reply_to: pedido.cliente.customer_email,
        })
      }
      emailSent = true
    } catch (_) {
      emailSent = false
    }
  }

  return json({ order_number: orderNumber, email_sent: emailSent })
})
