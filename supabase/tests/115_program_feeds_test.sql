-- ===========================================================================
-- program_feeds: cok feedli advertiser, olculmus sayilar, sirsiz adres
-- ===========================================================================
--
-- Bu dosyanin sinadigi uc sey:
--   1. Bir programin BIRDEN COK feed'i kaydedilebiliyor (BTO'nun ikinci
--      feed'i tek sutunlu semaya sigmiyordu ve hic kaydedilemiyordu).
--   2. AGIN dedigi ile BIZIM olctugumuz ayri hucrelerde duruyor.
--   3. Indirme adresi anahtari TASIYAMIYOR -- yorumla degil, kisitla.
-- ===========================================================================
begin;
select plan(14);

-- --- 1: COK FEEDLI ADVERTISER KAYDEDILEBILIYOR ----------------------------
-- Bu gocun varlik sebebi. Dizin olcumu: advertiser'larin %20'si cok feedli
-- ve bunlar butun feed'lerin %47'sini tasiyor.
select is(
  (select count(*)::int from public.program_feeds pf
     join public.programs p on p.id = pf.program_id
    where p.network_program_id = '61655'),
  2,
  '1) BTO''nun iki feed''i de kayitli');

-- --- 2: DORT FEED, DORT KIMLIK --------------------------------------------
select is(
  (select string_agg(network_feed_id, ',' order by network_feed_id)
     from public.program_feeds where network = 'awin'),
  '102827,108580,111515,111663',
  '2) dort feed kimligiyle kayitli');

-- --- 3: PARA BIRIMI OLCULDU, ULKEDEN CIKARILMADI --------------------------
-- GB -> GBP bir cikarimdir. Buradaki deger feed'in kendi `currency`
-- sutunundan geldi ve 116.417 satirin tamaminda ayniydi.
select is(
  (select string_agg(network_feed_id || '=' || measured_currency, ',' order by network_feed_id)
     from public.program_feeds where network = 'awin'),
  '102827=GBP,108580=USD,111515=USD,111663=GBP',
  '3) para birimleri feed''den OKUNDU');

-- --- 4: AGIN SAYISI ILE OLCULEN SATIR SAYISI TUTUYOR ----------------------
select is(
  (select count(*)::int from public.program_feeds
    where network_item_count is distinct from measured_item_count),
  0,
  '4) agin bildirdigi satir sayisi indirmeyle birebir tutuyor');

-- --- 5: HATTAN GECEN, OLCULEN SATIRDAN FARKLI BIR SEY ---------------------
-- "Fiyati var" ile "hattan gecer" ayni sey degil: 102827'de fiyati olan iki
-- satir makul ust sinirda elendi. Esitlemek olcumu cikarima cevirirdi.
select is(
  (select ingestable_count || '/' || measured_item_count
     from public.program_feeds where network_feed_id = '102827'),
  '116415/116417',
  '5) hattan gecen sayi hattin ciktisi -- fiyat varliginin degil');

-- --- 6: ALISON: AG 5.594 DER, HAT 0 GECIRIR -------------------------------
select is(
  (select network_item_count || '/' || ingestable_count
     from public.program_feeds where network_feed_id = '111515'),
  '5594/0',
  '6) agin iddiasi ile olcum ayri hucrelerde duruyor');

-- --- 7: HATTAN GECEN, OLCULEN SATIRDAN BUYUK OLAMAZ -----------------------
-- Olsaydi sayi bir yerden URETILMIS demektir; hat girdisinden fazlasini
-- cikaramaz.
select is(
  (select count(*)::int from public.program_feeds
    where ingestable_count > measured_item_count),
  0,
  '7) hicbir feed girdisinden fazla urun cikarmiyor');

-- --- 8: ADRESTE HAM ANAHTAR YOK -------------------------------------------
select is(
  (select count(*)::int from public.program_feeds where feed_url ~ '[0-9a-f]{24,}'),
  0,
  '8) hicbir adres ham anahtar tasimiyor');

