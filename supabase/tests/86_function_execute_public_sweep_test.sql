-- ============================================================================
-- TEST · Fonksiyon EXECUTE yuzeyi — PUBLIC sizintisi kapali mi?
-- ----------------------------------------------------------------------------
-- Bu dosya `20260904110000_function_execute_public_sweep.sql` gocunun
-- NE GARANTI ETTIGINI kanitlar. Iddialar kataloga sorulur
-- (`has_function_privilege`), cagri sonucuna DEGIL: bir fonksiyonu anon
-- olarak cagirip hata almak, yetkinin kapali oldugunu KANITLAMAZ -- hata
-- fonksiyonun kendi ic kontrolunden de gelebilir. Olcmek istedigimiz sey
-- yetki katmani.
--
-- Testler ad uzerinden ve `is_empty` ile yazildi: elle yazilmis bir imza
-- yanlissa "fonksiyon yok" sayilip iddia SESSIZCE gecerdi. Ad uzerinden
-- eslesme asiri yuklenmis (overloaded) tum imzalari da kapsar.
-- ============================================================================
\set ON_ERROR_STOP on

begin;
select plan(23);

-- ---------------------------------------------------------------------------
-- A) NEGATIF — anon bu fonksiyonlara DOKUNAMAZ
-- ---------------------------------------------------------------------------
-- Yardimci: verilen ada sahip, anon'un EXECUTE tasidigi imzalari dondurur.
-- Bos donmesi gerekir.
create or replace function pg_temp.anon_exec(p_name text)
returns setof text language sql stable as $fn$
  select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = p_name
     and has_function_privilege('anon', p.oid, 'EXECUTE');
$fn$;

-- ASIL BULGU: create_order, PostgreSQL'in varsayilan PUBLIC grant'i
-- yuzunden anon'a acikti. Niyet iki ayri migration'da `authenticated`
-- olarak yazilmisti; misafir siparisi hicbir zaman kasitli acilmadi.
select is_empty(
  $$select * from pg_temp.anon_exec('create_order')$$,
  'anon create_order CAGIRAMAZ -- odeme guard''i DB''den atlanamaz'
);

-- Para yolu. Baseline'da kapatilmisti; burada bir daha kanitlaniyor ki
-- ileride bir goc onlari sessizce geri acarsa derleme dussun.
select is_empty(
  $$select * from pg_temp.anon_exec('record_click')$$,
  'anon record_click CAGIRAMAZ -- sahte tiklama uretilemez'
);

select is_empty(
  $$select * from pg_temp.anon_exec('record_conversion')$$,
  'anon record_conversion CAGIRAMAZ -- sahte donusum yazilamaz'
);

select is_empty(
  $$select * from pg_temp.anon_exec('confirm_payment')$$,
  'anon confirm_payment CAGIRAMAZ -- siparis "odendi" isaretlenemez'
);

select is_empty(
  $$select * from pg_temp.anon_exec('vendor_dashboard_stats')$$,
  'anon vendor_dashboard_stats CAGIRAMAZ'
);

select is_empty(
  $$select * from pg_temp.anon_exec('current_role')$$,
  'anon current_role CAGIRAMAZ'
);

-- Baseline sweep'ten SONRA dogan iki tetikleyici fonksiyonu, varsayilan
-- PUBLIC grant'iyla acikta kalmisti. Sistemik boslugun kaniti.
select is_empty(
  $$select * from pg_temp.anon_exec('tg_payouts_touch')$$,
  'anon tg_payouts_touch CAGIRAMAZ'
);

select is_empty(
  $$select * from pg_temp.anon_exec('tg_products_touch_freshness')$$,
  'anon tg_products_touch_freshness CAGIRAMAZ'
);

-- ---------------------------------------------------------------------------
-- B) POZITIF — kasitli erisim KORUNDU
-- ---------------------------------------------------------------------------
-- Bir guvenlik gocunun en sinsi hatasi, delikle birlikte calisan ozelligi de
-- kapatmasidir. Asagidakiler o riski olcer.
select ok(
  has_function_privilege('authenticated',
    'public.create_order(jsonb, text, jsonb, text)', 'EXECUTE'),
  'authenticated create_order CAGIRABILIR -- niyet edilen erisim korundu'
);

select ok(
  has_function_privilege('authenticated',
    'public.vendor_dashboard_stats(uuid, integer)', 'EXECUTE'),
  'authenticated vendor_dashboard_stats CAGIRABILIR'
);

select ok(
  has_function_privilege('authenticated', 'public.current_role()', 'EXECUTE'),
  'authenticated current_role CAGIRABILIR'
);

