<script setup>
// ─── /cuenta — Registro + Inicio de sesión de clientes ──────────────────────
import { ref, reactive, computed, onUnmounted } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuth } from '../lib/useAuth.js'
import { validarPassword, validarTelefonoPE } from '../lib/validation.js'

const router = useRouter()
const { signUp, signIn, signInWithGoogle, resendConfirmation, verifyEmailCode,
        emailExiste, sendPasswordReset, verifyRecoveryCode, updatePassword } = useAuth()

const modo = ref('login')   // 'login' | 'registro'
const paso = ref('form')    // 'form' | 'verificar' | 'recuperar' | 'reset'
const enviando = ref(false)
const verificando = ref(false)
const codigo = ref('')
const newPassword = ref('')
const googleLoading = ref(false)
const reenviando = ref(false)
const error = ref('')
const aviso = ref('')   // p.ej. "revisa tu correo"

// Cooldown de reenvío: evita chocar con el rate-limit de Supabase (403 "too many requests").
const cooldown = ref(0)
let cooldownTimer = null
function startCooldown(sec = 45) {
  cooldown.value = sec
  clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    cooldown.value -= 1
    if (cooldown.value <= 0) clearInterval(cooldownTimer)
  }, 1000)
}
onUnmounted(() => clearInterval(cooldownTimer))

