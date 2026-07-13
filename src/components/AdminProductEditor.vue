<script setup>
// ─── Editor de producto (pantalla completa) ─────────────────────────────────
// 3 secciones: (1) inventario y variantes, (2) fotos de tarjeta (portada+hover),
// (3) galería de detalle. Preview en vivo a la derecha.
//
// Modelo: products.images = [portada, hover, ...galería]. images_by_color se
// DEPRECA (se guarda null); al abrir un producto que la tenía, sus fotos se
// FUSIONAN sin pérdida en la galería de detalle.
//
// Guardado:
//   • crear  → RPC create_product (único camino de INSERT).
//   • editar → products.update({campos, images, images_by_color:null}).
//   • En editar, el STOCK y las VARIANTES se guardan por-fila al instante
//     (no se hace diff masivo: protege la reconciliación de stock de pedidos).
import { reactive, ref, computed, onMounted, watch, nextTick } from 'vue'
import { supabase } from '../lib/supabase.js'
import PhotoReorder from './PhotoReorder.vue'
import ProductPreview from './ProductPreview.vue'

const props = defineProps({
  mode:    { type: String, default: 'editar' },   // 'crear' | 'editar'
  product: { type: Object, default: null },
})
const emit = defineEmits(['back', 'saved'])

const CATEGORIAS   = ['Style', 'Sport', 'Comfort']
const TIPOS_PRENDA = ['polo', 'polera', 'casaca', 'short', 'pantalon', 'buzo']
const TALLAS       = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Única']
const BADGES       = ['Nuevo', 'Edición limitada', 'Restock', 'Preventa', 'Exclusivo']

const esCrear = computed(() => props.mode === 'crear')

// ── Borrador de campos ──
const draft = reactive({
  name: '', price: '', categories: [], tipo_prenda: '', description: '',
  badge: '', is_active: true, is_launch: false, launch_order: '',
  variants: [{ size: '', color: '', stock: '' }],   // solo modo crear
})

// ── Fotos ──
const tarjeta = ref([])    // images[0..1]
const detalle = ref([])    // images[2..]
const avisoColor = ref(false)

// ── Variantes en vivo (modo editar) ──
const variantes  = ref([])          // copia de product.product_variants
const stockEdit  = ref({})          // { [variantId]: stock }
const stockEstado = ref({})
const stockMsg   = ref({})
const nuevaVar   = reactive({ size: '', color: '', stock: '' })
const varBusy    = ref(false)

const guardando = ref(false)
const error     = ref('')
const sucio     = ref(false)        // cambios sin guardar (campos + fotos)

// ── Sembrado ──
function seed() {
  if (esCrear.value) {
    Object.assign(draft, {
      name: '', price: '', categories: [], tipo_prenda: '', description: '',
      badge: '', is_active: true, is_launch: false, launch_order: '',
      variants: [{ size: '', color: '', stock: '' }],
    })
    tarjeta.value = []
    detalle.value = []
    avisoColor.value = false
    return
  }
  const p = props.product || {}
  Object.assign(draft, {
    name: p.name || '',
    price: p.price ?? '',
    categories: (p.categories && p.categories.length) ? [...p.categories] : (p.category ? [p.category] : []),
    tipo_prenda: p.tipo_prenda || '',
    description: p.description || '',
    badge: p.badge || '',
    is_active: p.is_active !== false,
    is_launch: !!p.is_launch,
    launch_order: p.launch_order ?? '',
  })
  // Fotos de tarjeta (card_images) y galería de detalle (images) INDEPENDIENTES.
  const cardImgs = (Array.isArray(p.card_images) ? p.card_images : []).filter(Boolean)
  const imgs     = (Array.isArray(p.images) ? p.images : []).filter(Boolean)
  // Fotos que vivían en images_by_color (productos por color antiguos).
  const ibc = p.images_by_color || {}
  const ibcUrls = []
  for (const color of Object.keys(ibc)) {
    for (const u of (Array.isArray(ibc[color]) ? ibc[color] : [])) if (u) ibcUrls.push(u)
  }
  const dedup = (arr) => {
    const s = new Set(); const out = []
    for (const u of arr) if (!s.has(u)) { s.add(u); out.push(u) }
    return out
  }
  if (cardImgs.length) {
    // Modelo nuevo: card_images = tarjeta; images = galería de detalle.
    tarjeta.value = cardImgs.slice(0, 2)
    detalle.value = dedup([...imgs, ...ibcUrls])
  } else {
    // Modelo antiguo: images = [portada, hover, ...detalle] (mezclado) → lo separamos.
    const union = dedup([...imgs, ...ibcUrls])
    tarjeta.value = union.slice(0, 2)
    detalle.value = union.slice(2)
  }
  avisoColor.value = ibcUrls.length > 0
  // Variantes en vivo
  variantes.value = [...(p.product_variants || [])]
  const st = {}
  for (const v of variantes.value) st[v.id] = v.stock ?? 0
  stockEdit.value = st
}

