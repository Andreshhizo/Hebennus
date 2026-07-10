// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: admin-notificar-envio
// Avisa al cliente por correo que su pedido va en camino. Solo un admin la llama.
//   1) Verifica el JWT del que llama → debe estar en la tabla `admins`.
//   2) Lee el pedido (service_role) y manda el correo de "en camino" vía Resend.
// Best-effort: si Resend falla, responde 200 con email_sent:false (no bloquea el
// cambio de estado, que ya se guardó vía la RPC admin_set_order_status).
//
// Deploy: supabase functions deploy admin-notificar-envio   (verify_jwt=true)
// Secrets: RESEND_API_KEY, RESEND_FROM, STORE_EMAIL (ya configurados).
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildHtmlEstado, enviarResend } from '../_shared/email.ts'

// Estados que llevan correo al cliente + su asunto.
const ASUNTOS: Record<string, string> = {
  confirmado: 'Recibimos tu pedido',
  enviado:    'Tu pedido va en camino 🚚',
  entregado:  '¡Tu pedido fue entregado! 🎉',
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  let body: { order_number?: string; status?: string }
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }
  const orderNumber = String(body?.order_number ?? '').trim()
  const status = String(body?.status ?? 'enviado').trim()
  if (!orderNumber) return json({ error: 'Falta order_number' }, 400)
  // Estados sin correo: responder OK sin enviar (no es error).
  if (!ASUNTOS[status]) return json({ ok: true, email_sent: false, skipped: true })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  // 1) ¿Quién llama? (su JWT) → debe ser admin.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: caller } = await admin.auth.getUser(jwt)
  if (!caller?.user) return json({ error: 'No autenticado' }, 401)
  const { data: adminRow } = await admin
    .from('admins').select('user_id').eq('user_id', caller.user.id).maybeSingle()
  if (!adminRow) return json({ error: 'No autorizado: solo admins' }, 403)

  // 2) Leer el pedido.
  const { data: order, error: e } = await admin
    .from('orders')
    .select('order_number, customer_name, customer_email')
    .eq('order_number', orderNumber)
    .maybeSingle()
  if (e) return json({ error: 'No se pudo leer el pedido', detail: e.message }, 500)
  if (!order) return json({ error: 'Pedido no encontrado' }, 404)

  // 3) Enviar el correo (best-effort: no falla el request si Resend falla).
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  const FROM  = Deno.env.get('RESEND_FROM') ?? 'Hebennus <onboarding@resend.dev>'
  const STORE = Deno.env.get('STORE_EMAIL')
  if (!RESEND_API_KEY) return json({ ok: true, email_sent: false, email_error: 'RESEND_API_KEY no configurada' })

  try {
    await enviarResend(RESEND_API_KEY, {
      from: FROM,
      to: [String(order.customer_email).trim()],
      subject: `${ASUNTOS[status]} · ${order.order_number} — Hebennus`,
      html: buildHtmlEstado(order.customer_name ?? '', order.order_number, status),
      reply_to: STORE || undefined,
    })
    return json({ ok: true, email_sent: true })
  } catch (err) {
    return json({ ok: true, email_sent: false, email_error: (err as Error).message })
  }
})
