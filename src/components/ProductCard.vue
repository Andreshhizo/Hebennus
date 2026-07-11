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

const variantes = computed(() => props.product.product_variants ?? [])

// Colores disponibles = colores distintos no-nulos de las variantes.
const colores = computed(() => [...new Set(variantes.value.map(v => v.color).filter(Boolean))])

// Por defecto la galería muestra el primer color disponible (o la lista plana si no hay colores).
const colorGaleria = computed(() => colores.value[0] ?? null)

// Imágenes de un color = images_by_color[color] ?? images plano ?? [].
const imagenes = computed(() => {
  const c = colorGaleria.value
  if (c) return props.product.images_by_color?.[c] ?? props.product.images ?? []
  return props.product.images ?? []
})
const imagen   = computed(() => imagenes.value[imagenIdx.value] ?? imagenes.value[0] ?? null)

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
// Producto AGOTADO = todas las variantes con stock <= 0 (o sin variantes con stock).
const agotado       = computed(() => stockTotal.value === 0)
const pocasUnidades = computed(() => stockTotal.value > 0 && stockTotal.value <= STOCK_LOW_THRESHOLD)

const precioFmt = computed(() => `S/ ${Number(props.product.price).toFixed(2)}`)

function onHover() { if (imagenes.value.length > 1) imagenIdx.value = 1 }
function onLeave() { imagenIdx.value = 0 }
function irA(idx)  { imagenIdx.value = idx }

// Navegación del carrusel con wrap-around.
function prevImg() {
  const n = imagenes.value.length
  if (n <= 1) return
  imagenIdx.value = (imagenIdx.value - 1 + n) % n
}
function nextImg() {
  const n = imagenes.value.length
  if (n <= 1) return
  imagenIdx.value = (imagenIdx.value + 1) % n
}

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
          :class="{ 'card__img--out': agotado }"
        />
        <div v-else :key="'placeholder'" class="card__placeholder" aria-hidden="true">
          <span>HEBENNUS</span>
        </div>
      </Transition>

      <!-- Stock badge -->
      <div v-if="agotado" class="card__badge card__badge--out">Agotado</div>
      <div v-else-if="pocasUnidades" class="card__badge card__badge--low">Últimas {{ stockTotal }}</div>

      <!-- Carousel arrows -->
      <template v-if="imagenes.length > 1">
        <button
          type="button"
          class="card__arrow card__arrow--prev"
          aria-label="Imagen anterior"
          @click.stop="prevImg"
        >‹</button>
        <button
          type="button"
          class="card__arrow card__arrow--next"
          aria-label="Imagen siguiente"
          @click.stop="nextImg"
        >›</button>
      </template>

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
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft);
  overflow: hidden;
  transition: box-shadow 0.4s var(--ease-out), transform 0.4s var(--ease-out);
}
.card:hover {
  box-shadow: var(--shadow-hover);
  transform: translateY(-4px);
}

/* ── MEDIA ── */
.card__media {
  position: relative;
  aspect-ratio: 3 / 4;
  background: var(--surface-2);
  overflow: hidden;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}
.card__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.8s var(--ease-out), filter 0.4s var(--ease-out);
}
.card:hover .card__img { transform: scale(1.05); }
/* Producto agotado: escala de grises + oscurecido */
.card__img--out { filter: grayscale(1) brightness(0.5); }

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
  padding: 0.3rem 0.7rem;
  font-weight: 600;
  font-family: var(--font-display);
  border-radius: var(--radius-pill);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 2px 10px rgba(0,0,0,0.25);
  animation: hb-pop 0.35s var(--ease-spring) both;
}
.card__badge--out { background: rgba(0,0,0,0.65); color: var(--text-2); }
.card__badge--low { background: var(--grad-cool); color: #fff; }

/* ── CAROUSEL ARROWS ── */
.card__arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%) scale(0.9);
  z-index: 11;
  width: 2.1rem;
  height: 2.1rem;
  display: grid;
  place-items: center;
  background: rgba(0,0,0,0.4);
  color: var(--text-1);
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: var(--radius-pill);
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  transition: opacity 0.3s var(--ease-out), transform 0.3s var(--ease-spring), background 0.2s var(--ease-out), border-color 0.2s var(--ease-out);
}
.card:hover .card__arrow { opacity: 1; transform: translateY(-50%) scale(1); }
.card__arrow:hover {
  background: rgba(0,0,0,0.7);
  border-color: rgba(255,255,255,0.55);
  transform: translateY(-50%) scale(1.1);
}
.card__arrow:active { transform: translateY(-50%) scale(0.94); }
.card__arrow:focus-visible { opacity: 1; transform: translateY(-50%) scale(1); outline: 2px solid var(--accent); outline-offset: 2px; }
.card__arrow--prev { left: 0.6rem; }
.card__arrow--next { right: 0.6rem; }

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
  border-radius: var(--radius-pill);
  background: var(--overlay-dot);
  transition: background 0.25s var(--ease-out), transform 0.3s var(--ease-spring), width 0.3s var(--ease-spring);
}
.card__dot--active { background: var(--grad-cool); width: 16px; transform: scale(1.15); }
.card__dot:hover:not(.card__dot--active) { background: var(--overlay-dot-hover); transform: scale(1.2); }

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

