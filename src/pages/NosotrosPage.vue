<script setup>
import { WHATSAPP_NUMERO } from '../lib/config.js'
import { useSeo } from '../lib/useSeo.js'

useSeo({
  title: 'Nosotros',
  description: 'Hebennus: juventud (Hebe), renacimiento (Bennu) y unión. Una marca de Lima, Perú.',
  path: '/nosotros',
})

const pilares = [
  {
    num: '01',
    nombre: 'Unión',
    texto: 'A pesar de nacer solos y morir solos, en esta vida lograrás encontrar un grupo de personas que sigan tus mismos ideales. Ahí está la verdadera unión.',
  },
  {
    num: '02',
    nombre: 'Ambición',
    texto: 'Somos el grupo de personas que no solo busca tocar el cielo. Nosotros queremos conocer el universo. La ambición define hasta dónde llegamos.',
  },
  {
    num: '03',
    nombre: 'Pasión',
    texto: 'Tenemos esa pasión por crear cosas y ser alguien en esta vida. La pasión que le ponemos a cada proyecto, las ganas de creer que podemos crear algo real.',
  },
  {
    num: '04',
    nombre: 'Confianza',
    texto: 'Creer que lo que estamos haciendo está bien. Tener seguridad en lo que queremos lograr. La confianza es el pilar que sostiene todo lo demás.',
  },
]
</script>

<template>
<div>
  <!-- ░░ HERO ░░ -->
  <section class="nosotros-hero">
    <div class="nosotros-hero__inner">
      <span class="chip">Lima, Perú</span>
      <h1 class="nosotros-hero__title" aria-label="Somos Hebennus.">
        <span class="word word--solid">SOMOS</span>
        <span class="word word--line" data-text="HEBENNUS.">HEBENNUS.</span>
      </h1>
      <p class="nosotros-hero__sub">
        Una marca nacida de la juventud, el renacimiento y la unión.
      </p>
    </div>
  </section>

  <!-- ░░ MISIÓN + VISIÓN ░░ -->
  <section class="mv">
    <div class="mv__inner" v-reveal>
      <article class="mv__card">
        <span class="mv__label">Misión</span>
        <p class="mv__text">
          Crear prendas de vestir de alta calidad y diseños innovadores que sean vistos como una declaración de estilo y estatus. Somos una marca que inspira y motiva a través de cada pieza, construyendo un legado duradero en la moda internacional.
        </p>
      </article>
      <article class="mv__card">
        <span class="mv__label">Visión</span>
        <p class="mv__text">
          Ser líderes a nivel mundial en la industria de la moda, reconocidos por diseños innovadores y de alta calidad. Una marca que trasciende el tiempo, evoluciona con sus clientes y es fuente de inspiración y empoderamiento para las personas.
        </p>
      </article>
    </div>
  </section>

  <!-- ░░ BANDA EDITORIAL ░░ -->
  <section class="nos-editorial" aria-label="Nuestra esencia">
    <div class="nos-editorial__overlay"></div>
    <blockquote class="nos-editorial__quote">"No buscamos tocar el cielo.<br/>Queremos conocer el universo."</blockquote>
  </section>

  <!-- ░░ PILARES ░░ -->
  <section class="pilares">
    <div class="pilares__inner">
      <header class="pilares__hd" v-reveal>
        <span class="chip">Ideales</span>
        <h2 class="pilares__title">Los 4 Pilares</h2>
        <p class="pilares__sub">
          Los valores que guían cada pieza que creamos y cada persona que viste Hebennus.
        </p>
      </header>
      <div class="pilares__grid" v-reveal>
        <article v-for="p in pilares" :key="p.num" class="pilar">
          <span class="pilar__num">{{ p.num }}</span>
          <h3 class="pilar__nombre">{{ p.nombre }}</h3>
          <p class="pilar__texto">{{ p.texto }}</p>
        </article>
      </div>
    </div>
  </section>

  <!-- ░░ ETIMOLOGÍA ░░ -->
  <section class="nombre">
    <div class="nombre__inner">
      <header class="nombre__hd" v-reveal>
        <span class="chip">Origen</span>
        <h2 class="nombre__title">¿Por qué Hebennus?</h2>
        <p class="nombre__intro">
          El nombre fue creado por Diana Hizo Ramírez, basado en esencias como la juventud, el renacimiento y la unión de sus integrantes.
        </p>
      </header>
      <div class="nombre__grid" v-reveal>
        <div class="etim">
          <span class="etim__parte">Hebe</span>
          <div class="etim__line"></div>
          <div class="etim__body">
            <p class="etim__origen">Griego · Mitología</p>
            <p class="etim__desc">Hebe es la personificación y diosa de la juventud, hija de Júpiter y Juno. Fue escanciadora del néctar de los dioses hasta que la reemplazó Ganímedes.</p>
            <p class="etim__valor">Juventud</p>
          </div>
        </div>
        <div class="etim">
          <span class="etim__parte">Bennu</span>
          <div class="etim__line"></div>
          <div class="etim__body">
            <p class="etim__origen">Egipcio · Mitología</p>
            <p class="etim__desc">Bennu es el ave mitológica del Antiguo Egipto, equivalente al fénix griego. Símbolo del renacimiento y las segundas oportunidades, porque creemos en ellas.</p>
            <p class="etim__valor">Renacimiento</p>
          </div>
        </div>
        <div class="etim">
          <span class="etim__parte">Us</span>
          <div class="etim__line"></div>
          <div class="etim__body">
            <p class="etim__origen">Inglés · "Nosotros"</p>
            <p class="etim__desc">La traducción al español es "Nosotros". Refleja directamente el pilar de la Unión: somos más fuertes juntos, siempre.</p>
            <p class="etim__valor">Unión</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ░░ CIERRE ░░ -->
  <section class="cierre">
    <div class="cierre__inner" v-reveal>
      <blockquote class="cierre__quote">
        "Make it real,<br />Make it with Hebennus."
      </blockquote>
      <a
        :href="`https://wa.me/${WHATSAPP_NUMERO}`"
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn--outline"
      >Habla con nosotros</a>
    </div>
  </section>
