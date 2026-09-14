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
select plan(17);

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
 * ALMANYA ARTIK HEM ULKE HEM PAZAR -- VE IKISI AYNI SEY DEGIL.
 *
 * Bu iddia once "markets tablosunda DE YOK" diyordu ve Avrupa'nin tek bir
 * EU pazari oldugu varsayimini kilitliyordu. Faz 1 ile her Avrupa ve
 * Korfez ulkesi kendi ticari pazarini aliyor (goc 20260914041000), cunku
 * tek pazar varsayimi Isvec'e euro, Korfez'in alti ulkesine tek bir para
 * birimi dayatiyordu.
 *
 * DEGISMEYEN AYRIM: `countries.DE` ulkedir, `markets.DE` pazardir. Ikisi
 * ayni kodu tasir ama ayni tablo degildir; cozumleme ulkeden pazara
 * `market_countries` uzerinden gecer.
 */
select isnt_empty(
  $$ select code from public.markets where code = 'DE' $$,
  '9) markets tablosunda ''DE'' VAR -- Almanya kendi pazari'
);

select is(
  (select default_currency from public.markets where code = 'DE'),
  'EUR',
  '9b) DE pazarinin para birimi ulkesinden turetildi'
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
       (merchant_id, slug, name, kind, endpoint_url, currency,
        market_code, country_code)
     select id, 'm3-eu-kaynak', 'EU Kaynak', 'feed_csv',
            'https://ornek.gecersiz/f.csv', 'EUR', 'EU', 'DE'
       from public.merchants where slug = 'm3-testi-magaza' $$,
  '11) EU pazari + DE ulkesi olan kaynak acilabiliyor'
);

/*
 * 'DE' ARTIK KABUL EDILIR (pazar oldu) ama UYDURMA kod hala REDDEDILIR.
 *
 * Korunan sey yabanci anahtarin kendisi: `markets` tablosunda olmayan bir
 * kod satira giremez. Testin amaci "DE yasak" degil, "bilinmeyen yasak".
 */
select lives_ok(
  $$ insert into public.sources
       (merchant_id, slug, name, kind, endpoint_url, currency, market_code)
     select id, 'm3-de-kaynak', 'DE Kaynak', 'feed_csv',
            'https://ornek.gecersiz/f2.csv', 'EUR', 'DE'
       from public.merchants where slug = 'm3-testi-magaza' $$,
  '12) market_code = ''DE'' KABUL EDILIYOR -- Almanya artik bir pazar'
);

select throws_ok(
  $$ insert into public.sources
       (merchant_id, slug, name, kind, endpoint_url, currency, market_code)
     select id, 'm3-uydurma-kaynak', 'Uydurma Kaynak', 'feed_csv',
            'https://ornek.gecersiz/f3.csv', 'EUR', 'YOKBOYLE'
       from public.merchants where slug = 'm3-testi-magaza' $$,
  '23503',
  null,
  '12b) UYDURMA market_code hala REDDEDILIYOR (yabanci anahtar koruyor)'
);

-- Pazar ve ulke BAGIMSIZ: EU pazarinda Ispanya kaynagi acilabilir.
select lives_ok(
  $$ insert into public.sources
       (merchant_id, slug, name, kind, endpoint_url, currency,
        market_code, country_code)
     select id, 'm3-es-kaynak', 'ES Kaynak', 'feed_csv',
            'https://ornek.gecersiz/f3.csv', 'EUR', 'EU', 'ES'
       from public.merchants where slug = 'm3-testi-magaza' $$,
  '13) ayni EU pazarinda farkli ulke (ES) kaynagi acilabiliyor'
);

-- ---------------------------------------------------------------------------
-- C) KOPRU SAGLAM MI
-- ---------------------------------------------------------------------------
/*
 * 14-15) M3 YAZILDIGINDA bu ikisi kopruunun ACIK oldugunu olcuyordu: kod
 * dagitimi ters giderse eski enum yoluna donulebilmeliydi ve "donulebilir"
 * ifadesinin testi buydu. Kod dagitildi, M4 kopruyu kaldirdi.
 *
 * Iddialar silinmedi, yonu cevrildi -- ve boylece dosya artik iki seyi
 * birden kanitliyor: M3'un ekledigi sutunlar duruyor (1-13) VE M3'un
 * bilerek birakti eski yol kapandi (14-15).
 */
select hasnt_column('public', 'products', 'market',
  '14) eski products.market sutunu M4 ile dusuruldu');

select hasnt_type('public', 'market',
  '15) public.market enum''u M4 ile dusuruldu');

select * from finish();
rollback;
