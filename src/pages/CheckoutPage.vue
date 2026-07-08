<script setup>
import { ref, reactive, computed, inject, watch, watchEffect, onMounted, onUnmounted, nextTick } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { createOrder } from '../lib/order.js'
import { useAuth } from '../lib/useAuth.js'
import { getFormToken, montarFormularioIzipay, removeForms } from '../lib/izipay.js'
import { COSTO_ENVIO, IZIPAY_ENABLED, WHATSAPP_NUMERO } from '../lib/config.js'
import { validarEmail, validarTelefonoPE, validarDNI, validarRUC, validarTexto, soloDigitos } from '../lib/validation.js'

const router    = useRouter()
const cart      = inject('cart', ref([]))
const clearCart = inject('clearCart', () => {})
const { user, signUp } = useAuth()

const WELCOME_PCT = 0.10
const round2 = (n) => Math.round(n * 100) / 100

// ── Estado del wizard ──
const paso = ref(1)                 // 1·Datos+Dirección 2·Beneficio 3·Pago
const TOTAL_PASOS = 3

// ── Formulario ──
const form = reactive({
  nombres: '', apellidos: '', email: '', telefono: '',
  // Dirección (texto simple)
  departamento: '', provincia: '', distrito: '',
  calle: '', numero: '', urbanizacion: '', referencias: '',
})
const tocado = reactive({})

// ── Beneficio 10% + consentimiento ──
const beneficio    = ref('')        // '' | 'si' | 'no'  (paso 3, usuario nuevo)
const password     = ref('')
const aceptaPromos = ref(false)     // checkbox de promos para usuario ya logueado

// ── Pago ──
const metodoPago = ref(IZIPAY_ENABLED ? 'tarjeta' : 'yape_manual')  // 'tarjeta' | 'yape_auto' | 'yape_manual'
const esIzipay   = computed(() => metodoPago.value === 'tarjeta' || metodoPago.value === 'yape_auto')
const procesando = ref(false)
const mostrarPago = ref(false)
const errorPago  = ref(null)
const avisoCuenta = ref(null)

// ── Éxito ──
const enviado     = ref(false)
const modoExito   = ref('pagado')   // 'pagado' (tarjeta/yape auto) | 'yape' (yape manual reservado)
const orderNumber = ref('')
const yapeLink    = ref('')
const yapeTotal   = ref(0)
const yapeDisponible = !!WHATSAPP_NUMERO

// ── Pedido pendiente reusable (anti-duplicados) ──
const pedidoActual = ref(null)      // { orderNumber, hash }

// ── Borrador del checkout (persistido por si recargas a mitad del proceso) ──
// Se guarda en sessionStorage (se limpia al cerrar la pestaña). NUNCA guardamos la
// contraseña. Se borra al completar el pedido.
const CHECKOUT_KEY = 'hebennus-checkout'
try {
  const saved = JSON.parse(sessionStorage.getItem(CHECKOUT_KEY) || 'null')
  if (saved) {
    if (saved.form) Object.assign(form, saved.form)
    if (saved.beneficio) beneficio.value = saved.beneficio
    if (saved.metodoPago) metodoPago.value = saved.metodoPago
    if (typeof saved.paso === 'number') paso.value = saved.paso
  }
} catch { /* borrador inválido → lo ignoramos */ }

watch([form, beneficio, metodoPago, paso], () => {
  try {
    sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify({
      form: { ...form },            // incluye datos y dirección, NO la contraseña
      beneficio: beneficio.value,
      metodoPago: metodoPago.value,
      paso: paso.value,
    }))
  } catch { /* sin espacio / bloqueado → no pasa nada */ }
}, { deep: true })

// Al completar el pedido, limpiamos el borrador.
watch(enviado, (v) => { if (v) { try { sessionStorage.removeItem(CHECKOUT_KEY) } catch { /* noop */ } } })

// ── Totales ──
const subtotal = computed(() => cart.value.reduce((s, i) => s + Number(i.price) * (i.qty ?? 1), 0))
// Envío: Lima costo fijo; provincia se coordina aparte. Sin envío gratis.
const envio = computed(() => (subtotal.value === 0 ? 0 : COSTO_ENVIO))
// Vista previa del 10%: solo usuario nuevo que eligió el beneficio. El servidor revalida.
const aplicaDescuento = computed(() => !user.value && beneficio.value === 'si')
const descuento = computed(() => aplicaDescuento.value ? round2(subtotal.value * WELCOME_PCT) : 0)
const total = computed(() => Math.max(0, subtotal.value + envio.value - descuento.value))
const vacio = computed(() => !cart.value.length)

// ── Prellenar si ya inició sesión ──
watchEffect(() => {
  if (!user.value) return
  const md = user.value.user_metadata || {}
  if (!form.email) form.email = user.value.email || ''
  const parts = String(md.full_name || md.name || '').trim().split(/\s+/).filter(Boolean)
  if (!form.nombres && parts.length)   form.nombres = parts[0]
  if (!form.apellidos && parts.length > 1) form.apellidos = parts.slice(1).join(' ')
  if (!form.telefono) form.telefono = md.phone || ''
})

// ── Carrito vacío → redirige (sin pisar la pantalla de éxito) ──
watchEffect(() => {
  if (!enviado.value && cart.value.length === 0) router.replace('/coleccion')
})

// ── Si el carrito cambia con un pago en curso, invalida el pedido y el form ──
watch(subtotal, () => {
  if (enviado.value) return
  if (mostrarPago.value || pedidoActual.value) {
    removeForms()
    mostrarPago.value = false
    pedidoActual.value = null
    if (mostrarPago.value) errorPago.value = 'Tu carrito cambió. Revisa el resumen y vuelve a pagar.'
  }
})

// ── Validación (todos los campos; se muestran según "tocado") ──
const errores = computed(() => {
  const e = {}
  if (!validarTexto(form.nombres, 2))   e.nombres = 'Ingresa tus nombres.'
  if (!validarTexto(form.apellidos, 2)) e.apellidos = 'Ingresa tus apellidos.'
  if (!validarEmail(form.email))        e.email = 'Correo electrónico inválido.'
  if (!validarTelefonoPE(form.telefono)) e.telefono = 'Celular: 9 dígitos, empieza con 9.'
  // Comprobante: siempre boleta a consumidor final (sin DNI ni RUC).
  if (!validarTexto(form.departamento)) e.departamento = 'Falta el departamento.'
  if (!validarTexto(form.provincia))    e.provincia = 'Falta la provincia.'
  if (!validarTexto(form.distrito))     e.distrito = 'Falta el distrito.'
  if (!validarTexto(form.calle))        e.calle = 'Falta la calle / avenida.'
  if (!/^\d+$/.test(form.numero))       e.numero = 'Ingresa el número (solo dígitos).'
  if (!user.value && beneficio.value === 'si' && password.value.length < 6) e.password = 'Mínimo 6 caracteres.'
  return e
})
function marcar(campo) { tocado[campo] = true }
function errorDe(campo) { return tocado[campo] ? errores.value[campo] : null }

