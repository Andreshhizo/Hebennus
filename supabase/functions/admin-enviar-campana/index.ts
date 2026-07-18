// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: admin-enviar-campana  (Fase 4 — Campañas de marketing)
// Envía un correo masivo (novedades/promos) a los contactos con consentimiento.
// Solo un admin la llama.
//   1) Verifica el JWT del que llama → debe estar en la tabla `admins`.
//   2) test=true → manda UN correo de prueba a STORE_EMAIL (no registra campaña).
//   3) Envío real → lee los destinatarios elegibles (consent = true AND
//      unsubscribed_at IS NULL), trocea en lotes de ≤100 y envía con la Batch API
//      de Resend. Cada correo lleva su enlace de baja + cabecera List-Unsubscribe.
//      Registra la campaña en `campaigns` (service_role omite RLS).
// Best-effort: nunca tumba el request por un fallo de Resend; cuenta sent/failed.
//
// Contrato (para el frontend):
//   POST admin-enviar-campana  { subject, title?, body, cta_text?, cta_url?, test? }
//   → test:  { ok:true, test:true, sent:1 }
//   → real:  { ok:true, recipients, sent, failed, campaign_id }
//
// Deploy: supabase functions deploy admin-enviar-campana   (verify_jwt=true)
// Secrets: RESEND_API_KEY, RESEND_FROM, STORE_EMAIL (ya configurados).
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildHtmlCampana, enviarResend, enviarResendBatch } from '../_shared/email.ts'

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

// Trocea un array en lotes de tamaño `size`.
function enLotes<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  // 0) Leer y validar el cuerpo.
  let body: {
    subject?: string
    title?: string
    body?: string
    cta_text?: string
    cta_url?: string
    test?: boolean
  }
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }

  const subject = String(body?.subject ?? '').trim().slice(0, 150)
  const cuerpo  = String(body?.body ?? '').trim().slice(0, 5000)
  const title   = body?.title ? String(body.title).trim().slice(0, 150) : undefined
  const ctaText = body?.cta_text ? String(body.cta_text).trim().slice(0, 60) : undefined
  const ctaUrl  = body?.cta_url ? String(body.cta_url).trim().slice(0, 500) : undefined
  const esTest  = body?.test === true

  if (!subject) return json({ error: 'Falta el asunto' }, 400)
  if (!cuerpo)  return json({ error: 'Falta el contenido del correo' }, 400)

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

  // 2) Resend configurado.
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  const FROM  = Deno.env.get('RESEND_FROM') ?? 'Hebennus <onboarding@resend.dev>'
  const STORE = Deno.env.get('STORE_EMAIL')
  if (!RESEND_API_KEY) {
    return json({ ok: true, email_sent: false, email_error: 'RESEND_API_KEY no configurada' })
  }

  // 3) Prueba: un solo correo a STORE_EMAIL. No registra la campaña.
  if (esTest) {
    if (!STORE) return json({ error: 'STORE_EMAIL no configurada (destino de la prueba)' }, 400)
    const unsubscribeUrl = `${supabaseUrl}/functions/v1/baja-marketing?token=preview`
    try {
      await enviarResend(RESEND_API_KEY, {
        from: FROM,
        to: [STORE],
        subject: `[PRUEBA] ${subject}`,
        reply_to: STORE,
        html: buildHtmlCampana({ title, body: cuerpo, cta_text: ctaText, cta_url: ctaUrl, unsubscribeUrl }),
      })
      return json({ ok: true, test: true, sent: 1 })
    } catch (err) {
      return json({ ok: true, test: true, sent: 0, email_error: (err as Error).message })
    }
  }

  // 4) Envío real: destinatarios elegibles.
  const { data: contactos, error: e } = await admin
    .from('marketing_contacts')
    .select('email, name, unsubscribe_token')
    .eq('consent', true)
    .is('unsubscribed_at', null)
  if (e) return json({ error: 'No se pudo leer los contactos', detail: e.message }, 500)

  const destinatarios = (contactos ?? []).filter((c) => c.email)
  const recipients = destinatarios.length

  if (recipients === 0) {
    // Nadie a quien enviar: registramos una campaña vacía como 'enviada'.
    const { data: fila } = await admin
      .from('campaigns')
      .insert({
        subject, title: title ?? null, body: cuerpo,
        cta_text: ctaText ?? null, cta_url: ctaUrl ?? null,
        status: 'enviada', recipients_count: 0, sent_count: 0, failed_count: 0,
        created_by: caller.user.id,
      })
      .select('id').maybeSingle()
    return json({ ok: true, recipients: 0, sent: 0, failed: 0, campaign_id: fila?.id ?? null })
  }

  // 5) Armar y enviar por lotes de ≤100 (Batch API). Contamos sent/failed por lote.
  let sent = 0
  let failed = 0
  for (const lote of enLotes(destinatarios, 100)) {
    const mensajes = lote.map((c) => {
      const unsubscribeUrl = `${supabaseUrl}/functions/v1/baja-marketing?token=${c.unsubscribe_token}`
      return {
        from: FROM,
        to: [String(c.email).trim()],
        subject,
        reply_to: STORE || undefined,
        html: buildHtmlCampana({ title, body: cuerpo, cta_text: ctaText, cta_url: ctaUrl, unsubscribeUrl }),
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }
    })
    try {
      await enviarResendBatch(RESEND_API_KEY, mensajes)
      sent += lote.length
    } catch (err) {
      failed += lote.length
      console.error('[admin-enviar-campana] Lote falló:', (err as Error).message)
    }
  }

  // 6) Registrar la campaña. 'error' si no salió ninguno; si no, 'enviada'.
  const status = (sent === 0 && recipients > 0) ? 'error' : 'enviada'
  const { data: fila } = await admin
    .from('campaigns')
    .insert({
      subject, title: title ?? null, body: cuerpo,
      cta_text: ctaText ?? null, cta_url: ctaUrl ?? null,
      status, recipients_count: recipients, sent_count: sent, failed_count: failed,
      created_by: caller.user.id,
    })
    .select('id').maybeSingle()

  return json({ ok: true, recipients, sent, failed, campaign_id: fila?.id ?? null })
})
