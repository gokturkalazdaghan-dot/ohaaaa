-- ===========================================================================
-- 93 — M4: public.market enum'unun dusurulmesi
-- ===========================================================================
--
-- Bu test iki yonlu: eski yolun GERCEKTEN kapandigini ve yeni yolun
-- CALISTIGINI ayri ayri olcer. Yalnizca birincisi olsaydi, her seyi silen
-- bir goc de gecerdi.
begin;
select plan(16);

-- --- 1-3: eski yol yok ---------------------------------------------------
select hasnt_type('public', 'market', 'public.market tipi dusurulmus olmali');

select hasnt_column('public', 'sources',  'market', 'sources.market dusurulmus olmali');
select hasnt_column('public', 'products', 'market', 'products.market dusurulmus olmali');

-- --- 4: enum uzerine kurulu varsayim fonksiyonu de gitmis ----------------
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'market_currency'),
  0,
  'market_currency() dusurulmus olmali -- pazar=para birimi varsayimi curutuldu'
);

-- --- 5-7: yeni sutunlar ve zorunluluklari --------------------------------
select col_not_null('public', 'sources',  'market_code', 'sources.market_code zorunlu');
select col_not_null('public', 'products', 'market_code', 'products.market_code zorunlu');
-- jobs BILEREK gevsek: her is bir pazara ait degildir.
select col_is_null('public', 'jobs', 'market_code',
  'jobs.market_code null kabul etmeli -- her is bir pazara ait degildir');

-- --- 8: market_code hala markets'a bagli ---------------------------------
select is(
  (select count(*)::int
     from pg_constraint c
    where c.contype = 'f'
      and c.conrelid in ('public.sources'::regclass, 'public.products'::regclass,
                         'public.jobs'::regclass)
      and c.confrelid = 'public.markets'::regclass),
  3,
  'uc tablonun market_code sutunu da markets(code) ile bagli'
);

-- --- 9-11: fonksiyonlar metin imzasiyla ayakta ---------------------------
select is(
  (select pg_get_function_result(p.oid) ~ 'market_code text'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'source_health'),
  true,
  'source_health() market_code text donduruyor'
);

select is(
  (select pg_get_function_result(p.oid) ~ 'market_code text'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'due_sources'),
  true,
  'due_sources() market_code text donduruyor'
);

select is(
  (select pg_get_function_arguments(p.oid) ~ 'p_market_code text'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enqueue_job'),
  true,
  'enqueue_job p_market_code text aliyor'
);

-- --- 12-13: yetkiler drop sonrasi yeniden kurulmus ------------------------
-- Bir fonksiyon dusuruldugunde ACL'i gider ve yenisi PUBLIC'e acik dogar.
-- Bu iki iddia o kapinin kapatildigini kanitlar.
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('enqueue_job','source_health','due_sources','schedule_due_sources')
      and (p.proacl is null
           or exists (select 1 from unnest(p.proacl) a where a::text like '=%'))),
  0,
  'dort fonksiyonun hicbiri PUBLIC''e acik degil'
);

select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('enqueue_job','source_health','due_sources','schedule_due_sources')
      and has_function_privilege('service_role', p.oid, 'execute')),
  4,
  'service_role dordune de erisebiliyor -- kapatma fazla kapatmamis'
);

-- --- 14: search_path pini korunmus ---------------------------------------
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('enqueue_job','source_health','due_sources','schedule_due_sources')
      and p.proconfig is not null
      and array_to_string(p.proconfig, ',') like 'search_path=%'),
  4,
  'dordunun de search_path pini yerinde'
);

-- --- 15: yeni yol GERCEKTEN calisiyor ------------------------------------
-- Kapatmayi olcen bir test, calisirligi olcmez. Burada bir is kuyruga
-- aliniyor ve market_code'un metin olarak yazildigi dogrulaniyor.
select lives_ok(
  $$ select public.enqueue_job(
       'TEST_M4', 'normal', '{}'::jsonb, 'm4-test-anahtari', 'NORDICS', null
     ) $$,
  'enqueue_job metin market_code ile is acabiliyor'
);

-- --- 16: uydurma pazar REDDEDILIYOR --------------------------------------
-- Enum kalksa bile serbest metin olmadi: markets(code) yabanci anahtari
-- kapiyi tutuyor. 'DE' ozellikle secildi -- eski enum'da GECERLI bir
-- degerdi, yeni modelde Almanya bir ulke ve boyle bir pazar YOK.
select throws_ok(
  $$ select public.enqueue_job(
       'TEST_M4', 'normal', '{}'::jsonb, 'm4-test-gecersiz', 'DE', null
     ) $$,
  '23503',
  null,
  'var olmayan pazar kodu ("DE") yabanci anahtar tarafindan reddediliyor'
);

select * from finish();
rollback;
