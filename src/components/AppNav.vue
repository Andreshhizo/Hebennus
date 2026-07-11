<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useTheme } from '../lib/useTheme.js'
import { useAuth } from '../lib/useAuth.js'

defineProps({
  scrolled:     { type: Boolean, default: false },
  carritoCount: { type: Number,  default: 0 },
})
const emit = defineEmits(['open-cart'])

const { isDark, toggle } = useTheme()
const { user, isAdmin, signOut } = useAuth()
const menuOpen    = ref(false)
const accountOpen = ref(false)
const router      = useRouter()
router.afterEach(() => { menuOpen.value = false; accountOpen.value = false })

async function cerrarSesion() {
  await signOut()
  accountOpen.value = false
  menuOpen.value = false
  router.push('/')
}

// Cierra el menú de cuenta al hacer clic fuera de él.
function onDocClick(e) {
  if (accountOpen.value && !e.target.closest('.nav__account')) accountOpen.value = false
}
onMounted(()   => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <header class="nav" :class="{ 'nav--scrolled': scrolled }">
    <div class="nav__inner">
      <!-- Hamburger (mobile) -->
      <button class="nav__burger" @click="menuOpen = true" aria-label="Abrir menú">
        <span></span><span></span><span></span>
      </button>

      <!-- Desktop links -->
      <nav class="nav__links" aria-label="Principal">
        <RouterLink to="/coleccion">Colección</RouterLink>
        <RouterLink to="/lanzamientos">Lanzamientos</RouterLink>
        <RouterLink to="/nosotros">Nosotros</RouterLink>
      </nav>

      <RouterLink class="nav__brand" to="/" aria-label="Hebennus — Inicio">HEBENNUS</RouterLink>

      <div class="nav__actions">
        <!-- Theme toggle -->
        <button class="nav__theme" @click="toggle" :aria-label="isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'">
          <!-- Moon: visible en dark mode -->
          <svg v-if="isDark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
          <!-- Sun: visible en light mode -->
          <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        </button>

        <!-- Account -->
        <div class="nav__account">
          <button class="nav__acct" :aria-label="user ? 'Mi cuenta' : 'Iniciar sesión'" @click="accountOpen = !accountOpen">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
            <span v-if="user && isAdmin" class="nav__acct-dot" aria-hidden="true"></span>
          </button>
          <Transition name="fade">
            <div v-if="accountOpen" class="nav__menu" role="menu">
              <template v-if="user">
                <p class="nav__menu-email">{{ user.email }}</p>
                <RouterLink to="/mis-pedidos" role="menuitem">Mis pedidos</RouterLink>
                <RouterLink v-if="isAdmin" to="/admin" role="menuitem" class="nav__menu-admin">Administrar pedidos</RouterLink>
                <button role="menuitem" @click="cerrarSesion">Salir</button>
              </template>
              <template v-else>
                <RouterLink to="/cuenta" role="menuitem">Iniciar sesión</RouterLink>
                <RouterLink to="/cuenta" role="menuitem" class="nav__menu-cta">Crear cuenta · 🎁</RouterLink>
              </template>
            </div>
          </Transition>
        </div>

        <!-- Cart -->
        <button
          class="nav__cart"
          :aria-label="`Carrito, ${carritoCount} ítems`"
          @click="emit('open-cart')"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <path d="M16 10a4 4 0 0 1-8 0"/>
          </svg>
          <span v-if="carritoCount > 0" class="nav__badge" aria-hidden="true">{{ carritoCount }}</span>
        </button>
      </div>
    </div>
  </header>

  <!-- Mobile menu -->
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="menuOpen" class="mob-overlay" @click="menuOpen = false" aria-hidden="true"></div>
    </Transition>

    <div class="mob-menu" :class="{ 'mob-menu--open': menuOpen }" role="dialog" aria-modal="true" aria-label="Menú">
      <div class="mob-menu__head">
        <span class="mob-menu__logo">HEBENNUS</span>
        <button class="mob-menu__close" @click="menuOpen = false" aria-label="Cerrar menú">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <nav class="mob-menu__links">
        <RouterLink to="/">Inicio</RouterLink>
        <RouterLink to="/coleccion">Colección</RouterLink>
        <RouterLink to="/lanzamientos">Lanzamientos</RouterLink>
        <RouterLink to="/nosotros">Nosotros</RouterLink>
      </nav>

      <div class="mob-menu__account">
        <template v-if="user">
          <p class="mob-account__email">{{ user.email }}</p>
          <RouterLink to="/mis-pedidos">Mis pedidos</RouterLink>
          <RouterLink v-if="isAdmin" to="/admin" class="mob-account__admin">Administrar pedidos</RouterLink>
          <button class="mob-account__out" @click="cerrarSesion">Salir</button>
        </template>
        <template v-else>
          <RouterLink to="/cuenta" class="mob-account__in">Iniciar sesión</RouterLink>
          <RouterLink to="/cuenta" class="mob-account__cta">Crear cuenta · 🎁 10%</RouterLink>
        </template>
      </div>

      <div class="mob-menu__theme">
        <button class="mob-theme-btn" @click="toggle">
          <template v-if="isDark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
            Tema claro
          </template>
          <template v-else>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="5"/>
              <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
            Tema oscuro
          </template>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.nav {
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid transparent;
  transition: background 0.35s ease, border-color 0.35s ease;
}
.nav--scrolled {
  background: var(--nav-glass);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  border-bottom-color: var(--border);
}
.nav__inner {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 2rem;
  height: 64px;
}
.nav__links {
  display: flex;
  gap: 2.5rem;
}
.nav__links a {
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-2);
  transition: color 0.2s;
}
.nav__links a:hover,
.nav__links a.router-link-active { color: var(--text-1); }
.nav__brand {
  font-family: var(--font-brand);
  font-weight: 800;
  font-size: 1.35rem;
  color: var(--text-1);
  letter-spacing: 0.02em;
  text-align: center;
}
.nav__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}
.nav__theme {
  display: flex;
  align-items: center;
  color: var(--text-2);
  padding: 0.5rem;
  transition: color 0.2s;
}
.nav__theme:hover { color: var(--text-1); }
.nav__cart {
  position: relative;
  display: flex;
  align-items: center;
  color: var(--text-1);
  padding: 0.5rem;
  transition: color 0.2s;
}
.nav__cart:hover { color: var(--copper-light); transform: translateY(-1px); }
.nav__cart:active { transform: scale(0.94); }
.nav__theme:active, .nav__acct:active { transform: scale(0.94); }
.nav__badge {
  position: absolute;
  top: -5px; right: -8px;
  background: var(--grad-cool);
  color: #fff;
  font-size: 0.6rem;
  font-weight: 700;
  min-width: 17px;
  height: 17px;
  border-radius: var(--radius-pill);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  box-shadow: 0 2px 8px rgba(60,90,135,.4);
  animation: badge-pop 0.4s var(--ease-spring) both;
}
@keyframes badge-pop { 0% { transform: scale(0); } 100% { transform: scale(1); } }

