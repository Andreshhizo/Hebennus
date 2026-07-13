<script setup>
// ─── Panel admin · Vista PRODUCTOS ──────────────────────────────────────────
// Crear productos, editar sus campos (nombre/precio/categoría/tipo/descripción),
// activar/desactivar, gestionar variantes (talla/color/stock) y gestionar las
// fotos con orden visual (products.images = galería principal [0]=portada,
// [1]=hover; products.images_by_color = galería por color) en Supabase Storage.
//
// Permisos: RPC create_product (gate is_admin), policies RLS de UPDATE/INSERT/
// DELETE en products/product_variants para el admin, y bucket 'product-images'.
import { ref, reactive, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase.js'
import { subirImagenProducto } from '../lib/storage.js'
import PhotoReorder from './PhotoReorder.vue'

// Listas fijas (deben coincidir con los filtros de la tienda: ColeccionPage + prendas.js).
const CATEGORIAS   = ['Style', 'Sport', 'Comfort']
const TIPOS_PRENDA = ['polo', 'polera', 'casaca', 'short', 'pantalon', 'buzo']
const TALLAS       = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Única']
// Etiqueta manual (sticker). "Sold Out" y "Últimas piezas" son AUTOMÁTICOS del stock.
const BADGES       = ['Nuevo', 'Edición limitada', 'Restock', 'Preventa', 'Exclusivo']

const productos = ref([])
const cargando  = ref(true)
const error     = ref('')

// Estado por variante (stock).
const stockEdit   = ref({})
const stockEstado = ref({})
const stockMsg    = ref({})

// Estado de fotos (edición) — arrays ordenables.
//   galEdit[pid]        = images (galería principal: [0]=portada, [1]=hover)
//   colorGal[pid::color] = images_by_color[color] (galería de ese color)
const galEdit     = ref({})
const colorGal    = ref({})
const fotosEstado = ref({})
const fotosMsg    = ref({})

// Edición de campos del producto.
const editId        = ref(null)
const editForm      = reactive({ name: '', price: '', categories: [], tipo_prenda: '', description: '', badge: '' })
// Marca/desmarca una categoría en un array (para los checkboxes).
function toggleCategoria(arr, cat) {
  const i = arr.indexOf(cat)
  if (i >= 0) arr.splice(i, 1); else arr.push(cat)
}
const editGuardando = ref(false)
const editError     = ref('')
const activoBusy    = ref({})

// Agregar variante a producto existente: { [pid]: {size,color,stock} }
const nuevaVar = ref({})
const varBusy  = ref(false)

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

function sembrarEstadoEdicion() {
  const nuevoStock = {}
  const nuevasGal = {}
  const nuevasColorGal = {}
  const varRows = {}
  for (const p of productos.value) {
    for (const v of p.product_variants || []) nuevoStock[v.id] = v.stock ?? 0
    nuevasGal[p.id] = Array.isArray(p.images) ? [...p.images] : []
    for (const color of coloresDe(p)) {
      const ibc = p.images_by_color
      nuevasColorGal[claveFoto(p.id, color)] = (ibc && Array.isArray(ibc[color])) ? [...ibc[color]] : []
    }
    varRows[p.id] = { size: '', color: '', stock: '' }
  }
  stockEdit.value = nuevoStock
  galEdit.value = nuevasGal
  colorGal.value = nuevasColorGal
  nuevaVar.value = varRows
  stockEstado.value = {}; stockMsg.value = {}
  fotosEstado.value = {}; fotosMsg.value = {}
}

// Setters para v-model dinámico (reemplazo del objeto → reactividad garantizada).
function setGal(pid, arr)        { galEdit.value = { ...galEdit.value, [pid]: arr } }
function setColorGal(key, arr)   { colorGal.value = { ...colorGal.value, [key]: arr } }

function coloresDe(p) {
  const out = []; const seen = new Set()
  for (const v of p.product_variants || []) {
    const c = v.color
    if (c == null || c === '') continue
    if (!seen.has(c)) { seen.add(c); out.push(c) }
  }
  return out
}

function variantesOrdenadas(p) {
  return [...(p.product_variants || [])].sort((a, b) => {
    const c = (a.color || '').localeCompare(b.color || '')
    if (c !== 0) return c
    return (a.size || '').localeCompare(b.size || '')
  })
}

function claveFoto(productId, color) { return `${productId}::${color}` }

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
  variant.stock = nuevo
  stockEstado.value = { ...stockEstado.value, [variant.id]: 'guardando' }
  stockMsg.value = { ...stockMsg.value, [variant.id]: '' }

  const { error: e } = await supabase.from('product_variants').update({ stock: nuevo }).eq('id', variant.id)
  if (e) {
    variant.stock = anterior
    stockEdit.value = { ...stockEdit.value, [variant.id]: anterior }
    stockEstado.value = { ...stockEstado.value, [variant.id]: 'error' }
    stockMsg.value = { ...stockMsg.value, [variant.id]: 'No se pudo guardar: ' + e.message }
    return
  }
  stockEstado.value = { ...stockEstado.value, [variant.id]: 'ok' }
}

