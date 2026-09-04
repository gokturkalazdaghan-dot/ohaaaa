-- ============================================================================
-- Alım hata sınıfı sütunları
-- ----------------------------------------------------------------------------
-- Sınıflandırma kararı TypeScript tarafında veriliyor; burada sınanan şey
-- veritabanının o kararı KABUL EDİP EDEMEDİĞİ ve yanlış bir değeri
-- reddedip reddetmediği.
--
-- Enum seçilmesinin sınanabilir sonucu şudur: serbest metin olsaydı
-- "auth_error", "AUTH", "Auth Error" hepsi kabul edilir ve gruplama
-- anlamsızlaşırdı. Aşağıdaki 4. iddia tam olarak bunu kilitliyor.
-- ============================================================================

begin;
select plan(8);

-- --- Sütunlar var mı --------------------------------------------------------

select has_column('public', 'ingest_runs', 'error_class',
  'ingest_runs.error_class sutunu var');

select has_column('public', 'sources', 'last_error_class',
  'sources.last_error_class sutunu var');

select col_type_is('public', 'ingest_runs', 'error_class', 'ingest_error_class',
  'error_class enum tipinde -- serbest metin degil');

-- --- Geçmiş kayıtlar korunur -----------------------------------------------

/*
 * NULL KABUL EDİLMELİ. Bu surumden onceki turlarin sinifi yok ve olmayan
 * bir bilgiyi uydurmak yerine bos birakmak dogrudur. NOT NULL olsaydi
 * migration mevcut satirlarda patlardi.
 */
select col_is_null('public', 'ingest_runs', 'error_class',
  'error_class NULL kabul eder -- gecmis kayitlarin sinifi yok');

-- --- Enum yalnızca bilinen sınıfları kabul eder -----------------------------

select throws_ok(
  $$ select 'AUTH'::public.ingest_error_class $$,
  '22P02',
  null,
  'tanimsiz sinif REDDEDILIR -- yazim farkliliklari gruplamayi bozamaz'
);

select lives_ok(
  $$ select 'AUTH_ERROR'::public.ingest_error_class $$,
  'bilinen sinif kabul edilir'
);

/*
 * TypeScript tarafindaki birlesim tipiyle DOKUZ deger de eslesmeli.
 * Biri eklenip buraya eklenmezse alim turu veritabanina yazarken patlardi
 * -- ve bu, hatanin kendisinden daha kotu bir hata olurdu: turun neden
 * dustugu kaybolurdu.
 */
select is(
  (select count(*)::int
     from pg_enum e
     join pg_type t on t.oid = e.enumtypid
    where t.typname = 'ingest_error_class'),
  9,
  'dokuz hata sinifi -- TypeScript IngestErrorClass ile ayni sayida'
);

-- --- İndeks -----------------------------------------------------------------

/*
 * Izlemenin temel sorusu "son 24 saatte hangi sinif artti". Indekssiz
 * bu sorgu her seferinde butun tabloyu tarardi.
 */
select has_index('public', 'ingest_runs', 'ingest_runs_error_class_idx',
  'hata sinifi + zaman indeksi var');

select * from finish();
rollback;
