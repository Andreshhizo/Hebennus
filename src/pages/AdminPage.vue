<script setup>
// ─── PANEL DE ADMINISTRACIÓN (/admin) ───────────────────────────────────────
// Acceso protegido por Supabase Auth + función is_admin() (RLS). Solo usuarios
// que estén en la tabla `admins` pueden leer/gestionar pedidos.
import { ref, computed, onMounted, nextTick } from 'vue'
import { supabase } from '../lib/supabase.js'
import { purgeSupabaseTokens } from '../lib/useAuth.js'
import { ESTADOS, ESTADO_COLOR, ESTADO_LABEL, ESTADOS_DEVUELVE_STOCK } from '../lib/pedidos.js'
import AdminCustomers from '../components/AdminCustomers.vue'
import AdminProducts from '../components/AdminProducts.vue'
import AdminPaymentTests from '../components/AdminPaymentTests.vue'

// Solo en desarrollo mostramos la pestaña "Tests de pago" (la tabla payment_tests
// no existe en producción). import.meta.env.DEV no es accesible desde el template,
// por eso lo exponemos como constante.
const DEV = import.meta.env.DEV

const vista = ref('pedidos')   // 'pedidos' | 'clientes' | 'productos' | 'tests' (solo en dev)

const TITULOS = { pedidos: 'Pedidos', clientes: 'Clientes', productos: 'Productos', tests: 'Tests de pago' }
// Método de pago en formato legible para el panel
const METODO_PAGO_LABEL = {
  izipay:        'Tarjeta/Izipay',
  yape_manual:   'Yape (manual)',
  contraentrega: 'Contraentrega',
}
function metodoPagoLabel(m) { return METODO_PAGO_LABEL[m] || m || '—' }

// ── Auth ──
const cargando   = ref(true)
const session    = ref(null)
const esAdmin    = ref(false)
const authError  = ref('')
const email      = ref('')
const password   = ref('')
const ingresando = ref(false)

// ── Pedidos ──
const pedidos        = ref([])
const cargandoPed    = ref(false)
const pedidosError   = ref('')
const expandido      = ref(null)
const filtro         = ref('todos')
const marcandoPagado = ref(null)   // id del pedido que se está marcando como pagado (evita doble click)
const estadoBusy     = ref(null)   // id del pedido cuyo estado se está cambiando
const estadoMsg      = ref({})     // { [orderId]: { tipo: 'ok'|'error', texto } }

const pedidosFiltrados = computed(() =>
  filtro.value === 'todos' ? pedidos.value : pedidos.value.filter(o => o.status === filtro.value)
)
const totalPedidos = computed(() => pedidos.value.length)
const pendientes   = computed(() => pedidos.value.filter(o => o.status === 'pendiente').length)

async function verificarAdminYcargar() {
  const { data, error } = await supabase.rpc('is_admin')
  if (error) { authError.value = error.message; return }
  esAdmin.value = data === true
  if (esAdmin.value) await cargarPedidos()
  else authError.value = 'Tu cuenta no tiene permisos de administrador.'
}

async function cargarPedidos() {
  cargandoPed.value = true
  pedidosError.value = ''
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .order('created_at', { ascending: false })
    if (error) throw error
    pedidos.value = data || []
  } catch (e) {
    pedidosError.value = e.message
  } finally {
    cargandoPed.value = false
  }
}

async function ingresar() {
  ingresando.value = true
  authError.value = ''
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.value.trim(),
      password: password.value,
    })
    if (error) throw error
    const { data } = await supabase.auth.getSession()
    session.value = data.session
    await verificarAdminYcargar()
    if (!esAdmin.value) { await supabase.auth.signOut(); session.value = null }
  } catch (e) {
    authError.value = e.message === 'Invalid login credentials'
      ? 'Correo o contraseña incorrectos.'
      : e.message
  } finally {
    ingresando.value = false
    password.value = ''
  }
}

