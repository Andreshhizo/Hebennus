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
