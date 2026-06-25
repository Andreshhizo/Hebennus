<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { supabase }       from '../lib/supabase.js'
import { WHATSAPP_NUMERO, NEXT_DROP_DATE } from '../lib/config.js'
import SkeletonCard       from '../components/SkeletonCard.vue'

const lanzamientos = ref([])
const cargando     = ref(true)

onMounted(async () => {
  const { data } = await supabase
    .from('products')
    .select('*, product_variants(*)')
    .eq('is_launch', true)
    .order('launch_order', { ascending: true })
  lanzamientos.value = data ?? []
  cargando.value = false
})

const waMsg  = 'Hola Hebennus! Quiero recibir noticias sobre los próximos lanzamientos 🔥'
const waLink = `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(waMsg)}`

// ── COUNTDOWN ──────────────────────────────────────────────
const dropDate = new Date(NEXT_DROP_DATE)
const cd = ref({ days: 0, hours: 0, mins: 0, secs: 0 })
let timer = null

function tick() {
  const diff = dropDate - Date.now()
  if (diff <= 0) {
    cd.value = { days: 0, hours: 0, mins: 0, secs: 0 }
    clearInterval(timer)
    return
  }
  cd.value = {
    days:  Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    mins:  Math.floor((diff % 3600000)  / 60000),
    secs:  Math.floor((diff % 60000)    / 1000),
  }
}

onMounted(() => { tick(); timer = setInterval(tick, 1000) })
onUnmounted(() => clearInterval(timer))

function pad(n) { return String(n).padStart(2, '0') }
</script>

<template>
<div>
  <!-- ░░ HERO ░░ -->
  <section class="page-hero">
    <div class="page-hero__inner" v-reveal>
      <span class="chip">Exclusivo</span>
      <h1 class="page-hero__title">Próximos<br />Lanzamientos</h1>
      <p class="page-hero__sub">Sé el primero en enterarte</p>
    </div>
  </section>

  <!-- ░░ COUNTDOWN ░░ -->
  <section class="countdown-section">
    <div class="countdown-inner" v-reveal>
      <p class="countdown__label">Próximo drop en</p>
      <div class="countdown__grid">
        <div class="cd-cell">
          <span class="cd-num">{{ pad(cd.days) }}</span>
          <span class="cd-unit">días</span>
        </div>
        <span class="cd-sep">:</span>
        <div class="cd-cell">
          <span class="cd-num">{{ pad(cd.hours) }}</span>
          <span class="cd-unit">hrs</span>
        </div>
        <span class="cd-sep">:</span>
        <div class="cd-cell">
          <span class="cd-num">{{ pad(cd.mins) }}</span>
          <span class="cd-unit">min</span>
        </div>
        <span class="cd-sep">:</span>
        <div class="cd-cell">
          <span class="cd-num">{{ pad(cd.secs) }}</span>
          <span class="cd-unit">seg</span>
        </div>
      </div>
    </div>
  </section>

  <section class="drops">
    <div class="drops__inner">

      <!-- Skeletons -->
      <div v-if="cargando" class="drops__grid">
        <SkeletonCard v-for="i in 3" :key="i" />
      </div>

      <!-- Sin lanzamientos -->
      <div v-else-if="!lanzamientos.length" class="empty">
        <p class="empty__title">Pronto habrá novedades.</p>
        <p class="empty__sub">Escríbenos para ser los primeros en enterarse.</p>
      </div>

      <!-- Grid -->
      <div v-else class="drops__grid" v-reveal>
        <article v-for="p in lanzamientos" :key="p.id" class="drop-card">
          <div class="drop-card__media">
            <img
              v-if="p.images?.length"
              :src="p.images[0]"
              :alt="p.name"
              loading="lazy"
              class="drop-card__img"
            />
            <div v-else class="drop-card__placeholder" aria-hidden="true">
              <span>HEBENNUS</span>
            </div>
            <div class="drop-card__overlay">
              <p class="drop-card__soon">Próximamente</p>
            </div>
          </div>
          <div class="drop-card__body">
            <span class="drop-card__meta">{{ p.category ?? 'New Drop' }}</span>
            <h3 class="drop-card__name">{{ p.name }}</h3>
            <p v-if="p.description" class="drop-card__desc">{{ p.description }}</p>
          </div>
        </article>
      </div>

      <!-- CTA WhatsApp -->
      <div class="notify" v-reveal>
        <div class="notify__text">
          <h2 class="notify__title">Sé el primero en saber</h2>
          <p class="notify__desc">
            Cada drop es edición limitada. Cuando se acaba, se acaba.<br />
            Escríbenos para recibir alertas exclusivas de lanzamiento.
          </p>
        </div>
        <a :href="waLink" target="_blank" rel="noopener noreferrer" class="notify__btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          Recibir alertas por WhatsApp
        </a>
      </div>

    </div>
  </section>
</div>
</template>

<style scoped>
/* ── HERO ── */
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
  padding: 0.4rem 0.95rem;
  border-radius: var(--radius-pill);
  background: var(--glow-color);
  border: 1px solid var(--border-mid);
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

