-- ===========================================================================
-- 94 — Dort Awin MID kaydi
-- ===========================================================================
--
-- Bu test iki yonlu olmak ZORUNDA. Yalnizca "kayitlar var mi" sorsaydi,
-- her alani uydurma degerle dolduran bir goc de gecerdi -- ve bu gocun tum
-- meselesi tam olarak o alanlari DOLDURMAMAKTI.
begin;
select plan(12);

-- --- 1-4: dordu de dogru MID ile var ------------------------------------
select is(
  (select network_advertiser_id from public.merchants where slug = 'blazevideo-de'),
  '25962', '1) BlazeVideo DE -> MID 25962');

select is(
  (select network_advertiser_id from public.merchants where slug = 'back-to-the-office'),
  '61655', '2) Back to the Office -> MID 61655');

select is(
  (select network_advertiser_id from public.merchants where slug = 'goettgen-de'),
  '17453', '3) goettgen.de -> MID 17453');

select is(
  (select network_advertiser_id from public.merchants where slug = 'ravin-crossbows'),
  '115809', '4) Ravin Crossbows -> MID 115809');

-- --- 5: hepsi awin agina bagli -------------------------------------------
select is(
  (select count(*)::int from public.merchants
    where network_advertiser_id in ('25962','61655','17453','115809')
      and network = 'awin'),
  4, '5) dordu de awin agina kayitli');

-- --- 6-7: BASVURU != ONAY -------------------------------------------------
-- Bu gocun en pahali iddiasi. Bir MID bilmek, o programa kabul edilmis
-- olmak DEGILDIR; kaydi "approved" yapmak, olmayan bir geliri var saymak
-- ve dogrulanmamis sartlarla trafik gondermek olurdu.
select is(
  (select count(*)::int from public.merchants
    where network_advertiser_id in ('25962','61655','17453','115809')
      and (status <> 'prospect' or application_status <> 'not_started')),
  0, '6) hicbiri onayli/aktif degil -- basvuru onay degildir');

select is(
  (select count(*)::int from public.merchants
    where network_advertiser_id in ('25962','61655','17453','115809')
      and approved_at is not null),
  0, '7) hicbirinde onay tarihi yok');

-- --- 8-9: BILINMEYEN UYDURULMADI -----------------------------------------
select is(
  (select count(*)::int from public.merchants
    where network_advertiser_id in ('25962','61655','17453','115809')
      and (homepage_url is not null or country_code is not null)),
  0, '8) ana sayfa ve ulke bos -- ad icindeki alan adi kanit degildir');

select is(
  (select count(*)::int from public.merchants
    where network_advertiser_id in ('25962','61655','17453','115809')
      and (terms_verified_at is not null or deeplink_template is not null)),
  0, '9) sart dogrulamasi ve yonlendirme sablonu bos');

-- --- 10: KAPI GERCEKTEN CALISIYOR ----------------------------------------
-- 8 ve 9 yalnizca alanlarin bos oldugunu soyler. Asil soru: bu eksiklik
-- yayina almayi ENGELLIYOR mu? Engellemeseydi bos alanlar bir belge degil
-- yalnizca bir gecikme olurdu.
select throws_ok(
  $$ update public.merchants set status = 'active' where slug = 'goettgen-de' $$,
  '23514',
  null,
  '10) dogrulanmamis sartlarla yayina alinamiyor -- kapi semada');

-- --- 11: MID benzersizligi kisitla korunuyor ------------------------------
-- Onceden yalnizca OLCULMUSTU; olculmus bir ozellik bir sonraki eklemede
-- bozulabilir. Ayni advertiser iki slug altina girseydi tiklamalar ikiye
-- bolunur ve mutabakat SESSIZCE tutmazdi.
select throws_ok(
  $$ insert into public.merchants (slug, display_name, network, network_advertiser_id)
     values ('yinelenen-mid', 'Yinelenen MID', 'awin', '25962') $$,
  '23505',
  null,
  '11) ayni ag icinde ayni MID iki kez kaydedilemiyor');

-- --- 12: mevcut kayitlarin dogrulamasi devralinmadi ----------------------
-- TOPLAM SAYIM KULLANILMIYOR. Ilk halinde bu iddia "24 awin kaydi" diyordu
-- ve bir sonraki advertiser eklendiginde -- Simple Project -- gocla hicbir
-- ilgisi olmayan bir sebepten dustu. Sayim, buyuyen bir tabloda kararsiz
-- bir olcudur.
--
-- Kararli olan degismez su: `terms_verified_at` yalnizca 20260905120000'in
-- dizin kanitiyla doldurdugu 14 firmada dolu. Yeni eklenen hicbir kayit onu
-- DEVRALMAZ; devralsaydi merchants_active_needs_verified_terms kapisi o
-- kayitlar icin sessizce acilirdi.
select is(
  (select count(*)::int from public.merchants
    where network = 'awin' and terms_verified_at is not null),
  14,
  '12) dogrulanmis sart sayisi hala 14 -- yeni kayitlar dogrulama devralmadi');

select * from finish();
rollback;
