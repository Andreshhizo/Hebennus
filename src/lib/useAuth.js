// ─── AUTENTICACIÓN DE CLIENTES ──────────────────────────────────────────────
// Estado de sesión global (singleton) basado en Supabase Auth.
//   • user    → usuario logueado (o null)
//   • isAdmin → true solo si está en la tabla `admins` (vía RPC is_admin)
//   • ready   → ya se resolvió la sesión inicial (evita parpadeos)
// La protección REAL de datos es RLS en la BD; esto es para la UI.
import { ref } from 'vue'
import { supabase } from './supabase.js'

const user    = ref(null)
const isAdmin = ref(false)
const ready   = ref(false)
let initialized = false

async function checkAdmin() {
  if (!user.value) { isAdmin.value = false; return }
  try {
    const { data } = await supabase.rpc('is_admin')
    isAdmin.value = data === true
  } catch { isAdmin.value = false }
}

function init() {
  if (initialized) return
  initialized = true
  supabase.auth.getSession().then(async ({ data }) => {
    user.value = data.session?.user ?? null
    await checkAdmin()
    ready.value = true
  })
  supabase.auth.onAuthStateChange(async (_event, session) => {
    user.value = session?.user ?? null
    await checkAdmin()
    ready.value = true
  })
}

export function useAuth() {
  init()

  async function signUp({ email, password, full_name, phone }) {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: (full_name ?? '').trim(), phone: (phone ?? '').trim() } },
    })
    if (error) throw error
    return data // { user, session } — session es null si requiere confirmar correo
  }

  async function signIn({ email, password }) {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw error
  }

  // Registro/inicio con Google (1 clic). Redirige a Google y vuelve a /mis-pedidos.
  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/mis-pedidos' },
    })
    if (error) throw error
  }

  // Reenviar el correo de confirmación de registro.
  async function resendConfirmation(email) {
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() })
    if (error) throw error
  }

  // Verificar el código de 6 dígitos enviado al correo (confirma la cuenta y loguea).
  async function verifyEmailCode(email, code) {
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'signup',
    })
    if (error) throw error
  }

  async function signOut() {
    // Limpia SIEMPRE el estado local, aunque la llamada al servidor falle
    // (sesión expirada, sin red…). Si no, "Salir" parecía no hacer nada y la
    // sesión seguía guardada en el navegador al relanzar.
    try {
      await supabase.auth.signOut()
    } catch (_) {
      try { await supabase.auth.signOut({ scope: 'local' }) } catch (_) { /* noop */ }
    }
    user.value = null
    isAdmin.value = false
  }

  return { user, isAdmin, ready, signUp, signIn, signOut, signInWithGoogle, resendConfirmation, verifyEmailCode }
}
