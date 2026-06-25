<script setup>
import { ref, computed, onMounted, inject, watch } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { supabase } from '../lib/supabase.js'
import { WHATSAPP_NUMERO, STOCK_LOW_THRESHOLD } from '../lib/config.js'
import SizeGuideModal from '../components/SizeGuideModal.vue'

const route     = useRoute()
const addToCart = inject('addToCart')

const product      = ref(null)
const cargando     = ref(true)
const imagenIdx    = ref(0)
const tallaElegida = ref(null)
const colorElegido = ref(null)
const guideOpen    = ref(false)

async function fetchProduct(id) {
  cargando.value    = true
  imagenIdx.value   = 0
  tallaElegida.value = null
  colorElegido.value = null
  product.value     = null

  const { data } = await supabase
    .from('products')
    .select('*, product_variants(*)')
    .eq('id', id)
    .single()

  product.value  = data
  cargando.value = false
}

onMounted(() => fetchProduct(route.params.id))
watch(() => route.params.id, id => { if (id) fetchProduct(id) })

const variantes = computed(() => product.value?.product_variants ?? [])

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

// Colores disponibles = colores distintos no-nulos de las variantes.
const colores      = computed(() => [...new Set(variantes.value.map(v => v.color).filter(Boolean))])
const tieneColores = computed(() => colores.value.length > 0)

// Color que rige la galería: el elegido por el usuario o, por defecto,
// el primer color disponible (o ninguno si el producto no tiene colores).
const colorGaleria = computed(() => colorElegido.value ?? colores.value[0] ?? null)

// Imágenes de un color = images_by_color[color] ?? images plano ?? [].
const imagenes = computed(() => {
  const c = colorGaleria.value
  if (c) return product.value?.images_by_color?.[c] ?? product.value?.images ?? []
  return product.value?.images ?? []
})

// ¿Hay al menos una variante con stock para esta talla / este color?
function tallaConStock(size)  { return variantes.value.some(v => v.size === size  && (v.stock ?? 0) > 0) }
function colorConStock(color) { return variantes.value.some(v => v.color === color && (v.stock ?? 0) > 0) }

// Variante final = combinación talla + color. Si el producto no tiene colores,
// se resuelve solo por talla (no se exige color).
const varianteSel = computed(() => {
  if (!tallaElegida.value) return null
  if (tieneColores.value && !colorElegido.value) return null
  return variantes.value.find(v =>
    v.size === tallaElegida.value &&
    (!tieneColores.value || v.color === colorElegido.value)
  ) ?? null
})
const stockSel          = computed(() => varianteSel.value?.stock ?? 0)
const seleccionCompleta = computed(() =>
  !!tallaElegida.value && (!tieneColores.value || !!colorElegido.value)
)

const stockTotal     = computed(() => variantes.value.reduce((s, v) => s + (v.stock ?? 0), 0))
// Producto AGOTADO = todas las variantes con stock <= 0.
const agotado        = computed(() => stockTotal.value === 0)
const pocasUnidades  = computed(() => stockTotal.value > 0 && stockTotal.value <= STOCK_LOW_THRESHOLD)
const precioFmt      = computed(() => `S/ ${Number(product.value?.price ?? 0).toFixed(2)}`)

// La combinación elegida existe pero está sin stock.
const comboSinStock = computed(() => seleccionCompleta.value && stockSel.value <= 0)
// Solo se puede agregar con talla + color elegidos y stock de esa variante específica.
const puedeAgregar  = computed(() => seleccionCompleta.value && stockSel.value > 0 && !agotado.value)

// Al cambiar el color que rige la galería, reseteamos el carrusel a la primera foto.
watch(colorGaleria, () => { imagenIdx.value = 0 })

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
  // El botón está deshabilitado hasta que haya talla + color con stock,
  // pero revalidamos la variante combinada por seguridad.
  const v = varianteSel.value
  if (!v || (v.stock ?? 0) <= 0) return
  addToCart({
    name:      product.value.name,
    size:      tallaElegida.value,
    color:     colorElegido.value,
    price:     product.value.price,
    image:     imagenes.value[imagenIdx.value] ?? imagenes.value[0] ?? null,
    productId: product.value.id,
    variantId: v.id,
  })
  tallaElegida.value = null
  colorElegido.value = null
}
</script>

