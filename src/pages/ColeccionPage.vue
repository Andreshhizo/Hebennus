<script setup>
import { ref, computed, onMounted, inject } from 'vue'
import { supabase }     from '../lib/supabase.js'
import { zonaDePrenda } from '../lib/prendas.js'
import ProductCard      from '../components/ProductCard.vue'
import SkeletonCard     from '../components/SkeletonCard.vue'

const addToCart = inject('addToCart')

const todos      = ref([])
const cargando   = ref(true)
const errorMsg   = ref(null)
const categoriaActiva = ref('Todos')
const zonaActiva      = ref('Todos')
const ordenActivo     = ref('nuevos')

const CATEGORIAS = ['Todos', 'Style', 'Sport', 'Comfort']
const ZONAS = [
  { label: 'Todos',      value: 'Todos' },
  { label: 'Upper Body', value: 'upper' },
  { label: 'Low Body',   value: 'low'   },
]
const ORDENES = [
  { key: 'nuevos',      label: 'Más nuevos' },
  { key: 'precio-asc',  label: 'Precio ↑' },
  { key: 'precio-desc', label: 'Precio ↓' },
]

// Filtros combinables: estilo Y zona del cuerpo.
const filtrados = computed(() =>
  todos.value.filter(p => {
    const okCat  = categoriaActiva.value === 'Todos' || p.category === categoriaActiva.value
    const okZona = zonaActiva.value === 'Todos' || zonaDePrenda(p.tipo_prenda) === zonaActiva.value
    return okCat && okZona
  })
)

const hayFiltro = computed(() => categoriaActiva.value !== 'Todos' || zonaActiva.value !== 'Todos')
function limpiarFiltros() { categoriaActiva.value = 'Todos'; zonaActiva.value = 'Todos' }

const productos = computed(() => {
  const list = [...filtrados.value]
  if (ordenActivo.value === 'precio-asc')  return list.sort((a, b) => a.price - b.price)
  if (ordenActivo.value === 'precio-desc') return list.sort((a, b) => b.price - a.price)
  return list // 'nuevos' = order from Supabase (created_at desc)
})

onMounted(async () => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*, product_variants(*)')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
    if (error) throw error
    todos.value = data
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    cargando.value = false
  }
})
</script>

<template>
<div>
  <section class="page-hero">
    <div class="page-hero__inner">
      <span class="chip">SS25</span>
      <h1 class="page-hero__title">La Colección</h1>
      <p class="page-hero__sub">Oversize · Atlético · Cómodo</p>
    </div>
  </section>

  <section class="catalog">
    <!-- Controles: filtros + ordenar -->
    <div class="catalog__controls">
      <div class="catalog__filter-groups">
        <!-- Estilo -->
        <div class="filtro-group">
          <span class="filtro-group__label">Estilo</span>
          <div class="filtros" role="group" aria-label="Filtrar por estilo">
            <button
              v-for="cat in CATEGORIAS"
              :key="cat"
              class="filtro-btn"
              :class="{ 'filtro-btn--active': categoriaActiva === cat }"
              @click="categoriaActiva = cat"
            >{{ cat }}</button>
          </div>
        </div>

        <!-- Zona del cuerpo -->
        <div class="filtro-group">
          <span class="filtro-group__label">Zona</span>
          <div class="filtros" role="group" aria-label="Filtrar por zona del cuerpo">
            <button
              v-for="z in ZONAS"
              :key="z.value"
              class="filtro-btn"
              :class="{ 'filtro-btn--active': zonaActiva === z.value }"
              @click="zonaActiva = z.value"
            >{{ z.label }}</button>
          </div>
        </div>
      </div>

      <div class="orden">
        <label class="orden__label" for="orden-select">Ordenar</label>
        <select id="orden-select" v-model="ordenActivo" class="orden__select">
          <option v-for="o in ORDENES" :key="o.key" :value="o.key">{{ o.label }}</option>
        </select>
      </div>
    </div>

    <!-- Contador -->
    <p v-if="!cargando && !errorMsg" class="catalog__count">
      {{ productos.length }} {{ productos.length === 1 ? 'producto' : 'productos' }}
      <span v-if="hayFiltro">filtrados</span>
    </p>

    <!-- Skeletons -->
    <div v-if="cargando" class="grid">
      <SkeletonCard v-for="i in 8" :key="i" />
    </div>

    <!-- Error -->
    <div v-else-if="errorMsg" class="state state--err">
      <p class="state__msg">No se pudo cargar el catálogo.</p>
      <small>{{ errorMsg }}</small>
    </div>

    <!-- Vacío -->
    <div v-else-if="!productos.length" class="state">
      <p class="state__msg">
        {{ hayFiltro ? 'Sin productos con esos filtros por ahora.' : 'Pronto, nuevas piezas.' }}
      </p>
      <button v-if="hayFiltro" class="state__reset" @click="limpiarFiltros">
        Ver todo
      </button>
    </div>

    <!-- Grid -->
    <div v-else class="grid">
      <ProductCard
        v-for="p in productos"
        :key="p.id"
        :product="p"
        @add-to-cart="addToCart"
      />
    </div>
  </section>
