-- Pazar izolasyonu: teklif hangi pazara ait ve para birimiyle uyumlu mu?
begin;
select plan(9);

-- --- Zemin ----------------------------------------------------------------
insert into public.merchants
  (slug, display_name, homepage_url, network, status, deeplink_template, country_code)
values
  ('tr-magaza', 'TR Magaza', 'https://tr.gecersiz', 'manual', 'active',
   'https://tr.gecersiz/g?u={url}', 'TR'),
  ('de-magaza', 'DE Magaza', 'https://de.gecersiz', 'manual', 'active',
   'https://de.gecersiz/g?u={url}', 'DE');

-- --- 1) Pazar → para birimi eşlemesi --------------------------------------
select is(public.market_currency('TR'), 'TRY'::char(3), 'TR pazari TRY kullanir');
select is(public.market_currency('DE'), 'EUR'::char(3), 'DE pazari EUR kullanir');
select is(public.market_currency('US'), 'USD'::char(3), 'US pazari USD kullanir');

-- --- 2) Mevcut satırlar bozulmadı -----------------------------------------
-- Migration'dan sonra eski kaynaklarin hepsi TR pazarinda olmali; aksi hâlde
-- gecmis veri "pazarsiz" kalirdi.
select is(
  (select count(*) from public.sources where market is null),
  0::bigint,
  'pazari olmayan kaynak yok'
);

-- --- 3) Uyumsuz para birimi REDDEDİLİR ------------------------------------
select throws_ok(
  $$ insert into public.sources
       (merchant_id, slug, name, kind, endpoint_url, market, currency)
     select id, 'uyumsuz', 'Uyumsuz', 'feed_csv', 'https://x.gecersiz/f.csv',
            'DE', 'TRY'
       from public.merchants where slug = 'de-magaza' $$,
  '23514',
  'new row for relation "sources" violates check constraint "sources_market_currency_uyumlu"',
  'Alman pazarinda TRY fiyatli kaynak tam da pazar/para birimi kisitiyla engelleniyor'
);

insert into public.sources
  (merchant_id, slug, name, kind, endpoint_url, market, currency)
select id, 'de-feed', 'DE Feed', 'feed_csv', 'https://de.gecersiz/f.csv', 'DE', 'EUR'
  from public.merchants where slug = 'de-magaza';

select ok(
  exists (select 1 from public.sources where slug = 'de-feed' and market = 'DE'),
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
select throws_ok(
  $$ insert into public.products
       (merchant_id, external_id, title, price_cents, currency, market,
        status, fulfillment, product_url)
     select id, 'X1', 'Uyumsuz Urun', 1000, 'TRY', 'US', 'active',
            'affiliate', 'https://de.gecersiz/u/x1'
       from public.merchants where slug = 'de-magaza' $$,
  '23514',
  'new row for relation "products" violates check constraint "products_market_currency_uyumlu"',
  'ABD pazarinda TRY fiyatli teklif tam da pazar/para birimi kisitiyla engelleniyor'
);

-- --- 5) İki pazarın teklifleri BİRBİRİNE KARIŞMAZ -------------------------
insert into public.products
  (merchant_id, external_id, title, price_cents, currency, market, status,
   fulfillment, product_url)
select id, 'TR1', 'Ayni Urun', 100000, 'TRY', 'TR', 'active',
       'affiliate', 'https://tr.gecersiz/u/tr1'
  from public.merchants where slug = 'tr-magaza';

insert into public.products
  (merchant_id, external_id, title, price_cents, currency, market, status,
   fulfillment, product_url)
select id, 'DE1', 'Ayni Urun', 3000, 'EUR', 'DE', 'active',
       'affiliate', 'https://de.gecersiz/u/de1'
  from public.merchants where slug = 'de-magaza';

-- Sayim testin KENDI satirlariyla sinirli: seed verisi de TR teklifleri
-- iceriyor ve global sayim testi seed'in buyuklugune bagimli kilardi.
select is(
  (select count(*) from public.products
    where market = 'TR' and external_id in ('TR1', 'DE1')),
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
    where market = 'DE' and external_id in ('TR1', 'DE1')),
  1::bigint,
  'DE teklifi TR listesine sizmiyor'
);

select * from finish();
rollback;
