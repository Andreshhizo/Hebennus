import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import router from './router/index.js'

const app = createApp(App)

// Directiva global v-reveal: revela el elemento con un fade-up al entrar en viewport.
app.directive('reveal', {
  mounted(el) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    el.classList.add('reveal-init')
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { el.classList.add('reveal-in'); io.unobserve(el) }
      })
    }, { threshold: 0.12 })
    io.observe(el)
  },
})

app.use(router).mount('#app')
