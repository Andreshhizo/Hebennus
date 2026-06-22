// ─── ZONA DEL CUERPO ────────────────────────────────────────────────────────
// Deriva la zona del cuerpo a partir del campo `tipo_prenda` de un producto.
// Reutilizable en cualquier componente (Colección, ficha de producto, etc.).

export const ZONA_UPPER = ['polo', 'polera', 'casaca']
export const ZONA_LOW   = ['short', 'pantalon', 'buzo']

// Devuelve 'upper' | 'low' | null.
// null = tipo_prenda vacío o desconocido → no aparece en los filtros de zona,
// pero sí en "Todos" (porque "Todos" no llama a esta función).
export function zonaDePrenda(tipoPrenda) {
  if (!tipoPrenda || typeof tipoPrenda !== 'string') return null
  const t = tipoPrenda.trim().toLowerCase()
  if (ZONA_UPPER.includes(t)) return 'upper'
  if (ZONA_LOW.includes(t))   return 'low'
  return null
}