/* ── ACCOUNT ── */
.nav__account { position: relative; display: flex; align-items: center; }
.nav__acct { position: relative; display: flex; align-items: center; color: var(--text-2); padding: 0.5rem; transition: color 0.2s; cursor: pointer; }
.nav__acct:hover { color: var(--text-1); }
.nav__acct-dot { position: absolute; top: 0; right: 0; width: 7px; height: 7px; background: var(--copper); border-radius: 50%; }
.nav__menu {
  position: absolute; top: calc(100% + 12px); right: 0; min-width: 210px;
  background: var(--surface-1); border: 1px solid var(--border-mid);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-hover);
  display: flex; flex-direction: column; padding: 0.5rem; z-index: 200;
  transform-origin: top right;
}
.nav__menu a, .nav__menu button {
  text-align: left; padding: 0.6rem 0.75rem; font-size: 0.82rem; color: var(--text-2);
  border-radius: var(--radius-sm); cursor: pointer; transition: background 0.18s var(--ease-out), color 0.18s var(--ease-out), transform 0.18s var(--ease-out);
}
.nav__menu a:hover, .nav__menu button:hover { background: var(--surface-2); color: var(--text-1); transform: translateX(2px); }
.nav__menu a:active, .nav__menu button:active { transform: scale(0.97); }
.nav__menu-email { padding: 0.55rem 0.75rem; font-size: 0.72rem; color: var(--text-3); border-bottom: 1px solid var(--border); margin-bottom: 0.35rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav__menu-admin, .nav__menu-cta { color: var(--accent-3) !important; font-weight: 600; }

/* ── HAMBURGER ── */
.nav__burger {
  display: none;
  flex-direction: column;
  gap: 5px;
  padding: 4px;
  cursor: pointer;
}
.nav__burger span {
  display: block;
  width: 22px;
  height: 1.5px;
  border-radius: var(--radius-pill);
  background: var(--text-1);
  transition: opacity 0.2s var(--ease-out), width 0.25s var(--ease-out), transform 0.25s var(--ease-out);
}
.nav__burger:hover span { opacity: 0.7; }
.nav__burger:hover span:nth-child(2) { width: 16px; }
.nav__burger:active { transform: scale(0.92); }

/* ── MOBILE MENU ── */
.fade-enter-active { transition: opacity 0.28s var(--ease-out), transform 0.34s var(--ease-spring); }
.fade-leave-active { transition: opacity 0.2s var(--ease-out), transform 0.2s var(--ease-out); }
.fade-enter-from,   .fade-leave-to     { opacity: 0; transform: translateY(-8px) scale(0.96); }

.mob-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 150;
  transform: none !important;   /* el fade no debe desplazar el overlay a pantalla completa */
}
.mob-menu {
  position: fixed;
  top: 0; left: 0; bottom: 0;
  width: min(300px, 85vw);
  background: var(--surface-1);
  border-right: 1px solid var(--border);
  border-top-right-radius: var(--radius-lg);
  border-bottom-right-radius: var(--radius-lg);
  z-index: 151;
  display: flex;
  flex-direction: column;
  transform: translateX(-100%);
  transition: transform 0.42s var(--ease-out);
  box-shadow: var(--shadow-hover);
}
.mob-menu--open { transform: translateX(0); }