// Campos por paso (para marcar "tocado" al intentar avanzar).
const camposPaso = {
  1: ['nombres', 'apellidos', 'email', 'telefono', 'departamento', 'provincia', 'distrito', 'calle', 'numero'],
  2: ['password'],
}
function pasoValido(n) {
  const e = errores.value
  if (n === 1) {
    return !e.nombres && !e.apellidos && !e.email && !e.telefono &&
      !e.departamento && !e.provincia && !e.distrito && !e.calle && !e.numero
  }
  if (n === 2) {
    if (user.value) return true
    if (beneficio.value === 'si') return !e.password
    return beneficio.value === 'no'
  }
  return true
}
const puedePagar = computed(() => pasoValido(1) && pasoValido(2) && !procesando.value)

// ── Navegación del wizard ──
function siguiente() {
  ;(camposPaso[paso.value] || []).forEach((c) => { tocado[c] = true })
  errorPago.value = null
  if (!pasoValido(paso.value)) {
    nextTick(() => document.querySelector('.field__input--err')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    return
  }
  if (paso.value < TOTAL_PASOS) paso.value++
}
function anterior() { if (paso.value > 1) paso.value-- }
function irAPaso(n) { if (n < paso.value) paso.value = n }   // solo retroceder libremente

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
onUnmounted(() => { mq?.removeEventListener('change', onMq); removeForms(); document.body.style.overflow = '' })

// Modal de pago abierto → bloquea el scroll del FONDO (el form vive dentro del modal,
// que scrollea su propio contenido si no entra en pantalla). Así el usuario solo puede
// ingresar la tarjeta o cerrar el popup.
watch(mostrarPago, (abierto) => {
  if (typeof document !== 'undefined') document.body.style.overflow = abierto ? 'hidden' : ''
})
const itemsVisibles = computed(() => esDesktop.value || resumenAbierto.value)

// ── Construir dirección legible (se guarda en notes) ──
function direccionTexto() {
  const partes = [
    `${form.calle.trim()} ${form.numero.trim()}`.trim(),
    form.urbanizacion.trim() ? `Urb. ${form.urbanizacion.trim()}` : '',
    form.distrito.trim(), form.provincia.trim(), form.departamento.trim(),
  ].filter(Boolean)
  let txt = partes.join(', ')
  if (form.referencias.trim()) txt += `. Ref: ${form.referencias.trim()}`
  return txt.slice(0, 400)
}

// ── Payload del pedido ──
function backendMethod() {
  if (!IZIPAY_ENABLED && metodoPago.value !== 'yape_manual') return 'yape_manual'
  return metodoPago.value === 'yape_manual' ? 'yape_manual' : 'izipay'
}
function construirPedido() {
  return {
    cliente: {
      customer_name:  `${form.nombres.trim()} ${form.apellidos.trim()}`.trim(),
      customer_phone: soloDigitos(form.telefono),
      customer_email: form.email.trim(),
      comprobante_tipo: 'boleta',
      doc_numero:     null,
      razon_social:   null,
      notes:          direccionTexto(),
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
    discount: descuento.value,
    quiere_descuento: aplicaDescuento.value,
    consent:  user.value ? aceptaPromos.value : (beneficio.value === 'si'),
    total:    total.value,
    payment_method: backendMethod(),
  }
}
function hashPedido(p) {
  return JSON.stringify({ items: p.items, total: p.total, email: p.cliente.customer_email, m: p.payment_method })
}

// ── Acción de pago (paso 4) ──
async function pagar() {
  if (procesando.value) return
  errorPago.value = null
  // Garantiza que los pasos previos estén completos.
  for (const n of [1, 2, 3]) {
    if (!pasoValido(n)) { (camposPaso[n] || []).forEach((c) => { tocado[c] = true }); paso.value = n; return }
  }
  procesando.value = true
  try {
    // Crea la cuenta si eligió el beneficio y no está logueado.
    if (!user.value && beneficio.value === 'si') {
      const ok = await registrarCuenta()
      if (!ok) return
    }
    if (metodoPago.value === 'yape_manual') await pagarYapeManual()
    else await iniciarPagoIzipay()
  } finally {
    procesando.value = false
  }
}

async function registrarCuenta() {
  try {
    const { session } = await signUp({
      email: form.email.trim(),
      password: password.value,
      full_name: `${form.nombres.trim()} ${form.apellidos.trim()}`.trim(),
      phone: soloDigitos(form.telefono),
    })
    if (!session) avisoCuenta.value = 'Cuenta creada ✓ Revisa tu correo para confirmarla. Continuamos con tu pedido.'
    return true
  } catch (err) {
    const m = err?.message || ''
    errorPago.value = m.includes('already registered')
      ? 'Ese correo ya tiene una cuenta. Inicia sesión para aplicar tu 10%.'
      : (m || 'No se pudo crear la cuenta. Inténtalo de nuevo.')
    return false
  }
}

// Tarjeta / Yape automático → formulario embebido de Izipay (popup).
async function iniciarPagoIzipay() {
  try {
    const pedido = construirPedido()
    const h = hashPedido(pedido)
    let orderNum = pedidoActual.value?.hash === h ? pedidoActual.value.orderNumber : null
    if (!orderNum) {
      const res = await createOrder(pedido)
      orderNum = res?.order_number ?? ''
      pedidoActual.value = { orderNumber: orderNum, hash: h }
    }
    const tok = await getFormToken(orderNum)
    mostrarPago.value = true
    await nextTick()
    await montarFormularioIzipay({
      ...tok,
      selector: '#izipay-form',
      onPaid: () => {
        removeForms()
        mostrarPago.value = false
        modoExito.value = 'pagado'
        orderNumber.value = orderNum
        enviado.value = true          // antes de limpiar el carrito (evita el redirect)
        clearCart()
      },
      onError: (m) => { errorPago.value = m || 'El pago no se completó. Intenta nuevamente.' },
      onClosed: () => { mostrarPago.value = false },   // cerró el popup nativo → resetea
    })
  } catch (err) {
    errorPago.value = 'No se pudo iniciar el pago. Inténtalo de nuevo.'
    mostrarPago.value = false
  }
}

// Cierra el modal de pago (limpia el form; el pedido pendiente se reusa si reintenta).
function cerrarPago() {
  removeForms()
  mostrarPago.value = false
  errorPago.value = null
}

// Yape manual → crea el pedido reservado y abre WhatsApp con el monto del servidor.
async function pagarYapeManual() {
  try {
    const res = await createOrder(construirPedido())
    orderNumber.value = res?.order_number ?? ''
    yapeTotal.value = Number(res?.total ?? total.value)
    const msg = `Hola Hebennus! Deseo pagar mi pedido ${orderNumber.value} por S/ ${yapeTotal.value.toFixed(2)} mediante Yape. ¿Me comparten el QR? 🙏`
    yapeLink.value = yapeDisponible ? `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(msg)}` : ''
    modoExito.value = 'yape'
    enviado.value = true
    clearCart()
  } catch (err) {
    errorPago.value = 'No pudimos registrar tu pedido. Revisa tu conexión e inténtalo de nuevo.'
  }
}

const metodoLabel = computed(() =>
  metodoPago.value === 'yape_manual' ? `Continuar con Yape` : `Pagar S/ ${total.value.toFixed(2)}`,
)
</script>

<template>
<div class="checkout">
  <!-- ░░ ÉXITO ░░ -->
  <section v-if="enviado" class="state" role="status" aria-live="polite">
    <template v-if="modoExito === 'yape'">
      <svg class="state__icon state__icon--yape" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 2"/>
      </svg>
      <h1 class="state__title">¡Pedido reservado!</h1>
      <p class="state__num">N.° de pedido: <strong>{{ orderNumber }}</strong> · Total: <strong>S/ {{ yapeTotal.toFixed(2) }}</strong></p>
      <p class="state__msg">
        Tu pedido quedó <strong>reservado</strong>. Para completar el pago por <strong>Yape</strong>,
        escríbenos por WhatsApp y te enviamos el QR. Confirmaremos tu pedido al recibir el pago.
      </p>
      <a v-if="yapeLink" :href="yapeLink" target="_blank" rel="noopener" class="state__cta state__cta--wa">
        Continuar en WhatsApp
      </a>
      <p v-else class="state__msg">Escríbenos por WhatsApp mencionando tu N.° de pedido para coordinar el pago por Yape.</p>
      <RouterLink to="/coleccion" class="state__link">Seguir comprando</RouterLink>
    </template>
    <template v-else>
      <svg class="state__icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/>
      </svg>
      <h1 class="state__title">¡Pedido confirmado!</h1>
      <p class="state__num">N.° de pedido: <strong>{{ orderNumber }}</strong></p>
      <p class="state__msg">
        Enviamos la confirmación con el detalle a <strong>{{ form.email }}</strong>.
        Te contactaremos para coordinar la entrega.
      </p>
      <RouterLink to="/coleccion" class="state__cta">Seguir comprando</RouterLink>
    </template>
  </section>

  <template v-else>
    <section class="page-hero">
      <div class="page-hero__inner" v-reveal>
        <span class="chip">Finalizar pedido</span>
        <h1 class="page-hero__title">Tu pedido</h1>
        <p class="page-hero__sub">Pago seguro · envío a todo el Perú</p>
      </div>
    </section>

    <section class="checkout__body">
      <div class="checkout__grid">
        <!-- ── WIZARD ── -->
        <div class="wizard">
          <!-- Barra de pasos -->
          <ol class="steps" aria-label="Progreso del checkout">
            <li v-for="(t, i) in ['Datos','Beneficio','Pago']" :key="i"
                class="step" :class="{ 'step--active': paso === i + 1, 'step--done': paso > i + 1 }"
                @click="irAPaso(i + 1)">
              <span class="step__n">{{ paso > i + 1 ? '✓' : i + 1 }}</span>
              <span class="step__t">{{ t }}</span>
            </li>
          </ol>

          <form class="form" novalidate @submit.prevent="paso < TOTAL_PASOS ? siguiente() : pagar()">
            <!-- ░ PASO 1 · DATOS ░ -->
            <div v-show="paso === 1" class="wstep wstep--card">
              <p class="wstep__title">Tus datos</p>
              <div class="form__row">
                <div class="form__group">
                  <label class="field__label" for="f-nom">Nombres</label>
                  <input id="f-nom" v-model="form.nombres" type="text" class="field__input"
                    :class="{ 'field__input--err': errorDe('nombres') }" autocomplete="given-name"
                    @blur="marcar('nombres')" />
                  <span v-if="errorDe('nombres')" class="field__error" role="alert">{{ errores.nombres }}</span>
                </div>
                <div class="form__group">
                  <label class="field__label" for="f-ape">Apellidos</label>
                  <input id="f-ape" v-model="form.apellidos" type="text" class="field__input"
                    :class="{ 'field__input--err': errorDe('apellidos') }" autocomplete="family-name"
                    @blur="marcar('apellidos')" />
                  <span v-if="errorDe('apellidos')" class="field__error" role="alert">{{ errores.apellidos }}</span>
                </div>
              </div>
              <div class="form__row">
                <div class="form__group">
                  <label class="field__label" for="f-email">Correo electrónico</label>
                  <input id="f-email" v-model="form.email" type="email" class="field__input"
                    :class="{ 'field__input--err': errorDe('email') }" autocomplete="email"
                    @blur="marcar('email')" />
                  <span v-if="errorDe('email')" class="field__error" role="alert">{{ errores.email }}</span>
                </div>
                <div class="form__group">
                  <label class="field__label" for="f-tel">Celular</label>
                  <input id="f-tel" v-model="form.telefono" type="tel" inputmode="numeric" maxlength="12"
                    class="field__input" :class="{ 'field__input--err': errorDe('telefono') }"
                    placeholder="9XX XXX XXX" autocomplete="tel" @blur="marcar('telefono')" />
                  <span v-if="errorDe('telefono')" class="field__error" role="alert">{{ errores.telefono }}</span>
                </div>
              </div>

            </div>

            <!-- ░ PASO 1 (cont.) · DIRECCIÓN ░ -->
            <div v-show="paso === 1" class="wstep wstep--card">
              <p class="wstep__title">Dirección de entrega</p>
              <div class="form__row">
                <div class="form__group">
                  <label class="field__label" for="f-dep">Departamento</label>
                  <input id="f-dep" v-model="form.departamento" type="text" class="field__input"
                    :class="{ 'field__input--err': errorDe('departamento') }" autocomplete="address-level1"
                    placeholder="Lima" @blur="marcar('departamento')" />
                  <span v-if="errorDe('departamento')" class="field__error" role="alert">{{ errores.departamento }}</span>
                </div>
                <div class="form__group">
                  <label class="field__label" for="f-prov">Provincia</label>
                  <input id="f-prov" v-model="form.provincia" type="text" class="field__input"
                    :class="{ 'field__input--err': errorDe('provincia') }" autocomplete="address-level2"
                    placeholder="Lima" @blur="marcar('provincia')" />
                  <span v-if="errorDe('provincia')" class="field__error" role="alert">{{ errores.provincia }}</span>
                </div>
              </div>
              <div class="form__group">
                <label class="field__label" for="f-dist">Distrito</label>
                <input id="f-dist" v-model="form.distrito" type="text" class="field__input"
                  :class="{ 'field__input--err': errorDe('distrito') }" autocomplete="address-level3"
                  placeholder="Miraflores" @blur="marcar('distrito')" />
                <span v-if="errorDe('distrito')" class="field__error" role="alert">{{ errores.distrito }}</span>
              </div>
              <div class="form__row">
                <div class="form__group">
                  <label class="field__label" for="f-calle">Calle / Avenida</label>
                  <input id="f-calle" v-model="form.calle" type="text" class="field__input"
                    :class="{ 'field__input--err': errorDe('calle') }" autocomplete="street-address"
                    @blur="marcar('calle')" />
                  <span v-if="errorDe('calle')" class="field__error" role="alert">{{ errores.calle }}</span>
                </div>
                <div class="form__group">
                  <label class="field__label" for="f-num">Número</label>
                  <input id="f-num" v-model="form.numero" type="text" inputmode="numeric"
                    class="field__input" :class="{ 'field__input--err': errorDe('numero') }"
                    @input="form.numero = form.numero.replace(/\D/g, '')" @blur="marcar('numero')" />
                  <span v-if="errorDe('numero')" class="field__error" role="alert">{{ errores.numero }}</span>
                </div>
              </div>
              <div class="form__group">
                <label class="field__label" for="f-urb">Urbanización <span class="opt">(opcional)</span></label>
                <input id="f-urb" v-model="form.urbanizacion" type="text" class="field__input" @blur="marcar('urbanizacion')" />
              </div>
              <div class="form__group">
                <label class="field__label" for="f-ref">Referencias <span class="opt">(opcional)</span></label>
                <textarea id="f-ref" v-model="form.referencias" class="field__input field__textarea" rows="2"
                  maxlength="200" placeholder="Color de puerta, piso, entre calles…"></textarea>
              </div>
            </div>

            <!-- ░ PASO 2 · BENEFICIO ░ -->
            <fieldset v-show="paso === 2" class="wstep">
              <legend class="wstep__title">Tu beneficio</legend>
              <template v-if="!user">
                <div class="benefit">
                  <p class="benefit__head">🎁 <strong>10% de descuento</strong> para nuevos clientes</p>
                  <p class="benefit__sub">Crea tu cuenta y acepta recibir nuestras novedades para activar tu 10% al instante.</p>
                  <label class="benefit__opt" :class="{ 'benefit__opt--on': beneficio === 'si' }">
                    <input type="radio" value="si" v-model="beneficio" />
                    <span>Sí, quiero mi <strong>10%</strong> y recibir promos, lanzamientos y novedades por correo.</span>
                  </label>
                  <div v-if="beneficio === 'si'" class="form__group benefit__pass">
                    <label class="field__label" for="f-pass">Crea una contraseña</label>
                    <input id="f-pass" v-model="password" type="password" class="field__input"
                      :class="{ 'field__input--err': errorDe('password') }" autocomplete="new-password"
                      @blur="marcar('password')" />
                    <span v-if="errorDe('password')" class="field__error" role="alert">{{ errores.password }}</span>
                    <span v-if="descuento > 0" class="benefit__chip">−S/ {{ descuento.toFixed(2) }} aplicado a tu total</span>
                  </div>
                  <label class="benefit__opt" :class="{ 'benefit__opt--on': beneficio === 'no' }">
                    <input type="radio" value="no" v-model="beneficio" />
                    <span>No, gracias. Prefiero comprar sin descuento.</span>
                  </label>
                  <p class="benefit__legal">El 10% se confirma al validar tu cuenta desde el correo. Si queda pendiente, registramos tu pedido y lo aplicamos al activarla. Tu correo siempre se usa para enviarte tu boleta y la confirmación; puedes darte de baja de las promos cuando quieras. Consulta nuestra <RouterLink to="/privacidad" target="_blank">política de privacidad</RouterLink>.</p>
                </div>
              </template>
              <template v-else>
                <p class="acct-logged">Comprando como <strong>{{ user.email }}</strong> ✓</p>
                <label class="benefit__opt">
                  <input type="checkbox" v-model="aceptaPromos" />
                  <span>Quiero recibir promociones y novedades por correo.</span>
                </label>
                <p class="benefit__legal">Tu correo se usa para enviarte tu boleta y la confirmación del pedido. Consulta nuestra <RouterLink to="/privacidad" target="_blank">política de privacidad</RouterLink>.</p>
              </template>
            </fieldset>

            <!-- ░ PASO 4 · PAGO ░ -->
            <fieldset v-show="paso === 3" class="wstep">
              <legend class="wstep__title">Método de pago</legend>
              <div class="pay-methods">
                <label v-if="IZIPAY_ENABLED" class="pay-card" :class="{ 'pay-card--on': metodoPago === 'tarjeta' }">
                  <input type="radio" value="tarjeta" v-model="metodoPago" />
                  <span class="pay-card__ico">💳</span>
                  <span class="pay-card__info"><strong>Tarjeta</strong><small>Crédito o débito · Visa / Mastercard</small></span>
                </label>
                <label class="pay-card" :class="{ 'pay-card--on': metodoPago === 'yape_manual' }">
                  <input type="radio" value="yape_manual" v-model="metodoPago" />
                  <span class="pay-card__ico">📲</span>
                  <span class="pay-card__info"><strong>Yape</strong><small>Te enviamos el QR y coordinamos el pago por WhatsApp</small></span>
                </label>
              </div>

              <!-- Info de envíos al comprar (términos completos en /privacidad) -->
              <div class="ship-note">
                🚚 Tomamos pedidos de <strong>lunes a jueves</strong>. Los <strong>preparamos el viernes</strong> (te confirmamos por WhatsApp o la web) y <strong>entregamos sábados y domingos</strong>. Los pedidos de viernes a domingo pasan a la semana siguiente. Envío a <strong>Lima S/ 10</strong>; <strong>provincia se coordina por WhatsApp</strong> (el precio puede variar).
                <RouterLink to="/privacidad" target="_blank" class="ship-note__link">Ver más →</RouterLink>
              </div>

              <p v-if="avisoCuenta" class="summary__note-ok" role="status" aria-live="polite">{{ avisoCuenta }}</p>
              <p v-if="errorPago" class="summary__send-err" role="alert">{{ errorPago }}</p>

              <button v-if="!mostrarPago" type="button" class="checkout__submit"
                :class="{ 'checkout__submit--ready': puedePagar }"
                :disabled="!puedePagar" :aria-busy="procesando" @click="pagar">
                <span v-if="procesando" class="spinner" aria-hidden="true"></span>
                <template v-if="procesando">Procesando…</template>
                <template v-else>{{ metodoLabel }}</template>
              </button>

              <p class="summary__note">
                {{ metodoPago === 'yape_manual' ? 'Coordinaremos el pago por WhatsApp.' : 'Pago seguro procesado por Izipay.' }}
              </p>

              <!-- El formulario de tarjeta de Izipay se monta dentro del MODAL de abajo
                   (Teleport al body). z-index moderado (600) para tapar el sitio pero NO
                   el popup de 3DS del banco (que usa una capa más alta). -->
            </fieldset>

            <!-- Navegación -->
            <div class="wizard__nav">
              <button v-if="paso > 1" type="button" class="btn-step btn-step--ghost" @click="anterior">← Atrás</button>
              <button v-if="paso < TOTAL_PASOS" type="button" class="btn-step btn-step--next" @click="siguiente">Siguiente →</button>
            </div>
          </form>
        </div>

        <!-- ── RESUMEN ── -->
        <aside class="summary" aria-label="Resumen del pedido">
          <button v-if="!esDesktop" type="button" class="summary__toggle"
            :aria-expanded="resumenAbierto" aria-controls="resumen-items"
            @click="resumenAbierto = !resumenAbierto">
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
                  <p class="summary__item-meta">Talla {{ item.size }}<template v-if="item.color"> · {{ item.color }}</template></p>
                  <p class="summary__item-unit">{{ item.qty ?? 1 }} × S/ {{ Number(item.price).toFixed(2) }}</p>
                </div>
                <span class="summary__item-sub">S/ {{ (Number(item.price) * (item.qty ?? 1)).toFixed(2) }}</span>
              </li>
            </ul>

            <div class="summary__lines">
              <div class="summary__line"><span>Subtotal</span><span>S/ {{ subtotal.toFixed(2) }}</span></div>
              <div v-if="descuento > 0" class="summary__line summary__line--disc">
                <span>Descuento 10% 🎁</span><span>- S/ {{ descuento.toFixed(2) }}</span>
              </div>
              <div class="summary__line">
                <span>Envío <small class="summary__note-inline">(Lima)</small></span>
                <span>S/ {{ envio.toFixed(2) }}</span>
              </div>
              <p class="summary__hint">Provincia: se coordina por WhatsApp (el precio puede variar).</p>
            </div>
          </div>

          <div class="summary__total">
            <span>Total</span>
            <span class="summary__total-amt">S/ {{ total.toFixed(2) }}</span>
          </div>

          <div class="trust">
            <span>🔒 Pago seguro</span><span>🔁 Cambios 7 días</span><span>🚚 Envío a todo el Perú</span>
          </div>
        </aside>
      </div>
    </section>
  </template>

  <!-- Popup de pago: overlay que bloquea el fondo. Solo se puede ingresar la tarjeta
       o cerrar (botón ✕). Teleport al body + z-index moderado para NO tapar el 3DS. -->
  <Teleport to="body">
    <div v-if="mostrarPago" class="pay-modal" role="dialog" aria-modal="true" aria-label="Pago con tarjeta">
      <div class="pay-modal__backdrop" aria-hidden="true"></div>
      <div class="pay-modal__panel">
        <button type="button" class="pay-modal__close" aria-label="Cerrar pago" @click="cerrarPago">✕</button>

        <!-- Combo de marcas: Hebennus × Izipay (genera confianza) -->
        <div class="pay-brands">
          <span class="pay-brands__chip"><img src="/logo.jpeg" alt="Hebennus" /></span>
          <span class="pay-brands__x" aria-hidden="true">×</span>
          <img class="pay-brands__izipay" src="/izipay-logo.png" alt="Izipay" />
        </div>

        <p class="pay-modal__eyebrow">Pago 100% seguro</p>
        <h3 class="pay-modal__title">Pagar con tarjeta</h3>
        <div id="izipay-form" class="izipay-form" kr-popin></div>
        <p v-if="errorPago" class="pay-modal__err field__error" role="alert">{{ errorPago }}</p>

        <!-- Sellos de confianza -->
        <div class="pay-trust">
          <p class="pay-trust__sec">🔒 Pago cifrado · Procesado por Izipay · No guardamos tu tarjeta</p>
          <span class="pay-trust__cards" aria-label="Aceptamos Visa y Mastercard">
            <img class="pay-logo pay-logo--visa" src="/visa.png" alt="Visa" />
            <img class="pay-logo pay-logo--mc" src="/mastercard.svg" alt="Mastercard" />
          </span>
        </div>
      </div>
    </div>
  </Teleport>
</div>
</template>

<style scoped>
/* ── HERO ── */
.page-hero { border-bottom: 1px solid var(--border); padding: 3rem 1.25rem 2.5rem; background: var(--surface-1); }
.page-hero__inner { max-width: 1100px; margin: 0 auto; }
.chip {
  display: inline-block; font-size: 0.68rem; letter-spacing: 0.28em; text-transform: uppercase;
  color: var(--accent-3); padding: 0.35rem 0.9rem; border-radius: var(--radius-pill);
  border: 1px solid var(--border-mid); background: var(--surface-2);
}
.page-hero__title {
  font-family: var(--font-display); font-size: clamp(2rem, 5vw, 3.4rem); font-weight: 800;
  letter-spacing: -0.02em; text-transform: uppercase; color: var(--text-1); line-height: 1.05; margin-top: 0.6rem;
}
.page-hero__sub { margin-top: 0.9rem; font-size: 0.78rem; letter-spacing: 0.04em; color: var(--text-3); }

/* ── BODY ── */
.checkout__body { max-width: 1100px; margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }
.checkout__grid { display: flex; flex-direction: column; gap: 2rem; }

/* ── WIZARD ── */
.wizard { order: 2; display: flex; flex-direction: column; gap: 1.4rem; }
.steps { list-style: none; display: flex; gap: 0.4rem; }
.step { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 0.35rem; cursor: default; opacity: 0.55; transition: opacity 0.25s var(--ease-out); }
.step--active, .step--done { opacity: 1; }
.step--done { cursor: pointer; }
.step__n {
  width: 30px; height: 30px; display: grid; place-items: center; border-radius: var(--radius-pill);
  border: 1px solid var(--border-mid); background: var(--surface-2); color: var(--text-2);
  font-family: var(--font-display); font-weight: 700; font-size: 0.85rem;
  transition: background 0.25s var(--ease-out), color 0.25s var(--ease-out), border-color 0.25s var(--ease-out);
}
.step--active .step__n { background: var(--grad-cool); color: #fff; border-color: transparent; box-shadow: var(--shadow-soft); }
.step--done .step__n { background: var(--surface-3); color: var(--accent-2); border-color: var(--border-mid); }
.step__t { font-size: 0.62rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-2); font-weight: 600; }
.step::after { content: none; }

.form { display: flex; flex-direction: column; gap: 1.4rem; }
.wstep { border: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1rem; animation: hb-fade-up 0.4s var(--ease-out) both; }
.wstep__title { font-family: var(--font-display); font-size: 1rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-1); padding: 0; margin: 0; }
/* Cada sección del paso 1 como tarjeta separada (Tus datos / Dirección) */
.wstep--card { background: var(--surface-1); border: 1px solid var(--border-mid); border-radius: var(--radius-lg); padding: 1.5rem; box-shadow: var(--shadow-soft); }
.form__row { display: grid; grid-template-columns: 1fr; gap: 1rem; }
.form__group { display: flex; flex-direction: column; gap: 0.4rem; }
.field__label { font-size: 0.68rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-2); font-weight: 600; }
.req { color: #e0566b; }
.opt { color: var(--text-3); font-weight: 400; letter-spacing: 0.02em; text-transform: none; }
.field__input {
  background: var(--surface-2); border: 1px solid var(--border-mid); border-radius: var(--radius-sm);
  color: var(--text-1); font-family: var(--font-body); font-size: 0.95rem; padding: 0.75rem 0.85rem;
  outline: none; transition: border-color 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out); width: 100%;
}
.field__input::placeholder { color: var(--text-3); }
.field__input:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--glow-color); }
.field__input--err { border-color: #e0566b; }
.field__textarea { resize: vertical; line-height: 1.5; border-radius: var(--radius-md); }
.field__error { font-size: 0.74rem; color: #e0566b; }
.field__hint { font-size: 0.7rem; color: var(--text-3); }

.doc { display: flex; flex-direction: column; gap: 0.8rem; padding: 1rem 1.1rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-md); }
.doc__toggle { align-self: flex-start; background: none; border: none; color: var(--accent-3); font-size: 0.76rem; cursor: pointer; padding: 0; text-decoration: underline; text-underline-offset: 2px; }

/* ── BENEFICIO ── */
.benefit { display: flex; flex-direction: column; gap: 0.8rem; padding: 1.1rem 1.2rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-md); box-shadow: var(--shadow-soft); }
.benefit__head { font-size: 0.95rem; color: var(--text-1); }
.benefit__head strong { color: var(--accent-3); }
.benefit__sub { font-size: 0.8rem; color: var(--text-2); line-height: 1.5; }
.benefit__opt { display: flex; gap: 0.6rem; align-items: flex-start; font-size: 0.84rem; color: var(--text-2); cursor: pointer; line-height: 1.4; padding: 0.7rem 0.8rem; border: 1px solid var(--border); border-radius: var(--radius-sm); transition: border-color 0.2s var(--ease-out), background 0.2s var(--ease-out); }
.benefit__opt--on { border-color: var(--accent); background: var(--surface-3); }
.benefit__opt input { margin-top: 0.15rem; width: 16px; height: 16px; flex-shrink: 0; accent-color: var(--accent); cursor: pointer; }
.benefit__opt strong { color: var(--accent-3); }
.benefit__pass { margin: 0.1rem 0 0.2rem; }
.benefit__chip { margin-top: 0.4rem; display: inline-block; font-size: 0.74rem; color: var(--accent-2); font-weight: 600; }
.benefit__legal { font-size: 0.7rem; color: var(--text-3); line-height: 1.5; }
.benefit__legal a { color: var(--accent-3); text-decoration: underline; text-underline-offset: 2px; }
.acct-logged { font-size: 0.84rem; color: var(--text-2); }

