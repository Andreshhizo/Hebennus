<script setup>
import { ref, computed, inject } from 'vue'
import { RouterLink } from 'vue-router'
import { STOCK_LOW_THRESHOLD } from '../lib/config.js'
import SizeGuideModal from './SizeGuideModal.vue'

const props = defineProps({
  product: { type: Object, required: true },
})
const emit = defineEmits(['add-to-cart'])

const openQuickBuy = inject('openQuickBuy', null)

const tallaElegida = ref(null)
const imagenIdx    = ref(0)
const sacudir      = ref(false)
const guideOpen    = ref(false)

const imagenes = computed(() => props.product.images ?? [])
const imagen   = computed(() => imagenes.value[imagenIdx.value] ?? imagenes.value[0] ?? null)

const variantes = computed(() => props.product.product_variants ?? [])

const SIZE_ORD = ['XS','S','M','L','XL','XXL','Única','ÚNICA']
// Tallas únicas (deduplicadas) y ordenadas — varias variantes con la misma talla
// (p. ej. M-Blanco y M-Negro) producen un solo botón "M".
const tallas = computed(() => {
  const unicas = [...new Set(variantes.value.map(v => v.size).filter(Boolean))]
  return unicas.sort((a, b) => {
    const ai = SIZE_ORD.indexOf(a), bi = SIZE_ORD.indexOf(b)
    if (ai === -1 && bi === -1) return 0
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
})
function tallaConStock(size) { return variantes.value.some(v => v.size === size && (v.stock ?? 0) > 0) }

// Resuelve la variante por talla + color por defecto: la primera variante con stock
// de esa talla; si ninguna tiene stock, la primera. Su color se propaga al carrito.
const varianteActiva = computed(() => {
  if (!tallaElegida.value) return null
  const deLaTalla = variantes.value.filter(v => v.size === tallaElegida.value)
  return deLaTalla.find(v => (v.stock ?? 0) > 0) ?? deLaTalla[0] ?? null
})

const stockTotal    = computed(() => variantes.value.reduce((s, v) => s + (v.stock ?? 0), 0))
const agotado       = computed(() => stockTotal.value === 0)
const pocasUnidades = computed(() => stockTotal.value > 0 && stockTotal.value <= STOCK_LOW_THRESHOLD)

const precioFmt = computed(() => `S/ ${Number(props.product.price).toFixed(2)}`)

function onHover() { if (imagenes.value.length > 1) imagenIdx.value = 1 }
function onLeave() { imagenIdx.value = 0 }
function irA(idx)  { imagenIdx.value = idx }

function handleAdd() {
  if (agotado.value) return
  if (!tallaElegida.value) {
    sacudir.value = true
    setTimeout(() => { sacudir.value = false }, 500)
    return
  }
  emit('add-to-cart', {
    name:      props.product.name,
    size:      tallaElegida.value,
    color:     varianteActiva.value?.color ?? null,
    price:     props.product.price,
    image:     imagenes.value[0] ?? null,
    productId: props.product.id,
    variantId: varianteActiva.value?.id,
  })
  tallaElegida.value = null
}
</script>

<template>
  <article class="card">
    <!-- Image -->
    <div class="card__media" @mouseenter="onHover" @mouseleave="onLeave">
      <Transition name="img-swap" mode="out-in">
        <img
          v-if="imagen"
          :key="imagenIdx"
          :src="imagen"
          :alt="product.name"
          loading="lazy"
          class="card__img"
        />
        <div v-else :key="'placeholder'" class="card__placeholder" aria-hidden="true">
          <span>HEBENNUS</span>
        </div>
      </Transition>

      <!-- Stock badge -->
      <div v-if="agotado" class="card__badge card__badge--out">Agotado</div>
      <div v-else-if="pocasUnidades" class="card__badge card__badge--low">Últimas {{ stockTotal }}</div>

      <!-- Image dots -->
      <div v-if="imagenes.length > 1" class="card__dots" aria-hidden="true">
        <button
          v-for="(_, i) in imagenes"
          :key="i"
          class="card__dot"
          :class="{ 'card__dot--active': imagenIdx === i }"
          @click.stop="irA(i)"
          @mouseenter.stop="irA(i)"
        ></button>
      </div>

      <!-- Hover overlay -->
      <div class="card__overlay" aria-hidden="true">
        <RouterLink
          :to="`/producto/${product.id}`"
          class="card__overlay-btn card__overlay-btn--ver"
          @click.stop
        >Ver producto</RouterLink>
        <button
          v-if="openQuickBuy && !agotado"
          class="card__overlay-btn card__overlay-btn--quick"
          @click.stop="openQuickBuy(product)"
        >Compra rápida</button>
      </div>
    </div>

    <!-- Body -->
    <div class="card__body">
      <div class="card__row">
        <RouterLink :to="`/producto/${product.id}`" class="card__name">{{ product.name }}</RouterLink>
        <span class="card__price">{{ precioFmt }}</span>
      </div>

      <p v-if="product.description" class="card__desc">{{ product.description }}</p>

      <!-- Sizes header -->
      <div class="card__sizes-hd">
        <span class="card__sizes-label">Talla</span>
        <button class="card__guide-btn" @click="guideOpen = true">Guía →</button>
      </div>

      <!-- Size selector -->
      <div class="card__sizes" :class="{ 'card__sizes--shake': sacudir }" role="group" :aria-label="`Tallas de ${product.name}`">
        <button
          v-for="t in tallas"
          :key="t"
          class="size-btn"
          :class="{
            'size-btn--active': tallaElegida === t,
            'size-btn--out':    !tallaConStock(t),
          }"
          :disabled="!tallaConStock(t)"
          :aria-pressed="tallaElegida === t"
          @click="tallaElegida = tallaElegida === t ? null : t"
        >{{ t }}</button>
      </div>

      <!-- Add to cart -->
      <button
        class="card__add"
        :class="{
          'card__add--ready':    tallaElegida && !agotado,
          'card__add--disabled': agotado,
        }"
        :disabled="agotado"
        @click="handleAdd"
      >
        <template v-if="agotado">Agotado</template>
        <template v-else-if="tallaElegida">Añadir — {{ tallaElegida }}</template>
        <template v-else>Elige una talla</template>
      </button>
    </div>

    <SizeGuideModal :open="guideOpen" @close="guideOpen = false" />
  </article>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  background: var(--card-bg);
  box-shadow: var(--shadow-card);
  transition: box-shadow 0.3s ease, transform 0.3s ease;
}
.card:hover {
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-3px);
}

