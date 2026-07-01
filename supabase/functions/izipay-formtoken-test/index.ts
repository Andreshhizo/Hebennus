// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: izipay-formtoken-test  (SOLO DESARROLLO)
//   Genera un formToken de Izipay para PROBAR métodos/escenarios de pago SIN crear
//   un pedido real ni tocar la BD ni el stock. Usa un orderId ficticio (TEST-...) y
//   datos de cliente de prueba. Lo usa la página /lab-pagos (que solo existe en dev).
//
//   ⚠️ NO DESPLEGAR EN PRODUCCIÓN. Solo se despliega en el proyecto de desarrollo.
//
// Secrets: IZIPAY_USERNAME, IZIPAY_PASSWORD, IZIPAY_PUBLIC_KEY (los mismos de dev/test).
// Deploy (solo dev): supabase functions deploy izipay-formtoken-test --project-ref <dev>
// ─────────────────────────────────────────────────────────────────────────────

const IZIPAY_ENDPOINT = 'https://api.micuentaweb.pe'

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

  let body: { amount?: number }
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }

  // Monto en SOLES (lo convertimos a céntimos). Default S/ 59.90.
  const soles = Number(body?.amount)
  const monto = Number.isFinite(soles) && soles > 0 ? soles : 59.9

  const USERNAME   = Deno.env.get('IZIPAY_USERNAME')
  const PASSWORD   = Deno.env.get('IZIPAY_PASSWORD')
  const PUBLIC_KEY = Deno.env.get('IZIPAY_PUBLIC_KEY')
  if (!USERNAME || !PASSWORD || !PUBLIC_KEY) {
    console.error('[izipay-formtoken-test] Faltan secrets IZIPAY_USERNAME/PASSWORD/PUBLIC_KEY')
    return json({ error: 'Pasarela no configurada' }, 500)
  }

  // Pedido ficticio: NO se guarda en la BD. Solo sirve para abrir el formulario.
  const orderId = `TEST-${Date.now()}`

  const izipayBody = {
    amount: Math.round(monto * 100),   // céntimos
    currency: 'PEN',
    orderId,
    customer: {
      email: 'test@hebennus.dev',
      billingDetails: {
        firstName: 'Prueba',
        lastName: 'Test',
        phoneNumber: '999999999',
        identityType: 'DNI',
        identityCode: '12345678',
        country: 'PE',
        language: 'es',
      },
    },
  }

  let r: Response
  try {
    r = await fetch(`${IZIPAY_ENDPOINT}/api-payment/V4/Charge/CreatePayment`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${USERNAME}:${PASSWORD}`),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(izipayBody),
    })
  } catch (err) {
    console.error('[izipay-formtoken-test] No se pudo contactar a Izipay:', String(err))
    return json({ error: 'No se pudo contactar a la pasarela de pago' }, 502)
  }

  const data = await r.json().catch(() => null)
  const formToken = data?.answer?.formToken

  if (data?.status === 'SUCCESS' && formToken) {
    // apiResponse: respuesta cruda de CreatePayment (para mostrarla en el lab de dev).
    return json({ formToken, publicKey: PUBLIC_KEY, endpoint: IZIPAY_ENDPOINT, orderId, amount: monto, apiResponse: data })
  }

  console.error('[izipay-formtoken-test] CreatePayment no exitoso:', r.status, JSON.stringify(data))
  return json({ error: 'No se pudo iniciar el pago de prueba' }, 502)
})