/* ── PAGO ── */
.pay-methods { display: flex; flex-direction: column; gap: 0.7rem; }
.pay-card { display: flex; gap: 0.8rem; align-items: center; padding: 0.9rem 1rem; border: 1px solid var(--border-mid); border-radius: var(--radius-md); cursor: pointer; background: var(--surface-2); transition: border-color 0.2s var(--ease-out), background 0.2s var(--ease-out), transform 0.2s var(--ease-out); }
.pay-card:hover { border-color: var(--border-mid); transform: translateY(-1px); }
.pay-card--on { border-color: var(--accent); background: var(--surface-3); box-shadow: var(--shadow-soft); }
.pay-card input { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; flex-shrink: 0; }
.pay-card__ico { font-size: 1.3rem; }
.pay-card__info { display: flex; flex-direction: column; gap: 0.1rem; }
.pay-card__info strong { font-size: 0.88rem; color: var(--text-1); }
.pay-card__info small { font-size: 0.72rem; color: var(--text-3); }

/* ── NAV WIZARD ── */
.wizard__nav { display: flex; gap: 0.8rem; justify-content: space-between; }
.btn-step {
  flex: 1; padding: 0.85rem 1rem; border-radius: var(--radius-md); cursor: pointer;
  font-family: var(--font-display); font-size: 0.74rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  transition: transform 0.2s var(--ease-out), background 0.2s var(--ease-out), border-color 0.2s var(--ease-out), color 0.2s var(--ease-out);
}
.btn-step--ghost { background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); }
.btn-step--ghost:hover { border-color: var(--accent); color: var(--text-1); }
.btn-step--next { background: var(--text-1); color: var(--ink); border: 1px solid transparent; }
.btn-step--next:hover { transform: translateY(-2px); box-shadow: var(--shadow-hover); }
.btn-step:active { transform: scale(0.98); }

