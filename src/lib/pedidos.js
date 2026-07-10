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

export const ESTADO_COLOR = {
  pendiente:  '#e0a23b',
  confirmado: '#5b8def',
  enviado:    '#7c5cff',
  entregado:  '#2ecc8f',
  cancelado:  '#e0566b',
  reembolsado:'#9aa0b0',
}

// Estados que cuentan como "en curso" en la vista del cliente.
export const EN_CURSO = ['pendiente', 'confirmado', 'enviado']

// Estados que reponen stock al aplicarse (para textos/confirmaciones en UI).
export const ESTADOS_DEVUELVE_STOCK = ['cancelado', 'reembolsado']

export function estadoLabel(s) { return ESTADO_LABEL[s] || s }
export function estadoColor(s) { return ESTADO_COLOR[s] || '#888' }
