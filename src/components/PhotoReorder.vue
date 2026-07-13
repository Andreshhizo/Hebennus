<script setup>
// ─── Galería de fotos reordenable ───────────────────────────────────────────
// Muestra miniaturas en el ORDEN en que se guardan (products.images).
// Reordenar: ARRASTRAR con el mouse (drag & drop nativo) o los botones ◀ ▶
// (respaldo táctil/accesible). Quitar con ✕. "＋ Subir" agrega archivos al final.
// v-model = array de URLs. La posición en el array = orden en la tienda.
import { ref } from 'vue'
import { subirImagenProducto } from '../lib/storage.js'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  // Muestra etiquetas "Portada" (pos 1) y "Hover" (pos 2) — solo galería de tarjeta.
  tags: { type: Boolean, default: false },
  // Límite de fotos (p. ej. 2 para la tarjeta). 0 = sin límite.
  max: { type: Number, default: 0 },
})
const emit = defineEmits(['update:modelValue'])

const subiendo = ref(false)
const errorMsg = ref('')

function commit(arr) { emit('update:modelValue', arr) }

function moverIzq(i) {
  if (i <= 0) return
  const a = [...props.modelValue]
  ;[a[i - 1], a[i]] = [a[i], a[i - 1]]
  commit(a)
}
function moverDer(i) {
  if (i >= props.modelValue.length - 1) return
  const a = [...props.modelValue]
  ;[a[i + 1], a[i]] = [a[i], a[i + 1]]
  commit(a)
}
function quitar(i) {
  const a = [...props.modelValue]
  a.splice(i, 1)
  commit(a)
}

// ── Drag & drop nativo ──
const dragIndex = ref(null)   // índice que se está arrastrando
const overIndex = ref(null)   // índice destino resaltado

function onDragStart(i, ev) {
  dragIndex.value = i
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = 'move'
    // Firefox necesita datos para iniciar el arrastre.
    try { ev.dataTransfer.setData('text/plain', String(i)) } catch (_) {}
  }
}
function onDragOver(i) {
  if (dragIndex.value === null) return
  overIndex.value = i
}
function onDrop(i) {
  const from = dragIndex.value
  onDragEnd()
  if (from === null || from === i) return
  const a = [...props.modelValue]
  const [movido] = a.splice(from, 1)
  a.splice(i, 0, movido)
  commit(a)
}
function onDragEnd() {
  dragIndex.value = null
  overIndex.value = null
}

async function onSubir(ev) {
  let files = Array.from(ev.target.files || [])
  ev.target.value = ''
  if (!files.length) return
  // Respetar el límite (si aplica).
  if (props.max) {
    const room = props.max - props.modelValue.length
    if (room <= 0) return
    if (files.length > room) files = files.slice(0, room)
  }
  errorMsg.value = ''
  subiendo.value = true
  try {
    const nuevas = []
    for (const f of files) nuevas.push(await subirImagenProducto(f))
    commit([...props.modelValue, ...nuevas])
  } catch (e) {
    errorMsg.value = e?.message || 'No se pudo subir la imagen.'
  } finally {
    subiendo.value = false
  }
}
</script>

