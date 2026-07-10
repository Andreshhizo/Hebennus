// ─── Subida de imágenes de producto a Supabase Storage ──────────────────────
// Bucket 'product-images' (público para lectura; escritura solo admin vía RLS).
// Se usa desde el panel /admin (AdminProducts.vue) al crear/editar productos.
import { supabase } from './supabase.js'

const BUCKET    = 'product-images'
const MAX_BYTES = 5 * 1024 * 1024   // 5 MB (coincide con file_size_limit del bucket)
const TIPOS_OK  = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']

// Sube un archivo de imagen y devuelve su URL pública.
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

  const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${crypto.randomUUID()}.${ext}`

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  })
  if (error) throw error

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}
