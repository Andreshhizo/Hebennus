<script setup>
// ─── Grilla visual de productos (admin) ─────────────────────────────────────
// Tarjetas con miniatura para identificar productos por imagen. Filtro por
// categoría + botón "Nuevo". Clic en una tarjeta → editar.
import { ref, computed } from 'vue'

const props = defineProps({
  products: { type: Array, default: () => [] },
  loading:  { type: Boolean, default: false },
})
const emit = defineEmits(['select', 'nuevo', 'refresh', 'duplicar'])

const CATEGORIAS = ['Todos', 'Style', 'Sport', 'Comfort']
const filtro = ref('Todos')

function catsDe(p) {
  return (p.categories && p.categories.length) ? p.categories : (p.category ? [p.category] : [])
}
function thumb(p) {
  if (Array.isArray(p.card_images) && p.card_images[0]) return p.card_images[0]
  if (Array.isArray(p.images) && p.images[0]) return p.images[0]
  const ibc = p.images_by_color || {}
  for (const c of Object.keys(ibc)) if (ibc[c]?.[0]) return ibc[c][0]
  return null
}
function stockTotal(p) {
  return (p.product_variants || []).reduce((s, v) => s + (v.stock ?? 0), 0)
}
function money(n) { return 'S/ ' + Number(n ?? 0).toFixed(2) }

const filtrados = computed(() =>
  props.products.filter(p => filtro.value === 'Todos' || catsDe(p).includes(filtro.value))
)
</script>

<template>
  <div class="pg">
    <div class="pg__bar">
      <div class="pg__filters" role="group" aria-label="Filtrar por categoría">
        <button
          v-for="c in CATEGORIAS" :key="c"
          class="pg__chip" :class="{ 'pg__chip--on': filtro === c }"
          @click="filtro = c"
        >{{ c }}</button>
      </div>
      <div class="pg__actions">
        <button class="pg__refresh" :disabled="loading" @click="emit('refresh')">↻ Actualizar</button>
        <button class="pg__new" @click="emit('nuevo')">＋ Nuevo producto</button>
      </div>
    </div>

    <div v-if="loading" class="pg__center"><span class="spinner"></span></div>

    <p v-else-if="!products.length" class="pg__empty">No hay productos. Crea el primero con "＋ Nuevo producto".</p>

    <p v-else-if="!filtrados.length" class="pg__empty">Sin productos en "{{ filtro }}".</p>

    <div v-else class="pg__grid">
      <div
        v-for="p in filtrados" :key="p.id"
        class="pcard" :class="{ 'pcard--off': !p.is_active }"
        role="button" tabindex="0"
        @click="emit('select', p)"
        @keydown.enter="emit('select', p)"
      >
        <div class="pcard__media">
          <img v-if="thumb(p)" :src="thumb(p)" :alt="p.name" loading="lazy" class="pcard__img" />
          <div v-else class="pcard__ph"><span>HEBENNUS</span></div>
          <span v-if="p.badge" class="pcard__badge">{{ p.badge }}</span>
          <span v-if="stockTotal(p) === 0" class="pcard__out">Agotado</span>
          <span v-if="!p.is_active" class="pcard__inactive">Inactivo</span>
          <button
            type="button" class="pcard__dup"
            title="Duplicar producto" aria-label="Duplicar producto"
            @click.stop="emit('duplicar', p)"
          >⧉ Duplicar</button>
        </div>
        <div class="pcard__body">
          <span class="pcard__name">{{ p.name }}</span>
          <div class="pcard__row">
            <span class="pcard__price">{{ money(p.price) }}</span>
            <span class="pcard__stock">{{ stockTotal(p) }} u.</span>
          </div>
          <div v-if="catsDe(p).length" class="pcard__cats">
            <span v-for="c in catsDe(p)" :key="c" class="pcard__cat">{{ c }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pg { display: flex; flex-direction: column; gap: 1.25rem; }
.pg__bar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.pg__filters { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.pg__chip {
  padding: 0.4rem 0.95rem; font-size: 0.74rem; font-weight: 600;
  background: transparent; border: 1px solid var(--border-mid); color: var(--text-3);
  border-radius: var(--radius-pill); cursor: pointer;
  transition: color 0.2s, border-color 0.2s, background 0.2s;
}
.pg__chip:hover { color: var(--text-1); border-color: var(--accent); }
.pg__chip--on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.pg__actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
.pg__refresh { padding: 0.5rem 0.9rem; font-size: 0.72rem; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); cursor: pointer; border-radius: 6px; }
.pg__refresh:hover:not(:disabled) { color: var(--text-1); }
.pg__new { padding: 0.5rem 1rem; font-size: 0.74rem; font-weight: 700; background: var(--accent); border: 1px solid var(--accent); color: var(--on-accent); cursor: pointer; border-radius: 6px; }
.pg__new:hover { filter: brightness(1.08); }
.pg__center { display: grid; place-items: center; padding: 3rem 0; }
.pg__empty { color: var(--text-3); padding: 3rem 0; text-align: center; }

.pg__grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.1rem; }

