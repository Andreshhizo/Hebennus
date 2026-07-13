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

const productos = ref([])
const cargando  = ref(true)
const error     = ref('')

// null = grilla; 'nuevo' = crear; objeto producto = editar.
const editando = ref(null)

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

function abrirNuevo()      { editando.value = 'nuevo' }
function abrirEdicion(p)   { editando.value = p }
function volver()          { editando.value = null }

function onSaved() {
  // Crear: recargar para ver el nuevo producto y volver a la grilla.
  // Editar: el objeto ya se actualizó in-place; permanecemos en el editor.
  if (editando.value === 'nuevo') {
    editando.value = null
    cargar()
  }
}

onMounted(cargar)
</script>

<template>
  <div class="prods">
    <p v-if="error" class="prods__error" role="alert">{{ error }}</p>

    <AdminProductEditor
      v-if="editando"
      :key="editando === 'nuevo' ? 'nuevo' : editando.id"
      :mode="editando === 'nuevo' ? 'crear' : 'editar'"
      :product="editando === 'nuevo' ? null : editando"
      @back="volver"
      @saved="onSaved"
    />

    <AdminProductGrid
      v-else
      :products="productos"
      :loading="cargando"
      @select="abrirEdicion"
      @nuevo="abrirNuevo"
      @refresh="cargar"
    />
  </div>
</template>

<style scoped>
.prods { min-height: 200px; }
.prods__error { color: var(--danger); font-size: 0.82rem; margin-bottom: 1rem; }
</style>
