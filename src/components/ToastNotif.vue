<script setup>
defineProps({
  toast: { type: Object, default: null }, // { name, size, color, image }
})
const emit = defineEmits(['close'])
</script>

<template>
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="toast" class="toast" role="status" aria-live="polite">
        <div class="toast__img">
          <img v-if="toast.image" :src="toast.image" :alt="toast.name" />
          <div v-else class="toast__img-ph">H</div>
        </div>
        <div class="toast__info">
          <p class="toast__label">Añadido al carrito</p>
          <p class="toast__name">{{ toast.name }} &nbsp;·&nbsp; Talla {{ toast.size }}<template v-if="toast.color"> · {{ toast.color }}</template></p>
        </div>
        <button class="toast__close" @click="emit('close')" aria-label="Cerrar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast-enter-active { transition: opacity 0.3s var(--ease-out), transform 0.45s var(--ease-spring); }
.toast-leave-active { transition: opacity 0.25s var(--ease-out), transform 0.25s var(--ease-out); }
.toast-enter-from { opacity: 0; transform: translateX(120%) scale(0.92); }
.toast-leave-to   { opacity: 0; transform: translateX(120%); }

.toast {
  position: fixed;
  bottom: 1.75rem;
  right: 1.75rem;
  z-index: 500;
  display: flex;
  align-items: center;
  gap: 0.85rem;
  background: var(--surface-2);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-hover);
  padding: 0.85rem 1rem;
  max-width: 300px;
  width: 100%;
}

.toast__img {
  width: 48px;
  height: 64px;
  flex-shrink: 0;
  background: var(--surface-3);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.toast__img img { width: 100%; height: 100%; object-fit: cover; }
.toast__img-ph {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  font-family: var(--font-display);
  font-size: 1rem;
  color: var(--text-3);
}
.toast__info { flex: 1; min-width: 0; }
.toast__label {
  font-size: 0.65rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--accent-2);
  margin-bottom: 0.3rem;
}
.toast__name {
  font-size: 0.8rem;
  color: var(--text-1);
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.toast__close {
  color: var(--text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-pill);
  transition: color 0.2s var(--ease-out), background 0.2s var(--ease-out), transform 0.2s var(--ease-out);
}
.toast__close:hover { color: var(--text-1); background: var(--surface-3); }
.toast__close:active { transform: scale(0.9); }

@media (max-width: 480px) {
  .toast { right: 1rem; bottom: 1rem; max-width: calc(100vw - 2rem); }
}
</style>
