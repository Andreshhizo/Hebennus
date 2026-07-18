<script setup>
// ─── Panel admin · Vista CAMPAÑAS (email marketing) ─────────────────────────
// Redacta y envía campañas de correo a los contactos con consentimiento
// (marketing_contacts). El envío pasa por la Edge Function admin-enviar-campana
// (valida is_admin() y usa Resend server-side); aquí solo se muestra el
// formulario, el conteo de destinatarios y el historial de envíos (tabla
// campaigns, leída por RLS campaigns_admin_select).
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase.js'

// ── Formulario (nueva campaña) ──
const asunto   = ref('')   // requerido
const titulo   = ref('')   // opcional
const cuerpo   = ref('')   // requerido
const ctaTexto = ref('')   // opcional
const ctaUrl   = ref('')   // opcional

// ── Estado ──
const destinatarios = ref(null)   // conteo de contactos con consentimiento
const historial     = ref([])
const enviando      = ref(false)  // true mientras corre un invoke
const cargandoHist  = ref(false)
const aviso         = ref('')     // validación inline (asunto/cuerpo vacíos)
const feedback      = ref(null)   // { tipo:'ok'|'error', texto }

// Conteo de destinatarios con consentimiento (permitido por RLS mc_admin_select).
async function cargarDestinatarios() {
  try {
    const { count, error } = await supabase
      .from('marketing_contacts')
      .select('*', { count: 'exact', head: true })
      .eq('consent', true)
      .is('unsubscribed_at', null)
    if (error) throw error
    destinatarios.value = count ?? 0
  } catch (e) {
    destinatarios.value = 0
    feedback.value = { tipo: 'error', texto: 'No se pudo obtener el conteo de destinatarios: ' + (e.message || e) }
  }
}

// Historial de campañas (permitido por RLS campaigns_admin_select).
async function cargarHistorial() {
  cargandoHist.value = true
  try {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    historial.value = data || []
  } catch (e) {
    feedback.value = { tipo: 'error', texto: 'No se pudo cargar el historial: ' + (e.message || e) }
  } finally {
    cargandoHist.value = false
  }
}

// Asunto y cuerpo son obligatorios antes de cualquier envío.
function validar() {
  if (!asunto.value.trim() || !cuerpo.value.trim()) {
    aviso.value = 'El asunto y el cuerpo son obligatorios.'
    return false
  }
  aviso.value = ''
  return true
}

// Arma el body con el contrato de la Edge Function (campos opcionales omitidos).
function armarBody(extra = {}) {
  return {
    subject:  asunto.value.trim(),
    title:    titulo.value.trim() || undefined,
    body:     cuerpo.value.trim(),
    cta_text: ctaTexto.value.trim() || undefined,
    cta_url:  ctaUrl.value.trim() || undefined,
    ...extra,
  }
}

// Prueba: se envía solo al admin (test:true). Respuesta { ok, test:true, sent:1 }.
async function enviarPrueba() {
  if (enviando.value || !validar()) return
  enviando.value = true
  feedback.value = null
  try {
    const { data, error } = await supabase.functions.invoke('admin-enviar-campana', {
      body: armarBody({ test: true }),
    })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
    feedback.value = { tipo: 'ok', texto: '✓ Prueba enviada a tu correo.' }
  } catch (e) {
    feedback.value = { tipo: 'error', texto: 'No se pudo enviar la prueba: ' + (e.message || e) }
  } finally {
    enviando.value = false
  }
}

// Envío real a todos: confirma con el conteo, invoca sin `test`, refresca historial.
// Respuesta { ok, recipients, sent, failed, campaign_id }.
async function enviarTodos() {
  if (enviando.value || !validar()) return
  const n = destinatarios.value ?? 0
  const ok = confirm(
    `¿Enviar esta campaña a ${n} destinatario(s) con consentimiento?\n` +
    `Esta acción no se puede deshacer.`,
  )
  if (!ok) return
  enviando.value = true
  feedback.value = null
  try {
    const { data, error } = await supabase.functions.invoke('admin-enviar-campana', {
      body: armarBody(),
    })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
    feedback.value = {
      tipo: 'ok',
      texto: `✓ Campaña enviada: ${data?.sent ?? 0}/${data?.recipients ?? n} correos.`,
    }
    await cargarHistorial()
  } catch (e) {
    feedback.value = { tipo: 'error', texto: 'No se pudo enviar la campaña: ' + (e.message || e) }
  } finally {
    enviando.value = false
  }
}

function fmtFecha(s) {
  try { return new Date(s).toLocaleString('es-PE') } catch { return s }
}

