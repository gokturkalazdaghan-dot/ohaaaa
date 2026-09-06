-- ============================================================================
-- TEST · Cografi referans verisi (M1)
-- ----------------------------------------------------------------------------
-- `20260907100000_reference_data_geo.sql` gocunun NE GARANTI ETTIGINI kanitlar.
--
-- Dort soru ayri ayri soruluyor:
--   A) Tablolar ve iliskiler dogru kuruldu mu?
--   B) Tohum verisi eksiksiz ve DOGRU mu? (ozellikle para yolu: minor_unit)
--   C) Dort eksen gercekten BAGIMSIZ mi?
--   D) Yeni ulke/para birimi/dil eklemek KOD DEGISIKLIGI gerektirmiyor mu?
--
-- (D) bu modelin varlik sebebidir ve bir iddiayla sinanabilir: testin
-- icinde yeni bir ulke ve para birimi ACILIR; hicbir sema degisikligi
-- olmadan calismasi gerekir.
-- ============================================================================
\set ON_ERROR_STOP on

begin;
select plan(24);

-- ---------------------------------------------------------------------------
-- A) TABLOLAR VE ILISKILER
-- ---------------------------------------------------------------------------
select has_table('public', 'currencies',       '1) currencies tablosu var');
select has_table('public', 'locales',          '2) locales tablosu var');
select has_table('public', 'countries',        '3) countries tablosu var');
select has_table('public', 'markets',          '4) markets tablosu var');
select has_table('public', 'market_countries', '5) market_countries tablosu var');

select col_is_fk('public', 'countries', 'default_currency',
  '6) countries.default_currency yabanci anahtar');
select col_is_fk('public', 'countries', 'default_locale',
  '7) countries.default_locale yabanci anahtar');

-- Pazar dil TASIMAZ: EU 27 ulke ve ~23 dil demek; tek dile zorlamak
-- modelin cozmeye calistigi hatanin kendisiydi.
select hasnt_column('public', 'markets', 'default_locale',
  '8) markets.default_locale YOK -- dil ulke uzerindedir');

-- ---------------------------------------------------------------------------
-- B) TOHUM VERISI
-- ---------------------------------------------------------------------------
select is((select count(*) from public.currencies),       21::bigint, '9) 21 para birimi');
select is((select count(*) from public.locales),          27::bigint, '10) 27 dil');
select is((select count(*) from public.countries),        41::bigint, '11) 41 ulke');
select is((select count(*) from public.markets),           8::bigint, '12) 8 pazar');
select is((select count(*) from public.market_countries), 44::bigint, '13) 44 uyelik');

select is(
  (select count(*) from public.market_countries where market_code = 'EU'),
  27::bigint,
  '14) EU tam olarak 27 ulke'
);

select is(
  (select string_agg(country_code, ',' order by country_code)
     from public.market_countries where market_code = 'NORDICS'),
  'DK,FI,IS,NO,SE',
  '15) NORDICS = DK,FI,IS,NO,SE'
);

select is(
  (select string_agg(country_code, ',' order by country_code)
     from public.market_countries where market_code = 'GCC'),
  'AE,BH,KW,OM,QA,SA',
  '16) GCC = alti Korfez ulkesi'
);

/*
 * PARA YOLU. Bu iddia bir bicim kontrolu degil.
 *
 * minor_unit yanlissa hata SESSIZDIR: yanlis tutar da gecerli bir tam
 * sayidir. KWD/BHD/OMR uc haneli -- iki varsayilsaydi Kuveyt fiyatlari
 * 10 KAT yanlis olurdu. ISK sifir haneli -- 100 KAT.
 */
select is(
  (select string_agg(code, ',' order by code) from public.currencies where minor_unit = 3),
  'BHD,KWD,OMR',
  '17) uc haneli para birimleri: BHD, KWD, OMR'
);

select is(
  (select minor_unit from public.currencies where code = 'ISK'),
  0::smallint,
  '18) ISK alt birimi sifir'
);

select is(
  (select string_agg(code, ',' order by code) from public.locales where is_supported),
  'de,en,tr',
  '19) desteklenen diller yalnizca cevirisi olan uc dil'
);

-- ---------------------------------------------------------------------------
-- C) DORT EKSEN BAGIMSIZ
-- ---------------------------------------------------------------------------
/*
 * COKLU UYELIK -- bu join tablosunun VARLIK SEBEBI.
 *
 * Isvec hem NORDICS hem EU. Tek skaler bir `market` sutunu bunu ifade
 * edemezdi. Bu iddia duserse model, cozmek icin kuruldugu problemi
 * cozmuyor demektir.
 */
select is(
  (select string_agg(country_code, ',' order by country_code)
     from (select country_code from public.market_countries
            group by country_code having count(*) > 1) t),
  'DK,FI,SE',
  '20) coklu uyelik: DK, FI, SE hem EU hem NORDICS'
);

-- Pazar para birimi ZORLAMIYOR: cok para birimli pazarlarda NULL.
select is(
  (select string_agg(code, ',' order by code) from public.markets
    where default_currency is null),
  'ANZ,GCC,NORDICS',
  '21) cok para birimli pazarlarda varsayilan YOK (NULL) -- uydurulmuyor'
);

-- Ulkenin dili ile para birimi birbirine bagli DEGIL: ayni dili konusan
-- iki ulke farkli para birimi tasiyabilir.
select isnt_empty(
  $$ select a.code from public.countries a
       join public.countries b on b.default_locale = a.default_locale
      where a.default_currency <> b.default_currency $$,
  '22) ayni dili konusan ulkeler farkli para birimi tasiyabiliyor (eksenler bagimsiz)'
);

-- ---------------------------------------------------------------------------
-- D) YENI ULKE / PARA BIRIMI EKLEMEK KOD DEGISIKLIGI GEREKTIRMIYOR
-- ---------------------------------------------------------------------------
/*
 * MODELIN VARLIK SEBEBININ SINANMASI.
 *
 * Japonya aciliyor: yeni para birimi (JPY, SIFIR haneli), yeni dil ve yeni
 * ulke. Hicbir sema degisikligi, hicbir enum, hicbir TypeScript union
 * duzenlemesi olmadan calismali. Eski modelde bu bir `alter type` +
 * bir TS duzenlemesi + bir dagitim demekti.
 */
select lives_ok(
  $$ insert into public.currencies (code, name_en, minor_unit, symbol)
       values ('JPY', 'Japanese yen', 0, '¥');
     insert into public.locales (code, name_en, is_supported)
       values ('ja', 'Japanese', false);
     insert into public.countries (code, name_en, default_currency, default_locale, number_locale)
       values ('JP', 'Japan', 'JPY', 'ja', 'ja-JP');
     insert into public.market_countries (market_code, country_code)
       values ('ANZ', 'JP') $$,
  '23) yeni ulke + para birimi + dil YALNIZCA veriyle eklenebiliyor'
);

-- Ters yon: uydurma bir para birimi kodu ULKEYE baglanamaz.
select throws_ok(
  $$ insert into public.countries (code, name_en, default_currency, default_locale, number_locale)
       values ('XX', 'Nowhere', 'ZZZ', 'en', 'en-XX') $$,
  '23503',
  null,
  '24) tanimsiz para birimi ulkeye baglanamiyor (yabanci anahtar tutuyor)'
);

select * from finish();
rollback;
