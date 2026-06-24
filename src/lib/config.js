// ---------------------------------------------------------------
//  CONFIGURACIÓN DE LA TIENDA — edita estos valores
// ---------------------------------------------------------------

export const WHATSAPP_NUMERO = import.meta.env.VITE_WHATSAPP_NUMERO
export const MARCA   = 'Hebennus'
export const TAGLINE = 'Edición limitada'
export const LEMA    = 'Make it real, Make it with Hebennus.'

// Redes sociales (solo el handle, sin @)
export const INSTAGRAM = 'hebennus'
export const TIKTOK    = 'hebennus'

// Fecha del próximo drop — formato ISO 8601
export const NEXT_DROP_DATE = '2026-09-01T00:00:00'

// Umbral de "pocas unidades" por producto
export const STOCK_LOW_THRESHOLD = 5

// Envío — gratis desde este monto (S/); por debajo, se cobra COSTO_ENVIO.
export const ENVIO_GRATIS_DESDE = 149
export const COSTO_ENVIO        = 10

// ── Izipay (Web Core, formulario embebido) ──
// Valores PÚBLICOS (van en el frontend). El token de sesión se genera server-side
// en la Edge Function `izipay-token`. SDK sandbox; en producción usa el de checkout.izipay.pe.
export const IZIPAY_MERCHANT_CODE = import.meta.env.VITE_IZIPAY_MERCHANT_CODE ?? ''
export const IZIPAY_PUBLIC_KEY    = import.meta.env.VITE_IZIPAY_PUBLIC_KEY ?? ''
export const IZIPAY_SDK_URL       = 'https://sandbox-checkout.izipay.pe/payments/v1/js/index.js'
// El checkout usa Izipay solo si hay credenciales; si no, registra el pedido directo.
export const IZIPAY_ENABLED       = Boolean(IZIPAY_MERCHANT_CODE && IZIPAY_PUBLIC_KEY)