seed()

// Marcar "sucio" solo tras el sembrado inicial (para no disparar en el montaje).
onMounted(() => {
  nextTick(() => {
    watch([() => ({ ...draft }), tarjeta, detalle], () => { sucio.value = true }, { deep: true })
  })
})

// ── Preview ──
const cardProduct = computed(() => ({
  id: props.product?.id,
  name: draft.name || 'Producto',
  price: Number(draft.price) || 0,
  card_images: [...tarjeta.value],
  images: [...detalle.value],
  badge: draft.badge || null,
  product_variants: esCrear.value
    ? draft.variants.filter(v => v.size).map(v => ({ size: v.size, color: (v.color || '').trim() || null, stock: Number(v.stock) || 0 }))
    : variantes.value,
}))

// ── Helpers ──
function toggleCategoria(cat) {
  const i = draft.categories.indexOf(cat)
  if (i >= 0) draft.categories.splice(i, 1); else draft.categories.push(cat)
}
function stockValido(raw) { const n = Number(raw); return Number.isInteger(n) && n >= 0 }
function variantesOrdenadas() {
  return [...variantes.value].sort((a, b) => {
    const c = (a.color || '').localeCompare(b.color || '')
    if (c !== 0) return c
    return (a.size || '').localeCompare(b.size || '')
  })
}

// ── Validación de creación ──
const puedeCrear = computed(() => {
  if (!draft.name.trim()) return false
  if (!(Number(draft.price) >= 0)) return false
  if (!draft.categories.length || !draft.tipo_prenda) return false
  const conTalla = draft.variants.filter(v => v.size)
  if (!conTalla.length) return false
  for (const v of conTalla) if (!stockValido(v.stock === '' ? 0 : v.stock)) return false
  return true
})
const puedeGuardar = computed(() =>
  esCrear.value ? puedeCrear.value : (draft.name.trim() && Number(draft.price) >= 0)
)

// ── Variantes (crear) ──
function agregarVarNueva() { draft.variants.push({ size: '', color: '', stock: '' }) }
function quitarVarNueva(i) { if (draft.variants.length > 1) draft.variants.splice(i, 1) }

// ── Variantes (editar, por-fila e inmediato) ──
function stockSucio(v) { return String(stockEdit.value[v.id]) !== String(v.stock) }

async function guardarStock(v) {
  const raw = stockEdit.value[v.id]
  if (!stockValido(raw)) {
    stockEstado.value = { ...stockEstado.value, [v.id]: 'error' }
    stockMsg.value = { ...stockMsg.value, [v.id]: 'Entero ≥ 0.' }
    return
  }
  const nuevo = Number(raw)
  const anterior = v.stock
  v.stock = nuevo
  stockEstado.value = { ...stockEstado.value, [v.id]: 'guardando' }
  const { error: e } = await supabase.from('product_variants').update({ stock: nuevo }).eq('id', v.id)
  if (e) {
    v.stock = anterior
    stockEdit.value = { ...stockEdit.value, [v.id]: anterior }
    stockEstado.value = { ...stockEstado.value, [v.id]: 'error' }
    stockMsg.value = { ...stockMsg.value, [v.id]: 'No se pudo guardar.' }
    return
  }
  stockEstado.value = { ...stockEstado.value, [v.id]: 'ok' }
  sincronizarVariantesAlProducto()
}

async function recargarVariantes() {
  const { data, error: e } = await supabase
    .from('product_variants').select('*').eq('product_id', props.product.id)
  if (e) { error.value = 'No se pudieron recargar variantes: ' + e.message; return }
  variantes.value = data || []
  const st = {}
  for (const v of variantes.value) st[v.id] = v.stock ?? 0
  stockEdit.value = st
  sincronizarVariantesAlProducto()
}

