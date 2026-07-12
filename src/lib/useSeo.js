// ─── SEO por página (title/description/OG/Twitter/canonical) ────────────────
// Uso: useSeo({ title, description, image, path, type })  — todo opcional.
// Acepta valores estáticos o refs/getters (se resuelven reactivamente para páginas
// como la ficha de producto, cuyo contenido llega tras el fetch).
import { computed, unref } from 'vue'
import { useSeoMeta, useHead } from '@unhead/vue'

const SITE   = 'https://www.hebennus.com'
const MARCA  = 'Hebennus'
const DEFT   = 'Ropa oversize, atlética y cómoda. Lima, Perú. Make it real, Make it with Hebennus.'
const DEFIMG = `${SITE}/logo.jpeg`

const g = (v) => (typeof v === 'function' ? v() : unref(v))

export function useSeo(opts = {}) {
  const title = computed(() => {
    const t = g(opts.title)
    return t ? `${t} — ${MARCA}` : `${MARCA} — Make it Real`
  })
  const description = computed(() => g(opts.description) || DEFT)
  const image = computed(() => g(opts.image) || DEFIMG)
  const url = computed(() => {
    const p = g(opts.path)
    return p ? `${SITE}${p}` : SITE
  })
  const robots = computed(() => (g(opts.noindex) ? 'noindex,follow' : 'index,follow'))

  useSeoMeta({
    title,
    description,
    ogTitle: title,
    ogDescription: description,
    ogType: () => g(opts.type) || 'website',
    ogUrl: url,
    ogImage: image,
    ogSiteName: MARCA,
    ogLocale: 'es_PE',
    twitterCard: 'summary_large_image',
    twitterTitle: title,
    twitterDescription: description,
    twitterImage: image,
    robots,
  })

  // Canonical por ruta (sobre-escribe el global del index.html).
  useHead({
    link: [{ rel: 'canonical', href: url }],
  })
}

export const SITE_URL = SITE
