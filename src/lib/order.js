// ─── CREACIÓN DE PEDIDO ──────────────────────────────────────────────────────
// La página de checkout llama a createOrder(pedido). La operación sensible
// (insertar en orders + order_items de forma atómica y enviar el correo) corre
// en la Edge Function `create-order`, que usa la service_role en el SERVIDOR.
// Aquí (navegador) nunca se exponen claves de servicio.
//
// En desarrollo (`npm run dev`), si la función aún no está desplegada se usa un
// stub para poder probar el flujo completo. En producción los errores se propagan.

import { supabase } from './supabase.js'

export async function createOrder(pedido) {
  try {
    const { data, error } = await supabase.functions.invoke('create-order', { body: pedido })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
    return data // { order_number }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[Hebennus] create-order no disponible — stub en dev:', err?.message ?? err)
      console.info('[Hebennus] Pedido (stub):', pedido)
      return { order_number: 'HB-DEV001', stub: true }
    }
    throw err
  }
}
