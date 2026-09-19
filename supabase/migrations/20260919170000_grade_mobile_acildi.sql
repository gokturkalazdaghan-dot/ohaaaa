-- ===========================================================================
-- GRADE MOBILE AÇILIYOR -- KOMİSYONUN ÇOĞU ORAN DEĞİL, SABİT ÜCRET
-- ---------------------------------------------------------------------------
-- Awin oran kartı (19/09/2026, hesap sahibi bildirimi):
--
--   BuyBack Trade-IN                           GBP  7,00   (sabit)
--   Unlocking (repair.grademobile.co.uk)        %10,00   (oran)
--   Refurbished devices (grademobile.co.uk)     % 4,00   (oran)
--   SIM-1GB / 10GB / 30GB / 100GB      GBP 10 / 14 / 17 / 23 (sabit)
--   PAYM-1 .. PAYM-6                   GBP 20 .. 70          (sabit)
--   Pay Monthly                                GBP 35,00   (sabit)
--   Default                                    BİLDİRİLMEDİ
--
-- ---------------------------------------------------------------------------
-- ŞEMA SABİT ÜCRETİ İFADE EDEMİYOR -- VE BU BİR KAYIP DEĞİL, BİR SINIR
-- ---------------------------------------------------------------------------
-- `default_commission_rate` bir ORANDIR (0 <= x <= 0,9). "GBP 35,00" bir
-- oran değil; sütuna yazılamaz. Yaklaşık bir orana ÇEVİRMEK de olmaz:
-- sabit ücret sepet tutarından bağımsızdır, orana çevirmek sepet büyüdükçe
-- kazancı olduğundan yüksek gösterirdi.
--
-- Bu yüzden sabit ücretli gruplar (BuyBack, SIM-*, PAYM-*, Pay Monthly)
-- KATALOĞA ALINMIYOR. Zaten alınmamaları gerekiyordu: bunlar ürün değil,
-- HİZMET ve ABONELİKTİR. BuyBack'te müşteri telefon SATAR, almaz;
-- "Pay Monthly" bir sözleşmedir. Fiyat karşılaştırma motoruna sokmak,
-- kıyaslanamaz kalemleri kıyaslanabilir göstermek olurdu.
--
-- ---------------------------------------------------------------------------
-- YÜKLENEN TEK FEED: MAIN SITE -> %4
-- ---------------------------------------------------------------------------
-- Kart oranı ALAN ADIYLA kapsıyor: "Refurbished devices
-- (grademobile.co.uk)". Mağazanın `homepage_url` alanı da tam olarak
-- `https://grademobile.co.uk/`. Yani MAIN SITE feed'i (58891, 6.470 ürün)
-- bu grubun içinde ve oranı %4.
--
-- %10'luk Unlocking grubu `repair.grademobile.co.uk` -- AYRI bir alan adı.
-- Daha yüksek ödüyor ama 239 kalemlik "Repair Site" feed'i bir tamir
-- HİZMETİ; üstelik farklı alan adı olduğu için `validateUrl` satırları
-- zaten reddederdi (`allowedHosts` mağazanın ana sayfasından türüyor).
--
-- ALINMAYAN DİĞER FEED'LER: MSM Full (14.578) kapasiteye sığmıyor
-- (kalan yer ~9.798 ürün) ve "MSM" adının hangi alan adına baktığı
-- BİLİNMİYOR -- farklı bir alan adıysa bütün satırları reddedilirdi.
-- Önce MAIN SITE ölçülecek, sonra karar verilecek.
--
-- ---------------------------------------------------------------------------
-- `terms_verified_at` DOLDURULUYOR
-- ---------------------------------------------------------------------------
-- Çerez penceresi biliniyor (30 gün) ve YÜKLENEN ürünlerin komisyonu tek
-- bir orana düşüyor: %4. AliExpress'te (20260919160000) saklanan değer iki
-- oranın TABANIYDI; burada tek uygulanabilir oran var, taban değil.
--
-- "Default" satırının boş olması bu kararı bozmuyor: yüklenen ürünler
-- adı konmuş bir grubun içinde ve o grubun oranı bildirilmiş. Default'a
-- düşen bir kalem yüklemiyoruz.
-- ===========================================================================

update public.merchants
   set status                  = 'active',
       default_commission_rate = 0.0400,
       cookie_window_days      = 30,
       application_status      = 'approved',
       approved_at             = coalesce(approved_at, now()),
       terms_verified_at       = coalesce(terms_verified_at, now()),
       deeplink_template       =
         'https://www.awin1.com/cread.php?awinmid=22069&awinaffid=3074081'
         || '&clickref={subid}&ued={url_encoded}',
       notes =
         'Awin oran karti (19/09/2026): Refurbished devices (grademobile.co.uk) '
         || '%4 | Unlocking (repair.grademobile.co.uk) %10 | BuyBack Trade-IN '
         || 'GBP 7 | SIM-1/10/30/100GB GBP 10/14/17/23 | PAYM-1..6 GBP 20..70 | '
         || 'Pay Monthly GBP 35 | Default BILDIRILMEDI. '
         || 'SABIT UCRETLI GRUPLAR SEMADA IFADE EDILEMEZ (sutun bir ORAN tutar) '
         || 've zaten katalogda yeri yok: hizmet ve abonelik, urun degil. '
         || 'default_commission_rate = %4, YUKLENEN feed''in (MAIN SITE 58891) '
         || 'dustugu grup. repair.grademobile.co.uk AYRI alan adi -- %10 daha '
         || 'yuksek ama validateUrl o satirlari zaten reddeder. '
         || 'Uyelik Awin feed listesinden dogrulandi: active.',
       updated_at = now()
 where slug = 'grade-mobile';