</div>
</template>

<style scoped>
/* ── HERO ── */
.nosotros-hero {
  min-height: 70svh;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: url('/editorial-gym.jpg') center / cover no-repeat;   /* foto + capa denim */
  border-bottom: 1px solid var(--border);
  padding: 0 2rem 5rem;
  overflow: hidden;
  position: relative;
}
.nosotros-hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg, rgba(46,72,112,.9) 0%, rgba(46,72,112,.62) 55%, rgba(20,18,15,.6) 100%);
  pointer-events: none;
}
.nosotros-hero__inner {
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  position: relative;
  z-index: 1;
  animation: hb-fade-up 0.8s var(--ease-out) both;
}
.chip {
  display: inline-block;
  font-size: 0.68rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: rgba(247,244,240,.85);
  margin-bottom: 1.5rem;
  padding: 0.4rem 0.95rem;
  border-radius: var(--radius-pill);
  background: rgba(247,244,240,.15);
  border: 1px solid rgba(247,244,240,.3);
}
.nosotros-hero__title {
  display: flex;
  flex-direction: column;
  line-height: 0.88;
  margin-bottom: 2.5rem;
}
.word {
  display: block;
  font-family: var(--font-brand);
  font-size: clamp(4rem, 13vw, 11rem);
  letter-spacing: -0.01em;
}
/* SOMOS — relleno crema sólido sobre banda denim */
.word--solid   { color: #F4F1EC; }

/* HEBENNUS. — outline relleno con líneas horizontales (igual que el hero del Home) */
.word--line {
  position: relative;
  color: transparent;
  -webkit-text-stroke: 1px #F4F1EC;
  background: repeating-linear-gradient(to bottom, #F4F1EC 0, #F4F1EC 3px, transparent 3px, transparent 8px);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.nosotros-hero__sub {
  font-size: 0.9rem;
  color: rgba(247,244,240,.85);
  letter-spacing: 0.04em;
  line-height: 1.7;
  max-width: 480px;
}

/* ── MISIÓN / VISIÓN ── */
.mv {
  padding: 6rem 2rem;
  border-bottom: 1px solid var(--border);
}
.mv__inner {
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.25rem;
}
.mv__card {
  padding: 3.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  background: var(--surface-2);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft);
  transition: transform 0.35s var(--ease-out), box-shadow 0.35s var(--ease-out), border-color 0.35s var(--ease-out);
}
.mv__card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-hover);
  border-color: rgba(60,90,135,.32);
}
.mv__label {
  font-size: 0.7rem;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--accent-3);
}
.mv__text {
  font-size: 1rem;
  color: var(--text-2);
  line-height: 1.85;
  font-weight: 300;
}

/* ── BANDA EDITORIAL ── */
.nos-editorial {
  position: relative;
  min-height: 62vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
  text-align: center;
  background: url('/editorial-run.jpg') center 30% / cover no-repeat;
}
.nos-editorial__overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(rgba(20,18,15,.55), rgba(20,18,15,.72));
}
.nos-editorial__quote {
  position: relative;
  z-index: 1;
  font-family: var(--font-brand);
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2.8rem);
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: #F4F1EC;
  max-width: 800px;
}

