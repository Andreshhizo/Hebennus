<script setup>
// ─── Panel admin · Vista PRODUCTOS ──────────────────────────────────────────
// Ver y editar el stock de cada variante (talla/color) y gestionar las fotos
// por color (products.images_by_color, JSONB: { "<color>": ["url1", "url2"] }).
//
// El admin tiene permisos RLS para SELECT de todos los productos y UPDATE en
// products / product_variants (creados en otra migración).
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase.js'

const productos = ref([])
const cargando  = ref(true)
const error     = ref('')

// Estado por variante: { [variantId]: valor del input (string|number) }
const stockEdit  = ref({})
// Estado de guardado por variante: { [variantId]: 'guardando' | 'ok' | 'error' }
const stockEstado = ref({})
const stockMsg    = ref({})   // mensaje de error puntual por variante

// Estado por producto+color: textarea con una URL por línea.
// Clave: `${productId}::${color}` → string.
const fotosEdit   = ref({})
// Estado de guardado de fotos por producto: { [productId]: 'guardando' | 'ok' | 'error' }
const fotosEstado = ref({})
const fotosMsg    = ref({})

// ── Carga ──
async function cargar() {
  cargando.value = true
  error.value = ''
  try {
    const { data, error: e } = await supabase
      .from('products')
      .select('*, product_variants(*)')
      .order('created_at', { ascending: false })
    if (e) throw e
    productos.value = data || []
    sembrarEstadoEdicion()
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    cargando.value = false
  }
}

// Pre-carga inputs/textareas con los valores actuales tras cada (re)carga.
function sembrarEstadoEdicion() {
  const nuevoStock = {}
  const nuevasFotos = {}
  for (const p of productos.value) {
    for (const v of p.product_variants || []) {
      nuevoStock[v.id] = v.stock ?? 0
    }
    for (const color of coloresDe(p)) {
      nuevasFotos[claveFoto(p.id, color)] = urlsIniciales(p, color).join('\n')
    }
  }
  stockEdit.value = nuevoStock
  fotosEdit.value = nuevasFotos
  stockEstado.value = {}
  stockMsg.value = {}
  fotosEstado.value = {}
  fotosMsg.value = {}
}

// Colores únicos del producto (derivados de sus variantes), preservando orden.
function coloresDe(p) {
  const out = []
  const seen = new Set()
  for (const v of p.product_variants || []) {
    const c = v.color
    if (c == null || c === '') continue
    if (!seen.has(c)) { seen.add(c); out.push(c) }
  }
  return out
}

// Variantes ordenadas para la tabla (por color, luego talla).
function variantesOrdenadas(p) {
  return [...(p.product_variants || [])].sort((a, b) => {
    const c = (a.color || '').localeCompare(b.color || '')
    if (c !== 0) return c
    return (a.size || '').localeCompare(b.size || '')
  })
}

// URLs iniciales para un color: images_by_color[color] si existe;
// fallback: si el producto tiene un solo color, usar el array `images`.
function urlsIniciales(p, color) {
  const ibc = p.images_by_color
  if (ibc && Array.isArray(ibc[color]) && ibc[color].length) {
    return ibc[color].map(String)
  }
  // Fallback: un único color → reutiliza el array plano `images` del producto.
  const colores = coloresDe(p)
  if (colores.length === 1 && Array.isArray(p.images) && p.images.length) {
    return p.images.map(String)
  }
  return []
}

function claveFoto(productId, color) { return `${productId}::${color}` }

function nFotos(p, color) {
  const txt = fotosEdit.value[claveFoto(p.id, color)] || ''
  return txt.split('\n').map((s) => s.trim()).filter(Boolean).length
}

// ── Validación de stock ──
function stockValido(raw) {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0
}

// ── Guardar stock de una variante (optimista) ──
async function guardarStock(variant) {
  const raw = stockEdit.value[variant.id]
  if (!stockValido(raw)) {
    stockEstado.value = { ...stockEstado.value, [variant.id]: 'error' }
    stockMsg.value = { ...stockMsg.value, [variant.id]: 'El stock debe ser un entero ≥ 0.' }
    return
  }
  const nuevo = Number(raw)
  const anterior = variant.stock

  // Optimista: refleja el cambio en memoria de inmediato.
  variant.stock = nuevo
  stockEstado.value = { ...stockEstado.value, [variant.id]: 'guardando' }
  stockMsg.value = { ...stockMsg.value, [variant.id]: '' }

  const { error: e } = await supabase
    .from('product_variants')
    .update({ stock: nuevo })
    .eq('id', variant.id)

  if (e) {
    variant.stock = anterior            // rollback
    stockEdit.value = { ...stockEdit.value, [variant.id]: anterior }
    stockEstado.value = { ...stockEstado.value, [variant.id]: 'error' }
    stockMsg.value = { ...stockMsg.value, [variant.id]: 'No se pudo guardar: ' + e.message }
    return
  }
  stockEstado.value = { ...stockEstado.value, [variant.id]: 'ok' }
}

