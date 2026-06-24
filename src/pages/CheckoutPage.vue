<script setup>
import { ref, reactive, computed, inject, watchEffect, onMounted, onUnmounted, nextTick } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { createOrder } from '../lib/order.js'
import { useAuth } from '../lib/useAuth.js'
import { loadIzipaySdk, generateIzipayToken } from '../lib/izipay.js'
import { ENVIO_GRATIS_DESDE, COSTO_ENVIO, IZIPAY_ENABLED, IZIPAY_MERCHANT_CODE, IZIPAY_PUBLIC_KEY } from '../lib/config.js'

const router    = useRouter()
const cart      = inject('cart', ref([]))
const clearCart = inject('clearCart', () => {})
const { user, signUp } = useAuth()

const NOTES_MAX = 400
const WELCOME_PCT = 0.10   // 10% de bienvenida al crear cuenta

// ── Cuenta + consentimiento ──
const crearCuenta  = ref(false)   // checkbox "crear cuenta y 10%"
const password     = ref('')      // contraseña (solo si crea cuenta)
const aceptaPromos = ref(false)   // consentimiento marketing (Ley 29733)

const form = reactive({
  customer_name:  '',
  customer_phone: '',
  customer_email: '',
  document:       '',   // DNI (requerido solo si Izipay está activo)
  notes:          '',
})

const tocado     = reactive({})
const enviando   = ref(false)
const enviado    = ref(false)
const errorEnvio = ref(null)
const orderNumber = ref('')

// ── Pago (Izipay) ──
const izipayActivo = IZIPAY_ENABLED
const pagando      = ref(false)   // cargando token + SDK
const mostrarPago  = ref(false)   // formulario embebido visible
const errorPago    = ref(null)

// ── Totales ──
const subtotal = computed(() => cart.value.reduce((s, i) => s + Number(i.price) * (i.qty ?? 1), 0))
const envioGratis = computed(() => subtotal.value >= ENVIO_GRATIS_DESDE)
const envio = computed(() => (envioGratis.value || subtotal.value === 0 ? 0 : COSTO_ENVIO))
// El 10% se muestra solo si NO está logueado y marcó "crear cuenta".
// El SERVIDOR revalida (cuenta nueva, 1ª compra) — el cliente solo previsualiza.
const aplicaDescuento = computed(() => !user.value && crearCuenta.value)
const descuento = computed(() => aplicaDescuento.value ? Math.round(subtotal.value * WELCOME_PCT * 100) / 100 : 0)
const total = computed(() => Math.max(0, subtotal.value + envio.value - descuento.value))
const vacio = computed(() => !cart.value.length)
const faltaEnvioGratis = computed(() => Math.max(0, ENVIO_GRATIS_DESDE - subtotal.value))

// ── Prellenar datos si el cliente ya inició sesión ──
watchEffect(() => {
  if (!user.value) return
  const md = user.value.user_metadata || {}
  if (!form.customer_email) form.customer_email = user.value.email || ''
  if (!form.customer_name)  form.customer_name  = md.full_name || md.name || ''
  if (!form.customer_phone) form.customer_phone = md.phone || ''
  crearCuenta.value = false // ya tiene cuenta
})

// ── Carrito vacío → redirige a la colección (sin pisar la pantalla de éxito) ──
watchEffect(() => {
  if (!enviado.value && cart.value.length === 0) router.replace('/coleccion')
})

// ── Validación en tiempo real ──
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const errores = computed(() => {
  const e = {}
  if (form.customer_name.trim().length < 3) e.customer_name = 'Ingresa tu nombre completo.'
  const tel = form.customer_phone.replace(/\D/g, '')
  if (!/^9\d{8}$/.test(tel)) e.customer_phone = 'Celular inválido: 9 dígitos, empieza con 9.'
  if (!EMAIL_RE.test(form.customer_email.trim())) e.customer_email = 'Correo electrónico inválido.'
  if (izipayActivo && !/^\d{8}$/.test(form.document.trim())) e.document = 'DNI inválido (8 dígitos).'
  if (crearCuenta.value && !user.value && password.value.length < 6) e.password = 'Mínimo 6 caracteres.'
  if (form.notes.trim().length < 6) e.notes = 'Ingresa tu dirección de entrega.'
  return e
})
const valido = computed(() => Object.keys(errores.value).length === 0)

