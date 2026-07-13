// ─── Traductor de errores del admin a lenguaje claro + cómo arreglarlos ─────
// explicarError(raw) → { titulo, causa, solucion, detalle }
// Usado por AdminErrorModal para mostrar un pop-up entendible al administrador.

const REGLAS = [
  {
    test: (m) => m.includes('slug'),
    titulo: 'Falta el identificador del producto',
    causa: 'El producto no generó su “slug” (identificador único de la URL).',
    solucion: 'Ya se genera automáticamente al crear. Si vuelve a salir, recarga la página (Cmd/Ctrl+R) e intenta de nuevo.',
  },
  {
    test: (m) => m.includes('duplicate key') || m.includes('already exists') || m.includes('unique'),
    titulo: 'Ya existe un producto con ese dato',
    causa: 'Otro producto tiene un valor único repetido (por ejemplo el nombre/slug).',
    solucion: 'Cambia un poco el nombre del producto y vuelve a intentar.',
  },
  {
    test: (m) => m.includes('al menos una variante'),
    titulo: 'Falta una variante',
    causa: 'El producto necesita al menos una variante (talla).',
    solucion: 'En “Variantes”, agrega una fila con talla y stock antes de crear.',
  },
  {
    test: (m) => m.includes('cada variante debe tener talla') || (m.includes('variante') && m.includes('talla')),
    titulo: 'Una variante no tiene talla',
    causa: 'Hay una variante sin talla seleccionada.',
    solucion: 'Elige una talla en todas las variantes, o elimina las que estén vacías.',
  },
  {
    test: (m) => m.includes('no autorizado') || m.includes('not authorized') || m.includes('permission')
      || m.includes('rls') || m.includes('row-level') || m.includes('jwt') || m.includes('401'),
    titulo: 'Tu sesión no tiene permisos',
    causa: 'La sesión de administrador expiró o no tiene permisos para esta acción.',
    solucion: 'Pulsa “Salir”, vuelve a iniciar sesión como administrador y reintenta.',
  },
  {
    test: (m) => m.includes('nombre') && (m.includes('obligat') || m.includes('required')),
    titulo: 'Falta el nombre',
    causa: 'El producto no tiene nombre.',
    solucion: 'Escribe un nombre en el campo “Nombre”.',
  },
  {
    test: (m) => m.includes('negativo') || m.includes('precio') || m.includes('numeric') || m.includes('invalid input syntax for type numeric'),
    titulo: 'Precio inválido',
    causa: 'El precio no es un número válido.',
    solucion: 'Escribe el precio como número (ej. 49.90), sin símbolos ni comas.',
  },
  {
    test: (m) => m.includes('does not exist') || (m.includes('column') && m.includes('exist')),
    titulo: 'La base de datos está desactualizada',
    causa: 'Falta aplicar una actualización de la base de datos (una columna nueva).',
    solucion: 'Avísame para aplicar la migración pendiente; luego reintenta.',
  },
  {
    test: (m) => m.includes('failed to fetch') || m.includes('load failed') || m.includes('network')
      || m.includes('timeout') || m.includes('fetch'),
    titulo: 'Sin conexión con el servidor',
    causa: 'No se pudo contactar al servidor (internet o Supabase).',
    solucion: 'Revisa tu conexión a internet y vuelve a intentar en unos segundos.',
  },
  {
    test: (m) => m.includes('too large') || m.includes('exceed') || m.includes('mb')
      || m.includes('formato') || m.includes('image') || m.includes('imagen'),
    titulo: 'Problema con una imagen',
    causa: 'Una imagen pesa demasiado o su formato no es válido.',
    solucion: 'Usa imágenes JPG, PNG o WebP de menos de 5 MB y vuelve a subirla.',
  },
]

export function explicarError(raw) {
  const detalle = raw == null ? '' : (raw.message ? String(raw.message) : String(raw))
  const m = detalle.toLowerCase()
  const hit = REGLAS.find((r) => r.test(m))
  if (hit) return { titulo: hit.titulo, causa: hit.causa, solucion: hit.solucion, detalle }
  return {
    titulo: 'Ocurrió un error',
    causa: 'Algo salió mal al guardar los cambios.',
    solucion: 'Reintenta. Si el problema persiste, copia el detalle técnico de abajo y compártelo.',
    detalle,
  }
}
