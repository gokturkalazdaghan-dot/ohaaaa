-- ===========================================================================
-- 95 — Simple Project: ILK GERCEK ONAY
-- ===========================================================================
--
-- Bu dosyanin sinadigi tek cumle: ONAY ALMAK, YAYINA HAZIR OLMAK DEGILDIR.
--
-- Kaydin var olmasini olcmek yetmez; onemli olan, elimizde olmayan bilginin
-- (MID, sablon, dogrulanmis komisyon) yerine bir varsayilan konmadigi ve
-- eksikligin gercek bir KAPI olarak durdugudur.
begin;
select plan(11);

-- --- 1-3: onay kaydedildi -------------------------------------------------
select is(
  (select application_status::text from public.merchants where slug = 'simple-project'),
  'approved', '1) programa kabul edildi');

select is(
  (select approved_at from public.merchants where slug = 'simple-project'),
  timestamptz '2026-09-06 00:00:00+00', '2) Date Joined 06/09/2026 kaydedildi');

select is(
  (select network from public.merchants where slug = 'simple-project'),
  'awin', '3) awin agina bagli');

-- --- 4: CEREZ PENCERESI -- bu gocun sessiz para kaybini onleyen alani -----
-- Sutun varsayilani 1 GUN ve record_conversion pencereyi asan donusumu
-- reddeder. 1'de kalsaydi ilk gunden sonraki her donusum cope giderdi.
select is(
  (select cookie_window_days from public.merchants where slug = 'simple-project'),
  30, '4) cerez penceresi 30 gun -- 1 gunluk varsayilanda kalmadi');

-- --- 5-6: KANITI OLMAYAN ALAN DOLDURULMADI --------------------------------
/*
 * 5) BU IDDIA YON DEGISTIRDI.
 *
 * Bu dosya yazildiginda MID bildirilmemisti ve iddia "MID ve sablon BOS"
 * diyordu -- 20260907150000'in kaniti olmayani doldurmadigini kanitliyordu.
 * MID sonradan dogrulandi (158122) ve 20260907160000 ikisini de yazdi.
 *
 * Iddia silinmedi: ayni olgunun bugunku dogru yuzunu olcuyor. Silinseydi
 * plan 10'dan 9'a iner ve "onay ile MID AYRI olaylardir" ayrimi bu dosyada
 * izsiz kalirdi. Sirali gercek: once onay (150000), sonra MID (160000).
 */
select is(
  (select count(*)::int from public.merchants
    where slug = 'simple-project'
      and network_advertiser_id = '158122'
      and deeplink_template is not null),
  1, '5) MID ve sablon 20260907160000 ile dolduruldu (onaydan AYRI bir adim)');

/*
 * 6) BU IDDIA DA DARALDI.
 *
 * Ilk halinde "ana sayfa VE ulke bos" diyordu: bu dosya yazildiginda ikisi
 * de bildirilmemisti ve sirketin Shenzhen merkezli olmasindan ulke
 * turetilmedigini kanitliyordu. Ulkeyi sonradan hesap sahibi dogruladi
 * (US -- sirket Cin merkezli ama PROGRAM ABD pazarina calisiyor; tam da bu
 * yuzden sirket adresinden turetmek yanlis olurdu) ve 20260907170000 yazdi.
 *
 * Iddia artik iki olguyu birden kilitliyor: dogrulanan deger YAZILDI,
 * dogrulanmayan deger HALA BOS. Ikincisi onemli cunku ana sayfa ALIM ICIN
 * ZORUNLU: normalize.ts validateUrl, allowedHosts BOSSA her urun adresini
 * reddeder -- ana sayfa gelmeden feed'den tek satir bile gecmez.
 */
select is(
  (select format('%s/%s',
            coalesce(country_code, '(bos)'),
            coalesce(homepage_url, '(bos)'))
     from public.merchants where slug = 'simple-project'),
  'US/(bos)',
  '6) ulke dogrulandi (US) ama ana sayfa hala bos -- alim bu haliyle sifir urun yazar');