/* ── SUBMIT (pago) ── */
.checkout__submit {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.55rem; width: 100%; padding: 1rem;
  background: var(--surface-3); color: var(--text-3); border: 1px solid var(--border-mid); border-radius: var(--radius-md);
  font-family: var(--font-display); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; cursor: pointer;
  transition: transform 0.25s var(--ease-out), box-shadow 0.25s var(--ease-out), background-position 0.5s var(--ease-out),
              background-color 0.25s var(--ease-out), border-color 0.25s var(--ease-out), color 0.25s var(--ease-out), opacity 0.2s var(--ease-out);
}
.checkout__submit--ready { background: var(--grad-cool); background-size: 160% 160%; border-color: transparent; color: #fff; box-shadow: var(--shadow-soft); }
.checkout__submit--ready:hover { transform: translateY(-2px); box-shadow: var(--shadow-hover); background-position: 100% 0; }
.checkout__submit--ready:active { transform: scale(0.97); }
.checkout__submit:disabled { opacity: 0.6; cursor: not-allowed; transform: none; box-shadow: none; }
.izipay-form { margin-top: 0.4rem; min-height: 1px; }

/* ── POPUP PROPIO DE PAGO (Teleport al body) — bloquea y difumina todo el fondo ── */
.pay-modal { position: fixed; inset: 0; z-index: 600; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 1.5rem 1rem; }
.pay-modal__backdrop { position: fixed; inset: 0; background: rgba(6, 8, 16, 0.62); backdrop-filter: blur(7px); -webkit-backdrop-filter: blur(7px); animation: pm-fade 0.25s var(--ease-out) both; }
.pay-modal__panel {
  position: relative; z-index: 1; width: 100%; max-width: 440px; margin: auto;
  background: var(--card-bg); border: 1px solid var(--border-mid); border-radius: var(--radius-lg);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5); padding: 1.7rem 1.4rem 1.4rem;
  animation: pm-pop 0.32s var(--ease-spring) both;
}
.pay-modal__close { position: absolute; top: 0.7rem; right: 0.8rem; width: 32px; height: 32px; display: grid; place-items: center; border-radius: var(--radius-pill); background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); cursor: pointer; font-size: 0.85rem; z-index: 2; transition: background 0.2s var(--ease-out), color 0.2s var(--ease-out), transform 0.2s var(--ease-out); }
.pay-modal__close:hover { background: var(--surface-3); color: var(--text-1); transform: scale(1.08); }
.pay-modal__eyebrow { font-size: 0.64rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent-3); }
.pay-modal__title { font-family: var(--font-display); font-size: 1.4rem; font-weight: 800; color: var(--text-1); margin: 0.2rem 0 0.6rem; }
.pay-modal__err { margin-top: 0.8rem; }

