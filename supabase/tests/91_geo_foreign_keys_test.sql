-- ============================================================================
-- TEST · Cografi yabanci anahtarlar + para birimi/pazar ayrismasi (M2)
-- ----------------------------------------------------------------------------
-- Uc soru ayri ayri soruluyor:
--   A) Dort yabanci anahtar kuruldu mu ve GERCEKTEN tutuyor mu?
--   B) Para birimi pazardan gercekten AYRILDI mi?
--   C) Ayrisma korumayi TAMAMEN kaldirdi mi? (kaldirmamali)
--
-- (A) icin kisit varligina bakmak YETMEZ: bir FK'nin adi dogru olup yanlis
-- tabloyu isaret edebilir. Bu yuzden her biri POZITIF (gecerli deger kabul)
-- ve NEGATIF (uydurma deger reddedilir) olarak sinaniyor.
-- ============================================================================
\set ON_ERROR_STOP on

begin;
select plan(14);

-- --- Zemin: aday magaza (prospect + direct -> ana sayfa/MID kisitlarini
--     tetiklemez, 20260905100000) --------------------------------------------
insert into public.merchants (slug, display_name, network, status)
values ('m2-testi-magaza', 'M2 Testi Magaza', 'direct', 'prospect');

-- ---------------------------------------------------------------------------
-- A) YABANCI ANAHTARLAR
-- ---------------------------------------------------------------------------
select col_is_fk('public', 'merchants', 'country_code', '1) merchants.country_code FK');
select col_is_fk('public', 'vendors',   'country_code', '2) vendors.country_code FK');
select col_is_fk('public', 'products',  'currency',     '3) products.currency FK');
select col_is_fk('public', 'sources',   'currency',     '4) sources.currency FK');

-- POZITIF: gercek bir ulke kodu kabul edilir.
select lives_ok(
  $$ update public.merchants set country_code = 'GB' where slug = 'm2-testi-magaza' $$,
  '5) gercek ulke kodu (GB) kabul ediliyor'
);

-- NEGATIF: uydurma ulke kodu REDDEDILIR. Once bu mumkundu.
select throws_ok(
  $$ update public.merchants set country_code = 'XX' where slug = 'm2-testi-magaza' $$,
  '23503',
  null,
  '6) uydurma ulke kodu (XX) REDDEDILIYOR'
);

-- NULL hala serbest: aday magazanin ulkesi bilinmeyebilir.
select lives_ok(
  $$ update public.merchants set country_code = null where slug = 'm2-testi-magaza' $$,
  '7) bilinmeyen ulke NULL olarak birakilabiliyor'
);

-- NEGATIF: uydurma para birimi REDDEDILIR.
select throws_ok(
  $$ insert into public.products
       (fulfillment, merchant_id, external_id, title, price_cents, stock,
        product_url, market_code, currency, status)
     select 'affiliate', id, 'M2-COP', 'Cop Para Birimi', 1000, 5,
            'https://ornek.gecersiz/cop', 'TR', 'ZZZ', 'active'
       from public.merchants where slug = 'm2-testi-magaza' $$,
  '23503',
  null,
  '8) uydurma para birimi (ZZZ) REDDEDILIYOR'
);

-- ---------------------------------------------------------------------------
-- B) AYRISMA GERCEKTEN OLDU MU
-- ---------------------------------------------------------------------------
-- Kisit ADI degil TANIMI araniyor.
select is_empty(
  $$ select t.relname || '.' || c.conname
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname in ('sources', 'products')
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) like '%market_currency%' $$,
  '9) sources/products uzerinde market_currency cagiran CHECK KALMADI'
);

/*
 * AYRISMANIN ASIL KANITI.
 *
 * (market='DE', currency='TRY') eski `products_market_currency_uyumlu`
 * tarafindan REDDEDILIRDI. Artik kabul edilmeli -- bu iddia duserse
 * ayrisma yapilmamis demektir.
 */
select lives_ok(
  $$ insert into public.products
       (fulfillment, merchant_id, external_id, title, price_cents, stock,
        product_url, market_code, currency, status)
     select 'affiliate', id, 'M2-DE-TRY', 'Alman Pazari TRY Fiyat', 1000, 5,
            'https://ornek.gecersiz/de-try', 'EU', 'TRY', 'active'
       from public.merchants where slug = 'm2-testi-magaza' $$,
  '10) market ile currency ARTIK BAGIMSIZ: DE pazarinda TRY fiyat kabul ediliyor'
);

select lives_ok(
  $$ insert into public.sources
       (merchant_id, slug, name, kind, endpoint_url, market_code, currency)
     select id, 'm2-de-usd', 'DE Kaynak USD', 'feed_csv',
            'https://ornek.gecersiz/f.csv', 'EU', 'USD'
       from public.merchants where slug = 'm2-testi-magaza' $$,
  '11) kaynak tarafinda da pazar/para birimi bagimsiz'
);

-- ---------------------------------------------------------------------------
-- C) M4'UN ISI BURADA YAPILMADI
-- ---------------------------------------------------------------------------
/*
 * 12-13) M2 YAZILDIGINDA bu iki iddia enum'un ve market_currency()'nin HALA
 * YERINDE oldugunu olcuyordu -- cunku M2 onlari bilerek dokunmadan birakti
 * ve "dokunmadim" ifadesinin testi buydu. M4 ikisini de dusurdu.
 *
 * Iddialar silinmedi, yonu cevrildi: M2'nin garantisi "para birimi pazardan
 * AYRIK" idi; o garanti enum gittikten sonra da gecerli ve asagida hala
 * olculuyor (8-11). Buradaki ikisi artik daralmanin tamamlandigini
 * kanitliyor. Silinselerdi plan 14'ten 12'ye iner ve M4'un gercekten
 * calistigina dair bu dosyada hicbir iz kalmazdi.
 */
select hasnt_type('public', 'market', '12) public.market enum''u M4 ile dusuruldu');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'market_currency'),
  0,
  '13) market_currency() M4 ile dusuruldu -- curutulmus varsayim semada kalmadi'
);

-- Referans veri bozulmadi.
select is(
  (select count(*) from public.countries), 41::bigint,
  '14) referans veri bozulmadi (41 ulke)'
);

select * from finish();
rollback;