function stockSucio(variant) {
  return String(stockEdit.value[variant.id]) !== String(variant.stock)
}

// ── Guardar fotos del producto (galería principal + por color) ──
// El orden de cada array = orden en la tienda. images[0]=portada, [1]=hover.
async function guardarFotos(p) {
  fotosEstado.value = { ...fotosEstado.value, [p.id]: 'guardando' }
  fotosMsg.value = { ...fotosMsg.value, [p.id]: '' }

  const images = [...(galEdit.value[p.id] || [])]

  let images_by_color = null
  const colores = coloresDe(p)
  if (colores.length) {
    images_by_color = {}
    for (const color of colores) {
      const urls = colorGal.value[claveFoto(p.id, color)] || []
      if (urls.length) images_by_color[color] = [...urls]
    }
    if (!Object.keys(images_by_color).length) images_by_color = null
  }

  const { error: e } = await supabase
    .from('products')
    .update({ images, images_by_color })
    .eq('id', p.id)

  if (e) {
    fotosEstado.value = { ...fotosEstado.value, [p.id]: 'error' }
    fotosMsg.value = { ...fotosMsg.value, [p.id]: 'No se pudo guardar: ' + e.message }
    return
  }
  p.images = images
  p.images_by_color = images_by_color
  fotosEstado.value = { ...fotosEstado.value, [p.id]: 'ok' }
}

// ── Editar campos del producto ──
function abrirEdicion(p) {
  editId.value = p.id
  editError.value = ''
  Object.assign(editForm, {
    name: p.name || '', price: p.price ?? '',
    categories: (p.categories && p.categories.length) ? [...p.categories] : (p.category ? [p.category] : []),
    tipo_prenda: p.tipo_prenda || '', description: p.description || '', badge: p.badge || '',
  })
}
function cancelarEdicion() { editId.value = null; editError.value = '' }

async function guardarEdicion(p) {
  if (!editForm.name.trim()) { editError.value = 'El nombre es obligatorio.'; return }
  const price = Number(editForm.price)
  if (!(price >= 0)) { editError.value = 'Precio inválido.'; return }
  editGuardando.value = true; editError.value = ''
  try {
    const patch = {
      name: editForm.name.trim(),
      price,
      categories: [...editForm.categories],
      category: editForm.categories[0] || null,   // legacy (primera categoría)
      tipo_prenda: editForm.tipo_prenda || null,
      description: editForm.description.trim() || null,
      badge: editForm.badge || null,
    }
    const { error: e } = await supabase.from('products').update(patch).eq('id', p.id)
    if (e) throw e
    Object.assign(p, patch)
    editId.value = null
  } catch (err) {
    editError.value = err?.message || 'No se pudo guardar.'
  } finally {
    editGuardando.value = false
  }
}

async function toggleActivo(p) {
  const valor = !p.is_active
  activoBusy.value = { ...activoBusy.value, [p.id]: true }
  const { error: e } = await supabase.from('products').update({ is_active: valor }).eq('id', p.id)
  if (e) error.value = 'No se pudo cambiar el estado: ' + e.message
  else p.is_active = valor
  activoBusy.value = { ...activoBusy.value, [p.id]: false }
}

