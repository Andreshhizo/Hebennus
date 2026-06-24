// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: izipay-token
// Genera el TOKEN DE SESIÓN de Izipay (Web Core) en el SERVIDOR.
// El merchantCode y la public key se leen de secrets; el frontend solo recibe el token.
//
// Secrets (supabase secrets set ...):
//   IZIPAY_MERCHANT_CODE   (obligatorio)
//   IZIPAY_PUBLIC_KEY      (obligatorio)
//   IZIPAY_API_URL         (opcional; por defecto el sandbox)
//
// ⚠️ VERIFICA contra el panel/Postman de TU cuenta Izipay el contrato exacto del
// endpoint generate_token (ruta, headers y body). Aquí se usa el shape documentado
// del Web Core; algunos comercios requieren credenciales/headers adicionales.
//
// Deploy:  supabase functions deploy izipay-token
// ─────────────────────────────────────────────────────────────────────────────

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

  const API_URL  = Deno.env.get('IZIPAY_API_URL') ?? 'https://sandbox-api-pw.izipay.pe'
  const MERCHANT = Deno.env.get('IZIPAY_MERCHANT_CODE')
  const PUBLIC   = Deno.env.get('IZIPAY_PUBLIC_KEY')
  if (!MERCHANT || !PUBLIC) return json({ error: 'Faltan credenciales de Izipay (secrets)' }, 500)

  let body: { amount?: string | number; orderNumber?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'JSON inválido' }, 400)
  }
  if (body.amount === undefined || body.amount === null) {
    return json({ error: 'Falta el monto (amount)' }, 400)
  }

  const transactionId = Date.now().toString() // único por transacción (hasta 14 dígitos)
  const orderNumber = String(body.orderNumber ?? transactionId)

  const payload = {
    requestSource: 'ECOMMERCE',
    merchantCode: MERCHANT,
    orderNumber,
    publicKey: PUBLIC,
    amount: String(body.amount),
  }

  let r: Response
  try {
    r = await fetch(`${API_URL}/security/v1/Token/Generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', transactionId },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    return json({ error: 'No se pudo contactar a Izipay', detail: String(err) }, 502)
  }

  const data = await r.json().catch(() => null)
  const token = data?.response?.token ?? data?.token
  if (!r.ok || !token) {
    return json({ error: 'No se pudo generar el token de Izipay', status: r.status, detail: data }, 502)
  }

  return json({ token, transactionId, orderNumber })
})
