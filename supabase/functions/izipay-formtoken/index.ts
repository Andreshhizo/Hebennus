// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: izipay-formtoken  (corre en el servidor)
//   Genera el formToken de Izipay/Lyra (Embedded Form / Web Core V4) a partir de
//   un pedido YA creado (por create-order con payment_method='izipay', estado
//   'pendiente' y stock diferido). El front llama aquí con el order_number, recibe
//   el formToken + publicKey + endpoint y monta el formulario de pago.
//
//   Las credenciales (USERNAME/PASSWORD = autenticación HTTP Basic contra la API
//   REST de Lyra) viven SOLO aquí; el navegador solo recibe el formToken y la
//   public key (que es pública por diseño).
//
// Secrets: IZIPAY_USERNAME, IZIPAY_PASSWORD, IZIPAY_PUBLIC_KEY.
//          SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
// Deploy:  supabase functions deploy izipay-formtoken
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

// Separa "Nombre Apellido(s)" en firstName / lastName para billingDetails.
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  let body: { order_number?: string }
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }

  const orderNumber = String(body?.order_number ?? '').trim()
  if (!orderNumber) return json({ error: 'Falta order_number' }, 400)

  const USERNAME   = Deno.env.get('IZIPAY_USERNAME')
  const PASSWORD   = Deno.env.get('IZIPAY_PASSWORD')
  const PUBLIC_KEY = Deno.env.get('IZIPAY_PUBLIC_KEY')
  if (!USERNAME || !PASSWORD || !PUBLIC_KEY) {
    console.error('[izipay-formtoken] Faltan secrets IZIPAY_USERNAME/PASSWORD/PUBLIC_KEY')
    return json({ error: 'Pasarela no configurada' }, 500)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  // Leer el pedido por order_number (datos validados en create-order).
  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('total, customer_email, customer_name, doc_numero, customer_phone, notes')
    .eq('order_number', orderNumber)
    .maybeSingle()

  if (orderError) {
    console.error('[izipay-formtoken] Error leyendo pedido:', orderError.message)
    return json({ error: 'No se pudo leer el pedido' }, 500)
  }
  if (!order) return json({ error: 'Pedido no encontrado' }, 404)

  const total = Number(order.total)
  if (!(total > 0)) return json({ error: 'Monto de pedido inválido' }, 400)

  const { firstName, lastName } = splitName(order.customer_name)

  // amount va en CÉNTIMOS (S/ 1.00 → 100).
  const izipayBody = {
    amount: Math.round(total * 100),
    currency: 'PEN',
    orderId: orderNumber,
    customer: {
      email: order.customer_email,
      billingDetails: {
        firstName,
        lastName,
        phoneNumber: order.customer_phone,
        identityType: 'DNI',
        identityCode: order.doc_numero ?? '',
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
    console.error('[izipay-formtoken] No se pudo contactar a Izipay:', String(err))
    return json({ error: 'No se pudo contactar a la pasarela de pago' }, 502)
  }

  const data = await r.json().catch(() => null)
  const formToken = data?.answer?.formToken

  if (data?.status === 'SUCCESS' && formToken) {
    return json({ formToken, publicKey: PUBLIC_KEY, endpoint: IZIPAY_ENDPOINT })
  }

  // Loguear el detalle real solo en consola; nunca exponerlo crudo al navegador.
  console.error('[izipay-formtoken] CreatePayment no exitoso:', r.status, JSON.stringify(data))
  return json({ error: 'No se pudo iniciar el pago' }, 502)
})
