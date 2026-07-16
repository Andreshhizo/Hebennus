<script setup>
// ─── PANEL DE ADMINISTRACIÓN (/admin) ───────────────────────────────────────
// Acceso protegido por Supabase Auth + función is_admin() (RLS). Solo usuarios
// que estén en la tabla `admins` pueden leer/gestionar pedidos.
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue'
import { supabase } from '../lib/supabase.js'
import { purgeSupabaseTokens } from '../lib/useAuth.js'
import { ESTADOS, ESTADO_COLOR, ESTADO_LABEL, ESTADOS_DEVUELVE_STOCK } from '../lib/pedidos.js'
import { validarTelefonoPE } from '../lib/validation.js'
import AdminDashboard from '../components/AdminDashboard.vue'
import AdminCustomers from '../components/AdminCustomers.vue'
import AdminProducts from '../components/AdminProducts.vue'
import AdminTickets from '../components/AdminTickets.vue'
import AdminPaymentTests from '../components/AdminPaymentTests.vue'

// Solo en desarrollo mostramos la pestaña "Tests de pago" (la tabla payment_tests
// no existe en producción). import.meta.env.DEV no es accesible desde el template,
// por eso lo exponemos como constante.
const DEV = import.meta.env.DEV

const vista = ref('resumen')   // 'resumen' | 'pedidos' | 'clientes' | 'productos' | 'tests' (solo en dev)

const TITULOS = { resumen: 'Resumen', pedidos: 'Pedidos', clientes: 'Clientes', productos: 'Productos', reclamos: 'Reclamos', tests: 'Tests de pago' }
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
const detalle        = ref(null)   // pedido abierto en el modal de detalle
const editPed        = reactive({ customer_name: '', customer_phone: '', notes: '' })
const guardandoPed   = ref(false)
const pedMsg         = ref(null)   // { tipo:'ok'|'error', texto }
const filtro         = ref('todos')
const busqueda       = ref('')     // buscador por nº pedido / nombre / correo / teléfono
const pagina         = ref(1)      // paginación (1-based)
const POR_PAGINA     = 10
const marcandoPagado = ref(null)   // id del pedido que se está marcando como pagado (evita doble click)
const estadoBusy     = ref(null)   // id del pedido cuyo estado se está cambiando
const estadoMsg      = ref({})     // { [orderId]: { tipo: 'ok'|'error', texto } }