function marcar(campo) { tocado[campo] = true }
function errorDe(campo) { return tocado[campo] ? errores.value[campo] : null }

// ── Resumen colapsable en móvil / sticky en desktop ──
const esDesktop = ref(false)
const resumenAbierto = ref(false)
let mq = null
function onMq(e) { esDesktop.value = e.matches }
onMounted(() => {
  mq = window.matchMedia('(min-width: 861px)')
  esDesktop.value = mq.matches
  mq.addEventListener('change', onMq)
})
onUnmounted(() => mq?.removeEventListener('change', onMq))
const itemsVisibles = computed(() => esDesktop.value || resumenAbierto.value)

// ── Payload del pedido ──
function construirPedido() {
  return {
    cliente: {
      customer_name:  form.customer_name.trim(),
      customer_phone: form.customer_phone.replace(/\D/g, ''),
      customer_email: form.customer_email.trim(),
      document:       form.document.trim(),                          // compat Izipay
      doc_tipo:       form.document.trim() ? 'DNI' : null,           // para la boleta
      doc_numero:     form.document.trim() || null,
      notes:          form.notes.trim().slice(0, NOTES_MAX),
    },
    items: cart.value.map(i => ({
      product_id: i.productId ?? null,
      name:       i.name,
      size:       i.size,
      color:      i.color ?? null,
      qty:        i.qty ?? 1,
      unit_price: Number(i.price),
      subtotal:   Number(i.price) * (i.qty ?? 1),
    })),
    subtotal: subtotal.value,
    shipping: envio.value,
    discount: descuento.value,          // previsualización; el servidor revalida
    quiere_descuento: aplicaDescuento.value,
    consent:  aceptaPromos.value,       // consentimiento de marketing
    total:    total.value,
  }
}

// ── Acción del botón ──
async function confirmar() {
  Object.keys(form).forEach(k => { tocado[k] = true })
  tocado.password = true
  if (vacio.value || !valido.value || enviando.value || pagando.value) return

  // Si pidió crear cuenta y no está logueado, regístralo primero.
  if (crearCuenta.value && !user.value) {
    const ok = await registrarCuenta()
    if (!ok) return
  }

  if (izipayActivo) await iniciarPago()
  else await finalizarPedido()   // sin pasarela configurada → registra el pedido directo
}

// Crea la cuenta del cliente en el checkout (para el 10% + seguir sus pedidos).
async function registrarCuenta() {
  enviando.value = true
  errorEnvio.value = null
  try {
    const { session } = await signUp({
      email: form.customer_email, password: password.value,
      full_name: form.customer_name, phone: form.customer_phone.replace(/\D/g, ''),
    })
    // Si la confirmación de correo está activa (prod), no hay sesión aún:
    // creamos el pedido como invitado y el 10% se aplicará al confirmar/loguear.
    if (!session) {
      errorEnvio.value = 'Cuenta creada ✓ Revisa tu correo para confirmarla. Continuamos con tu pedido.'
      crearCuenta.value = false
    }
    return true
  } catch (err) {
    const m = err?.message || ''
    errorEnvio.value = m.includes('already registered')
      ? 'Ese correo ya tiene una cuenta. Inicia sesión para aplicar tu 10%.'
      : (m || 'No se pudo crear la cuenta. Inténtalo de nuevo.')
    return false
  } finally {
    enviando.value = false
  }
}