onMounted(() => { cargarDestinatarios(); cargarHistorial() })
</script>

<template>
<div class="cmp">
  <!-- ── Nueva campaña ── -->
  <section class="cmp__card" aria-label="Nueva campaña de correo">
    <h3 class="cmp__h3">Nueva campaña</h3>

    <div class="cmp__form">
      <div class="cmp__field">
        <label class="cmp__label" for="cmp-asunto">Asunto <span class="cmp__req">*</span></label>
        <input id="cmp-asunto" v-model="asunto" type="text" class="cmp__input"
               placeholder="Asunto del correo" :disabled="enviando" />
      </div>

      <div class="cmp__field">
        <label class="cmp__label" for="cmp-titulo">Título <span class="cmp__opt">(opcional)</span></label>
        <input id="cmp-titulo" v-model="titulo" type="text" class="cmp__input"
               placeholder="Encabezado destacado dentro del correo" :disabled="enviando" />
      </div>

      <div class="cmp__field">
        <label class="cmp__label" for="cmp-cuerpo">Cuerpo del mensaje <span class="cmp__req">*</span></label>
        <textarea id="cmp-cuerpo" v-model="cuerpo" class="cmp__input cmp__textarea" rows="6"
                  placeholder="Escribe el contenido de la campaña…" :disabled="enviando"></textarea>
      </div>

      <div class="cmp__row">
        <div class="cmp__field">
          <label class="cmp__label" for="cmp-cta-texto">Texto del botón <span class="cmp__opt">(opcional)</span></label>
          <input id="cmp-cta-texto" v-model="ctaTexto" type="text" class="cmp__input"
                 placeholder="Ej. Ver la colección" :disabled="enviando" />
        </div>
        <div class="cmp__field">
          <label class="cmp__label" for="cmp-cta-url">Enlace del botón <span class="cmp__opt">(opcional)</span></label>
          <input id="cmp-cta-url" v-model="ctaUrl" type="url" class="cmp__input"
                 placeholder="https://…" :disabled="enviando" />
        </div>
      </div>
    </div>

    <!-- Conteo de destinatarios -->
    <p class="cmp__dest">
      <span v-if="destinatarios === null" class="cmp__dest-muted">Cargando destinatarios…</span>
      <span v-else><strong>{{ destinatarios }}</strong> destinatarios con consentimiento</span>
    </p>

    <!-- Validación inline -->
    <p v-if="aviso" class="cmp__aviso" role="alert">{{ aviso }}</p>

    <!-- Acciones -->
    <div class="cmp__actions">
      <button class="cmp__btn cmp__btn--ghost" :disabled="enviando" @click="enviarPrueba">
        <span v-if="enviando" class="spinner spinner--sm"></span>
        Enviar prueba a mí
      </button>
      <button class="cmp__btn cmp__btn--primary" :disabled="enviando" @click="enviarTodos">
        <span v-if="enviando" class="spinner spinner--sm"></span>
        Enviar a todos ({{ destinatarios ?? 0 }})
      </button>
    </div>

    <!-- Feedback del envío -->
    <p v-if="feedback"
       :class="['cmp__feedback', feedback.tipo === 'error' ? 'cmp__feedback--err' : 'cmp__feedback--ok']"
       role="status">
      {{ feedback.texto }}
    </p>
  </section>

  <!-- ── Historial ── -->
  <section class="cmp__hist" aria-label="Historial de campañas">
    <div class="cmp__bar">
      <h3 class="cmp__h3">Historial de campañas</h3>
      <button class="cmp__refresh" :disabled="cargandoHist" @click="cargarHistorial">↻ Actualizar</button>
    </div>

    <div v-if="cargandoHist" class="cmp__center"><span class="spinner"></span></div>

    <p v-else-if="!historial.length" class="cmp__empty">Aún no se han enviado campañas.</p>

    <ul v-else class="cmps">
      <li v-for="c in historial" :key="c.id" class="camp">
        <div class="camp__main">
          <span class="camp__asunto">{{ c.subject }}</span>
          <span class="camp__fecha">{{ fmtFecha(c.created_at) }}</span>
        </div>
        <div class="camp__right">
          <span class="camp__stats">{{ c.sent_count ?? 0 }}/{{ c.recipients_count ?? 0 }} enviados</span>
          <span class="badge" :style="{ '--c': c.status === 'enviada' ? 'var(--success)' : 'var(--danger)' }">
            {{ c.status === 'enviada' ? 'Enviada' : 'Error' }}
          </span>
        </div>
      </li>
    </ul>
  </section>
