-- ===========================================================================
-- Simple Project: MID DOGRULANDI -> deeplink sablonu kuruluyor
-- ===========================================================================
--
-- 20260907150000 onayi kaydetmisti ama MID bildirilmemisti; bu yuzden
-- network_advertiser_id ve deeplink_template BOS birakilmisti. MID artik
-- hesap sahibi tarafindan dogrulandi:
--
--   awinmid          : 158122
--   Awin program ID  : simpleprojectus
--   Advertiser       : Shenzhen Cangyu Technology Co., Ltd. / Simple Project
--
-- SABLON NEDEN TAM METIN OLARAK YAZILIYOR (yer tutucuyla degil):
--
-- `buildAffiliateUrl` yalnizca dort yer tutucuyu cozer:
--   {url} · {url_encoded} · {tracking_id} · {subid}
--
-- `{awinmid}` bu listede YOKTUR ve olmamalidir -- her reklamveren icin
-- farklidir. Sablonda cozulmemis bir {awinmid} kalsaydi sonuc SESSIZ bir
-- gelir kaybi olurdu: `new URL()` suslu parantezi sorgu dizesinde korur,
-- yani adres GECERLI gorunur, kullanici yonlendirilir, tiklama kaydedilir --
-- ama Awin `awinmid={awinmid}` degerini tanimaz ve tiklama ATFEDILMEZ.
-- Hicbir yerde hata gorunmez. Bu yuzden MID buraya SABIT olarak giriyor.
--
-- Sablonun bicimi packages/shared/src/providers/awin.ts icindeki
-- AWIN_DEEPLINK_TEMPLATE_SHAPE ile birebir ayni; yalnizca {awinmid} ->
-- 158122 degisti. Yayinci kimligi (awinaffid=3074081) operator tarafindan
-- bildirilmisti ve bir sir DEGILDIR -- her ortaklik linkinde acikca gorunur.
--
-- clickref={subid} ESLEMESI PARANIN GERI DONUS YOLU: Awin, tiklama aninda
-- gonderdigimiz clickref'i donusum raporunda geri verir; bizim tarafta o
-- deger clicks.subid'dir. Bu alan olmadan donusum bir tiklamaya
-- baglanamaz -- komisyon olusur ama KIMIN getirdigi bilinmez.
--
-- HALA YAZILMAYANLAR (bu goc onlari doldurmuyor):
--   homepage_url        Bildirilmedi. ALIM ICIN ZORUNLU: normalize.ts
--                       validateUrl, allowedHosts BOSSA her urun adresini
--                       reddeder (fail-closed). Yani ana sayfa olmadan
--                       feed'den tek satir bile gecmez.
--   country_code        Bildirilmedi. Program ID'deki "us" eki ABD'yi IMA
--                       eder ama Awin'in kendi tanimlayicisidir, beyan
--                       degildir. Uydurulmadi.
--   terms_verified_at   Komisyon hala "%10+" -- bir taban, kesin oran degil.
--
-- Yani magaza bu gocten sonra da YAYINA ALINAMAZ; kapi acik degil, yalnizca
-- bir menteşesi takildi.
-- ===========================================================================

update public.merchants
   set network_advertiser_id = '158122',
       deeplink_template =
         'https://www.awin1.com/cread.php'
         '?awinmid=158122'
         '&awinaffid=3074081'
         '&clickref={subid}'
         '&ued={url_encoded}',
       notes = coalesce(notes, '') ||
         ' | MID dogrulandi (06/09/2026): awinmid=158122, Awin program ID '
         '"simpleprojectus". Deeplink sablonu kuruldu. HALA EKSIK: ana sayfa '
         '(alim icin zorunlu), ulke, dogrulanmis komisyon, feed adresi.'
 where slug = 'simple-project';

-- ---------------------------------------------------------------------------
-- GOC KENDINI DOGRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v record;
begin
  select * into v from public.merchants where slug = 'simple-project';

  if v is null then
    raise exception 'DOGRULAMA 1: simple-project kaydi yok -- 20260907150000 uygulanmamis.';
  end if;

  -- 2) MID yazildi.
  if v.network_advertiser_id is distinct from '158122' then
    raise exception 'DOGRULAMA 2: MID 158122 olmali, bulunan %.', v.network_advertiser_id;
  end if;

  -- 3) Sablon dort parcayi da tasiyor.
  if v.deeplink_template is null
     or position('awinmid=158122' in v.deeplink_template) = 0
     or position('awinaffid=3074081' in v.deeplink_template) = 0
     or position('clickref={subid}' in v.deeplink_template) = 0
     or position('ued={url_encoded}' in v.deeplink_template) = 0 then
    raise exception 'DOGRULAMA 3: sablon eksik -> %', coalesce(v.deeplink_template, '(NULL)');
  end if;

  -- 4) BU GOCUN EN ONEMLI IDDIASI: cozulmemis {awinmid} KALMADI.
  --    Kalsaydi link uretilir, tiklama kaydedilir ve komisyon SESSIZCE
  --    kaybolurdu -- hicbir hata gorunmeden.
  if position('{awinmid}' in v.deeplink_template) > 0 then
    raise exception 'DOGRULAMA 4: sablonda cozulmemis {awinmid} kaldi -- tiklamalar atfedilmez.';
  end if;

  -- 5) Sablonda buildAffiliateUrl'in TANIMADIGI baska bir yer tutucu yok.
  --    Bilinmeyen her yer tutucu duz metin olarak adrese girer.
  if v.deeplink_template ~ '\{(?!url\}|url_encoded\}|tracking_id\}|subid\})[a-z_]+\}' then
    raise exception 'DOGRULAMA 5: sablonda desteklenmeyen yer tutucu var -> %', v.deeplink_template;
  end if;

  -- 6) MAGAZA HALA YAYINA ALINAMAZ. MID bir menteşedir, kapinin kendisi degil:
  --    dogrulanmis sart olmadan aktiflik reddedilmeli.
  begin
    update public.merchants set status = 'active' where slug = 'simple-project';
    raise exception 'DOGRULAMA 6: dogrulanmamis sartla yayina alinabildi -- kapi calismiyor.';
  exception
    when check_violation then
      null;  -- beklenen
  end;

  -- 7) Kaniti gelmeyen alanlar hala bos.
  if v.homepage_url is not null or v.country_code is not null
     or v.terms_verified_at is not null then
    raise exception 'DOGRULAMA 7: bildirilmemis bir alan doldurulmus.';
  end if;

  raise notice
    'Simple Project MID 158122 kaydedildi ve deeplink sablonu kuruldu. '
    'Ana sayfa/ulke/dogrulanmis komisyon hala yok; magaza yayina alinamaz.';
end $$;
