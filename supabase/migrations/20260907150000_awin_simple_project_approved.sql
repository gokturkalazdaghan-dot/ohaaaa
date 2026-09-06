-- ===========================================================================
-- Awin: Simple Project (Shenzhen Cangyu Technology Co., Ltd.) — ONAYLANDI
-- ===========================================================================
--
-- ILK GERCEK ONAY. Bugune kadarki 24 kaydin hicbiri onayli degildi; bu,
-- panoda gorulmus bir katilimi kaydeden ilk goc.
--
-- KANIT (hesap sahibi, Awin panosu):
--   Programme        : Shenzhen Cangyu Technology Co., Ltd. / Simple Project
--   Date Joined      : 06/09/2026
--   Link status      : Online
--   Cookie           : 30 gun
--   Auto Validation  : 50 gun
--   Avg Payment Time : 49 gun
--   Total Products   : 23
--   Feed Last Updated: 15/05/2026
--   Mobile Optimised : Yes      ·  App Tracking: No
--
-- YAZILAN: application_status = 'approved', approved_at, cookie_window_days.
--
-- YAZILMAYAN VE NEDENI:
--
--   network_advertiser_id (MID)  Panoda gorulen bilgiler arasinda YOK.
--     MID olmadan deeplink sablonu kurulamaz: `buildAffiliateUrl` yalnizca
--     {url} {url_encoded} {tracking_id} {subid} yer tutucularini cozer;
--     sablonda cozulmemis bir {awinmid} kalirsa link URETILIR ama ag onu
--     ATFEDEMEZ -- tiklama gider, komisyon olusmaz ve hicbir yerde hata
--     gorunmez. Bu yuzden sablon da bos birakildi.
--
--   homepage_url                 Bildirilmedi. Ana sayfa yalnizca bir
--     gosterim alani degil GUVENLIK girdisi: allowedHostsForMerchant onu
--     yonlendirme hedefinin izinli alan adi listesine koyar. Uydurulan bir
--     ana sayfa, ya calisan linkleri reddeder ya da yanlis bir alan adini
--     izinli sayar.
--
--   country_code                 Bildirilmedi. Sirketin Shenzhen merkezli
--     olmasi PROGRAMIN hedef ulkesini soylemez. Ayrica country_code artik
--     countries tablosuna bagli (M2) ve 'CN' o tabloda YOK -- uydurma bir
--     deger zaten yabanci anahtardan donerdi.
--
--   default_commission_rate      Davet mesajindaki ifade "%10+". Bu bir
--     TABAN, bir oran degil. Sutun NOT NULL oldugu icin "bilinmiyor"
--     yazilamiyor; sema varsayilani (%3) yerinde birakildi ve dogruluk
--     iddiasi terms_verified_at ile ayrildi (asagida).
--
--   terms_verified_at            NULL BIRAKILDI -- bu gocun en onemli
--     karari. Cerez penceresi dogrulandi ama KOMISYON DOGRULANMADI.
--     Bu sutun `merchants_active_needs_verified_terms` kisitinin dayanagi:
--     doldurmak, yayina alma kapisini KALDIRMAK demekti. Yarim kanitla tam
--     dogrulama isareti koymak, korumanin kendisini kaldirir.
--
-- STATUS = 'prospect' KALIYOR. Programa kabul edildik (application_status)
-- ama ISLETIMSEL olarak hazir degiliz: MID, sablon ve feed yok. Sema bu
-- ayrimi zaten zorluyor -- merchants_awin_known_needs_mid, awin agindaki
-- prospect DISI her magazadan MID istiyor; merchants_known_needs_country ve
-- _needs_homepage de ayni sekilde. Yani bu satir, eksikleri kapatilmadan
-- yayina ALINAMAZ ve bunu hatirlamak zorunda olan bir insan yok.
--
-- CEREZ PENCERESI NEDEN SIMDI YAZILIYOR: sutunun varsayilani 1 GUN ve
-- record_conversion pencereyi asan donusumu REDDEDER. 30 yerine 1 kalsaydi,
-- ilk gunden sonraki her donusum sessizce cope giderdi. Bu deger panoda
-- acikca yaziyor; tahmin degil.
-- ===========================================================================

