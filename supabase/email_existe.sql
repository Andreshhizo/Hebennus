-- Función usada por la edge function check-email para saber si un correo ya está
-- registrado (auth.users). SECURITY DEFINER + search_path vacío (todo cualificado).
-- Solo la puede ejecutar service_role (la edge function); NUNCA anon/authenticated,
-- para no exponer un endpoint de enumeración directo desde el navegador.

create or replace function public.email_existe(p_email text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  -- Solo cuentas CONFIRMADAS: una cuenta sin confirmar no puede iniciar sesión,
  -- así que para "recuperar contraseña" se trata como si no existiera.
  select exists(
    select 1 from auth.users
    where lower(email) = lower(trim(p_email))
      and email_confirmed_at is not null
  );
$$;

revoke all on function public.email_existe(text) from public;
revoke all on function public.email_existe(text) from anon;
revoke all on function public.email_existe(text) from authenticated;
grant execute on function public.email_existe(text) to service_role;
