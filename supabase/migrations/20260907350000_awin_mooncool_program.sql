-- ===========================================================================
-- Mooncool (Awin MID 66494): kismi kanit, kismi kayit
-- ===========================================================================
--
-- Hesap sahibinin Awin panosundan bildirdikleri:
--
--   Mooncool           MID 66494
--   Cookie             30 gun
--   Auto Validation    50 gun
--   Pazar              US / CA
--   Product Feed       5
--   Mobile Optimised   No
--   App Tracking       No
--
-- Alison'dan (20260907340000) FARKI, bu gocun butun icerigi: KOMISYON ORANI
-- BILDIRILMEDI. Alison'da komisyon VE cerez vardi, `terms_verified_at`
-- doldurulmustu. Burada yalnizca cerez var -- Ravin'deki durumun aynisi --
-- ve isaret NULL kaliyor.
--
-- ---------------------------------------------------------------------------
-- "PRODUCT FEED: 5" -- SAYIYI YAZMIYORUZ, VARLIGI YAZIYORUZ
-- ---------------------------------------------------------------------------
--
-- Bu satirin en kolay hatasi `product_count = 5` yazmak olurdu. Yazmiyoruz.
--
-- Alison'in satirinda alan adi "Products: 5594" idi -- URUN sayan bir sutun.
-- Burada alan adi "Product Feed: 5". Awin panosunda bunlar AYRI sutunlar ve
-- 5 buyuk olasilikla FEED sayisidir, urun sayisi degil. Simple Project'in
-- ayni panodan okunan satiri da ikisini ayri ayri tasiyordu ("Total Products
-- 23", ayrica feed bilgisi).
--
-- Ikisinden hangisi oldugundan EMIN DEGILIZ. 5'i `product_count`'a yazmak,
-- katalog dolulugu hakkinda bilmedigimiz bir sey iddia etmek olurdu; bir
-- sonraki okuyan "Mooncool'un 5 urunu var" diye anlar ve program puanlamasi
-- bunu gercek bir katalog buyuklugu sayar.
--
-- Ama alanin ADI belirsiz degil: adi "Product Feed" ve degeri bos degil.
-- Sayi ne sayarsa saysin, BIR FEED VAR. Bu yuzden:
--
--   feed_available = true      <- alanin adindan kesin cikan sey
--   product_count  = NULL      <- birimi belirsiz oldugu icin yazilmiyor
--   ham dize       terms'te    <- "Product Feed: 5", insan cozsun diye
--
-- feed_available = true iken tek `sources` satiri OLMAMASI celiski degil,
-- durumun kendisidir: feed'in VAR OLDUGUNU biliyoruz, ADRESINI bilmiyoruz.
-- Adres `sources.endpoint_url` NOT NULL'dur ve uydurulmadi.
--
-- ---------------------------------------------------------------------------
-- IKI TABLO KOMISYON KONUSUNDA AYNI SEYI SOYLEMEK ZORUNDA
-- ---------------------------------------------------------------------------
--
-- `programs.commission_rate` NULL kabul eder: "ag yayinlamamis" yazilabilir.
-- `merchants.default_commission_rate` NOT NULL ve varsayilani %3 -- orada
-- "bilinmiyor" YAZILAMAZ, satir zorunlu olarak bir oran tasir.
--
-- Yani merchants satiri, tek basina okundugunda, Mooncool'un komisyonunu %3
-- BILIYORMUS gibi gorunur. Bunu yalanlayan tek sey `terms_verified_at`in
-- NULL olmasidir (sutunun tanimi: "NULL ise ikisi de sema varsayilanidir").
--
-- Bu yuzden asagidaki dogrulama iki tablonun komisyon konusunda AYNI seyi
-- soyledigini sinar: program NULL, magaza dogrulanmamis. Biri degisip digeri
-- kalsaydi, %3'luk varsayilan sessizce "dogrulanmis oran" hâline gelirdi.
--
-- ---------------------------------------------------------------------------
-- YAZILMAYANLAR
-- ---------------------------------------------------------------------------
--   komisyon              Bildirilmedi. programs'ta NULL; merchants'ta sema
--                         varsayilani, terms_verified_at ile isaretsiz.
--   ana sayfa             Bildirilmedi. ALIM ICIN ZORUNLU: allowedHosts bos
--                         kaldiginda normalize.ts her urun adresini reddeder.
--   feed adresi           Uydurulmadi.
--   para birimi           US -> USD bir cikarim olurdu; bildirilmedi.
--   product_count         Yukaridaki sebeple.
--   Auto Validation 50    Bilgi olarak notlarda. Donusum durumunu agin
--                         postback'i yurutur, yerel bir sayac degil; bu
--                         yuzden kolon acmak okunmayan bir alan olurdu.
--   Mobile Optimised: No  Notlarda. Trafigimizin cogu mobil; bu, ileride
--   App Tracking: No      onceliklendirmede TARTILACAK bir olumsuzluk, ama
--                         bugun hicbir kod okumuyor.
-- ===========================================================================

-- --- 1) Program: agin dizininde gordugumuz sey -----------------------------
insert into public.programs (
  network, network_program_id, merchant_name,
  country_code, market_code, commission_rate, cookie_window_days,
  feed_available, product_count, application_state, last_verified_at, terms
) values (
  'awin', '66494', 'Mooncool',
  'US', 'US', null, 30,
  true, null, 'DISCOVERED', now(),
  'Awin panosu (07/09/2026, hesap sahibi bildirimi): Cookie 30 gun, Auto '
  'Validation 50 gun, pazar US/CA, "Product Feed: 5", Mobile Optimised: No, '
  'App Tracking: No. KOMISYON BILDIRILMEDI. "5" degerinin birimi belirsiz '
  '(feed sayisi mi urun sayisi mi) -- bu yuzden product_count YAZILMADI; '
  'feed_available yalnizca alanin adindan cikariliyor. Feed adresi ve ana '
  'sayfa bildirilmedi. Katilim/onay BEYAN EDILMEDI.'
)
on conflict (network, network_program_id) do nothing;

