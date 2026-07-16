<script setup>
// ─── WIDGET PÚBLICO DE RECLAMOS / SOPORTE ────────────────────────────────────
// Botón flotante SIEMPRE visible (abajo-IZQUIERDA; la derecha la usa el toast) +
// modal con formulario. Envía el reclamo a la Edge Function `create-ticket` vía
// enviarReclamo() y muestra el N.° de ticket al éxito.
import { ref, reactive, computed } from 'vue'
import { useModalUX } from '../lib/useModal.js'
import { validarEmail, validarTelefonoPE, validarTexto } from '../lib/validation.js'
import { CATEGORIAS } from '../lib/reclamos.js'
import { enviarReclamo } from '../lib/soporte.js'

// ── Estado del modal ──
const abierto = ref(false)
useModalUX(abierto, () => cerrar())

// ── Formulario ──
const form = reactive({
  nombre: '',
  email: '',
  telefono: '',
  pedido: '',
  categoria: CATEGORIAS[0],
  mensaje: '',
})
const tocado = reactive({})

// ── Envío / resultado ──
const enviando = ref(false)
const enviado = ref(false)          // muestra la pantalla de confirmación
const ticketNumber = ref('')
const errorEnvio = ref(null)

// ── Validación (mismo patrón que CheckoutPage) ──
const errores = computed(() => {
  const e = {}
  if (!validarTexto(form.nombre, 2)) e.nombre = 'Ingresa tu nombre.'
  if (!validarEmail(form.email)) e.email = 'Correo electrónico inválido.'
  // Teléfono opcional: solo valida si el usuario escribió algo.
  if (form.telefono.trim() && !validarTelefonoPE(form.telefono)) e.telefono = 'Celular: 9 dígitos, empieza con 9.'
  // N.° de pedido opcional: sin validación de formato.
  if (!validarTexto(form.mensaje, 10)) e.mensaje = 'Cuéntanos qué pasó (mínimo 10 caracteres).'
  return e
})
function marcar(campo) { tocado[campo] = true }
function errorDe(campo) { return tocado[campo] ? errores.value[campo] : null }
const formValido = computed(() => Object.keys(errores.value).length === 0)

// ── Apertura / cierre ──
function abrir() {
  errorEnvio.value = null
  abierto.value = true
}
function cerrar() {
  abierto.value = false
  // Si se cerró tras un envío exitoso, resetea todo para la próxima vez.
  if (enviado.value) resetear()
}
function resetear() {
  Object.assign(form, { nombre: '', email: '', telefono: '', pedido: '', categoria: CATEGORIAS[0], mensaje: '' })
  Object.keys(tocado).forEach((k) => { delete tocado[k] })
  enviado.value = false
  ticketNumber.value = ''
  errorEnvio.value = null
}