/* ── PILARES ── */
.pilares {
  padding: 7rem 2rem;
  background: var(--surface-1);
  border-bottom: 1px solid var(--border);
}
.pilares__inner { max-width: 1200px; margin: 0 auto; }
.pilares__hd { margin-bottom: 4rem; }
.pilares__title {
  font-family: var(--font-display);
  font-size: clamp(2rem, 5vw, 3.8rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-1);
  line-height: 1.1;
  margin-top: 0.75rem;
}
.pilares__sub {
  margin-top: 1rem;
  font-size: 0.85rem;
  color: var(--text-3);
  max-width: 440px;
  line-height: 1.7;
}
.pilares__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.25rem;
}
.pilar {
  position: relative;
  padding: 3rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  background: var(--surface-2);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-soft);
  overflow: hidden;
  transition: transform 0.35s var(--ease-out), box-shadow 0.35s var(--ease-out), border-color 0.35s var(--ease-out);
}
.pilar::before {
  content: '';
  position: absolute;
  top: 0; left: 0;
  width: 100%;
  height: 3px;
  background: var(--grad-cool);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.4s var(--ease-out);
}
.pilar:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-hover);
  border-color: rgba(60,90,135,.32);
}
.pilar:hover::before { transform: scaleX(1); }
.pilar__num {
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  font-size: 0.65rem;
  color: var(--accent-3);
  letter-spacing: 0.12em;
}
.pilar__nombre {
  font-family: var(--font-display);
  font-size: 1.5rem;
  font-weight: 400;
  color: var(--text-1);
  letter-spacing: -0.02em;
}
.pilar__texto {
  font-size: 0.88rem;
  color: var(--text-2);
  line-height: 1.85;
  font-weight: 300;
}

/* ── ETIMOLOGÍA ── */
.nombre {
  padding: 7rem 2rem;
  border-bottom: 1px solid var(--border);
}
.nombre__inner { max-width: 1200px; margin: 0 auto; }
.nombre__hd { margin-bottom: 4rem; }
.nombre__title {
  font-family: var(--font-display);
  font-size: clamp(2rem, 5vw, 3.8rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-1);
  line-height: 1.1;
  margin-top: 0.75rem;
}
.nombre__intro {
  margin-top: 1rem;
  font-size: 0.88rem;
  color: var(--text-3);
  max-width: 500px;
  line-height: 1.7;
}
.nombre__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.25rem;
}
.etim {
  padding: 2.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  background: var(--surface-2);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-soft);
  transition: transform 0.35s var(--ease-out), box-shadow 0.35s var(--ease-out), border-color 0.35s var(--ease-out);
}
.etim:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-hover);
  border-color: rgba(60,90,135,.32);
}
.etim__parte {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 2.5rem;
  color: var(--text-1);
  letter-spacing: 0.02em;
}
.etim__line {
  width: 2.5rem;
  height: 3px;
  border-radius: var(--radius-pill);
  background: var(--grad-cool);
  transition: width 0.4s var(--ease-out);
}
.etim:hover .etim__line { width: 3.5rem; }
.etim__body { display: flex; flex-direction: column; gap: 0.6rem; }
.etim__origen {
  font-size: 0.68rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--accent-3);
}
.etim__desc {
  font-size: 0.84rem;
  color: var(--text-2);
  line-height: 1.8;
  font-weight: 300;
}
.etim__valor {
  font-family: var(--font-display);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-1);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-top: 0.5rem;
}

/* ── CIERRE ── */
.cierre {
  padding: 9rem 2rem;
  text-align: center;
}
.cierre__inner {
  max-width: 680px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3rem;
}
.cierre__inner::before {
  content: '';
  width: 56px;
  height: 3px;
  border-radius: var(--radius-pill);
  background: var(--grad-cool);
}
.cierre__quote {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: clamp(1.7rem, 4vw, 3rem);
  color: var(--text-1);
  line-height: 1.25;
  letter-spacing: -0.01em;
  font-style: normal;
}

/* ── SHARED ── */
/* .btn base es global (style.css). */

/* ── RESPONSIVE ── */
@media (max-width: 900px) {
  .nombre__grid { grid-template-columns: 1fr; }
}
@media (max-width: 800px) {
  .mv__inner { grid-template-columns: 1fr; }
}
@media (max-width: 600px) {
  .nosotros-hero { padding: 0 1.25rem 4rem; }
  .word { font-size: clamp(3rem, 18vw, 5rem); }
  .word--line          { -webkit-text-stroke-width: 1px; }
  .word--line::before  { -webkit-text-stroke-width: 3.5px; }
  .word--line::after   { -webkit-text-stroke-width: 5px; }
  .mv { padding: 4rem 1.25rem; }
  .mv__card { padding: 2.5rem 2rem; }
  .pilares { padding: 5rem 1.25rem; }
  .pilares__grid { grid-template-columns: 1fr; }
  .nombre { padding: 5rem 1.25rem; }
  .cierre { padding: 5rem 1.25rem; }
}
</style>
