// Entrada pública rate-limited para métricas de producto. La RPC subyacente ya
// no está expuesta a anon/authenticated, así que el límite no puede saltarse con
// una llamada REST directa.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  assertAllowedOrigin,
  corsHeaders,
  enforceRateLimit,
  handleRequestError,
  jsonResponse,
  readJsonLimited,
} from '../_shared/security.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
    assertAllowedOrigin(req)
    if (req.method !== 'POST') return jsonResponse(req, { error: 'Método no permitido' }, 405)

    const body = await readJsonLimited<{ product_id?: string }>(req, 4_096)
    const productId = String(body?.product_id ?? '').trim()
    if (!UUID_RE.test(productId)) return jsonResponse(req, { error: 'Producto inválido' }, 400)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    await enforceRateLimit(admin, req, 'track-product-view', 120, 3600)

    const { error } = await admin.rpc('log_product_view', { p_product_id: productId })
    if (error) {
      console.error('[track-product-view] log_product_view:', error.message)
      return jsonResponse(req, { error: 'No se pudo registrar la vista' }, 500)
    }
    return jsonResponse(req, { accepted: true }, 202)
  } catch (error) {
    return handleRequestError(req, error)
  }
})
