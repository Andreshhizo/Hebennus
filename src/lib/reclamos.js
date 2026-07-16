// ─── Reclamos / tickets de soporte (compartido) ────────────────────────────
// Fuente única para estados y categorías del sistema de tickets. Lo usan el
// widget público (SoporteWidget) y el panel admin (AdminTickets), para no
// divergir. Los valores de estado coinciden con support_tickets.status en la BD.

export const ESTADOS = ['nuevo', 'en_proceso', 'resuelto', 'cerrado']

export const ESTADO_LABEL = {
  nuevo:      'Nuevo',
  en_proceso: 'En proceso',
  resuelto:   'Resuelto',
  cerrado:    'Cerrado',
}

// Armonizados con la identidad beige + denim.
export const ESTADO_COLOR = {
  nuevo:      '#C9962F',  /* mostaza cálida — requiere atención */
  en_proceso: '#4566A0',  /* denim — en curso */
  resuelto:   '#5B7B5A',  /* oliva (success) */
  cerrado:    '#9A9082',  /* gris cálido — archivado */
}

// Categorías del reclamo (para el select del formulario).
export const CATEGORIAS = [
  'Pago',
  'Envío / entrega',
  'Producto',
  'Cambio / devolución',
  'Otro',
]

export function estadoLabel(s) { return ESTADO_LABEL[s] || s }
export function estadoColor(s) { return ESTADO_COLOR[s] || '#888' }
