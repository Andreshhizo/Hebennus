<script setup>
// ─── Previsualización de producto (cómo se verá en la tienda) ───────────────
// Dos vistas en vivo a partir del borrador del editor:
//   • Tarjeta (catálogo/home): reusa el ProductCard real → fiel 1:1.
//   • Ficha (detalle): réplica ligera de la galería del ProductDetailPage
//     (imagen principal + tira de miniaturas) en el ORDEN actual de las fotos.
import { ref, computed, watch } from 'vue'
import ProductCard from './ProductCard.vue'

const props = defineProps({
  // Objeto con la forma que consume ProductCard: { id, name, price, card_images, product_variants, badge }
  product:  { type: Object, required: true },
  // Galería de la ficha (detalle) — INDEPENDIENTE de las fotos de tarjeta.
  gallery:  { type: Array, default: () => [] },
  // En modo crear no hay id → evitamos navegación real del card.
  creating: { type: Boolean, default: false },
})

const imagenes = computed(() => props.gallery.filter(Boolean))
const selectedIdx = ref(0)
const imagenPrincipal = computed(() => imagenes.value[selectedIdx.value] ?? imagenes.value[0] ?? null)

// Si cambia la cantidad de fotos, mantener el índice dentro de rango.
watch(imagenes, (arr) => { if (selectedIdx.value > arr.length - 1) selectedIdx.value = 0 })

const agotado = computed(() => {
  const vs = props.product.product_variants ?? []
  if (!vs.length) return false
  return vs.reduce((s, v) => s + (v.stock ?? 0), 0) === 0
})
</script>

<template>
  <div class="pp">
    <p class="pp__title">Previsualización</p>

    <!-- Tarjeta (catálogo) -->
    <div class="pp__block">
      <span class="pp__label">Tarjeta (catálogo · home)</span>
      <p class="pp__hint">Pasa el mouse: cambia de portada a la foto con modelo.</p>
      <!-- Bloqueamos el click (navegación / add) pero dejamos vivo el hover -->
      <div class="pp__cardwrap" :class="{ 'pp__cardwrap--nolink': creating }" @click.capture.prevent.stop>
        <ProductCard :product="product" />
      </div>
    </div>

    <!-- Ficha (detalle) -->
    <div class="pp__block">
      <span class="pp__label">Ficha (detalle)</span>
      <div class="gallery">
        <div class="gallery__main">
          <img v-if="imagenPrincipal" :src="imagenPrincipal" alt="" class="gallery__img" :class="{ 'gallery__img--out': agotado }" />
          <div v-else class="gallery__placeholder"><span>HEBENNUS</span></div>
          <div v-if="agotado" class="gallery__soldout"><span>Sold Out</span></div>
        </div>
        <div v-if="imagenes.length > 1" class="gallery__thumbs">
          <button
            v-for="(img, i) in imagenes"
            :key="img + i"
            type="button"
            class="gallery__thumb"
            :class="{ 'gallery__thumb--active': selectedIdx === i }"
            @click="selectedIdx = i"
          >
            <img :src="img" alt="" />
          </button>
        </div>
        <p v-if="!imagenes.length" class="pp__hint">Aún no hay fotos.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pp { display: flex; flex-direction: column; gap: 1.4rem; }
.pp__title {
  font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em;
  color: var(--text-3); font-weight: 700;
}
.pp__block { display: flex; flex-direction: column; gap: 0.5rem; }
.pp__label {
  font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.1em;
  color: var(--text-2); font-weight: 600;
}
.pp__hint { font-size: 0.7rem; color: var(--text-3); }

/* Tarjeta: la mostramos a tamaño realista del catálogo */
.pp__cardwrap { max-width: 300px; }
.pp__cardwrap--nolink :deep(.card__link) { pointer-events: none; }

/* ── Galería de ficha (réplica de ProductDetailPage) ── */
.gallery { max-width: 340px; }
.gallery__main {
  position: relative;
  overflow: hidden;
  background: var(--surface-2);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft);
}
.gallery__img { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; display: block; }
.gallery__img--out { filter: grayscale(1) brightness(0.5); }
.gallery__placeholder {
  width: 100%; aspect-ratio: 3 / 4;
  display: grid; place-items: center;
  background: var(--surface-2);
}
.gallery__placeholder span {
  font-family: var(--font-display); font-weight: 800;
  letter-spacing: 0.25em; color: var(--text-3);
}
.gallery__soldout {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
}
.gallery__soldout span {
  width: 140%; transform: rotate(-8deg); text-align: center;
  background: rgba(20,18,15,.82); color: #F4F1EC;
  font-family: var(--font-display); font-weight: 800;
  font-size: 0.85rem; letter-spacing: 0.35em; text-transform: uppercase;
  padding: 0.4rem 0;
}
.gallery__thumbs { display: flex; gap: 0.5rem; margin-top: 0.7rem; flex-wrap: wrap; }
.gallery__thumb {
  width: 56px; height: 70px; flex-shrink: 0;
  overflow: hidden; padding: 0;
  border: 1px solid transparent; border-radius: var(--radius-md);
  cursor: pointer; background: var(--surface-2);
  transition: border-color 0.2s, transform 0.2s;
}
.gallery__thumb img { width: 100%; height: 100%; object-fit: cover; }
.gallery__thumb--active { border-color: var(--accent); transform: translateY(-3px); box-shadow: var(--shadow-soft); }
.gallery__thumb:hover:not(.gallery__thumb--active) { border-color: var(--border-mid); transform: translateY(-3px); }
</style>
