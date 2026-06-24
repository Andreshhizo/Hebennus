-- ─────────────────────────────────────────────────────────────────────────────
-- Catálogo Hebennus — products + product_variants + RLS de lectura pública
--
-- Refleja el esquema que ya existía en producción (no estaba en migraciones).
-- IDEMPOTENTE: seguro de re-ejecutar; en prod no altera nada porque las tablas
-- ya existen. Permite recrear el catálogo en un entorno nuevo (ej. dev).
-- ─────────────────────────────────────────────────────────────────────────────

begin;

create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text unique,
  description  text,
  price        numeric(10,2) not null default 0,
  images       text[] not null default '{}',
  is_active    boolean not null default true,
  category     text,
  is_launch    boolean not null default false,
  launch_order int,
  tipo_prenda  text,
  created_at   timestamptz not null default now()
);

create table if not exists public.product_variants (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku        text,
  size       text,
  color      text,
  stock      int not null default 0
);

create index if not exists product_variants_product_id_idx on public.product_variants(product_id);

alter table public.products         enable row level security;
alter table public.product_variants enable row level security;

-- Lectura pública del catálogo: solo productos activos; variantes visibles.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='products' and policyname='products_public_read') then
    create policy products_public_read on public.products
      for select to anon, authenticated using (is_active = true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='product_variants' and policyname='product_variants_public_read') then
    create policy product_variants_public_read on public.product_variants
      for select to anon, authenticated using (true);
  end if;
end $$;

commit;
