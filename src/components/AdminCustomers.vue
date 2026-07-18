<script setup>
// ─── Panel admin · Vista CLIENTES ───────────────────────────────────────────
// Lista clientes (registrados + invitados), prendas compradas, info de compra.
// Acciones: cambiar estado del pedido (incl. cancelado/reembolsado) y eliminar
// usuario (vía Edge Function segura; los pedidos se conservan desvinculados).
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase.js'
import { ESTADOS, ESTADO_COLOR, ESTADO_LABEL, ESTADOS_DEVUELVE_STOCK } from '../lib/pedidos.js'

const emit = defineEmits(['ver-pedido'])

const CANCELADOS = new Set(['cancelado', 'reembolsado'])   // no cuentan como gasto

const estadoBusy = ref(null)   // id del pedido cuyo estado se está cambiando

const profiles = ref([])
const orders   = ref([])
const cargando = ref(true)
const msg      = ref('')
const expandido = ref(null)
const borrando  = ref(null)
const confirmando = ref(null)   // cliente pendiente de eliminar (modal)

async function cargar() {
  cargando.value = true; msg.value = ''
  try {
    const [{ data: p, error: ep }, { data: o, error: eo }] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }),
    ])
    if (ep) throw ep
    if (eo) throw eo
    profiles.value = p || []
    orders.value = o || []
  } catch (e) { msg.value = e.message } finally { cargando.value = false }
}

function statsDe(pedidos) {
  return {
    nPedidos: pedidos.length,
    nPrendas: pedidos.reduce((s, o) => s + (o.order_items?.reduce((a, it) => a + (it.qty || 0), 0) || 0), 0),
    // Gasto total: excluye cancelados/reembolsados (no es dinero cobrado al cliente).
    total:    pedidos.reduce((s, o) => s + (CANCELADOS.has(o.status) ? 0 : Number(o.total || 0)), 0),
  }
}

const clientes = computed(() =>
  profiles.value.map((prof) => {
    const email = (prof.email || '').toLowerCase()
    const suyos = orders.value.filter(
      (o) => o.user_id === prof.id || (email && (o.customer_email || '').toLowerCase() === email),
    )
    return { ...prof, registrado: true, pedidos: suyos, ...statsDe(suyos) }
  }).sort((a, b) => b.nPedidos - a.nPedidos),
)

const invitados = computed(() => {
  // Solo emails reales cuentan como "registrado" (evita que perfiles sin email
  // arrastren a todos los invitados sin correo a la clave vacía '').
  const regs = new Set(profiles.value.map((p) => (p.email || '').toLowerCase()).filter(Boolean))
  const sinCuenta = orders.value.filter(
    (o) => !o.user_id && !(o.customer_email && regs.has(o.customer_email.toLowerCase())),
  )
  const map = {}
  for (const o of sinCuenta) {
    const email = (o.customer_email || '').toLowerCase()
    // Sin email → agrupar por nombre+teléfono; si tampoco hay, clave única por
    // pedido para no fusionar clientes distintos ni atribuir compras ajenas.
    const alt = [
      (o.customer_name || '').trim().toLowerCase(),
      (o.customer_phone || '').replace(/\D/g, ''),
    ].filter(Boolean).join('|')
    const k = email || alt || `pedido:${o.id}`
    if (!map[k]) map[k] = { email: o.customer_email, full_name: o.customer_name, pedidos: [] }
    map[k].pedidos.push(o)
  }
  return Object.values(map).map((g) => ({ ...g, registrado: false, ...statsDe(g.pedidos) }))
})