</div>
</template>

<style scoped>
.cmp { display: flex; flex-direction: column; gap: 1.5rem; }

/* ── Tarjeta de nueva campaña ── */
.cmp__card { border: 1px solid var(--border-mid); background: var(--card-bg); border-radius: var(--radius-md); padding: 1.25rem; }
.cmp__h3 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-2); margin-bottom: 1rem; }

/* ── Formulario ── */
.cmp__form { display: flex; flex-direction: column; gap: 0.9rem; }
.cmp__row { display: flex; gap: 0.9rem; flex-wrap: wrap; }
.cmp__row .cmp__field { flex: 1; min-width: 200px; }
.cmp__field { display: flex; flex-direction: column; gap: 0.35rem; }
.cmp__label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); font-weight: 600; }
.cmp__req { color: var(--danger); }
.cmp__opt { color: var(--text-3); font-weight: 400; text-transform: none; letter-spacing: 0; }
.cmp__input { background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); padding: 0.6rem 0.85rem; font-size: 0.88rem; outline: none; border-radius: var(--radius-sm); font-family: inherit; }
.cmp__input:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--glow-color); }
.cmp__input:disabled { opacity: 0.6; cursor: not-allowed; }
.cmp__textarea { resize: vertical; line-height: 1.6; min-height: 120px; }

/* ── Conteo de destinatarios ── */
.cmp__dest { font-size: 0.82rem; color: var(--text-2); margin-top: 1rem; }
.cmp__dest strong { color: var(--text-1); }
.cmp__dest-muted { color: var(--text-3); }

/* ── Validación / feedback ── */
.cmp__aviso { font-size: 0.78rem; color: var(--danger); margin-top: 0.6rem; }
.cmp__feedback { font-size: 0.8rem; margin-top: 0.8rem; }
.cmp__feedback--ok { color: var(--success); }
.cmp__feedback--err { color: var(--danger); }

/* ── Acciones ── */
.cmp__actions { display: flex; gap: 0.6rem; margin-top: 1rem; flex-wrap: wrap; }
.cmp__btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.7rem 1.1rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; border-radius: var(--radius-sm); transition: filter 0.15s ease, border-color 0.2s ease, color 0.2s ease; }
.cmp__btn:disabled { opacity: 0.6; cursor: not-allowed; }
.cmp__btn--ghost { background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); }
.cmp__btn--ghost:hover:not(:disabled) { color: var(--text-1); border-color: var(--accent); }
.cmp__btn--primary { background: var(--accent); border: 1px solid var(--accent); color: var(--on-accent); }
.cmp__btn--primary:hover:not(:disabled) { filter: brightness(1.08); }

/* ── Historial ── */
.cmp__hist { border: 1px solid var(--border-mid); background: var(--card-bg); border-radius: var(--radius-md); padding: 1.25rem; }
.cmp__bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
.cmp__bar .cmp__h3 { margin-bottom: 0; }
.cmp__refresh { padding: 0.5rem 0.9rem; font-size: 0.72rem; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); cursor: pointer; border-radius: var(--radius-sm); }
.cmp__refresh:hover:not(:disabled) { color: var(--text-1); }
.cmp__refresh:disabled { opacity: 0.6; cursor: not-allowed; }
.cmp__center { display: grid; place-items: center; padding: 2.5rem 0; }
.cmp__empty { color: var(--text-3); padding: 2.5rem 0; text-align: center; }

.cmps { list-style: none; display: flex; flex-direction: column; gap: 0.6rem; }
.camp { display: flex; justify-content: space-between; align-items: center; gap: 1rem; border: 1px solid var(--border); background: var(--surface-2); border-radius: var(--radius-sm); padding: 0.8rem 1rem; flex-wrap: wrap; }
.camp__main { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.camp__asunto { font-family: var(--font-display); font-weight: 700; font-size: 0.9rem; color: var(--text-1); }
.camp__fecha { font-size: 0.72rem; color: var(--text-3); }
.camp__right { display: flex; align-items: center; gap: 0.8rem; white-space: nowrap; }
.camp__stats { font-size: 0.76rem; color: var(--text-2); }
.badge { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.2rem 0.55rem; border-radius: var(--radius-pill); color: var(--c); border: 1px solid var(--c); }

/* ── Spinner ── */
.spinner { width: 22px; height: 22px; border: 2px solid var(--text-3); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
.spinner--sm { width: 14px; height: 14px; border-width: 2px; border-color: currentColor; border-top-color: transparent; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 560px) {
  .cmp__row { flex-direction: column; }
}
</style>
