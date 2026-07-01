<script setup>
import { RouterLink } from 'vue-router'
import { WHATSAPP_NUMERO, INSTAGRAM, TIKTOK } from '../lib/config.js'
</script>

<template>
  <footer class="foot">
    <div class="foot__main">
      <!-- Brand -->
      <div class="foot__brand">
        <RouterLink to="/" class="foot__logo">HEBENNUS</RouterLink>
        <p class="foot__tag">Make it real.</p>
        <p class="foot__location">Lima, Perú</p>
        <!-- Redes -->
        <div class="foot__social">
          <a
            :href="`https://instagram.com/${INSTAGRAM}`"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Instagram de Hebennus"
            class="foot__social-link"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
              <circle cx="12" cy="12" r="4"/>
              <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor"/>
            </svg>
          </a>
          <a
            :href="`https://tiktok.com/@${TIKTOK}`"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="TikTok de Hebennus"
            class="foot__social-link"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34v-6.9a8.16 8.16 0 0 0 4.77 1.53V6.5a4.85 4.85 0 0 1-1-.19z"/>
            </svg>
          </a>
          <a
            :href="`https://wa.me/${WHATSAPP_NUMERO}`"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="WhatsApp de Hebennus"
            class="foot__social-link"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </a>
        </div>
      </div>

      <!-- Nav -->
      <div class="foot__col">
        <p class="foot__col-title">Explorar</p>
        <nav class="foot__nav">
          <RouterLink to="/coleccion">Colección</RouterLink>
          <RouterLink to="/lanzamientos">Lanzamientos</RouterLink>
          <RouterLink to="/nosotros">Nosotros</RouterLink>
          <RouterLink to="/privacidad">Política de privacidad</RouterLink>
        </nav>
      </div>

      <!-- Compra -->
      <div class="foot__col">
        <p class="foot__col-title">Compra</p>
        <div class="foot__nav">
          <a :href="`https://wa.me/${WHATSAPP_NUMERO}`" target="_blank" rel="noopener noreferrer">
            Pedidos por WhatsApp
          </a>
          <span>Devoluciones en 7 días</span>
        </div>
      </div>

      <!-- Pagos -->
      <div class="foot__col">
        <p class="foot__col-title">Aceptamos</p>
        <div class="foot__payments">
          <span class="foot__pay-chip">Yape</span>
          <span class="foot__pay-chip">Plin</span>
          <span class="foot__pay-chip">Transferencia</span>
          <span class="foot__pay-chip">Efectivo</span>
        </div>
        <p class="foot__shipping-note">
          Envío gratis en pedidos<br />mayores a S/ 149
        </p>
      </div>
    </div>

    <div class="foot__bottom">
      <p>© 2025 Hebennus · Lima, Perú · Todos los derechos reservados</p>
      <p>Hecho con pasión en Perú 🇵🇪</p>
    </div>
  </footer>
</template>

<style scoped>
.foot {
  border-top: 1px solid var(--border);
  background: var(--surface-1);
  border-top-left-radius: var(--radius-lg);
  border-top-right-radius: var(--radius-lg);
}
.foot__main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 3.5rem 2rem;
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr 1fr;
  gap: 2.5rem;
  align-items: start;
}

/* ── BRAND ── */
.foot__logo {
  display: block;
  width: fit-content;
  font-family: var(--font-brand);
  font-size: 1.35rem;
  color: var(--text-1);
  letter-spacing: 0.04em;
  margin-bottom: 0.5rem;
  transition: opacity 0.2s var(--ease-out), transform 0.2s var(--ease-out);
}
.foot__logo:hover { opacity: 0.85; transform: translateY(-1px); }
.foot__tag {
  font-size: 0.75rem;
  color: var(--text-3);
  letter-spacing: 0.14em;
}
.foot__location {
  font-size: 0.72rem;
  color: var(--text-3);
  letter-spacing: 0.1em;
  margin-top: 0.2rem;
}
.foot__social {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.2rem;
}
.foot__social-link {
  color: var(--text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-mid);
  background: var(--surface-2);
  transition: color 0.25s var(--ease-out), transform 0.25s var(--ease-out), box-shadow 0.25s var(--ease-out), border-color 0.25s var(--ease-out), background 0.25s var(--ease-out);
}
.foot__social-link:hover {
  color: var(--text-1);
  transform: translateY(-3px);
  border-color: var(--accent);
  box-shadow: var(--shadow-hover);
}
.foot__social-link:active { transform: scale(0.94); }

/* ── COLUMNS ── */
.foot__col-title {
  font-size: 0.65rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-3);
  margin-bottom: 1rem;
  font-family: var(--font-display);
  font-weight: 500;
}
.foot__nav {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.foot__nav a, .foot__nav span {
  font-size: 0.8rem;
  color: var(--text-2);
  letter-spacing: 0.04em;
  transition: color 0.2s;
  line-height: 1.5;
}
.foot__nav a { width: fit-content; transition: color 0.2s var(--ease-out), transform 0.2s var(--ease-out); }
.foot__nav a:hover { color: var(--text-1); transform: translateX(3px); }
.foot__nav span { cursor: default; }

/* ── PAYMENTS ── */
.foot__payments {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 1.2rem;
}
.foot__pay-chip {
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  padding: 0.3rem 0.75rem;
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--text-2);
  font-family: var(--font-display);
  transition: color 0.25s var(--ease-out), border-color 0.25s var(--ease-out), transform 0.25s var(--ease-out);
}
.foot__pay-chip:hover { color: var(--text-1); border-color: var(--accent); transform: translateY(-2px); }
.foot__shipping-note {
  font-size: 0.75rem;
  color: var(--accent-2);
  line-height: 1.6;
  letter-spacing: 0.02em;
}

/* ── BOTTOM ── */
.foot__bottom {
  border-top: 1px solid var(--border);
  padding: 1.25rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  font-size: 0.68rem;
  color: var(--text-3);
  letter-spacing: 0.06em;
  flex-wrap: wrap;
  max-width: 1200px;
  margin: 0 auto;
}

/* ── RESPONSIVE ── */
@media (max-width: 900px) {
  .foot__main { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 600px) {
  .foot__main { grid-template-columns: 1fr; gap: 2rem; padding: 2.5rem 1.25rem; }
  .foot__bottom { padding: 1.25rem; flex-direction: column; text-align: center; }
}
</style>
