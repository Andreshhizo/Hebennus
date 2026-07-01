// ─────────────────────────────────────────────────────────────────────────────
// _shared/hmac.ts
// HMAC-SHA256 → hex con la Web Crypto API de Deno (crypto.subtle).
// Lo usan izipay-ipn (firma servidor-a-servidor, clave = IZIPAY_PASSWORD) e
// izipay-validate (firma del navegador, clave = IZIPAY_HMAC).
// ─────────────────────────────────────────────────────────────────────────────

const encoder = new TextEncoder()

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Devuelve hex( HMAC_SHA256(message, key) ). */
export async function hmacSha256Hex(message: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message))
  return toHex(sig)
}

/** Comparación de strings en tiempo (cuasi) constante para no filtrar la firma. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Verifica que hex(HMAC_SHA256(message, key)) === expectedHash (case-insensitive). */
export async function verifyHmac(message: string, key: string, expectedHash: string): Promise<boolean> {
  if (!expectedHash) return false
  const computed = await hmacSha256Hex(message, key)
  return timingSafeEqual(computed.toLowerCase(), expectedHash.toLowerCase())
}
