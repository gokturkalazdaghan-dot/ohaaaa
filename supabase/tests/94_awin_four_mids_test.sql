-- ===========================================================================
-- 94 — Dort Awin MID kaydi
-- ===========================================================================
--
-- Bu test iki yonlu olmak ZORUNDA. Yalnizca "kayitlar var mi" sorsaydi,
-- her alani uydurma degerle dolduran bir goc de gecerdi -- ve bu gocun tum
-- meselesi tam olarak o alanlari DOLDURMAMAKTI.
begin;
select plan(14);

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
/*
 * 8-9) BU IKI IDDIA DARALDI, SILINMEDI.
 *
 * Ilk hallerinde DORDU icin de "ana sayfa/ulke/sablon BOS" diyorlardi ve
 * 20260907140000'in kaniti olmayani doldurmadigini kanitliyorlardi.
 * Sonradan Ravin Crossbows icin hesap sahibi gercek bilgi dogruladi
 * (ulke US, MID'e dayali sablon) ve 20260907170000 onlari yazdi.
 *
 * Iddialar kalan UCE daraltildi: kaniti gelmeyen advertiser'da hala hicbir
 * alan uydurulmadigini olcuyorlar. Silinselerdi "kanit yoksa yazma" kurali
 * bu dosyada izsiz kalirdi; Ravin'i disari almasaydik test gercek bir
 * ilerlemeyi hata sayardi.
 *
 * KANITI GELMEYEN UC: 25962, 61655, 17453.
 */
select is(
  (select count(*)::int from public.merchants
    where network_advertiser_id in ('25962','61655','17453')
      and (homepage_url is not null or country_code is not null)),
  0, '8) kaniti gelmeyen ucte ana sayfa ve ulke hala bos');

select is(
  (select count(*)::int from public.merchants
    where network_advertiser_id in ('25962','61655','17453')
      and deeplink_template is not null),
  0, '9a) kaniti gelmeyen ucte yonlendirme sablonu hala bos');

/*
 * 9b) SART DOGRULAMASI ISE DORDU ICIN DE BOS OLMAK ZORUNDA.
 *
 * Ravin'in cerez penceresi dogrulandi (68 gun) ama KOMISYONU bildirilmedi.
 * terms_verified_at yarim kanitla doldurulamaz: o sutun
 * merchants_active_needs_verified_terms'in dayanagi ve doldurmak, yayina
 * alma kapisini kaldirmak demek. Bu yuzden Ravin bu iddianin ICINDE kaliyor.
 */
select is(
  (select count(*)::int from public.merchants
    where network_advertiser_id in ('25962','61655','17453','115809')
      and terms_verified_at is not null),
  0, '9b) dordunde de sart dogrulamasi bos -- cerez bilmek komisyon bilmek degildir');

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
-- Kararli olan degismez su: `terms_verified_at` yalnizca KENDI KANITI olan
-- kayitlarda dolu. Yeni eklenen hicbir kayit onu DEVRALMAZ; devralsaydi
-- merchants_active_needs_verified_terms kapisi o kayitlar icin sessizce
-- acilirdi.
--
-- SAYIM YINE YETMEDI. Yukaridaki not sayimin kararsizligini zaten bir kez
-- ogrenmisti (24 -> 14) ama coz olarak yine bir sayim kondu ve AliExpress PL
-- eklendiginde ayni sebepten yeniden dustu. Sayim, "kendi kanitiyla eklendi"
-- ile "sessizce devraldi" arasindaki farki OLCEMEZ -- ikisi de sayiyi bir
-- artirir.
--
-- Olculen sey artik su: dogrulanmis her kayit ACIKCA LISTELENMIS olmali.
-- Listeye eklemek bilincli bir istir; tabloya yayilan bir dogrulama ise
-- listede olmayan satirlar uretir ve test onlari ADIYLA soyler.
select is_empty(
  $$select slug::text from public.merchants
     where network = 'awin' and terms_verified_at is not null
       and slug::text not in (
         -- 20260905120000: dizin kanitiyla doldurulan 14 firma
         'aosom-uk', 'avant-skincare', 'best-direct-uk', 'humanic-de',
         'interflora', 'joe-nimble-de', 'make-my-blinds', 'panda-london',
         'prive-by-zalando-es', 'schuh', 'sharkninja-uk',
         'the-knitting-network', 'velivery-de', 'viovet',
         -- 20260919160000: Awin'in yayimlanmis oran karti + feed listesinden
         -- dogrulanan uyelik. Kendi kaniti var, devralmadi.
         'aliexpress-pl'
       )$$,
  '12) dogrulama yalnizca ACIKCA listelenen kayitlarda -- devralan yok');

-- Listelenenler dogrulamayi KAYBETMEMIS olmali: yukaridaki iddia yalnizca
-- fazlasini yakalar, eksigini degil. `terms_verified_at` toplu bir gocle
-- silinseydi orasi bos kalir ve (12) yine gecerdi.
select is(
  (select count(*)::int from public.merchants
    where network = 'awin' and terms_verified_at is not null
      and slug::text in ('aosom-uk', 'schuh', 'viovet', 'aliexpress-pl')),
  4,
  '12b) ornek dogrulanmis kayitlar dogrulamayi kaybetmedi');

select * from finish();
rollback;
