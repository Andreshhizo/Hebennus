// ─── ENVÍO DE RECLAMO / TICKET DE SOPORTE ────────────────────────────────────
// El widget público (SoporteWidget) llama a enviarReclamo(payload). La operación
// sensible (insertar el ticket + enviar la copia por correo) corre en la Edge
// Function `create-ticket`, que usa la service_role en el SERVIDOR. Aquí
// (navegador) nunca se exponen claves de servicio.
//
// Espejo de create-order (order.js): distingue error del backend
// (FunctionsHttpError), errores de conexión y errores de negocio en un 2xx.

import { supabase } from './supabase.js'
import { FunctionsHttpError } from '@supabase/supabase-js'

const pendingKeys = new Map()
const newKey = () => globalThis.crypto?.randomUUID?.()
  ?? `hb-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`

export async function enviarReclamo(payload) {
  const fingerprint = JSON.stringify(payload)
  const idempotencyKey = pendingKeys.get(fingerprint) ?? newKey()
  pendingKeys.set(fingerprint, idempotencyKey)
  const { data, error } = await supabase.functions.invoke('create-ticket', {
    body: payload,
    headers: { 'Idempotency-Key': idempotencyKey },
  })

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
    console.error('[Hebennus] create-ticket devolvió error del backend:', mensaje)
    throw new Error(mensaje)
  }

  // Errores de conectividad: la función está inalcanzable / no desplegada
  // (FunctionsFetchError, FunctionsRelayError).
  if (error) {
    console.error('[Hebennus] create-ticket inalcanzable:', error?.message ?? error)
    throw new Error('No pudimos enviar tu reclamo. Revisa tu conexión e inténtalo de nuevo.')
  }

  // Error de negocio devuelto en el cuerpo de una respuesta 2xx.
  if (data?.error) {
    console.error('[Hebennus] create-ticket devolvió error de negocio:', data.error)
    throw new Error(data.error)
  }

  pendingKeys.delete(fingerprint)
  return data // { ticket_number }
}
