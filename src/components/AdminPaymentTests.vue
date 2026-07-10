<script setup>
// ─── Panel admin · Vista TESTS DE PAGO ──────────────────────────────────────
// Registro de pruebas de pago (tabla `payment_tests`). Solo existe en desarrollo
// — se usa para auditar manualmente los escenarios de Izipay (Visa/Mastercard/Yape,
// aceptado/rechazado/3DS) y comparar lo esperado contra lo que devolvió la pasarela.
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase.js'

const tests    = ref([])
const cargando = ref(true)
const error    = ref('')
const limpiando = ref(false)   // evita doble click al borrar todo

// ── Carga ──
async function cargar() {
  cargando.value = true
  error.value = ''
  try {
    const { data, error: e } = await supabase
      .from('payment_tests')
      .select('*')
      .order('created_at', { ascending: false })
    if (e) throw e
    tests.value = data || []
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    cargando.value = false
  }
}

// ── Limpiar todos los registros (con confirmación) ──
async function limpiar() {
  if (limpiando.value) return
  if (!confirm('¿Borrar TODOS los registros de pruebas de pago? Esta acción no se puede deshacer.')) return
  limpiando.value = true
  error.value = ''
  try {
    const { error: e } = await supabase.from('payment_tests').delete().neq('id', 0)
    if (e) throw e
    await cargar()
  } catch (e) {
    error.value = 'No se pudo limpiar: ' + (e.message || String(e))
  } finally {
    limpiando.value = false
  }
}

// ── ¿Coincide lo esperado con lo real? ──
// Escenario "Aceptado" o "3DS" → se espera order_status === 'PAID'.
// Escenario "Rechazado"        → se espera order_status !== 'PAID'.
// Devuelve true/false, o null si el escenario no encaja en ninguna regla.
function coincide(t) {
  const esc = (t.escenario || '').toLowerCase()
  const pagado = (t.order_status || '') === 'PAID'
  if (esc.includes('aceptado') || esc.includes('3ds')) return pagado
  if (esc.includes('rechazado')) return !pagado
  return null
}

function fmtFecha(s) {
  try { return new Date(s).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }) }
  catch { return s }
}
function money(n) { return 'S/ ' + Number(n ?? 0).toFixed(2) }

const totalTests = computed(() => tests.value.length)

onMounted(cargar)
</script>

<template>
<div class="ptests">
  <div class="ptests__bar">
    <p class="ptests__meta">{{ totalTests }} pruebas registradas</p>
    <div class="ptests__actions">
      <button class="ptests__refresh" :disabled="cargando" @click="cargar">↻ Refrescar</button>
      <button class="ptests__clear" :disabled="cargando || limpiando || !totalTests" @click="limpiar">
        <span v-if="limpiando" class="spinner spinner--sm"></span>
        {{ limpiando ? 'Limpiando…' : '🗑 Limpiar registros' }}
      </button>
    </div>
  </div>

  <p v-if="error" class="ptests__error" role="alert">{{ error }}</p>

  <div v-if="cargando" class="ptests__center"><span class="spinner"></span></div>

  <p v-else-if="!tests.length" class="ptests__empty">Aún no hay pruebas registradas.</p>

  <div v-else class="ptests__scroll">
    <table class="ttab">
      <thead>
        <tr>
          <th>Fecha/hora</th>
          <th>Método</th>
          <th>Tarjeta</th>
          <th>Escenario esperado</th>
          <th>Estado real</th>
          <th>Resultado</th>
          <th>¿Coincide?</th>
          <th>Detalle</th>
          <th>Monto</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in tests" :key="t.id">
          <td class="ttab__date">{{ fmtFecha(t.created_at) }}</td>
          <td>{{ t.metodo || '—' }}</td>
          <td class="ttab__card">{{ t.tarjeta || '—' }}</td>
          <td>{{ t.escenario || '—' }}</td>
          <td>{{ t.order_status || '—' }}</td>
          <td>
            <span
              v-if="t.resultado === 'exito'"
              class="badge badge--ok"
            >Éxito</span>
            <span
              v-else-if="t.resultado === 'fallo'"
              class="badge badge--fail"
            >Fallo</span>
            <span v-else>—</span>
          </td>
          <td class="ttab__match">
            <!-- ✅ si lo esperado == lo real; ⚠️ si no; — si no aplica -->
            <span v-if="coincide(t) === true" title="Coincide con lo esperado">✅</span>
            <span v-else-if="coincide(t) === false" title="No coincide con lo esperado">⚠️</span>
            <span v-else>—</span>
          </td>
          <td class="ttab__detail">{{ t.detalle || '—' }}</td>
          <td class="ttab__amount">{{ money(t.monto) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
</template>

<style scoped>
.ptests__bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
.ptests__meta { font-size: 0.8rem; color: var(--text-3); }
.ptests__actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.ptests__refresh { padding: 0.5rem 0.9rem; font-size: 0.72rem; background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-2); cursor: pointer; }
.ptests__refresh:hover:not(:disabled) { color: var(--text-1); }
.ptests__clear { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0.9rem; font-size: 0.72rem; font-weight: 600; background: transparent; border: 1px solid var(--danger); color: var(--danger); cursor: pointer; }
.ptests__clear:hover:not(:disabled) { background: var(--danger); color: #fff; }
.ptests__clear:disabled { opacity: 0.5; cursor: not-allowed; }
.ptests__error { color: var(--danger); font-size: 0.82rem; margin: 0.5rem 0; }
.ptests__center { display: grid; place-items: center; padding: 3rem 0; }
.ptests__empty { color: var(--text-3); padding: 3rem 0; text-align: center; }
.ptests__scroll { overflow-x: auto; border: 1px solid var(--border-mid); background: var(--card-bg); animation: hb-fade-up 0.3s ease both; }

/* ── Tabla de pruebas ── */
.ttab { width: 100%; border-collapse: collapse; font-size: 0.8rem; white-space: nowrap; }
.ttab th { text-align: left; font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); font-weight: 600; padding: 0.55rem 0.7rem; border-bottom: 1px solid var(--border); }
.ttab td { padding: 0.55rem 0.7rem; border-bottom: 1px solid var(--border); color: var(--text-2); vertical-align: middle; }
.ttab tbody tr:last-child td { border-bottom: none; }
.ttab tbody tr:hover { background: var(--surface-2); }
.ttab__date { color: var(--text-3); font-size: 0.74rem; }
.ttab__card { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.76rem; color: var(--text-1); }
.ttab__detail { white-space: normal; min-width: 180px; max-width: 320px; color: var(--text-3); font-size: 0.76rem; }
.ttab__amount { font-weight: 700; color: var(--text-1); }
.ttab__match { text-align: center; font-size: 0.95rem; }

.badge { font-size: 0.66rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.2rem 0.55rem; border-radius: 999px; border: 1px solid currentColor; }
.badge--ok { color: var(--success); }
.badge--fail { color: var(--danger); }

/* ── Spinner ── */
.spinner { width: 22px; height: 22px; border: 2px solid var(--text-3); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
.spinner--sm { width: 13px; height: 13px; border-width: 2px; border-color: currentColor; border-top-color: transparent; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
