<script setup>
// ─── Pop-up de error del admin (qué pasó + cómo arreglarlo) ─────────────────
import { ref, computed } from 'vue'
import { explicarError } from '../lib/adminErrors.js'
import { useModalUX } from '../lib/useModal.js'

const props = defineProps({
  open:  { type: Boolean, default: false },
  error: { type: [String, Object], default: '' },
})
const emit = defineEmits(['close'])

const info = computed(() => explicarError(props.error))

// UX de modal: Escape + bloqueo de scroll + gestión de foco (entra al abrir,
// atrapa Tab, y devuelve el foco al cerrar).
const emPanel = ref(null)
useModalUX(() => props.open, () => emit('close'), emPanel)
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="em__overlay" @click.self="emit('close')">
        <div ref="emPanel" class="em" role="alertdialog" aria-modal="true" aria-label="Error">
          <div class="em__head">
            <span class="em__icon" aria-hidden="true">⚠️</span>
            <h3 class="em__title">{{ info.titulo }}</h3>
            <button class="em__x" @click="emit('close')" aria-label="Cerrar">✕</button>
          </div>
          <div class="em__body">
            <div class="em__block">
              <span class="em__label">Qué pasó</span>
              <p class="em__text">{{ info.causa }}</p>
            </div>
            <div class="em__block em__block--fix">
              <span class="em__label">Cómo arreglarlo</span>
              <p class="em__text">{{ info.solucion }}</p>
            </div>
            <details v-if="info.detalle" class="em__details">
              <summary>Detalle técnico</summary>
              <code class="em__code">{{ info.detalle }}</code>
            </details>
          </div>
          <div class="em__foot">
            <button class="em__btn" @click="emit('close')">Entendido</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.em__overlay {
  position: fixed; inset: 0; z-index: 800;
  background: rgba(0,0,0,0.6); backdrop-filter: blur(3px);
  display: grid; place-items: center; padding: 1rem;
}
.em {
  width: 100%; max-width: 460px;
  background: var(--card-bg); border: 1px solid var(--border-mid);
  border-radius: 14px; box-shadow: var(--shadow-hover); overflow: hidden;
  animation: em-pop 0.25s var(--ease-spring) both;
}
@keyframes em-pop { from { opacity: 0; transform: translateY(10px) scale(0.97); } to { opacity: 1; transform: none; } }
.em__head {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 1rem 1.2rem; border-bottom: 1px solid var(--border);
}
.em__icon { font-size: 1.1rem; }
.em__title { flex: 1; font-family: var(--font-display); font-weight: 800; font-size: 1rem; color: var(--text-1); }
.em__x { width: 44px; height: 44px; display: grid; place-items: center; background: transparent; border: none; font-size: 1.05rem; color: var(--text-3); cursor: pointer; }
.em__x:hover { color: var(--text-1); }
.em__body { padding: 1.1rem 1.2rem; display: flex; flex-direction: column; gap: 0.9rem; }
.em__block { display: flex; flex-direction: column; gap: 0.25rem; }
.em__label { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-3); font-weight: 700; }
.em__text { font-size: 0.9rem; color: var(--text-1); line-height: 1.5; }
.em__block--fix { background: var(--surface-2); border: 1px solid var(--border-mid); border-left: 4px solid var(--accent); border-radius: var(--radius-sm); padding: 0.7rem 0.85rem; }
.em__details { font-size: 0.78rem; color: var(--text-3); }
.em__details summary { cursor: pointer; color: var(--text-2); }
.em__code { display: block; margin-top: 0.5rem; padding: 0.6rem 0.7rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.72rem; color: var(--text-2); white-space: pre-wrap; word-break: break-word; }
.em__foot { display: flex; justify-content: flex-end; padding: 0.9rem 1.2rem; border-top: 1px solid var(--border); }
.em__btn {
  padding: 0.55rem 1.3rem; font-size: 0.8rem; font-weight: 700;
  background: var(--accent); border: 1px solid var(--accent); color: var(--on-accent);
  border-radius: 6px; cursor: pointer;
}
.em__btn:hover { filter: brightness(1.08); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
