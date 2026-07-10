// ─── Subida de imágenes de producto a Supabase Storage ──────────────────────
// Bucket 'product-images' (público para lectura; escritura solo admin vía RLS).
// Se usa desde el panel /admin (AdminProducts.vue) al crear/editar productos.
//
// Las imágenes se COMPRIMEN en el navegador antes de subir (redimensiona a máx
// 1400px y recomprime a WebP ~0.82). Así las fotos quedan livianas en origen y
// cargan rápido, SIN depender de la transformación de imágenes de Supabase (que
// es de plan pago). Mantiene el costo en $0.
import { supabase } from './supabase.js'

const BUCKET    = 'product-images'
const MAX_BYTES = 5 * 1024 * 1024   // 5 MB (coincide con file_size_limit del bucket)
const TIPOS_OK  = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']
const MAX_DIM   = 1400               // lado máximo tras redimensionar
const QUALITY   = 0.82

// Redimensiona + recomprime a WebP en el navegador. Si algo falla (o es GIF),
// devuelve el archivo original. Nunca lanza.
async function comprimirImagen(file) {
  if (file.type === 'image/gif') return { blob: file, ext: 'gif' } // no romper animación
  try {
    const bitmap = await createImageBitmap(file)
    let { width, height } = bitmap
    if (Math.max(width, height) > MAX_DIM) {
      const scale = MAX_DIM / Math.max(width, height)
      width  = Math.round(width * scale)
      height = Math.round(height * scale)
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', QUALITY))
    if (blob && blob.size > 0 && blob.size < file.size) return { blob, ext: 'webp' }
  } catch (_) { /* cae al original */ }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  return { blob: file, ext }
}

// Sube un archivo de imagen (comprimido) y devuelve su URL pública.
// Lanza Error con mensaje claro si el archivo no es válido o la subida falla.
export async function subirImagenProducto(file) {
  if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) {
    throw new Error('Solo se permiten imágenes.')
  }
  if (!TIPOS_OK.includes(file.type)) {
    throw new Error('Formato no soportado. Usa JPG, PNG, WEBP, AVIF o GIF.')
  }
  if (file.size > MAX_BYTES) {
    throw new Error('La imagen supera 5 MB. Reduce su tamaño e intenta de nuevo.')
  }

  const { blob, ext } = await comprimirImagen(file)
  const path = `${crypto.randomUUID()}.${ext}`

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    cacheControl: '3600',
    upsert: false,
    contentType: blob.type || file.type,
  })
  if (error) throw error

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}