// ¿El input difiere del stock real en memoria?
function stockSucio(variant) {
  return String(stockEdit.value[variant.id]) !== String(variant.stock)
}

// ── Guardar fotos por color de un producto ──
async function guardarFotos(p) {
  fotosEstado.value = { ...fotosEstado.value, [p.id]: 'guardando' }
  fotosMsg.value = { ...fotosMsg.value, [p.id]: '' }

  // Construye el objeto images_by_color a partir de los textareas.
  const obj = {}
  for (const color of coloresDe(p)) {
    const txt = fotosEdit.value[claveFoto(p.id, color)] || ''
    const urls = txt.split('\n').map((s) => s.trim()).filter(Boolean)
    obj[color] = urls
  }

  const { error: e } = await supabase
    .from('products')
    .update({ images_by_color: obj })
    .eq('id', p.id)

  if (e) {
    fotosEstado.value = { ...fotosEstado.value, [p.id]: 'error' }
    fotosMsg.value = { ...fotosMsg.value, [p.id]: 'No se pudo guardar: ' + e.message }
    return
  }
  // Optimista local: refleja el nuevo objeto en el producto cargado.
  p.images_by_color = obj
  fotosEstado.value = { ...fotosEstado.value, [p.id]: 'ok' }
}

function money(n) { return 'S/ ' + Number(n ?? 0).toFixed(2) }

const totalProductos = computed(() => productos.value.length)

onMounted(cargar)
</script>