-- --- 2) Magaza: ortaklik kaydimiz ------------------------------------------
insert into public.merchants (
  slug, display_name, country_code, countries,
  network, network_advertiser_id, status, application_status,
  cookie_window_days, deeplink_template, notes
) values (
  'mooncool', 'Mooncool', 'US', array['US','CA']::char(2)[],
  'awin', '66494', 'prospect', 'not_started',
  30,
  'https://www.awin1.com/cread.php'
  '?awinmid=66494'
  '&awinaffid=3074081'
  '&clickref={subid}'
  '&ued={url_encoded}',
  'Awin panosu (07/09/2026): MID 66494, cerez 30 gun, Auto Validation 50 gun, '
  'pazar US/CA, "Product Feed: 5", Mobile Optimised: No, App Tracking: No. '
  'KOMISYON BILDIRILMEDI -- default_commission_rate sema varsayilani (%3) '
  'olarak duruyor ve terms_verified_at NULL: bu satirdaki oran BILGI DEGIL, '
  'varsayilandir. Cerez 30''a cekildi; 1 gunluk varsayilanda kalsaydi '
  'tiklamadan 24 saat sonraki her donusum sessizce reddedilirdi. EKSIK: '
  'komisyon, ana sayfa, feed adresi. Katilim/onay BEYAN EDILMEDI.'
)
on conflict (slug) do nothing;

-- --- 3) Magaza <-> ag programi bagi ----------------------------------------
-- commission_rate BURADA DA NULL: bag, magaza satirindaki %3 varsayilanini
-- kopyalayip ona ikinci bir "kaynak" gorunumu vermez.
insert into public.merchant_network_links (
  merchant_id, network, network_program_id, program_id,
  tracking_id, deeplink_template, commission_rate, cookie_window_days,
  is_primary, is_enabled
)
select m.id, 'awin', '66494', p.id,
       '3074081', m.deeplink_template, null, 30,
       true, true
  from public.merchants m
  join public.programs  p on p.network = 'awin' and p.network_program_id = '66494'
 where m.slug = 'mooncool'
on conflict (network, network_program_id) do nothing;

-- ---------------------------------------------------------------------------
-- GOC KENDINI DOGRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  m record;
  p record;
  l record;
  v_sayi integer;
