<script setup>
import { ref, computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { STOCK_LOW_THRESHOLD } from '../lib/config.js'

const props = defineProps({
  product: { type: Object, required: true },
})
const emit = defineEmits(['add-to-cart'])
const router = useRouter()

const variantes = computed(() => props.product.product_variants ?? [])

// Colores disponibles = colores distintos no-nulos de las variantes.
const colores = computed(() => [...new Set(variantes.value.map(v => v.color).filter(Boolean))])
const colorGaleria = computed(() => colores.value[0] ?? null)
// Con más de un color no podemos elegir por el cliente: el quick-add llevaría a la ficha.
const esMulticolor = computed(() => colores.value.length > 1)

// Galería de la TARJETA (estilo Nude): dos fotos, INDEPENDIENTES de la ficha.
//   card_images[0] = PORTADA (se ve primero)
//   card_images[1] = HOVER   (se muestra al pasar el mouse)
// Preferimos `card_images`; si no existe (productos antiguos), caemos a la
// lista plana `images` (donde [0]/[1] eran portada/hover) y luego al color.
const galeria = computed(() => {
  const card = Array.isArray(props.product.card_images) ? props.product.card_images.filter(Boolean) : []
  if (card.length) return card
  const flat = Array.isArray(props.product.images) ? props.product.images.filter(Boolean) : []
  if (flat.length) return flat
  const c = colorGaleria.value
  const porColor = c ? (props.product.images_by_color?.[c] ?? []) : []
  return porColor.filter(Boolean)
})
const fotoPresentacion = computed(() => galeria.value[0] ?? null)
const fotoModelo        = computed(() => galeria.value[1] ?? null)

// Swap de imagen al pasar el mouse: presentación → modelo.
const mostrarModelo = ref(false)
const imagenActual = computed(() =>
  (mostrarModelo.value && fotoModelo.value) ? fotoModelo.value : fotoPresentacion.value
)
function onHover() { mostrarModelo.value = true }
function onLeave() { mostrarModelo.value = false }

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

const stockTotal    = computed(() => variantes.value.reduce((s, v) => s + (v.stock ?? 0), 0))
// Producto AGOTADO = marcado manualmente como Sold Out, o sin stock en ninguna variante.
const agotado       = computed(() => !!props.product.sold_out || stockTotal.value === 0)
const pocasUnidades = computed(() => stockTotal.value > 0 && stockTotal.value <= STOCK_LOW_THRESHOLD)

const precioFmt = computed(() => `S/ ${Number(props.product.price).toFixed(2)}`)

// Quick-add por talla (reemplaza los antiguos botones de overlay "Ver / Compra rápida").
function quickAdd(size) {
  if (agotado.value || !tallaConStock(size)) return
  // Multicolor: NO agregamos un color al azar. Llevamos a la ficha para que el
  // cliente elija color (y la imagen añadida corresponda al color elegido).
  if (esMulticolor.value) {
    router.push(`/producto/${props.product.slug || props.product.id}`)
    return
  }
  const deLaTalla = variantes.value.filter(v => v.size === size)
  const variante  = deLaTalla.find(v => (v.stock ?? 0) > 0) ?? deLaTalla[0] ?? null
  emit('add-to-cart', {
    name:      props.product.name,
    size,
    color:     variante?.color ?? null,
    price:     props.product.price,
    image:     fotoPresentacion.value,
    productId: props.product.id,
    variantId: variante?.id,
  })
}

// ── Swatches de color ──
const COLOR_HEX = {
  negro: '#1a1a1a', blanco: '#f2efe9', hueso: '#ece5d8', crema: '#e8e0cf', beige: '#d9cdb4',
  gris: '#9a9a97', 'gris claro': '#c7c7c3', 'gris oscuro': '#5a5a58', plomo: '#7d7d7a',
  azul: '#2e4870', 'azul marino': '#1f2f4d', marino: '#1f2f4d', navy: '#1f2f4d',
  denim: '#3a567e', celeste: '#9fc0d8', 'azul claro': '#9fc0d8',
  verde: '#4a5d3a', 'verde militar': '#4b533a', 'verde oscuro': '#33452f', oliva: '#6b6a3a',
  rojo: '#9b3535', vino: '#6e2437', 'rojo vino': '#6e2437', guinda: '#6e2437',
  rosa: '#d9a3ad', rosado: '#d9a3ad', fucsia: '#b53a72',
  amarillo: '#d8c24a', mostaza: '#c9962f', naranja: '#cc6b3a',
  marron: '#6b4f3a', cafe: '#6b4f3a', chocolate: '#4a3527', camel: '#b08a5a',
  morado: '#6a4d7a', lila: '#a58cc0', purpura: '#6a4d7a', turquesa: '#3aa6a0',
}
function normColor(c) {
  return (c || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}
function colorHex(c) { return COLOR_HEX[normColor(c)] ?? null }
</script>

<template>
  <article class="card" :class="{ 'card--out': agotado }">
    <!-- Media: presentación → modelo al pasar el mouse -->
    <div class="card__media" @mouseenter="onHover" @mouseleave="onLeave">
      <Transition name="img-swap" mode="out-in">
        <img
          v-if="imagenActual"
          :key="imagenActual"
          :src="imagenActual"
          :alt="product.name"
          loading="lazy"
          class="card__img"
          :class="{ 'card__img--out': agotado }"
        />
        <div v-else :key="'placeholder'" class="card__placeholder" aria-hidden="true">
          <span>HEBENNUS</span>
        </div>
      </Transition>

      <!-- Enlace a la ficha (cubre la imagen; las tallas van por encima) -->
      <RouterLink :to="`/producto/${product.slug || product.id}`" class="card__link" :aria-label="`Ver ${product.name}`" />

      <!-- Sticker: etiqueta manual (Nuevo, etc.) o últimas piezas (auto) -->
      <div v-if="!agotado && product.badge" class="card__sticker">{{ product.badge }}</div>
      <div v-else-if="pocasUnidades" class="card__sticker card__sticker--low">Últimas piezas</div>
      <!-- Franja SOLD OUT (la prenda sigue siendo clickeable) -->
      <div v-if="agotado" class="card__soldout"><span>Sold Out</span></div>

      <!-- Tallas rápidas (estilo Nude): aparecen al hover; en táctil, siempre -->
      <div v-if="!agotado && tallas.length" class="card__quick">
        <button
          v-for="t in tallas"
          :key="t"
          type="button"
          class="card__quick-btn"
          :class="{ 'card__quick-btn--out': !tallaConStock(t) }"
          :disabled="!tallaConStock(t)"
          :aria-label="esMulticolor ? `Elegir color · talla ${t}` : `Añadir talla ${t}`"
          @click.prevent.stop="quickAdd(t)"
        >{{ t }}</button>
      </div>
    </div>

    <!-- Body -->
    <div class="card__body">
      <div class="card__row">
        <RouterLink :to="`/producto/${product.slug || product.id}`" class="card__name">{{ product.name }}</RouterLink>
        <span class="card__price">{{ precioFmt }}</span>
      </div>
      <div v-if="colores.length" class="card__colors" :aria-label="`Colores: ${colores.join(', ')}`">
        <span
          v-for="c in colores"
          :key="c"
          class="card__swatch"
          :class="{ 'card__swatch--empty': !colorHex(c) }"
          :style="colorHex(c) ? { background: colorHex(c) } : null"
          :title="c"
        ></span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  background: transparent;
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
  transition: filter 0.4s var(--ease-out);
}
/* Producto agotado: escala de grises + oscurecido */
.card__img--out { filter: grayscale(1) brightness(0.55); }

.img-swap-enter-active { transition: opacity 0.28s ease; }
.img-swap-leave-active { transition: opacity 0.18s ease; }
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

/* Enlace que cubre la imagen (navega a la ficha) */
.card__link { position: absolute; inset: 0; z-index: 5; }

/* ── STOCK BADGE ── */
/* Sticker de esquina (etiqueta manual o "Últimas piezas") — sobresaliente */
.card__sticker {
  position: absolute;
  top: 0.85rem; left: 0.85rem;
  z-index: 12;
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 0.42rem 0.85rem;
  font-weight: 800;
  font-family: var(--font-display);
  border-radius: 6px;
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: 0 4px 14px rgba(0,0,0,0.28);
  animation: hb-pop 0.35s var(--ease-spring) both;
}
.card__sticker--low { background: #C9962F; color: #1a1408; }  /* mostaza cálida = últimas piezas */

/* Cinta SOLD OUT (cruza la imagen; la card sigue clickeable) — blanca, letra negra */
.card__soldout {
  position: absolute;
  inset: 0;
  z-index: 12;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.card__soldout span {
  width: 100%;
  text-align: center;
  background: #F4F1EC;
  color: #14120f;
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 0.95rem;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  padding: 0.6rem 0;
  box-shadow: 0 3px 16px rgba(0,0,0,0.35);
}

/* ── TALLAS RÁPIDAS (estilo Nude) ── */
.card__quick {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  z-index: 15;
  display: flex;
  gap: 0.3rem;
  justify-content: center;
  flex-wrap: wrap;
  padding: 0.65rem 0.55rem;
  background: linear-gradient(to top, rgba(20,18,15,0.72) 0%, rgba(20,18,15,0.28) 62%, rgba(20,18,15,0) 100%);
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.28s var(--ease-out), transform 0.28s var(--ease-out);
  pointer-events: none;
}
.card:hover .card__quick { opacity: 1; transform: translateY(0); pointer-events: auto; }
.card__quick-btn {
  min-width: 2rem;
  padding: 0.42rem 0.55rem;
  font-size: 0.7rem;
  font-family: var(--font-display);
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #14120f;
  background: rgba(244,241,236,0.95);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.18s var(--ease-out), color 0.18s var(--ease-out), transform 0.18s var(--ease-spring);
}
.card__quick-btn:hover:not(:disabled) { background: #14120f; color: #f4f1ec; }
.card__quick-btn:active:not(:disabled) { transform: scale(0.92); }
.card__quick-btn--out {
  opacity: 0.45;
  text-decoration: line-through;
  cursor: not-allowed;
}

/* En pantallas táctiles NO hay :hover → mostrar tallas siempre (accesibles en móvil). */
@media (hover: none) {
  .card__quick { opacity: 1; transform: none; pointer-events: auto; }
}

/* ── BODY ── */
.card__body {
  padding: 0.85rem 0.15rem 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.card__row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.6rem;
}
.card__name {
  font-family: var(--font-display);
  font-size: 0.95rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--text-1);
  line-height: 1.35;
  transition: color 0.2s;
}
.card__name:hover { color: var(--copper-light); }
.card__price {
  font-family: var(--font-display);
  font-size: 0.92rem;
  color: var(--text-1);
  white-space: nowrap;
  font-weight: 600;
}

/* ── SWATCHES DE COLOR ── */
.card__colors {
  display: flex;
  gap: 0.32rem;
  align-items: center;
}
.card__swatch {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid var(--border-mid);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12);
}
.card__swatch--empty {
  background: repeating-linear-gradient(45deg, var(--surface-2), var(--surface-2) 3px, var(--border-mid) 3px, var(--border-mid) 4px);
}
</style>
