import { createClient } from '@supabase/supabase-js'

// ─── SEGURIDAD — leer antes de tocar este archivo ───────────────────────────
//
// VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY viven en el archivo .env
// (listado en .gitignore — nunca se sube al repositorio).
//
// La "anon key" (sb_publishable_…) es PÚBLICA por diseño:
//   • Solo permite las operaciones que autoricen las políticas RLS de Supabase.
//   • Actualmente: lectura del catálogo (products + product_variants) con is_active = true.
//   • Para que esto sea seguro, las políticas RLS DEBEN estar activas en Supabase.
//     Ve a: Table Editor → products → RLS → verifica que exista al menos una política
//     que permita SELECT para la tabla.
//   • Si desactivas RLS, la base de datos queda abierta para cualquiera que tenga la key.
//
// NUNCA incluyas la "service_role key" en código frontend. Esa clave
// bypasea RLS y daría acceso completo de escritura/borrado a cualquiera.
//
// ────────────────────────────────────────────────────────────────────────────

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