/* ── COUNTDOWN ── */
.countdown-section {
  background: var(--surface-2);
  border-bottom: 1px solid var(--border-mid);
  padding: 2.5rem 2rem;
}
.countdown-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
}
.countdown__label {
  font-size: 0.68rem;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--accent-3);
}
.countdown__grid {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.cd-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  min-width: 4rem;
  background: var(--surface-3);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-md);
  padding: 0.9rem 0.6rem;
  box-shadow: var(--shadow-soft);
  transition: transform 0.3s var(--ease-out), box-shadow 0.3s var(--ease-out);
}
.cd-cell:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-hover);
}
.cd-num {
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  font-size: clamp(1.8rem, 5vw, 3rem);
  color: var(--text-1);
  line-height: 1;
  letter-spacing: 0.02em;
}
.cd-unit {
  font-size: 0.6rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-3);
}
.cd-sep {
  font-family: var(--font-display);
  font-size: clamp(1.5rem, 4vw, 2.5rem);
  color: var(--accent-2);
  margin-bottom: 1rem;
}

/* ── DROPS ── */
.drops { padding: 4rem 2rem 5rem; }
.drops__inner { max-width: 1200px; margin: 0 auto; }
.drops__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
  margin-bottom: 4rem;
}

.drop-card {
  display: flex;
  flex-direction: column;
  background: var(--surface-2);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-soft);
  transition: transform 0.35s var(--ease-out), box-shadow 0.35s var(--ease-out), border-color 0.35s var(--ease-out);
}
.drop-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-hover);
  border-color: rgba(34,211,238,.32);
}
.drop-card__media {
  position: relative;
  aspect-ratio: 3 / 4;
  background: var(--surface-2);
  overflow: hidden;
}
.drop-card__img {
  width: 100%; height: 100%;
  object-fit: cover;
  filter: brightness(0.75);
  transition: transform 0.7s var(--ease-out), filter 0.5s var(--ease-out);
}
.drop-card:hover .drop-card__img { transform: scale(1.05); filter: brightness(0.85); }
.drop-card__placeholder {
  width: 100%; height: 100%;
  display: grid;
  place-items: center;
  background: var(--surface-3);
}
.drop-card__placeholder span {
  font-family: var(--font-display);
  font-size: 1rem;
  color: var(--text-3);
  letter-spacing: 0.25em;
}
.drop-card__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  padding: 1.5rem;
}
.drop-card__soon {
  font-family: var(--font-display);
  font-size: 0.72rem;
  color: var(--text-1);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 0.4rem 0.9rem;
  border-radius: var(--radius-pill);
  background: rgba(7,11,20,.55);
  border: 1px solid var(--overlay-border);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.drop-card__body { padding: 1.1rem 1.25rem 1.4rem; display: flex; flex-direction: column; gap: 0.4rem; }
.drop-card__meta { font-size: 0.68rem; color: var(--accent-3); letter-spacing: 0.2em; text-transform: uppercase; }
.drop-card__name { font-family: var(--font-display); font-size: 1rem; font-weight: 500; color: var(--text-1); }
.drop-card__desc {
  font-size: 0.78rem;
  color: var(--text-3);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── EMPTY ── */
.empty {
  padding: 4rem 2rem;
  margin-bottom: 4rem;
  text-align: center;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft);
}
.empty__title { font-family: var(--font-display); font-size: 1.5rem; font-weight: 300; color: var(--text-1); margin-bottom: 0.5rem; }
.empty__sub   { font-size: 0.8rem; color: var(--text-3); letter-spacing: 0.08em; }

/* ── NOTIFY ── */
.notify {
  position: relative;
  background: var(--surface-1);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft);
  padding: 3.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  flex-wrap: wrap;
  overflow: hidden;
}
.notify::before {
  content: '';
  position: absolute;
  top: 0; left: 0;
  width: 100%;
  height: 4px;
  background: var(--grad-cool);
}
.notify__title {
  font-family: var(--font-display);
  font-size: clamp(1.4rem, 3vw, 2rem);
  font-weight: 300;
  color: var(--text-1);
  letter-spacing: -0.02em;
  margin-bottom: 0.75rem;
}
.notify__desc { font-size: 0.85rem; color: var(--text-2); line-height: 1.8; }
.notify__btn {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  padding: 1rem 2rem;
  background: var(--accent);
  color: var(--ink);
  border-radius: var(--radius-pill);
  font-family: var(--font-display);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
  box-shadow: var(--shadow-soft);
  transition: filter 0.25s var(--ease-out), transform 0.25s var(--ease-spring), box-shadow 0.25s var(--ease-out);
  flex-shrink: 0;
}
.notify__btn svg { fill: #25D366; }
.notify__btn:hover { filter: brightness(1.1); transform: translateY(-2px); box-shadow: var(--shadow-hover); }
.notify__btn:active { transform: scale(0.97); }

@media (max-width: 900px) { .drops__grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) {
  .drops     { padding: 2.5rem 1.25rem 4rem; }
  .page-hero { padding: 2.5rem 1.25rem 2rem; }
  .drops__grid { grid-template-columns: 1fr; }
  .notify    { padding: 2rem; flex-direction: column; align-items: flex-start; }
  .notify__btn { width: 100%; justify-content: center; }
  .countdown-section { padding: 2rem 1.25rem; }
  .cd-cell   { min-width: 3rem; padding: 0.6rem 0.4rem; }
}
</style>
