-- ===========================================================================
-- 97 — Ravin Crossbows dogrulanmis sartlari + iki magazaya US ulkesi
-- ===========================================================================
--
-- Bu dosyanin merkezindeki tehlike bir kisit ihlali degil, SESSIZ bir
-- varsayilan: Ravin'in cerez penceresi 1 gunde kalsaydi hicbir sey
-- kirilmazdi -- tiklamadan 24 saat sonra gelen her donusum yalnizca
-- reddedilirdi. Panelde "donusum yok" gorunurdu ve sebebi hicbir yerde
-- yazmazdi.
begin;
select plan(12);

-- --- 1-2: BU GOCUN SEBEBI -------------------------------------------------
select is(
  (select cookie_window_days from public.merchants where slug = 'ravin-crossbows'),
  68, '1) Ravin cerez penceresi 68 -- 1 gunluk sema varsayilanindan cikarildi');

select is(
  (select cookie_window_days from public.merchants where slug = 'simple-project'),
  30, '2) Simple Project 30 gunu bozulmadi');

-- --- 3: ulkeler -----------------------------------------------------------
-- Simple Project icin bu ozellikle onemli: sirket Cin merkezli ama PROGRAM
-- ABD pazarina calisiyor. Sirket adresinden ulke turetmek yanlis sonuc
-- verirdi; deger kullanici dogrulamasindan geldi.
select is(
  (select count(*)::int from public.merchants
    where slug in ('ravin-crossbows','simple-project') and country_code = 'US'),
  2, '3) iki magazanin da ulkesi US (kullanici dogrulamasi)');

-- --- 4-5: MID'ler ve tekillik --------------------------------------------
select is(
  (select network_advertiser_id from public.merchants where slug = 'ravin-crossbows'),
  '115809', '4) Ravin MID 115809 korundu');

select is(
  (select network_advertiser_id from public.merchants where slug = 'simple-project'),
  '158122', '5) Simple Project MID 158122 korundu');

-- --- 6: sablonlar kendi MID'ini SABIT tasiyor -----------------------------
select is(
  (select count(*)::int from public.merchants
    where (slug = 'ravin-crossbows' and deeplink_template like '%awinmid=115809%')
       or (slug = 'simple-project'  and deeplink_template like '%awinmid=158122%')),
  2, '6) her sablon kendi MID''ini sabit tasiyor');

-- --- 7: YER TUTUCU KALINTISI YOK -----------------------------------------
-- buildAffiliateUrl {awinmid} COZMEZ. Kalsaydi adres gecerli gorunur,
-- kullanici yonlendirilir, tiklama kaydedilir -- ama Awin atfetmez ve
-- komisyon hic olusmaz. Hicbir yerde hata gorunmez.
select is(
  (select count(*)::int from public.merchants
    where slug in ('ravin-crossbows','simple-project')
      and (position('{awinmid}' in deeplink_template) > 0
           or deeplink_template ~ '\{(?!url\}|url_encoded\}|tracking_id\}|subid\})[a-z_]+\}')),
  0, '7) cozulmemis / desteklenmeyen yer tutucu YOK');

-- --- 8: ACIK YONLENDIRME KORUMASI ----------------------------------------
-- Iki sablon da awin1.com'a gidiyor. Baska bir alan adina isaret etseydi
-- allowedHostsForMerchant'in urettigi listeyle uyusmaz ve yonlendirme
-- reddedilirdi -- ya da daha kotusu, izinli sayilan yanlis bir alan adi
-- acik yonlendirme yuzeyi olurdu.
select is(
  (select count(*)::int from public.merchants
    where slug in ('ravin-crossbows','simple-project')
      and deeplink_template like 'https://www.awin1.com/cread.php?%'),
  2, '8) iki sablon da awin1.com''a gidiyor');

-- --- 9: KOMISYON DOGRULANMADI --------------------------------------------
select is(
  (select count(*)::int from public.merchants
    where slug in ('ravin-crossbows','simple-project') and terms_verified_at is not null),
  0, '9) komisyon bildirilmedi -- sart dogrulama isareti konmadi');

-- --- 10: RAVIN ONAYLI DEGIL ----------------------------------------------
-- Cerez ve feed bilgisi Awin dizininde KATILMADAN da gorulebilir; katilim
-- beyan edilmedi. Basvuru onay degildir.
select is(
  (select application_status::text from public.merchants where slug = 'ravin-crossbows'),
  'not_started', '10) Ravin icin katilim beyan edilmedi -- onayli gosterilmiyor');

-- --- 11: FEED ADRESI UYDURULMADI -----------------------------------------
-- "Product Feed: Yes" feed'in VAR OLDUGUNU soyler, ADRESINI degil.
-- sources.endpoint_url NOT NULL; adres olmadan kaynak acilamaz ve acilmadi.
select is(
  (select count(*)::int from public.sources src
     join public.merchants m on m.id = src.merchant_id
    where m.slug in ('ravin-crossbows','simple-project')),
  0, '11) adres bildirilmeden kaynak acilmadi');

-- --- 12: KAPI GERCEK MI --------------------------------------------------
-- 9 yalnizca isaretin konmadigini soyler; asil soru bunun yayina almayi
-- ENGELLEYIP engellemedigi.
select throws_ok(
  $$ update public.merchants set status = 'active' where slug = 'ravin-crossbows' $$,
  '23514', null,
  '12) dogrulanmamis komisyonla yayina alinamiyor');

select * from finish();
rollback;