</div>
</template>

<style scoped>
.page-hero {
  border-bottom: 1px solid var(--border);
  padding: 3.5rem 2rem 3rem;
  background: var(--surface-1);
}
.page-hero__inner { max-width: 1200px; margin: 0 auto; }
.chip {
  display: inline-block;
  font-size: 0.68rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--accent-3);
}
.page-hero__title {
  font-family: var(--font-display);
  font-size: clamp(2.5rem, 6vw, 5rem);
  font-weight: 300;
  letter-spacing: -0.03em;
  color: var(--text-1);
  line-height: 1.05;
  margin-top: 0.75rem;
}
.page-hero__sub {
  margin-top: 1rem;
  font-size: 0.75rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-3);
}

/* ── CATALOG ── */
.catalog {
  max-width: 1200px;
  margin: 0 auto;
  padding: 3rem 2rem 6rem;
}

/* ── CONTROLS ── */
.catalog__controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
  padding-bottom: 1.25rem;
  margin-bottom: 1rem;
}
.catalog__filter-groups {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.filtro-group {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  flex-wrap: wrap;
}
.filtro-group__label {
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-3);
  white-space: nowrap;
  min-width: 3.5rem;
}
.filtros {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.filtro-btn {
  padding: 0.45rem 1.2rem;
  font-size: 0.72rem;
  font-family: var(--font-display);
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-3);
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  transition: all 0.18s ease;
}
.filtro-btn:hover { color: var(--text-1); border-color: var(--border-mid); }
.filtro-btn--active {
  color: var(--ink);
  background: var(--text-1);
  border-color: var(--text-1);
}

.orden {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.orden__label {
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-3);
  white-space: nowrap;
}
.orden__select {
  background: var(--surface-2);
  border: 1px solid var(--border-mid);
  color: var(--text-1);
  font-family: var(--font-body);
  font-size: 0.78rem;
  padding: 0.4rem 0.8rem;
  cursor: pointer;
  outline: none;
  transition: border-color 0.2s;
  appearance: auto;
}
.orden__select:focus { border-color: var(--accent); }

/* ── COUNT ── */
.catalog__count {
  font-size: 0.72rem;
  color: var(--text-3);
  letter-spacing: 0.06em;
  margin-bottom: 2rem;
}

/* ── GRID ── */
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1.5rem;
}

/* ── STATES ── */
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 6rem 1rem;
  text-align: center;
}
.state__msg { font-family: var(--font-display); font-size: 1.5rem; font-weight: 300; color: var(--text-1); }
.state--err .state__msg { color: var(--copper-light); }
.state__reset {
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-2);
  border-bottom: 1px solid var(--border-mid);
  padding-bottom: 2px;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}
.state__reset:hover { color: var(--text-1); border-color: var(--text-1); }

@media (max-width: 1024px) { .grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 720px)  { .grid { grid-template-columns: repeat(2, 1fr); gap: 1rem; } }
@media (max-width: 600px)  {
  .catalog { padding: 2.5rem 1.25rem 5rem; }
  .page-hero { padding: 2.5rem 1.25rem 2rem; }
  .catalog__controls { flex-direction: column; align-items: flex-start; }
}
</style>
