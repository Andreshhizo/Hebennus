// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: check-email  (corre en el servidor)
//   Verifica si un correo YA existe en el sistema (auth.users). Se usa en el flujo
//   "olvidé mi contraseña" para NO decir "te enviamos un código" cuando el correo
//   no está registrado (Supabase, por anti-enumeración, nunca lo revela).
//
//   Consulta auth.users vía la función SQL SECURITY DEFINER `public.email_existe`,
//   llamada con la service_role (que vive SOLO aquí). Devuelve { exists: boolean }.
//
//   Nota de seguridad: expone un chequeo de existencia de correo (vector de
//   enumeración). Es una decisión de producto del dueño; para el volumen de la
//   tienda es aceptable. Los rate-limits de Supabase/Cloudflare mitigan el abuso.
//
// Secrets: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
// Deploy:  supabase functions deploy check-email --no-verify-jwt
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  let body: { email?: string }
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }

  const email = String(body?.email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Correo inválido' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  const { data, error } = await admin.rpc('email_existe', { p_email: email })
  if (error) return json({ error: 'No se pudo verificar el correo', detail: error.message }, 500)

  return json({ exists: data === true })
})
