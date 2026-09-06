-- ===========================================================================
-- Ravin Crossbows: dogrulanmis sartlar + iki magazaya ulke
-- ===========================================================================
--
-- Hesap sahibi iki advertiser icin dogrulanmis bilgi bildirdi:
--
--   Ravin Crossbows (US)   MID 115809 · Cookie 68 gun · Product Feed: Yes
--   Simple Project (US)    MID 158122 · Cookie 30 gun · Product Feed: Yes
--                          (Shenzhen Cangyu Technology Co., Ltd.)
--
-- MID'ler zaten yerinde: 115809 20260907140000 ile, 158122 20260907160000
-- ile yazilmisti. Bu goc onlara DOKUNMAZ -- yalnizca yeni dogrulanan
-- alanlari ekler. (network, network_advertiser_id) tekil indeksi de aynen
-- duruyor; bu goc hicbir MID degistirmedigi icin onu sinamiyor bile.
--
-- ---------------------------------------------------------------------------
-- BU GOCUN ASIL SEBEBI: RAVIN'IN CEREZ PENCERESI 1 GUNDU
-- ---------------------------------------------------------------------------
--
-- 20260907140000 Ravin'i yalnizca ad + MID ile kaydetmisti; cerez penceresi
-- sema varsayilaninda kaldi: 1 GUN. Gercegi 68.
--
-- `record_conversion` pencereyi asan donusumu REDDEDER. Yani Ravin bugun
-- yayina alinsaydi, tiklamadan 24 saat sonra gelen HER donusum sessizce
-- reddedilirdi -- kod hatasi olmadan, log'da bir sey gorunmeden, panelde
-- yalnizca "donusum yok" olarak. 68 gunluk bir pencerede satislarin ezici
-- cogunlugu ilk 24 saatin DISINDA gerceklesir; yani kayip neredeyse
-- tamaminin kaybi olurdu.
--
-- Bu, "varsayilan deger = sessiz yanlis" kaliginin en pahali ornegi ve
-- deponun bu konudaki cizgisi net: bilinmeyen alan bos birakilir, bilinen
-- alan YAZILIR.
--
-- ---------------------------------------------------------------------------
-- ULKE: KULLANICI TARAFINDAN DOGRULANDI
-- ---------------------------------------------------------------------------
--
-- Ikisi de US. Daha once yazilmamisti cunku elimde yalnizca CIKARIM vardi:
-- Awin program ID'sindeki "us" eki ve sirketin Shenzhen merkezli olmasi.
-- Ikisi de beyan degildi. Simdi hesap sahibi acikca dogruladi.
--
-- Simple Project icin bu ozellikle onemliydi: sirket Cin merkezli ama
-- PROGRAM ABD pazarina calisiyor. Sirket adresinden ulke turetmek tam da
-- burada yanlis sonuc verirdi.
--
-- 'US' countries tablosunda var (M1); yabanci anahtar bu yuzden geciyor.
--
-- ---------------------------------------------------------------------------
-- "PRODUCT FEED: YES" NASIL ISLENIYOR
-- ---------------------------------------------------------------------------
--
-- Bu, feed'in VAR OLDUGUNU soyleyen dogrulanabilir bir metadata -- ama
-- ADRESINI vermiyor. Feed adresleri `sources` tablosunda yasar ve adres
-- olmadan bir source satiri acilamaz (endpoint_url NOT NULL).
--
-- Bu yuzden bilgi `notes` alanina, mevcut yapiyi degistirmeden yaziliyor.
-- Yeni bir sutun ya da paralel bir "feed var mi" mekanizmasi kurulmadi:
-- adres geldiginde bilginin gidecegi yer zaten sources'tir; ikinci bir
-- kaynak acmak, iki kopyanin zamanla ayrismasi demek olurdu.
--
-- ---------------------------------------------------------------------------
-- YAZILMAYANLAR
-- ---------------------------------------------------------------------------
--   default_commission_rate  Ikisi icin de bildirilmedi. Simple Project'in
--                            davet mesajindaki "%10+" bir TABAN'di; Ravin
--                            icin hicbir oran verilmedi.
--   terms_verified_at        NULL kaliyor. Cerez dogrulandi, KOMISYON
--                            DOGRULANMADI. Bu sutun
--                            merchants_active_needs_verified_terms'in
--                            dayanagi; doldurmak yayina alma kapisini
--                            KALDIRMAK olurdu.
--   homepage_url             Bildirilmedi. ALIM ICIN ZORUNLU: normalize.ts
--                            validateUrl, allowedHosts BOSSA her urun
--                            adresini reddeder. Ana sayfa olmadan feed'den
--                            tek satir bile gecmez.
--   feed adresi              Uydurulmadi.
--
-- RAVIN ONAYLI SAYILMIYOR. Hesap sahibi Ravin icin bir katilim/onay beyan
-- etmedi; cerez ve feed bilgisi Awin dizininde katilmadan da gorulebilir.
-- application_status 'not_started' kaliyor -- basvuru onay degildir.
-- ===========================================================================