async function salir() {
  // Limpia el estado de inmediato.
  session.value = null
  esAdmin.value = false
  pedidos.value = []
  // Revoca en el servidor (con timeout), limpia local y borra el token explícito.
  try {
    await Promise.race([
      supabase.auth.signOut({ scope: 'global' }),
      new Promise((r) => setTimeout(r, 2500)),
    ])
  } catch (_) { /* noop */ }
  try { await supabase.auth.signOut({ scope: 'local' }) } catch (_) { /* noop */ }
  purgeSupabaseTokens()
}

// Cambia el estado logístico vía RPC admin_set_order_status (reconciliación de
// stock incluida). Pide confirmación al cancelar/reembolsar y avisa al cliente
// por correo al marcar 'enviado'. Da feedback por pedido.
async function cambiarEstado(pedido, nuevo) {
  if (!nuevo || nuevo === pedido.status || estadoBusy.value) return

  // Cancelar/reembolsar repone stock → confirmar.
  if (ESTADOS_DEVUELVE_STOCK.includes(nuevo)) {
    const ok = confirm(
      `¿Marcar el pedido ${pedido.order_number || ('#' + pedido.id)} como "${ESTADO_LABEL[nuevo]}"?\n` +
      `Si el pedido tenía stock descontado, se repondrá al inventario.`,
    )
    if (!ok) return
  }

  const anterior = pedido.status
  estadoBusy.value = pedido.id
  estadoMsg.value = { ...estadoMsg.value, [pedido.id]: null }
  try {
    const { data, error } = await supabase.rpc('admin_set_order_status', {
      p_order_number: pedido.order_number, p_status: nuevo,
    })
    if (error) throw error
    pedido.status = nuevo
    if (data && typeof data.stock_restored === 'boolean') pedido.stock_restored = data.stock_restored

    if (nuevo === 'enviado') {
      // Aviso de "en camino" al cliente (best-effort; no revierte el estado si falla).
      let avisado = false
      try {
        const { data: mail } = await supabase.functions.invoke('admin-notificar-envio', {
          body: { order_number: pedido.order_number },
        })
        avisado = mail?.email_sent === true
      } catch (_) { /* correo best-effort */ }
      estadoMsg.value = { ...estadoMsg.value, [pedido.id]: {
        tipo: 'ok', texto: avisado ? '✓ Enviado · correo avisado al cliente' : '✓ Enviado (no se pudo mandar el correo)',
      } }
    } else {
      const repuso = ESTADOS_DEVUELVE_STOCK.includes(nuevo) && data?.stock_restored
      estadoMsg.value = { ...estadoMsg.value, [pedido.id]: {
        tipo: 'ok', texto: repuso ? '✓ Actualizado · stock repuesto' : '✓ Estado actualizado',
      } }
    }
  } catch (err) {
    const m = err?.message || ''
    const texto =
      m.includes('STOCK_INSUFICIENTE') ? 'No hay stock para reactivar este pedido. Ajusta el inventario primero.' :
      m.includes('NO_AUTORIZADO')      ? 'No tienes permisos de administrador.' :
      'No se pudo actualizar el estado: ' + m
    pedido.status = anterior
    estadoMsg.value = { ...estadoMsg.value, [pedido.id]: { tipo: 'error', texto } }
  } finally {
    estadoBusy.value = null
  }
}