// Cambia estado vía RPC admin_set_order_status (repone/descuenta stock según toque).
// Confirma al cancelar/reembolsar y avisa al cliente por correo al marcar 'enviado'.
async function cambiarEstado(order, ev) {
  const nuevo = ev?.target?.value
  // El <select> usa :value (no v-model): si no aplicamos el cambio hay que
  // devolver el control a order.status, o queda mostrando un valor irreal.
  const revertir = () => { if (ev?.target) ev.target.value = order.status }
  if (!nuevo || nuevo === order.status) return revertir()
  if (estadoBusy.value) return revertir()   // otro cambio en curso: no encolar
  if (ESTADOS_DEVUELVE_STOCK.includes(nuevo)) {
    const ok = confirm(
      `¿Marcar el pedido ${order.order_number || ('#' + order.id)} como "${ESTADO_LABEL[nuevo]}"?\n` +
      `Si tenía stock descontado, se repondrá al inventario.`,
    )
    if (!ok) return revertir()
  }
  const ant = order.status
  estadoBusy.value = order.id
  msg.value = ''
  try {
    const { data, error } = await supabase.rpc('admin_set_order_status', {
      p_order_number: order.order_number, p_status: nuevo,
    })
    if (error) throw error
    order.status = nuevo
    if (data && typeof data.stock_restored === 'boolean') order.stock_restored = data.stock_restored
    if (['confirmado', 'enviado', 'entregado'].includes(nuevo)) {
      try { await supabase.functions.invoke('admin-notificar-envio', { body: { order_number: order.order_number, status: nuevo } }) }
      catch (_) { /* correo best-effort */ }
    }
  } catch (err) {
    const m = err?.message || ''
    order.status = ant
    msg.value = m.includes('STOCK_INSUFICIENTE')
      ? 'No hay stock para reactivar ese pedido. Ajusta el inventario primero.'
      : m.includes('NO_AUTORIZADO') ? 'No tienes permisos de administrador.'
      : 'No se pudo actualizar: ' + m
  } finally {
    estadoBusy.value = null
  }
}

function pedirEliminar(c) { confirmando.value = c }

async function confirmarEliminar() {
  const c = confirmando.value
  if (!c) return
  borrando.value = c.id
  msg.value = ''
  try {
    const { data, error } = await supabase.functions.invoke('admin-delete-user', { body: { user_id: c.id } })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
    confirmando.value = null
    await cargar()
  } catch (e) { msg.value = 'Error al eliminar: ' + (e.message || e) } finally { borrando.value = null }
}

function money(n) { return 'S/ ' + Number(n ?? 0).toFixed(2) }
function fmtFecha(s) { try { return new Date(s).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return s } }
function toggle(id) { expandido.value = expandido.value === id ? null : id }

onMounted(cargar)
</script>

