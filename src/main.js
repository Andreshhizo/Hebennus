import { createApp } from 'vue'
import { createHead } from '@unhead/vue'
import App from './App.vue'
import './style.css'
import router from './router/index.js'

const app = createApp(App)
app.use(createHead())   // gestión de <head> (SEO): title/description/OG/JSON-LD por página

// Directiva global v-reveal: revela el elemento con un fade-up al entrar en viewport.
// Modificador .stagger: revela los HIJOS uno a uno (efecto escalonado en grids).
app.directive('reveal', {
  mounted(el, binding) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const stagger = binding.modifiers.stagger
    const targets = stagger ? Array.from(el.children) : [el]
    targets.forEach((t, i) => {
      t.classList.add('reveal-init')
      if (stagger) t.style.transitionDelay = `${Math.min(i * 80, 480)}ms`
    })
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          targets.forEach((t) => t.classList.add('reveal-in'))
          io.unobserve(el)
        }
      })
    }, { threshold: 0.12 })
    io.observe(el)
  },
})

app.use(router).mount('#app')
