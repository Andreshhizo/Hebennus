<script setup>
import { computed } from 'vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  open:  { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'remove', 'update-qty', 'clear-all', 'go-checkout'])

const total = computed(() =>
  props.items.reduce((sum, item) => sum + Number(item.price) * (item.qty ?? 1), 0)
)
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="overlay" @click="emit('close')" aria-hidden="true"></div>
    </Transition>

    <div
      class="drawer"
      :class="{ 'drawer--open': open }"
      role="dialog"
      aria-modal="true"
      aria-label="Carrito de compras"
    >
      <!-- Head -->
      <div class="drawer__head">
        <span class="drawer__title">Carrito</span>
        <button
          v-if="items.length"
          class="drawer__clear"
          @click="emit('clear-all')"
          aria-label="Vaciar carrito"
        >Vaciar todo</button>
        <button class="drawer__close" @click="emit('close')" aria-label="Cerrar carrito">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Empty -->
      <div v-if="!items.length" class="drawer__empty">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 0 1-8 0"/>
        </svg>
        <p>Tu carrito está vacío</p>
        <button class="drawer__back" @click="emit('close')">Seguir viendo</button>
      </div>

      <!-- Items -->
      <ul v-else class="drawer__list">
        <li v-for="(item, idx) in items" :key="`${item.productId}-${item.size}-${item.color ?? ''}`" class="drawer__item">
          <div class="drawer__item-img">
            <img v-if="item.image" :src="item.image" :alt="item.name" />
            <div v-else class="drawer__item-placeholder">H</div>
          </div>
          <div class="drawer__item-info">
            <p class="drawer__item-name">{{ item.name }}</p>
            <p class="drawer__item-meta">Talla {{ item.size }}<template v-if="item.color"> · {{ item.color }}</template></p>
            <p class="drawer__item-price">S/ {{ (Number(item.price) * (item.qty ?? 1)).toFixed(2) }}</p>
          </div>
          <div class="drawer__item-qty">
            <button
              class="qty-btn"
              @click="emit('update-qty', idx, -1)"
              :aria-label="`Quitar uno de ${item.name}`"
            >−</button>
            <span class="qty-num">{{ item.qty ?? 1 }}</span>
            <button
              class="qty-btn"
              @click="emit('update-qty', idx, 1)"
              :aria-label="`Agregar uno de ${item.name}`"
            >+</button>
          </div>
        </li>
      </ul>

      <!-- Footer -->
      <div v-if="items.length" class="drawer__foot">
        <div class="drawer__total">
          <span>Total del pedido</span>
          <span class="drawer__total-amt">S/ {{ total.toFixed(2) }}</span>
        </div>
        <button class="drawer__cta" @click="emit('go-checkout')">
          Continuar al pago
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
        <p class="drawer__note">Completarás tus datos de envío en el siguiente paso.</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.35s var(--ease-out); }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
  z-index: 200;
}
.drawer {
  position: fixed;
  top: 0; right: 0; bottom: 0;
  width: min(420px, 100vw);
  background: var(--surface-1);
  border-left: 1px solid var(--border);
  border-top-left-radius: var(--radius-lg);
  border-bottom-left-radius: var(--radius-lg);
  box-shadow: var(--shadow-hover);
  z-index: 201;
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform 0.46s var(--ease-out);
}
.drawer--open { transform: translateX(0); }

.drawer__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.5rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.drawer__title {
  font-size: 0.72rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-2);
  font-family: var(--font-display);
  font-weight: 500;
}
.drawer__clear {
  margin-left: auto;
  font-size: 0.68rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-3);
  padding-bottom: 1px;
  border-bottom: 1px solid currentColor;
  transition: color 0.2s;
  margin-right: 1rem;
}
.drawer__clear:hover { color: var(--text-1); }
.drawer__close {
  color: var(--text-2);
  display: flex;
  align-items: center;
  transition: color 0.2s;
}
.drawer__close:hover { color: var(--text-1); }

.drawer__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.2rem;
  color: var(--text-3);
  padding: 2rem;
  text-align: center;
}
.drawer__empty p { font-size: 0.9rem; color: var(--text-2); }
.drawer__back {
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-2);
  padding: 0.6rem 1.4rem;
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-pill);
  transition: color 0.2s var(--ease-out), border-color 0.2s var(--ease-out), transform 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out);
}
.drawer__back:hover { color: var(--text-1); border-color: var(--accent); transform: translateY(-2px); box-shadow: var(--shadow-soft); }
.drawer__back:active { transform: scale(0.97); }

.drawer__list {
  flex: 1;
  overflow-y: auto;
  list-style: none;
  padding: 1.2rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}
.drawer__item {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding: 0.6rem;
  margin: -0.6rem;
  border-radius: var(--radius-md);
  transition: background 0.25s var(--ease-out);
  animation: drawer-item-in 0.4s var(--ease-out) both;
}
.drawer__item:hover { background: var(--surface-2); }
@keyframes drawer-item-in { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: none; } }
.drawer__item-img {
  width: 68px; height: 90px;
  flex-shrink: 0;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.drawer__item-img img { width: 100%; height: 100%; object-fit: cover; }
.drawer__item-placeholder {
  width: 100%; height: 100%;
  display: grid;
  place-items: center;
  font-family: var(--font-display);
  font-size: 1.1rem;
  color: var(--text-3);
}
.drawer__item-info { flex: 1; display: flex; flex-direction: column; gap: 0.25rem; }
.drawer__item-name { font-size: 0.88rem; font-weight: 500; color: var(--text-1); line-height: 1.3; }
.drawer__item-meta { font-size: 0.75rem; color: var(--text-3); letter-spacing: 0.06em; }
.drawer__item-price { font-size: 0.85rem; color: var(--text-1); font-weight: 600; margin-top: 0.2rem; }

.drawer__item-qty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
}
.qty-btn {
  width: 27px; height: 27px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-2);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  transition: border-color 0.2s var(--ease-out), color 0.2s var(--ease-out), background 0.2s var(--ease-out), transform 0.2s var(--ease-spring);
}
.qty-btn:hover { border-color: var(--accent); color: var(--text-1); background: var(--surface-2); transform: scale(1.12); }
.qty-btn:active { transform: scale(0.9); }
.qty-num { font-size: 0.85rem; font-weight: 500; color: var(--text-1); min-width: 1.2rem; text-align: center; }

/* ── FOOT ── */
.drawer__foot {
  padding: 1.2rem 1.5rem 1.5rem;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 1rem;
  flex-shrink: 0;
}
.drawer__total { display: flex; justify-content: space-between; align-items: baseline; }
.drawer__total span:first-child {
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-2);
}
.drawer__total-amt { font-family: var(--font-display); font-size: 1.25rem; font-weight: 600; color: var(--text-1); }
.drawer__cta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  padding: 1rem;
  background: var(--grad-cool);
  background-size: 160% 160%;
  color: #fff;
  border-radius: var(--radius-md);
  font-family: var(--font-display);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  box-shadow: var(--shadow-soft);
  transition: transform 0.25s var(--ease-out), box-shadow 0.25s var(--ease-out), background-position 0.5s var(--ease-out);
}
.drawer__cta:hover { transform: translateY(-2px); box-shadow: var(--shadow-hover); background-position: 100% 0; }
.drawer__cta:hover svg { transform: translateX(3px); }
.drawer__cta svg { transition: transform 0.25s var(--ease-out); }
.drawer__cta:active { transform: scale(0.97); }
.drawer__note { text-align: center; font-size: 0.7rem; color: var(--text-3); letter-spacing: 0.04em; }
</style>
