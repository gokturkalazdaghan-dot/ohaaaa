-- tg_payouts_touch: search_path sabit mi ve damga hâlâ çalışıyor mu?
begin;
select plan(4);

-- --- 1) search_path gerçekten sabitlenmiş mi -------------------------------
select isnt(
  (select proconfig from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tg_payouts_touch'),
  null,
  'tg_payouts_touch bir search_path yapilandirmasi tasir'
);

-- Postgres degeri tirnaklayarak saklar: {"search_path=\"\""}. Tam esitlik
-- yerine "search_path= ile basliyor ve icinde bos string var" araniyor.
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace,
           unnest(p.proconfig) as cfg
     where n.nspname = 'public'
       and p.proname = 'tg_payouts_touch'
       and cfg like 'search_path=%'
       and replace(split_part(cfg, '=', 2), '"', '') = ''
  ),
  'search_path bos string olarak sabitlenmis'
);

-- --- 2) DAVRANIS DEGISMEDI -------------------------------------------------
-- Guvenlik duzeltmesi islevi bozarsa duzeltme degil regresyondur.
-- Aktif magaza sema geregi bir yonlendirme sablonu ister
-- (merchants_active_needs_template).
insert into public.merchants
  (slug, display_name, homepage_url, network, status, deeplink_template)
values
  ('kanit-magaza', 'Kanit Magaza', 'https://ornek.gecersiz', 'manual', 'active',
   'https://ornek.gecersiz/git?u={url}');

insert into public.payouts (merchant_id, period_start, period_end, currency, expected_cents)
select id, date '2026-01-01', date '2026-01-31', 'TRY', 1000
  from public.merchants where slug = 'kanit-magaza';

-- updated_at'i geriye cekip tetikleyicinin onu ileri tasidigini gorelim.
update public.payouts set updated_at = timestamptz '2000-01-01 00:00:00+00';

update public.payouts set expected_cents = 2000;

select ok(
  (select updated_at from public.payouts) > timestamptz '2020-01-01 00:00:00+00',
  'tetikleyici updated_at damgasini guncelledi'
);

select is(
  (select expected_cents from public.payouts),
  2000::bigint,
  'tetikleyici satirin kendisini bozmadi'
);

select * from finish();
rollback;
