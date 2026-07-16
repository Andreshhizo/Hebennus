<script setup>
// ─── Panel admin · Vista RECLAMOS (bandeja de tickets) ──────────────────────
// Lista los reclamos de soporte (tabla support_tickets) con filtro por estado,
// buscador y detalle en modal. El cambio de estado se hace vía la RPC
// admin_set_ticket_status (SECURITY DEFINER + gate is_admin()) con actualización
// optimista + revert on error, replicando el patrón `cambiarEstado` de AdminPage.
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase.js'
import { ESTADOS, ESTADO_LABEL, ESTADO_COLOR } from '../lib/reclamos.js'

// ── Estado de datos ──
const tickets   = ref([])
const cargando  = ref(false)
const error     = ref('')

// ── Filtros / búsqueda ──
const filtro    = ref('todos')   // 'todos' | uno de ESTADOS
const busqueda  = ref('')        // por ticket_number / nombre / email / order_number

// ── Detalle (modal) + cambio de estado ──
const detalle   = ref(null)      // reclamo abierto en el modal
const estadoBusy = ref(null)     // id del reclamo cuyo estado se está cambiando
const estadoMsg  = ref({})       // { [ticketId]: { tipo:'ok'|'error', texto } }

async function cargar() {
  cargando.value = true
  error.value = ''
  try {
    // Lee por RLS con la sesión admin (política support_tickets_admin_select).
    const { data, error: e } = await supabase
      .from('support_tickets')
      .select('*')
      .order('created_at', { ascending: false })
    if (e) throw e
    tickets.value = data || []
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    cargando.value = false
  }
}

// 1) Filtro por estado (chips).
const ticketsFiltrados = computed(() =>
  filtro.value === 'todos' ? tickets.value : tickets.value.filter(t => t.status === filtro.value),
)
// 2) Búsqueda de texto sobre el resultado del filtro.
const ticketsBuscados = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  if (!q) return ticketsFiltrados.value
  return ticketsFiltrados.value.filter(t =>
    (t.ticket_number || '').toLowerCase().includes(q) ||
    (t.name          || '').toLowerCase().includes(q) ||
    (t.email         || '').toLowerCase().includes(q) ||
    (t.order_number  || '').toLowerCase().includes(q),
  )
})

const totalTickets = computed(() => tickets.value.length)
const nuevos       = computed(() => tickets.value.filter(t => t.status === 'nuevo').length)

// Cambia el estado del reclamo vía RPC admin_set_ticket_status, con
// actualización optimista + revert y mensaje por-fila (patrón de AdminPage).
async function cambiarEstado(ticket, nuevo) {
  if (!nuevo || nuevo === ticket.status || estadoBusy.value) return
  const anterior = ticket.status
  estadoBusy.value = ticket.id
  estadoMsg.value = { ...estadoMsg.value, [ticket.id]: null }
  try {
    const { error: e } = await supabase.rpc('admin_set_ticket_status', {
      p_ticket_number: ticket.ticket_number,
      p_status: nuevo,
    })
    if (e) throw e
    ticket.status = nuevo
    estadoMsg.value = { ...estadoMsg.value, [ticket.id]: { tipo: 'ok', texto: '✓ Estado actualizado' } }
  } catch (err) {
    const m = err?.message || ''
    const texto =
      m.includes('NO_AUTORIZADO')        ? 'No tienes permisos de administrador.' :
      m.includes('ESTADO_INVALIDO')      ? 'Estado no válido.' :
      m.includes('RECLAMO_NO_ENCONTRADO')? 'No se encontró el reclamo.' :
      'No se pudo actualizar el estado: ' + m
    ticket.status = anterior   // revert
    estadoMsg.value = { ...estadoMsg.value, [ticket.id]: { tipo: 'error', texto } }
  } finally {
    estadoBusy.value = null
  }
}

// ── Detalle (modal) ──
function abrirDetalle(t) { detalle.value = t }
function cerrarDetalle() { detalle.value = null }