// 1) Filtro por estado (chips).
const pedidosFiltrados = computed(() =>
  filtro.value === 'todos' ? pedidos.value : pedidos.value.filter(o => o.status === filtro.value)
)
// 2) Búsqueda de texto sobre el resultado del filtro.
const pedidosBuscados = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  if (!q) return pedidosFiltrados.value
  return pedidosFiltrados.value.filter(o =>
    (o.order_number  || '').toLowerCase().includes(q) ||
    (o.customer_name || '').toLowerCase().includes(q) ||
    (o.customer_email|| '').toLowerCase().includes(q) ||
    (o.customer_phone|| '').toLowerCase().includes(q),
  )
})
// 3) Paginación de 10 en 10.
const totalPaginas  = computed(() => Math.max(1, Math.ceil(pedidosBuscados.value.length / POR_PAGINA)))
const paginaActual  = computed(() => Math.min(pagina.value, totalPaginas.value))
const pedidosPagina = computed(() => {
  const start = (paginaActual.value - 1) * POR_PAGINA
  return pedidosBuscados.value.slice(start, start + POR_PAGINA)
})
// Al cambiar filtro o búsqueda, volver a la primera página.
watch([filtro, busqueda], () => { pagina.value = 1 })

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
    // Admin·1: si hay un modal abierto, re-vincúlalo al objeto NUEVO de la lista
    // (los de `data` son instancias nuevas; el `detalle.value` viejo quedaría
    // desincronizado y seguiría mostrando "Marcar pagado"/estado antiguos).
    // Se busca por order_number (o id); si ya no existe, se cierra el modal.
    if (detalle.value) {
      const prev = detalle.value
      detalle.value = pedidos.value.find(p =>
        (prev.order_number && p.order_number === prev.order_number) || p.id === prev.id,
      ) || null
    }
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
async function cambiarEstado(pedido, nuevo, ev) {
  if (!nuevo || nuevo === pedido.status) return
  // Admin·4: si ya hay un cambio de estado en vuelo, ignora este pero devuelve el
  // <select> a su valor real. Con :value (one-way) el DOM se quedaría mostrando
  // un estado que nunca se guardó.
  if (estadoBusy.value) {
    if (ev && ev.target) ev.target.value = pedido.status
    return
  }

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

    if (['confirmado', 'enviado', 'entregado'].includes(nuevo)) {
      // Aviso al cliente (best-effort; no revierte el estado si falla).
      let avisado = false
      try {
        const { data: mail } = await supabase.functions.invoke('admin-notificar-envio', {
          body: { order_number: pedido.order_number, status: nuevo },
        })
        avisado = mail?.email_sent === true
      } catch (_) { /* correo best-effort */ }
      estadoMsg.value = { ...estadoMsg.value, [pedido.id]: {
        tipo: 'ok',
        texto: avisado ? `✓ ${ESTADO_LABEL[nuevo]} · correo enviado al cliente`
                       : `✓ ${ESTADO_LABEL[nuevo]} (no se pudo enviar el correo)`,
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
    const { data, error } = await supabase.rpc('admin_marcar_pagado', { p_order_number: pedido.order_number })
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
    // El RPC puede devolver oversold=true: el pago quedó marcado PAGADO pero YA NO
    // hay stock. Somos honestos: avisamos que hay que revisar/reembolsar en vez de
    // tratarlo como confirmado (NO enviamos el correo de "confirmado" al cliente).
    if (data?.oversold === true) {
      pedMsg.value = { tipo: 'error', texto: '⚠️ Pagado, pero SIN stock: revisar/reembolsar este pedido.' }
      await cargarPedidos() // refresca para reflejar payment_status='pagado'
      return
    }
    // Avisar al cliente que confirmamos su pago (best-effort; no bloquea).
    try {
      await supabase.functions.invoke('admin-notificar-envio', {
        body: { order_number: pedido.order_number, status: 'confirmado' },
      })
    } catch (_) { /* correo best-effort */ }
    pedMsg.value = { tipo: 'ok', texto: '✓ Pago confirmado' }
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

// Admin·8: normaliza lo pegado/tecleado en el teléfono. Deja solo dígitos y, si
// quedan 11 empezando en 51 (p. ej. "+51 987 654 321"), quita el prefijo país
// antes de recortar a 9. Evita el corte erróneo de replace+slice(0,9).
function normalizarTelefono(v) {
  let d = String(v ?? '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('51')) d = d.slice(2)
  return d.slice(0, 9)
}

// ── Detalle del pedido (modal) + edición de datos de contacto/envío ──
function abrirDetalle(o) {
  detalle.value = o
  pedMsg.value = null
  // Admin·6: limpia el mensaje de estado previo para no mostrar el ✓/error viejo.
  estadoMsg.value = { ...estadoMsg.value, [o.id]: null }
  editPed.customer_name  = o.customer_name || ''
  editPed.customer_phone = o.customer_phone || ''
  editPed.notes          = o.notes || ''
}
function cerrarDetalle() { detalle.value = null; pedMsg.value = null }

async function guardarDatos() {
  const o = detalle.value
  if (!o || guardandoPed.value) return
  pedMsg.value = null
  if (editPed.customer_name.trim().length < 3) { pedMsg.value = { tipo: 'error', texto: 'Ingresa el nombre del cliente.' }; return }
  // Admin·5: valida el teléfono SOLO si el admin lo cambió respecto al guardado.
  // Así se pueden editar dirección/notas aunque el teléfono heredado sea inválido.
  const telOriginal = (o.customer_phone || '').trim()
  const telNuevo = editPed.customer_phone.trim()
  if (telNuevo !== telOriginal && !validarTelefonoPE(telNuevo)) {
    pedMsg.value = { tipo: 'error', texto: 'Teléfono inválido (9 dígitos, empieza con 9).' }; return
  }
  guardandoPed.value = true
  try {
    const patch = {
      customer_name: editPed.customer_name.trim(),
      customer_phone: editPed.customer_phone.trim(),
      notes: editPed.notes.trim(),
    }
    const { error } = await supabase.from('orders').update(patch).eq('id', o.id)
    if (error) throw error
    Object.assign(o, patch)   // refleja en la fila
    pedMsg.value = { tipo: 'ok', texto: '✓ Datos guardados' }
  } catch (err) {
    pedMsg.value = { tipo: 'error', texto: 'No se pudo guardar: ' + (err?.message || '') }
  } finally {
    guardandoPed.value = false
  }
}

// Desde la vista Clientes: ir a Pedidos y abrir el detalle del pedido.
async function verPedido(id) {
  vista.value = 'pedidos'
  filtro.value = 'todos'
  busqueda.value = ''            // Admin·7: no dejar la lista filtrada ocultando el pedido
  await nextTick()
  let o = pedidos.value.find((p) => p.id === id)
  if (!o) {
    // No está en el cache (lista vieja o aún sin cargar): recarga y reintenta.
    await cargarPedidos()
    o = pedidos.value.find((p) => p.id === id)
  }
  if (o) abrirDetalle(o)
  else pedidosError.value = 'No se encontró el pedido solicitado. Actualiza la lista.'
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
      <button :class="['dtab', { 'dtab--on': vista === 'resumen' }]" @click="vista = 'resumen'">Resumen</button>
      <button :class="['dtab', { 'dtab--on': vista === 'pedidos' }]" @click="vista = 'pedidos'">Pedidos</button>
      <button :class="['dtab', { 'dtab--on': vista === 'reclamos' }]" @click="vista = 'reclamos'">Reclamos</button>
      <button :class="['dtab', { 'dtab--on': vista === 'clientes' }]" @click="vista = 'clientes'">Clientes</button>
      <button :class="['dtab', { 'dtab--on': vista === 'productos' }]" @click="vista = 'productos'">Productos</button>
      <!-- Solo en desarrollo: la tabla payment_tests no existe en producción. -->
      <button v-if="DEV" :class="['dtab', { 'dtab--on': vista === 'tests' }]" @click="vista = 'tests'">Tests de pago</button>
    </div>

    <AdminDashboard v-if="vista === 'resumen'" />

    <template v-else-if="vista === 'pedidos'">
    <div class="dash__filters">
      <button :class="['chip', { 'chip--on': filtro === 'todos' }]" @click="filtro = 'todos'">Todos</button>
      <button
        v-for="e in ESTADOS" :key="e"
        :class="['chip', { 'chip--on': filtro === e }]"
        @click="filtro = e"
      >{{ ESTADO_LABEL[e] }}</button>
    </div>

    <div class="dash__search">
      <input v-model="busqueda" type="search" class="dash__searchinput"
             placeholder="Buscar por N° de pedido, nombre, correo o teléfono…" />
      <span v-if="busqueda.trim()" class="dash__searchcount">{{ pedidosBuscados.length }} resultado(s)</span>
    </div>

    <p v-if="pedidosError" class="dash__error" role="alert">{{ pedidosError }}</p>

    <div v-if="cargandoPed" class="admin__center"><span class="spinner"></span></div>

    <p v-else-if="!pedidosBuscados.length" class="dash__empty">
      {{ busqueda.trim()
          ? `No hay pedidos que coincidan con "${busqueda.trim()}".`
          : (filtro !== 'todos' ? `No hay pedidos en estado "${ESTADO_LABEL[filtro] || filtro}".` : 'No hay pedidos.') }}
    </p>

    <ul v-else class="orders">
      <li v-for="o in pedidosPagina" :key="o.id" :id="'ord-' + o.id" class="order">
        <div class="order__head" @click="abrirDetalle(o)">
          <div class="order__main">
            <span class="order__num">{{ o.order_number || ('#' + o.id) }}</span>
            <span class="order__cust">{{ o.customer_name }}</span>
            <span class="order__date">{{ fmtFecha(o.created_at) }}</span>
          </div>
          <div class="order__right">
            <span class="order__total">{{ money(o.total) }}</span>
            <span
              class="badge"
              :style="{ '--c': o.payment_status === 'pagado' ? 'var(--success)' : (o.payment_status === 'fallido' ? 'var(--danger)' : '#e0a23b') }"
            >{{ o.payment_status === 'pagado' ? 'Pagado' : (o.payment_status === 'fallido' ? 'Pago fallido' : 'Pago pendiente') }}</span>
            <span class="badge" :style="{ '--c': ESTADO_COLOR[o.status] || '#888' }">{{ ESTADO_LABEL[o.status] || o.status }}</span>
            <button class="order__ver" @click.stop="abrirDetalle(o)">Ver detalle →</button>
          </div>
        </div>
      </li>
    </ul>

    <div v-if="!cargandoPed && totalPaginas > 1" class="pager">
      <button class="pager__btn" :disabled="paginaActual <= 1" @click="pagina = paginaActual - 1">← Anterior</button>
      <span class="pager__info">Página {{ paginaActual }} de {{ totalPaginas }}</span>
      <button class="pager__btn" :disabled="paginaActual >= totalPaginas" @click="pagina = paginaActual + 1">Siguiente →</button>
    </div>

    <!-- ── Modal: detalle del pedido + edición segura ── -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="detalle" class="odm__overlay" @click.self="cerrarDetalle">
          <div class="odm" role="dialog" aria-modal="true" aria-label="Detalle del pedido">
            <div class="odm__head">
              <div>
                <h3 class="odm__title">{{ detalle.order_number || ('#' + detalle.id) }}</h3>
                <p class="odm__sub">{{ fmtFecha(detalle.created_at) }}</p>
              </div>
              <button class="odm__x" @click="cerrarDetalle" aria-label="Cerrar">✕</button>
            </div>

            <div class="odm__body">
              <h4 class="odm__h4">Productos</h4>
              <ul class="items">
                <li v-for="it in detalle.order_items" :key="it.id" class="item">
                  <span>{{ it.name }} · {{ it.size }}<template v-if="it.color"> / {{ it.color }}</template> × {{ it.qty }}</span>
                  <span>{{ money(it.subtotal) }}</span>
                </li>
              </ul>
              <div class="totales">
                <span>Subtotal</span><span>{{ money(detalle.subtotal) }}</span>
                <template v-if="detalle.discount > 0"><span>Descuento</span><span>-{{ money(detalle.discount) }}</span></template>
                <span>Envío</span><span>{{ detalle.shipping > 0 ? money(detalle.shipping) : 'Gratis' }}</span>
                <span class="totales__big">Total</span><span class="totales__big">{{ money(detalle.total) }}</span>
              </div>

              <p class="order__p order__p--muted">
                Pago: {{ metodoPagoLabel(detalle.payment_method) }} · {{ detalle.payment_status === 'pagado' ? 'Pagado' : (detalle.payment_status === 'fallido' ? 'Pago fallido' : 'Pago pendiente') }} · Comprobante: {{ detalle.comprobante_tipo }}
                <template v-if="detalle.doc_numero"> ({{ detalle.doc_tipo }} {{ detalle.doc_numero }})</template>
              </p>

              <div class="odm__acciones">
                <button
                  v-if="detalle.payment_status !== 'pagado' && detalle.payment_method === 'yape_manual'"
                  class="order__pagado"
                  :disabled="marcandoPagado === detalle.id"
                  @click="marcarPagado(detalle)"
                >
                  <span v-if="marcandoPagado === detalle.id" class="spinner spinner--sm"></span>
                  {{ marcandoPagado === detalle.id ? 'Procesando…' : '✓ Marcar pagado' }}
                </button>
                <label class="order__estado">
                  Estado:
                  <select :value="detalle.status" :disabled="estadoBusy === detalle.id" @change="cambiarEstado(detalle, $event.target.value, $event)">
                    <option v-for="e in ESTADOS" :key="e" :value="e">{{ ESTADO_LABEL[e] }}</option>
                  </select>
                  <span v-if="estadoBusy === detalle.id" class="spinner spinner--sm"></span>
                </label>
                <p v-if="estadoMsg[detalle.id]"
                   :class="['order__estadomsg', estadoMsg[detalle.id].tipo === 'error' ? 'order__estadomsg--err' : 'order__estadomsg--ok']">
                  {{ estadoMsg[detalle.id].texto }}
                </p>
              </div>

              <h4 class="odm__h4">Datos de contacto y envío</h4>
              <p class="odm__hint">Correo del pedido: <strong>{{ detalle.customer_email }}</strong> (no editable aquí)</p>
              <div class="odm__grid">
                <label class="odm__f"><span>Nombre</span><input v-model="editPed.customer_name" class="odm__input" /></label>
                <label class="odm__f"><span>Teléfono</span>
                  <input v-model="editPed.customer_phone" inputmode="numeric" maxlength="20" class="odm__input"
                         @input="editPed.customer_phone = normalizarTelefono(editPed.customer_phone)" />
                </label>
              </div>
              <label class="odm__f"><span>Dirección / notas de envío</span>
                <textarea v-model="editPed.notes" rows="3" class="odm__input"></textarea>
              </label>
              <p v-if="pedMsg" :class="['odm__msg', pedMsg.tipo === 'error' ? 'odm__msg--err' : 'odm__msg--ok']">{{ pedMsg.texto }}</p>
            </div>

            <div class="odm__foot">
              <button class="odm__cancel" @click="cerrarDetalle">Cerrar</button>
              <button class="odm__save" :disabled="guardandoPed" @click="guardarDatos">
                <span v-if="guardandoPed" class="spinner spinner--sm"></span>
                {{ guardandoPed ? 'Guardando…' : 'Guardar datos' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
    </template>

    <AdminTickets v-else-if="vista === 'reclamos'" />

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
.login__error { color: var(--danger); font-size: 0.78rem; }
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
.dash__logout { color: var(--danger); }
.dash__tabs { display: flex; gap: 0.5rem; margin: 1.25rem 0 0.5rem; border-bottom: 1px solid var(--border); }
.dtab { padding: 0.6rem 1rem; font-size: 0.8rem; font-weight: 600; color: var(--text-3); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.dtab--on { color: var(--text-1); border-bottom-color: var(--accent); }
.dash__filters { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 1.5rem 0 1rem; }
.chip {
  padding: 0.35rem 0.8rem; font-size: 0.72rem; text-transform: capitalize; cursor: pointer;
  background: var(--surface-2); border: 1px solid var(--border); color: var(--text-2); border-radius: 999px;
}
.chip--on { background: var(--accent); border-color: var(--accent); color: var(--ink); font-weight: 600; }
.dash__search { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; }
.dash__searchinput { flex: 1; min-width: 240px; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); padding: 0.6rem 0.85rem; font-size: 0.88rem; outline: none; border-radius: 8px; }
.dash__searchinput:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--glow-color); }
.dash__searchcount { font-size: 0.74rem; color: var(--text-3); white-space: nowrap; }
.dash__error { color: var(--danger); font-size: 0.82rem; margin: 0.5rem 0; }
.dash__empty { color: var(--text-3); padding: 3rem 0; text-align: center; }
.pager { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: 1.25rem; flex-wrap: wrap; }
.pager__btn { padding: 0.5rem 1rem; font-size: 0.76rem; font-weight: 600; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); cursor: pointer; border-radius: 6px; }
.pager__btn:hover:not(:disabled) { color: var(--text-1); border-color: var(--accent); }
.pager__btn:disabled { opacity: 0.45; cursor: not-allowed; }
.pager__info { font-size: 0.78rem; color: var(--text-3); }

/* ── Orders ── */
.orders { list-style: none; display: flex; flex-direction: column; gap: 0.6rem; }
.order { border: 1px solid var(--border-mid); background: var(--card-bg); animation: hb-fade-up 0.3s ease both; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
.order:hover { box-shadow: var(--shadow-card-hover); }
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
  letter-spacing: 0.05em; cursor: pointer; background: var(--success); border: 1px solid var(--success);
  color: var(--ink); display: inline-flex; align-items: center; gap: 0.45rem;
}
.order__pagado:hover { filter: brightness(1.05); }
.order__pagado:disabled { opacity: 0.6; cursor: not-allowed; }
.order__estado { display: inline-flex; align-items: center; gap: 0.5rem; margin-top: 1rem; font-size: 0.78rem; color: var(--text-2); }
.order__estado select { margin-left: 0.5rem; padding: 0.4rem 0.6rem; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); }
.order__estado select:disabled { opacity: 0.6; cursor: wait; }
.order__estadomsg { font-size: 0.74rem; margin-top: 0.4rem; }
.order__estadomsg--ok { color: var(--success); }
.order__estadomsg--err { color: var(--danger); }
.order__ver { padding: 0.35rem 0.7rem; font-size: 0.72rem; font-weight: 600; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); cursor: pointer; border-radius: 6px; white-space: nowrap; }
.order__ver:hover { color: var(--text-1); border-color: var(--accent); }

/* ── Modal detalle de pedido ── */
.odm__overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(3px); display: grid; place-items: center; z-index: 400; padding: 1rem; }
.odm { width: 100%; max-width: 620px; max-height: 90vh; display: flex; flex-direction: column; background: var(--card-bg); border: 1px solid var(--border-mid); border-radius: 12px; box-shadow: 0 24px 64px rgba(0,0,0,0.4); overflow: hidden; }
.odm__head { display: flex; justify-content: space-between; align-items: flex-start; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); }
.odm__title { font-family: var(--font-display); font-size: 1.05rem; font-weight: 800; color: var(--text-1); }
.odm__sub { font-size: 0.74rem; color: var(--text-3); margin-top: 0.15rem; }
.odm__x { background: transparent; border: none; font-size: 1.1rem; color: var(--text-3); cursor: pointer; }
.odm__x:hover { color: var(--text-1); }
.odm__body { padding: 1.25rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.6rem; }
.odm__h4 { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-3); margin-top: 0.5rem; }
.odm__hint { font-size: 0.74rem; color: var(--text-3); }
.odm__acciones { display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start; padding: 0.8rem 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.odm__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
.odm__f { display: flex; flex-direction: column; gap: 0.25rem; }
.odm__f > span { font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); font-weight: 600; }
.odm__input { background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); padding: 0.5rem 0.6rem; font-size: 0.88rem; outline: none; border-radius: 6px; font-family: inherit; }
.odm__input:focus-visible { border-color: var(--accent); }
.odm__msg { font-size: 0.78rem; margin-top: 0.2rem; }
.odm__msg--ok { color: var(--success); }
.odm__msg--err { color: var(--danger); }
.odm__foot { display: flex; justify-content: flex-end; gap: 0.7rem; padding: 1rem 1.25rem; border-top: 1px solid var(--border); }
.odm__cancel { padding: 0.6rem 1rem; font-size: 0.78rem; color: var(--text-3); background: transparent; border: 1px solid var(--border-mid); border-radius: 6px; cursor: pointer; }
.odm__cancel:hover { color: var(--text-1); }
.odm__save { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.6rem 1.3rem; font-size: 0.76rem; font-weight: 700; cursor: pointer; background: var(--accent); border: 1px solid var(--accent); color: var(--ink); border-radius: 6px; }
.odm__save:hover:not(:disabled) { filter: brightness(1.08); }
.odm__save:disabled { opacity: 0.55; cursor: not-allowed; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ── Spinner ── */
.spinner { width: 22px; height: 22px; border: 2px solid var(--text-3); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
.spinner--sm { width: 14px; height: 14px; border-width: 2px; border-color: currentColor; border-top-color: transparent; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (min-width: 760px) {
  .order__cols { grid-template-columns: 1.3fr 1fr; }
}
</style>
