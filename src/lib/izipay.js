// ─── IZIPAY (Lyra / krypton, formulario embebido oficial) ────────────────────
// Flujo oficial de Lyra (Web Payment Form) sobre el endpoint de Izipay
// (api.micuentaweb.pe). Helpers de frontend:
//   • getFormToken()           → pide el formToken + public key a la Edge Function
//                                `izipay-formtoken` (las credenciales viven en el
//                                servidor; aquí nunca se exponen).
//   • montarFormularioIzipay() → carga la librería krypton, monta el formulario
//                                embebido y, al enviar, valida la respuesta firmada
//                                en `izipay-validate` antes de confirmar el pago.
//
// La librería remota la inyecta KRGlue desde el `endpoint` recibido del servidor.

import KRGlue from '@lyracom/embedded-form-glue'
import { supabase } from './supabase.js'

// Pide al backend el formToken de la orden ya creada (estado pendiente).
// Devuelve { formToken, publicKey, endpoint } o lanza si hay error.
export async function getFormToken(orderNumber) {
  const { data, error } = await supabase.functions.invoke('izipay-formtoken', {
    body: { order_number: orderNumber },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data // { formToken, publicKey, endpoint }
}

// Carga el TEMA visual de krypton (CSS + JS) una sola vez. Sin esto el formulario
// se ve crudo. Usamos el tema "classic" (el del ejemplo oficial de Izipay): se ve
// limpio para el formulario de tarjeta embebido dentro del popup nativo.
function cargarTemaIzipay(endpoint) {
  if (typeof document === 'undefined') return Promise.resolve()
  if (document.getElementById('kr-theme-js')) return Promise.resolve()
  // CSS del tema.
  const link = document.createElement('link')
  link.id = 'kr-theme-css'
  link.rel = 'stylesheet'
  link.href = `${endpoint}/static/js/krypton-client/V4.0/ext/classic-reset.css`
  document.head.appendChild(link)
  // JS del tema.
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.id = 'kr-theme-js'
    s.src = `${endpoint}/static/js/krypton-client/V4.0/ext/classic.js`
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('No se pudo cargar el tema de Izipay'))
    document.head.appendChild(s)
  })
}

// krypton (window.KR) es un SINGLETON global. Guardamos los callbacks vivos en una
// variable de módulo. Los handlers (onSubmit/onError/onPopinClosed) se registran en
// CADA montaje: krypton REEMPLAZA el onSubmit (no lo apila), y removeForms() puede
// quitar los handlers previos. Re-registrar evita que un 2º pago en la misma sesión
// reciba el "PAID" de Izipay sin que la UI avance (se quedaba colgado).
let callbacksIzipay = { onPaid: null, onPending: null, onError: null, onClosed: null, onResult: null, onOversold: null }