-- --- 7: KOMISYON DOGRULANMIS SAYILMADI ------------------------------------
-- Davet mesajindaki "%10+" bir TABAN, bir oran degil. terms_verified_at'i
-- doldurmak, yayina alma kapisini kaldirmak olurdu.
select is(
  (select terms_verified_at from public.merchants where slug = 'simple-project'),
  null::timestamptz,
  '7) sartlar dogrulanmis sayilmadi -- "%10+" kesin oran degildir');

-- --- 8-9: KAPI GERCEK MI --------------------------------------------------
-- 5-7 yalnizca alanlarin bos oldugunu soyler. Asil soru: bu eksiklik yayina
-- almayi ENGELLIYOR mu? Engellemeseydi bos alanlar bir belge degil yalnizca
-- bir gecikme olurdu.
select throws_ok(
  $$ update public.merchants set status = 'active' where slug = 'simple-project' $$,
  '23514', null,
  '8) sablon/dogrulanmis sart olmadan yayina alinamiyor');

-- --- 9: mevcut kayitlarin dogrulamasi devralinmadi -----------------------
-- Toplam sayim BILEREK kullanilmiyor: tablo her yeni advertiser'da buyur ve
-- sayima bagli bir iddia, gocla ilgisiz bir sebepten duserdi. Kararli olan
-- degismez, `terms_verified_at`in yalnizca dizin kanitiyla doldurulmus 14
-- firmada dolu olmasi.
--
-- ...ve iddia tam da bunu yazdiktan sonra BUTUN awin kayitlarini sayiyordu.
-- Boyle bir sayim "dogrulama devralinmadi" degil "kimse bir daha
-- dogrulanmadi" der. 20260907340000 Alison'i KENDI kanitiyla (komisyon %20
-- VE cerez 30 gun) ekledigi anda, bu gocla hicbir ilgisi olmayan bir
-- sebepten dustu.
--
-- Dizinden dogrulanan kume artik KARARLI bir yuklemle sabit: o 14 firma,
-- bizim sira numaramizi (partner_rank) tasiyan tek gruptur.
select is(
  (select count(*)::int from public.merchants
    where network = 'awin' and terms_verified_at is not null
      and partner_rank is not null),
  14,
  '9) dizinden dogrulanan 14 firma hala 14 -- kume buyumedi');

-- Ve BU GOCUN oznesi icin iddia sayimdan cikip DOGRUDAN kayda bakiyor:
-- Simple Project'in kendisi dogrulama devralmadi. Onceki hali, Simple
-- Project dogrulama devralsa bile baska bir kayit kaybettiginde toplami
-- 14'te tutup GECEBILIRDI.
select is(
  (select terms_verified_at from public.merchants where slug = 'simple-project'),
  null,
  '9b) Simple Project dogrulama devralmadi -- sartlari bildirilmedi');


/*
 * 10) BU IDDIA DA YON DEGISTIRDI -- ve artik daha degerli bir sey soyluyor.
 *
 * Eskiden "MID olmadan prospect disina cikilamaz" diyordu; MID geldi, o
 * kapi asildi. Yerine KALAN kapinin tam olarak ne oldugunu olcuyor:
 * eksik uc alan (dogrulanmis sart, ulke, ana sayfa) tamamlandiginda magaza
 * yayina alinabiliyor.
 *
 * 8. iddia "alinamiyor" der, 10. iddia "neden alinamadigini" kanitlar. Ikisi
 * birlikte olmadan, her seyi reddeden bozuk bir kisit da testi gecerdi.
 * Islem rollback ile bitiyor; uretimde hicbir sey degismiyor. EN SONDA
 * duruyor cunku terms_verified_at'i yaziyor ve pgTAP iddialari ayni
 * islemde kosar -- once gelseydi 9. iddianin saydigi 14'u 15 yapardi.
 */
select lives_ok(
  $$ update public.merchants
        set status = 'active',
            terms_verified_at = now(),
            country_code = 'US',
            homepage_url = 'https://ornek.gecersiz'
      where slug = 'simple-project' $$,
  '10) eksik uc alan tamamlaninca yayina alinabiliyor -- kalan engel tam olarak bu ucu');

select * from finish();
rollback;
