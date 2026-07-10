// ─────────────────────────────────────────────────────────────────────────────
// _shared/email.ts
// Plantilla del correo de confirmación de pedido + envío vía Resend.
// Lo usan create-order (pago contraentrega) e izipay-ipn (al confirmar el pago).
// La RESEND_API_KEY vive en los secrets del servidor; nunca llega al navegador.
// ─────────────────────────────────────────────────────────────────────────────

export interface ItemPedido {
  product_id?: string | null
  name: string
  size: string
  color: string | null
  qty: number
  unit_price: number
  subtotal: number
}

export interface ClientePedido {
  customer_name: string
  customer_phone: string
  customer_email: string
  notes?: string
  doc_tipo?: string | null
  doc_numero?: string | null
  comprobante_tipo?: string
  razon_social?: string | null
}

export interface Totales {
  subtotal: number
  shipping: number
  discount: number
  total: number
}

export function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function buildHtml(
  c: ClientePedido,
  items: ItemPedido[],
  totals: Totales,
  orderNumber: string,
  dest: 'cliente' | 'tienda',
): string {
  const filas = items.map((it) => {
    const color = it.color ? ` / ${escapeHtml(it.color)}` : ''
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;">${escapeHtml(it.name)}
        <span style="color:#888;"> — Talla ${escapeHtml(it.size)}${color} × ${it.qty}</span></td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">S/ ${it.subtotal.toFixed(2)}</td>
    </tr>`
  }).join('')

  const intro = dest === 'cliente'
    ? `¡Gracias por tu pedido! 🎉 Tu número de pedido es <strong>${escapeHtml(orderNumber)}</strong>. Lo estamos preparando con cariño.`
    : `Nuevo pedido <strong>${escapeHtml(orderNumber)}</strong> de ${escapeHtml(c.customer_name)}.`

  const envio = totals.shipping > 0 ? `S/ ${totals.shipping.toFixed(2)}` : 'Gratis'
  const filaDesc = totals.discount > 0
    ? `<tr><td style="padding:0 0 8px;color:#2ecc8f;">Descuento bienvenida (10%)</td><td style="padding:0 0 8px;text-align:right;color:#2ecc8f;">- S/ ${totals.discount.toFixed(2)}</td></tr>`
    : ''

  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#0b0f1a;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <h1 style="font-size:22px;letter-spacing:3px;margin:0 0 4px;">HEBENNUS</h1>
    <p style="color:#5b8def;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:0 0 24px;">Confirmación de pedido · ${escapeHtml(orderNumber)}</p>
    <p style="font-size:14px;line-height:1.6;">${intro}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
      ${filas}
      <tr><td style="padding:8px 0;color:#555;">Subtotal</td><td style="padding:8px 0;text-align:right;color:#555;">S/ ${totals.subtotal.toFixed(2)}</td></tr>
      ${filaDesc}
      <tr><td style="padding:0 0 8px;color:#555;">Envío</td><td style="padding:0 0 8px;text-align:right;color:#555;">${envio}</td></tr>
      <tr><td style="padding:12px 0;font-weight:bold;border-top:1px solid #ddd;">TOTAL</td>
          <td style="padding:12px 0;text-align:right;font-weight:bold;border-top:1px solid #ddd;">S/ ${totals.total.toFixed(2)}</td></tr>
    </table>
    <h2 style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#888;margin:24px 0 8px;">Datos de envío</h2>
    <p style="font-size:14px;line-height:1.7;margin:0;">
      ${escapeHtml(c.customer_name)}<br/>
      ${escapeHtml(c.customer_email)} · ${escapeHtml(c.customer_phone)}<br/>
      ${escapeHtml(c.notes ?? '')}
    </p>
    <p style="font-size:12px;color:#888;margin-top:32px;">Te contactaremos para coordinar la entrega. — Hebennus, Lima.</p>
  </div></body></html>`
}

// Correo de cambio de estado (lo dispara el admin al marcar confirmado/enviado/
// entregado). Devuelve '' si el estado no lleva correo.
export function buildHtmlEstado(customerName: string, orderNumber: string, status: string): string {
  const cfg: Record<string, { tag: string; color: string; title: string; body: string }> = {
    confirmado: {
      tag: 'Pedido confirmado',
      color: '#5b8def',
      title: '¡Recibimos tu pedido! 🎉',
      body: 'Ya estamos preparando tu pedido con cariño. Te avisaremos apenas salga en camino.',
    },
    enviado: {
      tag: 'Tu pedido va en camino',
      color: '#7c5cff',
      title: 'Tu pedido va en camino 🚚',
      body: 'Te contactaremos por WhatsApp para coordinar la entrega (sábado o domingo). Si tienes alguna duda, respóndenos este correo.',
    },
    entregado: {
      tag: 'Pedido entregado',
      color: '#2ecc8f',
      title: '¡Tu pedido fue entregado! 🎉',
      body: '¡Gracias por comprar en Hebennus! Esperamos que disfrutes tu compra. Si algo no salió como esperabas, respóndenos este correo.',
    },
  }
  const c = cfg[status]
  if (!c) return ''
  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#0b0f1a;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <h1 style="font-size:22px;letter-spacing:3px;margin:0 0 4px;">HEBENNUS</h1>
    <p style="color:${c.color};font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:0 0 24px;">${c.tag} · ${escapeHtml(orderNumber)}</p>
    <p style="font-size:16px;font-weight:bold;line-height:1.5;margin:0 0 12px;">${c.title}</p>
    <p style="font-size:14px;line-height:1.6;">¡Hola ${escapeHtml(customerName)}! Tu pedido <strong>${escapeHtml(orderNumber)}</strong>:</p>
    <p style="font-size:14px;line-height:1.6;">${c.body}</p>
    <p style="font-size:12px;color:#888;margin-top:32px;">Gracias por comprar en Hebennus. — Lima, Perú.</p>
  </div></body></html>`
}

// Correo al cliente cuando crea un pedido Yape (pago pendiente por coordinar).
export function buildHtmlYapePendiente(customerName: string, orderNumber: string, total: number): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#0b0f1a;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <h1 style="font-size:22px;letter-spacing:3px;margin:0 0 4px;">HEBENNUS</h1>
    <p style="color:#e0a23b;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:0 0 24px;">Pedido reservado · ${escapeHtml(orderNumber)}</p>
    <p style="font-size:16px;font-weight:bold;line-height:1.5;margin:0 0 12px;">¡Reservamos tu pedido! 🟣</p>
    <p style="font-size:14px;line-height:1.6;">¡Hola ${escapeHtml(customerName)}! Tu pedido <strong>${escapeHtml(orderNumber)}</strong> quedó reservado por un total de <strong>S/ ${total.toFixed(2)}</strong>.</p>
    <p style="font-size:14px;line-height:1.6;">Para completarlo, <strong>escríbenos por WhatsApp</strong> y coordinamos el pago con Yape (te enviamos el QR). Apenas recibamos el pago, te confirmamos el pedido. 🙌</p>
    <p style="font-size:12px;color:#888;margin-top:32px;">¿Dudas? Respóndenos este correo. — Hebennus, Lima.</p>
  </div></body></html>`
}

export async function enviarResend(apiKey: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 300)}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Envío del par de correos (cliente + copia a la tienda). Idéntico al flujo que
// usaba create-order; centralizado para reutilizarlo en la IPN de Izipay.
// No lanza: devuelve { sent, error } para no tumbar el pedido si Resend falla.
// ─────────────────────────────────────────────────────────────────────────────
export async function enviarCorreoConfirmacion(
  cliente: ClientePedido,
  items: ItemPedido[],
  totals: Totales,
  orderNumber: string,
): Promise<{ sent: boolean; error: string | null }> {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  const FROM  = Deno.env.get('RESEND_FROM') ?? 'Hebennus <onboarding@resend.dev>'
  const STORE = Deno.env.get('STORE_EMAIL')

  if (!RESEND_API_KEY) return { sent: false, error: 'RESEND_API_KEY no configurada' }

  let sent = false
  let error: string | null = null

  // Correo al cliente.
  try {
    await enviarResend(RESEND_API_KEY, {
      from: FROM,
      to: [cliente.customer_email.trim()],
      subject: `Confirmación de tu pedido ${orderNumber} — Hebennus`,
      html: buildHtml(cliente, items, totals, orderNumber, 'cliente'),
      reply_to: STORE || undefined,
    })
    sent = true
  } catch (e) { error = (e as Error).message }

  // Copia a la tienda (independiente: se manda aunque la del cliente falle).
  if (STORE) {
    try {
      await enviarResend(RESEND_API_KEY, {
        from: FROM,
        to: [STORE],
        subject: `Nuevo pedido ${orderNumber} — ${cliente.customer_name}`,
        html: buildHtml(cliente, items, totals, orderNumber, 'tienda'),
        reply_to: cliente.customer_email.trim(),
      })
    } catch (e) { if (!error) error = 'store: ' + (e as Error).message }
  }

  return { sent, error }
}
