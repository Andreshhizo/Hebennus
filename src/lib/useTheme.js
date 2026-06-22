import { ref, watchEffect } from 'vue'

const THEME_KEY = 'hebennus-theme'
// Claro por defecto: solo arranca oscuro si el usuario lo guardó explícitamente.
const isDark = ref(localStorage.getItem(THEME_KEY) === 'dark')

watchEffect(() => {
  document.documentElement.classList.toggle('light', !isDark.value)
  localStorage.setItem(THEME_KEY, isDark.value ? 'dark' : 'light')
})

export function useTheme() {
  return {
    isDark,
    toggle: () => { isDark.value = !isDark.value },
  }
}