const form = reactive({
  full_name: '',
  phone: '',
  email: '',
  password: '',
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const errores = computed(() => {
  const e = {}
  if (!EMAIL_RE.test(form.email.trim())) e.email = 'Correo inválido.'
  if (modo.value === 'registro') {
    if (form.full_name.trim().length < 3) e.full_name = 'Ingresa tu nombre.'
    if (form.phone.trim() && !validarTelefonoPE(form.phone)) e.phone = 'Celular: 9 dígitos, empieza con 9.'
    if (!validarPassword(form.password)) e.password = 'Mínimo 8, con al menos una letra y un número.'
  } else {
    // Login: no exigimos fuerza (cuentas antiguas pueden tener claves más cortas).
    if (form.password.length < 1) e.password = 'Ingresa tu contraseña.'
  }
  return e
})
const valido = computed(() => Object.keys(errores.value).length === 0)

async function enviar() {
  error.value = ''; aviso.value = ''
  if (!valido.value || enviando.value) return
  enviando.value = true
  try {
    if (modo.value === 'registro') {
      const data = await signUp({
        email: form.email, password: form.password,
        full_name: form.full_name, phone: form.phone,
      })
      // Supabase NO devuelve error si el correo ya existe (anti-enumeración): en su
      // lugar manda `user.identities` VACÍO. Lo detectamos para no enviar otro código.
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        error.value = 'Ese correo ya tiene una cuenta. Inicia sesión o recupera tu contraseña.'
        modo.value = 'login'
        return
      }
      if (data?.session) { router.push('/mis-pedidos') }   // sin confirmación → entra directo
      else { paso.value = 'verificar'; startCooldown() }    // con confirmación → pedir el código
    } else {
      await signIn({ email: form.email, password: form.password })
      router.push('/mis-pedidos')
    }
  } catch (err) {
    const m = err?.message || ''
    error.value =
      m.includes('Invalid login credentials') ? 'Correo o contraseña incorrectos.' :
      m.includes('already registered')        ? 'Ese correo ya tiene una cuenta. Inicia sesión.' :
      m.includes('Email not confirmed')       ? 'Aún no confirmas tu correo. Revisa tu bandeja.' :
      m || 'Ocurrió un error. Inténtalo de nuevo.'
  } finally {
    enviando.value = false
  }
}

async function conGoogle() {
  error.value = ''
  googleLoading.value = true
  try {
    await signInWithGoogle() // redirige a Google
  } catch (err) {
    error.value = 'No se pudo conectar con Google. ' + (err?.message || '')
    googleLoading.value = false
  }
}

async function reenviar() {
  if (!form.email || reenviando.value || cooldown.value > 0) return
  error.value = ''
  reenviando.value = true
  try {
    if (paso.value === 'reset') await sendPasswordReset(form.email)
    else await resendConfirmation(form.email)
    startCooldown()
  } catch (err) {
    error.value = err?.message || 'No se pudo reenviar. Espera un momento.'
  } finally {
    reenviando.value = false
  }
}

// Verificar el código de 6 dígitos → confirma la cuenta y entra.
async function verificarCodigo() {
  error.value = ''
  const code = codigo.value.replace(/\D/g, '')
  if (code.length < 6 || verificando.value) return
  verificando.value = true
  try {
    await verifyEmailCode(form.email, code)
    router.push('/mis-pedidos')
  } catch (err) {
    const m = err?.message || ''
    error.value =
      m.includes('expired')                       ? 'El código expiró. Pide uno nuevo.' :
      (m.includes('invalid') || m.includes('Token')) ? 'Código incorrecto. Revísalo e inténtalo de nuevo.' :
      (m || 'No se pudo verificar. Inténtalo de nuevo.')
  } finally {
    verificando.value = false
  }
}

// ── Recuperar contraseña ("olvidé mi contraseña") ──
function irARecuperar() {
  paso.value = 'recuperar'
  error.value = ''; aviso.value = ''; codigo.value = ''; newPassword.value = ''
}

// Paso 1: verifica que el correo exista y pide el código.
async function pedirReset() {
  error.value = ''
  if (!EMAIL_RE.test(form.email.trim())) { error.value = 'Ingresa un correo válido.'; return }
  if (enviando.value || cooldown.value > 0) return
  enviando.value = true
  try {
    const existe = await emailExiste(form.email)
    if (!existe) {
      error.value = 'Ese correo no está registrado. Revisa que esté bien escrito o crea una cuenta.'
      return
    }
    await sendPasswordReset(form.email)
    paso.value = 'reset'; startCooldown()
  } catch (err) {
    error.value = err?.message || 'No se pudo enviar el código. Inténtalo de nuevo.'
  } finally {
    enviando.value = false
  }
}

// Paso 2: verifica el código y guarda la nueva contraseña.
async function confirmarReset() {
  error.value = ''
  const code = codigo.value.replace(/\D/g, '')
  if (code.length < 6) { error.value = 'Ingresa el código de 6 dígitos.'; return }
  if (!validarPassword(newPassword.value)) { error.value = 'La nueva contraseña: mínimo 8, con letra y número.'; return }
  if (verificando.value) return
  verificando.value = true
  try {
    await verifyRecoveryCode(form.email, code)   // deja una sesión temporal
    await updatePassword(newPassword.value)       // cambia la clave
    router.push('/mis-pedidos')
  } catch (err) {
    const m = err?.message || ''
    error.value =
      m.includes('expired')                          ? 'El código expiró. Pide uno nuevo.' :
      (m.includes('invalid') || m.includes('Token')) ? 'Código incorrecto. Revísalo e inténtalo de nuevo.' :
      (m || 'No se pudo cambiar la contraseña. Inténtalo de nuevo.')
  } finally {
    verificando.value = false
  }
}

function cambiarModo(m) {
  modo.value = m; paso.value = 'form'; codigo.value = ''; newPassword.value = ''
  error.value = ''; aviso.value = ''
}
</script>

<template>
<div class="acc">
  <div class="acc__card">
    <RouterLink to="/" class="acc__brand">HEBENNUS</RouterLink>

    <template v-if="paso === 'form'">
    <div class="acc__tabs" role="tablist">
      <button :class="['acc__tab', { 'acc__tab--on': modo === 'login' }]" @click="cambiarModo('login')">Iniciar sesión</button>
      <button :class="['acc__tab', { 'acc__tab--on': modo === 'registro' }]" @click="cambiarModo('registro')">Crear cuenta</button>
    </div>

    <p v-if="modo === 'registro'" class="acc__promo">🎁 Crea tu cuenta y sigue tus pedidos en un solo lugar.</p>

    <!-- Login con Google OCULTO: el proveedor no está habilitado en Supabase (necesita
         OAuth de Google Cloud). Reactivar quitando el v-if="false" cuando esté configurado. -->
    <template v-if="false">
      <button type="button" class="acc__google" :disabled="googleLoading" @click="conGoogle">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>
          <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/>
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
        </svg>
        {{ googleLoading ? 'Conectando…' : 'Continuar con Google' }}
      </button>

      <div class="acc__divider"><span>o con tu correo</span></div>
    </template>

    <form class="acc__form" novalidate @submit.prevent="enviar">
      <template v-if="modo === 'registro'">
        <label class="acc__label" for="ac-name">Nombre completo</label>
        <input id="ac-name" v-model="form.full_name" type="text" class="acc__input" autocomplete="name" />
        <p v-if="form.full_name && errores.full_name" class="acc__ferr">{{ errores.full_name }}</p>
        <label class="acc__label" for="ac-phone">Celular <span class="acc__opt">(opcional)</span></label>
        <input id="ac-phone" v-model="form.phone" type="tel" inputmode="numeric" maxlength="9" class="acc__input" autocomplete="tel"
               @input="form.phone = form.phone.replace(/\D/g,'').slice(0,9)" />
        <p v-if="form.phone && errores.phone" class="acc__ferr">{{ errores.phone }}</p>
      </template>

      <label class="acc__label" for="ac-email">Correo electrónico</label>
      <input id="ac-email" v-model="form.email" type="email" class="acc__input" autocomplete="email" />
      <p v-if="form.email && errores.email" class="acc__ferr">{{ errores.email }}</p>

      <label class="acc__label" for="ac-pass">Contraseña</label>
      <input id="ac-pass" v-model="form.password" type="password" class="acc__input"
             :autocomplete="modo === 'registro' ? 'new-password' : 'current-password'" />
      <p v-if="modo === 'registro'" :class="['acc__phint', { 'acc__ferr': form.password && errores.password }]">
        Mínimo 8 caracteres, con al menos una letra y un número.
      </p>
      <p v-if="modo === 'login'" class="acc__forgot">
        <button type="button" @click="irARecuperar">¿Olvidaste tu contraseña?</button>
      </p>

      <p v-if="error" class="acc__error" role="alert">{{ error }}</p>
      <p v-if="aviso" class="acc__aviso" role="status">{{ aviso }}</p>

      <button type="submit" class="acc__btn" :disabled="!valido || enviando">
        <span v-if="enviando" class="spinner"></span>
        {{ enviando ? 'Procesando…' : (modo === 'registro' ? 'Crear cuenta' : 'Ingresar') }}
      </button>
    </form>

    <p class="acc__switch" v-if="modo === 'login'">¿No tienes cuenta? <button @click="cambiarModo('registro')">Regístrate</button></p>
    <p class="acc__switch" v-else>¿Ya tienes cuenta? <button @click="cambiarModo('login')">Inicia sesión</button></p>
    </template>

    <!-- ── Paso: verificar código de registro ── -->
    <template v-else-if="paso === 'verificar'">
      <h2 class="acc__vtitle">Verifica tu correo</h2>
      <p class="acc__vsub">Ingresa el código de 6 dígitos que enviamos a<br/><strong>{{ form.email }}</strong></p>

      <form class="acc__form" novalidate @submit.prevent="verificarCodigo">
        <input
          v-model="codigo" inputmode="numeric" maxlength="8" autocomplete="one-time-code"
          class="acc__input acc__code" placeholder="······" aria-label="Código de verificación"
        />
        <p v-if="error" class="acc__error" role="alert">{{ error }}</p>
        <button type="submit" class="acc__btn" :disabled="codigo.replace(/\D/g,'').length < 6 || verificando">
          <span v-if="verificando" class="spinner"></span>
          {{ verificando ? 'Verificando…' : 'Verificar y entrar' }}
        </button>
      </form>

      <p class="acc__resend">
        ¿No te llegó?
        <button type="button" :disabled="reenviando || cooldown > 0" @click="reenviar">
          {{ cooldown > 0 ? `Reenviar en ${cooldown}s` : (reenviando ? 'Reenviando…' : 'Reenviar código') }}
        </button>
      </p>
      <p class="acc__switch"><button @click="cambiarModo('registro')">← Cambiar correo</button></p>
    </template>

    <!-- ── Paso: recuperar contraseña (pedir código) ── -->
    <template v-else-if="paso === 'recuperar'">
      <h2 class="acc__vtitle">Recuperar acceso</h2>
      <p class="acc__vsub">Ingresa tu correo y te enviaremos un código de 6 dígitos para crear una nueva contraseña.</p>

      <form class="acc__form" novalidate @submit.prevent="pedirReset">
        <label class="acc__label" for="rc-email">Correo electrónico</label>
        <input id="rc-email" v-model="form.email" type="email" class="acc__input" autocomplete="email" />
        <p v-if="error" class="acc__error" role="alert">{{ error }}</p>
        <button type="submit" class="acc__btn" :disabled="enviando">
          <span v-if="enviando" class="spinner"></span>
          {{ enviando ? 'Enviando…' : 'Enviar código' }}
        </button>
      </form>
      <p class="acc__switch"><button @click="cambiarModo('login')">← Volver a iniciar sesión</button></p>
    </template>

    <!-- ── Paso: reset (código + nueva contraseña) ── -->
    <template v-else>
      <h2 class="acc__vtitle">Nueva contraseña</h2>
      <p class="acc__vsub">Ingresa el código que enviamos a<br/><strong>{{ form.email }}</strong> y tu nueva contraseña.</p>

      <form class="acc__form" novalidate @submit.prevent="confirmarReset">
        <label class="acc__label" for="rs-code">Código de 6 dígitos</label>
        <input id="rs-code" v-model="codigo" inputmode="numeric" maxlength="8" autocomplete="one-time-code"
               class="acc__input acc__code" placeholder="······" aria-label="Código de verificación" />
        <label class="acc__label" for="rs-pass">Nueva contraseña</label>
        <input id="rs-pass" v-model="newPassword" type="password" class="acc__input" autocomplete="new-password" />
        <p class="acc__phint">Mínimo 8 caracteres, con al menos una letra y un número.</p>
        <p v-if="error" class="acc__error" role="alert">{{ error }}</p>
        <button type="submit" class="acc__btn" :disabled="verificando">
          <span v-if="verificando" class="spinner"></span>
          {{ verificando ? 'Guardando…' : 'Cambiar contraseña' }}
        </button>
      </form>

      <p class="acc__resend">
        ¿No te llegó?
        <button type="button" :disabled="reenviando || cooldown > 0" @click="reenviar">
          {{ cooldown > 0 ? `Reenviar en ${cooldown}s` : (reenviando ? 'Reenviando…' : 'Reenviar código') }}
        </button>
      </p>
      <p class="acc__switch"><button @click="cambiarModo('login')">← Volver a iniciar sesión</button></p>
    </template>

    <RouterLink to="/" class="acc__back">← Volver a la tienda</RouterLink>
  </div>
</div>
</template>

<style scoped>
.acc { min-height: 80vh; display: grid; place-items: center; padding: 3rem 1.25rem; }
.acc__card {
  width: 100%; max-width: 400px;
  background: var(--card-bg);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft);
  padding: 2rem 1.75rem;
  display: flex; flex-direction: column;
  animation: hb-fade-up 0.5s var(--ease-out) both;
}
@keyframes hb-fade-up { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.acc__brand { font-family: var(--font-brand); font-weight: 800; font-size: 1.45rem; letter-spacing: 0.02em; text-align: center; color: var(--text-1); margin-bottom: 1.25rem; }
.acc__tabs { display: flex; gap: 0.25rem; background: var(--surface-2); padding: 0.3rem; border-radius: var(--radius-pill); margin-bottom: 1rem; }
.acc__tab { flex: 1; padding: 0.6rem; font-size: 0.78rem; font-weight: 600; letter-spacing: 0.04em; color: var(--text-3); border-radius: var(--radius-pill); cursor: pointer; transition: color 0.25s var(--ease-out), background 0.25s var(--ease-out), box-shadow 0.25s var(--ease-out); }
.acc__tab:active { transform: scale(0.97); }
.acc__tab--on { background: var(--card-bg); color: var(--text-1); box-shadow: var(--shadow-sm); }
.acc__promo { font-size: 0.8rem; color: var(--accent-3); text-align: center; margin-bottom: 1rem; }
.acc__google { display: flex; align-items: center; justify-content: center; gap: 0.6rem; width: 100%; padding: 0.8rem; background: var(--surface-1); border: 1px solid var(--border-mid); color: var(--text-1); font-size: 0.85rem; font-weight: 600; cursor: pointer; border-radius: var(--radius-md); transition: background 0.2s var(--ease-out), border-color 0.2s var(--ease-out), transform 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out); }
.acc__google:hover { background: var(--surface-2); border-color: var(--border-mid); transform: translateY(-2px); box-shadow: var(--shadow-soft); }
.acc__google:active { transform: scale(0.98); }
.acc__google:disabled { opacity: 0.6; cursor: not-allowed; transform: none; box-shadow: none; }
.acc__divider { display: flex; align-items: center; gap: 0.75rem; margin: 1.1rem 0 0.25rem; color: var(--text-3); font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.1em; }
.acc__divider::before, .acc__divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
.acc__resend { font-size: 0.78rem; color: var(--text-3); margin-top: 0.4rem; }
.acc__resend button { color: var(--accent-3); font-weight: 600; cursor: pointer; }
.acc__resend button:disabled { color: var(--text-3); cursor: default; }
.acc__form { display: flex; flex-direction: column; gap: 0.35rem; }
.acc__label { font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-2); font-weight: 600; margin-top: 0.6rem; }
.acc__opt { color: var(--text-3); font-weight: 400; text-transform: none; letter-spacing: 0; }
.acc__input { background: var(--surface-2); border: 1px solid var(--border-mid); color: var(--text-1); padding: 0.7rem 0.8rem; font-size: 0.95rem; outline: none; border-radius: var(--radius-sm); transition: border-color 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out); }
.acc__input:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--glow-color); }
.acc__error { color: var(--danger); font-size: 0.78rem; margin-top: 0.6rem; }
.acc__aviso { color: var(--accent-2); font-size: 0.82rem; margin-top: 0.6rem; line-height: 1.5; }
.acc__ferr { color: var(--danger); font-size: 0.72rem; margin-top: 0.15rem; }
.acc__phint { color: var(--text-3); font-size: 0.72rem; margin-top: 0.15rem; line-height: 1.4; }
.acc__phint.acc__ferr { color: var(--danger); }
.acc__forgot { text-align: right; margin-top: 0.45rem; }
.acc__forgot button { color: var(--accent-3); font-size: 0.76rem; font-weight: 600; cursor: pointer; transition: opacity 0.2s var(--ease-out); }
.acc__forgot button:hover { opacity: 0.78; }
.acc__btn { margin-top: 1.1rem; padding: 0.95rem; background: var(--accent); color: var(--on-accent); border: 1px solid var(--accent); border-radius: 4px; font-family: var(--font-display); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; transition: background-color 0.25s var(--ease-out), opacity 0.2s var(--ease-out); }
.acc__btn:hover:not(:disabled) { background: var(--accent-deep); border-color: var(--accent-deep); }
.acc__btn:active:not(:disabled) { transform: translateY(1px); }
.acc__btn:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }
.acc__switch { text-align: center; font-size: 0.8rem; color: var(--text-3); margin-top: 1rem; }
.acc__switch button { color: var(--accent-3); font-weight: 600; cursor: pointer; transition: opacity 0.2s var(--ease-out); }
.acc__switch button:hover { opacity: 0.75; }
.acc__back { text-align: center; font-size: 0.72rem; color: var(--text-3); margin-top: 0.75rem; transition: color 0.2s var(--ease-out); }
.acc__back:hover { color: var(--text-1); }
.acc__vtitle { font-family: var(--font-display); font-size: 1.3rem; font-weight: 800; text-transform: uppercase; text-align: center; color: var(--text-1); margin-bottom: 0.5rem; }
.acc__vsub { font-size: 0.85rem; color: var(--text-2); text-align: center; line-height: 1.6; margin-bottom: 1.25rem; }
.acc__code { text-align: center; font-size: 1.5rem; letter-spacing: 0.4em; font-family: var(--font-display); padding: 0.7rem 0.5rem; }
.spinner { width: 14px; height: 14px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