// ── Variantes de producto existente ──
async function agregarVarExistente(p) {
  const row = nuevaVar.value[p.id]
  if (!row || !row.size) return
  if (!stockValido(row.stock === '' ? 0 : row.stock)) { error.value = 'Stock inválido.'; return }
  varBusy.value = true; error.value = ''
  try {
    const { error: e } = await supabase.from('product_variants').insert({
      product_id: p.id, size: row.size, color: (row.color || '').trim() || null, stock: Number(row.stock) || 0,
    })
    if (e) throw e
    await cargar()
  } catch (err) {
    error.value = 'No se pudo agregar la variante: ' + (err?.message || '')
  } finally {
    varBusy.value = false
  }
}

async function eliminarVariante(p, v) {
  if (!confirm(`¿Eliminar la variante ${v.size || ''} ${v.color || ''}? Esta acción no se puede deshacer.`)) return
  varBusy.value = true; error.value = ''
  try {
    const { error: e } = await supabase.from('product_variants').delete().eq('id', v.id)
    if (e) throw e
    await cargar()
  } catch (err) {
    error.value = 'No se pudo eliminar: ' + (err?.message || '')
  } finally {
    varBusy.value = false
  }
}

// ── Crear producto nuevo ──
const mostrarNuevo   = ref(false)
const guardandoNuevo = ref(false)
const errorNuevo     = ref('')
const nuevo = reactive({
  name: '', price: '', categories: [], tipo_prenda: '', description: '',
  is_active: true, is_launch: false, launch_order: '',
  variants: [{ size: '', color: '', stock: '' }],
})
const nuevoGal   = ref([])        // galería principal (images: [0]=portada, [1]=hover)
const nuevoFotos = reactive({})   // { [color]: [url,...] } — galería por color
function setNuevoColor(color, arr) { nuevoFotos[color] = arr }

const coloresNuevo = computed(() => {
  const out = []; const seen = new Set()
  for (const v of nuevo.variants) {
    const c = (v.color || '').trim()
    if (!c || seen.has(c)) continue
    seen.add(c); out.push(c)
  }
  return out
})

const nuevoValido = computed(() => {
  if (!nuevo.name.trim()) return false
  if (!(Number(nuevo.price) >= 0)) return false
  if (!nuevo.categories.length || !nuevo.tipo_prenda) return false
  const conTalla = nuevo.variants.filter((v) => v.size)
  if (!conTalla.length) return false
  for (const v of conTalla) if (!stockValido(v.stock === '' ? 0 : v.stock)) return false
  return true
})

function abrirNuevo() {
  Object.assign(nuevo, {
    name: '', price: '', categories: [], tipo_prenda: '', description: '', badge: '',
    is_active: true, is_launch: false, launch_order: '',
    variants: [{ size: '', color: '', stock: '' }],
  })
  Object.keys(nuevoFotos).forEach((k) => delete nuevoFotos[k])
  nuevoGal.value = []
  errorNuevo.value = ''
  mostrarNuevo.value = true
}
function cerrarNuevo() { mostrarNuevo.value = false }
function agregarVariante() { nuevo.variants.push({ size: '', color: '', stock: '' }) }
function quitarVariante(i) { if (nuevo.variants.length > 1) nuevo.variants.splice(i, 1) }

async function guardarNuevo() {
  if (!nuevoValido.value || guardandoNuevo.value) return
  errorNuevo.value = ''
  guardandoNuevo.value = true
  try {
    const colores = coloresNuevo.value
    let images_by_color = null
    if (colores.length) {
      images_by_color = {}
      for (const c of colores) {
        const urls = nuevoFotos[c] || []
        if (urls.length) images_by_color[c] = [...urls]
      }
      if (!Object.keys(images_by_color).length) images_by_color = null
    }
    // `images` = galería principal en el orden elegido ([0]=portada, [1]=hover).
    const images = [...nuevoGal.value]
    const variants = nuevo.variants
      .filter((v) => v.size)
      .map((v) => ({ size: v.size, color: (v.color || '').trim() || null, stock: Number(v.stock) || 0 }))
    const payload = {
      name: nuevo.name.trim(),
      price: Number(nuevo.price),
      categories: [...nuevo.categories],
      badge: nuevo.badge || null,
      tipo_prenda: nuevo.tipo_prenda,
      description: nuevo.description.trim(),
      is_active: nuevo.is_active,
      is_launch: nuevo.is_launch,
      launch_order: nuevo.is_launch && nuevo.launch_order !== '' ? Number(nuevo.launch_order) : null,
      images,
      images_by_color,
      variants,
    }
    const { error: e } = await supabase.rpc('create_product', { payload })
    if (e) throw e
    cerrarNuevo()
    await cargar()
  } catch (err) {
    errorNuevo.value = err?.message || 'No se pudo crear el producto.'
  } finally {
    guardandoNuevo.value = false
  }
}