// ── Registra el pedido (inserción + correo) y muestra el éxito ──
async function finalizarPedido(payment = null) {
  enviando.value = true
  errorEnvio.value = null
  try {
    const pedido = construirPedido()
    if (payment) pedido.payment = payment
    const res = await createOrder(pedido)
    orderNumber.value = res?.order_number ?? ''
    enviado.value = true   // antes de limpiar el carrito (evita el redirect)
    clearCart()
  } catch (err) {
    errorEnvio.value = 'No pudimos registrar tu pedido. Revisa tu conexión e inténtalo de nuevo.'
  } finally {
    enviando.value = false
  }
}

// ── Pago con Izipay (Web Core embebido) ──
async function iniciarPago() {
  pagando.value = true
  errorPago.value = null
  try {
    const amount   = total.value.toFixed(2)
    const orderRef = `HB-${Date.now()}`
    const { token, transactionId } = await generateIzipayToken({ amount, orderNumber: orderRef })

    await loadIzipaySdk()

    const iziConfig = {
      action: 'pay',
      merchantCode: IZIPAY_MERCHANT_CODE,
      transactionId,
      order: {
        orderNumber: orderRef,
        currency: 'PEN',
        amount,
        processType: 'AT',
        merchantBuyerId: form.customer_email.trim(),
        dateTimeTransaction: Date.now().toString(),
        payMethod: 'CARD',
      },
      billing: {
        firstName:    form.customer_name.trim().split(' ')[0] || form.customer_name.trim(),
        lastName:     form.customer_name.trim().split(' ').slice(1).join(' ') || '-',
        email:        form.customer_email.trim(),
        phoneNumber:  form.customer_phone.replace(/\D/g, ''),
        street:       form.notes.trim().slice(0, 120),
        city:         'Lima',
        state:        'Lima',
        country:      'PE',
        postalCode:   '15000',
        documentType: 'DNI',
        document:     form.document.trim() || '00000000',
      },
      render: {
        typeForm: 'embedded',
        container: '#iframe-payment',
        showButtonProcessForm: true,
      },
    }

    mostrarPago.value = true
    await nextTick()

    const checkout = new window.Izipay({ config: iziConfig })
    checkout.LoadForm({
      authorization: token,
      keyRSA: IZIPAY_PUBLIC_KEY,
      callbackResponse: onPagoRespuesta,
    })
  } catch (err) {
    errorPago.value = 'No se pudo iniciar el pago. Inténtalo de nuevo.'
    mostrarPago.value = false
  } finally {
    pagando.value = false
  }
}

// ── Respuesta del formulario de pago ──
function onPagoRespuesta(response) {
  // ⚠️ VERIFICA el código de éxito según tu cuenta Izipay (suele ser code '00').
  const code = response?.code ?? response?.response?.code
  if (String(code) === '00') {
    mostrarPago.value = false
    finalizarPedido({ provider: 'izipay', transactionId: response?.transactionId ?? null, code })
  } else {
    errorPago.value = response?.message || 'El pago no se completó. Intenta nuevamente.'
  }
}
</script>

