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

// Borra cualquier token de sesión de Supabase del navegador. Es la RED DE SEGURIDAD
// del logout: aunque supabase.auth.signOut() no limpie el storage, garantizamos que
// no quede sesión (el bug era que el token persistía y al recargar volvías a entrar).
export function purgeSupabaseTokens() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('sb-') && k.includes('auth-token')) localStorage.removeItem(k)
    }
  } catch (_) { /* noop */ }
}

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
  supabase.auth.getSession().then(({ data }) => {
    user.value = data.session?.user ?? null
    ready.value = true
    checkAdmin()
  })
  // ⚠️ NO usar async/await DENTRO de este callback. Llamar métodos de auth —o rpc(),
  // que internamente pide getSession()— aquí y esperarlos causa un DEADLOCK del lock
  // interno de supabase-js: updateUser()/verifyOtp() se quedan colgados ("Guardando…"
  // infinito). Por eso el callback es síncrono y checkAdmin() se difiere con setTimeout,
  // ya FUERA del lock. Ref: supabase/gotrue-js — "don't await inside onAuthStateChange".
  supabase.auth.onAuthStateChange((_event, session) => {
    user.value = session?.user ?? null
    ready.value = true
    setTimeout(() => { checkAdmin() }, 0)
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

  // ¿El correo ya está registrado? (server-side, vía edge function check-email).
  // Se usa antes de mandar el código de recuperación para no decir "te enviamos un
  // código" si el correo no existe.
  async function emailExiste(email) {
    const { data, error } = await supabase.functions.invoke('check-email', {
      body: { email: email.trim() },
    })
    if (error) throw error
    return data?.exists === true
  }

  // ── Recuperar contraseña ("olvidé mi contraseña") ──
  // Envía un correo con un código de 6 dígitos (plantilla "Recovery" con {{ .Token }}).
  async function sendPasswordReset(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim())
    if (error) throw error
  }

  // Verifica el código de recuperación → deja una sesión temporal para cambiar la clave.
  async function verifyRecoveryCode(email, code) {
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'recovery',
    })
    if (error) throw error
  }

  // Cambia la contraseña del usuario con sesión activa (reset o cambio logueado).
  async function updatePassword(password) {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
  }

  async function signOut() {
    // 1) Logout inmediato en la UI (no depende de la red).
    user.value = null
    isAdmin.value = false
    // 2) Revoca el refresh_token en el SERVIDOR (global) con timeout corto, para que
    //    el token no siga siendo válido aunque alguien lo hubiera copiado antes.
    try {
      await Promise.race([
        supabase.auth.signOut({ scope: 'global' }),
        new Promise((r) => setTimeout(r, 2500)),
      ])
    } catch (_) { /* noop */ }
    // 3) Limpia la sesión local.
    try { await supabase.auth.signOut({ scope: 'local' }) } catch (_) { /* noop */ }
    // 4) Red de seguridad: borra explícitamente el token guardado (el bug era que
    //    signOut no lo eliminaba y al recargar volvía la sesión).
    purgeSupabaseTokens()
  }

  return { user, isAdmin, ready, signUp, signIn, signOut, signInWithGoogle, resendConfirmation, verifyEmailCode, emailExiste, sendPasswordReset, verifyRecoveryCode, updatePassword }
}