/* Combo de marcas: Hebennus × Izipay */
.pay-brands { display: flex; align-items: center; justify-content: center; gap: 0.7rem; margin-bottom: 0.9rem; }
.pay-brands__chip { width: 38px; height: 38px; border-radius: 10px; background: #fff; display: grid; place-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.25); flex: none; }
.pay-brands__chip img { width: 30px; height: 30px; object-fit: contain; }
.pay-brands__x { color: var(--text-3); font-size: 1.1rem; font-weight: 600; }
.pay-brands__izipay { height: 24px; width: auto; display: block; }
/* Sellos de confianza */
.pay-trust { margin-top: 1rem; padding-top: 0.9rem; border-top: 1px solid var(--border-mid); display: flex; flex-direction: column; align-items: center; gap: 0.6rem; }
.pay-trust__sec { margin: 0; font-size: 0.72rem; color: var(--text-3); text-align: center; line-height: 1.5; }
.pay-trust__cards { display: flex; align-items: center; gap: 0.7rem; }
.pay-logo { display: block; width: auto; }
.pay-logo--visa { height: 16px; }
.pay-logo--mc { height: 22px; }

@keyframes pm-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes pm-pop { from { opacity: 0; transform: translateY(14px) scale(0.98); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .pay-modal__panel, .pay-modal__backdrop { animation: none; } }

/* ── SUMMARY ── */
.summary { order: 1; background: var(--card-bg); border: 1px solid var(--border-mid); border-radius: var(--radius-lg); box-shadow: var(--shadow-soft); padding: 1.4rem; display: flex; flex-direction: column; gap: 1rem; }
.summary__toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 0.65rem 0.9rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-md); font-family: var(--font-display); font-size: 0.72rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-1); font-weight: 600; transition: border-color 0.2s var(--ease-out), background 0.2s var(--ease-out); }
.summary__toggle:hover { border-color: var(--border-mid); background: var(--surface-3); }
.summary__toggle:active { transform: scale(0.99); }
.summary__title { font-size: 0.72rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-2); font-family: var(--font-display); font-weight: 600; }
.summary__list { list-style: none; display: flex; flex-direction: column; gap: 1rem; margin-top: 0.25rem; }
.summary__item { display: flex; gap: 0.8rem; align-items: flex-start; }
.summary__item-img { width: 48px; height: 62px; flex-shrink: 0; background: var(--surface-2); border-radius: var(--radius-sm); overflow: hidden; }
.summary__item-img img { width: 100%; height: 100%; object-fit: cover; }
.summary__item-ph { width: 100%; height: 100%; display: grid; place-items: center; font-family: var(--font-display); color: var(--text-3); }
.summary__item-info { flex: 1; min-width: 0; }
.summary__item-name { font-size: 0.82rem; color: var(--text-1); font-weight: 500; line-height: 1.3; }
.summary__item-meta { font-size: 0.72rem; color: var(--text-3); letter-spacing: 0.03em; margin-top: 0.15rem; }
.summary__item-unit { font-size: 0.72rem; color: var(--text-3); margin-top: 0.1rem; }
.summary__item-sub { font-size: 0.82rem; color: var(--text-1); font-weight: 600; white-space: nowrap; }
.summary__lines { display: flex; flex-direction: column; gap: 0.5rem; border-top: 1px solid var(--border); padding-top: 1rem; }
.summary__line { display: flex; justify-content: space-between; font-size: 0.82rem; color: var(--text-2); }
.summary__note-inline { color: var(--text-3); font-size: 0.72rem; }
.summary__line--disc { color: var(--accent-2); font-weight: 600; }
.summary__hint { font-size: 0.7rem; color: var(--accent-3); letter-spacing: 0.02em; }
.summary__total { display: flex; justify-content: space-between; align-items: baseline; border-top: 1px solid var(--border); padding-top: 1rem; }
.summary__total span:first-child { font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-2); }
.summary__total-amt { font-family: var(--font-display); font-size: 1.3rem; font-weight: 700; color: var(--text-1); }
.summary__send-err { font-size: 0.76rem; color: #e0566b; }
.ship-note { margin-top: 0.2rem; padding: 0.85rem 1rem; background: var(--surface-2); border: 1px solid var(--border-mid); border-radius: var(--radius-md); font-size: 0.76rem; line-height: 1.55; color: var(--text-2); }
.ship-note strong { color: var(--text-1); font-weight: 600; }
.ship-note__link { display: inline-block; margin-top: 0.3rem; color: var(--accent-3); text-decoration: underline; text-underline-offset: 2px; font-weight: 600; }
.summary__note-ok { font-size: 0.76rem; color: var(--accent-2); line-height: 1.5; }
.summary__note { text-align: center; font-size: 0.68rem; color: var(--text-3); letter-spacing: 0.03em; }
.trust { display: flex; flex-wrap: wrap; gap: 0.5rem 0.9rem; border-top: 1px solid var(--border); padding-top: 0.9rem; font-size: 0.68rem; color: var(--text-3); }

.spinner { width: 15px; height: 15px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 1.6s; } .wstep { animation: none; } }

