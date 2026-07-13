<script setup>
// ─── Panel admin · Vista PRODUCTOS (orquestador) ────────────────────────────
// Grilla visual de productos ⇄ editor a pantalla completa.
//   • AdminProductGrid  → tarjetas con miniatura + filtro por categoría.
//   • AdminProductEditor → 3 secciones (inventario/variantes · fotos de tarjeta ·
//     galería de detalle) + preview en vivo.
// Los datos (imágenes, variantes) se persisten dentro del editor; aquí solo se
// carga la lista y se navega entre grilla y editor.
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase.js'
import AdminProductGrid from './AdminProductGrid.vue'
import AdminProductEditor from './AdminProductEditor.vue'
import AdminErrorModal from './AdminErrorModal.vue'

const productos = ref([])
const cargando  = ref(true)
const error     = ref('')

// null = grilla; 'nuevo' = crear; objeto producto = editar.
const editando = ref(null)
// Producto origen al DUPLICAR (modo crear pre-cargado). null = crear en blanco.
const seedDuplicado = ref(null)

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
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    cargando.value = false
  }
}

function abrirNuevo()      { seedDuplicado.value = null; editando.value = 'nuevo' }
function abrirEdicion(p)   { seedDuplicado.value = null; editando.value = p }
function duplicar(p)       { seedDuplicado.value = p; editando.value = 'nuevo' }
function volver()          { editando.value = null; seedDuplicado.value = null }

// Marcar/quitar "Sold Out" con un clic desde la grilla (guardado inmediato).
async function toggleSoldOut(p) {
  const valor = !p.sold_out
  p.sold_out = valor   // optimista
  const { error: e } = await supabase.from('products').update({ sold_out: valor }).eq('id', p.id)
  if (e) { p.sold_out = !valor; error.value = 'No se pudo cambiar Sold Out: ' + e.message }
}

function onSaved() {
  // Crear/duplicar: recargar para ver el nuevo producto y volver a la grilla.
  // Editar: el objeto ya se actualizó in-place; permanecemos en el editor.
  if (editando.value === 'nuevo') {
    editando.value = null
    seedDuplicado.value = null
    cargar()
  }
}

onMounted(cargar)
</script>

<template>
  <div class="prods">
    <p v-if="error" class="prods__error" role="alert">{{ error }}</p>
    <AdminErrorModal :open="!!error" :error="error" @close="error = ''" />

    <AdminProductEditor
      v-if="editando"
      :key="editando === 'nuevo' ? ('nuevo-' + (seedDuplicado?.id || 'blank')) : editando.id"
      :mode="editando === 'nuevo' ? 'crear' : 'editar'"
      :product="editando === 'nuevo' ? null : editando"
      :seed="editando === 'nuevo' ? seedDuplicado : null"
      @back="volver"
      @saved="onSaved"
    />

    <AdminProductGrid
      v-else
      :products="productos"
      :loading="cargando"
      @select="abrirEdicion"
      @nuevo="abrirNuevo"
      @duplicar="duplicar"
      @toggle-soldout="toggleSoldOut"
      @refresh="cargar"
    />
  </div>
</template>

<style scoped>
.prods { min-height: 200px; }
.prods__error { color: var(--danger); font-size: 0.82rem; margin-bottom: 1rem; }
</style>
