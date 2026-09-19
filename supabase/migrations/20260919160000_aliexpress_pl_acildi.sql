-- ===========================================================================
-- ALIEXPRESS PL AÇILIYOR -- VE KOMİSYON TEK BİR ORAN DEĞİL
-- ---------------------------------------------------------------------------
-- Awin keşfi (2026-09-19, GitHub Actions) üç şeyi birden getirdi:
--
--   1) ÜYELİK: AliExpress PL = `active`. Yani programa GERÇEKTEN katılmışız.
--      Bugüne kadar `application_state` her satırda 'DISCOVERED'dı ve bu
--      bizim içe aktarma varsayılanımızdı -- ağdan gelen bir onay değil.
--   2) FEED KİMLİĞİ: 21 feed. Bu sütun bugüne kadar NULL'dı ve feed adresi
--      `fid` olmadan kurulamıyordu.
--   3) 614 feed'in 83'ü `active` -- 4.509.038 ürün erişilebilir durumda.
--
-- ---------------------------------------------------------------------------
-- VERİTABANINDAKİ %7,5 YANLIŞTI
-- ---------------------------------------------------------------------------
-- `programs.commission_rate` 0.0750 yazıyordu. Awin'in yayımlanmış oran
-- kartında BÖYLE BİR ORAN YOK:
--
--   Electronics                      2,60%
--   Clothing, accessories, garden    8%
--   All other categories             6%
--   Non-affiliate products           1%
--   Default                          1%
--
-- %7,5 dizin CSV'sinden türemiş bir değerdi (muhtemelen `commissionMin`).
-- Tek bir oran YOK -- komisyon KATEGORİYE GÖRE değişiyor ve aradaki fark
-- üç kattan fazla.
--
-- ---------------------------------------------------------------------------
-- BU YÜZDEN ELEKTRONİK FEED'LERİ BİLEREK ALINMIYOR
-- ---------------------------------------------------------------------------
-- En büyük kategori feed'leri elektronik: Mobile Phones (2.319),
-- Telephones & Accessories (1.674), Communication & Equipment (1.631).
-- Ürün sayısına bakıp bunları seçmek, kapasitenin çoğunu EN DÜŞÜK ödeyen
-- kategoriye harcamak olurdu -- %2,60, yani giyimin üçte biri.
--
-- Alınanlar yalnızca %6 ve %8 kolları (11 feed, 6.719 ürün):
--
--   %8  21667 Women's Clothing        763
--       21853 Underwear               632
--       21665 Men's Clothing          544
--       21695 Jewelry Accessories     700
--       21725 Home & Garden           511
--   %6  21855 Mother & Kids           725
--       24327 Office & School         704
--       21851 Automobiles_Motorcycles 668
--       38771 Home_Improvment         623
--       21849 Beauty_Health           533
--       21727 Furniture               316
--
-- 43145 "Food" (13 ürün) ALINMIYOR: kanonik taksonomide gıda KAPSAM DIŞI
-- (20260918230017), satırlar zaten reddedilirdi.
--
-- ---------------------------------------------------------------------------
-- `default_commission_rate` NEDEN 0.0600
-- ---------------------------------------------------------------------------
-- Sütun TEK bir sayı tutuyor, programın BEŞ oranı var. Yüklediğimiz her
-- kategori %6 ya da %8 ödüyor; dolayısıyla %6 bu katalog için GERÇEK BİR
-- TABAN ve hiçbir koşulda kazancı OLDUĞUNDAN YÜKSEK göstermez.
--
-- DİKKAT -- ELEKTRONİK EKLENİRSE BU SAYI YANLIŞ OLUR: elektronik %2,60
-- ödüyor, yani saklanan tabanın ALTINDA. Elektronik feed'i eklenecekse
-- bu satır yeniden değerlendirilmeli. Aşağıdaki doğrulama bloğu o feed
-- kimliklerini adreste görürse göçü DÜŞÜRÜR.
--
-- `terms_verified_at` DOLDURULUYOR çünkü bu sefer elimizde TAM oran kartı
-- var. Simple Project'te (20260907150000) doldurmamıştık; orada bilgi
-- EKSİKTİ ("%10+" bir tabandı). Burada bilgi eksik değil, ÇOK KATMANLI --
-- ve saklanan değer o katmanların en düşüğünün üstünde değil, altında.
--
-- ÇEREZ 3 GÜN: şema varsayılanı 1 gün ve `record_conversion` pencereyi
-- aşan dönüşümü REDDEDER. 1 kalsaydı 2. ve 3. gündeki satışları kendi
-- elimizle çöpe atardık.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) SATICI
-- ---------------------------------------------------------------------------
insert into public.merchants (
  slug, display_name, network, network_advertiser_id, status,
  homepage_url, country_code, default_commission_rate, cookie_window_days,
  deeplink_template, application_status, approved_at, terms_verified_at, notes
)
values (
  'aliexpress-pl', 'AliExpress PL', 'awin', '12044', 'active',
  'https://www.aliexpress.com', 'PL', 0.0600, 3,
  'https://www.awin1.com/cread.php?awinmid=12044&awinaffid=3074081'
    || '&clickref={subid}&ued={url_encoded}',
  'approved', now(), now(),
  'Awin oran karti (19/09/2026, yayimlanmis program sayfasi): '
  || 'Electronics %2,60 | Clothing, accessories, garden %8 | '
  || 'All other categories %6 | Non-affiliate products %1 | Default %1. '
  || 'TEK ORAN YOK. default_commission_rate = %6, YUKLENEN kategorilerin '
  || 'tabani (hepsi %6 veya %8). ELEKTRONIK EKLENIRSE BU SAYI YANLIS OLUR '
  || '(%2,60, tabanin altinda). Cerez 3 gun -- sema varsayilani 1 gun ve '
  || 'record_conversion pencereyi asan donusumu reddeder. '
  || 'Uyelik Awin feed listesinden dogrulandi: active.'
)
on conflict (slug) do update set
  network_advertiser_id   = excluded.network_advertiser_id,
  status                  = excluded.status,
  homepage_url            = excluded.homepage_url,
  country_code            = excluded.country_code,
  default_commission_rate = excluded.default_commission_rate,
  cookie_window_days      = excluded.cookie_window_days,
  deeplink_template       = excluded.deeplink_template,
  application_status      = excluded.application_status,
  approved_at             = coalesce(public.merchants.approved_at, excluded.approved_at),
  terms_verified_at       = coalesce(public.merchants.terms_verified_at, excluded.terms_verified_at),
  notes                   = excluded.notes,
  updated_at              = now();

