<script setup>
import { ref, computed, watch, inject } from 'vue'
import { RouterLink } from 'vue-router'
import SizeGuideModal from './SizeGuideModal.vue'
import { useModalUX } from '../lib/useModal.js'

const props = defineProps({
  product: { type: Object, default: null },
})
const emit = defineEmits(['close'])

const addToCart  = inject('addToCart')
const isOpen     = computed(() => !!props.product)
const qbPanel    = ref(null)
useModalUX(isOpen, () => emit('close'), qbPanel)
const guideOpen  = ref(false)
const imagenIdx    = ref(0)
const tallaElegida = ref(null)
const colorElegido = ref(null)

watch(() => props.product, () => {
  imagenIdx.value    = 0
  tallaElegida.value = null
  colorElegido.value = null
})

const imagenes  = computed(() => props.product?.images ?? [])
const variantes = computed(() => props.product?.product_variants ?? [])

const SIZE_ORD = ['XS','S','M','L','XL','XXL','Única','ÚNICA']

// Tallas únicas (deduplicadas) y ordenadas — dos variantes "M" → un solo botón "M".
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
const colores      = computed(() => [...new Set(variantes.value.map(v => v.color).filter(Boolean))])
const tieneColores = computed(() => colores.value.length > 0)

function tallaConStock(size)  { return variantes.value.some(v => v.size === size  && (v.stock ?? 0) > 0) }
function colorConStock(color) { return variantes.value.some(v => v.color === color && (v.stock ?? 0) > 0) }

// Variante final = talla + color (solo talla si el producto no tiene colores).
const varianteSel = computed(() => {
  if (!tallaElegida.value) return null
  if (tieneColores.value && !colorElegido.value) return null
  return variantes.value.find(v =>
    v.size === tallaElegida.value &&
    (!tieneColores.value || v.color === colorElegido.value)
  ) ?? null
})
const stockSel          = computed(() => varianteSel.value?.stock ?? 0)
const seleccionCompleta = computed(() => !!tallaElegida.value && (!tieneColores.value || !!colorElegido.value))
const comboSinStock     = computed(() => seleccionCompleta.value && stockSel.value <= 0)

const stockTotal   = computed(() => variantes.value.reduce((s, v) => s + (v.stock ?? 0), 0))
const agotado      = computed(() => stockTotal.value === 0)
const puedeAgregar = computed(() => seleccionCompleta.value && stockSel.value > 0 && !agotado.value)
const precioFmt    = computed(() =>
  props.product ? `S/ ${Number(props.product.price).toFixed(2)}` : ''
)

// Bonus: al elegir un color, la imagen principal salta a la primera foto de ese color.
watch(colorElegido, (color) => {
  if (!color) return
  const ci = colores.value.indexOf(color)
  const porColor = colores.value.length ? Math.floor(imagenes.value.length / colores.value.length) : 0
  if (ci < 0 || porColor <= 0) return
  const start = ci * porColor
  if (start < imagenes.value.length) imagenIdx.value = start
})

