-- ============================================================================
-- ALIEXPRESS PL: KOMİSYON KATMANLI, KAPASİTE DAR
-- ----------------------------------------------------------------------------
-- Bu göçte az kalsın yapılacak hata şuydu: feed'leri ÜRÜN SAYISINA göre
-- seçmek. En büyük üç kategori feed'i elektronik ve elektronik %2,60
-- ödüyor -- giyimin (%8) üçte biri. Kapasitenin çoğu en düşük ödeyen
-- kategoriye gitmiş olurdu ve bunu kimse fark etmezdi: katalog dolu
-- görünür, kazanç düşük olurdu.
--
-- Testler bu yüzden "kaynak kuruldu mu"ya değil, ŞU ÜÇ SESSİZ BOZULMAYA
-- bakıyor:
--
--   1) elektronik feed'i adrese sızarsa saklanan %6 tabanı YANLIŞ olur
--      (elektronik tabanın ALTINDA öder)
--   2) çerez 3 günden düşerse `record_conversion` gerçek satışları REDDEDER
--   3) düz metin anahtar sütuna yazılırsa yedeklerde ve her `select *`
--      çıktısında durur
--
-- Ayrıca mağaza `active` olmazsa RLS politikası ürünleri GİZLER -- yani
-- alım başarıyla çalışır, ürünler yazılır ve vitrinde hiçbir şey görünmez.
-- ============================================================================
begin;

\set ON_ERROR_STOP on

-- --------------------------------------------------------------------------
-- 1) ELEKTRONİK FEED'İ ADRESTE OLMAMALI
-- --------------------------------------------------------------------------
do $$
declare
  v_adres text;
  v_fid   text;
begin
  select endpoint_url into v_adres
    from public.sources where slug = 'aliexpress-pl-yuksek-komisyon';

  if v_adres is null then
    raise exception 'AliExpress PL kaynagi yok';
  end if;

  foreach v_fid in array array[
    '21729',  -- Mobile Phones
    '21687',  -- Telephones & Accessories
    '21701',  -- Communication & Equipment
    '21847',  -- Consumer_Electronics
    '38773',  -- Computer_Office
    '21661',  -- Mobile Phone Accessories & Parts
    '21841',  -- Home_Appliances
    '21843'   -- Electrical_Equipment_Supplies
  ] loop
    if v_adres ~ ('(^|[/,])' || v_fid || '([,/]|$)') then
      raise exception
        'Elektronik feed % adreste: elektronik %%2,60 oduyor, saklanan '
        '%%6 tabaninin ALTINDA. Eklenecekse default_commission_rate '
        'yeniden degerlendirilmeli -- aksi halde kazanc OLDUGUNDAN YUKSEK '
        'gorunur.', v_fid;
    end if;
  end loop;

  raise notice 'elektronik feed yok: saklanan taban gecerli.';
end $$;

-- --------------------------------------------------------------------------
-- 2) YÜKLENEN HER FEED TABANIN ÜSTÜNDE ÖDEMELİ
-- --------------------------------------------------------------------------
-- (1) neyin OLMAMASI gerektigini olcuyor; bu, neyin OLMASI gerektigini.
-- Ikisi ayri: adres bos birakilsaydi (1) gecerdi.
do $$
declare
  v_adres  text;
  v_fid    text;
  v_eksik  text := '';
  v_oran   numeric;
begin
  select endpoint_url into v_adres
    from public.sources where slug = 'aliexpress-pl-yuksek-komisyon';

  foreach v_fid in array array[
    '21667', '21853', '21665', '21695', '21725',  -- %8
    '21855', '24327', '21851', '38771', '21849', '21727'  -- %6
  ] loop
    if v_adres !~ ('(^|[/,])' || v_fid || '([,/]|$)') then
      v_eksik := v_eksik || v_fid || ' ';
    end if;
  end loop;

  if v_eksik <> '' then
    raise exception 'Beklenen %%6/%%8 feed(leri) adreste yok: %', v_eksik;
  end if;

  select default_commission_rate into v_oran
    from public.merchants where slug = 'aliexpress-pl';

  if v_oran > 0.0600 then
    raise exception
      'default_commission_rate (%) yuklenen kategorilerin TABANININ (%%6) '
      'ustunde: kazanc oldugundan yuksek gorunur.', v_oran;
  end if;

  raise notice '11 feed yerinde, saklanan oran taban veya altinda.';
end $$;

-- --------------------------------------------------------------------------
-- 3) ÇEREZ PENCERESİ 3 GÜN
-- --------------------------------------------------------------------------
-- Sema varsayilani 1 GUN. Varsayilanda kalsaydi 2. ve 3. gundeki
-- donusumler `record_conversion` tarafindan REDDEDILIRDI -- yani gercek
-- satislari kendi elimizle silerdik.
do $$
declare
  v_cerez integer;
begin
  select cookie_window_days into v_cerez
    from public.merchants where slug = 'aliexpress-pl';

  if v_cerez <> 3 then
    raise exception
      'Cerez penceresi % (3 olmaliydi): record_conversion pencereyi asan '
      'donusumu reddeder, yani gercek satislar kaybedilir.', v_cerez;
  end if;

  raise notice 'cerez penceresi 3 gun.';
end $$;

-- --------------------------------------------------------------------------
-- 4) MAĞAZA active OLMALI -- YOKSA RLS ÜRÜNLERİ GİZLER
-- --------------------------------------------------------------------------
do $$
declare
  v_durum  text;
  v_sablon text;
  v_terms  timestamptz;
begin
  select status::text, deeplink_template, terms_verified_at
    into v_durum, v_sablon, v_terms
    from public.merchants where slug = 'aliexpress-pl';

  if v_durum <> 'active' then
    raise exception
      'Magaza % (active olmaliydi): affiliate urunleri yalnizca magaza '
      'active iken gorunur -- alim calisir, vitrin BOS kalirdi.', v_durum;
  end if;

  -- `merchants_active_needs_*` kisitlari bunlari zaten zorunlu kiliyor;
  -- burada dogru DEGERI de olcuyoruz.
  if v_sablon !~ 'awinmid=12044' then
    raise exception 'Deeplink sablonu yanlis advertiser tasiyor: %', v_sablon;
  end if;
  if v_terms is null then
    raise exception 'terms_verified_at bos';
  end if;

  raise notice 'magaza active, deeplink dogru advertiser''i tasiyor.';
end $$;

-- --------------------------------------------------------------------------
-- 5) ANAHTAR SÜTUNDA OLMAMALI
-- --------------------------------------------------------------------------
-- Kural depo genelinde: sir sutunda degil, sutunda sirrin ADI durur.
-- Burada YALNIZCA bu kaynak degil, HEPSI olculuyor -- kural bir satira
-- ozel degil.
do $$
declare
  v_slug text;
begin
  select slug into v_slug
    from public.sources
   where endpoint_url ~ 'apikey/[0-9a-f]{16,}'
      or endpoint_url ~ '(token|key|secret)=[A-Za-z0-9]{16,}'
   limit 1;

  if v_slug is not null then
    raise exception
      'Kaynak "%" adresinde DUZ METIN kimlik bilgisi var: yedeklerde, '
      'panoda ve her `select *` ciktisinda durur.', v_slug;
  end if;

  raise notice 'hicbir kaynak adresinde duz metin anahtar yok.';
end $$;

rollback;