// Carga la librería krypton + el tema neon y renderiza el SMART FORM embebido en
// `selector` (un <div class="kr-smart-form"> dentro de nuestro propio modal). Muestra
// el monto y los métodos habilitados (tarjeta / Yape / QR). Al pagar, valida la
// respuesta firmada en el servidor y ejecuta onPaid() / onError().
//
// CLAVE (bug del monto): krypton conserva el PRIMER formulario renderizado. Si el
// cliente reintenta con otro monto, hay que LIMPIAR el form previo (removeForms)
// antes de reconfigurar con el nuevo formToken; si no, seguiría cobrando el monto
// viejo aunque el pedido nuevo sea distinto.
export async function montarFormularioIzipay({ endpoint, publicKey, formToken, selector, onPaid, onPending, onError, onClosed, onResult, onOversold }) {
  // Callbacks por referencia: siempre apuntan al intento actual.
  callbacksIzipay = { onPaid, onPending, onError, onClosed, onResult, onOversold }

  await cargarTemaIzipay(endpoint)
  const { KR } = await KRGlue.loadLibrary(endpoint, publicKey)

  // (1) Limpia cualquier formulario montado antes (no-op en el primer montaje).
  try { await KR.removeForms() } catch { /* aún no hay form */ }

  // (2) Ahora sí reconfigura con el nuevo formToken (nuevo monto).
  await KR.setFormConfig({ formToken, 'kr-language': 'es-ES' })

  // (3) Registra los handlers en CADA montaje (krypton reemplaza onSubmit, no lo apila;
  //     removeForms() de arriba pudo haberlos quitado). Sin esto, un 2º pago en la misma
  //     sesión recibía "PAID" de Izipay pero la UI no avanzaba.
  KR.onSubmit((resp) => {
    const krAnswer = resp.rawClientAnswer ?? JSON.stringify(resp.clientAnswer)
    // Respuesta firmada por Izipay (para la UI inmediata).
    let clientAnswer = null
    try { clientAnswer = JSON.parse(krAnswer) } catch { /* ignore */ }
    const status = clientAnswer?.orderStatus || ''

    // Expone la respuesta CRUDA del pago (la usa el lab de dev para mostrarla; el
    // checkout no pasa onResult, así que no le afecta).
    callbacksIzipay.onResult?.({ status, clientAnswer, hash: resp.hash, raw: krAnswer })

    // Si el estado local NO es PAID, no hubo cobro: avisamos y salimos.
    if (status !== 'PAID') {
      callbacksIzipay.onError?.('El pago no se completó. Intenta nuevamente.')
      return false
    }

    // Pago cobrado (status local PAID). Confirmamos SERVER-SIDE con `izipay-validate`
    // (verifica la firma HMAC → marca pagado + correo) y leemos su respuesta
    // { valid, paid, oversold }. oversold=true = se cobró pero YA NO hay stock:
    // en ese caso la pantalla debe ser HONESTA (revisión), no "confirmado".
    //
    // Si validate falla o tarda, mostramos "en revisión": nunca afirmamos que el
    // pedido quedó confirmado antes de que el backend lo persista.
    // El guard `finalizar` garantiza que se dispare UN solo callback (el primero).
    let resuelto = false
    const finalizar = (fn) => { if (resuelto) return; resuelto = true; fn?.() }

    supabase.functions
      .invoke('izipay-validate', { body: { krAnswer, krHash: resp.hash } })
      .then(({ data, error }) => {
        if (error || data?.confirmed !== true) { finalizar(callbacksIzipay.onPending); return }
        if (data?.oversold === true) finalizar(callbacksIzipay.onOversold)
        else finalizar(callbacksIzipay.onPaid)
      })
      .catch(() => { finalizar(callbacksIzipay.onPending) })

    setTimeout(() => finalizar(callbacksIzipay.onPending), 6000)

    // Evita que krypton recargue/redirija: la UX la maneja onPaid()/onOversold()/onError().
    return false
  })

  // Cuando el usuario cierra el popup nativo de krypton, reseteamos la UI.
  if (typeof KR.onPopinClosed === 'function') {
    KR.onPopinClosed(() => { callbacksIzipay.onClosed?.() })
  }

  // Errores del pago (rechazo, fallo de red, 3DS que no resuelve…). Sin esto, si el
  // pago no terminaba, el botón quedaba en "PROCESANDO…" para siempre. Ahora avisamos.
  if (typeof KR.onError === 'function') {
    KR.onError((err) => {
      const msg = err?.errorMessage || err?.detailedErrorMessage || ''
      callbacksIzipay.onError?.(msg || 'No se pudo procesar el pago. Revisa los datos o intenta con otra tarjeta.')
    })
  }

  // (4) Crea y MUESTRA el formulario en el POPUP NATIVO de krypton (flujo OFICIAL
  //     de Izipay: addForm → showForm). showForm es lo que realmente abre el popup
  //     (openPopin no lo hacía y el form quedaba incrustado y encimado en la página).
  //     El popup aparece por encima de todo y maneja por sí mismo el desafío 3DS.
  const { result } = await KR.addForm(selector)
  await KR.showForm(result.formId)
  return { KR }
}

// Limpia los formularios montados (útil al desmontar la vista o reintentar).
export async function removeForms() {
  try {
    if (typeof window !== 'undefined' && window.KR) {
      await window.KR.removeForms()
    }
  } catch (err) {
    console.error('[Hebennus] No se pudieron limpiar los formularios de Izipay:', err)
  }
}