-- --- 9-10: ...VE TASIYAMAZ. 8. iddia "kimse yazmamis" der; bunlar
--           YAZILAMAYACAGINI kanitlar.
select throws_ok(
  $$ update public.program_feeds
        set feed_url = 'https://productdata.awin.com/datafeed/download/apikey/'
                    || '0123456789abcdef0123456789abcdef/fid/111515/'
      where network_feed_id = '111515' $$,
  '23514', null,
  '9) ham anahtar tasiyan adres yazilamiyor');

select throws_ok(
  $$ update public.program_feeds
        set feed_url = 'https://productdata.awin.com/datafeed/download/apikey/'
                    || 'gizli-bir-deger/fid/111515/'
      where network_feed_id = '111515' $$,
  '23514', null,
  '10) /apikey/ segmentinden sonra yer tutucu ZORUNLU');

-- --- 11: PROGRAM BASINA TEK BIRINCIL FEED ---------------------------------
-- Iki birincil olsaydi `programs`a hangisinin aynalanacagi kararsiz kalirdi.
select throws_ok(
  $$ update public.program_feeds set is_primary = true
      where network_feed_id = '111663' $$,
  '23505', null,
  '11) bir programa ikinci birincil feed eklenemiyor');

-- --- 12: AYNA CALISIYOR ---------------------------------------------------
-- `programs` uzerindeki feed sutunlari artik TURETILMIS. Iki yerde birbirinden
-- habersiz iki gercek olusamaz.
select is(
  (select p.network_feed_id || '/' || p.feed_access || '/' || p.currency
     from public.programs p where p.network_program_id = '61655'),
  '102827/verified/GBP',
  '12) birincil feed programs''a aynalandi (para birimi dahil)');

-- --- 13: FAIL-CLOSED KISIT HÂLÂ YERINDE -----------------------------------
-- Adres yoksa "cekebiliyoruz" denemez. Fixture olarak WANAYOU kullaniliyor:
-- feed'i GERCEKTEN yok (dizinin 577 satirinda MID 127939 gecmiyor).
select throws_ok(
  $$ insert into public.program_feeds (program_id, network, network_feed_id, feed_access)
     select id, 'awin', 'adressiz-test', 'verified' from public.programs
      where network_program_id = '127939' $$,
  '23514', null,
  '13) adressiz feed ''verified'' isaretlenemiyor');

-- --- 14: KAYNAK ACMAK YAYINA ALMAK DEGILDIR -------------------------------
-- BTO'nun kaynagi acildi (fid 111663 dogrulandi). Ama magaza YAYINDA DEGIL:
-- `loadSources` yalnizca `merchants.status='active'` kaynaklari alim hattina
-- sokar ve BTO'nun komisyon orani Awin dizininde yayinlanmamis oldugu icin
-- `terms_verified_at` NULL. Yani yapilandirma hazir, alim KAPALI -- ve bunu
-- tutan sey bir yorum degil, `merchants_active_needs_verified_terms` kisiti.
-- FEED DOGRULANDI + SARTLAR GELDI -> MAGAZA YAYINDA (20260907430000).
--
-- Onceki hâli "kaynak acildi ama yayina alinmadi" diyordu; eksik olan tek
-- sey komisyon oraniydi ve o geldi. Simdi sinanan sey, yayinin iki kapisinin
-- da GERCEKTEN saglanmis olmasi -- durumu elle 'active' yapip kapilari bos
-- birakan bir goc burada duser.
select is(
  (select status::text
       || '/' || (terms_verified_at is not null)::text
       || '/' || (deeplink_template is not null)::text
     from public.merchants where slug = 'back-to-the-office'),
  'active/true/true',
  '14) magaza yayinda ve yayin kapilarinin ikisi de dolu');

select * from finish();
rollback;
