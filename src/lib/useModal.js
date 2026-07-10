// ─── UX de modales/drawers: cerrar con Esc + bloquear el scroll del fondo ───
// Uso: useModalUX(() => props.open, () => emit('close'))
// - `abierto` puede ser un ref o un getter (función).
// - Al abrir: escucha Escape y fija overflow:hidden en <body> (evita scroll-bleed
//   en móvil). Al cerrar/desmontar: limpia todo y restaura el overflow previo.
import { watch, onUnmounted } from 'vue'

export function useModalUX(abierto, onClose) {
  let prevOverflow = ''
  let activo = false

  function onKey(e) {
    if (e.key === 'Escape') onClose()
  }
  function activar() {
    if (activo) return
    activo = true
    document.addEventListener('keydown', onKey)
    prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  function desactivar() {
    if (!activo) return
    activo = false
    document.removeEventListener('keydown', onKey)
    document.body.style.overflow = prevOverflow || ''
  }

  watch(abierto, (v) => { v ? activar() : desactivar() }, { immediate: true })
  onUnmounted(desactivar)
}