<template>
  <div class="pr">
    <div class="pr__grid">
      <div
        v-for="(url, i) in modelValue"
        :key="url"
        class="pr__item"
        :class="{ 'pr__item--dragging': dragIndex === i, 'pr__item--over': overIndex === i && dragIndex !== i }"
        draggable="true"
        @dragstart="onDragStart(i, $event)"
        @dragover.prevent="onDragOver(i)"
        @drop.prevent="onDrop(i)"
        @dragend="onDragEnd"
      >
        <div class="pr__thumb" :title="'Arrastra para reordenar'">
          <img :src="url" alt="" loading="lazy" draggable="false" />
          <span v-if="tags && i === 0" class="pr__tag pr__tag--cover">Portada</span>
          <span v-else-if="tags && i === 1" class="pr__tag pr__tag--hover">Hover</span>
          <span v-else class="pr__num">{{ i + 1 }}</span>
          <span class="pr__grip" aria-hidden="true">⠿</span>
          <button type="button" class="pr__x" @click="quitar(i)" aria-label="Quitar foto">✕</button>
        </div>
        <div class="pr__moves">
          <button
            type="button" class="pr__move"
            :disabled="i === 0"
            @click="moverIzq(i)" aria-label="Mover antes"
          >◀</button>
          <button
            type="button" class="pr__move"
            :disabled="i === modelValue.length - 1"
            @click="moverDer(i)" aria-label="Mover después"
          >▶</button>
        </div>
      </div>

      <label v-if="!max || modelValue.length < max" class="pr__add" :class="{ 'pr__add--busy': subiendo }">
        <input type="file" accept="image/*" :multiple="!max || max - modelValue.length > 1" hidden @change="onSubir" :disabled="subiendo" />
        <span v-if="subiendo" class="pr__spin"></span>
        <span class="pr__add-txt">{{ subiendo ? 'Subiendo…' : '＋ Subir' }}</span>
      </label>
    </div>
    <p v-if="errorMsg" class="pr__err">{{ errorMsg }}</p>
  </div>
</template>

<style scoped>
.pr__grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: flex-start;
}
.pr__item { display: flex; flex-direction: column; gap: 0.3rem; width: 84px; }
.pr__item--dragging { opacity: 0.4; }
.pr__thumb {
  position: relative;
  width: 84px;
  aspect-ratio: 3 / 4;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-mid);
  background: var(--surface-2);
  cursor: grab;
}
.pr__thumb:active { cursor: grabbing; }
.pr__item--over .pr__thumb {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent);
}
.pr__thumb img { width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.pr__num {
  position: absolute;
  top: 4px; left: 4px;
  min-width: 18px; height: 18px;
  padding: 0 4px;
  display: grid; place-items: center;
  font-size: 0.62rem; font-weight: 700;
  color: #fff; background: rgba(0,0,0,0.6);
  border-radius: 999px;
}
.pr__tag {
  position: absolute;
  top: 4px; left: 4px;
  font-size: 0.55rem; font-weight: 700;
  letter-spacing: 0.06em; text-transform: uppercase;
  padding: 2px 5px;
  border-radius: 4px;
  color: var(--on-accent);
  background: var(--accent);
}
.pr__tag--hover { background: #C9962F; color: #1a1408; }
.pr__grip {
  position: absolute;
  bottom: 3px; left: 50%;
  transform: translateX(-50%);
  font-size: 0.8rem; line-height: 1;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.6);
  opacity: 0; transition: opacity 0.15s;
  pointer-events: none;
}
.pr__thumb:hover .pr__grip { opacity: 0.85; }
.pr__x {
  position: absolute;
  top: 4px; right: 4px;
  width: 18px; height: 18px;
  border: none; border-radius: 999px;
  background: rgba(0,0,0,0.65); color: #fff;
  font-size: 0.6rem; cursor: pointer;
  display: grid; place-items: center;
}
.pr__x:hover { background: rgba(0,0,0,0.9); }
.pr__moves { display: flex; gap: 0.3rem; }
.pr__move {
  flex: 1;
  padding: 0.25rem 0;
  font-size: 0.7rem;
  background: var(--surface-2);
  border: 1px solid var(--border-mid);
  color: var(--text-2);
  border-radius: 5px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.pr__move:hover:not(:disabled) { color: var(--text-1); border-color: var(--accent); }
.pr__move:disabled { opacity: 0.3; cursor: not-allowed; }
.pr__add {
  width: 84px;
  aspect-ratio: 3 / 4;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 0.3rem;
  text-align: center;
  font-size: 0.72rem; font-weight: 600;
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px dashed var(--border-mid);
  border-radius: 8px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.pr__add:hover { color: var(--text-1); border-color: var(--accent); }
.pr__add--busy { cursor: wait; }
.pr__spin {
  width: 16px; height: 16px;
  border: 2px solid var(--text-3); border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
.pr__err { font-size: 0.72rem; color: var(--danger); margin-top: 0.5rem; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