<template>
<div class="prods">
  <div class="prods__bar">
    <p class="prods__meta">{{ totalProductos }} productos</p>
    <button class="prods__refresh" :disabled="cargando" @click="cargar">↻ Actualizar</button>
  </div>

  <p v-if="error" class="prods__error" role="alert">{{ error }}</p>

  <div v-if="cargando" class="prods__center"><span class="spinner"></span></div>

  <p v-else-if="!productos.length" class="prods__empty">No hay productos.</p>

  <ul v-else class="prods__list">
    <li v-for="p in productos" :key="p.id" class="prod">
      <!-- Cabecera del producto -->
      <div class="prod__head">
        <div class="prod__main">
          <span class="prod__name">{{ p.name }}</span>
          <span class="prod__price">{{ money(p.price) }}</span>
        </div>
        <span :class="['prod__estado', p.is_active ? 'prod__estado--on' : 'prod__estado--off']">
          {{ p.is_active ? 'Activo' : 'Inactivo' }}
        </span>
      </div>

      <!-- Tabla de variantes con stock editable -->
      <div class="prod__section">
        <h4 class="prod__h4">Inventario por variante</h4>
        <p v-if="!(p.product_variants && p.product_variants.length)" class="prod__none">
          Este producto no tiene variantes.
        </p>
        <table v-else class="vtab">
          <thead>
            <tr>
              <th>Talla</th>
              <th>Color</th>
              <th>Stock</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in variantesOrdenadas(p)" :key="v.id">
              <td>{{ v.size || '—' }}</td>
              <td>{{ v.color || '—' }}</td>
              <td>
                <input
                  v-model="stockEdit[v.id]"
                  type="number" min="0" step="1" inputmode="numeric"
                  class="vtab__input"
                  :class="{ 'vtab__input--bad': !stockValido(stockEdit[v.id]) }"
                  @keyup.enter="guardarStock(v)"
                />
              </td>
              <td class="vtab__action">
                <button
                  class="vtab__save"
                  :disabled="stockEstado[v.id] === 'guardando' || !stockSucio(v) || !stockValido(stockEdit[v.id])"
                  @click="guardarStock(v)"
                >
                  <span v-if="stockEstado[v.id] === 'guardando'" class="spinner spinner--sm"></span>
                  {{ stockEstado[v.id] === 'guardando' ? 'Guardando…' : 'Guardar' }}
                </button>
                <span v-if="stockEstado[v.id] === 'ok' && !stockSucio(v)" class="vtab__ok">✓ Guardado</span>
                <span v-if="stockEstado[v.id] === 'error'" class="vtab__err">{{ stockMsg[v.id] }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Fotos por color -->
      <div class="prod__section" v-if="coloresDe(p).length">
        <h4 class="prod__h4">Fotos por color</h4>
        <p class="prod__hint">Una URL por línea. El orden define el orden de las imágenes.</p>
        <div class="fotos">
          <div v-for="color in coloresDe(p)" :key="color" class="fotos__col">
            <label class="fotos__label">
              <span class="fotos__color">{{ color }}</span>
              <span class="fotos__count">{{ nFotos(p, color) }} foto(s)</span>
            </label>
            <textarea
              v-model="fotosEdit[claveFoto(p.id, color)]"
              class="fotos__area"
              rows="4"
              placeholder="https://…/foto1.jpg&#10;https://…/foto2.jpg"
              spellcheck="false"
            ></textarea>
          </div>
        </div>
        <div class="fotos__bar">
          <button
            class="fotos__save"
            :disabled="fotosEstado[p.id] === 'guardando'"
            @click="guardarFotos(p)"
          >
            <span v-if="fotosEstado[p.id] === 'guardando'" class="spinner spinner--sm"></span>
            {{ fotosEstado[p.id] === 'guardando' ? 'Guardando…' : 'Guardar fotos' }}
          </button>
          <span v-if="fotosEstado[p.id] === 'ok'" class="fotos__ok">✓ Fotos guardadas</span>
          <span v-if="fotosEstado[p.id] === 'error'" class="fotos__err">{{ fotosMsg[p.id] }}</span>
        </div>
      </div>
    </li>
  </ul>
</div>
</template>

<style scoped>
.prods__bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
.prods__meta { font-size: 0.8rem; color: var(--text-3); }
.prods__refresh { padding: 0.5rem 0.9rem; font-size: 0.72rem; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); cursor: pointer; }
.prods__refresh:hover:not(:disabled) { color: var(--text-1); }
.prods__error { color: #e0566b; font-size: 0.82rem; margin: 0.5rem 0; }
.prods__center { display: grid; place-items: center; padding: 3rem 0; }
.prods__empty { color: var(--text-3); padding: 3rem 0; text-align: center; }
.prods__list { list-style: none; display: flex; flex-direction: column; gap: 0.8rem; }

.prod { border: 1px solid var(--border-mid); background: var(--card-bg); animation: hb-fade-up 0.3s ease both; }
.prod__head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.9rem 1rem; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.prod__main { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.prod__name { font-family: var(--font-display); font-weight: 700; font-size: 0.95rem; color: var(--text-1); }
.prod__price { font-size: 0.82rem; color: var(--text-2); }
.prod__estado { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.06em; padding: 0.2rem 0.55rem; border-radius: 999px; border: 1px solid currentColor; }
.prod__estado--on { color: #2ecc8f; }
.prod__estado--off { color: #9aa0b0; }

.prod__section { padding: 1rem; border-top: 1px solid var(--border); }
.prod__section:first-of-type { border-top: none; }
.prod__h4 { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-3); margin-bottom: 0.7rem; }
.prod__hint { font-size: 0.72rem; color: var(--text-3); margin-bottom: 0.7rem; }
.prod__none { font-size: 0.8rem; color: var(--text-3); }

/* ── Tabla de variantes ── */
.vtab { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.vtab th { text-align: left; font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); font-weight: 600; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border); }
.vtab td { padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--border); color: var(--text-2); vertical-align: middle; }
.vtab tbody tr:last-child td { border-bottom: none; }
.vtab__input { width: 84px; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); padding: 0.4rem 0.55rem; font-size: 0.85rem; outline: none; }
.vtab__input:focus-visible { border-color: var(--accent); }
.vtab__input--bad { border-color: #e0566b; }
.vtab__action { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.vtab__save { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.85rem; font-size: 0.72rem; font-weight: 600; cursor: pointer; background: var(--accent); border: 1px solid var(--accent); color: var(--ink); border-radius: 6px; }
.vtab__save:hover:not(:disabled) { filter: brightness(1.08); }
.vtab__save:disabled { opacity: 0.5; cursor: not-allowed; }
.vtab__ok { font-size: 0.72rem; color: #2ecc8f; }
.vtab__err { font-size: 0.72rem; color: #e0566b; }

/* ── Fotos por color ── */
.fotos { display: grid; grid-template-columns: 1fr; gap: 1rem; }
.fotos__col { display: flex; flex-direction: column; gap: 0.4rem; }
.fotos__label { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; }
.fotos__color { font-size: 0.8rem; font-weight: 600; color: var(--text-1); text-transform: capitalize; }
.fotos__count { font-size: 0.68rem; color: var(--text-3); }
.fotos__area { width: 100%; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); padding: 0.55rem 0.65rem; font-size: 0.78rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.5; outline: none; resize: vertical; }
.fotos__area:focus-visible { border-color: var(--accent); }
.fotos__bar { display: flex; align-items: center; gap: 0.8rem; margin-top: 0.9rem; flex-wrap: wrap; }
.fotos__save { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5rem 1rem; font-size: 0.74rem; font-weight: 600; cursor: pointer; background: var(--accent); border: 1px solid var(--accent); color: var(--ink); border-radius: 6px; }
.fotos__save:hover:not(:disabled) { filter: brightness(1.08); }
.fotos__save:disabled { opacity: 0.5; cursor: not-allowed; }
.fotos__ok { font-size: 0.74rem; color: #2ecc8f; }
.fotos__err { font-size: 0.74rem; color: #e0566b; }

/* ── Spinner ── */
.spinner { width: 22px; height: 22px; border: 2px solid var(--text-3); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
.spinner--sm { width: 13px; height: 13px; border-width: 2px; border-color: currentColor; border-top-color: transparent; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (min-width: 720px) {
  .fotos { grid-template-columns: repeat(2, 1fr); }
}
</style>
