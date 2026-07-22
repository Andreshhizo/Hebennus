// ─── Estados de pedido y de pago (compartido) ───────────────────────────────
// Fuente única para labels/colores. Lo usan el panel admin (AdminPage,
// AdminCustomers) y la vista del cliente (MyOrdersPage), para no divergir.
// Hay DOS ejes independientes:
//   • orders.status        → ciclo LOGÍSTICO del pedido
//   • orders.payment_status → ciclo de PAGO (manual solo para Yape; tarjeta la
//                             confirma el IPN de Izipay)

// ── Estado del PEDIDO (logística) ────────────────────────────────────────────
// 'reembolsado' salió de aquí (ahora es un estado de PAGO); el valor 'pendiente'
// se conserva en BD pero se muestra como "En espera".
export const ESTADOS = ['pendiente', 'confirmado', 'enviado', 'entregado', 'cancelado']

export const ESTADO_LABEL = {
  pendiente:  'En espera',
  confirmado: 'Confirmado',
  enviado:    'Enviado',
  entregado:  'Entregado',
  cancelado:  'Cancelado',
  reembolsado:'Reembolsado', // legacy: pedidos antiguos con status='reembolsado' (ya no seleccionable)
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

// ── Estado de PAGO ───────────────────────────────────────────────────────────
// Selector manual solo para pedidos Yape (yape_manual). 'pagado' descuenta stock;
// 'reembolsado' lo repone y cancela el pedido (lo maneja admin_set_payment_status).
export const PAGO_ESTADOS = ['pendiente', 'pagado', 'reembolsado']

export const PAGO_LABEL = {
  pendiente:  'Pago pendiente',
  pagado:     'Pagado',
  reembolsado:'Reembolsado',
  fallido:    'Pago fallido', // legacy: eventos de pago fallidos (solo display)
}

export const PAGO_COLOR = {
  pendiente:  '#C9962F',  /* mostaza cálida */
  pagado:     '#5B7B5A',  /* oliva (success) */
  reembolsado:'#9A9082',  /* gris cálido */
  fallido:    '#C0553F',  /* terracota (danger) */
}

export function pagoLabel(s) { return PAGO_LABEL[s] || PAGO_LABEL.pendiente }
export function pagoColor(s) { return PAGO_COLOR[s] || PAGO_COLOR.pendiente }