-- ---------------------------------------------------------------------------
-- 2) KAYNAK -- ON BIR FEED TEK ADRESTE
-- ---------------------------------------------------------------------------
-- Awin `fid` alanı virgülle ayrılmış çoklu değer kabul eder. On bir ayrı
-- kaynak açmak on bir iş, on bir HTTP turu ve on bir ayrı bayatlama
-- penceresi demekti. Tek adres tek turda iner; satırlar `data_feed_id` ve
-- `merchant_id` sütunlarıyla zaten ayrıştırılabiliyor.
--
-- ANAHTAR BURADA YOK: `${AWIN_DATAFEED_API_KEY}` yer tutucusu, tıpkı
-- `bto-instock`'ta olduğu gibi. Değer yalnızca çalışma anında ortamdan
-- gelir (`expandSecretPlaceholders`).
insert into public.sources (
  merchant_id, slug, name, kind, endpoint_url, field_mapping,
  price_locale, currency, market_code, country_code,
  auth_type, auth_secret_ref, sync_mode, batch_size,
  schedule_cron, max_staleness_minutes,
  requests_per_minute, request_delay_ms, is_enabled
)
select
  m.id,
  'aliexpress-pl-yuksek-komisyon',
  'AliExpress PL -- %6/%8 kategorileri',
  'feed_csv',
  'https://productdata.awin.com/datafeed/download/apikey/'
    || '${AWIN_DATAFEED_API_KEY}'
    || '/language/en/fid/'
    || '21667,21853,21665,21695,21725,21855,24327,21851,38771,21849,21727'
    || '/columns/data_feed_id,merchant_id,merchant_name,aw_product_id,'
    || 'aw_deep_link,merchant_deep_link,aw_image_url,product_name,description,'
    || 'search_price,rrp_price,currency,in_stock,stock_status,ean,brand_name,'
    || 'merchant_image_url,merchant_category,merchant_product_id,delivery_cost,'
    || 'last_updated'
    || '/format/csv/delimiter/%2C/compression/gzip/adultcontent/1/',
  jsonb_build_object(
    'sku', 'merchant_product_id',
    'url', 'merchant_deep_link',
    'gtin', 'ean',
    'brand', 'brand_name',
    'image', 'merchant_image_url',
    'price', 'search_price',
    'stock', 'in_stock',
    'title', 'product_name',
    'category', 'merchant_category',
    'currency', 'currency',
    'description', 'description',
    'external_id', 'aw_product_id',
    'shipping_fee', 'delivery_cost',
    'compare_at_price', 'rrp_price'
  ),
  'pl-PL', 'PLN', 'PL', 'PL',
  'query', 'AWIN_DATAFEED_API_KEY', 'full', 500,
  '0 */6 * * *', 360, 20, 2000, true
  from public.merchants m
 where m.slug = 'aliexpress-pl'
