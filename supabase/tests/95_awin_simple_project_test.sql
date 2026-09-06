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
select plan(10);

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
select is(
  (select count(*)::int from public.merchants
    where slug = 'simple-project'
      and (network_advertiser_id is not null or deeplink_template is not null)),
  0, '5) MID ve deeplink sablonu bos -- panoda bildirilmedi');

select is(
  (select count(*)::int from public.merchants
    where slug = 'simple-project'
      and (homepage_url is not null or country_code is not null)),
  0, '6) ana sayfa ve ulke bos -- sirketin Shenzhen merkezli olmasi programin hedef ulkesi degildir');

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

select throws_ok(
  $$ update public.merchants
        set status = 'pending', country_code = 'DE', homepage_url = 'https://ornek.gecersiz'
      where slug = 'simple-project' $$,
  '23514', null,
  '9) awin aginda prospect disi her durum MID istiyor');

-- --- 10: mevcut kayitlarin dogrulamasi devralinmadi ----------------------
-- Toplam sayim BILEREK kullanilmiyor: tablo her yeni advertiser'da buyur ve
-- sayima bagli bir iddia, gocla ilgisiz bir sebepten duserdi. Kararli olan
-- degismez, `terms_verified_at`in yalnizca dizin kanitiyla doldurulmus 14
-- firmada dolu olmasi.
select is(
  (select count(*)::int from public.merchants
    where network = 'awin' and terms_verified_at is not null),
  14,
  '10) dogrulanmis sart sayisi hala 14 -- Simple Project dogrulama devralmadi');

select * from finish();
rollback;