/* ── STATES (éxito) ── */
.state { max-width: 560px; margin: 0 auto; padding: 5rem 1.5rem; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 1rem; animation: hb-fade-up 0.55s var(--ease-out) both; }
@keyframes hb-fade-up { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
.state__icon { color: var(--accent-2); background: var(--surface-2); border-radius: var(--radius-pill); padding: 1rem; box-shadow: var(--shadow-soft); animation: state-pop 0.5s var(--ease-spring) both; }
.state__icon--yape { color: var(--accent-3); }
@keyframes state-pop { 0% { transform: scale(0); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
.state__title { font-family: var(--font-display); font-size: 1.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: -0.01em; color: var(--text-1); }
.state__num { font-size: 0.9rem; color: var(--text-2); letter-spacing: 0.04em; }
.state__msg { font-size: 0.9rem; color: var(--text-2); line-height: 1.7; }
.state__cta { margin-top: 0.5rem; padding: 0.9rem 2.2rem; background: var(--text-1); color: var(--ink); border-radius: var(--radius-pill); box-shadow: var(--shadow-soft); font-family: var(--font-display); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; transition: background 0.25s var(--ease-out), color 0.25s var(--ease-out), transform 0.25s var(--ease-out), box-shadow 0.25s var(--ease-out); }
.state__cta:hover { background: var(--accent); color: var(--ink); transform: translateY(-2px); box-shadow: var(--shadow-hover); }
.state__cta:active { transform: scale(0.97); }
.state__cta--wa { background: #25d366; color: #04210f; }
.state__cta--wa:hover { background: #1ebe5a; color: #04210f; }
.state__link { font-size: 0.78rem; color: var(--text-3); text-decoration: underline; text-underline-offset: 3px; }
.state__link:hover { color: var(--text-1); }

/* ── DESKTOP ── */
@media (min-width: 861px) {
  .page-hero { padding: 3.5rem 2rem 3rem; }
  .checkout__body { padding: 3rem 2rem 6rem; }
  .checkout__grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 3rem; align-items: start; }
  .wizard { order: 1; }
  .form__row { grid-template-columns: 1fr 1fr; }
  .summary { order: 2; position: sticky; top: 1.5rem; padding: 1.5rem; }
  .step__t { font-size: 0.66rem; }
}
</style>

<!-- Estilos GLOBALES (no scoped) para el POPUP NATIVO de Izipay (krypton). krypton lo
     inyecta en el <body>, fuera del scope. Clases reales de classic-reset.css. NO se
     fuerzan z-index ni se envuelve en un modal propio: krypton maneja su propia capa
     (incluido el 3DS), por eso el pago SÍ se completa. Solo lo dejamos bonito. -->
<style>
/* Fondo del popup: oscurece y DIFUMINA todo lo de atrás (el blur + bloqueo que querías) */
.kr-popin-background {
  background: rgba(6, 8, 16, 0.62) !important;
  backdrop-filter: blur(7px) !important;
  -webkit-backdrop-filter: blur(7px) !important;
}

/* Contenedor del popup: permite scroll si el formulario no entra en pantalla */
.kr-popin-wrapper,
.kr-popin-wrapper--large-form {
  overflow-y: auto !important;
}

/* Caja del modal: redondeada con sombra */
.kr-modal {
  border-radius: 20px !important;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5) !important;
}

/* Botón de cerrar: SIEMPRE visible (escape ante cualquier cuelgue, p.ej. 3DS) */
.kr-close-popup {
  display: flex !important;
  visibility: visible !important;
  opacity: 0.9 !important;
  cursor: pointer !important;
  z-index: 10 !important;
  transition: opacity 0.2s ease, transform 0.2s ease !important;
}
.kr-close-popup:hover { opacity: 1 !important; transform: scale(1.1) !important; }

/* Campos de tarjeta: redondeados con foco resaltado */
.kr-field { border-radius: 12px !important; transition: box-shadow 0.2s ease, border-color 0.2s ease !important; }
.kr-field.kr-focus { box-shadow: 0 0 0 3px rgba(91, 141, 239, 0.28) !important; border-color: #5b8def !important; }

/* Botón de pago: degradado de marca + animación al pasar el mouse */
.kr-payment-button {
  background: linear-gradient(120deg, #5b8def, #8b5cf6) !important;
  background-size: 180% 180% !important;
  border: none !important; border-radius: 14px !important; font-weight: 700 !important; letter-spacing: 0.04em !important;
  box-shadow: 0 8px 24px rgba(91, 141, 239, 0.35) !important;
  transition: transform 0.25s ease, box-shadow 0.25s ease, background-position 0.6s ease !important;
}
.kr-payment-button:hover { transform: translateY(-2px) !important; background-position: 100% 0 !important; box-shadow: 0 12px 32px rgba(139, 92, 246, 0.45) !important; }
.kr-payment-button:active { transform: scale(0.98) !important; }
@media (prefers-reduced-motion: reduce) { .kr-payment-button { transition: none !important; } }
</style>
