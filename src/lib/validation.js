// ─── Validaciones compartidas (Hebennus) ─────────────────────────────────────
// Reglas usadas por el checkout (frontend) y alineadas con las del servidor
// (create-order). Mantener ambos lados en sync para no rechazar/aceptar de más.

// Correo: formato básico válido (no espacios, un @, un dominio con punto).
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Solo dígitos (utilidad para limpiar lo que escribe el usuario).
export const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '')

export function validarEmail(v) {
  return EMAIL_RE.test(String(v ?? '').trim())
}

// Celular Perú: 9 dígitos que empiezan en 9.
export function validarTelefonoPE(v) {
  return /^9\d{8}$/.test(soloDigitos(v))
}

// DNI: exactamente 8 dígitos.
export function validarDNI(v) {
  return /^\d{8}$/.test(soloDigitos(v))
}

// RUC: exactamente 11 dígitos (empieza en 10 o 20 para los más comunes, pero
// no lo forzamos para no rechazar RUC válidos de otros tipos).
export function validarRUC(v) {
  return /^\d{11}$/.test(soloDigitos(v))
}

// Texto requerido con largo mínimo (nombres, apellidos, calle, distrito…).
export function validarTexto(v, min = 1) {
  return String(v ?? '').trim().length >= min
}
