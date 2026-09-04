-- ============================================================================
-- Feed kimlik doğrulama yöntemi
-- ----------------------------------------------------------------------------
-- Buradaki asıl iddia bir GÜVENLİK iddiasıdır: `auth_secret_ref` sütununa
-- sırrın KENDİSİ yazılamaz. Kod tarafındaki niyet ne olursa olsun,
-- veritabanı jetona benzeyen bir değeri reddeder.
-- ============================================================================

begin;
select plan(9);

-- --- Sütunlar ---------------------------------------------------------------

select has_column('public', 'sources', 'auth_type', 'sources.auth_type sutunu var');
select has_column('public', 'sources', 'auth_secret_ref', 'sources.auth_secret_ref sutunu var');

select col_type_is('public', 'sources', 'auth_type', 'source_auth_type',
  'auth_type enum -- serbest metin degil');

/*
 * VARSAYILAN MEVCUT DAVRANIŞ. Varsayilansiz birakmak, bugunku tek kaynak
 * bicimini yarin bir NOT NULL ihlaline cevirirdi.
 */
select col_default_is('public', 'sources', 'auth_type', 'query',
  'varsayilan query -- mevcut kaynaklar bozulmaz');

-- --- Sır sütuna sızamaz -----------------------------------------------------

/*
 * EN ÖNEMLİ İDDİA.
 *
 * Ortam degiskeni adlari buyuk harf/rakam/alt cizgidir; bir jeton (nokta,
 * tire, iki nokta, egik cizgi icerir) bu kalibi TUTMAZ. Yani "yanlislikla
 * jetonu yapistirdim" hatasi sessizce degil, yazma aninda ortaya cikar.
 *
 * KISIT ADI DA DOGRULANIYOR. Ilk yazilista yalnizca '23514' bekleniyordu
 * ve satir endpoint_url tasimadigi icin test BASKA bir kisittan
 * (sources_remote_needs_endpoint) geciyordu -- yani yanlis sebeple
 * yesildi. Satir artik her bakimdan gecerli; dusecegi tek yer sinanan
 * kisit.
 */
select throws_ok(
  $$ insert into public.sources
       (merchant_id, slug, name, kind, endpoint_url, currency, market,
        auth_type, auth_secret_ref)
     values (
       (select id from public.merchants limit 1),
       'auth-sizinti-testi', 'Test', 'feed_csv',
       'https://feed.ornek.test/export.csv', 'TRY', 'TR',
       'bearer', 'tk_ornek_9f4c2b7e51a08d63'
     ) $$,
  '23514',
  'new row for relation "sources" violates check constraint "sources_auth_secret_ref_is_env_name"',
  'jetona benzeyen deger auth_secret_ref sutununa YAZILAMAZ'
);

select lives_ok(
  $$ insert into public.sources
       (merchant_id, slug, name, kind, endpoint_url, currency, market,
        auth_type, auth_secret_ref)
     values (
       (select id from public.merchants limit 1),
       'auth-gecerli-testi', 'Test', 'feed_csv',
       'https://feed.ornek.test/export.csv', 'TRY', 'TR',
       'bearer', 'OHAAAA_FEED_TOKEN'
     ) $$,
  'ortam degiskeni ADI kabul edilir'
);

-- --- Başlık yöntemi kaynak adı olmadan açılamaz -----------------------------

/*
 * Aksi halde kaynak kimliksiz istek gonderir, 401 alir ve sebep "saglayici
 * reddetti" gibi gorunur -- oysa eksik olan yapilandirmadir.
 */
select throws_ok(
  $$ insert into public.sources
       (merchant_id, slug, name, kind, endpoint_url, currency, market,
        auth_type, auth_secret_ref)
     values (
       (select id from public.merchants limit 1),
       'auth-eksik-ref-testi', 'Test', 'feed_csv',
       'https://feed.ornek.test/export.csv', 'TRY', 'TR',
       'bearer', null
     ) $$,
  '23514',
  'new row for relation "sources" violates check constraint "sources_header_auth_needs_secret_ref"',
  'bearer secildiginde auth_secret_ref ZORUNLU'
);

select lives_ok(
  $$ insert into public.sources
       (merchant_id, slug, name, kind, endpoint_url, currency, market, auth_type)
     values (
       (select id from public.merchants limit 1),
       'auth-query-testi', 'Test', 'feed_csv',
       'https://feed.ornek.test/export.csv', 'TRY', 'TR', 'query'
     ) $$,
  'query yontemi auth_secret_ref olmadan calisir -- mevcut kaynaklar bozulmaz'
);

-- --- İstemciye kapalı -------------------------------------------------------

/*
 * `sources` zaten anon'a kapali; bu iddia yeni sutunlarin o kapiyi
 * acmadigini kilitliyor.
 */
select is(
  has_table_privilege('anon', 'public.sources', 'SELECT'),
  false,
  'sources istemciye kapali kalmaya devam ediyor'
);

select * from finish();
rollback;