// Confirmación manual del Yape: llama a la RPC SECURITY DEFINER que marca pagado,
// descuenta stock y es idempotente. Solo aplica al flujo yape_manual.
async function marcarPagado(pedido) {
  if (marcandoPagado.value) return // ya hay uno en proceso
  if (!confirm(`¿Marcar como PAGADO el pedido ${pedido.order_number || ('#' + pedido.id)}? Esto descontará el stock.`)) return
  marcandoPagado.value = pedido.id
  pedidosError.value = ''
  try {
    const { error } = await supabase.rpc('admin_marcar_pagado', { p_order_number: pedido.order_number })
    if (error) {
      const msg = error.message || ''
      if (msg.includes('STOCK_INSUFICIENTE')) {
        pedidosError.value = 'No se pudo marcar pagado: ya no hay stock suficiente para este pedido. Revisa el inventario.'
      } else if (msg.includes('NO_AUTORIZADO')) {
        pedidosError.value = 'No tienes permisos de administrador.'
      } else {
        pedidosError.value = 'No se pudo marcar pagado: ' + msg
      }
      return
    }
    await cargarPedidos() // refresca para reflejar payment_status='pagado'
  } finally {
    marcandoPagado.value = null
  }
}

function fmtFecha(s) {
  try { return new Date(s).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }) }
  catch { return s }
}
function money(n) { return 'S/ ' + Number(n ?? 0).toFixed(2) }
function toggle(id) { expandido.value = expandido.value === id ? null : id }

