-- ============================================================================
-- Supabase Shim — yalnızca YEREL DOĞRULAMA / CI içindir.
-- ----------------------------------------------------------------------------
-- Gerçek bir Supabase projesinde `auth` şeması, rolleri ve auth.uid() zaten
-- vardır. Bu dosya migration'ların düz bir PostgreSQL 15/16 üzerinde de
-- çalıştırılıp doğrulanabilmesi için o ortamı asgari düzeyde taklit eder.
-- ASLA supabase/migrations/ altına konmamalıdır.
-- ============================================================================

create schema if not exists auth;

-- Supabase rolleri
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create table if not exists auth.users (
  id                   uuid primary key default gen_random_uuid(),
  email                text unique,
  encrypted_password   text,
  raw_user_meta_data   jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);

-- Supabase'in JWT yardımcıları: talepler (claims) oturum ayarından okunur.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', 'anon');
$$;

-- pgTAP: iddia testleri için (yalnızca yerel/CI).
create extension if not exists pgtap;

-- ---------------------------------------------------------------------------
-- SUPABASE'İN VARSAYILAN YETKİLERİ — burada olması ŞART.
-- ---------------------------------------------------------------------------
-- Supabase'in stok kurulumu bu satırı içerir ve `public` şemasında açılan
-- HER tabloyu anon/authenticated rollerine tam yetkiyle verir (TRUNCATE
-- dahil).
--
-- Bu satır shim'de yokken yerel ortam ÜRETİMDEN DAHA GÜVENLİYDİ: testler
-- hiçbir tabloda fazla yetki görmüyordu, çünkü yerelde o yetki hiç
-- verilmemişti. Yani yetki katmanını sınayan her test yerelde boşuna
-- geçiyor, üretimdeki gerçek durumu hiç ölçmüyordu.
--
-- Bir doğrulama ortamının üretimden güvenli olması, güvensiz olmasından
-- daha tehlikelidir: ikincisi gürültü yapar, birincisi susar.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

-- Gerçek Supabase'de bu izinler platform tarafından verilir.
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid(), auth.role()
  to anon, authenticated, service_role;
grant select on auth.users to service_role;