<template>
<div class="cli">
  <div class="cli__bar">
    <p class="cli__meta">{{ clientes.length }} clientes registrados · {{ invitados.length }} invitados</p>
    <button class="cli__refresh" :disabled="cargando" @click="cargar">↻ Actualizar</button>
  </div>

  <p v-if="msg" class="cli__msg" role="alert">{{ msg }}</p>
  <div v-if="cargando" class="cli__center"><span class="spinner"></span></div>

  <template v-else>
    <!-- Registrados -->
    <h3 class="cli__h3">Clientes registrados</h3>
    <p v-if="!clientes.length" class="cli__empty">Aún no hay clientes registrados.</p>
    <ul v-else class="cli__list">
      <li v-for="c in clientes" :key="c.id" class="cust">
        <div class="cust__head" @click="toggle(c.id)">
          <div class="cust__main">
            <span class="cust__name">{{ c.full_name || '(sin nombre)' }}</span>
            <span class="cust__email">{{ c.email }}</span>
            <span class="cust__since">Desde {{ fmtFecha(c.created_at) }}</span>
          </div>
          <div class="cust__stats">
            <span><strong>{{ c.nPrendas }}</strong> prendas</span>
            <span><strong>{{ c.nPedidos }}</strong> pedidos</span>
            <span class="cust__total">{{ money(c.total) }}</span>
            <span class="cust__caret">{{ expandido === c.id ? '▲' : '▼' }}</span>
          </div>
        </div>

        <div v-if="expandido === c.id" class="cust__body">
          <p v-if="c.phone" class="cust__sub">📱 {{ c.phone }}</p>
          <p v-if="!c.pedidos.length" class="cust__sub">Sin pedidos.</p>

          <ul v-else class="ordlist">
            <li v-for="o in c.pedidos" :key="o.id" class="ord">
              <div class="ord__top">
                <span class="ord__num">{{ o.order_number || ('#' + o.id) }}</span>
                <span class="ord__date">{{ fmtFecha(o.created_at) }}</span>
                <span class="ord__total">{{ money(o.total) }}</span>
                <select class="ord__estado" :value="o.status"
                        aria-label="Estado del pedido"
                        :style="{ color: ESTADO_COLOR[o.status] }"
                        :disabled="estadoBusy === o.id"
                        @change="cambiarEstado(o, $event)">
                  <option v-for="e in ESTADOS" :key="e" :value="e">{{ ESTADO_LABEL[e] }}</option>
                </select>
                <button class="ord__ver" @click="emit('ver-pedido', o.id)">Ver detalle →</button>
              </div>
              <p class="ord__items">
                <span v-for="it in o.order_items" :key="it.id">{{ it.qty }}× {{ it.name }} ({{ it.size }}<template v-if="it.color">/{{ it.color }}</template>)&nbsp;&nbsp;</span>
              </p>
              <p class="ord__envio">📍 {{ o.notes }}</p>
            </li>
          </ul>

          <button class="cust__del" @click="pedirEliminar(c)">🗑 Eliminar usuario</button>
          <p class="cust__del-note">Sus pedidos se conservan (desvinculados) por registro.</p>
        </div>
      </li>
    </ul>

    <!-- Invitados -->
    <template v-if="invitados.length">
      <h3 class="cli__h3" style="margin-top:2rem;">Compras como invitado <span class="cli__tag">sin cuenta</span></h3>
      <ul class="cli__list">
        <li v-for="(g, i) in invitados" :key="'g'+i" class="cust">
          <div class="cust__head" @click="toggle('g'+i)">
            <div class="cust__main">
              <span class="cust__name">{{ g.full_name || '(invitado)' }}</span>
              <span class="cust__email">{{ g.email }}</span>
            </div>
            <div class="cust__stats">
              <span><strong>{{ g.nPrendas }}</strong> prendas</span>
              <span><strong>{{ g.nPedidos }}</strong> pedidos</span>
              <span class="cust__total">{{ money(g.total) }}</span>
              <span class="cust__caret">{{ expandido === 'g'+i ? '▲' : '▼' }}</span>
            </div>
          </div>
          <div v-if="expandido === 'g'+i" class="cust__body">
            <ul class="ordlist">
              <li v-for="o in g.pedidos" :key="o.id" class="ord">
                <div class="ord__top">
                  <span class="ord__num">{{ o.order_number || ('#' + o.id) }}</span>
                  <span class="ord__date">{{ fmtFecha(o.created_at) }}</span>
                  <span class="ord__total">{{ money(o.total) }}</span>
                  <select class="ord__estado" :value="o.status" :style="{ color: ESTADO_COLOR[o.status] }"
                          aria-label="Estado del pedido"
                          :disabled="estadoBusy === o.id"
                          @change="cambiarEstado(o, $event)">
                    <option v-for="e in ESTADOS" :key="e" :value="e">{{ ESTADO_LABEL[e] }}</option>
                  </select>
                </div>
                <p class="ord__envio">📍 {{ o.notes }}</p>
              </li>
            </ul>
          </div>
        </li>
      </ul>
    </template>
  </template>

  <!-- Modal de confirmación para eliminar usuario -->
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="confirmando" class="cmodal" @click.self="confirmando = null">
        <div class="cmodal__box" role="dialog" aria-modal="true">
          <div class="cmodal__icon">🗑</div>
          <h3 class="cmodal__title">Eliminar usuario</h3>
          <p class="cmodal__text">
            ¿Seguro que quieres eliminar la cuenta de <strong>{{ confirmando.email }}</strong>?
            <br/><span class="cmodal__note">Sus pedidos se conservan (desvinculados) por registro. Esta acción no se puede deshacer.</span>
          </p>
          <div class="cmodal__actions">
            <button class="cmodal__cancel" :disabled="borrando" @click="confirmando = null">Cancelar</button>
            <button class="cmodal__confirm" :disabled="borrando" @click="confirmarEliminar">
              <span v-if="borrando" class="spinner spinner--sm"></span>
              {{ borrando ? 'Eliminando…' : 'Sí, eliminar' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</div>
</template>

<style scoped>
.cli__bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
.cli__meta { font-size: 0.8rem; color: var(--text-3); }
.cli__refresh { padding: 0.5rem 0.9rem; font-size: 0.72rem; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); cursor: pointer; }
.cli__msg { color: var(--danger); font-size: 0.82rem; margin: 0.5rem 0; }
.cli__center { display: grid; place-items: center; padding: 3rem 0; }
.cli__h3 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-2); margin-bottom: 0.8rem; }
.cli__tag { font-size: 0.62rem; background: var(--surface-3); color: var(--text-3); padding: 0.1rem 0.5rem; border-radius: 999px; letter-spacing: 0; }
.cli__empty { color: var(--text-3); padding: 1rem 0; }
.cli__list { list-style: none; display: flex; flex-direction: column; gap: 0.6rem; }