<template>
<div>

  <!-- ░░ SKELETON ░░ -->
  <div v-if="cargando" class="pdp-wrap">
    <div class="pdp__layout">
      <div class="pdp-skel__gallery shine"></div>
      <div class="pdp-skel__info">
        <div class="skel-line skel-line--cat shine"></div>
        <div class="skel-line skel-line--name shine"></div>
        <div class="skel-line skel-line--price shine"></div>
        <div class="skel-line skel-line--desc shine"></div>
        <div class="skel-line skel-line--desc shine" style="width:70%"></div>
        <div class="skel-line skel-line--btn shine"></div>
      </div>
    </div>
  </div>

  <!-- ░░ NOT FOUND ░░ -->
  <div v-else-if="!product" class="nf">
    <span class="chip">404</span>
    <h1 class="nf__title">Producto no encontrado</h1>
    <RouterLink to="/coleccion" class="nf__back">← Volver a la colección</RouterLink>
  </div>

  <!-- ░░ PRODUCT ░░ -->
  <div v-else class="pdp-wrap">
    <!-- Breadcrumb -->
    <nav class="breadcrumb" aria-label="Navegación">
      <RouterLink to="/">Inicio</RouterLink>
      <span aria-hidden="true">/</span>
      <RouterLink to="/coleccion">Colección</RouterLink>
      <span aria-hidden="true">/</span>
      <span>{{ product.name }}</span>
    </nav>

    <div class="pdp__layout">
      <!-- ── GALERÍA ── -->
      <div class="gallery">
        <div class="gallery__main">
          <Transition name="img-swap" mode="out-in">
            <img
              v-if="imagenes[imagenIdx]"
              :key="imagenIdx"
              :src="imagenes[imagenIdx]"
              :alt="product.name"
              class="gallery__img"
              :class="{ 'gallery__img--out': agotado }"
            />
            <div v-else :key="'ph'" class="gallery__placeholder">HEBENNUS</div>
          </Transition>

          <div v-if="agotado" class="gallery__badge gallery__badge--out">Agotado</div>
          <div v-else-if="pocasUnidades" class="gallery__badge gallery__badge--low">
            Últimas {{ stockTotal }}
          </div>

          <!-- Carousel arrows -->
          <template v-if="imagenes.length > 1">
            <button
              type="button"
              class="gallery__arrow gallery__arrow--prev"
              aria-label="Imagen anterior"
              @click="prevImg"
            >‹</button>
            <button
              type="button"
              class="gallery__arrow gallery__arrow--next"
              aria-label="Imagen siguiente"
              @click="nextImg"
            >›</button>
          </template>

          <!-- Carousel dots -->
          <div v-if="imagenes.length > 1" class="gallery__dots" aria-hidden="true">
            <button
              v-for="(_, i) in imagenes"
              :key="i"
              class="gallery__dot"
              :class="{ 'gallery__dot--active': imagenIdx === i }"
              @click="imagenIdx = i"
            ></button>
          </div>
        </div>

        <div v-if="imagenes.length > 1" class="gallery__thumbs">
          <button
            v-for="(img, i) in imagenes"
            :key="i"
            class="gallery__thumb"
            :class="{ 'gallery__thumb--active': imagenIdx === i }"
            @click="imagenIdx = i"
          >
            <img :src="img" :alt="`${product.name} foto ${i + 1}`" :class="{ 'gallery__img--out': agotado }" />
          </button>
        </div>
      </div>

      <!-- ── INFO ── -->
      <div class="pdp__info">
        <p v-if="product.category" class="pdp__cat">{{ product.category }}</p>
        <h1 class="pdp__name">{{ product.name }}</h1>
        <p class="pdp__price">{{ precioFmt }}</p>

        <p v-if="product.description" class="pdp__desc">{{ product.description }}</p>

        <div class="divider"></div>

        <!-- Tallas -->
        <div class="pdp__sizes-hd">
          <span class="pdp__sizes-label">Talla</span>
          <button class="pdp__guide-btn" @click="guideOpen = true">Guía de tallas →</button>
        </div>

        <div class="pdp__sizes" role="group" aria-label="Tallas disponibles">
          <button
            v-for="size in tallas"
            :key="size"
            class="size-btn"
            :class="{
              'size-btn--active': tallaElegida === size,
              'size-btn--out':    !tallaConStock(size),
            }"
            :disabled="!tallaConStock(size)"
            :aria-pressed="tallaElegida === size"
            @click="tallaElegida = tallaElegida === size ? null : size"
          >
            {{ size }}
          </button>
        </div>

        <!-- Colores -->
        <div v-if="colores.length" class="pdp__sizes-hd">
          <span class="pdp__sizes-label">Color</span>
        </div>

        <div v-if="colores.length" class="pdp__sizes" role="group" aria-label="Colores disponibles">
          <button
            v-for="color in colores"
            :key="color"
            class="size-btn"
            :class="{
              'size-btn--active': colorElegido === color,
              'size-btn--out':    !colorConStock(color),
            }"
            :disabled="!colorConStock(color)"
            :aria-pressed="colorElegido === color"
            @click="colorElegido = colorElegido === color ? null : color"
          >
            {{ color }}
          </button>
        </div>

        <p v-if="pocasUnidades" class="pdp__low-stock">
          ¡Solo quedan {{ stockTotal }} unidades!
        </p>

        <!-- Add to cart -->
        <button
          class="pdp__add"
          :class="{
            'pdp__add--ready':    puedeAgregar,
            'pdp__add--disabled': !puedeAgregar,
          }"
          :disabled="!puedeAgregar"
          @click="handleAdd"
        >
          <template v-if="agotado">Producto agotado</template>
          <template v-else-if="comboSinStock">Sin stock en esa combinación</template>
          <template v-else-if="!seleccionCompleta">{{ tieneColores ? 'Selecciona una talla y color' : 'Selecciona una talla' }}</template>
          <template v-else>Añadir al carrito — {{ tallaElegida }}<template v-if="colorElegido"> / {{ colorElegido }}</template></template>
        </button>

        <!-- Detalles -->
        <ul class="pdp__perks">
          <li>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="20 6 9 17 4 12"/></svg>
            Envío a domicilio
          </li>
          <li>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="20 6 9 17 4 12"/></svg>
            Coordinamos pago y envío por WhatsApp
          </li>
          <li>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="20 6 9 17 4 12"/></svg>
            Edición limitada — stock reducido
          </li>
        </ul>
      </div>
    </div>
  </div>

  <SizeGuideModal :open="guideOpen" @close="guideOpen = false" />