begin
  select * into m from public.merchants where slug = 'mooncool';
  select * into p from public.programs  where network = 'awin' and network_program_id = '66494';
  select * into l from public.merchant_network_links
   where network = 'awin' and network_program_id = '66494';

  if m is null or p is null or l is null then
    raise exception 'DOGRULAMA 1: magaza/program/bag ucundan biri yazilmadi.';
  end if;

  -- 2) MID her uc kayitta AYNI.
  if m.network_advertiser_id <> '66494' or p.network_program_id <> '66494'
     or l.network_program_id <> '66494' then
    raise exception 'DOGRULAMA 2: MID kayitlar arasinda ayristi.';
  end if;

  -- 3) CEREZ 30. Varsayilan 1'de kalsaydi 24 saat sonraki her donusum
  --    sessizce reddedilirdi.
  if m.cookie_window_days <> 30 or p.cookie_window_days is distinct from 30 then
    raise exception 'DOGRULAMA 3: cerez penceresi 30 olmali (magaza=%, program=%).',
      m.cookie_window_days, p.cookie_window_days;
  end if;

  -- 4) BU GOCUN ASIL IDDIASI: iki tablo komisyon konusunda AYNI seyi
  --    soyluyor. Program NULL ("ag yayinlamamis"), magaza dogrulanmamis.
  --    Biri degisip digeri kalsaydi %3'luk sema varsayilani sessizce
  --    "dogrulanmis oran" hâline gelirdi.
  if p.commission_rate is not null then
    raise exception 'DOGRULAMA 4a: bildirilmeyen komisyon programa yazilmis (%).',
      p.commission_rate;
  end if;
  if m.terms_verified_at is not null then
    raise exception 'DOGRULAMA 4b: komisyon bilinmezken sartlar dogrulanmis isaretlenmis.';
  end if;
  if l.commission_rate is not null then
    raise exception 'DOGRULAMA 4c: ag bagi bilinmeyen komisyona bir deger vermis (%).',
      l.commission_rate;
  end if;

  -- 5) "5" URUN SAYISI OLARAK YAZILMADI. Birimi belirsizdi.
  if p.product_count is not null then
    raise exception 'DOGRULAMA 5: birimi belirsiz "5" urun sayisi olarak yazilmis (%).',
      p.product_count;
  end if;

  -- 6) Ama feed'in VARLIGI yazildi -- alanin adindan kesin cikan sey.
  if p.feed_available is distinct from true then
    raise exception 'DOGRULAMA 6: "Product Feed" alani doluyken feed yok sayilmis.';
  end if;

  -- 7) FEED VAR AMA ADRESI YOK: celiski degil, durumun kendisi. Kaynak
  --    acilmadi, dolayisiyla urun de girmedi.
  select count(*) into v_sayi from public.sources where merchant_id = m.id;
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 7: adres bildirilmeden % kaynak acilmis.', v_sayi;
  end if;

  select count(*) into v_sayi from public.products where merchant_id = m.id;
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 8: feed adresi yokken % urun yazilmis.', v_sayi;
  end if;

  -- 9) ONAY UYDURULMADI ve magaza yayinda degil. Zaten alinamazdi:
  --    terms_verified_at ve homepage_url yok.
  if m.status <> 'prospect' or m.application_status <> 'not_started'
     or m.approved_at is not null or p.application_state <> 'DISCOVERED' then
    raise exception 'DOGRULAMA 9: onay beyan edilmeden onayli/yayinda gosterilmis.';
  end if;

  -- 10) ANA SAYFA UYDURULMADI. Alison'da bildirilmisti, burada bildirilmedi;
  --     yoklugu, alim katmaninin allowedHosts kapisini kapali tutar.
  if m.homepage_url is not null then
    raise exception 'DOGRULAMA 10: bildirilmeyen ana sayfa yazilmis (%).', m.homepage_url;
  end if;

  -- 11) US/CA korundu.
  if m.country_code is distinct from 'US'
     or m.countries is distinct from array['US','CA']::char(2)[] then
    raise exception 'DOGRULAMA 11: pazar kaybedildi (ulke=%, ulkeler=%).',
      m.country_code, m.countries;
  end if;

  -- 12) PARA BIRIMI CIKARILMADI.
  if p.currency is not null then
    raise exception 'DOGRULAMA 12: bildirilmeyen para birimi cikarimla yazilmis (%).',
      p.currency;
  end if;

  -- 13) SABLON kendi MID'ini SABIT tasiyor, cozulmemis yer tutucu yok,
  --     hedef awin1.com.
  if position('awinmid=66494' in coalesce(m.deeplink_template, '')) = 0 then
    raise exception 'DOGRULAMA 13a: sablon kendi MID''ini tasimiyor.';
  end if;
  if m.deeplink_template ~ '\{(?!url\}|url_encoded\}|tracking_id\}|subid\})[a-z_]+\}' then
    raise exception 'DOGRULAMA 13b: sablonda desteklenmeyen yer tutucu var.';
  end if;
  if position('https://www.awin1.com/cread.php' in m.deeplink_template) <> 1 then
    raise exception 'DOGRULAMA 13c: sablon awin1.com disina isaret ediyor.';
  end if;

  -- 14) BAG programa bagli ve BIRINCIL.
  if l.merchant_id <> m.id or l.program_id is distinct from p.id
     or not l.is_primary or not l.is_enabled then
    raise exception 'DOGRULAMA 14: magaza-program bagi eksik ya da birincil degil.';
  end if;

  -- 15) ALISON'A DOKUNULMADI: onun dogrulanmis sarti ve urun sayisi yerinde.
  if (select terms_verified_at from public.merchants where slug = 'alison') is null
     or (select product_count from public.programs
          where network = 'awin' and network_program_id = '120101') <> 5594 then
    raise exception 'DOGRULAMA 15: onceki advertiser kaydi bozuldu.';
  end if;

  -- 16) DIZINDEN DOGRULANAN 14 FIRMA DEVRALINMADI.
  select count(*) into v_sayi
    from public.merchants
   where network = 'awin' and terms_verified_at is not null and partner_rank is not null;
  if v_sayi <> 14 then
    raise exception 'DOGRULAMA 16: dizinden dogrulanan firma sayisi 14 olmali, bulunan %.',
      v_sayi;
  end if;

  raise notice
    'Mooncool yazildi: MID 66494, cerez 30 gun, US/CA, feed VAR (adresi yok). '
    'Komisyon bildirilmedi -- programda NULL, magazada varsayilan ve '
    'dogrulanmamis. "Product Feed: 5" birimi belirsiz oldugu icin urun sayisi '
    'yazilmadi. YAYINDA DEGIL.';
end $$;