.cust { border: 1px solid var(--border-mid); background: var(--card-bg); animation: hb-fade-up 0.3s ease both; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
.cust:hover { box-shadow: var(--shadow-card-hover); }
.cust__head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.9rem 1rem; cursor: pointer; flex-wrap: wrap; }
.cust__main { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.cust__name { font-weight: 600; font-size: 0.9rem; color: var(--text-1); }
.cust__email { font-size: 0.8rem; color: var(--text-2); }
.cust__since { font-size: 0.7rem; color: var(--text-3); }
.cust__stats { display: flex; align-items: center; gap: 1rem; font-size: 0.78rem; color: var(--text-3); white-space: nowrap; }
.cust__stats strong { color: var(--text-1); }
.cust__total { font-weight: 700; color: var(--text-1); }
.cust__caret { font-size: 0.6rem; color: var(--text-3); }

.cust__body { border-top: 1px solid var(--border); padding: 1rem; }
.cust__sub { font-size: 0.8rem; color: var(--text-3); margin-bottom: 0.6rem; }
.ordlist { list-style: none; display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 1rem; }
.ord { background: var(--surface-2); border: 1px solid var(--border); padding: 0.7rem 0.8rem; }
.ord__top { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; }
.ord__num { font-family: var(--font-display); font-weight: 700; font-size: 0.82rem; }
.ord__date { font-size: 0.72rem; color: var(--text-3); }
.ord__total { font-weight: 700; font-size: 0.82rem; margin-left: auto; }
.ord__estado { padding: 0.3rem 0.5rem; background: var(--surface-1); border: 1px solid var(--border-mid); font-size: 0.72rem; text-transform: capitalize; font-weight: 600; }
.ord__items { font-size: 0.76rem; color: var(--text-2); margin-top: 0.5rem; }
.ord__envio { font-size: 0.74rem; color: var(--text-3); margin-top: 0.35rem; }

.cust__del { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.55rem 1rem; background: transparent; border: 1px solid var(--danger); color: var(--danger); font-size: 0.76rem; font-weight: 600; cursor: pointer; border-radius: 6px; }
.cust__del:hover:not(:disabled) { background: var(--danger); color: #fff; }
.cust__del:disabled { opacity: 0.6; cursor: not-allowed; }
.cust__del-note { font-size: 0.68rem; color: var(--text-3); margin-top: 0.4rem; }

.ord__ver { background: transparent; border: none; color: var(--accent-3); font-size: 0.74rem; font-weight: 600; cursor: pointer; transition: opacity 0.15s; }
.ord__ver:hover { text-decoration: underline; opacity: 0.8; }

/* ── Modal eliminar usuario ── */
.cmodal { position: fixed; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(3px); display: grid; place-items: center; z-index: 300; padding: 1.5rem; }
.cmodal__box { width: 100%; max-width: 380px; background: var(--surface-1); border: 1px solid var(--border-mid); border-radius: 14px; padding: 1.75rem; text-align: center; box-shadow: 0 24px 64px rgba(0,0,0,0.4); }
.cmodal__icon { font-size: 2rem; margin-bottom: 0.4rem; }
.cmodal__title { font-family: var(--font-display); font-size: 1.2rem; font-weight: 800; color: var(--text-1); margin-bottom: 0.6rem; }
.cmodal__text { font-size: 0.86rem; color: var(--text-2); line-height: 1.6; margin-bottom: 1.25rem; }
.cmodal__note { font-size: 0.74rem; color: var(--text-3); }
.cmodal__actions { display: flex; gap: 0.6rem; }
.cmodal__cancel, .cmodal__confirm { flex: 1; padding: 0.75rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; transition: filter 0.15s; }
.cmodal__cancel { background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); }
.cmodal__confirm { background: var(--danger); border: 1px solid var(--danger); color: #fff; }
.cmodal__confirm:hover:not(:disabled) { filter: brightness(1.08); }
.cmodal__cancel:disabled, .cmodal__confirm:disabled { opacity: 0.6; cursor: not-allowed; }

/* transición del modal */
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-active .cmodal__box, .modal-leave-active .cmodal__box { transition: transform 0.25s cubic-bezier(0.22,1,0.36,1), opacity 0.25s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .cmodal__box, .modal-leave-to .cmodal__box { transform: translateY(16px) scale(0.96); opacity: 0; }
@media (prefers-reduced-motion: reduce) { .modal-enter-active, .modal-leave-active, .modal-enter-active .cmodal__box, .modal-leave-active .cmodal__box { transition: none; } }

.spinner { width: 22px; height: 22px; border: 2px solid var(--text-3); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
.spinner--sm { width: 13px; height: 13px; border-width: 2px; border-color: currentColor; border-top-color: transparent; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
