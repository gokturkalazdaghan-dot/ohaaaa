-- ===========================================================================
-- Simple Project: MID DUZELTMESI (158122 -> 99013) + ana sayfa
--
-- KANIT: gercek urun verisi dosyasi (advertiser 99013, 636 satir, 62 kolon).
-- Dort bagimsiz alan ayni sonucu veriyor:
--   1) advertiser_id kolonu          -> 99013  (636/636 satir)
--   2) aw_deep_link icindeki awinmid -> 99013  (636/636 satir)
--   3) aw_deep_link icindeki awinaffid -> 3074081 (BIZIM yayinci kimligimiz;
--      yani bu feed bizim hesabimiza tanimli)
--   4) link alan adi -> simpleprojectus.com, brand -> simpleprojectus
--      (program adi "simpleprojectus" ile ortusuyor)
--
-- aw_deep_link'i AWIN'IN KENDISI uretir; bir reklamverenin gercek awinmid'i
-- icin bundan daha yetkili bir kaynak yok.
--
-- NEDEN ONEMLI: 158122 ile kalsaydi deeplink sablonu her tiklamayi YANLIS
-- reklamverene gonderirdi. Tiklama kaydi yesil gorunur, komisyon hicbir
-- zaman gelmezdi -- arizanin en pahali bicimi. Ayrica magaza izolasyonu
-- denetimi feed'i reddediyordu (olculdu: 636 satir goruldu, 0 urun yazildi).
--
-- Ana sayfa da ayni dosyadan geldi: normalize.ts izinli alan adini
-- merchants.homepage_url'den turetiyor ve bos oldugu icin HER urun adresi
-- reddediliyordu. Uydurulmadi; 636 urun adresinin tamami bu alan adinda.
-- ===========================================================================

update public.merchants
   set network_advertiser_id = '99013',
       homepage_url          = 'https://simpleprojectus.com',
       deeplink_template     =
         'https://www.awin1.com/cread.php'
         '?awinmid=99013'
         '&awinaffid=3074081'
         '&clickref={subid}'
         '&ued={url_encoded}',
       notes = coalesce(notes, '') ||
         ' | MID DUZELTILDI (12/09/2026): 158122 -> 99013. Kanit: gercek urun '
         'verisi dosyasinda advertiser_id=99013 ve Awin in urettigi '
         'aw_deep_link icinde awinmid=99013 (636/636 satir), awinaffid=3074081. '
         'Ana sayfa simpleprojectus.com ayni dosyadan dogrulandi (636/636 urun '
         'adresi bu alan adinda). Feed bicimi: Google Shopping semasi.'
 where slug = 'simple-project';

-- Kaynak da ayni reklamverene baglanir; tetikleyici ayrisirsa reddeder.
update public.sources
   set expected_advertiser_id = '99013',
       -- DOGRULANMIS esleme (gercek baslik satirina karsi: 0 eksik alan).
       field_mapping = jsonb_build_object(
         'external_id', 'id',
         'title',       'title',
         'price',       'price',
         'url',         'link',
         'gtin',        'gtin',
         'brand',       'brand',
         'image',       'image_link',
         'description', 'description',
         'stock',       'availability',
         'category',    'google_product_category',
         'merchant_id', 'advertiser_id'
       )
 where slug = 'simple-project-awin-f2281';

do $$
declare m record; s record; v_bto text;
begin
  select * into m from public.merchants where slug = 'simple-project';
  select * into s from public.sources  where slug = 'simple-project-awin-f2281';

  if m.network_advertiser_id <> '99013' then
    raise exception 'DOGRULAMA 1: MID 99013 olmaliydi, bulunan %.', m.network_advertiser_id;
  end if;

  if m.homepage_url is null then
    raise exception 'DOGRULAMA 2: ana sayfa bos -- izinli alan adi turetilemez.';
  end if;

  -- Sablon kendi MID ini tasimali ve cozulmemis yer tutucu birakmamali.
  if position('awinmid=99013' in m.deeplink_template) = 0 then
    raise exception 'DOGRULAMA 3: sablon 99013 tasimiyor -- tiklamalar yanlis atfedilir.';
  end if;
  if position('awinmid=158122' in m.deeplink_template) > 0 then
    raise exception 'DOGRULAMA 4: eski yanlis MID sablonda kalmis.';
  end if;
  if position('{awinmid}' in m.deeplink_template) > 0 then
    raise exception 'DOGRULAMA 5: sablonda cozulmemis {awinmid} var.';
  end if;

  -- Deterministik bag: kaynagin iddiasi magazanin MID i ile ayni mi.
  if s.expected_advertiser_id <> m.network_advertiser_id then
    raise exception 'DOGRULAMA 6: kaynak % bekliyor, magaza %.',
      s.expected_advertiser_id, m.network_advertiser_id;
  end if;

  -- Esleme feed'in GERCEK kolonlarini gostermeli.
  if s.field_mapping->>'merchant_id' <> 'advertiser_id'
     or s.field_mapping->>'external_id' <> 'id'
     or s.field_mapping->>'url' <> 'link' then
    raise exception 'DOGRULAMA 7: alan haritasi feed in gercek kolonlariyla uyusmuyor.';
  end if;

  -- Katalogda AWIN SARMALAYICISI saklanmaz: url mağazanin kendi adresi olmali.
  if s.field_mapping->>'url' = 'aw_deep_link' then
    raise exception 'DOGRULAMA 8: url aw_deep_link e eslenmis -- cift sarmalama.';
  end if;

  -- BTO / MID 61655 DEGISMEDI.
  select network_advertiser_id into v_bto
    from public.merchants where slug = 'back-to-the-office';
  if v_bto is distinct from '61655' then
    raise exception 'DOGRULAMA 9: BTO MID i degismis -> %.', v_bto;
  end if;

  raise notice
    'Simple Project MID 99013 olarak duzeltildi, ana sayfa simpleprojectus.com, '
    'esleme gercek feed baslikina karsi dogrulandi. Kaynak HALA ETKIN DEGIL: '
    'terms_verified_at yok (aktiflik kisiti). BTO/61655 degismedi.';
end $$;
