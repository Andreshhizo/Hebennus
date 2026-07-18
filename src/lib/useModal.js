// ─── UX de modales/drawers: Esc + bloqueo de scroll + gestión de foco ───
// Uso: useModalUX(() => props.open, () => emit('close'), panelRef?)
// - `abierto` puede ser un ref o un getter (función).
// - `panelRef` (OPCIONAL) es una ref al contenedor del modal. Si se pasa:
//     · al abrir se enfoca el primer elemento enfocable dentro del panel
//       (o el propio panel con tabindex="-1" si no hay ninguno),
//     · mientras está abierto se atrapa Tab/Shift+Tab dentro del panel,
//     · al cerrar se devuelve el foco al elemento que lo tenía antes de abrir.
//   Si NO se pasa, degrada con gracia al comportamiento anterior (solo Esc + scroll).
// - Al abrir: escucha Escape y fija overflow:hidden en <body> (evita scroll-bleed
//   en móvil). Al cerrar/desmontar: limpia todo y restaura el overflow previo.
import { watch, onUnmounted, nextTick } from 'vue'

// Pila de modales activos: con modales anidados (p. ej. Guía de tallas sobre la
// Compra rápida) solo el último abierto (topmost) responde a Tab/Escape.
const pilaModales = []

// Selector de elementos enfocables por teclado.
const FOCUSABLE =
  'a[href],area[href],button:not([disabled]),input:not([disabled]),' +
  'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function useModalUX(abierto, onClose, panelRef = null) {
  let prevOverflow = ''
  let activo = false
  let elementoPrevio = null       // foco a restaurar al cerrar
  const self = {}                 // identidad de esta instancia en la pila

  const esTopmost = () => pilaModales[pilaModales.length - 1] === self

  // Devuelve el elemento DOM del panel (soporta ref a elemento o a componente).
  function panelEl() {
    const v = panelRef && typeof panelRef === 'object' && 'value' in panelRef ? panelRef.value : panelRef
    if (!v) return null
    return v.$el ?? v
  }

  function enfocables(cont) {
    return Array.from(cont.querySelectorAll(FOCUSABLE))
      .filter((el) => el.offsetParent !== null || el.getClientRects().length)
  }

  function onKey(e) {
    if (!esTopmost()) return
    if (e.key === 'Escape') { onClose(); return }
    if (e.key !== 'Tab') return

    const cont = panelEl()
    if (!cont) return   // sin panel: no atrapamos foco (degradación con gracia)

    const items = enfocables(cont)
    if (!items.length) {
      // Nada enfocable dentro: mantenemos el foco en el propio contenedor.
      e.preventDefault()
      if (!cont.hasAttribute('tabindex')) cont.setAttribute('tabindex', '-1')
      cont.focus({ preventScroll: true })
      return
    }
    const primero = items[0]
    const ultimo = items[items.length - 1]
    const actual = document.activeElement

    // Si el foco escapó fuera del panel, lo traemos de vuelta.
    if (!cont.contains(actual)) {
      e.preventDefault()
      ;(e.shiftKey ? ultimo : primero).focus({ preventScroll: true })
      return
    }
    if (e.shiftKey && actual === primero) {
      e.preventDefault(); ultimo.focus({ preventScroll: true })
    } else if (!e.shiftKey && actual === ultimo) {
      e.preventDefault(); primero.focus({ preventScroll: true })
    }
  }

  function enfocarInicial() {
    const cont = panelEl()
    if (!cont) return
    const items = enfocables(cont)
    const objetivo = items[0] ?? cont
    // preventScroll: evita saltos de scroll (respeta prefers-reduced-motion).
    if (objetivo === cont && !cont.hasAttribute('tabindex')) cont.setAttribute('tabindex', '-1')
    try { objetivo.focus({ preventScroll: true }) } catch { objetivo.focus?.() }
  }

  function activar() {
    if (activo) return
    activo = true
    elementoPrevio = document.activeElement
    pilaModales.push(self)
    document.addEventListener('keydown', onKey)
    prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Esperamos el render/inicio de la transición para que el panel exista en el DOM.
    nextTick(() => { if (activo) enfocarInicial() })
  }

  function desactivar() {
    if (!activo) return
    activo = false
    document.removeEventListener('keydown', onKey)
    const i = pilaModales.indexOf(self)
    if (i !== -1) pilaModales.splice(i, 1)
    document.body.style.overflow = prevOverflow || ''
    // Devuelve el foco al elemento previo si sigue en el documento.
    const prev = elementoPrevio
    elementoPrevio = null
    if (prev && document.contains(prev) && typeof prev.focus === 'function') {
      try { prev.focus({ preventScroll: true }) } catch { prev.focus() }
    }
  }

  watch(abierto, (v) => { v ? activar() : desactivar() }, { immediate: true })
  onUnmounted(desactivar)
}
