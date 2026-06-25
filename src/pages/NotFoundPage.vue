<script setup>
import { RouterLink } from 'vue-router'
</script>

<template>
<div class="not-found">
  <div class="not-found__inner">
    <span class="chip">404</span>
    <h1 class="not-found__title">
      <span class="word word--solid">PÁGINA</span>
      <span class="word word--outline">NO EXISTE.</span>
    </h1>
    <p class="not-found__sub">La página que buscas no existe o fue movida.</p>
    <RouterLink to="/" class="btn">Volver al inicio</RouterLink>
  </div>
</div>
</template>

<style scoped>
.not-found {
  min-height: 80svh;
  display: flex;
  align-items: center;
  padding: 4rem 2rem;
}
.not-found__inner {
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  animation: hb-fade-up 0.7s var(--ease-out) both;
}
.chip {
  display: inline-block;
  font-size: 0.68rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--accent-3);
  margin-bottom: 1.5rem;
  padding: 0.4rem 0.95rem;
  border-radius: var(--radius-pill);
  background: var(--glow-color);
  border: 1px solid var(--border-mid);
}
.not-found__title {
  display: flex;
  flex-direction: column;
  line-height: 0.88;
  margin-bottom: 2.5rem;
}
.word {
  display: block;
  font-family: var(--font-display);
  font-weight: 800;
  font-size: clamp(3.5rem, 12vw, 10rem);
  letter-spacing: -0.01em;
}
.word--solid   { color: var(--text-1); }
.word--outline { color: transparent; -webkit-text-stroke: 1.5px var(--text-1); }
.not-found__sub {
  font-size: 0.9rem;
  color: var(--text-2);
  margin-bottom: 3rem;
  letter-spacing: 0.04em;
}
.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.9rem 2.2rem;
  background: var(--text-1);
  color: var(--ink);
  border: 1px solid var(--text-1);
  border-radius: var(--radius-pill);
  font-family: var(--font-display);
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  box-shadow: var(--shadow-soft);
  transition: transform 0.25s var(--ease-spring), background-color 0.25s var(--ease-out),
              border-color 0.25s var(--ease-out), color 0.25s var(--ease-out), box-shadow 0.25s var(--ease-out);
}
.btn:hover  { background: var(--accent); border-color: var(--accent); color: var(--ink); transform: translateY(-2px); box-shadow: var(--shadow-hover); }
.btn:active { transform: scale(0.97); }

@media (max-width: 600px) {
  .not-found { padding: 4rem 1.25rem; }
  .word--outline { -webkit-text-stroke-width: 1px; }
}
</style>
