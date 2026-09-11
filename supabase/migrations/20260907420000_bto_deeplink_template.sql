-- ===========================================================================
-- Back to the Office: EKSIK DEEPLINK SABLONU
-- ===========================================================================
--
-- BTO, dort Awin magazasi icinde sablonu OLMAYAN tek magazaydi -- ve tam da
-- ilk gelir denemesini yaptigimiz magaza. Uc ayri yerde ayni bosluga
-- dusuyordu:
--
--   1. YONLENDIRME. `/git/[offerId]` sablonu bulamayinca `null` doner ve
--      kullaniciya 404 gosterir: tiklama hic gerceklesmez, komisyon da yok.
--   2. ALIM. `allowedHostsForMerchant` izinli alan adlarini ana sayfa VE
--      sablondan turetir. Sablon yokken yalnizca
--      `www.backtotheoffice.co.uk` izinli kalir; Awin feed'i ise
--      `www.awin1.com` tiklama adresleri tasir -- OLCULDU: 500 satirlik
--      pilotta izinli host listesi tek elemanliydi.
--   3. YAYIN. `merchants_active_needs_template` kisiti sablonsuz magazayi
--      zaten yayina aldirmaz.
--
-- ---------------------------------------------------------------------------
-- SABLON UYDURULMUYOR
-- ---------------------------------------------------------------------------
--
-- Bicim depoda ZATEN VAR ve pgTAP ile sabitlenmis: Alison (120101), Mooncool
-- (66494) ve WANAYOU (127939) ayni `cread.php` sablonunu tasiyor. Degisen tek
-- sey MID -- ve 61655 hesap sahibi tarafindan bildirildi, Awin advertiser
-- dizini CSV'sinde dogrulandi ve feed'in HER SATIRINDA `merchant_id` olarak
-- goruldu (35.952/35.952). Yayinci kimligi 3074081 de ayni sekilde yerlesik.
--
-- Yani burada yeni bir bilgi URETILMIYOR; var olan ve dogrulanmis iki kimlik,
-- depodaki mevcut bicime yerlestiriliyor.
--
-- ---------------------------------------------------------------------------
-- BU MAGAZAYI YAYINA ALMAZ
-- ---------------------------------------------------------------------------
--
-- `status` 'prospect' KALIYOR. Yayin icin ikinci bir kapi daha var:
-- `merchants_active_needs_verified_terms` -> `terms_verified_at`. BTO'nun
-- komisyon orani Awin dizininde 0-0 ("yayinlanmamis") ve feed'in
-- `commission_group` sutunu 35.878 satirin TAMAMINDA bos. Yani oran
-- elimizdeki hicbir kaynaktan olculemiyor ve uydurulmayacak.
--
-- Bu goc iki kapidan BIRINI aciyor, digerini acikca kapali birakiyor.
-- ===========================================================================

update public.merchants
   set deeplink_template =
         'https://www.awin1.com/cread.php'
         '?awinmid=61655'
         '&awinaffid=3074081'
         '&clickref={subid}'
         '&ued={url_encoded}',
       notes = coalesce(notes || ' | ', '') ||
         'DEEPLINK SABLONU EKLENDI (07/09/2026): sablon YOKTU ve bu uc yeri '
         'birden kiriyordu -- yonlendirme 404 donuyordu, alim hatti '
         'awin1.com tiklama adreslerini "magazaya ait degil" diye eliyordu '
         've yayin kapisi kapaliydi. Bicim Alison/Mooncool/WANAYOU ile AYNI; '
         'yalnizca MID degisiyor (61655: dizin CSV''si + feed''in her '
         'satirindaki merchant_id ile dogrulandi). YAYINA ALINMADI: komisyon '
         'orani hâlâ bilinmiyor.'
 where slug = 'back-to-the-office'
   and deeplink_template is null;

-- ---------------------------------------------------------------------------
-- GOC KENDINI DOGRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  m record;
  v_sayi integer;
begin
  select * into m from public.merchants where slug = 'back-to-the-office';
  if m is null then
    raise exception 'DOGRULAMA 1: BTO magazasi yok.';
  end if;

  -- 2) SABLON VAR ve KENDI MID'ini tasiyor.
  if m.deeplink_template is null then
    raise exception 'DOGRULAMA 2: sablon yazilmadi.';
  end if;
  if position('awinmid=61655' in m.deeplink_template) = 0 then
    raise exception 'DOGRULAMA 2b: sablon kendi MID''ini tasimiyor.';
  end if;
  if position('awinaffid=3074081' in m.deeplink_template) = 0 then
    raise exception 'DOGRULAMA 2c: yayinci kimligi eksik -- komisyon bize '
      'atfedilmezdi.';
  end if;

  -- 3) COZULMEMIS YER TUTUCU YOK. Kalsaydi link URETILIR, tiklama KAYDEDILIR
  --    ve komisyon sessizce kaybolurdu -- en pahali sessiz hata.
  if m.deeplink_template ~ '\{(?!url\}|url_encoded\}|tracking_id\}|subid\})[a-z_]+\}' then
    raise exception 'DOGRULAMA 3: sablonda desteklenmeyen yer tutucu var.';
  end if;
  if position('{url_encoded}' in m.deeplink_template) = 0 then
    raise exception 'DOGRULAMA 3b: sablon hedef adresi tasimiyor.';
  end if;

  -- 4) HEDEF awin1.com. Baska bir yere isaret etseydi tiklama ag disina
  --    cikar ve atif kurulmazdi.
  if position('https://www.awin1.com/cread.php' in m.deeplink_template) <> 1 then
    raise exception 'DOGRULAMA 4: sablon awin1.com disina isaret ediyor.';
  end if;

  -- 5) DIGER UC MAGAZANIN SABLONU ILE AYNI BICIM. Bu iddia "bicim uydurmadim"
  --    demenin sinanabilir hâli: bicim bozulursa burasi duser.
  select count(*) into v_sayi
    from public.merchants
   where network = 'awin'
     and deeplink_template like 'https://www.awin1.com/cread.php?awinmid=%'
     and deeplink_template like '%&awinaffid=3074081&clickref={subid}&ued={url_encoded}';
  if v_sayi < 4 then
    raise exception 'DOGRULAMA 5: ortak sablon bicimini tasiyan magaza sayisi '
      '% -- en az 4 olmaliydi.', v_sayi;
  end if;

  -- 6) MAGAZA YAYINA ALINMADI. Acilan kapi sablon; komisyon kapisi KAPALI.
  if m.status <> 'prospect' then
    raise exception 'DOGRULAMA 6: magaza yayina alinmis (%) -- komisyon orani '
      'hâlâ bilinmiyor.', m.status;
  end if;
  if m.terms_verified_at is not null then
    raise exception 'DOGRULAMA 6b: bilinmeyen komisyon dogrulanmis sayilmis.';
  end if;

  raise notice
    'BTO deeplink sablonu eklendi (MID 61655 / yayinci 3074081). Yonlendirme '
    've alim host listesi artik calisabilir. YAYINDA DEGIL: komisyon orani '
    'bilinmiyor.';
end $$;
