-- ============================================================================
-- TEST · market_code sutunlari ve acik backfill eslemesi (M3)
-- ----------------------------------------------------------------------------
--   A) Sutunlar, yabanci anahtarlar ve indexler kuruldu mu?
--   B) BACKFILL ESLEMESI DOGRU MU -- ozellikle 'DE' -> 'EU'?
--   C) Kopru saglam mi: eski enum sutunlari HALA duruyor mu?
--
-- (B) bu gocun en riskli yeri. `market::text` ile korlemesine kopyalamak
-- 'DE' uretirdi; `markets` tablosunda 'DE' YOK. Bu yuzden eslemenin dogru
-- yonde calistigi GERCEK bir satirla sinaniyor, katalog kontroluyle degil.
-- ============================================================================
\set ON_ERROR_STOP on

begin;
select plan(15);

-- --- Zemin ----------------------------------------------------------------
insert into public.merchants (slug, display_name, network, status)
values ('m3-testi-magaza', 'M3 Testi Magaza', 'direct', 'prospect');

-- ---------------------------------------------------------------------------
-- A) SUTUNLAR / FK / INDEX
-- ---------------------------------------------------------------------------
select has_column('public', 'sources',  'market_code',  '1) sources.market_code');
select has_column('public', 'sources',  'country_code', '2) sources.country_code');
select has_column('public', 'products', 'market_code',  '3) products.market_code');
select has_column('public', 'jobs',     'market_code',  '4) jobs.market_code');

select col_is_fk('public', 'sources',  'market_code',  '5) sources.market_code FK');
select col_is_fk('public', 'sources',  'country_code', '6) sources.country_code FK');
select col_is_fk('public', 'products', 'market_code',  '7) products.market_code FK');

select has_index('public', 'products', 'products_market_code_status_idx',
  '8) products_market_code_status_idx var');

-- ---------------------------------------------------------------------------
-- B) ESLEME VE YABANCI ANAHTAR DAVRANISI
-- ---------------------------------------------------------------------------
/*
 * ALMANYA BIR PAZAR DEGIL.
 *
 * Eski enum'da 'DE' bir "pazar" degeriydi; yeni modelde Almanya EU
 * pazarinin bir ULKESI. `markets` tablosunda 'DE' satiri YOK ve olmamali.
 * Bu iddia duserse backfill eslemesi kimlik eslemesine dogru kaymis
 * demektir.
 */
select is_empty(
  $$ select code from public.markets where code = 'DE' $$,
  '9) markets tablosunda ''DE'' YOK -- Almanya EU''nun bir ulkesi'
);

select is(
  (select country_code from public.market_countries
    where market_code = 'EU' and country_code = 'DE'),
  'DE'::char(2),
  '10) Almanya EU pazarinin uyesi'
);

-- Gecerli bir pazar kodu kabul edilir.
select lives_ok(
  $$ insert into public.sources
       (merchant_id, slug, name, kind, endpoint_url, market, currency,
        market_code, country_code)
     select id, 'm3-eu-kaynak', 'EU Kaynak', 'feed_csv',
            'https://ornek.gecersiz/f.csv', 'DE', 'EUR', 'EU', 'DE'
       from public.merchants where slug = 'm3-testi-magaza' $$,
  '11) EU pazari + DE ulkesi olan kaynak acilabiliyor'
);

-- 'DE' bir PAZAR kodu olarak REDDEDILIR.
select throws_ok(
  $$ insert into public.sources
       (merchant_id, slug, name, kind, endpoint_url, market, currency, market_code)
     select id, 'm3-de-kaynak', 'DE Kaynak', 'feed_csv',
            'https://ornek.gecersiz/f2.csv', 'DE', 'EUR', 'DE'
       from public.merchants where slug = 'm3-testi-magaza' $$,
  '23503',
  null,
  '12) market_code = ''DE'' REDDEDILIYOR (boyle bir pazar yok)'
);

-- Pazar ve ulke BAGIMSIZ: EU pazarinda Ispanya kaynagi acilabilir.
select lives_ok(
  $$ insert into public.sources
       (merchant_id, slug, name, kind, endpoint_url, market, currency,
        market_code, country_code)
     select id, 'm3-es-kaynak', 'ES Kaynak', 'feed_csv',
            'https://ornek.gecersiz/f3.csv', 'DE', 'EUR', 'EU', 'ES'
       from public.merchants where slug = 'm3-testi-magaza' $$,
  '13) ayni EU pazarinda farkli ulke (ES) kaynagi acilabiliyor'
);

-- ---------------------------------------------------------------------------
-- C) KOPRU SAGLAM MI
-- ---------------------------------------------------------------------------
select has_column('public', 'products', 'market',
  '14) eski products.market sutunu HALA duruyor (geri donus yolu)');

select has_type('public', 'market',
  '15) public.market enum''u HALA duruyor (M4''un isi)');

select * from finish();
rollback;