async function agregarVarEditar() {
  if (!nuevaVar.size) return
  if (!stockValido(nuevaVar.stock === '' ? 0 : nuevaVar.stock)) { error.value = 'Stock inválido.'; return }
  varBusy.value = true; error.value = ''
  const { error: e } = await supabase.from('product_variants').insert({
    product_id: props.product.id, size: nuevaVar.size,
    color: (nuevaVar.color || '').trim() || null, stock: Number(nuevaVar.stock) || 0,
  })
  varBusy.value = false
  if (e) { error.value = 'No se pudo agregar la variante: ' + e.message; return }
  nuevaVar.size = ''; nuevaVar.color = ''; nuevaVar.stock = ''
  await recargarVariantes()
}

async function eliminarVariante(v) {
  if (!confirm(`¿Eliminar la variante ${v.size || ''} ${v.color || ''}? No se puede deshacer.`)) return
  varBusy.value = true; error.value = ''
  const { error: e } = await supabase.from('product_variants').delete().eq('id', v.id)
  varBusy.value = false
  if (e) { error.value = 'No se pudo eliminar: ' + e.message; return }
  await recargarVariantes()
}

function sincronizarVariantesAlProducto() {
  if (props.product) props.product.product_variants = [...variantes.value]
}

// ── Guardar (campos + fotos) ──
async function guardar() {
  if (!puedeGuardar.value || guardando.value) return
  error.value = ''
  guardando.value = true
  try {
    const card_images = [...tarjeta.value]   // portada + hover (solo tarjeta)
    const images = [...detalle.value]        // galería de la ficha (solo detalle)
    if (esCrear.value) {
      const variants = draft.variants
        .filter(v => v.size)
        .map(v => ({ size: v.size, color: (v.color || '').trim() || null, stock: Number(v.stock) || 0 }))
      const payload = {
        name: draft.name.trim(),
        price: Number(draft.price),
        categories: [...draft.categories],
        badge: draft.badge || null,
        tipo_prenda: draft.tipo_prenda,
        description: draft.description.trim(),
        is_active: draft.is_active,
        is_launch: draft.is_launch,
        launch_order: draft.is_launch && draft.launch_order !== '' ? Number(draft.launch_order) : null,
        card_images,
        images,
        images_by_color: null,
        variants,
      }
      const { error: e } = await supabase.rpc('create_product', { payload })
      if (e) throw e
    } else {
      const patch = {
        name: draft.name.trim(),
        price: Number(draft.price),
        categories: [...draft.categories],
        category: draft.categories[0] || null,   // legacy (Lanzamientos/fallbacks lo usan)
        tipo_prenda: draft.tipo_prenda || null,
        description: draft.description.trim() || null,
        badge: draft.badge || null,
        is_active: draft.is_active,
        is_launch: draft.is_launch,
        launch_order: draft.is_launch && draft.launch_order !== '' ? Number(draft.launch_order) : null,
        card_images,               // solo tarjeta
        images,                    // solo galería de detalle
        images_by_color: null,     // deprecado (todo migró a card_images + images)
      }
      const { error: e } = await supabase.from('products').update(patch).eq('id', props.product.id)
      if (e) throw e
      Object.assign(props.product, patch)
    }
    sucio.value = false
    emit('saved')
  } catch (err) {
    error.value = err?.message || 'No se pudo guardar.'
  } finally {
    guardando.value = false
  }
}

function volver() {
  if (sucio.value && !confirm('Tienes cambios de fotos/datos sin guardar. ¿Salir sin guardar?')) return
  emit('back')
}
</script>

