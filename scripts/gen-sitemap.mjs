// Generador dinámico de sitemap.xml en tiempo de build.
// Se ejecuta DESPUÉS de `vite build`, por lo que dist/ ya existe.
// Consulta los productos activos en Supabase y escribe dist/sitemap.xml
// con las rutas estáticas + una <url> por cada producto (usando su slug).
//
// IMPORTANTE: este script NUNCA debe romper el deploy. Ante cualquier error
// se limita a mostrar un aviso (console.warn) y termina con exit code 0.

import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const SITE = 'https://www.hebennus.com'

// Rutas estáticas del sitio: [ruta, changefreq, priority]
const RUTAS_ESTATICAS = [
  ['/', 'weekly', '1.0'],
  ['/coleccion', 'weekly', '0.9'],
  ['/lanzamientos', 'weekly', '0.7'],
  ['/nosotros', 'monthly', '0.5'],
  ['/privacidad', 'yearly', '0.3'],
]

// Escapa los caracteres reservados de XML (&, <, >).
function escaparXml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Construye un bloque <url> para una ruta estática.
function urlEstatica([ruta, changefreq, priority]) {
  return `  <url><loc>${SITE}${ruta}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`
}

// Construye un bloque <url> para un producto (con slug + lastmod).
function urlProducto(producto) {
  const slug = escaparXml(producto.slug)
  // lastmod en formato YYYY-MM-DD a partir de created_at.
  const lastmod = producto.created_at
    ? new Date(producto.created_at).toISOString().slice(0, 10)
    : null
  const bloqueLastmod = lastmod ? `<lastmod>${lastmod}</lastmod>` : ''
  return `  <url><loc>${SITE}/producto/${slug}</loc>${bloqueLastmod}<changefreq>weekly</changefreq><priority>0.8</priority></url>`
}

// Ensambla el documento XML completo a partir de las líneas <url>.
function construirXml(lineasUrl) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...lineasUrl,
    '</urlset>',
    '',
  ].join('\n')
}

async function main() {
  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY

  // Siempre incluimos las rutas estáticas.
  const lineas = RUTAS_ESTATICAS.map(urlEstatica)

  if (!url || !anonKey) {
    // Sin credenciales -> sitemap SOLO con rutas estáticas (no lanzamos error).
    console.warn(
      '[gen-sitemap] Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
        'Se genera un sitemap solo con rutas estáticas.'
    )
  } else {
    try {
      const supabase = createClient(url, anonKey)
      const { data, error } = await supabase
        .from('products')
        .select('slug, created_at')
        .eq('is_active', true)
        .not('slug', 'is', null)
        .order('created_at', { ascending: false })

      if (error) {
        console.warn(
          `[gen-sitemap] Error consultando productos en Supabase: ${error.message}. ` +
            'Se genera un sitemap solo con rutas estáticas.'
        )
      } else if (Array.isArray(data)) {
        for (const producto of data) {
          if (producto && producto.slug) {
            lineas.push(urlProducto(producto))
          }
        }
      }
    } catch (e) {
      console.warn(
        `[gen-sitemap] Fallo inesperado consultando Supabase: ${e?.message || e}. ` +
          'Se genera un sitemap solo con rutas estáticas.'
      )
    }
  }

  const xml = construirXml(lineas)
  // Resolvemos la ruta relativa al propio script (../dist/sitemap.xml).
  const destino = new URL('../dist/sitemap.xml', import.meta.url)

  try {
    writeFileSync(destino, xml, 'utf8')
    console.log(`[gen-sitemap] sitemap.xml generado con ${lineas.length} URLs.`)
  } catch (e) {
    // Normalmente ocurre solo si dist/ no existe (por ejemplo al correrlo en local
    // sin haber hecho antes `vite build`). El build real siempre crea dist/ primero.
    console.warn(
      `[gen-sitemap] No se pudo escribir dist/sitemap.xml: ${e?.message || e}. ` +
        'Asegúrate de ejecutar `vite build` antes.'
    )
  }
}

// Envolvemos TODO para que cualquier error termine en un aviso + exit(0)
// y así NUNCA se rompa el deploy.
main()
  .catch((e) => {
    console.warn(`[gen-sitemap] Error no controlado: ${e?.message || e}`)
  })
  .finally(() => {
    process.exit(0)
  })