select ok(
  has_function_privilege('service_role',
    'public.confirm_payment(uuid, text, text)', 'EXECUTE'),
  'service_role confirm_payment CAGIRABILIR -- sunucu tarafi akis bozulmadi'
);

select ok(
  (select bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_conversion'),
  'service_role record_conversion CAGIRABILIR -- postback yazabilir'
);

select ok(
  (select bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_click'),
  'service_role record_click CAGIRABILIR -- /git tiklama kaydedebilir'
);

-- ---------------------------------------------------------------------------
-- C) RLS YARDIMCILARI — bunlar anon'a ACIK KALMALI
-- ---------------------------------------------------------------------------
-- Politika ifadeleri CAGIRANIN yetkisiyle degerlendirilir. Bu dordune
-- dokunmak her RLS politikasini hata verdirir ve siteyi tamamen durdurur.
-- Yani "anon cagiramiyor" burada BASARISIZLIKTIR.
select ok(has_function_privilege('anon', 'public.is_admin()', 'EXECUTE'),
  'anon is_admin CAGIRABILIR -- RLS politikalari icin ZORUNLU');

select ok(has_function_privilege('anon', 'public.owns_vendor(uuid)', 'EXECUTE'),
  'anon owns_vendor CAGIRABILIR -- RLS politikalari icin ZORUNLU');

select ok(
  has_function_privilege('anon',
    'public.order_belongs_to_current_user(uuid)', 'EXECUTE'),
  'anon order_belongs_to_current_user CAGIRABILIR -- RLS icin ZORUNLU');

select ok(
  has_function_privilege('anon',
    'public.order_has_vendor_of_current_user(uuid)', 'EXECUTE'),
  'anon order_has_vendor_of_current_user CAGIRABILIR -- RLS icin ZORUNLU');

-- ---------------------------------------------------------------------------
-- D) VITRIN — arama ve fiyat gecmisi bozulmadi
-- ---------------------------------------------------------------------------
select ok(
  (select bool_and(has_function_privilege('anon', p.oid, 'EXECUTE'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'search_products'),
  'anon search_products CAGIRABILIR -- vitrin calismaya devam ediyor'
);

select ok(
  (select bool_and(has_function_privilege('anon', p.oid, 'EXECUTE'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'price_history'),
  'anon price_history CAGIRABILIR'
);

-- pg_trgm public semasinda kurulu. Bu fonksiyonlardan PUBLIC'i cekmek
-- aramayi toptan kirardi; bilerek dokunulmadi.
select ok(
  has_function_privilege('anon', 'public.similarity(text, text)', 'EXECUTE'),
  'anon similarity CAGIRABILIR -- pg_trgm eklentisine dokunulmadi'
);

-- ---------------------------------------------------------------------------
-- E) ALLOWLIST — anon'a acik SECURITY DEFINER kumesi TAM OLARAK bu
-- ---------------------------------------------------------------------------
-- Asil regresyon kapisi burasi. Yeni bir SECURITY DEFINER fonksiyonu
-- varsayilan PUBLIC grant'iyla dogar ve kimse fark etmezse, bu iddia duser.
-- Liste degisecekse BILEREK degistirilmeli ve gerekcesi yazilmali.
select set_eq(
  $$select p.proname::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and has_function_privilege('anon', p.oid, 'EXECUTE')$$,
  array[
    -- RLS politikalarinin ihtiyaci (bkz. C bolumu)
    'is_admin', 'owns_vendor',
    'order_belongs_to_current_user', 'order_has_vendor_of_current_user',
    -- Vitrinin okudugu skor/fiyat fonksiyonlari
    'deal_score', 'ohaaaa_score', 'offer_freshness',
    'price_drops', 'price_history'
  ],
  'anon''a acik SECURITY DEFINER kumesi tam olarak belgelenen 9 fonksiyon'
);

-- ---------------------------------------------------------------------------
-- F) DAVRANISSAL — yeni fonksiyon KAPALI doguyor mu?
-- ---------------------------------------------------------------------------
-- Bu, gocun 3. bolumunun (default privileges) gercekten ise yaradigini
-- kanitlayan tek test. Katalogdaki bir ayara bakmak yetmez; sistemik
-- bosluk "bir sonraki fonksiyon nasil dogar?" sorusuydu, cevabini olcuyoruz.
create function public.sweep_kanit_fn() returns integer
language sql immutable as $fn$ select 1 $fn$;

select ok(
  not has_function_privilege('anon', 'public.sweep_kanit_fn()', 'EXECUTE'),
  'YENI olusturulan fonksiyon anon''a KAPALI doguyor -- sistemik bosluk kapandi'
);

drop function public.sweep_kanit_fn();

select * from finish();
rollback;