function money(n) { return 'S/ ' + Number(n ?? 0).toFixed(2) }

const totalProductos = computed(() => productos.value.length)

onMounted(cargar)
</script>

<template>
<div class="prods">
  <div class="prods__bar">
    <p class="prods__meta">{{ totalProductos }} productos</p>
    <div class="prods__actions">
      <button class="prods__new" @click="abrirNuevo">＋ Nuevo producto</button>
      <button class="prods__refresh" :disabled="cargando" @click="cargar">↻ Actualizar</button>
    </div>
  </div>

  <p v-if="error" class="prods__error" role="alert">{{ error }}</p>

  <div v-if="cargando" class="prods__center"><span class="spinner"></span></div>

  <p v-else-if="!productos.length" class="prods__empty">No hay productos. Crea el primero con "＋ Nuevo producto".</p>

  <ul v-else class="prods__list">
    <li v-for="p in productos" :key="p.id" class="prod">
      <!-- Cabecera / edición de campos -->
      <div class="prod__head">
        <template v-if="editId === p.id">
          <div class="edit">
            <div class="edit__grid">
              <label class="edit__f"><span>Nombre</span><input v-model="editForm.name" class="edit__input" /></label>
              <label class="edit__f"><span>Precio (S/)</span><input v-model="editForm.price" type="number" min="0" step="0.01" class="edit__input" /></label>
              <div class="edit__f"><span>Categorías (una o varias)</span>
                <div class="cats">
                  <button v-for="c in CATEGORIAS" :key="c" type="button"
                          :class="['cats__chip', { 'cats__chip--on': editForm.categories.includes(c) }]"
                          @click="toggleCategoria(editForm.categories, c)">{{ c }}</button>
                </div>
              </div>
              <label class="edit__f"><span>Tipo de prenda</span>
                <select v-model="editForm.tipo_prenda" class="edit__input">
                  <option value="">—</option>
                  <option v-for="t in TIPOS_PRENDA" :key="t" :value="t">{{ t }}</option>
                </select>
              </label>
              <label class="edit__f"><span>Etiqueta (sticker)</span>
                <select v-model="editForm.badge" class="edit__input">
                  <option value="">Ninguna</option>
                  <option v-for="b in BADGES" :key="b" :value="b">{{ b }}</option>
                </select>
              </label>
            </div>
            <label class="edit__f"><span>Descripción</span><textarea v-model="editForm.description" rows="2" class="edit__input"></textarea></label>
            <p v-if="editError" class="vtab__err">{{ editError }}</p>
            <div class="edit__actions">
              <button class="edit__cancel" @click="cancelarEdicion">Cancelar</button>
              <button class="vtab__save" :disabled="editGuardando" @click="guardarEdicion(p)">
                <span v-if="editGuardando" class="spinner spinner--sm"></span>
                {{ editGuardando ? 'Guardando…' : 'Guardar cambios' }}
              </button>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="prod__main">
            <span class="prod__name">{{ p.name }}</span>
            <span class="prod__price">
              {{ money(p.price) }}<template v-if="(p.categories && p.categories.length) || p.category"> · {{ (p.categories && p.categories.length) ? p.categories.join(' · ') : p.category }}</template><template v-if="p.tipo_prenda"> · {{ p.tipo_prenda }}</template><template v-if="p.badge"> · 🏷️ {{ p.badge }}</template>
            </span>
          </div>
          <div class="prod__headactions">
            <button class="prod__editbtn" @click="abrirEdicion(p)">Editar</button>
            <button
              :class="['prod__toggle', p.is_active ? 'prod__toggle--on' : 'prod__toggle--off']"
              :disabled="activoBusy[p.id]"
              @click="toggleActivo(p)"
              :title="p.is_active ? 'Desactivar (ocultar de la tienda)' : 'Activar (mostrar en la tienda)'"
            >
              {{ activoBusy[p.id] ? '…' : (p.is_active ? '● Activo' : '○ Inactivo') }}
            </button>
          </div>
        </template>
      </div>

      <!-- Inventario por variante -->
      <div class="prod__section">
        <h4 class="prod__h4">Inventario por variante</h4>
        <table v-if="p.product_variants && p.product_variants.length" class="vtab">
          <thead>
            <tr><th>Talla</th><th>Color</th><th>Stock</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="v in variantesOrdenadas(p)" :key="v.id">
              <td>{{ v.size || '—' }}</td>
              <td>{{ v.color || '—' }}</td>
              <td>
                <input
                  v-model="stockEdit[v.id]" type="number" min="0" step="1" inputmode="numeric"
                  class="vtab__input" :class="{ 'vtab__input--bad': !stockValido(stockEdit[v.id]) }"
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
                <span v-if="stockEstado[v.id] === 'ok' && !stockSucio(v)" class="vtab__ok">✓</span>
                <span v-if="stockEstado[v.id] === 'error'" class="vtab__err">{{ stockMsg[v.id] }}</span>
                <button class="vtab__del" :disabled="varBusy" @click="eliminarVariante(p, v)" title="Eliminar variante">🗑</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="prod__none">Este producto no tiene variantes. Agrega la primera abajo.</p>

        <!-- Agregar variante -->
        <div v-if="nuevaVar[p.id]" class="addvar">
          <select v-model="nuevaVar[p.id].size" class="addvar__input">
            <option value="">Talla…</option>
            <option v-for="t in TALLAS" :key="t" :value="t">{{ t }}</option>
          </select>
          <input v-model="nuevaVar[p.id].color" class="addvar__input" placeholder="Color (opcional)" />
          <input v-model="nuevaVar[p.id].stock" type="number" min="0" step="1" class="addvar__input addvar__stock" placeholder="Stock" />
          <button class="vtab__save" :disabled="varBusy || !nuevaVar[p.id].size" @click="agregarVarExistente(p)">
            <span v-if="varBusy" class="spinner spinner--sm"></span> ＋ Agregar
          </button>
        </div>
      </div>

      <!-- Fotos del producto (orden en la tienda) -->
      <div class="prod__section">
        <h4 class="prod__h4">Fotos del producto</h4>
        <p class="prod__hint">Cambia el orden con ◀ ▶. La <strong>1.ª</strong> es la portada (se ve primero) y la <strong>2.ª</strong> aparece al pasar el mouse. Ese orden es el que se muestra en la tienda.</p>
        <PhotoReorder
          v-if="galEdit[p.id]"
          :model-value="galEdit[p.id]"
          tags
          @update:model-value="setGal(p.id, $event)"
        />

        <template v-if="coloresDe(p).length">
          <p class="prod__hint prod__hint--mt">Fotos por color (opcional) — se muestran en la ficha al elegir ese color.</p>
          <div v-for="color in coloresDe(p)" :key="color" class="colorgal">
            <span class="colorgal__name">{{ color }}</span>
            <PhotoReorder
              :model-value="colorGal[claveFoto(p.id, color)] || []"
              @update:model-value="setColorGal(claveFoto(p.id, color), $event)"
            />
          </div>
        </template>

        <div class="fotos__bar">
          <button class="fotos__save" :disabled="fotosEstado[p.id] === 'guardando'" @click="guardarFotos(p)">
            <span v-if="fotosEstado[p.id] === 'guardando'" class="spinner spinner--sm"></span>
            {{ fotosEstado[p.id] === 'guardando' ? 'Guardando…' : 'Guardar fotos' }}
          </button>
          <span v-if="fotosEstado[p.id] === 'ok'" class="fotos__ok">✓ Fotos guardadas</span>
          <span v-if="fotosEstado[p.id] === 'error'" class="fotos__err">{{ fotosMsg[p.id] }}</span>
        </div>
      </div>
    </li>
  </ul>

  <!-- ── Modal: Nuevo producto ── -->
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="mostrarNuevo" class="nm__overlay" @click.self="cerrarNuevo">
        <div class="nm" role="dialog" aria-modal="true" aria-label="Nuevo producto">
          <div class="nm__head">
            <h3 class="nm__title">Nuevo producto</h3>
            <button class="nm__x" @click="cerrarNuevo" aria-label="Cerrar">✕</button>
          </div>

          <div class="nm__body">
            <div class="edit__grid">
              <label class="edit__f"><span>Nombre *</span><input v-model="nuevo.name" class="edit__input" /></label>
              <label class="edit__f"><span>Precio (S/) *</span><input v-model="nuevo.price" type="number" min="0" step="0.01" class="edit__input" /></label>
              <div class="edit__f"><span>Categorías * (una o varias)</span>
                <div class="cats">
                  <button v-for="c in CATEGORIAS" :key="c" type="button"
                          :class="['cats__chip', { 'cats__chip--on': nuevo.categories.includes(c) }]"
                          @click="toggleCategoria(nuevo.categories, c)">{{ c }}</button>
                </div>
              </div>
              <label class="edit__f"><span>Tipo de prenda *</span>
                <select v-model="nuevo.tipo_prenda" class="edit__input">
                  <option value="">Elegir…</option>
                  <option v-for="t in TIPOS_PRENDA" :key="t" :value="t">{{ t }}</option>
                </select>
              </label>
              <label class="edit__f"><span>Etiqueta (sticker)</span>
                <select v-model="nuevo.badge" class="edit__input">
                  <option value="">Ninguna</option>
                  <option v-for="b in BADGES" :key="b" :value="b">{{ b }}</option>
                </select>
              </label>
            </div>
            <label class="edit__f"><span>Descripción</span><textarea v-model="nuevo.description" rows="2" class="edit__input"></textarea></label>

            <div class="nm__flags">
              <label class="nm__check"><input type="checkbox" v-model="nuevo.is_active" /> Activo (visible en la tienda)</label>
              <label class="nm__check"><input type="checkbox" v-model="nuevo.is_launch" /> Lanzamiento</label>
              <label v-if="nuevo.is_launch" class="edit__f edit__f--sm"><span>Orden</span><input v-model="nuevo.launch_order" type="number" class="edit__input" /></label>
            </div>

            <h4 class="nm__h4">Variantes (talla / color / stock) *</h4>
            <div v-for="(v, i) in nuevo.variants" :key="i" class="nvar">
              <select v-model="v.size" class="addvar__input">
                <option value="">Talla…</option>
                <option v-for="t in TALLAS" :key="t" :value="t">{{ t }}</option>
              </select>
              <input v-model="v.color" class="addvar__input" placeholder="Color (opcional)" />
              <input v-model="v.stock" type="number" min="0" step="1" class="addvar__input addvar__stock" placeholder="Stock" />
              <button class="nvar__del" :disabled="nuevo.variants.length === 1" @click="quitarVariante(i)" title="Quitar">🗑</button>
            </div>
            <button class="nm__addvar" @click="agregarVariante">＋ Agregar variante</button>

            <h4 class="nm__h4">Fotos del producto</h4>
            <p class="prod__hint">Ordena con ◀ ▶. La <strong>1.ª</strong> es la portada (se ve primero) y la <strong>2.ª</strong> aparece al pasar el mouse en el catálogo.</p>
            <PhotoReorder v-model="nuevoGal" tags />

            <template v-if="coloresNuevo.length">
              <h4 class="nm__h4">Fotos por color (opcional)</h4>
              <p class="prod__hint">Se muestran en la ficha al elegir ese color.</p>
              <div v-for="color in coloresNuevo" :key="color" class="colorgal">
                <span class="colorgal__name">{{ color }}</span>
                <PhotoReorder
                  :model-value="nuevoFotos[color] || []"
                  @update:model-value="setNuevoColor(color, $event)"
                />
              </div>
            </template>

            <p v-if="errorNuevo" class="vtab__err">{{ errorNuevo }}</p>
          </div>

          <div class="nm__foot">
            <button class="edit__cancel" @click="cerrarNuevo">Cancelar</button>
            <button class="fotos__save" :disabled="!nuevoValido || guardandoNuevo" @click="guardarNuevo">
              <span v-if="guardandoNuevo" class="spinner spinner--sm"></span>
              {{ guardandoNuevo ? 'Creando…' : 'Crear producto' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</div>
</template>

<style scoped>
.prods__bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
.prods__meta { font-size: 0.8rem; color: var(--text-3); }
.prods__actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
.prods__new { padding: 0.5rem 1rem; font-size: 0.74rem; font-weight: 700; background: var(--accent); border: 1px solid var(--accent); color: var(--ink); cursor: pointer; border-radius: 6px; }
.prods__new:hover { filter: brightness(1.08); }
.prods__refresh { padding: 0.5rem 0.9rem; font-size: 0.72rem; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); cursor: pointer; }
.prods__refresh:hover:not(:disabled) { color: var(--text-1); }
.prods__error { color: var(--danger); font-size: 0.82rem; margin: 0.5rem 0; }
.prods__center { display: grid; place-items: center; padding: 3rem 0; }
.prods__empty { color: var(--text-3); padding: 3rem 0; text-align: center; }
.prods__list { list-style: none; display: flex; flex-direction: column; gap: 0.8rem; }

.prod { border: 1px solid var(--border-mid); background: var(--card-bg); animation: hb-fade-up 0.3s ease both; }
.prod__head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.9rem 1rem; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.prod__main { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.prod__name { font-family: var(--font-display); font-weight: 700; font-size: 0.95rem; color: var(--text-1); }
.prod__price { font-size: 0.82rem; color: var(--text-2); }
.prod__headactions { display: flex; align-items: center; gap: 0.5rem; }
.prod__editbtn { padding: 0.4rem 0.8rem; font-size: 0.72rem; font-weight: 600; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); cursor: pointer; border-radius: 6px; }
.prod__editbtn:hover { color: var(--text-1); }
.prod__toggle { font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.35rem 0.7rem; border-radius: 999px; border: 1px solid currentColor; cursor: pointer; background: transparent; }
.prod__toggle--on { color: var(--success); }
.prod__toggle--off { color: #9aa0b0; }
.prod__toggle:disabled { opacity: 0.6; cursor: wait; }

.prod__section { padding: 1rem; border-top: 1px solid var(--border); }
.prod__section:first-of-type { border-top: none; }
.prod__h4 { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-3); margin-bottom: 0.7rem; }
.prod__hint { font-size: 0.72rem; color: var(--text-3); margin-bottom: 0.7rem; }
.prod__none { font-size: 0.8rem; color: var(--text-3); margin-bottom: 0.8rem; }

/* ── Edición de campos ── */
.edit { width: 100%; display: flex; flex-direction: column; gap: 0.6rem; }
.edit__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
.edit__f { display: flex; flex-direction: column; gap: 0.25rem; }
.edit__f > span { font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); font-weight: 600; }
.edit__f--sm { max-width: 110px; }
.edit__input { background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); padding: 0.5rem 0.6rem; font-size: 0.88rem; outline: none; border-radius: 6px; font-family: inherit; }
.edit__input:focus-visible { border-color: var(--accent); }
.cats { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.cats__chip { padding: 0.4rem 0.85rem; font-size: 0.78rem; font-weight: 600; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); border-radius: var(--radius-pill); cursor: pointer; }
.cats__chip:hover { border-color: var(--accent); color: var(--text-1); }
.cats__chip--on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.edit__actions { display: flex; gap: 0.6rem; justify-content: flex-end; }
.edit__cancel { padding: 0.5rem 1rem; font-size: 0.74rem; color: var(--text-3); background: transparent; border: 1px solid var(--border-mid); border-radius: 6px; cursor: pointer; }
.edit__cancel:hover { color: var(--text-1); }

