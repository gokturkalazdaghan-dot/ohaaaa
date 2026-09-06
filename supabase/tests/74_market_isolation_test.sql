-- ============================================================================
-- Pazar izolasyonu: teklif hangi pazara ait?
-- ----------------------------------------------------------------------------
-- 20260907110000 (M2) ile PARA BIRIMI PAZARDAN AYRILDI. Bu dosyanin 5. ve 7.
-- iddialari eskiden `..._market_currency_uyumlu` kisitinin uyumsuz satiri
-- REDDETTIGINI sinardi; o kisit artik yok, dolayisiyla iddialar yeni
-- sozlesmeyi sinayacak sekilde TERS CEVRILDI: uyumsuz kombinasyon artik
-- KABUL EDILMELI.
--
-- Iddia SILINMEDI, devre disi da birakilmadi -- yon degistirdi. Silinseydi
-- ayrismanin gerceklestigini hicbir sey kanitlamazdi.
--
-- Uydurma para birimi REDDI kaybolmadi, YER DEGISTIRDI: artik currencies
-- tablosuna yabanci anahtarla saglaniyor (91_geo_foreign_keys_test, iddia 8).
--
-- Dosyanin ASIL konusu -- iki pazarin tekliflerinin birbirine karismamasi --
-- 8. ve 9. iddialarda AYNEN duruyor. Ayrisma o garantiyi kaldirmadi:
-- karsilastirilabilirlik artik semanin degil arama katmaninin isi.
-- ============================================================================
begin;
select plan(9);

-- --- Zemin ----------------------------------------------------------------
insert into public.merchants
  (slug, display_name, homepage_url, network, status, deeplink_template, country_code, terms_verified_at)
values
  ('tr-magaza', 'TR Magaza', 'https://tr.gecersiz', 'direct', 'active',
   'https://tr.gecersiz/g?u={url}', 'TR', now()),
  ('de-magaza', 'DE Magaza', 'https://de.gecersiz', 'direct', 'active',
   'https://de.gecersiz/g?u={url}', 'DE', now());

-- --- 1) Pazar → para birimi eşlemesi ARTIK YOK ----------------------------
--
-- Bu üç iddia eskiden `market_currency()`'nin TR→TRY, DE→EUR, US→USD
-- döndürdüğünü ölçüyordu. M4 o fonksiyonu düşürdü; iddialar silinmedi,
-- YÖNÜ ÇEVRİLDİ: artık eşlemenin var olmadığını ve VAR OLAMAYACAĞINI
-- kanıtlıyorlar. Silinseydi plan 9'dan 6'ya inerdi ve modelin en pahalı
-- kararı testsiz kalırdı.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'market_currency'),
  0,
  'market_currency() yok -- pazardan para birimi turetilemez'
);

-- Çok para birimli bir pazarın varsayılanı UYDURULMAZ, NULL bırakılır.
select is(
  (select default_currency from public.markets where code = 'NORDICS'),
  null::char(3),
  'NORDICS varsayilan para birimi tasimaz'
);

-- Ve sebebi ölçülebilir: beş ülke, birden çok para birimi.
select cmp_ok(
  (select count(distinct c.default_currency)::int
     from public.market_countries mc
     join public.countries c on c.code = mc.country_code
    where mc.market_code = 'NORDICS'),
  '>', 1,
  'NORDICS birden cok para birimi tasiyor -- tek esleme imkansiz'
);

-- --- 2) Mevcut satırlar bozulmadı -----------------------------------------
-- Migration'dan sonra eski kaynaklarin hepsi TR pazarinda olmali; aksi hâlde
-- gecmis veri "pazarsiz" kalirdi.
select is(
  (select count(*) from public.sources where market_code is null),
  0::bigint,
  'pazari olmayan kaynak yok'
);

-- --- 3) Uyumsuz para birimi ARTIK KABUL EDİLİR ----------------------------
/*
 * ESKIDEN: bu insert `sources_market_currency_uyumlu` ile reddedilirdi.
 * ARTIK: kabul edilmeli. Almanya'daki bir satici TRY ile fiyat verebilir;
 * "bir pazar = bir para birimi" varsayimi global olcekte yanlisti (NORDICS
 * bes ulkede dort para birimi, GCC alti ulkede alti para birimi tasiyor).
 */
