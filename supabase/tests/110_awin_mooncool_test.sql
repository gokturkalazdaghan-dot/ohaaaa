-- ===========================================================================
-- Mooncool (Awin MID 66494): eksik kanit eksik kaliyor mu?
-- ===========================================================================
--
-- Alison'in testi (109) "butun kanit varken bile yayina alma" diyordu.
-- Bu dosya tersini sinar: KANIT EKSIKKEN eksiklik gorunur kaliyor mu.
--
-- Sinanan tek fikir: BILINMEYEN KOMISYON, SEMA VARSAYILANINA DONUSMESIN.
-- `merchants.default_commission_rate` NOT NULL ve varsayilani %3 -- o satir
-- tek basina okundugunda Mooncool'un komisyonunu BILIYORMUS gibi gorunur.
-- Yalanlayan tek sey `terms_verified_at`in NULL olmasi.
-- ===========================================================================
begin;
select plan(12);

-- --- 1-3: UC KAYIT DA "KOMISYONU BILMIYORUM" DIYOR ------------------------

select is(
  (select commission_rate from public.programs
    where network = 'awin' and network_program_id = '66494'),
  null,
  '1) programs: bildirilmeyen komisyon NULL -- 0 gecerli bir orandir, '
  '"bilinmiyor" ile ayni hucreye yazilamaz');

select is(
  (select terms_verified_at from public.merchants where slug = 'mooncool'),
  null,
  '2) merchants: %3''luk varsayilan dogrulanmis sayilmadi');

-- Bag, magaza satirindaki varsayilani kopyalasaydi ona ikinci bir "kaynak"
-- gorunumu verirdi: iki tabloda ayni sayi, kanit gibi okunur.
select is(
  (select commission_rate from public.merchant_network_links
    where network = 'awin' and network_program_id = '66494'),
  null,
  '3) ag bagi bilinmeyen komisyona deger uydurmadi');

-- --- 4-6: "PRODUCT FEED: 5" -- VARLIK YAZILDI, SAYI YAZILMADI -------------

/*
 * BELIRSIZLIK COZULDU -- TAHMINLE DEGIL, KAYNAKTAN.
 *
 * Bu iddia once `product_count IS NULL` diyordu: 20260907350000 "Product
 * Feed: 5" satirindaki 5'in birimini bilmiyordu (feed sayisi mi urun sayisi
 * mi?) ve BILMEDIGI icin yazmamisti. Hesap sahibi ayni satiri sonra
 * "Products: 5" olarak bildirdi; 20260907380000 sayiyi o kaynakla yazdi.
 *
 * Iddia zayiflamadi, KONUSU degisti: "birimini bilmedigin sayiyi yazma"
 * kurali hâlâ gecerli ve 113_feed_onboarding_test.sql'de bildirilmeyen
 * alanlar (feed adresi, son guncelleme tarihi) uzerinden sinaniyor.
 */
select is(
  (select product_count from public.programs
    where network = 'awin' and network_program_id = '66494'),
  5,
  '4) "5" URUN sayisi olarak cozuldu (hesap sahibi dogrulamasi)');

-- Agin bildirdigi sayi, BIZIM katalogumuzun sayisi degil: ayri sutun.
select is(
  (select count(*)::int from public.products p
     join public.merchants m on m.id = p.merchant_id
    where m.slug = 'mooncool'),
  0,
  '4b) 5 sayisi AGIN; bizim katalogumuzda Mooncool urunu yok');

select is(
  (select feed_available from public.programs
    where network = 'awin' and network_program_id = '66494'),
  true,
  '5) alanin ADINDAN cikan sey yazildi: feed var');

-- Feed VAR ama ADRESI yok. Celiski degil, durumun kendisi:
-- sources.endpoint_url NOT NULL'dur ve uydurulmadi.
select is(
  (select count(*)::int from public.sources s
     join public.merchants m on m.id = s.merchant_id
    where m.slug = 'mooncool'),
  0,
  '6) feed VAR ama ADRESI yok -- kaynak acilmadi');

-- --- 7-8: ANA SAYFA VE ONAY UYDURULMADI -----------------------------------

select is(
  (select homepage_url from public.merchants where slug = 'mooncool'),
  null,
  '7) bildirilmeyen ana sayfa uydurulmadi');

select is(
  (select status::text || '/' || application_status::text
     from public.merchants where slug = 'mooncool'),
  'prospect/not_started',
  '8) dizinde MID gormek programa kabul edilmek degildir');

-- --- 9: YAYIN KAPISI GERCEKTEN KAPALI -------------------------------------
-- 8. iddia "yayinda degil" der; bu iddia "yayina ALINAMAZ" oldugunu kanitlar.
-- Ikisi olmadan, birinin elle status degistirmesini engelleyen bir sey
-- olmadigi hâlde test gecerdi.
select throws_ok(
  $$ update public.merchants set status = 'active' where slug = 'mooncool' $$,
  '23514', null,
  '9) dogrulanmamis sartla yayina ALINAMIYOR -- kapi kod degil, kisit');

-- --- 10: CEREZ VARSAYILANDA KALMADI ---------------------------------------
-- 1 gunde kalsaydi tiklamadan 24 saat sonraki her donusum
-- `record_conversion` tarafindan sessizce reddedilirdi.
select is(
  (select cookie_window_days from public.merchants where slug = 'mooncool'),
  30,
  '10) cerez 30 gun -- 1 gunluk sema varsayilaninda kalmadi');

-- --- 11: PAZARIN IKINCI YARISI DUSMEDI ------------------------------------
select is(
  (select country_code || ':' || array_to_string(countries, ',')
     from public.merchants where slug = 'mooncool'),
  'US:US,CA',
  '11) merkez ulke US, kabul edilen ulkeler US+CA');

select * from finish();
rollback;
