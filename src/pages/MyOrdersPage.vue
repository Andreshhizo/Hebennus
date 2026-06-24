<script setup>
// ─── /mis-pedidos — Pedidos del cliente (solo lectura) ──────────────────────
// RLS garantiza que cada quien ve SOLO sus pedidos (por user_id o su correo).
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/useAuth.js'

const router = useRouter()
const { user, ready } = useAuth()

const pedidos = ref([])
const cargando = ref(true)
const error = ref('')
const expandido = ref(null)

const EN_CURSO   = ['pendiente', 'confirmado', 'enviado']
const ESTADO_LABEL = {
  pendiente: 'Pendiente', confirmado: 'Confirmado', enviado: 'Enviado',
  entregado: 'Entregado', cancelado: 'Cancelado',
}
const ESTADO_COLOR = {
  pendiente: '#e0a23b', confirmado: '#5b8def', enviado: '#7c5cff',
  entregado: '#2ecc8f', cancelado: '#e0566b',
}

const enCurso    = computed(() => pedidos.value.filter(o => EN_CURSO.includes(o.status)))
const entregados = computed(() => pedidos.value.filter(o => o.status === 'entregado'))
const pasados    = computed(() => pedidos.value.filter(o => o.status === 'cancelado'))

async function cargar() {
  cargando.value = true; error.value = ''
  try {
    const { data, error: e } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .order('created_at', { ascending: false })
    if (e) throw e
    pedidos.value = data || []
  } catch (err) {
    error.value = err.message
  } finally {
    cargando.value = false
  }
}

// Si no hay sesión una vez resuelta, mandar a /cuenta.
watch(ready, (r) => { if (r && !user.value) router.replace('/cuenta') }, { immediate: true })
watch(user, (u) => { if (ready.value && !u) router.replace('/cuenta'); else if (u) cargar() })

function fmtFecha(s) {
  try { return new Date(s).toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' }) }
  catch { return s }
}
function money(n) { return 'S/ ' + Number(n ?? 0).toFixed(2) }
function toggle(id) { expandido.value = expandido.value === id ? null : id }

onMounted(() => { if (user.value) cargar() })
</script>

<template>
<div class="mis">
  <section class="page-hero">
    <div class="page-hero__inner">
      <span class="chip">Mi cuenta</span>
      <h1 class="page-hero__title">Mis pedidos</h1>
      <p class="page-hero__sub" v-if="user">{{ user.email }}</p>
    </div>
  </section>

  <div class="mis__body">
    <div v-if="cargando" class="mis__center"><span class="spinner"></span></div>

    <p v-else-if="error" class="mis__error">{{ error }}</p>

    <div v-else-if="!pedidos.length" class="mis__empty">
      <p>Aún no tienes pedidos.</p>
      <RouterLink to="/coleccion" class="mis__cta">Ver la colección</RouterLink>
    </div>

    <template v-else>
      <section v-for="grupo in [
        { titulo: 'En curso', items: enCurso },
        { titulo: 'Entregados', items: entregados },
        { titulo: 'Cancelados', items: pasados },
      ]" :key="grupo.titulo" v-show="grupo.items.length" class="grupo">
        <h2 class="grupo__titulo">{{ grupo.titulo }} <span class="grupo__count">{{ grupo.items.length }}</span></h2>
        <ul class="orders">
          <li v-for="o in grupo.items" :key="o.id" class="order">
            <div class="order__head" @click="toggle(o.id)">
              <div class="order__main">
                <span class="order__num">{{ o.order_number || ('#' + o.id) }}</span>
                <span class="order__date">{{ fmtFecha(o.created_at) }}</span>
              </div>
              <div class="order__right">
                <span class="order__total">{{ money(o.total) }}</span>
                <span class="badge" :style="{ '--c': ESTADO_COLOR[o.status] || '#888' }">{{ ESTADO_LABEL[o.status] || o.status }}</span>
                <span class="order__caret">{{ expandido === o.id ? '▲' : '▼' }}</span>
              </div>
            </div>
            <div v-if="expandido === o.id" class="order__body">
              <ul class="items">
                <li v-for="it in o.order_items" :key="it.id" class="item">
                  <span>{{ it.name }} · {{ it.size }}<template v-if="it.color"> / {{ it.color }}</template> × {{ it.qty }}</span>
                  <span>{{ money(it.subtotal) }}</span>
                </li>
              </ul>
              <div class="totales">
                <span>Subtotal</span><span>{{ money(o.subtotal) }}</span>
                <template v-if="o.discount > 0"><span>Descuento</span><span>-{{ money(o.discount) }}</span></template>
                <span>Envío</span><span>{{ o.shipping > 0 ? money(o.shipping) : 'Gratis' }}</span>
                <span class="totales__big">Total</span><span class="totales__big">{{ money(o.total) }}</span>
              </div>
              <p class="order__envio">Envío a: {{ o.notes }}</p>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</div>