/* ── MEDIA ── */
.card__media {
  position: relative;
  aspect-ratio: 3 / 4;
  background: var(--surface-2);
  overflow: hidden;
}
.card__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.7s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
.card:hover .card__img { transform: scale(1.04); }

.img-swap-enter-active { transition: opacity 0.22s ease; }
.img-swap-leave-active { transition: opacity 0.15s ease; }
.img-swap-enter-from,
.img-swap-leave-to { opacity: 0; }

.card__placeholder {
  width: 100%; height: 100%;
  display: grid;
  place-items: center;
  background: var(--surface-2);
}
.card__placeholder span {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 1rem;
  color: var(--text-3);
  letter-spacing: 0.25em;
}

/* ── STOCK BADGE ── */
.card__badge {
  position: absolute;
  top: 0.75rem; left: 0.75rem;
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 0.25rem 0.6rem;
  font-weight: 600;
  font-family: var(--font-display);
}
.card__badge--out { background: rgba(0,0,0,0.7); color: var(--text-2); }
.card__badge--low { background: var(--accent-2); color: #fff; }

/* ── DOTS ── */
.card__dots {
  position: absolute;
  bottom: 0.75rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 0.3rem;
  z-index: 10;
  opacity: 0;
  transition: opacity 0.25s ease;
}
.card:hover .card__dots { opacity: 1; }
.card__dot {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: var(--overlay-dot);
  transition: background 0.2s, transform 0.2s;
}
.card__dot--active { background: var(--text-1); transform: scale(1.3); }
.card__dot:hover:not(.card__dot--active) { background: var(--overlay-dot-hover); }

/* ── HOVER OVERLAY ── */
.card__overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.52);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}
.card:hover .card__overlay {
  opacity: 1;
  pointer-events: auto;
}
.card__overlay-btn {
  padding: 0.55rem 1.4rem;
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-family: var(--font-display);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s ease;
}
.card__overlay-btn--ver {
  background: var(--text-1);
  color: var(--ink);
  border: 1px solid var(--text-1);
}
.card__overlay-btn--ver:hover {
  background: var(--copper);
  border-color: var(--copper);
  color: #fff;
}
.card__overlay-btn--quick {
  background: transparent;
  color: var(--text-1);
  border: 1px solid rgba(255,255,255,0.45);
}
.card__overlay-btn--quick:hover {
  background: rgba(255,255,255,0.12);
  border-color: rgba(255,255,255,0.75);
}

/* ── BODY ── */
.card__body {
  padding: 1.1rem 1rem 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
}
.card__row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
}
.card__name {
  font-family: var(--font-display);
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--text-1);
  line-height: 1.3;
  transition: color 0.2s;
}
.card__name:hover { color: var(--copper-light); }
.card__price {
  font-size: 0.9rem;
  color: var(--text-1);
  white-space: nowrap;
  font-weight: 600;
}
.card__desc {
  font-size: 0.78rem;
  color: var(--text-3);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── SIZES HEADER ── */
.card__sizes-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.1rem;
}
.card__sizes-label {
  font-size: 0.65rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-3);
}
.card__guide-btn {
  font-size: 0.65rem;
  color: var(--text-3);
  letter-spacing: 0.08em;
  transition: color 0.2s;
}
.card__guide-btn:hover { color: var(--text-1); }

/* ── SIZES ── */
.card__sizes {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
}
.size-btn {
  min-width: 2.2rem;
  padding: 0.35rem 0.45rem;
  background: transparent;
  color: var(--text-2);
  border: 1px solid var(--border-mid);
  font-size: 0.74rem;
  font-family: var(--font-body);
  transition: all 0.15s ease;
  cursor: pointer;
}
.size-btn:hover:not(:disabled):not(.size-btn--active) {
  border-color: var(--text-2);
  color: var(--text-1);
}
.size-btn--active {
  background: var(--text-1);
  color: var(--ink);
  border-color: var(--text-1);
}
.size-btn--out {
  opacity: 0.3;
  cursor: not-allowed;
  text-decoration: line-through;
}
@keyframes shake {
  0%,100% { transform: translateX(0); }
  20%     { transform: translateX(-5px); }
  40%     { transform: translateX(5px); }
  60%     { transform: translateX(-4px); }
  80%     { transform: translateX(4px); }
}
.card__sizes--shake { animation: shake 0.45s ease; }

/* ── ADD BUTTON ── */
.card__add {
  margin-top: auto;
  padding: 0.75rem 1rem;
  width: 100%;
  background: transparent;
  color: var(--text-3);
  border: 1px solid var(--border-mid);
  font-size: 0.72rem;
  font-family: var(--font-display);
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.2s ease;
}
.card__add--ready {
  background: var(--text-1);
  color: var(--ink);
  border-color: var(--text-1);
}
.card__add--ready:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--ink);
}
.card__add--disabled { opacity: 0.45; cursor: not-allowed; }
</style>
