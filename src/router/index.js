import { createRouter, createWebHistory } from 'vue-router'
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
  { path: '/admin',           component: () => import('../pages/AdminPage.vue'), meta: { title: 'Panel — Hebennus' } },
  { path: '/:pathMatch(.*)*', component: NotFoundPage,      meta: { title: 'Página no encontrada — Hebennus' } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0, behavior: 'smooth' }),
})

router.beforeEach(to => {
  document.title = to.meta?.title ?? 'Hebennus'
})

export default router