<template>
<div class="checkout">
  <!-- ░░ ÉXITO ░░ -->
  <section v-if="enviado" class="state" role="status" aria-live="polite">
    <svg class="state__icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/>
    </svg>
    <h1 class="state__title">¡Pedido confirmado!</h1>
    <p class="state__num">N.° de pedido: <strong>{{ orderNumber }}</strong></p>
    <p class="state__msg">
      Enviamos la confirmación con el detalle a <strong>{{ form.customer_email }}</strong>.
      Te contactaremos para coordinar la entrega.
    </p>
    <RouterLink to="/coleccion" class="state__cta">Seguir comprando</RouterLink>
  </section>

  <template v-else>
    <section class="page-hero">
      <div class="page-hero__inner">
        <span class="chip">Finalizar pedido</span>
        <h1 class="page-hero__title">Datos de envío</h1>
        <p class="page-hero__sub">Te enviaremos la confirmación por correo</p>
      </div>
    </section>

    <section class="checkout__body">
      <div class="checkout__grid">
        <!-- ── FORMULARIO ── -->
        <form class="form" novalidate @submit.prevent="confirmar">
          <div class="form__group">
            <label class="field__label" for="f-name">Nombre completo</label>
            <input
              id="f-name" v-model="form.customer_name" type="text" class="field__input"
              :class="{ 'field__input--err': errorDe('customer_name') }"
              autocomplete="name" :aria-invalid="!!errorDe('customer_name')"
              :aria-describedby="errorDe('customer_name') ? 'err-name' : undefined"
              @blur="marcar('customer_name')"
            />
            <span v-if="errorDe('customer_name')" id="err-name" class="field__error" role="alert">{{ errores.customer_name }}</span>
          </div>

          <div class="form__row">
            <div class="form__group">
              <label class="field__label" for="f-phone">Celular</label>
              <input
                id="f-phone" v-model="form.customer_phone" type="tel" inputmode="numeric" maxlength="12"
                class="field__input" :class="{ 'field__input--err': errorDe('customer_phone') }"
                placeholder="9XX XXX XXX" autocomplete="tel" :aria-invalid="!!errorDe('customer_phone')"
                :aria-describedby="errorDe('customer_phone') ? 'err-phone' : undefined"
                @blur="marcar('customer_phone')"
              />
              <span v-if="errorDe('customer_phone')" id="err-phone" class="field__error" role="alert">{{ errores.customer_phone }}</span>
            </div>
            <div class="form__group">
              <label class="field__label" for="f-email">Correo electrónico</label>
              <input
                id="f-email" v-model="form.customer_email" type="email" class="field__input"
                :class="{ 'field__input--err': errorDe('customer_email') }"
                autocomplete="email" :aria-invalid="!!errorDe('customer_email')"
                :aria-describedby="errorDe('customer_email') ? 'err-email' : undefined"
                @blur="marcar('customer_email')"
              />
              <span v-if="errorDe('customer_email')" id="err-email" class="field__error" role="alert">{{ errores.customer_email }}</span>
            </div>
          </div>

          <div v-if="izipayActivo" class="form__group">
            <label class="field__label" for="f-doc">DNI</label>
            <input
              id="f-doc" v-model="form.document" type="text" inputmode="numeric" maxlength="8"
              class="field__input" :class="{ 'field__input--err': errorDe('document') }"
              autocomplete="off" :aria-invalid="!!errorDe('document')"
              :aria-describedby="errorDe('document') ? 'err-doc' : undefined"
              @blur="marcar('document')"
            />
            <span v-if="errorDe('document')" id="err-doc" class="field__error" role="alert">{{ errores.document }}</span>
          </div>

          <div class="form__group">
            <label class="field__label" for="f-notes">Dirección de entrega y notas</label>
            <textarea
              id="f-notes" v-model="form.notes" class="field__input field__textarea" rows="4"
              :maxlength="NOTES_MAX" :class="{ 'field__input--err': errorDe('notes') }"
              placeholder="Calle / Av., número, distrito, provincia y referencias para la entrega."
              :aria-invalid="!!errorDe('notes')"
              :aria-describedby="errorDe('notes') ? 'err-notes' : undefined"
              @blur="marcar('notes')"
            ></textarea>
            <div class="field__foot">
              <span v-if="errorDe('notes')" id="err-notes" class="field__error" role="alert">{{ errores.notes }}</span>
              <span class="field__count">{{ form.notes.length }}/{{ NOTES_MAX }}</span>
            </div>
          </div>

          <!-- ── Cuenta + consentimiento (opcionales) ── -->
          <div class="acct-box">
            <template v-if="!user">
              <label class="acct-check">
                <input type="checkbox" v-model="crearCuenta" />
                <span>Crear mi cuenta y obtener <strong>10% de descuento</strong> en este pedido 🎁</span>
              </label>
              <div v-if="crearCuenta" class="form__group acct-pass">
                <label class="field__label" for="f-pass">Crea una contraseña</label>
                <input
                  id="f-pass" v-model="password" type="password" class="field__input"
                  :class="{ 'field__input--err': errorDe('password') }" autocomplete="new-password"
                  @blur="marcar('password')"
                />
                <span v-if="errorDe('password')" class="field__error" role="alert">{{ errores.password }}</span>
              </div>
            </template>
            <p v-else class="acct-logged">Comprando como <strong>{{ user.email }}</strong> ✓</p>

            <label class="acct-check">
              <input type="checkbox" v-model="aceptaPromos" />
              <span>Quiero recibir promociones y novedades por correo.</span>
            </label>
            <p class="acct-legal">Tu correo se usa para enviarte tu boleta y la confirmación del pedido. Puedes cancelar las promociones cuando quieras.</p>
          </div>
        </form>

        <!-- ── RESUMEN ── -->
        <aside class="summary" aria-label="Resumen del pedido">
          <button
            v-if="!esDesktop" type="button" class="summary__toggle"
            :aria-expanded="resumenAbierto" aria-controls="resumen-items"
            @click="resumenAbierto = !resumenAbierto"
          >
            <span>{{ resumenAbierto ? 'Ocultar' : 'Ver' }} resumen</span>
            <span class="summary__toggle-total">S/ {{ total.toFixed(2) }}</span>
          </button>
          <h2 v-else class="summary__title">Tu pedido</h2>

          <div v-show="itemsVisibles" id="resumen-items">
            <ul class="summary__list">
              <li v-for="(item, i) in cart" :key="`${item.productId}-${item.size}-${item.color ?? ''}-${i}`" class="summary__item">
                <div class="summary__item-img">
                  <img v-if="item.image" :src="item.image" :alt="item.name" />
                  <div v-else class="summary__item-ph" aria-hidden="true">H</div>
                </div>
                <div class="summary__item-info">
                  <p class="summary__item-name">{{ item.name }}</p>
                  <p class="summary__item-meta">
                    Talla {{ item.size }}<template v-if="item.color"> · {{ item.color }}</template>
                  </p>
                  <p class="summary__item-unit">{{ item.qty ?? 1 }} × S/ {{ Number(item.price).toFixed(2) }}</p>
                </div>
                <span class="summary__item-sub">S/ {{ (Number(item.price) * (item.qty ?? 1)).toFixed(2) }}</span>
              </li>
            </ul>

            <div class="summary__lines">
              <div class="summary__line">
                <span>Subtotal</span><span>S/ {{ subtotal.toFixed(2) }}</span>
              </div>
              <div v-if="descuento > 0" class="summary__line summary__line--disc">
                <span>Descuento 10% 🎁</span><span>- S/ {{ descuento.toFixed(2) }}</span>
              </div>
              <div class="summary__line">
                <span>Envío</span>
                <span :class="{ 'summary__free': envioGratis }">{{ envioGratis ? 'Gratis' : `S/ ${envio.toFixed(2)}` }}</span>
              </div>
              <p v-if="!envioGratis && faltaEnvioGratis > 0" class="summary__hint">
                Te faltan S/ {{ faltaEnvioGratis.toFixed(2) }} para envío gratis.
              </p>
            </div>
          </div>

          <div class="summary__total">
            <span>Total</span>
            <span class="summary__total-amt">S/ {{ total.toFixed(2) }}</span>
          </div>

          <p v-if="errorEnvio" class="summary__send-err" role="alert">{{ errorEnvio }}</p>
          <p v-if="errorPago" class="summary__send-err" role="alert">{{ errorPago }}</p>

          <button
            v-if="!mostrarPago"
            type="button" class="checkout__submit"
            :class="{ 'checkout__submit--ready': valido && !enviando && !pagando }"
            :disabled="!valido || enviando || pagando" :aria-busy="enviando || pagando"
            @click="confirmar"
          >
            <span v-if="enviando || pagando" class="spinner" aria-hidden="true"></span>
            <template v-if="enviando">Procesando…</template>
            <template v-else-if="pagando">Cargando pago…</template>
            <template v-else-if="izipayActivo">Pagar S/ {{ total.toFixed(2) }}</template>
            <template v-else>Confirmar pedido</template>
          </button>

          <!-- Formulario de pago embebido de Izipay -->
          <div v-show="mostrarPago" id="iframe-payment" class="izipay-form"></div>

          <p class="summary__note">
            {{ izipayActivo ? 'Pago seguro procesado por Izipay.' : 'Recibirás un correo de confirmación.' }}
          </p>
        </aside>
      </div>
    </section>
  </template>