/* ── Tabla de variantes ── */
.vtab { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.vtab th { text-align: left; font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); font-weight: 600; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border); }
.vtab td { padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--border); color: var(--text-2); vertical-align: middle; }
.vtab tbody tr:last-child td { border-bottom: none; }
.vtab__input { width: 84px; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); padding: 0.4rem 0.55rem; font-size: 0.85rem; outline: none; }
.vtab__input:focus-visible { border-color: var(--accent); }
.vtab__input--bad { border-color: var(--danger); }
.vtab__action { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.vtab__save { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.85rem; font-size: 0.72rem; font-weight: 600; cursor: pointer; background: var(--accent); border: 1px solid var(--accent); color: var(--ink); border-radius: 6px; }
.vtab__save:hover:not(:disabled) { filter: brightness(1.08); }
.vtab__save:disabled { opacity: 0.5; cursor: not-allowed; }
.vtab__ok { font-size: 0.8rem; color: var(--success); }
.vtab__err { font-size: 0.72rem; color: var(--danger); }
.vtab__del { background: transparent; border: none; cursor: pointer; font-size: 0.9rem; opacity: 0.7; padding: 0.2rem; }
.vtab__del:hover:not(:disabled) { opacity: 1; }
.vtab__del:disabled { opacity: 0.3; cursor: not-allowed; }

/* ── Agregar variante ── */
.addvar { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.9rem; flex-wrap: wrap; }
.addvar__input { background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); padding: 0.4rem 0.55rem; font-size: 0.82rem; outline: none; border-radius: 6px; font-family: inherit; }
.addvar__input:focus-visible { border-color: var(--accent); }
.addvar__stock { width: 90px; }

