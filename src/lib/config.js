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

// ── Izipay (Lyra / krypton, formulario embebido oficial) ──
// El formToken y la public key se generan/entregan SIEMPRE server-side desde la
// Edge Function `izipay-formtoken`; el frontend nunca guarda credenciales.
// Solo se controla aquí si la pasarela está habilitada y el endpoint de la API.
export const IZIPAY_ENABLED  = import.meta.env.VITE_IZIPAY_ENABLED === 'true'
export const IZIPAY_ENDPOINT = 'https://api.micuentaweb.pe'