</div>
</template>

<style scoped>
/* ── HERO ── */
.page-hero {
  border-bottom: 1px solid var(--border);
  padding: 3rem 1.25rem 2.5rem;
  background: var(--surface-1);
}
.page-hero__inner { max-width: 1100px; margin: 0 auto; }
.chip {
  display: inline-block;
  font-size: 0.68rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--accent-3);
}
.page-hero__title {
  font-family: var(--font-display);
  font-size: clamp(2rem, 5vw, 3.4rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  text-transform: uppercase;
  color: var(--text-1);
  line-height: 1.05;
  margin-top: 0.6rem;
}
.page-hero__sub {
  margin-top: 0.9rem;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  color: var(--text-3);
}

/* ── BODY ── */
.checkout__body { max-width: 1100px; margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }
.checkout__grid { display: flex; flex-direction: column; gap: 2rem; }

/* ── FORM ── */
.form { display: flex; flex-direction: column; gap: 1.25rem; order: 2; }
.form__row { display: grid; grid-template-columns: 1fr; gap: 1rem; }
.form__group { display: flex; flex-direction: column; gap: 0.4rem; }
.field__label {
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-2);
  font-weight: 600;
}
.field__input {
  background: var(--surface-2);
  border: 1px solid var(--border-mid);
  color: var(--text-1);
  font-family: var(--font-body);
  font-size: 0.95rem;
  padding: 0.75rem 0.85rem;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  width: 100%;
}
.field__input::placeholder { color: var(--text-3); }
.field__input:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--glow-color); }
.field__input--err { border-color: #e0566b; }
.field__textarea { resize: vertical; line-height: 1.5; }
.field__foot { display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; }
.field__error { font-size: 0.74rem; color: #e0566b; letter-spacing: 0.01em; }
.field__count { font-size: 0.65rem; letter-spacing: 0.08em; color: var(--text-3); margin-left: auto; }

/* ── ACCOUNT BOX ── */
.acct-box { display: flex; flex-direction: column; gap: 0.8rem; padding: 1rem 1.1rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; }
.acct-check { display: flex; gap: 0.6rem; align-items: flex-start; font-size: 0.84rem; color: var(--text-2); cursor: pointer; line-height: 1.4; }
.acct-check input { margin-top: 0.15rem; width: 16px; height: 16px; flex-shrink: 0; accent-color: var(--accent); cursor: pointer; }
.acct-check strong { color: var(--accent-3); }
.acct-pass { margin-top: 0.1rem; }
.acct-logged { font-size: 0.84rem; color: var(--text-2); }
.acct-legal { font-size: 0.7rem; color: var(--text-3); line-height: 1.5; }

/* ── SUMMARY ── */
.summary {
  order: 1;
  background: var(--card-bg);
  border: 1px solid var(--border-mid);
  box-shadow: var(--shadow-sm);
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.summary__toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  font-family: var(--font-display);
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-1);
  font-weight: 600;
}
.summary__toggle-total { color: var(--text-1); }
.summary__title {
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-2);
  font-family: var(--font-display);
  font-weight: 600;
}
.summary__list { list-style: none; display: flex; flex-direction: column; gap: 1rem; margin-top: 0.25rem; }
.summary__item { display: flex; gap: 0.8rem; align-items: flex-start; }
.summary__item-img { width: 48px; height: 62px; flex-shrink: 0; background: var(--surface-2); overflow: hidden; }
.summary__item-img img { width: 100%; height: 100%; object-fit: cover; }
.summary__item-ph { width: 100%; height: 100%; display: grid; place-items: center; font-family: var(--font-display); color: var(--text-3); }
.summary__item-info { flex: 1; min-width: 0; }
.summary__item-name { font-size: 0.82rem; color: var(--text-1); font-weight: 500; line-height: 1.3; }
.summary__item-meta { font-size: 0.72rem; color: var(--text-3); letter-spacing: 0.03em; margin-top: 0.15rem; }
.summary__item-unit { font-size: 0.72rem; color: var(--text-3); margin-top: 0.1rem; }
.summary__item-sub { font-size: 0.82rem; color: var(--text-1); font-weight: 600; white-space: nowrap; }

