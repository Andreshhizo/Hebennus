// Controles comunes para Edge Functions públicas: CORS estricto, límite real de
// cuerpo, rate-limit durable en Postgres e idempotency keys opacas.

const DEFAULT_ORIGINS = [
  'https://www.hebennus.com',
  'https://hebennus.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

export class RequestError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'RequestError'
    this.status = status
  }
}

function allowedOrigins(): Set<string> {
  const configured = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  return new Set(configured.length ? configured : DEFAULT_ORIGINS)
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin')
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  }
  if (origin && allowedOrigins().has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

export function assertAllowedOrigin(req: Request): void {
  const origin = req.headers.get('Origin')
  // Requests servidor-a-servidor no incluyen Origin. Los navegadores sí.
  if (origin && !allowedOrigins().has(origin)) throw new RequestError('Origen no permitido', 403)
}

export function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export async function readBodyLimited(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get('Content-Length') ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RequestError('Cuerpo demasiado grande', 413)
  }

  const buffer = await req.arrayBuffer()
  if (buffer.byteLength > maxBytes) throw new RequestError('Cuerpo demasiado grande', 413)
  return new TextDecoder().decode(buffer)
}

export async function readJsonLimited<T>(req: Request, maxBytes: number): Promise<T> {
  const raw = await readBodyLimited(req, maxBytes)
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new RequestError('JSON inválido', 400)
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function clientAddress(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-real-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown'
  )
}

export async function enforceRateLimit(
  admin: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }> },
  req: Request,
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const fingerprint = await sha256Hex([
    clientAddress(req),
    req.headers.get('user-agent') ?? '',
  ].join('|'))
  const { data, error } = await admin.rpc('consume_edge_rate_limit', {
    p_scope: scope,
    p_identifier_hash: fingerprint,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (error) {
    console.error(`[${scope}] rate-limit no disponible:`, error.message)
    // Fail closed: estos endpoints producen escrituras/correos/costos externos.
    throw new RequestError('Servicio temporalmente no disponible', 503)
  }
  if (data !== true) throw new RequestError('Demasiadas solicitudes. Inténtalo más tarde.', 429)
}

export async function idempotencyData(
  req: Request,
  requestBody: unknown,
): Promise<{ keyHash: string | null; requestHash: string | null }> {
  const key = (req.headers.get('Idempotency-Key') ?? '').trim()
  if (!key) return { keyHash: null, requestHash: null }
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
    throw new RequestError('Idempotency-Key inválida', 400)
  }
  const [keyHash, requestHash] = await Promise.all([
    sha256Hex(key),
    sha256Hex(JSON.stringify(requestBody)),
  ])
  return { keyHash, requestHash }
}

export function handleRequestError(req: Request, error: unknown): Response {
  if (error instanceof RequestError) return jsonResponse(req, { error: error.message }, error.status)
  console.error('[edge] Error no controlado:', error)
  return jsonResponse(req, { error: 'Error interno' }, 500)
}
