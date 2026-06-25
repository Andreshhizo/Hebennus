// ─── CREACIÓN DE PEDIDO ──────────────────────────────────────────────────────
// La página de checkout llama a createOrder(pedido). La operación sensible
// (insertar en orders + order_items de forma atómica y enviar el correo) corre
// en la Edge Function `create-order`, que usa la service_role en el SERVIDOR.
// Aquí (navegador) nunca se exponen claves de servicio.
//
// En desarrollo (`npm run dev`), si la función aún no está desplegada se usa un
// stub para poder probar el flujo completo. En producción los errores se propagan.

import { supabase } from './supabase.js'
import { FunctionsHttpError } from '@supabase/supabase-js'

export async function createOrder(pedido) {
  const { data, error } = await supabase.functions.invoke('create-order', { body: pedido })

  // La función SÍ corrió y devolvió un status no-2xx: es un error REAL del
  // backend (validación, RLS, etc.). Propagar siempre, incluso en DEV.
  if (error instanceof FunctionsHttpError) {
    let mensaje = error.message
    try {
      const cuerpo = await error.context.json()
      if (cuerpo?.error) mensaje = cuerpo.error
    } catch {
      // El cuerpo no es JSON parseable; conservamos error.message.
    }
    console.error('[Hebennus] create-order devolvió error del backend:', mensaje)
    throw new Error(mensaje)
  }

  // Errores de conectividad: la función está inalcanzable / no desplegada
  // (FunctionsFetchError, FunctionsRelayError). Solo aquí cae el stub en DEV.
  if (error) {
    if (import.meta.env.DEV) {
      console.error('[Hebennus] create-order inalcanzable — stub en dev:', error?.message ?? error)
      console.info('[Hebennus] Pedido (stub):', pedido)
      return { order_number: 'HB-DEV001', stub: true }
    }
    throw error
  }

  // Error de negocio devuelto en el cuerpo de una respuesta 2xx: nunca stub.
  if (data?.error) {
    console.error('[Hebennus] create-order devolvió error de negocio:', data.error)
    throw new Error(data.error)
  }

  return data // { order_number, ... }
}