.summary__lines { display: flex; flex-direction: column; gap: 0.5rem; border-top: 1px solid var(--border); padding-top: 1rem; }
.summary__line { display: flex; justify-content: space-between; font-size: 0.82rem; color: var(--text-2); }
.summary__free { color: var(--accent-2); font-weight: 600; }
.summary__line--disc { color: var(--accent-2); font-weight: 600; }
.summary__hint { font-size: 0.7rem; color: var(--accent-3); letter-spacing: 0.02em; }

.summary__total {
  display: flex; justify-content: space-between; align-items: baseline;
  border-top: 1px solid var(--border); padding-top: 1rem;
}
.summary__total span:first-child { font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-2); }
.summary__total-amt { font-family: var(--font-display); font-size: 1.3rem; font-weight: 700; color: var(--text-1); }
.summary__send-err { font-size: 0.76rem; color: #e0566b; }

.checkout__submit {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.55rem;
  width: 100%; padding: 1rem;
  background: var(--surface-3); color: var(--text-3);
  border: 1px solid var(--border-mid);
  font-family: var(--font-display); font-size: 0.78rem; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase; cursor: pointer;
  transition: all 0.2s ease;
}
.checkout__submit--ready { background: var(--accent); border-color: var(--accent); color: var(--ink); }
.checkout__submit--ready:hover { background: var(--accent-deep); border-color: var(--accent-deep); }
.checkout__submit:disabled { opacity: 0.6; cursor: not-allowed; }
.summary__note { text-align: center; font-size: 0.68rem; color: var(--text-3); letter-spacing: 0.03em; }
.izipay-form { margin-top: 1rem; min-height: 1px; }

.spinner {
  width: 15px; height: 15px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 1.6s; } }

