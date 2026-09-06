-- ===========================================================================
-- Awin: hesap sahibinin bildirdigi DORT GERCEK MID kaydediliyor
-- ===========================================================================
--
-- 20260905110000 yirmi advertiser adayini kaydetmisti; 20260905120000 o
-- yirminin dizin verisini yazdi. Bu goc, o listede OLMAYAN dort programi
-- ekliyor. MID'ler hesap sahibi tarafindan dogrudan bildirildi:
--
--   BlazeVideo DE          25962
--   Back to the Office     61655
--   goettgen.de            17453
--   Ravin Crossbows       115809
--
-- ELIMIZDE OLAN TEK SEY BU: AD VE MID.
--
-- Ana sayfa, ulke, komisyon orani, cerez penceresi ve BASVURU DURUMU
-- bildirilmedi. Hicbiri tahmin edilmiyor:
--
--   homepage_url   NULL  -- "goettgen.de" adinda bir alan adi GECIYOR ama
--                           bir adin icindeki alan adi, o sitenin adresi
--                           oldugunun KANITI degil (www var mi? https mi?).
--   country_code   NULL  -- "BlazeVideo DE" Awin'in program adlandirmasinda
--                           Almanya'yi ima eder; ima kanit degildir. Ikisi
--                           icin ise hicbir ipucu yok.
--
-- Ikisi de yalnizca `prospect` durumunda NULL kalabilir
-- (merchants_known_needs_homepage / _country). Yani bu satirlar, eksikleri
-- doldurulmadan YAYINA ALINAMAZ -- kapi semada, insanin hafizasinda degil.
--
-- BASVURU != ONAY. application_status = 'not_started' secildi cunku bu alan
-- BIZIM KAYDIMIZI anlatir: kayitlarimizda bu dorde yapilmis bir basvuru
-- yok. Awin panosunda gercek bir onay gorulmeden hicbiri approved/active
-- yapilmayacak; `approved_at` da bu yuzden NULL (merchants_dates_match_-
-- decision zaten tersini engellerdi).
--
-- KOMISYON ORANI DOKUNULMADAN BIRAKILDI. Sutunun sema varsayilani %3 ve
-- NOT NULL; yani "bilinmiyor" yazilamiyor. Depodaki yerlesik cozum
-- terms_verified_at'tir: NULL kaldigi surece turetme katmani bu firmalari
-- "sartlari dogrulanmadi" gosterir ve merchants_active_needs_verified_terms
-- yayina almayi reddeder. Alti mevcut firma (worten-pt, grade-mobile, ...)
-- bugun tam olarak bu durumda; dordu de onlarla ayni kalibi izliyor.
--
-- CEREZ PENCERESI DE OYLE: varsayilan 1 gun ve record_conversion pencereyi
-- asan donusumu reddeder. 1 gun neredeyse kesinlikle YANLIS -- ama yanlis
-- olmasi onemli degil, cunku ayni kapi (dogrulanmamis sart) yayina almayi
-- zaten engelliyor. Uydurma bir 30 yazmak ise kapiyi acik birakip yanlisi
-- DOGRU gibi gosterirdi.
-- ===========================================================================

insert into public.merchants
  (slug, display_name, network, status, application_status, network_advertiser_id)
values
  ('blazevideo-de',      'BlazeVideo DE',      'awin', 'prospect', 'not_started', '25962'),
  ('back-to-the-office', 'Back to the Office', 'awin', 'prospect', 'not_started', '61655'),
  ('goettgen-de',        'goettgen.de',        'awin', 'prospect', 'not_started', '17453'),
  ('ravin-crossbows',    'Ravin Crossbows',    'awin', 'prospect', 'not_started', '115809')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- AYNI MID IKI KEZ KAYDEDILEMEZ