</div>
</template>

<style scoped>
/* ── SKELETON ── */
@keyframes shimmer {
  0%   { background-position: -600px 0; }
  100% { background-position:  600px 0; }
}
.shine {
  background: linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%);
  background-size: 1200px 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}
.pdp-skel__gallery { aspect-ratio: 3/4; max-width: 520px; width: 100%; border-radius: var(--radius-lg); }
.pdp-skel__info {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-top: 1rem;
}
.skel-line { border-radius: var(--radius-pill); }
.skel-line--cat   { height: 11px; width: 30%; }
.skel-line--name  { height: 32px; width: 85%; }
.skel-line--price { height: 22px; width: 25%; }
.skel-line--desc  { height: 12px; width: 90%; }
.skel-line--btn   { height: 52px; width: 100%; border-radius: var(--radius-pill); margin-top: 1rem; }

/* ── NOT FOUND ── */
.nf {
  min-height: 60svh;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 4rem 2rem;
  max-width: 1200px;
  margin: 0 auto;
}
.chip {
  font-size: 0.68rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--copper);
  margin-bottom: 1rem;
  display: inline-block;
}
.nf__title {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: clamp(2.5rem, 7vw, 5rem);
  color: var(--text-1);
  margin-bottom: 2rem;
}
.nf__back {
  font-size: 0.8rem;
  color: var(--text-2);
  letter-spacing: 0.1em;
  border-bottom: 1px solid var(--border-mid);
  padding-bottom: 2px;
  align-self: flex-start;
  transition: color 0.2s var(--ease-out), border-color 0.2s var(--ease-out), transform 0.25s var(--ease-spring);
}
.nf__back:hover { color: var(--text-1); border-color: var(--text-1); transform: translateX(-3px); }