function handleAdd() {
  const v = varianteSel.value
  if (!v || (v.stock ?? 0) <= 0) return
  addToCart({
    name:      props.product.name,
    size:      tallaElegida.value,
    color:     colorElegido.value,
    price:     props.product.price,
    image:     imagenes.value[imagenIdx.value] ?? imagenes.value[0] ?? null,
    productId: props.product.id,
    variantId: v.id,
  })
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="isOpen" class="overlay" @click="emit('close')" aria-hidden="true"></div>
    </Transition>

    <Transition name="qb-slide">
      <div v-if="isOpen" ref="qbPanel" class="qb" role="dialog" aria-modal="true" :aria-label="`Compra rápida: ${product?.name}`">
        <!-- Close -->
        <button class="qb__close" @click="emit('close')" aria-label="Cerrar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <div class="qb__layout">
          <!-- Galería -->
          <div class="qb__gallery">
            <Transition name="img-swap" mode="out-in">
              <img
                v-if="imagenes[imagenIdx]"
                :key="imagenIdx"
                :src="imagenes[imagenIdx]"
                :alt="product.name"
                class="qb__img"
              />
              <div v-else :key="'ph'" class="qb__placeholder">HEBENNUS</div>
            </Transition>
            <div v-if="imagenes.length > 1" class="qb__thumbs">
              <button
                v-for="(img, i) in imagenes"
                :key="i"
                class="qb__thumb"
                :class="{ 'qb__thumb--active': imagenIdx === i }"
                @click="imagenIdx = i"
              >
                <img :src="img" :alt="`${product.name} ${i + 1}`" />
              </button>
            </div>
          </div>

          <!-- Info -->
          <div class="qb__info">
            <p v-if="(product.categories && product.categories.length) || product.category" class="qb__cat">{{ (product.categories && product.categories.length) ? product.categories.join(' · ') : product.category }}</p>
            <h2 class="qb__name">{{ product.name }}</h2>
            <p class="qb__price">{{ precioFmt }}</p>

            <!-- Tallas -->
            <div class="qb__sizes-hd">
              <span class="qb__sizes-label">Talla</span>
              <button class="qb__guide" @click.stop="guideOpen = true">Guía de tallas →</button>
            </div>
            <div class="qb__sizes">
              <button
                v-for="size in tallas"
                :key="size"
                class="size-btn"
                :class="{
                  'size-btn--active': tallaElegida === size,
                  'size-btn--out':    !tallaConStock(size),
                }"
                :disabled="!tallaConStock(size)"
                @click="tallaElegida = tallaElegida === size ? null : size"
              >{{ size }}</button>
            </div>

            <!-- Colores -->
            <div v-if="tieneColores" class="qb__sizes-hd">
              <span class="qb__sizes-label">Color</span>
            </div>
            <div v-if="tieneColores" class="qb__sizes">
              <button
                v-for="color in colores"
                :key="color"
                class="size-btn"
                :class="{
                  'size-btn--active': colorElegido === color,
                  'size-btn--out':    !colorConStock(color),
                }"
                :disabled="!colorConStock(color)"
                @click="colorElegido = colorElegido === color ? null : color"
              >{{ color }}</button>
            </div>

            <!-- Add -->
            <button
              class="qb__add"
              :class="{ 'qb__add--ready': puedeAgregar }"
              :disabled="!puedeAgregar"
              @click="handleAdd"
            >
              <template v-if="agotado">Producto agotado</template>
              <template v-else-if="comboSinStock">Sin stock en esa combinación</template>
              <template v-else-if="!seleccionCompleta">{{ tieneColores ? 'Selecciona talla y color' : 'Elige una talla' }}</template>
              <template v-else>Añadir al carrito</template>
            </button>

            <RouterLink
              :to="`/producto/${product.slug || product.id}`"
              class="qb__detail"
              @click="emit('close')"
            >Ver página completa →</RouterLink>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <SizeGuideModal :open="guideOpen" @close="guideOpen = false" />
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.qb-slide-enter-active { transition: opacity 0.35s var(--ease-out), transform 0.45s var(--ease-spring); }
.qb-slide-leave-active { transition: opacity 0.2s var(--ease-out), transform 0.2s var(--ease-out); }
.qb-slide-enter-from { opacity: 0; transform: translate(-50%,-50%) scale(0.94); }
.qb-slide-leave-to   { opacity: 0; transform: translate(-50%,-50%) scale(0.97); }

.overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.7);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 400;
}
.qb {
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%,-50%);
  width: min(800px, 96vw);
  max-height: 90svh;
  background: var(--surface-1);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-hover);
  z-index: 401;
  overflow: hidden auto;
}
.qb__close {
  position: absolute;
  top: 1rem; right: 1rem;
  width: 44px; height: 44px;
  display: grid;
  place-items: center;
  color: var(--text-2);
  background: rgba(0,0,0,0.28);
  border-radius: var(--radius-pill);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  z-index: 2;
  transition: color 0.2s var(--ease-out), background 0.2s var(--ease-out), transform 0.25s var(--ease-spring);
}
.qb__close:hover { color: var(--text-1); background: rgba(0,0,0,0.5); transform: rotate(90deg); }
.qb__close:active { transform: scale(0.9); }

