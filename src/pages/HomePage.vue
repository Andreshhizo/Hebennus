<script setup>
import { ref, onMounted, inject } from 'vue'
import { RouterLink } from 'vue-router'
import { supabase }   from '../lib/supabase.js'
import { WHATSAPP_NUMERO } from '../lib/config.js'
import ProductCard  from '../components/ProductCard.vue'
import SkeletonCard from '../components/SkeletonCard.vue'

const addToCart = inject('addToCart')
const productos = ref([])
const cargando  = ref(true)

onMounted(async () => {
  const { data } = await supabase
    .from('products')
    .select('*, product_variants(*)')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(4)
  productos.value = data ?? []
  cargando.value = false
})
</script>

<template>
<div>
  <!-- ░░ HERO ░░ -->
  <section class="hero" aria-label="Portada">
    <div class="hero__bg" aria-hidden="true">
      <div class="hero__glow"></div>
    </div>
    <div class="hero__content">
      <p class="hero__eyebrow">SS25 · Edición Limitada</p>
      <h1 class="hero__headline" aria-label="Make it real.">
        <span class="hero__word hero__word--solid">MAKE</span>
        <span class="hero__word hero__word--line" data-text="IT">IT</span>
        <span class="hero__word hero__word--line" data-text="REAL.">REAL.</span>
      </h1>
      <p class="hero__sub">Oversize &nbsp;·&nbsp; Atlético &nbsp;·&nbsp; Cómodo</p>
      <div class="hero__cta">
        <RouterLink to="/coleccion" class="btn btn--fill">Ver Colección</RouterLink>
        <a
          :href="`https://wa.me/${WHATSAPP_NUMERO}`"
          target="_blank"
          rel="noopener noreferrer"
          class="btn btn--outline"
        >WhatsApp</a>
      </div>
    </div>
    <div class="hero__scroll" aria-hidden="true"><span></span></div>
  </section>

  <!-- ░░ FEATURED PRODUCTS ░░ -->
  <section class="featured" v-if="cargando || productos.length">
    <div class="featured__inner">
      <header class="featured__hd">
        <span class="chip">New In</span>
        <h2 class="featured__title">Últimas Piezas</h2>
      </header>
      <div class="grid">
        <template v-if="cargando">
          <SkeletonCard v-for="i in 4" :key="i" />
        </template>
        <template v-else>
          <ProductCard
            v-for="p in productos"
            :key="p.id"
            :product="p"
            @add-to-cart="addToCart"
          />
        </template>
      </div>
      <div class="featured__more">
        <RouterLink to="/coleccion" class="btn btn--outline">Ver toda la colección</RouterLink>
      </div>
    </div>
  </section>

  <!-- ░░ PILARES ░░ -->
  <section class="pilares" aria-label="Nuestros pilares">
    <div class="pilares__inner">
      <p class="pilares__eyebrow">Lo que nos define</p>
      <div class="pilares__grid">
        <div class="pilar">
          <span class="pilar__num">01</span>
          <h3 class="pilar__name">Unión</h3>
          <p class="pilar__desc">Encontrarás tu tribu. Personas que comparten tus ideales.</p>
        </div>
        <div class="pilar">
          <span class="pilar__num">02</span>
          <h3 class="pilar__name">Ambición</h3>
          <p class="pilar__desc">No buscamos el cielo. Queremos conocer el universo.</p>
        </div>
        <div class="pilar">
          <span class="pilar__num">03</span>
          <h3 class="pilar__name">Pasión</h3>
          <p class="pilar__desc">Creemos en la pasión de crear algo real, algo propio.</p>
        </div>
        <div class="pilar">
          <span class="pilar__num">04</span>
          <h3 class="pilar__name">Confianza</h3>
          <p class="pilar__desc">Seguridad en cada paso. Sabemos lo que queremos lograr.</p>
        </div>
      </div>
      <RouterLink to="/nosotros" class="pilares__link">Conoce nuestra historia →</RouterLink>
    </div>
  </section>

  <!-- ░░ MANIFESTO ░░ -->
  <section class="manifesto" aria-label="Manifiesto">
    <div class="manifesto__inner">
      <blockquote class="manifesto__quote">
        "Make it real,<br />Make it with Hebennus."
      </blockquote>
      <p class="manifesto__text">
        Somos una marca de Lima que cree en la comodidad sin renunciar al estilo.
        Cada pieza está pensada para que se sienta tuya desde el primer día.
        Oversize. Atlético. Real.
      </p>
      <RouterLink to="/lanzamientos" class="btn btn--outline">Próximos lanzamientos</RouterLink>
    </div>
  </section>
