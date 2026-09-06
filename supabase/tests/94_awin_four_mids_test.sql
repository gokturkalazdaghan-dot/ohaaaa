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

-- --- 12: mevcut yirmi kayit etkilenmedi ----------------------------------
-- GENEL magaza sayimi kullanilmiyor: seed kendi `direct` magazalarini
-- ekliyor ve test o zaman gocla ilgisiz bir sebepten duserdi. Olculen sey
-- gocun gercekten iddia ettigi ikili: awin kayitlari 20'den 24'e cikti ve
-- DOGRULANMIS sart sayisi 14'te KALDI -- yani dort yeni kayit, mevcut
-- dogrulamalarin hicbirini devralmadi.
select is(
  (select format('%s/%s',
            count(*),
            count(*) filter (where terms_verified_at is not null))
     from public.merchants where network = 'awin'),
  '24/14',
  '12) awin kayitlari 24, dogrulanmis sart hala 14 -- mevcutlar etkilenmedi');

select * from finish();
rollback;
