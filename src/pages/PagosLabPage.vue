<script setup>
// ─── LABORATORIO DE PAGOS (/lab-pagos) — SOLO DESARROLLO ─────────────────────
// Versión enfocada: SOLO la sección de pagar + los paneles con la RESPUESTA CRUDA
// de la API de Izipay (al crear el pago y al pagar). Usa el mismo motor que el
// checkout real (getFormTokenTest → API Izipay; montarFormularioIzipay → krypton).
// La ruta solo existe en dev (ver router). Cada intento se registra en /admin →
// "Tests de pago" como historial.
import { ref, nextTick } from 'vue'
import { RouterLink } from 'vue-router'
import { getFormTokenTest, montarFormularioIzipay, removeForms } from '../lib/izipay.js'
import { supabase } from '../lib/supabase.js'

const monto       = ref(59.9)
const generando   = ref(false)
const mostrarForm = ref(false)   // formulario de Izipay (popin) visible
const errorGen    = ref('')
const apiCrear    = ref(null)    // respuesta de CreatePayment (panel 1)
const apiPago     = ref(null)    // respuesta del pago/resultado (panel 2)
const banner      = ref(null)    // { ok, texto }

const bonito = (x) => { try { return JSON.stringify(x, null, 2) } catch { return String(x) } }

async function pagar() {
  if (generando.value) return
  errorGen.value = ''
  banner.value = null
  apiCrear.value = null
  apiPago.value = null
  generando.value = true
  try {
    const tok = await getFormTokenTest(monto.value)
    apiCrear.value = tok.apiResponse ?? tok        // respuesta cruda de CreatePayment
    mostrarForm.value = true
    await nextTick()
    await montarFormularioIzipay({
      ...tok,
      selector: '#lab-izipay-form',
      onResult: (info) => { apiPago.value = info.clientAnswer ?? info.raw },  // respuesta del pago
      onPaid:   () => terminar(true),
      onError:  (m) => terminar(false, m),
      onClosed: () => { mostrarForm.value = false },
    })
  } catch (e) {
    errorGen.value = 'No se pudo generar el pago de prueba: ' + (e?.message || e)
  } finally {
    generando.value = false
  }
}

async function terminar(ok, msg) {
  removeForms()
  mostrarForm.value = false
  // Extrae datos legibles de la respuesta cruda para el banner y el registro.
  const tx    = apiPago.value?.transactions?.[0]
  const marca = tx?.transactionDetails?.cardDetails?.effectiveBrand
  const pan   = tx?.transactionDetails?.cardDetails?.pan
  const con3ds = tx?.effectiveStrongAuthentication === 'ENABLED'
  const errTx = tx?.errorMessage || tx?.detailedErrorMessage
  const texto = ok
    ? `Pago aprobado (PAID)${marca ? ' · ' + marca : ''}${con3ds ? ' · 3DS OK' : ''} · S/ ${Number(monto.value).toFixed(2)}`
    : `Pago no completado${msg ? ' — ' + msg : ''}${errTx ? ' — ' + errTx : ''}`
  banner.value = { ok, texto }
  // Registro silencioso en el historial del admin ("Tests de pago").
  try {
    await supabase.from('payment_tests').insert({
      metodo: marca ? `Tarjeta ${marca}` : 'Tarjeta (lab)',
      tarjeta: pan || 'ingresada manualmente',
      escenario: con3ds ? '3DS' : '—',
      order_status: ok ? 'PAID' : 'UNPAID',
      resultado: ok ? 'exito' : 'fallo',
      detalle: ok ? 'Pago aprobado' : (errTx || msg || 'No completado'),
      monto: Number(monto.value),
    })
  } catch { /* no bloquea la prueba si el registro falla */ }
}

async function copiar(x) {
  try { await navigator.clipboard.writeText(bonito(x)) } catch { /* noop */ }
}
</script>

<template>
<div class="lab">
  <section class="page-hero">
    <div class="page-hero__inner">
      <span class="chip">Solo desarrollo</span>
      <h1 class="page-hero__title">Laboratorio de pagos</h1>
      <p class="page-hero__sub">Paga con una tarjeta de prueba y observa la respuesta real de la API de Izipay.</p>
    </div>
  </section>

  <section class="lab__body">
    <!-- ── Pagar ── -->
    <div class="card">
      <h2 class="card__title">Pagar (prueba)</h2>
      <div class="pay-row">
        <label class="f">
          <span>Monto (S/)</span>
          <input v-model.number="monto" type="number" step="0.10" min="1" />
        </label>
        <button type="button" class="btn-main" :disabled="generando" @click="pagar">
          <span v-if="generando" class="spinner"></span>
          {{ generando ? 'Generando…' : 'Pagar (prueba)' }}
        </button>
      </div>

      <p v-if="errorGen" class="err">{{ errorGen }}</p>

      <p class="hint">
        Al pulsar se abre el formulario de Izipay. Ingresa una tarjeta de prueba —
        aceptada <strong>4970 1000 0000 0055</strong>, rechazada <strong>3600 0000 0000 57</strong>,
        3DS <strong>4970 1000 0000 0014</strong> (código <strong>1234</strong>) — con venc.
        <strong>12/30</strong>, CVV <strong>123</strong>, titular <strong>JUAN PEREZ</strong>.
      </p>

      <!-- Banner de resultado -->
      <div v-if="banner" class="banner" :class="banner.ok ? 'is-ok' : 'is-fail'">
        <strong>{{ banner.ok ? '✓' : '✕' }}</strong> {{ banner.texto }}
      </div>
    </div>

    <!-- Host del formulario de Izipay (popup nativo) -->
    <div v-if="mostrarForm" id="lab-izipay-form" class="izipay-form" kr-popin></div>

    <!-- ── Panel 1: respuesta al crear el pago ── -->
    <div v-if="apiCrear" class="card">
      <div class="card__head">
        <h2 class="card__title">1 · Respuesta de la API — crear el pago (CreatePayment)</h2>
        <button type="button" class="copy" @click="copiar(apiCrear)">Copiar</button>
      </div>
      <pre class="json">{{ bonito(apiCrear) }}</pre>
    </div>

    <!-- ── Panel 2: respuesta del pago ── -->
    <div v-if="apiPago" class="card">
      <div class="card__head">
        <h2 class="card__title">2 · Respuesta de la API — resultado del pago</h2>
        <button type="button" class="copy" @click="copiar(apiPago)">Copiar</button>
      </div>
      <pre class="json">{{ bonito(apiPago) }}</pre>
    </div>

    <p class="lab__links">
      <RouterLink to="/admin">Ver historial en el panel admin → “Tests de pago”</RouterLink>
    </p>
  </section>