/* ── Fotos del producto (galería + reordenar) ── */
.prod__hint--mt { margin-top: 1rem; }
.colorgal { display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 0.9rem; }
.colorgal__name { font-size: 0.8rem; font-weight: 600; color: var(--text-1); text-transform: capitalize; }
.fotos__bar { display: flex; align-items: center; gap: 0.8rem; margin-top: 0.9rem; flex-wrap: wrap; }
.fotos__save { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5rem 1rem; font-size: 0.74rem; font-weight: 600; cursor: pointer; background: var(--accent); border: 1px solid var(--accent); color: var(--ink); border-radius: 6px; }
.fotos__save:hover:not(:disabled) { filter: brightness(1.08); }
.fotos__save:disabled { opacity: 0.5; cursor: not-allowed; }
.fotos__ok { font-size: 0.74rem; color: var(--success); }
.fotos__err { font-size: 0.74rem; color: var(--danger); }

/* ── Modal Nuevo producto ── */
.nm__overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(3px); display: grid; place-items: center; z-index: 700; padding: 1rem; }
.nm { width: 100%; max-width: 640px; max-height: 90vh; display: flex; flex-direction: column; background: var(--card-bg); border: 1px solid var(--border-mid); border-radius: 12px; box-shadow: var(--shadow-hover); overflow: hidden; }
.nm__head { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); }
.nm__title { font-family: var(--font-display); font-size: 1.05rem; font-weight: 800; text-transform: uppercase; color: var(--text-1); }
.nm__x { background: transparent; border: none; font-size: 1.1rem; color: var(--text-3); cursor: pointer; }
.nm__x:hover { color: var(--text-1); }
.nm__body { padding: 1.25rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.9rem; }
.nm__flags { display: flex; align-items: flex-end; gap: 1.2rem; flex-wrap: wrap; }
.nm__check { display: inline-flex; align-items: center; gap: 0.45rem; font-size: 0.82rem; color: var(--text-2); cursor: pointer; }
.nm__h4 { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); margin-top: 0.3rem; }
.nvar { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.nvar__del { background: transparent; border: none; cursor: pointer; font-size: 0.95rem; opacity: 0.7; }
.nvar__del:hover:not(:disabled) { opacity: 1; }
.nvar__del:disabled { opacity: 0.3; cursor: not-allowed; }
.nm__addvar { align-self: flex-start; padding: 0.4rem 0.8rem; font-size: 0.74rem; font-weight: 600; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); cursor: pointer; border-radius: 6px; }
.nm__addvar:hover { color: var(--text-1); border-color: var(--accent); }
.nm__foot { display: flex; justify-content: flex-end; gap: 0.7rem; padding: 1rem 1.25rem; border-top: 1px solid var(--border); }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ── Spinner ── */
.spinner { width: 22px; height: 22px; border: 2px solid var(--text-3); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
.spinner--sm { width: 13px; height: 13px; border-width: 2px; border-color: currentColor; border-top-color: transparent; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 560px) {
  .edit__grid { grid-template-columns: 1fr; }
}
</style>
