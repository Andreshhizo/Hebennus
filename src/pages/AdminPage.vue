<script setup>
// ─── PANEL DE ADMINISTRACIÓN (/admin) ───────────────────────────────────────
// Acceso protegido por Supabase Auth + función is_admin() (RLS). Solo usuarios
// que estén en la tabla `admins` pueden leer/gestionar pedidos.
import { ref, computed, onMounted, nextTick } from 'vue'
import { supabase } from '../lib/supabase.js'
import AdminCustomers from '../components/AdminCustomers.vue'

const vista = ref('pedidos')   // 'pedidos' | 'clientes'
const ESTADOS = ['pendiente', 'confirmado', 'enviado', 'entregado', 'cancelado', 'reembolsado']
const ESTADO_COLOR = {
  pendiente:  '#e0a23b',
  confirmado: '#5b8def',
  enviado:    '#7c5cff',
  entregado:  '#2ecc8f',
  cancelado:  '#e0566b',
  reembolsado:'#9aa0b0',
}

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
  await supabase.auth.signOut()
  session.value = null
  esAdmin.value = false
  pedidos.value = []
}

async function cambiarEstado(pedido, nuevo) {
  const anterior = pedido.status
  pedido.status = nuevo // optimista
  const { error } = await supabase.from('orders').update({ status: nuevo }).eq('id', pedido.id)
  if (error) {
    pedido.status = anterior
    pedidosError.value = 'No se pudo actualizar el estado: ' + error.message
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
        <h1 class="dash__title">{{ vista === 'pedidos' ? 'Pedidos' : 'Clientes' }}</h1>
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
    </div>

    <template v-if="vista === 'pedidos'">
    <div class="dash__filters">
      <button :class="['chip', { 'chip--on': filtro === 'todos' }]" @click="filtro = 'todos'">Todos</button>
      <button
        v-for="e in ESTADOS" :key="e"
        :class="['chip', { 'chip--on': filtro === e }]"
        @click="filtro = e"
      >{{ e }}</button>
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
            <span class="badge" :style="{ '--c': ESTADO_COLOR[o.status] || '#888' }">{{ o.status }}</span>
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
                Pago: {{ o.payment_method }} · Comprobante: {{ o.comprobante_tipo }}
                <template v-if="o.doc_numero"> ({{ o.doc_tipo }} {{ o.doc_numero }})</template>
              </p>
              <label class="order__estado">
                Estado:
                <select :value="o.status" @change="cambiarEstado(o, $event.target.value)">
                  <option v-for="e in ESTADOS" :key="e" :value="e">{{ e }}</option>
                </select>
              </label>
            </div>
          </div>
        </div>
      </li>
    </ul>
    </template>

    <AdminCustomers v-else @ver-pedido="verPedido" />
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
.order__estado { display: block; margin-top: 1rem; font-size: 0.78rem; color: var(--text-2); }
.order__estado select { margin-left: 0.5rem; padding: 0.4rem 0.6rem; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); text-transform: capitalize; }

/* ── Spinner ── */
.spinner { width: 22px; height: 22px; border: 2px solid var(--text-3); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
.spinner--sm { width: 14px; height: 14px; border-width: 2px; border-color: currentColor; border-top-color: transparent; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (min-width: 760px) {
  .order__cols { grid-template-columns: 1.3fr 1fr; }
}
</style>
