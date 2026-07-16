// Vercel Edge Function: previews Open Graph por producto para /producto/<slug>
// Los bots (WhatsApp, facebookexternalhit, Twitterbot, etc.) NO ejecutan JS,
// así que solo ven el index.html estático. Aquí interceptamos la ruta,
// consultamos el producto en Supabase e inyectamos los meta tags correctos
// dentro del mismo shell HTML que ya sirve la SPA.
//
// Sin dependencias npm: solo Web APIs (fetch, URL, AbortController).

export const config = { runtime: 'edge' };

// --- Constantes ---
const SITE = 'https://www.hebennus.com';
const SB_URL = process.env.VITE_SUPABASE_URL || 'https://lvodqgscealzkjywhyas.supabase.co';
const SB_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_ieemdj1csnQqzzP2UMcmfA_4FyXeNCo';
const DEF_IMG = `${SITE}/logo.jpeg`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// El index.html construido solo cambia por deploy: lo cacheamos a nivel de módulo.
let cachedIndex;

// --- Helpers ---

// Escapa los caracteres peligrosos para atributos/HTML. El & va primero.
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Colapsa espacios, recorta y trunca a n caracteres con "…".
function clean(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1).trimEnd() + '…';
}

// Reemplaza usando función para evitar que los "$" del texto se interpreten
// como patrones especiales de String.prototype.replace ($&, $1, etc.).
function setTag(html, re, replacement) {
  return html.replace(re, () => replacement);
}

// Respuesta HTML con headers de cache según sea producto (300s) o fallback (60s).
function htmlResponse(body, sMaxAge) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=86400`,
    },
  });
}

// HTML mínimo de respaldo si no logramos leer el shell (nunca lanza / nunca 500).
function minimalFallback() {
  return `<!doctype html><html lang="es"><head><meta charset="UTF-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    `<title>Hebennus</title>` +
    `<meta name="description" content="Ropa oversize, atlética y cómoda. Lima, Perú. Make it real, Make it with Hebennus." />` +
    `<meta property="og:site_name" content="Hebennus" />` +
    `<meta property="og:title" content="Hebennus — Make it Real" />` +
    `<meta property="og:description" content="Make it real, Make it with Hebennus. Oversize · Atlético · Cómodo." />` +
    `<meta property="og:type" content="website" />` +
    `<meta property="og:url" content="${SITE}/" />` +
    `<meta property="og:image" content="${DEF_IMG}" />` +
    `<meta name="twitter:card" content="summary_large_image" />` +
    `</head><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>`;
}

// Consulta el producto en Supabase REST. Nunca lanza: ante cualquier error → null.
async function fetchProduct(slug) {
  if (!slug) return null;
  const enc = encodeURIComponent(slug);
  const headers = {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    Accept: 'application/json',
  };
  const cols = 'select=name,description,price,slug,card_images,images&limit=1';

  const query = async (filter) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/products?${filter}&is_active=eq.true&${cols}`,
        { headers, signal: ctrl.signal }
      );
      if (!res.ok) return null;
      const rows = await res.json();
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  // 1) Por slug.
  let p = await query(`slug=eq.${enc}`);
  // 2) Si no hay filas y el slug parece UUID, reintentar por id
  //    (guardamos con UUID_RE para no provocar un 400 de PostgREST).
  if (!p && UUID_RE.test(slug)) {
    p = await query(`id=eq.${enc}`);
  }
  return p;
}

// --- Handler ---
export default async function handler(req) {
  const url = new URL(req.url);
  let slug = url.searchParams.get('slug') || '';
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // slug mal codificado: lo dejamos tal cual.
  }
  slug = slug.trim();

  // Obtener el shell HTML (index.html estático). El rewrite no captura
  // /index.html, así que este fetch no provoca recursión.
  if (!cachedIndex) {
    try {
      cachedIndex = await (await fetch(`${url.origin}/index.html`)).text();
    } catch {
      cachedIndex = null;
    }
  }
  const shell = cachedIndex;

  // Buscar el producto (nunca lanza).
  let product = null;
  try {
    product = await fetchProduct(slug);
  } catch {
    product = null;
  }

  // Sin shell → respaldo mínimo (200, cache corto).
  if (!shell) {
    return htmlResponse(minimalFallback(), 60);
  }

  // Shell pero sin producto → devolver el shell tal cual (200, cache corto).
  if (!product) {
    return htmlResponse(shell, 60);
  }

  // --- Producto encontrado: calcular valores ---
  const p = product;
  const title = `${clean(p.name, 60)} — Hebennus`;
  const desc = clean(
    p.description || `${p.name} — Hebennus. Oversize, atlético y cómodo.`,
    200
  );
  const img = (p.card_images && p.card_images[0]) || (p.images && p.images[0]) || DEF_IMG;
  const canon = `${SITE}/producto/${p.slug || slug}`;
  const price = Number(p.price ?? 0).toFixed(2);

  // Valores escapados para inyectar en atributos HTML.
  const eTitle = esc(title);
  const eDesc = esc(desc);
  const eImg = esc(img);
  const eCanon = esc(canon);

  // --- Inyección: REEMPLAZAR los tags existentes (por atributo identificador,
  // para sobrevivir a futuros cambios), NO agregar duplicados. ---
  let html = shell;
  html = setTag(html, /<title>[\s\S]*?<\/title>/i, `<title>${eTitle}</title>`);
  html = setTag(
    html,
    /<meta\s+name="description"[^>]*>/i,
    `<meta name="description" content="${eDesc}" />`
  );
  html = setTag(
    html,
    /<meta\s+property="og:title"[^>]*>/i,
    `<meta property="og:title" content="${eTitle}" />`
  );
  html = setTag(
    html,
    /<meta\s+property="og:description"[^>]*>/i,
    `<meta property="og:description" content="${eDesc}" />`
  );
  html = setTag(
    html,
    /<meta\s+property="og:image"[^>]*>/i,
    `<meta property="og:image" content="${eImg}" />`
  );
  html = setTag(
    html,
    /<meta\s+property="og:url"[^>]*>/i,
    `<meta property="og:url" content="${eCanon}" />`
  );
  html = setTag(
    html,
    /<meta\s+property="og:type"[^>]*>/i,
    `<meta property="og:type" content="product" />`
  );
  html = setTag(
    html,
    /<link\s+rel="canonical"[^>]*>/i,
    `<link rel="canonical" href="${eCanon}" />`
  );
  html = setTag(
    html,
    /<meta\s+name="twitter:title"[^>]*>/i,
    `<meta name="twitter:title" content="${eTitle}" />`
  );
  html = setTag(
    html,
    /<meta\s+name="twitter:description"[^>]*>/i,
    `<meta name="twitter:description" content="${eDesc}" />`
  );
  html = setTag(
    html,
    /<meta\s+name="twitter:image"[^>]*>/i,
    `<meta name="twitter:image" content="${eImg}" />`
  );

  // Metas adicionales antes de </head> (no existen en el shell).
  const extra =
    `<meta property="og:image:alt" content="${eTitle}" />` +
    `<meta property="product:price:amount" content="${price}" />` +
    `<meta property="product:price:currency" content="PEN" />`;
  html = setTag(html, /<\/head>/i, `${extra}</head>`);

  return htmlResponse(html, 300);
}