function fmtFecha(s) {
  try { return new Date(s).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }) }
  catch { return s }
}

onMounted(cargar)
</script>

<template>
<div class="tk">
  <!-- Barra: contador + refrescar -->
  <div class="tk__bar">
    <p class="tk__meta">
      {{ totalTickets }} reclamos
      <span v-if="nuevos" class="tk__nuevo">{{ nuevos }} nuevo(s)</span>
    </p>
    <button class="tk__refresh" :disabled="cargando" @click="cargar">↻ Actualizar</button>
  </div>

  <!-- Filtros por estado (chips) -->
  <div class="tk__filters">
    <button :class="['chip', { 'chip--on': filtro === 'todos' }]" @click="filtro = 'todos'">Todos</button>
    <button
      v-for="e in ESTADOS" :key="e"
      :class="['chip', { 'chip--on': filtro === e }]"
      :style="{ '--c': ESTADO_COLOR[e] }"
      @click="filtro = e"
    >{{ ESTADO_LABEL[e] }}</button>
  </div>

  <!-- Buscador -->
  <div class="tk__search">
    <input v-model="busqueda" type="search" class="tk__searchinput"
           placeholder="Buscar por N° de reclamo, nombre, correo o N° de pedido…" />
    <span v-if="busqueda.trim()" class="tk__searchcount">{{ ticketsBuscados.length }} resultado(s)</span>
  </div>

  <p v-if="error" class="tk__error" role="alert">{{ error }}</p>

  <div v-if="cargando" class="tk__center"><span class="spinner"></span></div>

  <p v-else-if="!ticketsBuscados.length" class="tk__empty">
    {{ busqueda.trim()
        ? `No hay reclamos que coincidan con "${busqueda.trim()}".`
        : (filtro !== 'todos' ? `No hay reclamos en estado "${ESTADO_LABEL[filtro] || filtro}".` : 'No hay reclamos.') }}
  </p>

  <!-- Lista de reclamos -->
  <ul v-else class="tks">
    <li v-for="t in ticketsBuscados" :key="t.id" class="tkt">
      <div class="tkt__head" @click="abrirDetalle(t)">
        <div class="tkt__main">
          <span class="tkt__num">{{ t.ticket_number || ('#' + t.id) }}</span>
          <span class="tkt__name">{{ t.name }}</span>
          <span class="tkt__cat">{{ t.category || 'Sin categoría' }} · {{ fmtFecha(t.created_at) }}</span>
        </div>
        <div class="tkt__right">
          <span class="badge" :style="{ '--c': ESTADO_COLOR[t.status] || '#888' }">
            {{ ESTADO_LABEL[t.status] || t.status }}
          </span>
          <button class="tkt__ver" @click.stop="abrirDetalle(t)">Ver detalle →</button>
        </div>
      </div>
    </li>
  </ul>

  <!-- ── Modal: detalle del reclamo ── -->
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="detalle" class="tdm__overlay" @click.self="cerrarDetalle">
        <div class="tdm" role="dialog" aria-modal="true" aria-label="Detalle del reclamo">
          <div class="tdm__head">
            <div>
              <h3 class="tdm__title">{{ detalle.ticket_number || ('#' + detalle.id) }}</h3>
              <p class="tdm__sub">{{ fmtFecha(detalle.created_at) }}</p>
            </div>
            <span class="badge" :style="{ '--c': ESTADO_COLOR[detalle.status] || '#888' }">
              {{ ESTADO_LABEL[detalle.status] || detalle.status }}
            </span>
            <button class="tdm__x" @click="cerrarDetalle" aria-label="Cerrar">✕</button>
          </div>

          <div class="tdm__body">
            <h4 class="tdm__h4">Datos del reclamante</h4>
            <div class="tdm__grid">
              <div class="tdm__f"><span>Nombre</span><p>{{ detalle.name }}</p></div>
              <div class="tdm__f"><span>Correo</span>
                <p><a :href="'mailto:' + detalle.email" class="tdm__link">{{ detalle.email }}</a></p>
              </div>
              <div class="tdm__f"><span>Teléfono</span>
                <p v-if="detalle.phone"><a :href="'tel:' + detalle.phone" class="tdm__link">{{ detalle.phone }}</a></p>
                <p v-else class="tdm__muted">—</p>
              </div>
              <div class="tdm__f"><span>Categoría</span><p>{{ detalle.category || '—' }}</p></div>
              <div class="tdm__f"><span>N° de pedido</span>
                <p v-if="detalle.order_number">{{ detalle.order_number }}</p>
                <p v-else class="tdm__muted">—</p>
              </div>
              <div class="tdm__f"><span>Fecha</span><p>{{ fmtFecha(detalle.created_at) }}</p></div>
            </div>

            <h4 class="tdm__h4">Mensaje</h4>
            <p class="tdm__msgtext">{{ detalle.message }}</p>

            <div class="tdm__acciones">
              <label class="tkt__estado">
                Estado:
                <select :value="detalle.status" :disabled="estadoBusy === detalle.id"
                        @change="cambiarEstado(detalle, $event.target.value)">
                  <option v-for="e in ESTADOS" :key="e" :value="e">{{ ESTADO_LABEL[e] }}</option>
                </select>
                <span v-if="estadoBusy === detalle.id" class="spinner spinner--sm"></span>
              </label>
              <p v-if="estadoMsg[detalle.id]"
                 :class="['tkt__estadomsg', estadoMsg[detalle.id].tipo === 'error' ? 'tkt__estadomsg--err' : 'tkt__estadomsg--ok']">
                {{ estadoMsg[detalle.id].texto }}
              </p>
            </div>
          </div>

          <div class="tdm__foot">
            <a :href="'mailto:' + detalle.email" class="tdm__mail">✉ Responder por correo</a>
            <button class="tdm__cancel" @click="cerrarDetalle">Cerrar</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</div>