<template>
  <div class="ape">
    <header class="ape__head">
      <button class="ape__back" @click="volver">← Volver</button>
      <h3 class="ape__title">{{ esCrear ? 'Nuevo producto' : (draft.name || 'Editar producto') }}</h3>
      <div class="ape__headright">
        <label class="ape__active">
          <input type="checkbox" v-model="draft.is_active" />
          {{ draft.is_active ? 'Activo' : 'Inactivo' }}
        </label>
        <button class="ape__save" :disabled="!puedeGuardar || guardando" @click="guardar">
          <span v-if="guardando" class="spinner spinner--sm"></span>
          {{ guardando ? 'Guardando…' : (esCrear ? 'Crear producto' : 'Guardar') }}
        </button>
      </div>
    </header>

    <p v-if="error" class="ape__err" role="alert">{{ error }}</p>

    <div class="ape__layout">
      <div class="ape__form">
        <!-- ── Sección 1 · Inventario y variantes ── -->
        <section class="ape__sec">
          <h4 class="ape__h4"><span class="ape__num">1</span> Inventario y variantes</h4>

          <div class="edit__grid">
            <label class="edit__f"><span>Nombre *</span><input v-model="draft.name" class="edit__input" /></label>
            <label class="edit__f"><span>Precio (S/) *</span><input v-model="draft.price" type="number" min="0" step="0.01" class="edit__input" /></label>
            <div class="edit__f"><span>Categorías * (una o varias)</span>
              <div class="cats">
                <button v-for="c in CATEGORIAS" :key="c" type="button"
                        :class="['cats__chip', { 'cats__chip--on': draft.categories.includes(c) }]"
                        @click="toggleCategoria(c)">{{ c }}</button>
              </div>
            </div>
            <label class="edit__f"><span>Tipo de prenda *</span>
              <select v-model="draft.tipo_prenda" class="edit__input">
                <option value="">Elegir…</option>
                <option v-for="t in TIPOS_PRENDA" :key="t" :value="t">{{ t }}</option>
              </select>
            </label>
            <label class="edit__f"><span>Etiqueta (sticker)</span>
              <select v-model="draft.badge" class="edit__input">
                <option value="">Ninguna</option>
                <option v-for="b in BADGES" :key="b" :value="b">{{ b }}</option>
              </select>
            </label>
            <label class="edit__f edit__f--launch">
              <span>Lanzamiento</span>
              <div class="ape__launch">
                <label class="ape__check"><input type="checkbox" v-model="draft.is_launch" /> Es lanzamiento</label>
                <input v-if="draft.is_launch" v-model="draft.launch_order" type="number" class="edit__input edit__input--sm" placeholder="Orden" />
              </div>
            </label>
          </div>
          <label class="edit__f"><span>Descripción</span><textarea v-model="draft.description" rows="2" class="edit__input"></textarea></label>

          <!-- Variantes -->
          <div class="ape__vars">
            <div class="ape__varshd">
              <span class="ape__varstitle">Variantes (talla / color / stock) *</span>
              <span v-if="!esCrear" class="ape__varsnote">El stock se guarda al instante</span>
            </div>

            <!-- CREAR: filas editables recolectadas -->
            <template v-if="esCrear">
              <div v-for="(v, i) in draft.variants" :key="i" class="nvar">
                <select v-model="v.size" class="addvar__input">
                  <option value="">Talla…</option>
                  <option v-for="t in TALLAS" :key="t" :value="t">{{ t }}</option>
                </select>
                <input v-model="v.color" class="addvar__input" placeholder="Color (opcional)" />
                <input v-model="v.stock" type="number" min="0" step="1" class="addvar__input addvar__stock" placeholder="Stock" />
                <button class="nvar__del" :disabled="draft.variants.length === 1" @click="quitarVarNueva(i)" title="Quitar">🗑</button>
              </div>
              <button class="ape__addvar" @click="agregarVarNueva">＋ Agregar variante</button>
            </template>

            <!-- EDITAR: tabla en vivo con guardado por-fila -->
            <template v-else>
              <table v-if="variantes.length" class="vtab">
                <thead><tr><th>Talla</th><th>Color</th><th>Stock</th><th></th></tr></thead>
                <tbody>
                  <tr v-for="v in variantesOrdenadas()" :key="v.id">
                    <td>{{ v.size || '—' }}</td>
                    <td>{{ v.color || '—' }}</td>
                    <td>
                      <input v-model="stockEdit[v.id]" type="number" min="0" step="1" inputmode="numeric"
                             class="vtab__input" :class="{ 'vtab__input--bad': !stockValido(stockEdit[v.id]) }"
                             @keyup.enter="guardarStock(v)" />
                    </td>
                    <td class="vtab__action">
                      <button class="ape__save ape__save--xs"
                              :disabled="stockEstado[v.id] === 'guardando' || !stockSucio(v) || !stockValido(stockEdit[v.id])"
                              @click="guardarStock(v)">
                        <span v-if="stockEstado[v.id] === 'guardando'" class="spinner spinner--sm"></span>
                        {{ stockEstado[v.id] === 'guardando' ? '…' : 'Guardar' }}
                      </button>
                      <span v-if="stockEstado[v.id] === 'ok' && !stockSucio(v)" class="vtab__ok">✓</span>
                      <span v-if="stockEstado[v.id] === 'error'" class="vtab__err">{{ stockMsg[v.id] }}</span>
                      <button class="vtab__del" :disabled="varBusy" @click="eliminarVariante(v)" title="Eliminar">🗑</button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="ape__hint">Sin variantes. Agrega la primera abajo.</p>
              <div class="addvar">
                <select v-model="nuevaVar.size" class="addvar__input">
                  <option value="">Talla…</option>
                  <option v-for="t in TALLAS" :key="t" :value="t">{{ t }}</option>
                </select>
                <input v-model="nuevaVar.color" class="addvar__input" placeholder="Color (opcional)" />
                <input v-model="nuevaVar.stock" type="number" min="0" step="1" class="addvar__input addvar__stock" placeholder="Stock" />
                <button class="ape__save ape__save--xs" :disabled="varBusy || !nuevaVar.size" @click="agregarVarEditar">
                  <span v-if="varBusy" class="spinner spinner--sm"></span> ＋ Agregar
                </button>
              </div>
            </template>
          </div>
        </section>

        <!-- ── Sección 2 · Fotos de tarjeta ── -->
        <section class="ape__sec">
          <h4 class="ape__h4"><span class="ape__num">2</span> Fotos de tarjeta</h4>
          <p class="ape__hint">La <strong>1.ª</strong> es la portada (se ve primero) y la <strong>2.ª</strong> aparece al pasar el mouse en el catálogo. Máximo 2.</p>
          <PhotoReorder v-model="tarjeta" :max="2" tags />
        </section>

        <!-- ── Sección 3 · Galería de detalle ── -->
        <section class="ape__sec">
          <h4 class="ape__h4"><span class="ape__num">3</span> Galería de detalle</h4>
          <p class="ape__hint">Fotos de la ficha del producto, en el orden que se mostrarán. Arrastra para reordenar (o usa ◀ ▶).</p>
          <p v-if="avisoColor" class="ape__aviso">ℹ️ Este producto tenía fotos por color; ahora se unifican en una sola galería (no se pierde ninguna).</p>
          <PhotoReorder v-model="detalle" />
        </section>
      </div>

      <aside class="ape__preview">
        <ProductPreview :product="cardProduct" :gallery="detalle" :creating="esCrear" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.ape { display: flex; flex-direction: column; gap: 1rem; animation: hb-fade-up 0.3s ease both; }