</div>
</template>

<style scoped>
/* ── HERO ── */
.hero {
  position: relative;
  min-height: 88svh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow: hidden;
}
.hero__bg {
  position: absolute;
  inset: 0;
  background: var(--ink);
  /* Para foto de fondo, descomenta:
  background-image: url('/hero.jpg');
  background-size: cover;
  background-position: center;
  */
}
.hero__glow {
  position: absolute;
  width: 70%;
  height: 70%;
  bottom: -12%;
  right: -8%;
  background: radial-gradient(ellipse, var(--glow-color) 0%, transparent 68%);
  pointer-events: none;
}
.hero__content {
  position: relative;
  z-index: 1;
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  padding: 0 2rem 5rem;
}
.hero__eyebrow {
  display: block;
  font-size: 0.7rem;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--accent-3);
  margin-bottom: 2.5rem;
}
.hero__headline {
  display: flex;
  flex-direction: column;
  line-height: 0.88;
}
.hero__word {
  display: block;
  font-family: var(--font-brand);
  font-size: clamp(5rem, 17vw, 15rem);
  letter-spacing: -0.01em;
}
/* MAKE — relleno blanco hielo */
.hero__word--solid   { color: var(--text-1); }

/* IT / REAL. — outline de líneas paralelas múltiples (efecto técnico/varsity).
   Capas de trazo apiladas: línea exterior blanca → hueco navy → línea interior blanca. */
.hero__word--line {
  position: relative;
  color: transparent;
  -webkit-text-stroke: 1.5px var(--text-1);   /* línea interior */
}
.hero__word--line::before,
.hero__word--line::after {
  content: attr(data-text);
  position: absolute;
  left: 0;
  top: 0;
  color: transparent;
  pointer-events: none;
}
.hero__word--line::before {                    /* hueco (mismo color del fondo) */
  -webkit-text-stroke: 5px var(--ink);
  z-index: -1;
}
.hero__word--line::after  {                    /* línea exterior */
  -webkit-text-stroke: 7.5px var(--text-1);
  z-index: -2;
}
.hero__sub {
  margin-top: 3rem;
  font-size: 0.75rem;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--text-2);
}
.hero__cta {
  margin-top: 2.5rem;
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
.hero__scroll {
  position: absolute;
  bottom: 2.5rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1;
}
.hero__scroll span {
  display: block;
  width: 1px;
  height: 54px;
  background: linear-gradient(to bottom, var(--accent), transparent);
  animation: scrollPulse 2.4s ease-in-out infinite;
}
@keyframes scrollPulse {
  0%   { opacity: 0; transform: scaleY(0); transform-origin: top; }
  40%  { opacity: 1; transform: scaleY(1); }
  100% { opacity: 0; transform: scaleY(0.3); transform-origin: bottom; }
}

/* ── SHARED BUTTONS ── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.9rem 2.2rem;
  font-family: var(--font-display);
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  transition: all 0.25s ease;
  cursor: pointer;
}
.btn--fill {
  background: var(--text-1);
  color: var(--ink);
  border: 1px solid var(--text-1);
}
.btn--fill:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--ink);
}
.btn--outline {
  background: transparent;
  color: var(--text-1);
  border: 1px solid var(--border-mid);
}
.btn--outline:hover {
  border-color: var(--text-1);
  background: var(--glow-color);
}

/* ── FEATURED ── */
.featured { padding: 5rem 2rem 3rem; }
.featured__inner { max-width: 1200px; margin: 0 auto; }
.featured__hd { margin-bottom: 3.5rem; }
.chip {
  display: inline-block;
  font-size: 0.68rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--accent-3);
}
.featured__title {
  font-family: var(--font-display);
  font-size: clamp(2rem, 5vw, 3.8rem);
  font-weight: 300;
  letter-spacing: -0.025em;
  color: var(--text-1);
  line-height: 1.1;
  margin-top: 0.7rem;
}
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1.5rem;
}
.featured__more {
  margin-top: 3.5rem;
  display: flex;
  justify-content: center;
}