-- ---------------------------------------------------------------------------
--
-- Bir MID, ag icinde bir advertiser'i TEKIL olarak tanimlar. Bugune kadar
-- bunu koruyan bir kisit yoktu; benzersizlik yalnizca OLCULMUSTU (20 kayit,
-- yineleme yok) -- yani bir sonraki elle eklemede bozulabilirdi.
--
-- Neden simdi: bu goc MID tasiyan ilk EKLEME. Ayni advertiser iki farkli
-- slug ile girseydi tiklamalar iki kayda bolunur, mutabakat sessizce
-- tutmazdi. Sessiz oldugu icin de aylarca fark edilmezdi.
--
-- (network, network_advertiser_id) uzerinde: MID yalnizca kendi agi icinde
-- tekildir; iki farkli agin ayni sayiyi kullanmasi bir cakisma degildir.
-- Kismi indeks, MID'i olmayan `direct` magazalari disarida birakir.
create unique index if not exists merchants_network_advertiser_id_key
  on public.merchants (network, network_advertiser_id)
  where network_advertiser_id is not null;

-- ---------------------------------------------------------------------------
-- GOC KENDINI DOGRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  v_sayi integer;
begin
  -- 1) Dordu de var ve MID'leri dogru.
  select count(*) into v_sayi
    from public.merchants
   where (slug::text, network_advertiser_id) in (
     ('blazevideo-de','25962'), ('back-to-the-office','61655'),
     ('goettgen-de','17453'),   ('ravin-crossbows','115809'));
  if v_sayi <> 4 then
    raise exception 'DOGRULAMA 1: beklenen 4 kayit, bulunan %.', v_sayi;
  end if;

  -- 2) Hicbiri onaylanmis/aktif DEGIL. Bu gocun en onemli iddiasi:
  --    MID bilmek, onay almis olmak degildir.
  select count(*) into v_sayi
    from public.merchants
   where network_advertiser_id in ('25962','61655','17453','115809')
     and (status <> 'prospect' or application_status <> 'not_started'
          or approved_at is not null);
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 2: % kayit onaylanmis/aktif gorunuyor -- basvuru onay degildir.', v_sayi;
  end if;

  -- 3) Bilinmeyen alanlar UYDURULMADI.
  select count(*) into v_sayi
    from public.merchants
   where network_advertiser_id in ('25962','61655','17453','115809')
     and (homepage_url is not null or country_code is not null
          or terms_verified_at is not null or deeplink_template is not null);
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 3: % kayitta kaniti olmayan alan doldurulmus.', v_sayi;
  end if;

  -- 4) Mevcut 20 awin kaydina dokunulmadi. Genel magaza sayimi kullanilmiyor:
  --    `direct` magazalar bu gocun konusu degil ve sayilari baska sebeplerle
  --    degisebilir; o zaman bu kontrol ilgisiz bir sebepten duserdi.
  select count(*) into v_sayi from public.merchants where network = 'awin';
  if v_sayi <> 24 then
    raise exception 'DOGRULAMA 4: beklenen 24 awin magazasi, bulunan % -- mevcut kayitlar etkilenmis olabilir.', v_sayi;
  end if;

  -- 4b) Dort yeni kayit mevcut dogrulamalari DEVRALMADI: sart dogrulanmis
  --     awin firmasi sayisi 14'te kalmali.
  select count(*) into v_sayi
    from public.merchants where network = 'awin' and terms_verified_at is not null;
  if v_sayi <> 14 then
    raise exception 'DOGRULAMA 4b: dogrulanmis sart sayisi 14 olmali, bulunan %.', v_sayi;
  end if;

  -- 5) MID benzersizligi artik SEMADA korunuyor, yalnizca olculmus degil.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'merchants_network_advertiser_id_key'
  ) then
    raise exception 'DOGRULAMA 5: MID benzersizlik indeksi kurulmamis.';
  end if;

  raise notice
    'Dort Awin MID kaydedildi (25962, 61655, 17453, 115809); hicbiri onayli degil, '
    'bilinmeyen alanlar bos birakildi. MID benzersizligi artik kisitla korunuyor.';
end $$;