// ── Envío ──
async function enviar() {
  if (enviando.value) return
  errorEnvio.value = null
  // Marca todos los campos como tocados para mostrar errores pendientes.
  ;['nombre', 'email', 'telefono', 'mensaje'].forEach((c) => { tocado[c] = true })
  if (!formValido.value) return

  enviando.value = true
  try {
    const payload = {
      nombre: form.nombre.trim(),
      email: form.email.trim(),
      telefono: form.telefono.trim() || null,
      pedido: form.pedido.trim() || null,
      categoria: form.categoria,
      mensaje: form.mensaje.trim(),
    }
    const res = await enviarReclamo(payload)
    ticketNumber.value = res?.ticket_number ?? ''
    enviado.value = true
  } catch (err) {
    errorEnvio.value = err?.message || 'No pudimos enviar tu reclamo. Inténtalo de nuevo.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <!-- Botón flotante SIEMPRE visible (abajo-izquierda) -->
  <button class="soporte-fab" aria-label="Abrir formulario de reclamos" @click="abrir">
    <svg class="soporte-fab__ico" width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
    </svg>
    <span class="soporte-fab__txt">¿Ayuda?</span>
  </button>

  <Teleport to="body">
    <Transition name="fade">
      <div v-if="abierto" class="overlay" @click="cerrar" aria-hidden="true"></div>
    </Transition>

    <Transition name="fade">
      <div v-if="abierto" class="sp" role="dialog" aria-modal="true" aria-label="Formulario de reclamos">
        <!-- Cerrar -->
        <button class="sp__close" @click="cerrar" aria-label="Cerrar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <!-- ░░ CONFIRMACIÓN ░░ -->
        <div v-if="enviado" class="sp__done" role="status" aria-live="polite">
          <svg class="sp__done-ico" width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/>
          </svg>
          <h2 class="sp__done-title">¡Reclamo enviado!</h2>
          <p v-if="ticketNumber" class="sp__done-num">N.° de ticket: <strong>{{ ticketNumber }}</strong></p>
          <p class="sp__done-msg">Te enviamos una copia a tu correo. Te responderemos pronto.</p>
          <button type="button" class="sp__submit sp__submit--ready" @click="cerrar">Cerrar</button>
        </div>

        <!-- ░░ FORMULARIO ░░ -->
        <div v-else class="sp__body">
          <p class="sp__eyebrow">Soporte · Reclamos</p>
          <h2 class="sp__title">¿Tienes un problema con tu compra?</h2>
          <p class="sp__sub">Cuéntanos qué pasó y te ayudamos. Te responderemos por correo.</p>

          <form class="sp__form" novalidate @submit.prevent="enviar">
            <div class="form__group">
              <label class="field__label" for="sp-nombre">Nombre</label>
              <input id="sp-nombre" v-model="form.nombre" type="text" class="field__input"
                :class="{ 'field__input--err': errorDe('nombre') }" autocomplete="name"
                @blur="marcar('nombre')" />
              <span v-if="errorDe('nombre')" class="field__error" role="alert">{{ errores.nombre }}</span>
            </div>

            <div class="form__group">
              <label class="field__label" for="sp-email">Correo electrónico</label>
              <input id="sp-email" v-model="form.email" type="email" class="field__input"
                :class="{ 'field__input--err': errorDe('email') }" autocomplete="email"
                @blur="marcar('email')" />
              <span v-if="errorDe('email')" class="field__error" role="alert">{{ errores.email }}</span>
            </div>

            <div class="form__row">
              <div class="form__group">
                <label class="field__label" for="sp-tel">Celular <span class="opt">(opcional)</span></label>
                <input id="sp-tel" v-model="form.telefono" type="tel" inputmode="numeric" maxlength="12"
                  class="field__input" :class="{ 'field__input--err': errorDe('telefono') }"
                  placeholder="9XX XXX XXX" autocomplete="tel" @blur="marcar('telefono')" />
                <span v-if="errorDe('telefono')" class="field__error" role="alert">{{ errores.telefono }}</span>
              </div>
              <div class="form__group">
                <label class="field__label" for="sp-pedido">N.° de pedido <span class="opt">(opcional)</span></label>
                <input id="sp-pedido" v-model="form.pedido" type="text" class="field__input"
                  placeholder="HB-000000" autocomplete="off" />
              </div>
            </div>

            <div class="form__group">
              <label class="field__label" for="sp-cat">Categoría</label>
              <select id="sp-cat" v-model="form.categoria" class="field__input field__select">
                <option v-for="c in CATEGORIAS" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>

            <div class="form__group">
              <label class="field__label" for="sp-msg">Mensaje</label>
              <textarea id="sp-msg" v-model="form.mensaje" class="field__input field__textarea" rows="4"
                maxlength="2000" :class="{ 'field__input--err': errorDe('mensaje') }"
                placeholder="Describe tu problema con el mayor detalle posible…" @blur="marcar('mensaje')"></textarea>
              <span v-if="errorDe('mensaje')" class="field__error" role="alert">{{ errores.mensaje }}</span>
            </div>

            <p v-if="errorEnvio" class="sp__err" role="alert">{{ errorEnvio }}</p>

            <button type="submit" class="sp__submit"
              :class="{ 'sp__submit--ready': formValido }"
              :disabled="enviando" :aria-busy="enviando">
              <span v-if="enviando" class="spinner" aria-hidden="true"></span>
              <template v-if="enviando">Enviando…</template>
              <template v-else>Enviar reclamo</template>
            </button>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ── BOTÓN FLOTANTE (abajo-izquierda; la derecha la usa el toast) ── */
.soporte-fab {
  position: fixed;
  left: 1.25rem;
  bottom: 1.25rem;
  z-index: 450;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem 1.1rem;
  background: var(--accent);
  color: var(--on-accent);
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-hover);
  font-family: var(--font-display);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 0.25s var(--ease-spring), background 0.25s var(--ease-out), box-shadow 0.25s var(--ease-out);
}
.soporte-fab:hover { background: var(--accent-deep); transform: translateY(-2px); box-shadow: 0 12px 30px var(--glow-color); }
.soporte-fab:active { transform: scale(0.96); }
.soporte-fab__ico { flex-shrink: 0; }
.soporte-fab__txt { white-space: nowrap; }

/* ── OVERLAY + PANEL (overlay 450 / panel 451) ── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease, transform 0.3s var(--ease-out); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.sp.fade-enter-from, .sp.fade-leave-to { transform: translate(-50%, -48%) scale(0.96); }

.overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 450;
}
.sp {
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: min(520px, 96vw);
  max-height: 90svh;
  background: var(--surface-1);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-hover);
  z-index: 451;
  overflow: hidden auto;
}
.sp__close {
  position: absolute;
  top: 0.9rem; right: 0.9rem;
  width: 2.1rem; height: 2.1rem;
  display: grid; place-items: center;
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-pill);
  cursor: pointer;
  z-index: 2;
  transition: color 0.2s var(--ease-out), background 0.2s var(--ease-out), transform 0.25s var(--ease-spring);
}
.sp__close:hover { color: var(--text-1); background: var(--surface-3); transform: rotate(90deg); }
.sp__close:active { transform: scale(0.9); }

/* ── CUERPO / FORM ── */
.sp__body { padding: 2rem 1.6rem 1.6rem; }
.sp__eyebrow { font-size: 0.64rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--accent-3); }
.sp__title { font-family: var(--font-display); font-size: 1.35rem; font-weight: 800; letter-spacing: -0.01em; color: var(--text-1); line-height: 1.2; margin: 0.35rem 0 0.4rem; padding-right: 2rem; }
.sp__sub { font-size: 0.84rem; color: var(--text-2); line-height: 1.5; margin-bottom: 1.2rem; }
.sp__form { display: flex; flex-direction: column; gap: 1rem; }

