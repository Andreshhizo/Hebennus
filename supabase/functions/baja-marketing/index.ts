// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: baja-marketing  (Fase 4 — Campañas de marketing)
// Da de baja a un contacto de la lista de correos. Función PÚBLICA (sin JWT):
// la abre el cliente desde el enlace del correo, así que no puede exigir login.
//   • GET  → clic en "Darme de baja" desde el correo: aplica la baja y responde
//            una página HTML de confirmación (buildHtmlBaja).
//   • POST → one-click List-Unsubscribe (RFC 8058): el cliente de correo la llama
//            en segundo plano; aplica la baja y responde 200 corto (texto plano).
//   El token viaja en la query (?token=<uuid>). La baja es idempotente: solo marca
//   `unsubscribed_at` si aún estaba NULL. Token inválido/inexistente o 'preview'
//   (usado en el correo de PRUEBA) → responde el mismo mensaje neutro, SIN revelar
//   si el contacto existía. No usa Resend.
//
// Deploy: supabase functions deploy baja-marketing --no-verify-jwt
//   (--no-verify-jwt: el enlace del correo no lleva Authorization; no hay dato
//    sensible que exponer — la baja solo requiere conocer el token del contacto.)
// Secrets: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildHtmlBaja } from '../_shared/email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

// Aplica la baja (idempotente). Token ausente/'preview' → no hace nada.
async function aplicarBaja(token: string): Promise<void> {
  if (!token || token === 'preview') return
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey)
    await admin
      .from('marketing_contacts')
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq('unsubscribe_token', token)
      .is('unsubscribed_at', null)
  } catch (e) {
    // Best-effort: no revelamos el error al cliente (respondemos igual el mensaje neutro).
    console.error('[baja-marketing] Error al aplicar la baja:', (e as Error).message)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const token = new URL(req.url).searchParams.get('token') ?? ''

  // POST → one-click List-Unsubscribe: aplica la baja y responde 200 corto.
  if (req.method === 'POST') {
    await aplicarBaja(token)
    return new Response('OK', { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' } })
  }

  // GET → clic desde el correo: aplica la baja y muestra la página de confirmación.
  if (req.method === 'GET') {
    await aplicarBaja(token)
    return new Response(buildHtmlBaja(), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  return new Response('Método no permitido', { status: 405, headers: corsHeaders })
})