/* En pantallas táctiles NO hay :hover → mostrar flechas, dots y acciones siempre.
   La compra rápida y navegar fotos deben ser alcanzables desde el celular. */
@media (hover: none) {
  .card__arrow { opacity: 1; transform: translateY(-50%) scale(1); }
  .card__dots { opacity: 1; }
  .card__overlay {
    opacity: 1;
    pointer-events: auto;
    justify-content: flex-end;
    padding-bottom: 0.85rem;
    background: linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.18) 42%, rgba(0,0,0,0) 72%);
  }
}
.card__overlay-btn {
  padding: 0.6rem 1.5rem;
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-family: var(--font-display);
  font-weight: 500;
  cursor: pointer;
  border-radius: var(--radius-pill);
  transform: translateY(8px);
  opacity: 0;
  transition: transform 0.35s var(--ease-spring), opacity 0.3s var(--ease-out),
              background 0.2s var(--ease-out), border-color 0.2s var(--ease-out), color 0.2s var(--ease-out);
}
.card:hover .card__overlay-btn { transform: translateY(0); opacity: 1; }
.card:hover .card__overlay-btn--quick { transition-delay: 0.05s; }
.card__overlay-btn:active { transform: scale(0.96); }
.card__overlay-btn--ver {
  background: var(--text-1);
  color: var(--ink);
  border: 1px solid var(--text-1);
}
.card__overlay-btn--ver:hover {
  background: var(--grad-cool);
  border-color: transparent;
  color: #fff;
}
.card__overlay-btn--quick {
  background: rgba(255,255,255,0.06);
  color: var(--text-1);
  border: 1px solid rgba(255,255,255,0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.card__overlay-btn--quick:hover {
  background: rgba(255,255,255,0.16);
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
  font-family: var(--font-display);
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
  padding: 0.35rem 0.5rem;
  background: transparent;
  color: var(--text-2);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-pill);
  font-size: 0.74rem;
  font-family: var(--font-body);
  transition: transform 0.25s var(--ease-spring), background 0.2s var(--ease-out),
              border-color 0.2s var(--ease-out), color 0.2s var(--ease-out);
  cursor: pointer;
}
.size-btn:hover:not(:disabled):not(.size-btn--active) {
  border-color: var(--text-2);
  color: var(--text-1);
  transform: translateY(-2px);
}
.size-btn:active:not(:disabled) { transform: scale(0.94); }
.size-btn--active {
  background: var(--text-1);
  color: var(--ink);
  border-color: var(--text-1);
  transform: translateY(-1px);
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
  padding: 0.8rem 1rem;
  width: 100%;
  background: transparent;
  color: var(--text-3);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-pill);
  font-size: 0.72rem;
  font-family: var(--font-display);
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 0.25s var(--ease-spring), background 0.25s var(--ease-out),
              border-color 0.25s var(--ease-out), color 0.25s var(--ease-out), box-shadow 0.25s var(--ease-out);
}
.card__add--ready {
  background: var(--grad-cool);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 6px 18px var(--glow-color);
}
.card__add--ready:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 26px var(--glow-color);
  filter: brightness(1.05);
}
.card__add--ready:active { transform: scale(0.97); }
.card__add--disabled { opacity: 0.45; cursor: not-allowed; }
</style>
