<script setup>
import { ref, computed, watch, onMounted, onUnmounted, provide } from 'vue'
import { RouterView, useRouter, useRoute } from 'vue-router'
import AppNav        from './components/AppNav.vue'
import AppFooter     from './components/AppFooter.vue'
import CartDrawer    from './components/CartDrawer.vue'
import ToastNotif    from './components/ToastNotif.vue'
import QuickBuyModal from './components/QuickBuyModal.vue'

const CART_KEY  = 'hebennus-cart'
const MAX_QTY   = 10    // máx. unidades por referencia (talla + producto)
const MAX_ITEMS = 30    // máx. líneas distintas en el carrito
const MAX_PRICE = 9_999 // precio máx. aceptado (S/)

// Verifica que un ítem cargado desde localStorage sea legítimo.
// Descarta cualquier campo manipulado manualmente en DevTools.
function isValidItem(item) {
  return (
    item !== null &&
    typeof item === 'object' &&
    typeof item.productId !== 'undefined' &&
    typeof item.name  === 'string' && item.name.trim().length > 0  && item.name.length  <= 200 &&
    typeof item.size  === 'string' && item.size.trim().length > 0  && item.size.length  <= 20  &&
    (item.color == null || (typeof item.color === 'string' && item.color.length <= 40))         &&
    typeof item.price === 'number' && item.price > 0               && item.price <= MAX_PRICE  &&
    Number.isInteger(item.qty)     && item.qty >= 1                && item.qty  <= MAX_QTY
  )
}

// Devuelve solo ítems válidos con campos normalizados.
function sanitizeCart(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isValidItem)
    .slice(0, MAX_ITEMS)
    .map(item => ({
      ...item,
      price: Number(item.price),
      qty:   Math.min(Math.max(1, Math.trunc(item.qty)), MAX_QTY),
      name:  String(item.name).trim().slice(0, 200),
      size:  String(item.size).trim().slice(0, 20),
      ...(item.color != null ? { color: String(item.color).trim().slice(0, 40) } : {}),
    }))
}

function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]')
    return sanitizeCart(raw)
  } catch {
    return []
  }
}

const carrito     = ref(loadCart())
const carritoOpen = ref(false)
const scrolled    = ref(false)

// Toast
const toast      = ref(null)
let toastTimer   = null

// Quick Buy
const quickBuyProduct = ref(null)

watch(carrito, val => localStorage.setItem(CART_KEY, JSON.stringify(val)), { deep: true })

const carritoCount = computed(() => carrito.value.reduce((s, i) => s + (i.qty ?? 1), 0))

function onScroll() { scrolled.value = window.scrollY > 50 }

function addToCart(item) {
  // Rechaza ítems con precio inválido, nombre vacío o cualquier campo fuera de rango
  if (
    !item ||
    typeof item.price !== 'number' || item.price <= 0 || item.price > MAX_PRICE ||
    typeof item.name !== 'string'  || !item.name.trim() ||
    typeof item.size !== 'string'  || !item.size.trim()
  ) return

  const idx = carrito.value.findIndex(
    i => i.productId === item.productId && i.size === item.size && (i.color ?? null) === (item.color ?? null)
  )
  if (idx >= 0) {
    // No superar el máximo por referencia
    if (carrito.value[idx].qty < MAX_QTY) {
      carrito.value[idx].qty = carrito.value[idx].qty + 1
    }
  } else {
    if (carrito.value.length >= MAX_ITEMS) return // límite de líneas
    carrito.value.push({ ...item, qty: 1 })
  }

  clearTimeout(toastTimer)
  toast.value = { name: item.name, size: item.size, color: item.color, image: item.image }
  toastTimer  = setTimeout(() => { toast.value = null }, 3200)
}

function removeFromCart(idx) { carrito.value.splice(idx, 1) }
function clearCart()         { carrito.value = [] }

function updateQty(idx, delta) {
  const current = carrito.value[idx]?.qty ?? 1
  const qty = current + delta
  if (qty <= 0)        carrito.value.splice(idx, 1)
  else if (qty > MAX_QTY) carrito.value[idx].qty = MAX_QTY // tope silencioso
  else                    carrito.value[idx].qty = qty
}

function openQuickBuy(product) { quickBuyProduct.value = product }

const router = useRouter()
const route  = useRoute()
// El panel /admin no muestra la navegación, carrito ni footer de la tienda.
const mostrarTienda = computed(() => !route.path.startsWith('/admin'))
function goCheckout() {
  carritoOpen.value = false
  router.push('/checkout')
}

provide('addToCart',    addToCart)
provide('openQuickBuy', openQuickBuy)
provide('cart',         carrito)
provide('clearCart',    clearCart)

// Sincroniza el carrito entre pestañas: si cambia en otra pestaña, recargamos.
// El evento 'storage' solo se dispara en LAS OTRAS pestañas, no en la que escribió.
function onStorage(e) {
  if (e.key === CART_KEY) carrito.value = loadCart()
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('storage', onStorage)
})
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('storage', onStorage)
  clearTimeout(toastTimer)
})
</script>

<template>
  <div v-if="mostrarTienda" class="announce">
    Envío gratis desde S/ 119 &nbsp;·&nbsp; Envíos sáb y dom &nbsp;·&nbsp; Edición limitada
  </div>

  <AppNav
    v-if="mostrarTienda"
    :scrolled="scrolled"
    :carrito-count="carritoCount"
    @open-cart="carritoOpen = true"
  />

  <RouterView v-slot="{ Component }">
    <Transition name="page" mode="out-in">
      <component :is="Component" :key="$route.path" />
    </Transition>
  </RouterView>

  <AppFooter v-if="mostrarTienda" />

  <CartDrawer
    v-if="mostrarTienda"
    :items="carrito"
    :open="carritoOpen"
    @close="carritoOpen = false"
    @remove="removeFromCart"
    @update-qty="updateQty"
    @clear-all="clearCart"
    @go-checkout="goCheckout"
  />

  <ToastNotif
    v-if="mostrarTienda"
    :toast="toast"
    @close="toast = null"
  />

  <QuickBuyModal
    v-if="mostrarTienda"
    :product="quickBuyProduct"
    @close="quickBuyProduct = null"
  />
</template>

<style scoped>
.announce {
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  padding: 0.6rem 1rem;
  text-align: center;
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-2);
}

.page-enter-active { transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.22, 1, 0.36, 1); }
.page-leave-active { transition: opacity 0.15s ease; }
.page-enter-from   { opacity: 0; transform: translateY(10px); }
.page-leave-to     { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .page-enter-active, .page-leave-active { transition: none; }
  .page-enter-from { transform: none; }
}
</style>