/* ── STATES (éxito) ── */
.state {
  max-width: 560px; margin: 0 auto; padding: 5rem 1.5rem; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 1rem;
}
.state__icon { color: var(--accent-2); }
.state__title { font-family: var(--font-display); font-size: 1.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: -0.01em; color: var(--text-1); }
.state__num { font-size: 0.9rem; color: var(--text-2); letter-spacing: 0.04em; }
.state__msg { font-size: 0.9rem; color: var(--text-2); line-height: 1.7; }
.state__cta {
  margin-top: 0.5rem; padding: 0.85rem 2rem;
  background: var(--text-1); color: var(--ink);
  font-family: var(--font-display); font-size: 0.75rem; font-weight: 600;
  letter-spacing: 0.14em; text-transform: uppercase; transition: background 0.2s, color 0.2s;
}
.state__cta:hover { background: var(--accent); color: var(--ink); }

/* ── DESKTOP (mobile-first → enhancement) ── */
@media (min-width: 861px) {
  .page-hero { padding: 3.5rem 2rem 3rem; }
  .checkout__body { padding: 3rem 2rem 6rem; }
  .checkout__grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 3rem; align-items: start; }
  .form { order: 1; }
  .form__row { grid-template-columns: 1fr 1fr; }
  .summary { order: 2; position: sticky; top: 1.5rem; padding: 1.5rem; }
}
</style>