-- --- Ravin Crossbows: sartlar + sablon + ulke ------------------------------
update public.merchants
   set cookie_window_days = 68,
       country_code = 'US',
       deeplink_template =
         'https://www.awin1.com/cread.php'
         '?awinmid=115809'
         '&awinaffid=3074081'
         '&clickref={subid}'
         '&ued={url_encoded}',
       notes = coalesce(notes || ' | ', '') ||
         'Awin panosu (06/09/2026): MID 115809, Cookie 68 gun, Product Feed: Yes, '
         'ulke US (kullanici dogrulamasi). Cerez penceresi 1 gunluk sema '
         'varsayilanindan 68''e cekildi -- 1''de kalsaydi tiklamadan 24 saat '
         'sonraki her donusum sessizce reddedilirdi. EKSIK: feed adresi, ana '
         'sayfa, komisyon orani. Katilim/onay BEYAN EDILMEDI.'
 where slug = 'ravin-crossbows';

-- --- Simple Project: ulke --------------------------------------------------
update public.merchants
   set country_code = 'US',
       notes = coalesce(notes || ' | ', '') ||
         'Ulke US olarak kullanici tarafindan dogrulandi (sirket Cin merkezli '
         'ama PROGRAM ABD pazarina calisiyor -- sirket adresinden ulke '
         'turetmek burada yanlis sonuc verirdi). Product Feed: Yes, adres '
         'henuz bildirilmedi.'
 where slug = 'simple-project';

-- ---------------------------------------------------------------------------
-- GOC KENDINI DOGRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  s record;
  v_sayi integer;