/* ── WRAP ── */
.pdp-wrap { max-width: 1200px; margin: 0 auto; padding: 2rem 2rem 5rem; }

/* ── BREADCRUMB ── */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.72rem;
  color: var(--text-3);
  letter-spacing: 0.06em;
  margin-bottom: 2.5rem;
}
.breadcrumb a { color: var(--text-2); transition: color 0.2s; }
.breadcrumb a:hover { color: var(--text-1); }
.breadcrumb span:last-child { color: var(--text-1); }

/* ── LAYOUT ── */
.pdp__layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4rem;
  align-items: start;
}

/* ── GALLERY ── */
.gallery { position: relative; }
.gallery__main {
  position: relative;
  overflow: hidden;
  background: var(--surface-2);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft);
}
.img-swap-enter-active { transition: opacity 0.22s ease; }
.img-swap-leave-active { transition: opacity 0.15s ease; }
.img-swap-enter-from, .img-swap-leave-to { opacity: 0; }

.gallery__img {
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  display: block;
}
/* Producto agotado: escala de grises + oscurecido */
.gallery__img--out { filter: grayscale(1) brightness(0.5); }
.gallery__placeholder {
  width: 100%;
  aspect-ratio: 3 / 4;
  display: grid;
  place-items: center;
  font-family: var(--font-display);
  font-weight: 800;
  color: var(--text-3);
  letter-spacing: 0.2em;
  font-size: 1.2rem;
}
.gallery__badge {
  position: absolute;
  top: 1rem; left: 1rem;
  font-size: 0.65rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 0.35rem 0.85rem;
  font-family: var(--font-display);
  font-weight: 600;
  border-radius: var(--radius-pill);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 2px 12px rgba(0,0,0,0.25);
  animation: hb-pop 0.35s var(--ease-spring) both;
}
.gallery__badge--out { background: var(--text-3); color: var(--ink); }
.gallery__badge--low { background: var(--grad-cool); color: #fff; }

/* ── CAROUSEL ARROWS ── */
.gallery__arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%) scale(0.95);
  z-index: 5;
  width: 2.6rem;
  height: 2.6rem;
  display: grid;
  place-items: center;
  background: rgba(0,0,0,0.4);
  color: var(--text-1);
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: var(--radius-pill);
  font-size: 1.6rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0.65;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  transition: opacity 0.25s var(--ease-out), transform 0.3s var(--ease-spring),
              background 0.2s var(--ease-out), border-color 0.2s var(--ease-out);
}
.gallery__main:hover .gallery__arrow { opacity: 1; transform: translateY(-50%) scale(1); }
.gallery__arrow:hover {
  background: rgba(0,0,0,0.7);
  border-color: rgba(255,255,255,0.55);
  transform: translateY(-50%) scale(1.1);
}
.gallery__arrow:active { transform: translateY(-50%) scale(0.94); }
.gallery__arrow:focus-visible { opacity: 1; transform: translateY(-50%) scale(1); outline: 2px solid var(--accent); outline-offset: 2px; }
.gallery__arrow--prev { left: 0.75rem; }
.gallery__arrow--next { right: 0.75rem; }

