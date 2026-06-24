-- ─────────────────────────────────────────────────────────────────────────────
-- Panel de Clientes (admin) — email en profiles + lectura admin de perfiles
--
-- NO se borran pedidos (integridad contable/SUNAT): se usan estados
-- (cancelado / reembolsado). Eliminar un usuario conserva sus pedidos
-- desvinculados (orders.user_id queda NULL por el FK on delete set null).
-- IDEMPOTENTE.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- 1) Guardar el correo en el perfil (para mostrarlo en el panel de clientes).
alter table public.profiles add column if not exists email text;

-- 2) Trigger actualizado: registra también el email al crear la cuenta.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do update set email = coalesce(public.profiles.email, excluded.email);
  return new;
end; $$;

-- 3) Backfill: completar el email de perfiles existentes desde auth.users.
update public.profiles p
set email = u.email
from auth.users u
where p.email is null and u.id = p.id;

-- 4) El admin puede leer TODOS los perfiles (para la vista Clientes).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='profiles' and policyname='profiles_admin_select') then
    create policy profiles_admin_select on public.profiles
      for select to authenticated using (public.is_admin());
  end if;
end $$;

commit;