insert into public.merchants
  (slug, display_name, network, status, application_status,
   approved_at, cookie_window_days, notes)
values (
  'simple-project',
  'Simple Project',
  'awin',
  'prospect',
  'approved',
  timestamptz '2026-09-06 00:00:00+00',
  30,
  'Awin advertiser: Shenzhen Cangyu Technology Co., Ltd. — programme "Simple Project". '
  'Panodan (06/09/2026): Date Joined 06/09/2026, Link status Online, Cookie 30 gun, '
  'Auto Validation 50 gun, Average Payment Time 49 gun, Total Products 23, '
  'Feed Last Updated 15/05/2026, Mobile Optimised Yes, App Tracking No. '
  'Davet mesajinda komisyon "%10+" olarak gecti -- bu bir TABAN, kesin oran degil; '
  'bu yuzden default_commission_rate dogrulanmis sayilmadi. '
  'EKSIK: MID, deeplink sablonu, feed adresi, ana sayfa, ulke.'
)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- GOC KENDINI DOGRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_kayit record;
  v_sayi  integer;
begin
  select * into v_kayit from public.merchants where slug = 'simple-project';

  if v_kayit is null then
    raise exception 'DOGRULAMA 1: simple-project kaydi olusmadi.';
  end if;

  -- 2) Onay GERCEKTEN kaydedildi -- bu gocun varlik sebebi.
  if v_kayit.application_status <> 'approved' or v_kayit.approved_at is null then
    raise exception 'DOGRULAMA 2: onay kaydedilmemis (durum=%, tarih=%).',
      v_kayit.application_status, v_kayit.approved_at;
  end if;

  -- 3) Cerez penceresi 30 -- varsayilan 1 gunde KALMADI.
  if v_kayit.cookie_window_days <> 30 then
    raise exception 'DOGRULAMA 3: cerez penceresi 30 olmali, bulunan %.',
      v_kayit.cookie_window_days;
  end if;

  -- 4) Kaniti olmayan hicbir alan doldurulmadi.
  if v_kayit.network_advertiser_id is not null
     or v_kayit.deeplink_template is not null
     or v_kayit.homepage_url is not null
     or v_kayit.country_code is not null
     or v_kayit.terms_verified_at is not null then
    raise exception 'DOGRULAMA 4: kaniti olmayan bir alan doldurulmus.';
  end if;

  -- 5) KAPI CALISIYOR: bu haliyle yayina alinamaz. Onay tek basina yetmez;
  --    MID/sablon/dogrulanmis sart olmadan trafik gonderilemez.
  begin
    update public.merchants set status = 'active' where slug = 'simple-project';
    raise exception 'DOGRULAMA 5: eksik bilgiye ragmen yayina alinabildi -- kapi calismiyor.';
  exception
    when check_violation then
      null;  -- beklenen
  end;

  -- 6) Bu kayit mevcut dogrulamalari DEVRALMADI. Toplam sayim yerine kararli
  --    degismez olculuyor: terms_verified_at yalnizca 20260905120000'in
  --    dizin kanitiyla doldurdugu 14 firmada dolu olmali.
  select count(*) into v_sayi
    from public.merchants where network = 'awin' and terms_verified_at is not null;
  if v_sayi <> 14 then
    raise exception 'DOGRULAMA 6: dogrulanmis sart sayisi 14 olmali, bulunan %.', v_sayi;
  end if;

  raise notice
    'Simple Project onayi kaydedildi (Date Joined 06/09/2026, cerez 30 gun). '
    'MID/sablon/feed/ana sayfa/ulke YOK; yayina alma kapisi kapali.';
end $$;
