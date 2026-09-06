-- ============================================================================
-- TEST · Yardimci fonksiyonlarda search_path pini
-- ----------------------------------------------------------------------------
-- `20260906100000_pin_helper_search_path.sql` gocunun NE GARANTI ETTIGINI
-- kanitlar. Iki soru ayri ayri soruluyor:
--
--   A) Pin gercekten var mi ve degeri DOGRU mu?
--   B) Pin, fonksiyonlarin DAVRANISINI bozdu mu?
--
-- (B) olmadan bu test yarim olurdu: bir guvenlik/tutarlilik duzeltmesi
-- islevi bozuyorsa duzeltme degil regresyondur. Ozellikle `to 'public'`
-- yerine yanlislikla `to ''` yazilsaydi (A) gecer, (B) duserdi -- cunku bu
-- alti fonksiyon govdelerinde niteliksiz adlar kullaniyor.
--
-- Imzalar `regprocedure` cast'i ile yaziliyor: elle yazilmis bir imza
-- yanlissa test SESSIZCE gecmez, cast hata verir.
-- ============================================================================
\set ON_ERROR_STOP on

begin;
select plan(11);

-- Yardimci: bir imzanin pin degerini dondurur.
create or replace function pg_temp.pin(p_imza text)
returns text language sql stable as $fn$
  select coalesce(array_to_string(p.proconfig, ','), '(pin YOK)')
    from pg_proc p
   where p.oid = p_imza::regprocedure;
$fn$;

-- ---------------------------------------------------------------------------
-- A) PIN VAR VE DEGERI DOGRU
-- ---------------------------------------------------------------------------
select is(pg_temp.pin('public.normalize_search(text)'), 'search_path=public',
  '1) normalize_search(text) public''e sabitlendi');

select is(pg_temp.pin('public.slugify(text)'), 'search_path=public',
  '2) slugify(text) public''e sabitlendi');

select is(pg_temp.pin('public.tg_set_updated_at()'), 'search_path=public',
  '3) tg_set_updated_at() public''e sabitlendi');

select is(pg_temp.pin('public.tg_orders_set_order_number()'), 'search_path=public',
  '4) tg_orders_set_order_number() public''e sabitlendi');

select is(pg_temp.pin('public.tg_conversions_stamp_status()'), 'search_path=public',
  '5) tg_conversions_stamp_status() public''e sabitlendi');

select is(pg_temp.pin('public.assert_orderable(public.products)'), 'search_path=public',
  '6) assert_orderable(products) public''e sabitlendi');

-- ---------------------------------------------------------------------------
-- 7) YAKALAYICI — elle yazilan listeye degil KATALOGA soruluyor
-- ---------------------------------------------------------------------------
-- Uzantiya ait fonksiyonlar (yerelde pgTAP `public` icine kurulur) elenir;
-- onlar bizim degil. Geriye pinsiz bir sey kalirsa liste adlariyla dokulur.
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', '
                              order by p.oid::regprocedure::text), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and p.proconfig is null
      and not exists (
        select 1 from pg_depend d
         where d.objid = p.oid
           and d.classid = 'pg_proc'::regclass
           and d.deptype = 'e')),
  '',
  '7) public semasinda search_path pini olmayan fonksiyon KALMADI'
);

-- ---------------------------------------------------------------------------
-- B) DAVRANIS DEGISMEDI
-- ---------------------------------------------------------------------------
-- 8) slugify hala Turkce harfleri katliyor ve tireliyor.
select is(
  public.slugify('Ürün Şşğı Öç  Test'),
  'urun-ssgi-oc-test',
  '8) slugify davranisi degismedi'
);

-- 9) normalize_search hala kucultuyor ve diakritikleri katliyor.
select is(
  public.normalize_search('ÇAYKUR Filiz Çayı'),
  'caykur filiz cayi',
  '9) normalize_search davranisi degismedi'
);

-- 10) tg_set_updated_at tetikleyicisi hala damga vuruyor.
--     Aday magaza: ana sayfa/ulke gerektirmez (merchants_known_needs_*),
--     'direct' ag: MID gerektirmez (merchants_awin_known_needs_mid).
insert into public.merchants (slug, display_name, network, status)
values ('pin-testi-magaza', 'Pin Testi Magaza', 'direct', 'prospect');

update public.merchants
   set updated_at = timestamptz '2000-01-01 00:00:00+00'
 where slug = 'pin-testi-magaza';

update public.merchants
   set notes = 'tetikleyici tetiklensin'
 where slug = 'pin-testi-magaza';

select ok(
  (select updated_at from public.merchants where slug = 'pin-testi-magaza')
    > timestamptz '2020-01-01 00:00:00+00',
  '10) tg_set_updated_at damgayi hala guncelliyor'
);

-- 11) assert_orderable hala ortak magaza teklifini reddediyor.
--     Tohum verisindeki affiliate teklif kullaniliyor (30_affiliate_test ile ayni satir).
select throws_ok(
  $$ select public.assert_orderable(p)
       from public.products p
      where p.id = '60000000-0000-4000-8000-000000000001' $$,
  '23514',
  null,
  '11) assert_orderable affiliate teklifini hala reddediyor'
);

select * from finish();
rollback;