</template>

<style scoped>
.mis { min-height: 70vh; }
.page-hero { border-bottom: 1px solid var(--border); padding: 3rem 1.25rem 2.5rem; background: var(--surface-1); }
.page-hero__inner { max-width: 900px; margin: 0 auto; }
.chip { display: inline-block; font-size: 0.68rem; letter-spacing: 0.32em; text-transform: uppercase; color: var(--accent-3); }
.page-hero__title { font-family: var(--font-display); font-size: clamp(2rem, 5vw, 3rem); font-weight: 800; letter-spacing: -0.02em; text-transform: uppercase; color: var(--text-1); margin-top: 0.6rem; }
.page-hero__sub { margin-top: 0.6rem; font-size: 0.8rem; color: var(--text-3); }

.mis__body { max-width: 900px; margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }
.mis__center { display: grid; place-items: center; padding: 4rem 0; }
.mis__error { color: #e0566b; }
.mis__empty { text-align: center; padding: 3rem 0; color: var(--text-3); display: flex; flex-direction: column; gap: 1rem; align-items: center; }
.mis__cta { padding: 0.8rem 1.8rem; background: var(--accent); color: var(--ink); font-family: var(--font-display); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }

.grupo { margin-bottom: 2.5rem; }
.grupo__titulo { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-2); margin-bottom: 0.9rem; display: flex; align-items: center; gap: 0.5rem; }
.grupo__count { background: var(--surface-3); color: var(--text-3); font-size: 0.68rem; padding: 0.1rem 0.5rem; border-radius: 999px; }

.orders { list-style: none; display: flex; flex-direction: column; gap: 0.6rem; }
.order { border: 1px solid var(--border-mid); background: var(--card-bg); animation: hb-fade-up 0.3s ease both; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
.order:hover { box-shadow: 0 4px 18px rgba(0,0,0,0.08); }
.order__head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.9rem 1rem; cursor: pointer; }
.order__main { display: flex; flex-direction: column; gap: 0.15rem; }
.order__num { font-family: var(--font-display); font-weight: 700; font-size: 0.9rem; }
.order__date { font-size: 0.74rem; color: var(--text-3); }
.order__right { display: flex; align-items: center; gap: 0.8rem; white-space: nowrap; }
.order__total { font-weight: 700; }
.badge { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.2rem 0.55rem; border-radius: 999px; color: var(--c); border: 1px solid var(--c); }
.order__caret { font-size: 0.6rem; color: var(--text-3); }
.order__body { border-top: 1px solid var(--border); padding: 1rem; }
.items { list-style: none; display: flex; flex-direction: column; gap: 0.4rem; }
.item { display: flex; justify-content: space-between; gap: 1rem; font-size: 0.82rem; color: var(--text-2); }
.totales { display: grid; grid-template-columns: 1fr auto; gap: 0.25rem 1rem; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border); font-size: 0.82rem; color: var(--text-2); }
.totales__big { font-weight: 700; color: var(--text-1); }
.order__envio { font-size: 0.78rem; color: var(--text-3); margin-top: 0.75rem; }
.spinner { width: 22px; height: 22px; border: 2px solid var(--text-3); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
