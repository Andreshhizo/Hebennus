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
  image?: string | null   // miniatura del producto (opcional) para el correo
}

// ── Marca / enlaces (para los correos) ──
const SITE      = 'https://www.hebennus.com'
const COLECCION = `${SITE}/coleccion`
const LOGO      = `${SITE}/apple-touch-icon.png`
const IG        = 'https://instagram.com/hebennus'
const TT        = 'https://tiktok.com/@hebennus'
const ENVIO_GRATIS_DESDE = 119

// Paleta (greige + denim, alineada con la tienda)
const C = {
  bg:     '#ece7de',   // greige de fondo
  card:   '#ffffff',
  ink:    '#14120f',   // header oscuro / texto fuerte
  cream:  '#f4f1ec',
  denim:  '#2e4870',   // acento
  text:   '#1f1d1a',
  muted:  '#8a857d',
  border: '#ececec',
  ok:     '#2ecc8f',
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

// ── Bloques reutilizables (todo tabla + estilos inline: email-safe) ──
function header(): string {
  return `<tr><td style="background:${C.ink};padding:26px 32px;text-align:center;">
    <img src="${LOGO}" width="46" height="46" alt="Hebennus" style="display:inline-block;border-radius:50%;" />
    <div style="font-family:Arial,Helvetica,sans-serif;color:${C.cream};font-size:20px;font-weight:800;letter-spacing:6px;margin-top:10px;">HEBENNUS</div>
    <div style="font-family:Arial,Helvetica,sans-serif;color:#b9b3a8;font-size:9px;letter-spacing:4px;margin-top:4px;">MAKE IT REAL</div>
  </td></tr>`
}

function footer(): string {
  return `<tr><td style="padding:22px 32px 6px;text-align:center;border-top:1px solid ${C.border};">
    <a href="${IG}" style="color:${C.denim};font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;text-decoration:none;margin:0 10px;">Instagram</a>
    <a href="${TT}" style="color:${C.denim};font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;text-decoration:none;margin:0 10px;">TikTok</a>
  </td></tr>
  <tr><td style="padding:6px 32px 28px;text-align:center;">
    <p style="font-family:Arial,Helvetica,sans-serif;color:${C.muted};font-size:11px;line-height:1.7;margin:0;">Hebennus · Lima, Perú<br/>Make it real, Make it with Hebennus.</p>
  </td></tr>`
}

function boton(text: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;"><tr>
    <td style="background:${C.denim};border-radius:8px;">
      <a href="${href}" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;letter-spacing:0.4px;color:#ffffff;text-decoration:none;">${text}</a>
    </td></tr></table>`
}

function wrap(inner: string): string {
  return `<!doctype html><html lang="es"><head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  </head>
  <body style="margin:0;padding:0;background:${C.bg};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};">
      <tr><td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:${C.card};border-radius:16px;overflow:hidden;">
          ${header()}
          <tr><td style="padding:30px 32px 6px;font-family:Arial,Helvetica,sans-serif;color:${C.text};">${inner}</td></tr>
          ${footer()}
        </table>
      </td></tr>
    </table>
  </body></html>`
}

function eyebrow(txt: string, orderNumber: string): string {
  return `<p style="color:${C.denim};font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">${txt} · ${escapeHtml(orderNumber)}</p>`
}

function filaItem(it: ItemPedido): string {
  const color = it.color ? ` / ${escapeHtml(it.color)}` : ''
  const thumb = it.image
    ? `<img src="${escapeHtml(it.image)}" width="52" height="66" alt="" style="display:block;width:52px;height:66px;object-fit:cover;border-radius:8px;border:1px solid ${C.border};" />`
    : `<div style="width:52px;height:66px;border-radius:8px;background:${C.bg};"></div>`
  const bb = `border-bottom:1px solid ${C.border};`
  return `<tr>
    <td width="64" valign="top" style="padding:12px 12px 12px 0;${bb}">${thumb}</td>
    <td valign="top" style="padding:14px 0;${bb}font-size:14px;color:${C.text};line-height:1.4;">
      <strong>${escapeHtml(it.name)}</strong><br/>
      <span style="color:${C.muted};font-size:12px;">Talla ${escapeHtml(it.size)}${color} · x${it.qty}</span>
    </td>
    <td valign="top" align="right" style="padding:14px 0;${bb}white-space:nowrap;font-size:14px;font-weight:bold;color:${C.text};">S/ ${it.subtotal.toFixed(2)}</td>
  </tr>`
}

function tablaTotales(totals: Totales): string {
  const envio = totals.shipping > 0 ? `S/ ${totals.shipping.toFixed(2)}` : 'Gratis'
  const filaDesc = totals.discount > 0
    ? `<tr><td style="padding:2px 0;color:${C.ok};font-size:13px;">Descuento bienvenida (10%)</td><td align="right" style="padding:2px 0;color:${C.ok};font-size:13px;">- S/ ${totals.discount.toFixed(2)}</td></tr>`
    : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;margin:14px 0 4px;">
    <tr><td style="padding:2px 0;color:${C.muted};font-size:13px;">Subtotal</td><td align="right" style="padding:2px 0;color:${C.muted};font-size:13px;">S/ ${totals.subtotal.toFixed(2)}</td></tr>
    ${filaDesc}
    <tr><td style="padding:2px 0;color:${C.muted};font-size:13px;">Envío</td><td align="right" style="padding:2px 0;color:${C.muted};font-size:13px;">${envio}</td></tr>
    <tr><td style="padding:12px 0 0;border-top:2px solid ${C.ink};font-weight:800;font-size:16px;color:${C.ink};">TOTAL</td>
        <td align="right" style="padding:12px 0 0;border-top:2px solid ${C.ink};font-weight:800;font-size:16px;color:${C.ink};">S/ ${totals.total.toFixed(2)}</td></tr>
  </table>`
}

export function buildHtml(
  c: ClientePedido,
  items: ItemPedido[],
  totals: Totales,
  orderNumber: string,
  dest: 'cliente' | 'tienda',
): string {
  const esCliente = dest === 'cliente'
  const filas = items.map(filaItem).join('')

  const titulo = esCliente ? '¡Gracias por tu compra!' : 'Nuevo pedido 🛒'
  const intro = esCliente
    ? `Hola <strong>${escapeHtml(c.customer_name)}</strong>, recibimos tu pedido <strong>${escapeHtml(orderNumber)}</strong> y ya lo estamos preparando con cariño. 🧡`
    : `<strong>${escapeHtml(c.customer_name)}</strong> acaba de hacer un pedido. Detalle abajo.`

  // Bloque vendedor (solo al cliente): CTA + beneficios que invitan a volver.
  const ctaBloque = esCliente ? `
    <div style="text-align:center;margin:28px 0 6px;">${boton('Seguir explorando la colección →', COLECCION)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 4px;">
      <tr><td style="background:${C.bg};border-radius:12px;padding:16px 18px;font-family:Arial,Helvetica,sans-serif;">
        <p style="margin:0 0 6px;font-size:13px;color:${C.text};"><strong>🚚 Envío GRATIS</strong> en compras desde S/ ${ENVIO_GRATIS_DESDE.toFixed(2)}</p>
        <p style="margin:0;font-size:13px;color:${C.text};"><strong>📸 Síguenos</strong> en Instagram <a href="${IG}" style="color:${C.denim};text-decoration:none;font-weight:bold;">@hebennus</a> — drops y novedades primero.</p>
      </td></tr>
    </table>` : ''

  const inner = `
    ${eyebrow(esCliente ? 'Confirmación de pedido' : 'Nuevo pedido', orderNumber)}
    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:800;color:${C.ink};margin:0 0 10px;line-height:1.2;">${titulo}</h1>
    <p style="font-size:14px;line-height:1.6;color:${C.text};margin:0 0 8px;">${intro}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0;">${filas}</table>
    ${tablaTotales(totals)}
    ${ctaBloque}
    <h2 style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:${C.muted};margin:26px 0 8px;">Datos de envío</h2>
    <p style="font-size:14px;line-height:1.7;margin:0;color:${C.text};">
      <strong>${escapeHtml(c.customer_name)}</strong><br/>
      ${escapeHtml(c.customer_email)} · ${escapeHtml(c.customer_phone)}<br/>
      ${escapeHtml(c.notes ?? '')}
    </p>
    <p style="font-size:12px;color:${C.muted};margin:22px 0 0;">${esCliente ? 'Te contactaremos por WhatsApp para coordinar la entrega. ¡Gracias por elegir Hebennus!' : 'Copia interna del pedido.'}</p>`

  return wrap(inner)
}

// ─────────────────────────────────────────────────────────────────────────────
// Correo de SOBREVENTA: el pedido se PAGÓ pero no había stock suficiente.
//   • 'cliente': mensaje suave y honesto — confirmamos que recibimos el pago pero
//     NUNCA decimos "confirmado"; avisamos que estamos verificando disponibilidad.
//   • 'tienda' : alerta interna para gestionar reposición o reembolso.
// Reutiliza los bloques del resto de correos (wrap, eyebrow, filaItem, escapeHtml, C).
// ─────────────────────────────────────────────────────────────────────────────
export function buildHtmlSobreventa(
  c: ClientePedido,
  items: ItemPedido[],
  orderNumber: string,
  dest: 'cliente' | 'tienda',
): string {
  const filas = items.map(filaItem).join('')
  const n = escapeHtml(orderNumber)

  if (dest === 'cliente') {
    const inner = `
      ${eyebrow('Pago recibido', orderNumber)}
      <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:800;color:${C.ink};margin:0 0 10px;line-height:1.2;">¡Recibimos tu pago! 🙌</h1>
      <p style="font-size:14px;line-height:1.6;color:${C.text};margin:0 0 8px;">Hola <strong>${escapeHtml(c.customer_name)}</strong>, estamos verificando la disponibilidad de tu pedido <strong>${n}</strong>. Te contactaremos por WhatsApp en breve para confirmarlo o, si no hubiera stock, reembolsarte de inmediato.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0;">${filas}</table>
      <p style="font-size:12px;color:${C.muted};margin:22px 0 0;">Gracias por tu paciencia y por confiar en Hebennus. 🧡</p>`
    return wrap(inner)
  }

  // ── Tienda: alerta con datos del cliente + ítems ──
  const inner = `
    ${eyebrow('⚠️ Revisar', orderNumber)}
    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:800;color:${C.ink};margin:0 0 10px;line-height:1.2;">Pago recibido SIN stock</h1>
    <p style="font-size:14px;line-height:1.6;color:${C.text};margin:0 0 8px;">El pedido <strong>${n}</strong> se <strong>PAGÓ</strong> pero no hay stock suficiente. Gestiona reposición o reembolso.</p>
    <h2 style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:${C.muted};margin:24px 0 8px;">Datos del cliente</h2>
    <p style="font-size:14px;line-height:1.7;margin:0;color:${C.text};">
      <strong>${escapeHtml(c.customer_name)}</strong><br/>
      ${escapeHtml(c.customer_email)} · ${escapeHtml(c.customer_phone)}<br/>
      ${escapeHtml(c.notes ?? '')}
    </p>
    <h2 style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:${C.muted};margin:24px 0 8px;">Ítems del pedido</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;">${filas}</table>`
  return wrap(inner)
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
  const inner = `
    <p style="color:${c.color};font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;margin:0 0 10px;">${c.tag} · ${escapeHtml(orderNumber)}</p>
    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:23px;font-weight:800;color:${C.ink};margin:0 0 12px;line-height:1.25;">${c.title}</h1>
    <p style="font-size:14px;line-height:1.6;color:${C.text};margin:0 0 8px;">¡Hola <strong>${escapeHtml(customerName)}</strong>! Sobre tu pedido <strong>${escapeHtml(orderNumber)}</strong>:</p>
    <p style="font-size:14px;line-height:1.6;color:${C.text};margin:0 0 8px;">${c.body}</p>
    <div style="text-align:center;margin:26px 0 6px;">${boton('Descubre lo nuevo →', COLECCION)}</div>`
  return wrap(inner)
}

// Correo al cliente cuando crea un pedido Yape (pago pendiente por coordinar).
export function buildHtmlYapePendiente(customerName: string, orderNumber: string, total: number): string {
  const wa = (Deno.env.get('WHATSAPP_NUMERO') ?? Deno.env.get('VITE_WHATSAPP_NUMERO') ?? '').replace(/\D/g, '')
  const msg = `¡Holaa Hebennus! 👋 Quiero completar el pago de mi pedido ${orderNumber} (S/ ${total.toFixed(2)}) con Yape. ¿Me pasas el QR porfa? 🙌`
  const waLink = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(msg)}` : ''
  const cta = waLink
    ? `<div style="text-align:center;margin:26px 0 6px;">${boton('Coordinar pago por WhatsApp →', waLink)}</div>`
    : ''
  const inner = `
    <p style="color:#c9962f;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;margin:0 0 10px;">Pedido reservado · ${escapeHtml(orderNumber)}</p>
    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:23px;font-weight:800;color:${C.ink};margin:0 0 12px;line-height:1.25;">¡Reservamos tu pedido! 🟣</h1>
    <p style="font-size:14px;line-height:1.6;color:${C.text};margin:0 0 8px;">¡Hola <strong>${escapeHtml(customerName)}</strong>! Tu pedido <strong>${escapeHtml(orderNumber)}</strong> quedó reservado por un total de <strong>S/ ${total.toFixed(2)}</strong>.</p>
    <p style="font-size:14px;line-height:1.6;color:${C.text};margin:0 0 8px;">Para completarlo, <strong>escríbenos por WhatsApp</strong> y coordinamos el pago con Yape (te enviamos el QR). Apenas recibamos el pago, te confirmamos. 🙌</p>
    ${cta}`
  return wrap(inner)
}

// Correo de reclamo/ticket. Lo usa create-ticket:
//   • 'cliente': acuse de recibo cálido para quien envió el reclamo.
//   • 'tienda' : aviso interno con TODOS los datos para atenderlo.
// Reutiliza los bloques del resto de correos (wrap, eyebrow, boton, escapeHtml, C).
export function buildHtmlReclamo(
  t: {
    ticket_number: string
    name: string
    email: string
    phone?: string | null
    order_number?: string | null
    category?: string | null
    message: string
  },
  dest: 'cliente' | 'tienda',
): string {
  const esCliente = dest === 'cliente'

  // Bloque del mensaje (respeta los saltos de línea del cliente, ya escapados).
  const mensajeHtml = escapeHtml(t.message).replace(/\n/g, '<br/>')

  if (esCliente) {
    const resumen = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 4px;">
        <tr><td style="background:${C.bg};border-radius:12px;padding:16px 18px;font-family:Arial,Helvetica,sans-serif;">
          ${t.category ? `<p style="margin:0 0 8px;font-size:13px;color:${C.text};"><strong>Categoría:</strong> ${escapeHtml(t.category)}</p>` : ''}
          <p style="margin:0;font-size:13px;line-height:1.6;color:${C.text};"><strong>Tu mensaje:</strong><br/>${mensajeHtml}</p>
        </td></tr>
      </table>`

    const inner = `
      ${eyebrow('Reclamo recibido', t.ticket_number)}
      <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:800;color:${C.ink};margin:0 0 10px;line-height:1.2;">¡Recibimos tu reclamo! 🙌</h1>
      <p style="font-size:14px;line-height:1.6;color:${C.text};margin:0 0 8px;">Hola <strong>${escapeHtml(t.name)}</strong>, registramos tu reclamo <strong>${escapeHtml(t.ticket_number)}</strong>. Te responderemos lo antes posible por este correo.</p>
      ${resumen}
      <p style="font-size:13px;line-height:1.7;color:${C.muted};margin:20px 0 0;">Gracias por tu paciencia y por confiar en Hebennus. Estamos para ayudarte. 🧡</p>`

    return wrap(inner)
  }

  // ── Tienda: bloque con TODOS los datos del reclamo ──
  const fila = (label: string, value?: string | null): string =>
    value
      ? `<tr>
          <td valign="top" style="padding:8px 12px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${C.muted};white-space:nowrap;">${label}</td>
          <td valign="top" style="padding:8px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${C.text};">${escapeHtml(value)}</td>
        </tr>`
      : ''

  const datos = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0;border-top:1px solid ${C.border};">
      ${fila('Nombre', t.name)}
      ${fila('Email', t.email)}
      ${fila('Teléfono', t.phone)}
      ${fila('N° de pedido', t.order_number)}
      ${fila('Categoría', t.category)}
    </table>`

  const mensaje = `
    <h2 style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:${C.muted};margin:24px 0 8px;">Mensaje</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="background:${C.bg};border-radius:12px;padding:16px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${C.text};">${mensajeHtml}</td></tr>
    </table>`

  const inner = `
    ${eyebrow('Nuevo reclamo', t.ticket_number)}
    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:800;color:${C.ink};margin:0 0 10px;line-height:1.2;">Nuevo reclamo 📩</h1>
    <p style="font-size:14px;line-height:1.6;color:${C.text};margin:0 0 8px;"><strong>${escapeHtml(t.name)}</strong> envió un reclamo. Detalle abajo — responde a este correo para contactarlo.</p>
    ${datos}
    ${mensaje}`

  return wrap(inner)
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