</template>

<style scoped>
/* ── Barra superior ── */
.tk__bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
.tk__meta { font-size: 0.8rem; color: var(--text-3); display: inline-flex; align-items: center; gap: 0.6rem; }
.tk__nuevo { font-size: 0.66rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--surface-1); background: var(--accent); padding: 0.12rem 0.5rem; border-radius: 999px; }
.tk__refresh { padding: 0.5rem 0.9rem; font-size: 0.72rem; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); cursor: pointer; }
.tk__refresh:hover:not(:disabled) { color: var(--text-1); }
.tk__refresh:disabled { opacity: 0.6; cursor: not-allowed; }

/* ── Filtros / búsqueda ── */
.tk__filters { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0 0 1rem; }
.chip { padding: 0.35rem 0.8rem; font-size: 0.72rem; cursor: pointer; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-2); border-radius: 999px; }
.chip:hover { color: var(--text-1); }
.chip--on { background: var(--accent); border-color: var(--accent); color: var(--ink); font-weight: 600; }
.tk__search { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; }
.tk__searchinput { flex: 1; min-width: 240px; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); padding: 0.6rem 0.85rem; font-size: 0.88rem; outline: none; border-radius: 8px; }
.tk__searchinput:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--glow-color); }
.tk__searchcount { font-size: 0.74rem; color: var(--text-3); white-space: nowrap; }

.tk__error { color: var(--danger); font-size: 0.82rem; margin: 0.5rem 0; }
.tk__center { display: grid; place-items: center; padding: 3rem 0; }
.tk__empty { color: var(--text-3); padding: 3rem 0; text-align: center; }

