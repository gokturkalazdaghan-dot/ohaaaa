-- ===========================================================================
-- 94 — Dort Awin MID kaydi
-- ===========================================================================
--
-- Bu test iki yonlu olmak ZORUNDA. Yalnizca "kayitlar var mi" sorsaydi,
-- her alani uydurma degerle dolduran bir goc de gecerdi -- ve bu gocun tum
-- meselesi tam olarak o alanlari DOLDURMAMAKTI.
begin;
select plan(16);

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
 * IKINCI KEZ DARALTILDI. 20260907390000 Back to the Office (61655) icin
 * Awin advertiser dizinini (hesap sahibinin disa aktardigi CSV) getirdi:
 * primaryRegion GB, displayUrl https://www.backtotheoffice.co.uk/. Yani o
 * advertiser artik "kaniti gelmeyen" kumede DEGIL.
 *
 * Kural degismedi, kumenin uyeleri degisti. Iddia silinseydi "kanit yoksa
 * yazma" kurali bu dosyada izsiz kalirdi; daraltilmasaydi gercek bir
 * ilerlemeyi hata sayardi.
 *
 * KANITI GELMEYEN IKI: 25962, 17453.
 */
select is(
  (select count(*)::int from public.merchants
    where network_advertiser_id in ('25962','17453')
      and (homepage_url is not null or country_code is not null)),
  0, '8) kaniti gelmeyen ikide ana sayfa ve ulke hala bos');

-- Ve kanit GELENDE deger gercekten yazildi: iddia "hicbir zaman yazma"ya
-- donusmesin diye. Ikisi olmadan, her seyi bos birakan bozuk bir goc de
-- 8. iddiayi gecerdi.
select is(
  (select country_code || ' ' || (homepage_url is not null)::text
     from public.merchants where network_advertiser_id = '61655'),
  'GB true',
  '8b) kaniti gelen advertiser''da ulke ve ana sayfa dizinden yazildi');

-- FIXTURE DARALDI (07/09/2026): 61655 ARTIK KANITLI.
--
-- Kural degismedi -- MID kaniti olmadan yonlendirme sablonu yazilmaz -- ama
-- 61655 icin kanit GELDI: MID hesap sahibi tarafindan bildirildi, Awin
-- advertiser dizini CSV'sinde dogrulandi ve In Stock feed'inin 35.952
-- satirinin HEPSINDE `merchant_id` olarak goruldu. Sablonu o yuzden yazildi
-- (20260907420000) ve YOKLUGU uc yeri birden kiriyordu: yonlendirme 404,
-- alim hatti awin1.com adreslerini eliyor, yayin kapisi kapali.
--
-- Kaniti HÂLÂ gelmeyen ikisi burada kaliyor; asagidaki ikinci iddia da
-- kanitlinin gercekten yazildigini sabitliyor. Ikisi birlikte olmadan,
-- "hepsini bos birak" ya da "hepsini doldur" gibi bozuk bir goc gecerdi.
select is(
  (select count(*)::int from public.merchants
    where network_advertiser_id in ('25962','17453')
      and deeplink_template is not null),
  0, '9a) kaniti gelmeyen ikide yonlendirme sablonu hala bos');

select ok(
  (select deeplink_template from public.merchants
    where network_advertiser_id = '61655')
    like 'https://www.awin1.com/cread.php?awinmid=61655&%',
  '9a2) kaniti gelen advertiser''da sablon KENDI MID''iyle yazildi');

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
-- Kararli olan degismez su: `terms_verified_at` yalnizca 20260905120000'in
-- dizin kanitiyla doldurdugu 14 firmada dolu. Yeni eklenen hicbir kayit onu
-- DEVRALMAZ; devralsaydi merchants_active_needs_verified_terms kapisi o
-- kayitlar icin sessizce acilirdi.
--
-- AYNI TUZAGA IKINCI KEZ DUSMUSTU. Iddia yukaridaki uyariyi yazdiktan sonra
-- yine BUTUN awin kayitlarini sayiyordu: "network = 'awin' and
-- terms_verified_at is not null = 14". Bu, "dogrulama devralinmadi" degil
-- "kimse bir daha dogrulanmadi" demektir -- ve 20260907340000 Alison'i KENDI
-- kanitiyla (komisyon %20 VE cerez 30 gun, hesap sahibi bildirimi) eklediginde
-- bu gocle hicbir ilgisi olmayan bir sebepten dustu.
--
-- Kume artik KARARLI bir yuklemle sabitleniyor: 20260905120000'in doldurdugu
-- 14 firma, bizim sira numaramizi (partner_rank) tasiyan tek gruptur. Yeni bir
-- kayit o kumeye ancak kendisine sira numarasi VERILEREK girebilir -- yani
-- sessizce degil.
select is(
  (select count(*)::int from public.merchants
    where network = 'awin' and terms_verified_at is not null
      and partner_rank is not null),
  14,
  '12) dizinden dogrulanan 14 firma hala 14 -- kume buyumedi');

-- Ve BU GOCUN kendi dort MID'i icin iddia GEVSEMEDI, sertlesti: sayim degil,
-- dogrudan o dort kayit sinaniyor. Onceki hali, dort kayittan biri dogrulama
-- devralsa bile baska bir kayit dogrulamasini kaybettiginde toplami 14'te
-- tutup GECEBILIRDI.
select is(
  (select count(*)::int from public.merchants
    where network_advertiser_id in ('25962','61655','17453','115809')
      and terms_verified_at is not null),
  0,
  '13) bu gocun dort MID''i dogrulama devralmadi');

select * from finish();
rollback;