-- ---------------------------------------------------------------------------
-- KAYNAK: YALNIZCA MAIN SITE
-- ---------------------------------------------------------------------------
-- Anahtar sütunda değil: `${AWIN_DATAFEED_API_KEY}` yer tutucusu, değeri
-- yalnızca çalışma anında ortamdan gelir.
insert into public.sources (
  merchant_id, slug, name, kind, endpoint_url, field_mapping,
  price_locale, currency, market_code, country_code,
  auth_type, auth_secret_ref, sync_mode, batch_size,
  schedule_cron, max_staleness_minutes,
  requests_per_minute, request_delay_ms, is_enabled
)
select
  m.id,
  'grade-mobile-main',
  'Grade Mobile -- MAIN SITE (yenilenmis cihazlar, %4)',
  'feed_csv',
  'https://productdata.awin.com/datafeed/download/apikey/'
    || '${AWIN_DATAFEED_API_KEY}'
    || '/language/en/fid/58891'
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
  'en-GB', 'GBP', 'UK', 'GB',
  'query', 'AWIN_DATAFEED_API_KEY', 'full', 500,
  '0 */6 * * *', 360, 20, 2000, true
  from public.merchants m
 where m.slug = 'grade-mobile'
on conflict (slug) do update set
  endpoint_url  = excluded.endpoint_url,
  field_mapping = excluded.field_mapping,
  is_enabled    = excluded.is_enabled,
  updated_at    = now();

-- ---------------------------------------------------------------------------
-- PROGRAM KAYDI
-- ---------------------------------------------------------------------------
update public.programs
   set network_status      = 'active',
       network_feed_id     = '58891',
       network_item_count  = 6470,
       approval_checked_at = now(),
       commission_rate     = 0.0400,
       terms = coalesce(terms || ' | ', '')
         || 'ORAN KARTI (19/09/2026): Refurbished devices (grademobile.co.uk) %4 | '
         || 'Unlocking (repair.grademobile.co.uk) %10 | BuyBack GBP 7 | '
         || 'SIM-1/10/30/100GB GBP 10/14/17/23 | PAYM-1..6 GBP 20..70 | '
         || 'Pay Monthly GBP 35 | Default BILDIRILMEDI. Komisyonun COGU SABIT '
         || 'UCRET ve sema oran tutuyor -- o gruplar (hizmet/abonelik) katalogda '
         || 'yok. commission_rate = %4: yuklenen MAIN SITE feed''inin grubu.',
       last_verified_at = now()
 where network_program_id = '22069' and network = 'awin';

-- ---------------------------------------------------------------------------
-- DOĞRULAMA
-- ---------------------------------------------------------------------------
do $$
declare
  v_adres text;
  v_durum text;
  v_oran  numeric;
begin
  select endpoint_url into v_adres
    from public.sources where slug = 'grade-mobile-main';
  if v_adres is null then
    raise exception 'Grade Mobile kaynagi kurulmadi';
  end if;

  if v_adres ~ 'apikey/[0-9a-f]{16,}' then
    raise exception 'Kaynak adresine DUZ METIN anahtar yazilmis';
  end if;
  if v_adres !~ '\$\{AWIN_DATAFEED_API_KEY\}' then
    raise exception 'Kaynak adresinde yer tutucu yok';
  end if;

  -- HIZMET/ABONELIK FEED'LERI KATALOGA GIRMEMELI.
  -- Hepsi SABIT UCRET oduyor ve sema oran tutuyor; ayrica urun degiller.
  if v_adres ~ '(^|[/,])(58895|95085|94188|50529)([,/]|$)' then
    raise exception
      'Adreste hizmet/abonelik feed kimligi var (BuyBack/PayMonthly/SIM/Repair): '
      'bunlar SABIT UCRET oduyor, %%4''luk oranla temsil edilemez ve urun degiller.';
  end if;

  select status::text, default_commission_rate into v_durum, v_oran
    from public.merchants where slug = 'grade-mobile';

  if v_durum <> 'active' then
    raise exception 'Grade Mobile active degil: urunler gorunmez';
  end if;
  if v_oran <> 0.0400 then
    raise exception
      'default_commission_rate % (%%4 olmaliydi -- yuklenen feed''in grubu)', v_oran;
  end if;

  raise notice 'Grade Mobile acildi: MAIN SITE (6.470), %%4, hizmet feedleri disarida';
end $$;