begin
  select * into r from public.merchants where slug = 'ravin-crossbows';
  select * into s from public.merchants where slug = 'simple-project';

  if r is null or s is null then
    raise exception 'DOGRULAMA 1: iki magazadan biri yok.';
  end if;

  -- 2) BU GOCUN SEBEBI: Ravin'in cerez penceresi artik 68.
  if r.cookie_window_days <> 68 then
    raise exception 'DOGRULAMA 2: Ravin cerez penceresi 68 olmali, bulunan % -- '
      '1 gunde kalsaydi 24 saat sonraki her donusum sessizce reddedilirdi.',
      r.cookie_window_days;
  end if;

  -- 3) Simple Project'in 30'u BOZULMADI.
  if s.cookie_window_days <> 30 then
    raise exception 'DOGRULAMA 3: Simple Project cerez penceresi 30 olmali, bulunan %.',
      s.cookie_window_days;
  end if;

  -- 4) Ikisinin de ulkesi US.
  if r.country_code is distinct from 'US' or s.country_code is distinct from 'US' then
    raise exception 'DOGRULAMA 4: ulkeler US olmali (ravin=%, simple=%).',
      r.country_code, s.country_code;
  end if;

  -- 5) MID'lere DOKUNULMADI.
  if r.network_advertiser_id is distinct from '115809'
     or s.network_advertiser_id is distinct from '158122' then
    raise exception 'DOGRULAMA 5: MID degismis (ravin=%, simple=%).',
      r.network_advertiser_id, s.network_advertiser_id;
  end if;

  -- 6) Iki sablon da kendi MID'ini SABIT tasiyor.
  if position('awinmid=115809' in coalesce(r.deeplink_template, '')) = 0
     or position('awinmid=158122' in coalesce(s.deeplink_template, '')) = 0 then
    raise exception 'DOGRULAMA 6: sablonlardan biri kendi MID''ini tasimiyor.';
  end if;

  -- 7) COZULMEMIS YER TUTUCU YOK. buildAffiliateUrl {awinmid} cozmez;
  --    kalsaydi link uretilir, tiklama kaydedilir ve komisyon SESSIZCE
  --    kaybolurdu. Yalnizca desteklenen dort yer tutucu kalabilir.
  if position('{awinmid}' in r.deeplink_template) > 0
     or position('{awinmid}' in s.deeplink_template) > 0 then
    raise exception 'DOGRULAMA 7a: sablonda cozulmemis {awinmid} kaldi.';
  end if;

  if r.deeplink_template ~ '\{(?!url\}|url_encoded\}|tracking_id\}|subid\})[a-z_]+\}'
     or s.deeplink_template ~ '\{(?!url\}|url_encoded\}|tracking_id\}|subid\})[a-z_]+\}' then
    raise exception 'DOGRULAMA 7b: sablonda desteklenmeyen yer tutucu var.';
  end if;

  -- 8) ACIK YONLENDIRME KORUMASI BOZULMADI: iki sablon da awin1.com'a
  --    gidiyor. Hedef alan adi degisseydi allowedHostsForMerchant'in
  --    urettigi liste ile uyusmaz ve yonlendirme reddedilirdi.
  if position('https://www.awin1.com/cread.php' in r.deeplink_template) <> 1
     or position('https://www.awin1.com/cread.php' in s.deeplink_template) <> 1 then
    raise exception 'DOGRULAMA 8: sablon awin1.com disina isaret ediyor.';
  end if;

  -- 9) HICBIRI YAYINA ALINAMAZ: komisyon dogrulanmadi.
  if r.terms_verified_at is not null or s.terms_verified_at is not null then
    raise exception 'DOGRULAMA 9a: komisyon dogrulanmadan sart dogrulama isareti konmus.';
  end if;

  begin
    update public.merchants set status = 'active'
     where slug in ('ravin-crossbows', 'simple-project');
    raise exception 'DOGRULAMA 9b: dogrulanmamis komisyonla yayina alinabildi.';
  exception
    when check_violation then
      null;  -- beklenen
  end;

  -- 10) Ravin ONAYLI SAYILMADI -- katilim beyan edilmedi.
  if r.application_status <> 'not_started' or r.approved_at is not null then
    raise exception 'DOGRULAMA 10: Ravin onayli gosterilmis ama katilim beyan edilmedi.';
  end if;

  -- 11) Feed adresi UYDURULMADI: iki magazanin da kaynagi yok.
  select count(*) into v_sayi
    from public.sources src
    join public.merchants m on m.id = src.merchant_id
   where m.slug in ('ravin-crossbows', 'simple-project');
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 11: adres bildirilmeden % kaynak acilmis.', v_sayi;
  end if;

  -- 12) Dogrulanmis sart sayisi hala 14 -- bu goc hicbir dogrulama devretmedi.
  select count(*) into v_sayi
    from public.merchants where network = 'awin' and terms_verified_at is not null;
  if v_sayi <> 14 then
    raise exception 'DOGRULAMA 12: dogrulanmis sart sayisi 14 olmali, bulunan %.', v_sayi;
  end if;

  raise notice
    'Ravin cerez penceresi 1 -> 68, sablon kuruldu; iki magazanin da ulkesi US. '
    'Komisyon/feed/ana sayfa yok; ikisi de yayina alinamaz.';
end $$;