.mob-menu__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.4rem 1.5rem;
  border-bottom: 1px solid var(--border);
}
.mob-menu__logo {
  font-family: var(--font-brand);
  font-weight: 800;
  font-size: 1.15rem;
  color: var(--text-1);
  letter-spacing: 0.02em;
}
.mob-menu__close {
  color: var(--text-2);
  display: flex;
  align-items: center;
  transition: color 0.2s;
}
.mob-menu__close:hover { color: var(--text-1); }

.mob-menu__links {
  display: flex;
  flex-direction: column;
  padding: 1.5rem;
  flex: 1;
}
.mob-menu__links a {
  font-size: 1.3rem;
  font-family: var(--font-display);
  font-weight: 300;
  color: var(--text-2);
  letter-spacing: -0.01em;
  padding: 1rem 0;
  border-bottom: 1px solid var(--border);
  transition: color 0.2s var(--ease-out), transform 0.2s var(--ease-out), padding-left 0.2s var(--ease-out);
}
.mob-menu__links a:last-child { border-bottom: none; }
.mob-menu__links a:hover,
.mob-menu__links a.router-link-active { color: var(--text-1); padding-left: 0.4rem; }

.mob-menu__account {
  display: flex; flex-direction: column; gap: 0.1rem;
  padding: 1rem 1.5rem; border-top: 1px solid var(--border);
}
.mob-account__email { font-size: 0.74rem; color: var(--text-3); margin-bottom: 0.4rem; overflow: hidden; text-overflow: ellipsis; }
.mob-menu__account a, .mob-menu__account button { text-align: left; padding: 0.65rem 0; font-size: 0.95rem; color: var(--text-2); cursor: pointer; transition: color 0.2s var(--ease-out); }
.mob-account__admin { color: var(--accent-3); font-weight: 600; }
.mob-account__out { color: var(--danger); }
.mob-account__cta {
  margin-top: 0.5rem;
  text-align: center !important;
  padding: 0.7rem 1rem !important;
  background: var(--grad-cool);
  color: #fff !important;
  font-weight: 700;
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-soft);
  transition: transform 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out);
}
.mob-account__cta:hover { transform: translateY(-2px); box-shadow: var(--shadow-hover); }
.mob-account__cta:active { transform: scale(0.97); }

.mob-menu__theme {
  padding: 1.5rem;
  border-top: 1px solid var(--border);
}
.mob-theme-btn {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-2);
  cursor: pointer;
  transition: color 0.2s;
}
.mob-theme-btn:hover { color: var(--text-1); }

/* ── RESPONSIVE ── */
@media (max-width: 768px) {
  .nav__links  { display: none; }
  .nav__burger { display: flex; }
  .nav__inner  { grid-template-columns: auto 1fr auto; }
  .nav__brand  { font-size: 1.05rem; text-align: center; }
}
</style>