on conflict (slug) do update set
  endpoint_url  = excluded.endpoint_url,
  field_mapping = excluded.field_mapping,
  is_enabled    = excluded.is_enabled,
  updated_at    = now();

-- ---------------------------------------------------------------------------
-- 3) PROGRAM KAYDI DÜZELTİLİYOR
-- ---------------------------------------------------------------------------
-- `commission_rate` 0.0750 idi ve oran kartında böyle bir değer yok.
-- NULL'a çekiliyor: yanlış bir sayı tutmak "bilmiyoruz"dan DAHA KÖTÜ --
-- çünkü sorgulanmadan kullanılır. Gerçek kart `terms` içinde duruyor.
update public.programs
   set commission_rate     = null,
       cookie_window_days  = 3,
       market_code         = 'PL',
       currency            = 'PLN',
       network_status      = 'active',
       network_feed_id     = '101519',
       network_item_count  = 169261,
       -- `feed_checked_at` BILEREK YAZILMIYOR.
       -- `programs_feed_count_needs_check_time` kisiti onu
       -- `feed_ingestable_count` ile birlikte istiyor ve HAKLI: "feed'i
       -- denetledik" demek, hattan kac satirin gectigini bilmek demektir.
       -- Biz feed'i INDIRMEDIK -- yalnizca Awin'in LISTESINI okuduk.
       -- Ikisini esitlemek, listeden okunan sayiyi olculmus gibi
       -- gostermek olurdu. Gercek olcum ilk alim turunda cikacak.
       approval_checked_at = now(),
       terms = coalesce(terms || ' | ', '')
         || 'ORAN KARTI (19/09/2026, Awin program sayfasi): Electronics %2,60, '
         || 'Clothing/accessories/garden %8, All other %6, Non-affiliate %1, '
         || 'Default %1. Onceki 0.0750 degeri bu kartta YOK -- dizinden turemis, '
         || 'NULL yapildi. UYELIK: Awin feed listesi "active" -- programa '
         || 'katildigimiz ilk kez ag tarafindan dogrulandi. 21 feed, 183.970 urun; '
         || 'yalnizca %6/%8 kollari alindi (11 feed, 6.719 urun), elektronik '
         || 'BILEREK disarida birakildi.',
       last_verified_at = now()
 where network_program_id = '12044' and network = 'awin';

-- ---------------------------------------------------------------------------
-- DOĞRULAMA
-- ---------------------------------------------------------------------------
do $$
declare
  v_kaynak_sayisi integer;
  v_adres         text;
  v_durum         text;
begin
  select count(*) into v_kaynak_sayisi
    from public.sources where slug = 'aliexpress-pl-yuksek-komisyon';
  if v_kaynak_sayisi <> 1 then
    raise exception 'AliExpress kaynagi kurulmadi';
  end if;

  select endpoint_url into v_adres
    from public.sources where slug = 'aliexpress-pl-yuksek-komisyon';

  -- ANAHTAR SUTUNA YAZILMAMIS OLMALI. Yer tutucu kuralinin tek koruyucusu bu.
  if v_adres ~ 'apikey/[0-9a-f]{16,}' then
    raise exception
      'Kaynak adresine DUZ METIN anahtar yazilmis: sir sutunda degil, '
      'sutunda sirrin ADI durur.';
  end if;
  if v_adres !~ '\$\{AWIN_DATAFEED_API_KEY\}' then
    raise exception 'Kaynak adresinde yer tutucu yok';
  end if;

  -- Elektronik feed'leri KAZARA eklenmis olmamali.
  if v_adres ~ '(^|[/,])(21729|21687|21701|21847|38773|21661|21841|21843)([,/]|$)' then
    raise exception
      'Adreste elektronik feed kimligi var: elektronik %%2,60 oduyor ve '
      'saklanan %%6 tabaninin ALTINDA -- default_commission_rate yanlis olurdu.';
  end if;

  select status::text into v_durum from public.merchants where slug = 'aliexpress-pl';
  if v_durum <> 'active' then
    raise exception 'AliExpress PL magazasi active degil: urunler gorunmez';
  end if;

  raise notice 'AliExpress PL acildi: 11 feed, magaza active, anahtar sutunda yok';
end $$;
