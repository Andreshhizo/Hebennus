// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: create-ticket  (corre en el servidor)
//   1) Valida el payload del reclamo (nombre, email, mensaje).
//   2) Identifica al usuario por su JWT (si inició sesión) → vincula el reclamo.
//   3) Inserta el reclamo vía RPC create_ticket (service_role, omite RLS).
//   4) Envía 2 correos best-effort (tienda + copia al remitente) vía _shared/email.ts.
// La service_role y la RESEND_API_KEY viven SOLO aquí; nunca llegan al navegador.
//
// Secrets: RESEND_API_KEY (obligatorio para correo), RESEND_FROM, STORE_EMAIL.
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
// Deploy: supabase functions deploy create-ticket
// verify_jwt por defecto = true; se llama desde el navegador con la anon key,
// igual que create-order.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildHtmlReclamo, enviarResend } from '../_shared/email.ts'

interface Reclamo {
  name?: string
  email?: string
  phone?: string | null
  order_number?: string | null
  category?: string | null
  message?: string
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

// Recorta un string largo a `max` caracteres (o null si no es string).
const recorta = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  let body: Reclamo
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }

  // ── Validación del payload ──
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  if (!name) return json({ error: 'El nombre es obligatorio' }, 400)
  if (!emailOk) return json({ error: 'Email inválido' }, 400)
  if (!message) return json({ error: 'El mensaje es obligatorio' }, 400)
  if (message.length > 2000) return json({ error: 'El mensaje es demasiado largo (máx 2000)' }, 400)

  // Campos opcionales (recortados por seguridad).
  const nombre       = name.slice(0, 120)
  const telefono     = recorta(body?.phone, 40)
  const orderNumber  = recorta(body?.order_number, 40)
  const categoria    = recorta(body?.category, 60)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  // Usuario por JWT (si inició sesión; si es anon, queda null).
  let userId: string | null = null
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (jwt) {
    try { const { data } = await admin.auth.getUser(jwt); userId = data.user?.id ?? null } catch { /* anon */ }
  }

  // Inserción vía RPC (service_role omite RLS).
  const { data, error } = await admin.rpc('create_ticket', {
    payload: {
      name: nombre,
      email,
      phone: telefono,
      order_number: orderNumber,
      category: categoria,
      message: message.slice(0, 2000),
      user_id: userId,
    },
  })
  if (error) {
    // No exponer el mensaje interno de Postgres/RPC al cliente; solo en servidor.
    console.error('[create-ticket] Error en RPC create_ticket:', error.message)
    return json({ error: 'No se pudo registrar el reclamo' }, 500)
  }
  const ticketNumber: string = data?.ticket_number ?? '—'

  // ── Correos best-effort (no deben tumbar el reclamo si Resend falla) ──
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  const FROM  = Deno.env.get('RESEND_FROM') ?? 'Hebennus <onboarding@resend.dev>'
  const STORE = Deno.env.get('STORE_EMAIL')
  const ticket = {
    ticket_number: ticketNumber,
    name: nombre,
    email,
    phone: telefono,
    order_number: orderNumber,
    category: categoria,
    message: message.slice(0, 2000),
  }
  if (RESEND_API_KEY) {
    // Aviso a la tienda (con todos los datos; responder al cliente).
    if (STORE) {
      try {
        await enviarResend(RESEND_API_KEY, {
          from: FROM,
          to: [STORE],
          subject: `Nuevo reclamo ${ticketNumber} — ${nombre}`,
          html: buildHtmlReclamo(ticket, 'tienda'),
          reply_to: email,
        })
      } catch (_) { /* best-effort */ }
    }
    // Copia al remitente (acuse de recibo).
    try {
      await enviarResend(RESEND_API_KEY, {
        from: FROM,
        to: [email],
        subject: `Recibimos tu reclamo ${ticketNumber} — Hebennus`,
        html: buildHtmlReclamo(ticket, 'cliente'),
        reply_to: STORE || undefined,
      })
    } catch (_) { /* best-effort */ }
  }

  return json({ ticket_number: ticketNumber })
})
