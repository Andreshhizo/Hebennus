// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: admin-delete-user
// Borra una cuenta de usuario de forma SEGURA. Solo un admin puede llamarla.
//   1) Verifica el JWT del que llama → debe estar en la tabla `admins`.
//   2) Borra la cuenta con la service_role (auth.admin.deleteUser).
// Los pedidos del usuario NO se borran: quedan con user_id = NULL (FK on delete
// set null) para conservar el registro contable.
//
// Deploy: supabase functions deploy admin-delete-user
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  let body: { user_id?: string }
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }
  const targetId = body?.user_id
  if (!targetId) return json({ error: 'Falta user_id' }, 400)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  // 1) ¿Quién llama? (su JWT)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: caller } = await admin.auth.getUser(jwt)
  if (!caller?.user) return json({ error: 'No autenticado' }, 401)

  // 2) ¿El que llama es admin? (consulta directa con service_role)
  const { data: adminRow } = await admin
    .from('admins').select('user_id').eq('user_id', caller.user.id).maybeSingle()
  if (!adminRow) return json({ error: 'No autorizado: solo admins' }, 403)

  // 3) No permitir auto-borrado.
  if (caller.user.id === targetId) return json({ error: 'No puedes eliminar tu propia cuenta de admin' }, 400)

  // 4) Borrar la cuenta (los pedidos quedan desvinculados, no se borran).
  const { error } = await admin.auth.admin.deleteUser(targetId)
  if (error) return json({ error: 'No se pudo eliminar el usuario', detail: error.message }, 500)

  return json({ ok: true, deleted: targetId })
})