.ape__head {
  display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
  padding-bottom: 0.9rem; border-bottom: 1px solid var(--border);
}
.ape__back {
  padding: 0.45rem 0.9rem; font-size: 0.78rem; font-weight: 600;
  background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2);
  border-radius: 6px; cursor: pointer;
}
.ape__back:hover { color: var(--text-1); border-color: var(--accent); }
.ape__title { flex: 1; font-family: var(--font-display); font-weight: 700; font-size: 1.05rem; color: var(--text-1); min-width: 0; }
.ape__headright { display: flex; align-items: center; gap: 0.9rem; }
.ape__active { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: var(--text-2); cursor: pointer; }
.ape__save {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.55rem 1.2rem; font-size: 0.78rem; font-weight: 700;
  background: var(--accent); border: 1px solid var(--accent); color: var(--ink);
  border-radius: 6px; cursor: pointer;
}
.ape__save:hover:not(:disabled) { filter: brightness(1.08); }
.ape__save:disabled { opacity: 0.5; cursor: not-allowed; }
.ape__save--xs { padding: 0.4rem 0.7rem; font-size: 0.7rem; font-weight: 600; }
.ape__err { color: var(--danger); font-size: 0.82rem; }

.ape__layout { display: grid; grid-template-columns: 1fr 340px; gap: 1.5rem; align-items: start; }
.ape__form { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.ape__preview {
  position: sticky; top: 1rem;
  background: var(--surface-1); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 1.1rem;
}

.ape__sec { background: var(--card-bg); border: 1px solid var(--border-mid); border-radius: var(--radius-md); padding: 1.1rem; }
.ape__h4 { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; font-weight: 700; color: var(--text-1); margin-bottom: 0.9rem; }
.ape__num { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-size: 0.72rem; }
.ape__hint { font-size: 0.74rem; color: var(--text-3); margin-bottom: 0.7rem; line-height: 1.5; }
.ape__aviso {
  font-size: 0.74rem; color: var(--text-2); line-height: 1.5;
  background: var(--surface-2); border: 1px solid var(--border-mid);
  border-radius: 6px; padding: 0.5rem 0.7rem; margin-bottom: 0.7rem;
}

/* Formulario (mismos patrones que el admin) */
.edit__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; margin-bottom: 0.6rem; }
.edit__f { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.6rem; }
.edit__f > span { font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); font-weight: 600; }
.edit__input { background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); padding: 0.5rem 0.6rem; font-size: 0.88rem; outline: none; border-radius: 6px; font-family: inherit; }
.edit__input:focus-visible { border-color: var(--accent); }
.edit__input--sm { max-width: 110px; }
.cats { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.cats__chip { padding: 0.4rem 0.85rem; font-size: 0.78rem; font-weight: 600; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); border-radius: var(--radius-pill); cursor: pointer; }
.cats__chip:hover { border-color: var(--accent); color: var(--text-1); }
.cats__chip--on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.ape__launch { display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap; }
.ape__check { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; color: var(--text-2); cursor: pointer; }