/* Campos (copiados de CheckoutPage; usan los tokens globales) */
.form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.form__group { display: flex; flex-direction: column; gap: 0.4rem; }
.field__label { font-size: 0.68rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-2); font-weight: 600; }
.opt { color: var(--text-3); font-weight: 400; letter-spacing: 0.02em; text-transform: none; }
.field__input {
  background: var(--surface-2); border: 1px solid var(--border-mid); border-radius: var(--radius-sm);
  color: var(--text-1); font-family: var(--font-body); font-size: 0.95rem; padding: 0.75rem 0.85rem;
  outline: none; transition: border-color 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out); width: 100%;
}
.field__input::placeholder { color: var(--text-3); }
.field__input:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--glow-color); }
.field__input--err { border-color: var(--danger); }
.field__textarea { resize: vertical; line-height: 1.5; border-radius: var(--radius-md); }
.field__select { cursor: pointer; appearance: none; -webkit-appearance: none; }
.field__error { font-size: 0.74rem; color: var(--danger); }

.sp__err { font-size: 0.78rem; color: var(--danger); line-height: 1.5; }

/* Botón enviar (mismo patrón que checkout__submit) */
.sp__submit {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.55rem; width: 100%; padding: 1rem; margin-top: 0.2rem;
  background: var(--surface-3); color: var(--text-3); border: 1px solid var(--border-mid); border-radius: 4px;
  font-family: var(--font-display); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; cursor: pointer;
  transition: background-color 0.25s var(--ease-out), border-color 0.25s var(--ease-out), color 0.25s var(--ease-out), opacity 0.2s var(--ease-out);
}
.sp__submit--ready { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.sp__submit--ready:hover { background: var(--accent-deep); border-color: var(--accent-deep); }
.sp__submit--ready:active { transform: translateY(1px); }
.sp__submit:disabled { opacity: 0.6; cursor: not-allowed; }

/* ── CONFIRMACIÓN ── */
.sp__done { padding: 3rem 1.6rem 2rem; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 0.9rem; }
.sp__done-ico { color: var(--accent-2); background: var(--surface-2); border-radius: var(--radius-pill); padding: 0.9rem; box-shadow: var(--shadow-soft); }
.sp__done-title { font-family: var(--font-display); font-size: 1.5rem; font-weight: 800; text-transform: uppercase; letter-spacing: -0.01em; color: var(--text-1); }
.sp__done-num { font-size: 0.9rem; color: var(--text-2); letter-spacing: 0.04em; }
.sp__done-msg { font-size: 0.88rem; color: var(--text-2); line-height: 1.6; }
.sp__done .sp__submit { max-width: 220px; margin-top: 0.6rem; }

.spinner { width: 15px; height: 15px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 1.6s; } }

/* ── MÓVIL ── */
@media (max-width: 560px) {
  .form__row { grid-template-columns: 1fr; }
  .soporte-fab { left: 1rem; bottom: 1rem; padding: 0.65rem 0.95rem; }
  .sp__body { padding: 1.6rem 1.25rem 1.25rem; }
  .sp__title { font-size: 1.2rem; }
}
</style>