/* ── CAROUSEL DOTS ── */
.gallery__dots {
  position: absolute;
  bottom: 0.9rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 0.4rem;
  z-index: 5;
}
.gallery__dot {
  width: 7px; height: 7px;
  border-radius: var(--radius-pill);
  background: var(--overlay-dot);
  cursor: pointer;
  transition: background 0.25s var(--ease-out), transform 0.3s var(--ease-spring), width 0.3s var(--ease-spring);
}
.gallery__dot--active { background: var(--grad-cool); width: 22px; transform: scale(1.1); }
.gallery__dot:hover:not(.gallery__dot--active) { background: var(--overlay-dot-hover); transform: scale(1.2); }

.gallery__thumbs {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.7rem;
}
.gallery__thumb {
  width: 64px; height: 80px;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  transition: border-color 0.2s var(--ease-out), transform 0.25s var(--ease-spring), box-shadow 0.25s var(--ease-out);
  cursor: pointer;
}
.gallery__thumb img { width: 100%; height: 100%; object-fit: cover; }
.gallery__thumb--active { border-color: var(--accent); transform: translateY(-3px); box-shadow: var(--shadow-soft); }
.gallery__thumb:hover:not(.gallery__thumb--active) { border-color: var(--border-mid); transform: translateY(-3px); }

/* ── INFO ── */
.pdp__info { display: flex; flex-direction: column; gap: 1rem; }
.pdp__cat {
  font-size: 0.65rem;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--accent-3);
}
.pdp__name {
  font-family: var(--font-display);
  font-size: clamp(1.6rem, 3vw, 2.4rem);
  font-weight: 300;
  letter-spacing: -0.025em;
  color: var(--text-1);
  line-height: 1.15;
}
.pdp__price {
  font-size: 1.3rem;
  color: var(--text-1);
  font-weight: 600;
}
.pdp__desc {
  font-size: 0.88rem;
  color: var(--text-2);
  line-height: 1.85;
  font-weight: 300;
}
.divider {
  height: 1px;
  background: var(--border);
  margin: 0.25rem 0;
}
.pdp__sizes-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pdp__sizes-label {
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-2);
}
.pdp__guide-btn {
  font-size: 0.7rem;
  color: var(--text-3);
  letter-spacing: 0.08em;
  transition: color 0.2s;
}
.pdp__guide-btn:hover { color: var(--text-1); }

.pdp__sizes { display: flex; gap: 0.4rem; flex-wrap: wrap; }

.size-btn {
  min-width: 2.6rem;
  padding: 0.5rem 0.85rem;
  background: transparent;
  color: var(--text-2);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-pill);
  font-size: 0.82rem;
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

.pdp__low-stock {
  font-size: 0.75rem;
  color: var(--copper);
  letter-spacing: 0.06em;
}

.pdp__add {
  width: 100%;
  padding: 1.1rem 1rem;
  background: transparent;
  color: var(--text-3);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-pill);
  font-size: 0.78rem;
  font-family: var(--font-display);
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 0.25s var(--ease-spring), background 0.25s var(--ease-out),
              border-color 0.25s var(--ease-out), color 0.25s var(--ease-out), box-shadow 0.25s var(--ease-out);
  margin-top: 0.25rem;
}
.pdp__add--ready {
  background: var(--grad-cool);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 8px 22px var(--glow-color);
}
.pdp__add--ready:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 30px var(--glow-color);
  filter: brightness(1.05);
}
.pdp__add--ready:active { transform: scale(0.98); }
.pdp__add--disabled { opacity: 0.5; cursor: not-allowed; }

.pdp__perks {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin-top: 0.5rem;
  border-top: 1px solid var(--border);
  padding-top: 1.2rem;
}
.pdp__perks li {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  font-size: 0.78rem;
  color: var(--text-2);
  letter-spacing: 0.04em;
}
.pdp__perks svg {
  color: var(--accent-2);
  flex-shrink: 0;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0.3rem;
  border-radius: var(--radius-pill);
  background: var(--glow-color);
}

/* ── RESPONSIVE ── */
@media (max-width: 860px) {
  .pdp__layout { grid-template-columns: 1fr; gap: 2.5rem; }
  .pdp-wrap    { padding: 1.5rem 1.25rem 4rem; }
  .gallery__thumbs { flex-wrap: wrap; }
}
</style>
