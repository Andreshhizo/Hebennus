// ─── IZIPAY (Web Core, formulario embebido) ─────────────────────────────────
// Helper de frontend:
//   • loadIzipaySdk()      → inyecta el <script> del SDK una sola vez.
//   • generateIzipayToken()→ pide el token de sesión a la Edge Function `izipay-token`
//                            (que lo genera en el servidor; la clave nunca está aquí).
// El render del formulario y el callback se manejan en CheckoutPage con
// `new window.Izipay({ config }).LoadForm({ authorization, keyRSA, callbackResponse })`.

import { supabase } from './supabase.js'
import { IZIPAY_SDK_URL } from './config.js'

let sdkPromise = null

export function loadIzipaySdk() {
  if (typeof window !== 'undefined' && window.Izipay) return Promise.resolve()
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = IZIPAY_SDK_URL
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { sdkPromise = null; reject(new Error('No se pudo cargar el SDK de Izipay')) }
    document.head.appendChild(s)
  })
  return sdkPromise
}

export async function generateIzipayToken({ amount, orderNumber }) {
  const { data, error } = await supabase.functions.invoke('izipay-token', {
    body: { amount, orderNumber },
  })
  if (error) throw error
  if (!data?.token) throw new Error(data?.error || 'No se obtuvo el token de Izipay')
  return data // { token, transactionId }
}