select lives_ok(
  $$ insert into public.sources
       (merchant_id, slug, name, kind, endpoint_url, market_code, currency)
     select id, 'uyumsuz', 'Pazardan Farkli Para Birimi', 'feed_csv',
            'https://x.gecersiz/f.csv', 'EU', 'TRY'
       from public.merchants where slug = 'de-magaza' $$,
  'EU pazarinda TRY fiyatli kaynak ARTIK kabul ediliyor (para birimi pazardan ayri)'
);

insert into public.sources
  (merchant_id, slug, name, kind, endpoint_url, market_code, currency)
select id, 'de-feed', 'DE Feed', 'feed_csv', 'https://de.gecersiz/f.csv', 'EU', 'EUR'
  from public.merchants where slug = 'de-magaza';

select ok(
  exists (select 1 from public.sources where slug = 'de-feed' and market_code = 'EU'),
  'uyumlu kaynak kabul edildi'
);

-- --- 4) Teklif düzeyinde de aynı kural ------------------------------------
/*
 * Satir para birimi DISINDA her yonuyle gecerli olmali.
 *
 * Ilk yazilisinda `fulfillment` ve `product_url` eksikti; insert
 * `products_ownership_exclusive` yuzunden patliyordu. Ikisi de 23514
 * (check_violation) urettigi icin test GECIYOR ama IDDIA ETTIGI SEYI
 * SINAMIYORDU -- pazar/para birimi kisiti hic devreye girmemisti bile.
 * Bu yuzden hata KODU degil, kisit ADI dogrulaniyor.
 */
select lives_ok(
  $$ insert into public.products
       (merchant_id, external_id, title, price_cents, currency, market_code,
        status, fulfillment, product_url)
     select id, 'X1', 'Pazardan Farkli Para Birimi', 1000, 'TRY', 'US', 'active',
            'affiliate', 'https://de.gecersiz/u/x1'
       from public.merchants where slug = 'de-magaza' $$,
  'US pazarinda TRY fiyatli teklif ARTIK kabul ediliyor (para birimi pazardan ayri)'
);

-- --- 5) İki pazarın teklifleri BİRBİRİNE KARIŞMAZ -------------------------
insert into public.products
  (merchant_id, external_id, title, price_cents, currency, market_code, status,
   fulfillment, product_url)
select id, 'TR1', 'Ayni Urun', 100000, 'TRY', 'TR', 'active',
       'affiliate', 'https://tr.gecersiz/u/tr1'
  from public.merchants where slug = 'tr-magaza';

insert into public.products
  (merchant_id, external_id, title, price_cents, currency, market_code, status,
   fulfillment, product_url)
select id, 'DE1', 'Ayni Urun', 3000, 'EUR', 'EU', 'active',
       'affiliate', 'https://de.gecersiz/u/de1'
  from public.merchants where slug = 'de-magaza';

-- Sayim testin KENDI satirlariyla sinirli: seed verisi de TR teklifleri
-- iceriyor ve global sayim testi seed'in buyuklugune bagimli kilardi.
select is(
  (select count(*) from public.products
    where market_code = 'TR' and external_id in ('TR1', 'DE1')),
  1::bigint,
  'TR pazarinda yalnizca TR teklifi gorunuyor'
);

/*
 * BU İDDİA HATANIN TA KENDİSİNİ SINAR.
 *
 * Pazar alanı olmasaydı iki teklif de aynı listede yan yana gelirdi ve
 * 30 EUR'luk Alman teklifi, 1.000 TL'lik Türk teklifinin yanında "daha
 * ucuz" görünürdü -- sayı olarak 3000 < 100000. Kullanıcıya kendisine
 * hiç gönderilmeyecek bir teklifi en iyi seçenek diye göstermek,
 * karşılaştırmanın kendisini anlamsızlaştırır.
 */
select is(
  (select count(*) from public.products
    where market_code = 'EU' and external_id in ('TR1', 'DE1')),
  1::bigint,
  'EU teklifi TR listesine sizmiyor'
);

select * from finish();
rollback;
