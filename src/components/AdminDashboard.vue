<script setup>
// ─── Panel admin · Vista RESUMEN (dashboard de métricas) ─────────────────────
// Métricas de negocio para el admin: ingresos, pedidos, clientes nuevos, ticket
// promedio, evolución de ingresos, desglose por estado / método / cobro, salud
// de inventario y ranking de productos (más vendidos y más visitados).
//
// Lectura directa (RLS de admin) de orders / profiles / products; las vistas de
// producto se agregan en el servidor vía RPC admin_product_views. Todo se calcula
// en el cliente y se re-filtra por el rango de fechas elegido (sin recargar, salvo
// las vistas, que se re-consultan al cambiar el rango).
import { ref, computed, onMounted, watch } from 'vue'
import { supabase } from '../lib/supabase.js'
import { ESTADOS, ESTADO_COLOR, ESTADO_LABEL } from '../lib/pedidos.js'
import { STOCK_LOW_THRESHOLD } from '../lib/config.js'

const DAY = 86400000
const CANCELADOS = new Set(['cancelado', 'reembolsado'])   // no cuentan como ingreso
const METODOS = ['izipay', 'yape_manual', 'contraentrega']
// 'otro' agrupa métodos nulos/desconocidos (no se asumen como Contraentrega).
const METODO_LABEL = { izipay: 'Tarjeta / Izipay', yape_manual: 'Yape (manual)', contraentrega: 'Contraentrega', otro: 'Otro / Desconocido' }
// Paleta categórica de marca en orden FIJO (nunca se cicla ni se repinta por rango).
const METODO_COLOR = { izipay: 'var(--accent)', yape_manual: 'var(--accent-2)', contraentrega: 'var(--accent-3)', otro: 'var(--text-3)' }

// ── Estado ──
const cargando = ref(true)
const error    = ref('')
const orders   = ref([])
const profiles = ref([])
const products = ref([])
const vistas   = ref([])          // [{ product_id, name, views }] del rango
const vistasTotal = ref(null)     // total de vistas del rango (para conversión); null = no disponible
const vistasError = ref(false)    // la RPC aún no está desplegada / falló

// ── Filtro de fechas ──
const preset      = ref('30d')    // 'hoy' | '7d' | '30d' | '90d' | 'todo' | 'custom'
const customDesde = ref('')
const customHasta = ref('')