/* Variantes */
.ape__vars { margin-top: 0.5rem; }
.ape__varshd { display: flex; align-items: baseline; justify-content: space-between; gap: 0.6rem; margin-bottom: 0.6rem; flex-wrap: wrap; }
.ape__varstitle { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); font-weight: 600; }
.ape__varsnote { font-size: 0.68rem; color: var(--text-3); font-style: italic; }
.nvar { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.5rem; }
.nvar__del { background: transparent; border: none; cursor: pointer; font-size: 0.95rem; opacity: 0.7; }
.nvar__del:hover:not(:disabled) { opacity: 1; }
.nvar__del:disabled { opacity: 0.3; cursor: not-allowed; }
.ape__addvar { align-self: flex-start; padding: 0.4rem 0.8rem; font-size: 0.74rem; font-weight: 600; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); cursor: pointer; border-radius: 6px; }
.ape__addvar:hover { color: var(--text-1); border-color: var(--accent); }
.addvar { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.7rem; flex-wrap: wrap; }
.addvar__input { background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); padding: 0.4rem 0.55rem; font-size: 0.82rem; outline: none; border-radius: 6px; font-family: inherit; }
.addvar__input:focus-visible { border-color: var(--accent); }
.addvar__stock { width: 90px; }

.vtab { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.vtab th { text-align: left; font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); font-weight: 600; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border); }
.vtab td { padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--border); color: var(--text-2); vertical-align: middle; }
.vtab tbody tr:last-child td { border-bottom: none; }
.vtab__input { width: 84px; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); padding: 0.4rem 0.55rem; font-size: 0.85rem; outline: none; border-radius: 6px; }
.vtab__input:focus-visible { border-color: var(--accent); }
.vtab__input--bad { border-color: var(--danger); }
.vtab__action { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.vtab__ok { font-size: 0.8rem; color: var(--success); }
.vtab__err { font-size: 0.7rem; color: var(--danger); }
.vtab__del { background: transparent; border: none; cursor: pointer; font-size: 0.9rem; opacity: 0.7; padding: 0.2rem; }
.vtab__del:hover:not(:disabled) { opacity: 1; }
.vtab__del:disabled { opacity: 0.3; cursor: not-allowed; }

.spinner { width: 22px; height: 22px; border: 2px solid var(--text-3); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
.spinner--sm { width: 13px; height: 13px; border-width: 2px; border-color: currentColor; border-top-color: transparent; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 900px) {
  .ape__layout { grid-template-columns: 1fr; }
  .ape__preview { position: static; }
}
@media (max-width: 560px) {
  .edit__grid { grid-template-columns: 1fr; }
}
</style>
