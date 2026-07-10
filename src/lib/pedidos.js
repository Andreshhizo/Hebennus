// ─── Estados de pedido (compartido) ─────────────────────────────────────────
// Fuente única para labels/colores de estado. Lo usan el panel admin
// (AdminPage, AdminCustomers) y la vista del cliente (MyOrdersPage), para no
// divergir. Los valores coinciden con orders.status en la BD.

export const ESTADOS = ['pendiente', 'confirmado', 'enviado', 'entregado', 'cancelado', 'reembolsado']

export const ESTADO_LABEL = {
  pendiente:  'Pendiente',
  confirmado: 'Confirmado',
  enviado:    'Enviado',
  entregado:  'Entregado',
  cancelado:  'Cancelado',
  reembolsado:'Reembolsado',
}

// Armonizados con la identidad beige + denim (2026-07-10 rediseño).
export const ESTADO_COLOR = {
  pendiente:  '#C9962F',  /* mostaza cálida */
  confirmado: '#4566A0',  /* denim */
  enviado:    '#7A6FB0',  /* índigo suave */
  entregado:  '#5B7B5A',  /* oliva (success) */
  cancelado:  '#C0553F',  /* terracota (danger) */
  reembolsado:'#9A9082',  /* gris cálido */
}

// Estados que cuentan como "en curso" en la vista del cliente.
export const EN_CURSO = ['pendiente', 'confirmado', 'enviado']

// Estados que reponen stock al aplicarse (para textos/confirmaciones en UI).
export const ESTADOS_DEVUELVE_STOCK = ['cancelado', 'reembolsado']

export function estadoLabel(s) { return ESTADO_LABEL[s] || s }
export function estadoColor(s) { return ESTADO_COLOR[s] || '#888' }