.qb__layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

/* ── GALLERY ── */
.qb__gallery {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
}
.img-swap-enter-active { transition: opacity 0.2s ease; }
.img-swap-leave-active { transition: opacity 0.15s ease; }
.img-swap-enter-from, .img-swap-leave-to { opacity: 0; }

.qb__img {
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  display: block;
}
.qb__placeholder {
  aspect-ratio: 3 / 4;
  display: grid;
  place-items: center;
  background: var(--surface-2);
  font-family: var(--font-display);
  font-weight: 800;
  color: var(--text-3);
  letter-spacing: 0.2em;
}
.qb__thumbs {
  display: flex;
  gap: 0.4rem;
  padding: 0.6rem;
  background: var(--surface-2);
}
.qb__thumb {
  width: 52px; height: 66px;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  transition: border-color 0.2s var(--ease-out), transform 0.25s var(--ease-spring);
}
.qb__thumb img { width: 100%; height: 100%; object-fit: cover; }
.qb__thumb--active { border-color: var(--accent); transform: translateY(-2px); }
.qb__thumb:hover:not(.qb__thumb--active) { border-color: var(--border-mid); transform: translateY(-2px); }

/* ── INFO ── */
.qb__info {
  padding: 2.5rem 2rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.qb__cat {
  font-size: 0.65rem;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--accent-3);
}
.qb__name {
  font-family: var(--font-display);
  font-size: 1.5rem;
  font-weight: 300;
  letter-spacing: -0.02em;
  color: var(--text-1);
  line-height: 1.2;
  margin-top: 0.25rem;
}
.qb__price {
  font-size: 1.1rem;
  color: var(--text-1);
  font-weight: 600;
}
.qb__sizes-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.5rem;
}
.qb__sizes-label {
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-2);
}
.qb__guide {
  font-size: 0.7rem;
  color: var(--text-3);
  letter-spacing: 0.08em;
  transition: color 0.2s;
}
.qb__guide:hover { color: var(--text-1); }
.qb__sizes {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.size-btn {
  min-width: 2.5rem;
  min-height: 44px;
  padding: 0.45rem 0.7rem;
  background: transparent;
  color: var(--text-2);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-pill);
  font-size: 0.8rem;
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
.size-btn--out { opacity: 0.3; cursor: not-allowed; text-decoration: line-through; }

.qb__add {
  margin-top: 0.25rem;
  width: 100%;
  padding: 1rem;
  background: var(--surface-3);
  color: var(--text-3);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-pill);
  font-size: 0.75rem;
  font-family: var(--font-display);
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 0.25s var(--ease-spring), background 0.25s var(--ease-out),
              border-color 0.25s var(--ease-out), color 0.25s var(--ease-out), box-shadow 0.25s var(--ease-out);
}
.qb__add--ready {
  background: var(--grad-cool);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 6px 18px var(--glow-color);
}
.qb__add--ready:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 26px var(--glow-color);
  filter: brightness(1.05);
}
.qb__add--ready:active { transform: scale(0.97); }
.qb__add:disabled { opacity: 0.5; cursor: not-allowed; }

.qb__detail {
  font-size: 0.72rem;
  color: var(--text-3);
  letter-spacing: 0.1em;
  text-align: center;
  transition: color 0.2s;
  margin-top: auto;
  padding-top: 0.5rem;
}
.qb__detail:hover { color: var(--text-1); }

@media (max-width: 600px) {
  .qb__layout { grid-template-columns: 1fr; }
  .qb__gallery { border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
  .qb__img, .qb__placeholder { aspect-ratio: 4 / 3; }
  .qb__info { padding: 1.5rem 1.25rem; }
  .qb__name { font-size: 1.25rem; }
}
</style>