/* ── PILARES ── */
.pilares {
  background: var(--surface-1);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border-mid);
  padding: 5rem 2rem;
}
.pilares__inner { max-width: 1200px; margin: 0 auto; }
.pilares__eyebrow {
  font-size: 0.7rem;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--copper);
  margin-bottom: 3rem;
}
.pilares__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
  border: 1px solid var(--border-mid);
  box-shadow: var(--shadow-sm);
}
.pilar {
  padding: 2.5rem 2rem;
  background: var(--surface-2);
  border-right: 1px solid var(--border-mid);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.pilar:last-child { border-right: none; }
.pilar__num {
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  font-size: 0.65rem;
  color: var(--accent-3);
  letter-spacing: 0.12em;
}
.pilar__name {
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 500;
  color: var(--text-1);
  letter-spacing: -0.01em;
}
.pilar__desc {
  font-size: 0.82rem;
  color: var(--text-2);
  line-height: 1.7;
}
.pilares__link {
  display: inline-block;
  margin-top: 3rem;
  font-size: 0.78rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-2);
  border-bottom: 1px solid var(--border-mid);
  padding-bottom: 2px;
  transition: color 0.2s, border-color 0.2s;
}
.pilares__link:hover { color: var(--text-1); border-color: var(--text-1); }

/* ── MANIFESTO ── */
.manifesto {
  padding: 6rem 2rem;
  text-align: center;
}
.manifesto__inner {
  max-width: 680px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2.5rem;
}
.manifesto__quote {
  font-family: var(--font-display);
  font-size: clamp(1.7rem, 4vw, 3rem);
  color: var(--text-1);
  line-height: 1.25;
  letter-spacing: -0.01em;
  font-style: normal;
}
.manifesto__text {
  font-size: 0.95rem;
  color: var(--text-2);
  line-height: 1.9;
  max-width: 480px;
}

/* ── RESPONSIVE ── */
@media (max-width: 1024px) {
  .grid { grid-template-columns: repeat(3, 1fr); }
  .pilares__grid { grid-template-columns: repeat(2, 1fr); }
  .pilar:nth-child(2) { border-right: none; }
  .pilar:nth-child(1),
  .pilar:nth-child(2) { border-bottom: 1px solid var(--border-mid); }
}
@media (max-width: 720px) {
  .grid { grid-template-columns: repeat(2, 1fr); gap: 1rem; }
}
@media (max-width: 600px) {
  .hero__word { font-size: clamp(3.5rem, 20vw, 7rem); }
  .hero__word--line          { -webkit-text-stroke-width: 1px; }
  .hero__word--line::before  { -webkit-text-stroke-width: 3.5px; }
  .hero__word--line::after   { -webkit-text-stroke-width: 5px; }
  .featured  { padding: 4rem 1.25rem 2.5rem; }
  .pilares   { padding: 4rem 1.25rem; }
  .pilares__grid { grid-template-columns: 1fr; }
  .pilar { border-right: none; border-bottom: 1px solid var(--border-mid); }
  .pilar:last-child { border-bottom: none; }
  .manifesto { padding: 4rem 1.25rem; }
}
</style>