// Desde la vista Clientes: ir al pedido, expandirlo y hacer scroll.
async function verPedido(id) {
  vista.value = 'pedidos'
  filtro.value = 'todos'
  expandido.value = id
  await nextTick()
  document.getElementById('ord-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

onMounted(async () => {
  const { data } = await supabase.auth.getSession()
  session.value = data.session
  if (session.value) await verificarAdminYcargar()
  cargando.value = false
})
</script>

<template>
<div class="admin">
  <!-- ░░ CARGANDO ░░ -->
  <div v-if="cargando" class="admin__center">
    <span class="spinner"></span>
  </div>

  <!-- ░░ LOGIN ░░ -->
  <div v-else-if="!session || !esAdmin" class="admin__center">
    <form class="login" @submit.prevent="ingresar">
      <h1 class="login__brand">HEBENNUS</h1>
      <p class="login__sub">Panel de administración</p>

      <label class="login__label" for="adm-email">Correo</label>
      <input id="adm-email" v-model="email" type="email" class="login__input" autocomplete="email" required />

      <label class="login__label" for="adm-pass">Contraseña</label>
      <input id="adm-pass" v-model="password" type="password" class="login__input" autocomplete="current-password" required />

      <p v-if="authError" class="login__error" role="alert">{{ authError }}</p>

      <button type="submit" class="login__btn" :disabled="ingresando">
        <span v-if="ingresando" class="spinner spinner--sm"></span>
        {{ ingresando ? 'Ingresando…' : 'Ingresar' }}
      </button>
      <RouterLink to="/" class="login__back">← Volver a la tienda</RouterLink>
    </form>
  </div>

  <!-- ░░ DASHBOARD ░░ -->
  <div v-else class="dash">
    <header class="dash__top">
      <div>
        <h1 class="dash__title">{{ TITULOS[vista] }}</h1>
        <p v-if="vista === 'pedidos'" class="dash__meta">{{ totalPedidos }} pedidos · {{ pendientes }} pendientes</p>
      </div>
      <div class="dash__actions">
        <RouterLink to="/" class="dash__back">← Ir a la tienda</RouterLink>
        <button v-if="vista === 'pedidos'" class="dash__refresh" :disabled="cargandoPed" @click="cargarPedidos">↻ Actualizar</button>
        <button class="dash__logout" @click="salir">Salir</button>
      </div>
    </header>

    <div class="dash__tabs">
      <button :class="['dtab', { 'dtab--on': vista === 'pedidos' }]" @click="vista = 'pedidos'">Pedidos</button>
      <button :class="['dtab', { 'dtab--on': vista === 'clientes' }]" @click="vista = 'clientes'">Clientes</button>
      <button :class="['dtab', { 'dtab--on': vista === 'productos' }]" @click="vista = 'productos'">Productos</button>
      <!-- Solo en desarrollo: la tabla payment_tests no existe en producción. -->
      <button v-if="DEV" :class="['dtab', { 'dtab--on': vista === 'tests' }]" @click="vista = 'tests'">Tests de pago</button>
    </div>

    <template v-if="vista === 'pedidos'">
    <div class="dash__filters">
      <button :class="['chip', { 'chip--on': filtro === 'todos' }]" @click="filtro = 'todos'">Todos</button>
      <button
        v-for="e in ESTADOS" :key="e"
        :class="['chip', { 'chip--on': filtro === e }]"
        @click="filtro = e"
      >{{ ESTADO_LABEL[e] }}</button>
    </div>

    <p v-if="pedidosError" class="dash__error" role="alert">{{ pedidosError }}</p>

    <div v-if="cargandoPed" class="admin__center"><span class="spinner"></span></div>

    <p v-else-if="!pedidosFiltrados.length" class="dash__empty">No hay pedidos{{ filtro !== 'todos' ? ` en estado "${filtro}"` : '' }}.</p>

    <ul v-else class="orders">
      <li v-for="o in pedidosFiltrados" :key="o.id" :id="'ord-' + o.id" class="order">
        <div class="order__head" @click="toggle(o.id)">
          <div class="order__main">
            <span class="order__num">{{ o.order_number || ('#' + o.id) }}</span>
            <span class="order__cust">{{ o.customer_name }}</span>
            <span class="order__date">{{ fmtFecha(o.created_at) }}</span>
          </div>
          <div class="order__right">
            <span class="order__total">{{ money(o.total) }}</span>
            <!-- Estado de pago -->
            <span
              class="badge"
              :style="{ '--c': o.payment_status === 'pagado' ? '#2ecc8f' : (o.payment_status === 'fallido' ? '#e0566b' : '#e0a23b') }"
            >{{ o.payment_status === 'pagado' ? 'Pagado' : (o.payment_status === 'fallido' ? 'Pago fallido' : 'Pago pendiente') }}</span>
            <span class="badge" :style="{ '--c': ESTADO_COLOR[o.status] || '#888' }">{{ ESTADO_LABEL[o.status] || o.status }}</span>
            <span class="order__caret">{{ expandido === o.id ? '▲' : '▼' }}</span>
          </div>
        </div>

        <div v-if="expandido === o.id" class="order__body">
          <div class="order__cols">
            <div>
              <h3 class="order__h3">Productos</h3>
              <ul class="items">
                <li v-for="it in o.order_items" :key="it.id" class="item">
                  <span>{{ it.name }} · {{ it.size }}<template v-if="it.color"> / {{ it.color }}</template> × {{ it.qty }}</span>
                  <span>{{ money(it.subtotal) }}</span>
                </li>
              </ul>
              <div class="totales">
                <span>Subtotal</span><span>{{ money(o.subtotal) }}</span>
                <span>Envío</span><span>{{ o.shipping > 0 ? money(o.shipping) : 'Gratis' }}</span>
                <span class="totales__big">Total</span><span class="totales__big">{{ money(o.total) }}</span>
              </div>
            </div>
            <div>
              <h3 class="order__h3">Cliente y envío</h3>
              <p class="order__p">
                <strong>{{ o.customer_name }}</strong><br/>
                {{ o.customer_email }}<br/>
                {{ o.customer_phone }}<br/>
                <span class="order__notes">{{ o.notes }}</span>
              </p>
              <p class="order__p order__p--muted">
                Pago: {{ metodoPagoLabel(o.payment_method) }} · {{ o.payment_status === 'pagado' ? 'Pagado' : (o.payment_status === 'fallido' ? 'Pago fallido' : 'Pago pendiente') }} · Comprobante: {{ o.comprobante_tipo }}
                <template v-if="o.doc_numero"> ({{ o.doc_tipo }} {{ o.doc_numero }})</template>
              </p>
              <!-- Confirmación manual del Yape (solo si está pendiente y es yape_manual) -->
              <button
                v-if="o.payment_status !== 'pagado' && o.payment_method === 'yape_manual'"
                class="order__pagado"
                :disabled="marcandoPagado === o.id"
                @click="marcarPagado(o)"
              >
                <span v-if="marcandoPagado === o.id" class="spinner spinner--sm"></span>
                {{ marcandoPagado === o.id ? 'Procesando…' : '✓ Marcar pagado' }}
              </button>
              <label class="order__estado">
                Estado:
                <select :value="o.status" :disabled="estadoBusy === o.id" @change="cambiarEstado(o, $event.target.value)">
                  <option v-for="e in ESTADOS" :key="e" :value="e">{{ ESTADO_LABEL[e] }}</option>
                </select>
                <span v-if="estadoBusy === o.id" class="spinner spinner--sm"></span>
              </label>
              <p v-if="estadoMsg[o.id]"
                 :class="['order__estadomsg', estadoMsg[o.id].tipo === 'error' ? 'order__estadomsg--err' : 'order__estadomsg--ok']">
                {{ estadoMsg[o.id].texto }}
              </p>
            </div>
          </div>
        </div>
      </li>
    </ul>
    </template>

    <AdminCustomers v-else-if="vista === 'clientes'" @ver-pedido="verPedido" />

    <AdminProducts v-else-if="vista === 'productos'" />

    <!-- Solo en desarrollo: registro de pruebas de pago. -->
    <AdminPaymentTests v-else-if="DEV && vista === 'tests'" />
  </div>
</div>
</template>

<style scoped>
.admin { min-height: 100vh; background: var(--surface-1); color: var(--text-1); }
.admin__center { min-height: 70vh; display: grid; place-items: center; padding: 2rem; }

/* ── Login ── */
.login {
  width: 100%; max-width: 360px; display: flex; flex-direction: column; gap: 0.5rem;
  background: var(--card-bg); border: 1px solid var(--border-mid); padding: 2rem 1.75rem;
}
.login__brand { font-family: var(--font-display); font-size: 1.5rem; letter-spacing: 0.2em; text-align: center; }
.login__sub { text-align: center; font-size: 0.72rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-3); margin-bottom: 1rem; }
.login__label { font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-2); font-weight: 600; margin-top: 0.5rem; }
.login__input { background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); padding: 0.7rem 0.8rem; font-size: 0.95rem; outline: none; }
.login__input:focus-visible { border-color: var(--accent); }
.login__error { color: #e0566b; font-size: 0.78rem; }
.login__btn {
  margin-top: 1rem; padding: 0.85rem; background: var(--accent); color: var(--ink);
  border: none; font-family: var(--font-display); font-size: 0.78rem; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
}
.login__btn:disabled { opacity: 0.6; cursor: not-allowed; }
.login__back { text-align: center; font-size: 0.72rem; color: var(--text-3); margin-top: 0.75rem; }

/* ── Dashboard ── */
.dash { max-width: 1000px; margin: 0 auto; padding: 2rem 1.25rem 5rem; }
.dash__top { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
.dash__title { font-family: var(--font-display); font-size: 1.8rem; font-weight: 800; text-transform: uppercase; }
.dash__meta { font-size: 0.8rem; color: var(--text-3); margin-top: 0.25rem; }
.dash__actions { display: flex; gap: 0.5rem; }
.dash__back, .dash__refresh, .dash__logout {
  padding: 0.5rem 0.9rem; font-size: 0.72rem; letter-spacing: 0.06em; cursor: pointer;
  background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2);
  display: inline-flex; align-items: center;
}
.dash__back:hover, .dash__refresh:hover { color: var(--text-1); }
.dash__logout { color: #e0566b; }
.dash__tabs { display: flex; gap: 0.5rem; margin: 1.25rem 0 0.5rem; border-bottom: 1px solid var(--border); }
.dtab { padding: 0.6rem 1rem; font-size: 0.8rem; font-weight: 600; color: var(--text-3); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.dtab--on { color: var(--text-1); border-bottom-color: var(--accent); }
.dash__filters { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 1.5rem 0 1rem; }
.chip {
  padding: 0.35rem 0.8rem; font-size: 0.72rem; text-transform: capitalize; cursor: pointer;
  background: var(--surface-2); border: 1px solid var(--border); color: var(--text-2); border-radius: 999px;
}
.chip--on { background: var(--accent); border-color: var(--accent); color: var(--ink); font-weight: 600; }
.dash__error { color: #e0566b; font-size: 0.82rem; margin: 0.5rem 0; }
.dash__empty { color: var(--text-3); padding: 3rem 0; text-align: center; }

/* ── Orders ── */
.orders { list-style: none; display: flex; flex-direction: column; gap: 0.6rem; }
.order { border: 1px solid var(--border-mid); background: var(--card-bg); animation: hb-fade-up 0.3s ease both; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
.order:hover { box-shadow: 0 4px 18px rgba(0,0,0,0.08); }
.order__head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.9rem 1rem; cursor: pointer; }
.order__main { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.order__num { font-family: var(--font-display); font-weight: 700; font-size: 0.9rem; }
.order__cust { font-size: 0.85rem; color: var(--text-2); }
.order__date { font-size: 0.72rem; color: var(--text-3); }
.order__right { display: flex; align-items: center; gap: 0.8rem; white-space: nowrap; }
.order__total { font-weight: 700; }
.badge { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.2rem 0.55rem; border-radius: 999px; color: var(--c); border: 1px solid var(--c); }
.order__caret { font-size: 0.6rem; color: var(--text-3); }

.order__body { border-top: 1px solid var(--border); padding: 1rem; }
.order__cols { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
.order__h3 { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-3); margin-bottom: 0.5rem; }
.items { list-style: none; display: flex; flex-direction: column; gap: 0.4rem; }
.item { display: flex; justify-content: space-between; gap: 1rem; font-size: 0.82rem; color: var(--text-2); }
.totales { display: grid; grid-template-columns: 1fr auto; gap: 0.25rem 1rem; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border); font-size: 0.82rem; color: var(--text-2); }
.totales__big { font-weight: 700; color: var(--text-1); }
.order__p { font-size: 0.85rem; line-height: 1.6; color: var(--text-2); }
.order__p--muted { color: var(--text-3); font-size: 0.78rem; margin-top: 0.5rem; }
.order__notes { color: var(--text-3); }
.order__pagado {
  margin-top: 0.75rem; padding: 0.55rem 0.9rem; font-size: 0.74rem; font-weight: 700;
  letter-spacing: 0.05em; cursor: pointer; background: #2ecc8f; border: 1px solid #2ecc8f;
  color: var(--ink); display: inline-flex; align-items: center; gap: 0.45rem;
}
.order__pagado:hover { filter: brightness(1.05); }
.order__pagado:disabled { opacity: 0.6; cursor: not-allowed; }
.order__estado { display: inline-flex; align-items: center; gap: 0.5rem; margin-top: 1rem; font-size: 0.78rem; color: var(--text-2); }
.order__estado select { margin-left: 0.5rem; padding: 0.4rem 0.6rem; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); }
.order__estado select:disabled { opacity: 0.6; cursor: wait; }
.order__estadomsg { font-size: 0.74rem; margin-top: 0.4rem; }
.order__estadomsg--ok { color: #2ecc8f; }
.order__estadomsg--err { color: #e0566b; }

/* ── Spinner ── */
.spinner { width: 22px; height: 22px; border: 2px solid var(--text-3); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
.spinner--sm { width: 14px; height: 14px; border-width: 2px; border-color: currentColor; border-top-color: transparent; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (min-width: 760px) {
  .order__cols { grid-template-columns: 1.3fr 1fr; }
}
</style>
