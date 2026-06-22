import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    // No exponer las rutas del filesystem ni el código fuente original en producción.
    sourcemap: false,
  },
})
