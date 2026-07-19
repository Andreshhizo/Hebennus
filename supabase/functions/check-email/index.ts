// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: check-email  (corre en el servidor)
//   Endpoint de compatibilidad del flujo de recuperación. Nunca revela si un
//   correo existe: para clientes antiguos responde `exists: true` a cualquier
//   dirección válida; el frontend nuevo llama directamente al recovery de Auth,
//   que ya aplica anti-enumeración.
//
// Secrets: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
// Deploy:  supabase functions deploy check-email --no-verify-jwt
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  assertAllowedOrigin,
  corsHeaders,
  enforceRateLimit,
  handleRequestError,
  jsonResponse,
  readJsonLimited,
} from '../_shared/security.ts'

Deno.serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
    assertAllowedOrigin(req)
    if (req.method !== 'POST') return jsonResponse(req, { error: 'Método no permitido' }, 405)

    const body = await readJsonLimited<{ email?: string }>(req, 4_096)
    const email = String(body?.email ?? '').trim().toLowerCase()
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse(req, { error: 'Correo inválido' }, 400)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    await enforceRateLimit(admin, req, 'check-email', 10, 600)

    // Compatibilidad sin enumeración: la respuesta es idéntica exista o no.
    return jsonResponse(req, { accepted: true, exists: true })
  } catch (error) {
    return handleRequestError(req, error)
  }
})
