import { createRouter, createWebHistory } from 'vue-router'
import { watch } from 'vue'
import { useAuth } from '../lib/useAuth.js'
import HomePage           from '../pages/HomePage.vue'
import ColeccionPage      from '../pages/ColeccionPage.vue'
import LanzamientosPage   from '../pages/LanzamientosPage.vue'
import NosotrosPage       from '../pages/NosotrosPage.vue'
import NotFoundPage       from '../pages/NotFoundPage.vue'
import ProductDetailPage  from '../pages/ProductDetailPage.vue'
import CheckoutPage       from '../pages/CheckoutPage.vue'

const routes = [
  { path: '/',                component: HomePage,          meta: { title: 'Hebennus — Make it Real' } },
  { path: '/coleccion',       component: ColeccionPage,     meta: { title: 'Colección — Hebennus' } },
  { path: '/producto/:id',    component: ProductDetailPage, meta: { title: 'Producto — Hebennus' } },
  { path: '/lanzamientos',    component: LanzamientosPage,  meta: { title: 'Próximos Lanzamientos — Hebennus' } },
  { path: '/nosotros',        component: NosotrosPage,      meta: { title: 'Nosotros — Hebennus' } },
  { path: '/checkout',        component: CheckoutPage,      meta: { title: 'Finalizar pedido — Hebennus' } },
  { path: '/cuenta',          component: () => import('../pages/AccountPage.vue'),  meta: { title: 'Mi cuenta — Hebennus' } },
  { path: '/mis-pedidos',     component: () => import('../pages/MyOrdersPage.vue'), meta: { title: 'Mis pedidos — Hebennus' } },
  { path: '/admin',           component: () => import('../pages/AdminPage.vue'), meta: { title: 'Panel — Hebennus', requiresAdmin: true } },
  { path: '/privacidad',      component: () => import('../pages/PrivacidadPage.vue'), meta: { title: 'Política de privacidad — Hebennus' } },
  // SOLO DEV: laboratorio para probar métodos/escenarios de pago de Izipay. En el
  // build de producción esta ruta no se incluye (import.meta.env.DEV es false).
  ...(import.meta.env.DEV
    ? [{ path: '/lab-pagos', component: () => import('../pages/PagosLabPage.vue'), meta: { title: 'Lab de pagos — Hebennus' } }]
    : []),
  { path: '/:pathMatch(.*)*', component: NotFoundPage,      meta: { title: 'Página no encontrada — Hebennus' } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0, behavior: 'smooth' }),
})

router.beforeEach(async (to) => {
  document.title = to.meta?.title ?? 'Hebennus'

  // Guard de /admin: si hay sesión pero NO es admin, lo mandamos al inicio (antes de
  // montar el panel). Sin sesión SÍ se permite, para que un admin pueda ver el login;
  // la propia vista valida is_admin y RLS protege los datos.
  if (to.meta?.requiresAdmin) {
    const auth = useAuth()
    if (!auth.ready.value) {
      await new Promise((resolve) => {
        const stop = watch(auth.ready, (v) => { if (v) { stop(); resolve() } })
      })
    }
    if (auth.user.value && !auth.isAdmin.value) return { path: '/' }
  }
})

export default router
