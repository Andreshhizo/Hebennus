<script setup>
import { useModalUX } from '../lib/useModal.js'
const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close'])
useModalUX(() => props.open, () => emit('close'))
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="overlay" @click="emit('close')" aria-hidden="true"></div>
    </Transition>
    <Transition name="slide-up">
      <div v-if="open" class="modal" role="dialog" aria-modal="true" aria-label="Guía de tallas">
        <div class="modal__head">
          <span class="modal__title">Guía de tallas</span>
          <button class="modal__close" @click="emit('close')" aria-label="Cerrar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="modal__body">
          <p class="modal__intro">
            Medidas aproximadas en centímetros. Para fit más holgado sube una talla.
          </p>

          <table class="guide">
            <thead>
              <tr>
                <th>Talla</th>
                <th>Pecho</th>
                <th>Largo</th>
                <th>Hombro</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>XS</td><td>88 – 92</td><td>66</td><td>40</td></tr>
              <tr><td>S</td><td>92 – 96</td><td>68</td><td>42</td></tr>
              <tr><td>M</td><td>96 – 100</td><td>70</td><td>44</td></tr>
              <tr><td>L</td><td>100 – 106</td><td>72</td><td>46</td></tr>
              <tr><td>XL</td><td>106 – 112</td><td>74</td><td>48</td></tr>
              <tr><td>XXL</td><td>112 – 118</td><td>76</td><td>50</td></tr>
              <tr><td>Única</td><td>96 – 108</td><td>70</td><td>44</td></tr>
            </tbody>
          </table>

          <div class="modal__tips">
            <p><strong>Oversize:</strong> el corte es naturalmente amplio — elige tu talla habitual.</p>
            <p><strong>Compresión:</strong> el tejido se adapta al cuerpo — elige tu talla habitual.</p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.slide-up-enter-active { transition: opacity 0.32s var(--ease-out), transform 0.4s var(--ease-spring); }
.slide-up-leave-active { transition: opacity 0.2s var(--ease-out), transform 0.2s var(--ease-out); }
.slide-up-enter-from { opacity: 0; transform: translate(-50%, -50%) scale(0.94); }
.slide-up-leave-to   { opacity: 0; transform: translate(-50%, -50%) scale(0.97); }

.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.65);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  z-index: 300;
}
.modal {
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: min(520px, 94vw);
  background: var(--surface-2);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-hover);
  z-index: 301;
  display: flex;
  flex-direction: column;
  max-height: 90svh;
  overflow: hidden auto;
}
.modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.4rem 1.6rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.modal__title {
  font-size: 0.72rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-2);
  font-family: var(--font-display);
  font-weight: 500;
}
.modal__close {
  color: var(--text-2);
  display: flex;
  align-items: center;
  transition: color 0.2s;
}
.modal__close:hover { color: var(--text-1); }

.modal__body { padding: 1.8rem 1.6rem; }
.modal__intro {
  font-size: 0.85rem;
  color: var(--text-2);
  line-height: 1.7;
  margin-bottom: 1.5rem;
}

.guide {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.83rem;
}
.guide th, .guide td {
  padding: 0.7rem 0.9rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.guide th {
  font-size: 0.67rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-3);
  font-weight: 500;
}
.guide td { color: var(--text-1); transition: background 0.2s var(--ease-out); }
.guide tbody tr { transition: background 0.2s var(--ease-out); }
.guide tbody tr:hover td { background: var(--surface-3); }
.guide tbody tr:first-child td:first-child { border-top-left-radius: var(--radius-sm); }
.guide tbody tr:first-child td:last-child { border-top-right-radius: var(--radius-sm); }
.guide tbody tr:last-child td:first-child { border-bottom-left-radius: var(--radius-sm); }
.guide tbody tr:last-child td:last-child { border-bottom-right-radius: var(--radius-sm); }
.guide tr:last-child td { border-bottom: none; }
.guide td:first-child { font-weight: 600; color: var(--accent-2); }

.modal__tips {
  margin-top: 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.modal__tips p {
  font-size: 0.8rem;
  color: var(--text-2);
  line-height: 1.6;
}
.modal__tips strong { color: var(--text-1); }
</style>