</div>
</template>

<style scoped>
.page-hero { border-bottom: 1px solid var(--border); padding: 3rem 1.25rem 2.5rem; background: var(--surface-1); }
.page-hero__inner { max-width: 920px; margin: 0 auto; }
.chip { display: inline-block; font-size: 0.68rem; letter-spacing: 0.22em; text-transform: uppercase; color: #e0a23b; padding: 0.35rem 0.9rem; border-radius: var(--radius-pill); border: 1px solid var(--border-mid); background: var(--surface-2); }
.page-hero__title { font-family: var(--font-display); font-size: clamp(1.8rem, 5vw, 3rem); font-weight: 800; letter-spacing: -0.02em; text-transform: uppercase; color: var(--text-1); margin-top: 0.6rem; }
.page-hero__sub { margin-top: 0.9rem; font-size: 0.82rem; color: var(--text-3); }

.lab__body { max-width: 920px; margin: 0 auto; padding: 2rem 1.25rem 5rem; display: flex; flex-direction: column; gap: 1.5rem; }
.card { background: var(--card-bg); border: 1px solid var(--border-mid); border-radius: var(--radius-lg); box-shadow: var(--shadow-soft); padding: 1.4rem; }
.card__head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.8rem; }
.card__title { font-family: var(--font-display); font-size: 0.95rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-1); }

.pay-row { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; }
.f { display: flex; flex-direction: column; gap: 0.35rem; }
.f span { font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-2); font-weight: 600; }
.f input { background: var(--surface-2); border: 1px solid var(--border-mid); border-radius: var(--radius-sm); color: var(--text-1); font-size: 0.95rem; padding: 0.7rem 0.8rem; outline: none; width: 140px; }
.f input:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--glow-color); }

.btn-main { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.8rem 1.6rem; background: var(--grad-cool); color: #fff; border: none; border-radius: var(--radius-md); font-family: var(--font-display); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer; box-shadow: var(--shadow-soft); transition: transform 0.2s, box-shadow 0.2s; }
.btn-main:hover { transform: translateY(-2px); box-shadow: var(--shadow-hover); }
.btn-main:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

.err { color: var(--danger); font-size: 0.82rem; margin: 0.8rem 0 0; }
.hint { font-size: 0.74rem; color: var(--text-3); line-height: 1.7; margin-top: 0.9rem; }
.hint strong { color: var(--text-1); }

.banner { margin-top: 1rem; padding: 0.8rem 1rem; border-radius: var(--radius-md); font-size: 0.86rem; line-height: 1.4; }
.banner.is-ok { background: rgba(46, 204, 143, 0.14); border: 1px solid var(--success); color: var(--text-1); }
.banner.is-fail { background: rgba(224, 86, 107, 0.12); border: 1px solid var(--danger); color: var(--text-1); }

.copy { background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); font-size: 0.72rem; padding: 0.35rem 0.7rem; border-radius: var(--radius-pill); cursor: pointer; transition: border-color 0.2s, color 0.2s; }
.copy:hover { border-color: var(--accent); color: var(--text-1); }
.json { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem; font-family: ui-monospace, monospace; font-size: 0.76rem; line-height: 1.5; color: var(--text-1); overflow: auto; max-height: 420px; white-space: pre; }

.izipay-form { min-height: 1px; }
.lab__links { text-align: center; }
.lab__links a { color: var(--accent-3); text-decoration: underline; text-underline-offset: 3px; font-size: 0.84rem; }

.spinner { width: 15px; height: 15px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>

<!-- Estilo del popup nativo de Izipay (global, krypton inyecta fuera del scope). -->
<style>
.kr-popin-background { background: rgba(6, 8, 16, 0.62) !important; backdrop-filter: blur(7px) !important; -webkit-backdrop-filter: blur(7px) !important; }
.kr-popin-wrapper, .kr-popin-wrapper--large-form { overflow-y: auto !important; }
.kr-modal { border-radius: 20px !important; box-shadow: 0 30px 80px rgba(0,0,0,0.5) !important; }
.kr-close-popup { display: flex !important; visibility: visible !important; opacity: 0.9 !important; cursor: pointer !important; z-index: 10 !important; }
.kr-payment-button { background: linear-gradient(120deg, #4566A0, #35528A) !important; border: none !important; border-radius: 14px !important; font-weight: 700 !important; }
</style>