const PRESETS = [
  { id: 'hoy',  label: 'Hoy' },
  { id: '7d',   label: '7 días' },
  { id: '30d',  label: '30 días' },
  { id: '90d',  label: '90 días' },
  { id: 'todo', label: 'Todo' },
  { id: 'custom', label: 'Personalizado' },
]

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function startOfWeek(d) { const x = startOfDay(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x }
function startOfMonth(d) { const x = startOfDay(d); x.setDate(1); return x }

// Rango efectivo { desde, hasta }. desde inclusivo, hasta exclusivo. null = sin tope.
const rango = computed(() => {
  const now = new Date()
  const p = preset.value
  if (p === 'todo') return { desde: null, hasta: null, label: 'Todo el histórico' }
  if (p === 'custom') {
    const d = customDesde.value ? startOfDay(new Date(customDesde.value + 'T00:00:00')) : null
    const h = customHasta.value ? new Date(startOfDay(new Date(customHasta.value + 'T00:00:00')).getTime() + DAY) : null
    return { desde: d, hasta: h, label: 'Personalizado' }
  }
  if (p === 'hoy') return { desde: startOfDay(now), hasta: null, label: 'Hoy' }
  const dias = p === '7d' ? 7 : p === '90d' ? 90 : 30
  return { desde: new Date(startOfDay(now).getTime() - (dias - 1) * DAY), hasta: null, label: `Últimos ${dias} días` }
})

function enRango(fecha) {
  const { desde, hasta } = rango.value
  const t = +new Date(fecha)
  if (desde && t < +desde) return false
  if (hasta && t >= +hasta) return false
  return true
}

// Rango personalizado inválido: "Hasta" es anterior a "Desde" (hasta es exclusivo,
// = fin de día + 1; si es <= desde el rango está al revés). Avisamos en vez de
// mostrar "Sin datos" sin explicación.
const rangoInvalido = computed(() => {
  if (preset.value !== 'custom') return false
  const { desde, hasta } = rango.value
  return !!(desde && hasta && +hasta <= +desde)
})

// ── Colecciones filtradas ──
const pedidosPeriodo = computed(() => orders.value.filter(o => enRango(o.created_at)))
const pedidosValidos = computed(() => pedidosPeriodo.value.filter(o => !CANCELADOS.has(o.status)))
const clientesNuevos = computed(() => profiles.value.filter(p => p.created_at && enRango(p.created_at)))

// ── KPIs ──
const kpis = computed(() => {
  const validos = pedidosValidos.value
  const ingresos = validos.reduce((s, o) => s + Number(o.total || 0), 0)
  // Cobrado = pagados que NO estén cancelados/reembolsados (si no, superaría "ingresos").
  const cobrado  = validos.filter(o => o.payment_status === 'pagado').reduce((s, o) => s + Number(o.total || 0), 0)
  const unidades = validos.reduce((s, o) => s + (o.order_items || []).reduce((a, it) => a + Number(it.qty || 0), 0), 0)
  const nPed = pedidosPeriodo.value.length
  // Conversión (proxy): pedidos por cada 100 vistas de ficha en el período.
  // null si aún no hay tracking de vistas desplegado o no hubo vistas.
  const conv = (vistasTotal.value && vistasTotal.value > 0) ? (nPed / vistasTotal.value) * 100 : null
  return {
    ingresos, cobrado, unidades, nPed,
    aov: validos.length ? ingresos / validos.length : 0,
    nuevos: clientesNuevos.value.length,
    pendientes: pedidosPeriodo.value.filter(o => o.status === 'pendiente').length,
    conversion: conv,
    vistasTotal: vistasTotal.value,
  }
})

// ── Serie de ingresos en el tiempo (bucketing adaptativo) ──
const serieIngresos = computed(() => {
  const os = pedidosValidos.value
  let ini = rango.value.desde
  const fin = rango.value.hasta ? new Date(+rango.value.hasta - 1) : new Date()
  if (!ini) ini = os.length ? new Date(Math.min(...os.map(o => +new Date(o.created_at)))) : fin

  const spanDias = Math.max(1, Math.round((startOfDay(fin) - startOfDay(ini)) / DAY) + 1)
  const gran = spanDias > 182 ? 'month' : spanDias > 31 ? 'week' : 'day'
  const stepStart = gran === 'day' ? startOfDay : gran === 'week' ? startOfWeek : startOfMonth
  const avanzar = (d) => {
    const x = new Date(d)
    if (gran === 'day') x.setDate(x.getDate() + 1)
    else if (gran === 'week') x.setDate(x.getDate() + 7)
    else x.setMonth(x.getMonth() + 1)
    return x
  }

  const buckets = new Map()
  let cursor = stepStart(ini)
  const tope = stepStart(fin)
  let guard = 0
  while (cursor <= tope && guard < 400) {
    buckets.set(+cursor, { key: +cursor, total: 0, count: 0, date: new Date(cursor) })
    cursor = avanzar(cursor); guard++
  }
  for (const o of os) {
    const b = buckets.get(+stepStart(new Date(o.created_at)))
    if (b) { b.total += Number(o.total || 0); b.count++ }
  }
  const arr = [...buckets.values()]
  const max = Math.max(1, ...arr.map(b => b.total))
  return { gran, max, buckets: arr }
})

function etiquetaBucket(b, gran) {
  const d = b.date
  if (gran === 'month') return d.toLocaleDateString('es-PE', { month: 'short', year: '2-digit' })
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' })
}
// Muestra etiqueta solo cada N barras (evita colisión); siempre la primera y la última.
const pasoEtiqueta = computed(() => Math.max(1, Math.ceil(serieIngresos.value.buckets.length / 8)))
function mostrarEtiqueta(i) {
  const n = serieIngresos.value.buckets.length
  return i === 0 || i === n - 1 || i % pasoEtiqueta.value === 0
}

// ── Desglose por estado del pedido ──
const porEstado = computed(() => {
  const c = Object.fromEntries(ESTADOS.map(e => [e, 0]))
  for (const o of pedidosPeriodo.value) if (o.status in c) c[o.status]++
  const max = Math.max(1, ...Object.values(c))
  const total = pedidosPeriodo.value.length || 1
  return ESTADOS.map(e => ({ estado: e, count: c[e], pct: (c[e] / max) * 100, share: (c[e] / total) * 100 }))
})

// ── Estado de cobro (payment_status) ──
const porCobro = computed(() => {
  let pagado = 0, fallido = 0, pendiente = 0
  for (const o of pedidosPeriodo.value) {
    if (CANCELADOS.has(o.status)) continue   // cancelados/reembolsados no cuentan como cobro
    if (o.payment_status === 'pagado') pagado++
    else if (o.payment_status === 'fallido') fallido++
    else pendiente++
  }
  return { pagado, pendiente, fallido }
})

// ── Desglose por método de pago ──
const porMetodo = computed(() => {
  const claves = [...METODOS, 'otro']
  const m = Object.fromEntries(claves.map(k => [k, { count: 0, revenue: 0 }]))
  for (const o of pedidosPeriodo.value) {
    // Método nulo/desconocido → 'otro' (no se cuenta como Contraentrega).
    const k = METODOS.includes(o.payment_method) ? o.payment_method : 'otro'
    m[k].count++
    if (!CANCELADOS.has(o.status)) m[k].revenue += Number(o.total || 0)
  }
  const max = Math.max(1, ...claves.map(k => m[k].count))
  // 'otro' solo aparece si hubo pedidos con método desconocido (no ensucia el gráfico).
  return claves
    .filter(k => k !== 'otro' || m[k].count > 0)
    .map(k => ({ metodo: k, ...m[k], pct: (m[k].count / max) * 100 }))
})

// ── Salud de inventario (foto ACTUAL; no depende del rango) ──
const inventario = computed(() => {
  let unidades = 0, agotados = 0, bajos = 0
  const alerta = []
  for (const p of products.value) {
    const stock = (p.product_variants || []).reduce((s, v) => s + Number(v.stock || 0), 0)
    unidades += stock
    const out = stock === 0 || p.sold_out === true
    if (out) agotados++
    else if (stock <= STOCK_LOW_THRESHOLD) bajos++
    if (out || stock <= STOCK_LOW_THRESHOLD) alerta.push({ id: p.id, name: p.name, stock, out, activo: p.is_active })
  }
  alerta.sort((a, b) => a.stock - b.stock)
  return {
    unidades, agotados, bajos,
    activos: products.value.filter(p => p.is_active).length,
    total: products.value.length,
    alerta: alerta.slice(0, 12),
  }
})

// ── Ranking: más vendidos (por unidades) en el rango ──
const topVendidos = computed(() => {
  const m = new Map()
  for (const o of pedidosValidos.value) {
    for (const it of (o.order_items || [])) {
      const k = it.product_id || it.name
      if (!k) continue
      const cur = m.get(k) || { name: it.name || '(producto)', qty: 0, revenue: 0 }
      cur.qty += Number(it.qty || 0)
      cur.revenue += Number(it.subtotal || 0)
      if (!cur.name && it.name) cur.name = it.name
      m.set(k, cur)
    }
  }
  const arr = [...m.values()].sort((a, b) => b.qty - a.qty).slice(0, 8)
  const max = Math.max(1, ...arr.map(x => x.qty))
  return arr.map(x => ({ ...x, pct: (x.qty / max) * 100 }))
})

// ── Ranking: más visitados (RPC agregada) ──
const topVistas = computed(() => {
  const arr = (vistas.value || []).slice(0, 8)
  const max = Math.max(1, ...arr.map(x => Number(x.views || 0)))
  return arr.map(x => ({ name: x.name || '(producto)', views: Number(x.views || 0), pct: (Number(x.views || 0) / max) * 100 }))
})

// ── Carga de datos ──
async function cargar() {
  cargando.value = true; error.value = ''
  try {
    const [oRes, pRes, prRes] = await Promise.all([
      supabase.from('orders').select('id, order_number, total, status, payment_method, payment_status, created_at, order_items(product_id, name, qty, subtotal)').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, created_at'),
      supabase.from('products').select('id, name, is_active, sold_out, product_variants(stock)'),
    ])
    if (oRes.error) throw oRes.error
    if (pRes.error) throw pRes.error
    if (prRes.error) throw prRes.error
    orders.value = oRes.data || []
    profiles.value = pRes.data || []
    products.value = prRes.data || []
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    cargando.value = false
  }
  await cargarVistas()
}

// Token de secuencia: al cambiar el rango varias consultas quedan en vuelo; solo
// la última puede escribir el estado (una respuesta lenta no pisa a una reciente).
let vistasReqId = 0

// Las vistas se agregan en el servidor por rango → se re-consultan al cambiar el filtro.
async function cargarVistas() {
  const reqId = ++vistasReqId
  vistasError.value = false
  const { desde, hasta } = rango.value
  const p_desde = desde ? desde.toISOString() : null
  const p_hasta = hasta ? hasta.toISOString() : null
  try {
    const [rank, total] = await Promise.all([
      supabase.rpc('admin_product_views', { p_desde, p_hasta, p_limit: 8 }),
      supabase.rpc('admin_product_views_total', { p_desde, p_hasta }),
    ])
    if (reqId !== vistasReqId) return   // respuesta obsoleta: llegó otra consulta después
    if (rank.error) throw rank.error
    vistas.value = rank.data || []
    vistasTotal.value = total.error ? null : Number(total.data ?? 0)
  } catch (_) {
    if (reqId !== vistasReqId) return   // no piso el estado de una consulta más reciente
    vistas.value = []
    vistasTotal.value = null
    vistasError.value = true   // RPC no desplegada aún o sin permisos
  }
}

// ── Exportar a CSV los pedidos del período (para Excel/contabilidad) ──────────
function exportarCSV() {
  const filas = [...pedidosPeriodo.value].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  const cab = ['N pedido', 'Fecha', 'Estado', 'Estado de cobro', 'Metodo de pago', 'Unidades', 'Total (S/)']
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const lineas = filas.map(o => [
    o.order_number || ('#' + o.id),
    new Date(o.created_at).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }),
    ESTADO_LABEL[o.status] || o.status,
    o.payment_status || 'pendiente',
    METODO_LABEL[o.payment_method] || o.payment_method || '',
    (o.order_items || []).reduce((s, it) => s + Number(it.qty || 0), 0),
    Number(o.total || 0).toFixed(2),
  ].map(esc).join(','))
  // BOM para que Excel respete los acentos (UTF-8).
  const csv = '﻿' + [cab.join(','), ...lineas].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  // Nombre autodescriptivo: incluye el rango (fechas reales en personalizado).
  const rangoSlug = preset.value === 'custom'
    ? `${customDesde.value || 'inicio'}_a_${customHasta.value || 'hoy'}`
    : preset.value
  a.href = url
  a.download = `hebennus-pedidos-${rangoSlug}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

watch(rango, cargarVistas)

// ── Formato ──
function money(n) { return 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function moneyK(n) {
  const v = Number(n || 0)
  return v >= 10000 ? 'S/ ' + (v / 1000).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + 'k' : money(v)
}
function num(n) { return Number(n || 0).toLocaleString('es-PE') }
function pct1(n) { return Number(n || 0).toFixed(0) + '%' }

onMounted(cargar)
</script>

<template>
<div class="dsh">
  <!-- Barra de filtros -->
  <div class="dsh__bar">
    <div class="dsh__ranges" role="group" aria-label="Rango de fechas">
      <button v-for="p in PRESETS" :key="p.id"
              :class="['rchip', { 'rchip--on': preset === p.id }]"
              @click="preset = p.id">{{ p.label }}</button>
    </div>
    <div class="dsh__baractions">
      <button class="dsh__refresh" :disabled="cargando || !pedidosPeriodo.length" @click="exportarCSV">⬇ CSV</button>
      <button class="dsh__refresh" :disabled="cargando" @click="cargar">↻ Actualizar</button>
    </div>
  </div>

  <div v-if="preset === 'custom'" class="dsh__custom">
    <label>Desde <input v-model="customDesde" type="date" /></label>
    <label>Hasta <input v-model="customHasta" type="date" /></label>
    <span class="dsh__hint">Rango inclusivo por día.</span>
  </div>

  <p v-if="error" class="dsh__error" role="alert">{{ error }}</p>
  <p v-if="rangoInvalido" class="dsh__error" role="alert">La fecha «Hasta» es anterior a «Desde». Corrige el rango para ver datos.</p>
  <div v-if="cargando" class="dsh__center"><span class="spinner"></span></div>

  <template v-else-if="!rangoInvalido">
    <!-- ░░ KPIs ░░ -->
    <p class="dsh__period">{{ rango.label }}</p>
    <div class="kpis">
      <div class="kpi kpi--hero">
        <span class="kpi__label">Ingresos</span>
        <span class="kpi__value">{{ money(kpis.ingresos) }}</span>
        <span class="kpi__sub">{{ money(kpis.cobrado) }} cobrados</span>
      </div>
      <div class="kpi">
        <span class="kpi__label">Pedidos</span>
        <span class="kpi__value">{{ num(kpis.nPed) }}</span>
        <span class="kpi__sub">{{ num(kpis.pendientes) }} pendientes</span>
      </div>
      <div class="kpi">
        <span class="kpi__label">Ticket promedio</span>
        <span class="kpi__value">{{ money(kpis.aov) }}</span>
        <span class="kpi__sub">por pedido</span>
      </div>
      <div class="kpi">
        <span class="kpi__label">Clientes nuevos</span>
        <span class="kpi__value">{{ num(kpis.nuevos) }}</span>
        <span class="kpi__sub">registros</span>
      </div>
      <div class="kpi">
        <span class="kpi__label">Unidades vendidas</span>
        <span class="kpi__value">{{ num(kpis.unidades) }}</span>
        <span class="kpi__sub">prendas</span>
      </div>
      <div class="kpi">
        <span class="kpi__label">Conversión</span>
        <span class="kpi__value">{{ kpis.conversion == null ? '—' : kpis.conversion.toFixed(1) + '%' }}</span>
        <span class="kpi__sub">{{ kpis.conversion == null ? 'requiere vistas' : num(kpis.vistasTotal) + ' vistas' }}</span>
      </div>
    </div>

    <!-- ░░ Ingresos en el tiempo ░░ -->
    <section class="card">
      <h3 class="card__title">Ingresos en el tiempo</h3>
      <p v-if="!serieIngresos.buckets.length" class="card__empty">Sin datos en este rango.</p>
      <template v-else>
        <div class="tbars">
          <div v-for="(b, i) in serieIngresos.buckets" :key="b.key" class="tbar">
            <div class="tbar__fill" :style="{ height: (b.total / serieIngresos.max * 100) + '%' }"></div>
            <span class="tbar__tip">{{ etiquetaBucket(b, serieIngresos.gran) }} · {{ money(b.total) }} · {{ b.count }} ped.</span>
          </div>
        </div>
        <div class="tbars__axis">
          <span v-for="(b, i) in serieIngresos.buckets" :key="'x' + b.key" class="tbars__lbl">
            <template v-if="mostrarEtiqueta(i)">{{ etiquetaBucket(b, serieIngresos.gran) }}</template>
          </span>
        </div>
      </template>
    </section>

    <div class="grid2">
      <!-- ░░ Estado de los pedidos ░░ -->
      <section class="card">
        <h3 class="card__title">Estado de los pedidos</h3>
        <ul class="hbars">
          <li v-for="row in porEstado" :key="row.estado" class="hbar">
            <span class="hbar__name">{{ ESTADO_LABEL[row.estado] }}</span>
            <span class="hbar__track">
              <span class="hbar__fill" :style="{ width: row.pct + '%', background: ESTADO_COLOR[row.estado] }"></span>
            </span>
            <span class="hbar__val">{{ num(row.count) }} <em>{{ pct1(row.share) }}</em></span>
          </li>
        </ul>
      </section>

      <!-- ░░ Estado de cobro ░░ -->
      <section class="card">
        <h3 class="card__title">Estado de cobro</h3>
        <div class="paytiles">
          <div class="paytile">
            <span class="paytile__dot" style="background: var(--success)"></span>
            <span class="paytile__label">✓ Pagados</span>
            <span class="paytile__val">{{ num(porCobro.pagado) }}</span>
          </div>
          <div class="paytile">
            <span class="paytile__dot" style="background: #C9962F"></span>
            <span class="paytile__label">◷ Pago pendiente</span>
            <span class="paytile__val">{{ num(porCobro.pendiente) }}</span>
          </div>
          <div class="paytile">
            <span class="paytile__dot" style="background: var(--danger)"></span>
            <span class="paytile__label">✕ Pago fallido</span>
            <span class="paytile__val">{{ num(porCobro.fallido) }}</span>
          </div>
        </div>

        <h4 class="card__sub">Método de pago</h4>
        <ul class="hbars">
          <li v-for="row in porMetodo" :key="row.metodo" class="hbar">
            <span class="hbar__name">
              <span class="hbar__key" :style="{ background: METODO_COLOR[row.metodo] }"></span>{{ METODO_LABEL[row.metodo] }}
            </span>
            <span class="hbar__track">
              <span class="hbar__fill" :style="{ width: row.pct + '%', background: METODO_COLOR[row.metodo] }"></span>
            </span>
            <span class="hbar__val">{{ num(row.count) }} <em>{{ moneyK(row.revenue) }}</em></span>
          </li>
        </ul>
      </section>
    </div>

    <!-- ░░ Salud de inventario ░░ -->
    <section class="card">
      <div class="card__head">
        <h3 class="card__title">Salud de inventario</h3>
        <span class="card__note">foto actual</span>
      </div>
      <div class="minitiles">
        <div class="minitile"><span class="minitile__v">{{ num(inventario.unidades) }}</span><span class="minitile__l">unidades en stock</span></div>
        <div class="minitile"><span class="minitile__v">{{ num(inventario.activos) }}</span><span class="minitile__l">productos activos</span></div>
        <div class="minitile minitile--warn"><span class="minitile__v">{{ num(inventario.bajos) }}</span><span class="minitile__l">stock bajo (≤{{ STOCK_LOW_THRESHOLD }})</span></div>
        <div class="minitile minitile--danger"><span class="minitile__v">{{ num(inventario.agotados) }}</span><span class="minitile__l">agotados</span></div>
      </div>
      <p v-if="!inventario.alerta.length" class="card__empty">Todo el inventario está por encima del umbral. 👌</p>
      <ul v-else class="stocklist">
        <li v-for="p in inventario.alerta" :key="p.id" class="stockrow">
          <span class="stockrow__name">{{ p.name }}<span v-if="!p.activo" class="stockrow__off">inactivo</span></span>
          <span :class="['stockrow__badge', p.out ? 'is-out' : 'is-low']">{{ p.out ? 'Agotado' : (p.stock + ' u.') }}</span>
        </li>
      </ul>
    </section>

    <div class="grid2">
      <!-- ░░ Más vendidos ░░ -->
      <section class="card">
        <h3 class="card__title">Productos más vendidos</h3>
        <p v-if="!topVendidos.length" class="card__empty">Sin ventas en este rango.</p>
        <ul v-else class="rank">
          <li v-for="(p, i) in topVendidos" :key="'v' + i" class="rankrow">
            <span class="rankrow__pos">{{ i + 1 }}</span>
            <span class="rankrow__body">
              <span class="rankrow__name">{{ p.name }}</span>
              <span class="rankrow__track"><span class="rankrow__fill" :style="{ width: p.pct + '%', background: 'var(--accent)' }"></span></span>
            </span>
            <span class="rankrow__val">{{ num(p.qty) }} u.<em>{{ moneyK(p.revenue) }}</em></span>
          </li>
        </ul>
      </section>

      <!-- ░░ Más visitados ░░ -->
      <section class="card">
        <div class="card__head">
          <h3 class="card__title">Productos más visitados</h3>
          <span class="card__note">desde el lanzamiento</span>
        </div>
        <p v-if="vistasError" class="card__empty">Aún no disponible. Despliega la migración <code>product_views</code> para activar el conteo de visitas.</p>
        <p v-else-if="!topVistas.length" class="card__empty">Sin visitas registradas en este rango todavía.</p>
        <ul v-else class="rank">
          <li v-for="(p, i) in topVistas" :key="'w' + i" class="rankrow">
            <span class="rankrow__pos">{{ i + 1 }}</span>
            <span class="rankrow__body">
              <span class="rankrow__name">{{ p.name }}</span>
              <span class="rankrow__track"><span class="rankrow__fill" :style="{ width: p.pct + '%', background: 'var(--accent-2)' }"></span></span>
            </span>
            <span class="rankrow__val">{{ num(p.views) }} <em>vistas</em></span>
          </li>
        </ul>
      </section>
    </div>
  </template>
</div>
</template>

<style scoped>
.dsh { display: flex; flex-direction: column; gap: 1rem; }
.dsh__center { display: grid; place-items: center; padding: 3rem 0; }
.dsh__error { color: var(--danger); font-size: 0.82rem; }

/* Filtros */
.dsh__bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
.dsh__ranges { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.rchip { padding: 0.35rem 0.8rem; font-size: 0.74rem; cursor: pointer; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-2); border-radius: 999px; }
.rchip--on { background: var(--accent); border-color: var(--accent); color: var(--ink); font-weight: 600; }
.dsh__baractions { display: flex; gap: 0.5rem; }
.dsh__refresh { padding: 0.5rem 0.9rem; font-size: 0.72rem; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); cursor: pointer; border-radius: 6px; }
.dsh__refresh:disabled { opacity: 0.5; cursor: not-allowed; }
.dsh__refresh:hover:not(:disabled) { color: var(--text-1); border-color: var(--accent); }
.dsh__custom { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; font-size: 0.76rem; color: var(--text-2); }
.dsh__custom input { margin-left: 0.4rem; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); padding: 0.35rem 0.5rem; border-radius: 6px; font-family: inherit; }
.dsh__hint { color: var(--text-3); font-size: 0.72rem; }
.dsh__period { font-size: 0.74rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-3); }

/* KPIs */
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.75rem; }
.kpi { background: var(--card-bg); border: 1px solid var(--border-mid); border-radius: 10px; padding: 1rem; display: flex; flex-direction: column; gap: 0.25rem; }
.kpi--hero { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.kpi__label { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); font-weight: 600; }
.kpi__value { font-family: var(--font-display); font-size: 1.5rem; font-weight: 800; color: var(--text-1); line-height: 1.1; }
.kpi--hero .kpi__value { color: var(--accent-deep, var(--accent)); }
.kpi__sub { font-size: 0.72rem; color: var(--text-3); }

/* Tarjetas */
.card { background: var(--card-bg); border: 1px solid var(--border-mid); border-radius: 10px; padding: 1.1rem 1.2rem; }
.card__head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
.card__title { font-size: 0.82rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-1); margin-bottom: 0.9rem; }
.card__head .card__title { margin-bottom: 0.9rem; }
.card__sub { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); font-weight: 600; margin: 1rem 0 0.6rem; }
.card__note { font-size: 0.66rem; color: var(--text-3); font-style: italic; }
.card__empty { color: var(--text-3); font-size: 0.82rem; padding: 0.5rem 0; }
.card__empty code { background: var(--surface-2); padding: 0.05rem 0.35rem; border-radius: 4px; font-size: 0.78rem; }
.grid2 { display: grid; grid-template-columns: 1fr; gap: 1rem; }

/* Barras verticales (ingresos en el tiempo) */
.tbars { display: flex; align-items: flex-end; gap: 2px; height: 180px; border-bottom: 1px solid var(--border-mid); }
.tbar { flex: 1; height: 100%; display: flex; align-items: flex-end; position: relative; min-width: 0; }
.tbar__fill { width: 100%; background: var(--accent); border-radius: 4px 4px 0 0; min-height: 0; transition: height 0.3s var(--ease-out, ease); }
.tbar:hover .tbar__fill { filter: brightness(1.12); }
.tbar__tip {
  position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
  background: var(--surface-1); border: 1px solid var(--border-mid); color: var(--text-1);
  font-size: 0.7rem; white-space: nowrap; padding: 0.3rem 0.5rem; border-radius: 6px;
  opacity: 0; pointer-events: none; transition: opacity 0.15s ease; z-index: 5; margin-bottom: 4px;
  box-shadow: var(--shadow-card, 0 4px 12px rgba(0,0,0,0.15));
}
.tbar:hover .tbar__tip { opacity: 1; }
.tbars__axis { display: flex; gap: 2px; margin-top: 0.35rem; }
.tbars__lbl { flex: 1; min-width: 0; font-size: 0.62rem; color: var(--text-3); text-align: center; white-space: nowrap; overflow: hidden; }

/* Barras horizontales (estado / método) */
.hbars { list-style: none; display: flex; flex-direction: column; gap: 0.55rem; }
.hbar { display: grid; grid-template-columns: 7.5rem 1fr auto; align-items: center; gap: 0.7rem; }
.hbar__name { font-size: 0.76rem; color: var(--text-2); display: inline-flex; align-items: center; gap: 0.4rem; }
.hbar__key { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; }
.hbar__track { height: 10px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
.hbar__fill { display: block; height: 100%; border-radius: 999px; min-width: 2px; transition: width 0.35s var(--ease-out, ease); }
.hbar__val { font-size: 0.78rem; font-weight: 700; color: var(--text-1); white-space: nowrap; }
.hbar__val em { font-style: normal; font-weight: 400; color: var(--text-3); font-size: 0.7rem; margin-left: 0.3rem; }

/* Estado de cobro (tiles) */
.paytiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 0.6rem; }
.paytile { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 0.7rem; display: flex; flex-direction: column; gap: 0.25rem; }
.paytile__dot { width: 10px; height: 10px; border-radius: 50%; }
.paytile__label { font-size: 0.72rem; color: var(--text-2); }
.paytile__val { font-family: var(--font-display); font-size: 1.25rem; font-weight: 800; color: var(--text-1); }

/* Inventario */
.minitiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 0.6rem; margin-bottom: 1rem; }
.minitile { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 0.7rem; text-align: center; }
.minitile--warn { border-color: #C9962F; }
.minitile--danger { border-color: var(--danger); }
.minitile__v { display: block; font-family: var(--font-display); font-size: 1.4rem; font-weight: 800; color: var(--text-1); }
.minitile__l { font-size: 0.68rem; color: var(--text-3); }
.stocklist { list-style: none; display: flex; flex-direction: column; gap: 0.35rem; }
.stockrow { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.45rem 0.6rem; background: var(--surface-2); border-radius: 6px; }
.stockrow__name { font-size: 0.8rem; color: var(--text-2); display: inline-flex; align-items: center; gap: 0.5rem; }
.stockrow__off { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); border: 1px solid var(--border-mid); border-radius: 4px; padding: 0.05rem 0.3rem; }
.stockrow__badge { font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 999px; white-space: nowrap; }
.stockrow__badge.is-low { color: #C9962F; border: 1px solid #C9962F; }
.stockrow__badge.is-out { color: var(--danger); border: 1px solid var(--danger); }

/* Ranking */
.rank { list-style: none; display: flex; flex-direction: column; gap: 0.6rem; }
.rankrow { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 0.7rem; }
.rankrow__pos { font-family: var(--font-display); font-size: 0.82rem; font-weight: 800; color: var(--text-3); width: 1.2rem; text-align: center; }
.rankrow__body { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
.rankrow__name { font-size: 0.78rem; color: var(--text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rankrow__track { height: 8px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
.rankrow__fill { display: block; height: 100%; border-radius: 999px; min-width: 2px; transition: width 0.35s var(--ease-out, ease); }
.rankrow__val { font-size: 0.78rem; font-weight: 700; color: var(--text-1); white-space: nowrap; text-align: right; }
.rankrow__val em { display: block; font-style: normal; font-weight: 400; color: var(--text-3); font-size: 0.68rem; }

.spinner { width: 22px; height: 22px; border: 2px solid var(--text-3); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (min-width: 820px) {
  .grid2 { grid-template-columns: 1fr 1fr; }
}
</style>