.pcard {
  display: flex; flex-direction: column;
  text-align: left; padding: 0;
  background: var(--card-bg); border: 1px solid var(--border-mid);
  border-radius: var(--radius-md); overflow: hidden; cursor: pointer;
  transition: border-color 0.2s var(--ease-out), box-shadow 0.25s var(--ease-out), transform 0.2s var(--ease-out);
}
.pcard:hover { border-color: var(--accent); box-shadow: var(--shadow-hover); transform: translateY(-3px); }
.pcard--off { opacity: 0.62; }
.pcard__media { position: relative; aspect-ratio: 3 / 4; background: var(--surface-2); overflow: hidden; }
.pcard__img { width: 100%; height: 100%; object-fit: cover; }
.pcard__ph { width: 100%; height: 100%; display: grid; place-items: center; }
.pcard__ph span { font-family: var(--font-display); font-weight: 800; letter-spacing: 0.22em; color: var(--text-3); font-size: 0.8rem; }
.pcard__badge {
  position: absolute; top: 0.5rem; left: 0.5rem;
  font-size: 0.55rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  padding: 0.25rem 0.5rem; border-radius: 4px; background: var(--accent); color: var(--on-accent);
}
.pcard__out {
  position: absolute; bottom: 0.5rem; left: 0.5rem;
  font-size: 0.58rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
  padding: 0.25rem 0.55rem; border-radius: 4px; background: rgba(20,18,15,.82); color: #F4F1EC;
}
.pcard__inactive {
  position: absolute; top: 0.5rem; right: 0.5rem;
  font-size: 0.55rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  padding: 0.25rem 0.5rem; border-radius: 4px; background: rgba(0,0,0,0.6); color: #fff;
}
.pcard__dup {
  position: absolute; bottom: 0.5rem; right: 0.5rem;
  display: inline-flex; align-items: center; gap: 0.25rem;
  font-size: 0.6rem; font-weight: 700; letter-spacing: 0.04em;
  padding: 0.3rem 0.55rem; border: none; border-radius: 6px;
  background: rgba(20,18,15,0.78); color: #F4F1EC; cursor: pointer;
  opacity: 0; transform: translateY(4px);
  transition: opacity 0.18s var(--ease-out), transform 0.18s var(--ease-out), background 0.18s;
}
.pcard:hover .pcard__dup { opacity: 1; transform: translateY(0); }
.pcard__dup:hover { background: var(--accent); color: var(--on-accent); }
@media (hover: none) { .pcard__dup { opacity: 1; transform: none; } }
.pcard__body { padding: 0.7rem 0.75rem 0.9rem; display: flex; flex-direction: column; gap: 0.35rem; }
.pcard__name { font-family: var(--font-display); font-weight: 600; font-size: 0.85rem; color: var(--text-1); line-height: 1.3; }
.pcard__row { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
.pcard__price { font-family: var(--font-display); font-weight: 600; font-size: 0.82rem; color: var(--text-1); }
.pcard__stock { font-size: 0.68rem; color: var(--text-3); }
.pcard__cats { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.pcard__cat { font-size: 0.6rem; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-3); background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 0.1rem 0.4rem; }

.spinner { width: 26px; height: 26px; border: 2px solid var(--text-3); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 1024px) { .pg__grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 720px)  { .pg__grid { grid-template-columns: repeat(2, 1fr); gap: 0.8rem; } }
</style>