/* ── Lista ── */
.tks { list-style: none; display: flex; flex-direction: column; gap: 0.6rem; }
.tkt { border: 1px solid var(--border-mid); background: var(--card-bg); animation: hb-fade-up 0.3s ease both; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
.tkt:hover { box-shadow: var(--shadow-card-hover); }
.tkt__head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.9rem 1rem; cursor: pointer; }
.tkt__main { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.tkt__num { font-family: var(--font-display); font-weight: 700; font-size: 0.9rem; }
.tkt__name { font-size: 0.85rem; color: var(--text-2); }
.tkt__cat { font-size: 0.72rem; color: var(--text-3); }
.tkt__right { display: flex; align-items: center; gap: 0.8rem; white-space: nowrap; }
.badge { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.2rem 0.55rem; border-radius: 999px; color: var(--c); border: 1px solid var(--c); }
.tkt__ver { padding: 0.35rem 0.7rem; font-size: 0.72rem; font-weight: 600; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); cursor: pointer; border-radius: 6px; white-space: nowrap; }
.tkt__ver:hover { color: var(--text-1); border-color: var(--accent); }

/* ── Cambio de estado (dentro del modal) ── */
.tkt__estado { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.78rem; color: var(--text-2); }
.tkt__estado select { margin-left: 0.5rem; padding: 0.4rem 0.6rem; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); }
.tkt__estado select:disabled { opacity: 0.6; cursor: wait; }
.tkt__estadomsg { font-size: 0.74rem; margin-top: 0.4rem; }
.tkt__estadomsg--ok { color: var(--success); }
.tkt__estadomsg--err { color: var(--danger); }

/* ── Modal detalle del reclamo ── */
.tdm__overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(3px); display: grid; place-items: center; z-index: 400; padding: 1rem; }
.tdm { width: 100%; max-width: 620px; max-height: 90vh; display: flex; flex-direction: column; background: var(--card-bg); border: 1px solid var(--border-mid); border-radius: 12px; box-shadow: 0 24px 64px rgba(0,0,0,0.4); overflow: hidden; }
.tdm__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); }
.tdm__title { font-family: var(--font-display); font-size: 1.05rem; font-weight: 800; color: var(--text-1); }
.tdm__sub { font-size: 0.74rem; color: var(--text-3); margin-top: 0.15rem; }
.tdm__x { background: transparent; border: none; font-size: 1.1rem; color: var(--text-3); cursor: pointer; margin-left: auto; }
.tdm__x:hover { color: var(--text-1); }
.tdm__body { padding: 1.25rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.6rem; }
.tdm__h4 { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-3); margin-top: 0.5rem; }
.tdm__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem 1rem; }
.tdm__f { display: flex; flex-direction: column; gap: 0.2rem; }
.tdm__f > span { font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); font-weight: 600; }
.tdm__f > p { font-size: 0.88rem; color: var(--text-1); word-break: break-word; }
.tdm__muted { color: var(--text-3); }
.tdm__link { color: var(--accent); text-decoration: none; }
.tdm__link:hover { text-decoration: underline; }
.tdm__msgtext { font-size: 0.9rem; line-height: 1.6; color: var(--text-2); white-space: pre-wrap; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 0.8rem 0.9rem; }
.tdm__acciones { display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start; padding: 0.8rem 0 0; margin-top: 0.4rem; border-top: 1px solid var(--border); }
.tdm__foot { display: flex; justify-content: space-between; align-items: center; gap: 0.7rem; padding: 1rem 1.25rem; border-top: 1px solid var(--border); flex-wrap: wrap; }
.tdm__mail { font-size: 0.78rem; color: var(--accent); text-decoration: none; }
.tdm__mail:hover { text-decoration: underline; }
.tdm__cancel { padding: 0.6rem 1rem; font-size: 0.78rem; color: var(--text-3); background: transparent; border: 1px solid var(--border-mid); border-radius: 6px; cursor: pointer; }
.tdm__cancel:hover { color: var(--text-1); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ── Spinner ── */
.spinner { width: 22px; height: 22px; border: 2px solid var(--text-3); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
.spinner--sm { width: 14px; height: 14px; border-width: 2px; border-color: currentColor; border-top-color: transparent; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 560px) {
  .tdm__grid { grid-template-columns: 1fr; }
}
</style>
