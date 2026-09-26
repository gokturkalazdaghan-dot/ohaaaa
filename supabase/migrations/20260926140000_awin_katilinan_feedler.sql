-- =============================================================================
-- AWIN: ÜYE OLUNAN (JOINED) FEED'LERİN TAMAMI ALIM HATTINA
-- =============================================================================
-- Hesap sahibi Awin panelinde 53 feed seçip toplu indirme istedi. Ölçülen
-- (26/09/2026, Awin feed listesi + her feed'in kendisi indirilerek):
--
--   * 29 sayısal fid -> hepsi listede `active` (üyelik onaylı).
--     7'si zaten alınıyordu (aliexpress-pl, grade-mobile-main, bto-instock,
--     ultrahuman-main). Bu göç kalanları açar.
--   * 24 `F` önekli numara (F4389, F328 ...) -> datafeed API'sinde YOK.
--     Önek atılınca da 404 "Feed not found". Toplu indirmenin hata vermesinin
--     sebebi bunlar ("Must be digits and commas only"). Bu göç onlara
--     dokunmaz; ayrı bir ürün-verisi sistemine ait.
--
-- BİLEREK AÇILMAYANLAR
--   * RELX Global (82289; fid 104668 UK, 104689 US): nikotinli elektronik
--     sigara. Birleşik Krallık'ta çevrim içi reklamı yasak (TRPR 2016), sitede
--     yaş kapısı yok. Hukuki karar verilmeden yayına girmez.
--   * Grade Mobile 50529 (repair.*) ve 89799 (lease.*): hizmet ve kiralama,
--     ürün değil. validateUrl zaten alt alan adı olarak kabul eder ama
--     katalogda yeri yok.
--   * Back to the Office 102827 (117.635 satır): bto-instock (111663) ile aynı
--     mağazanın stok dışını da içeren tam dökümü. Aynı ürünü ikinci kez
--     yazmak yerine stoktaki feed korunuyor.
--
-- DOĞRULANMAYAN İKİ DEĞER -- AÇIKÇA
--   * Komisyon oranı: Awin feed listesi oranı vermez. Sütun NOT NULL; şema
--     varsayılanı (0.03) yazıldı ve notlarda "doğrulanmadı" diye işaretli.
--     Gerçek komisyon tutarı dönüşüm eşitlemesiyle Awin'den gelir; bu değer
--     yalnızca tahmin yüzeylerini etkiler.
--   * Çerez süresi: bilinen Awin programlarının tamamı (grade-mobile, bto,
--     red-gorilla, mooncool, pandahall, giftlab, dima, enjox) 30 gün. Şema
--     varsayılanı 1 gün olurdu ve record_conversion 24 saatten sonraki her
--     dönüşümü sessizce reddederdi; 30 yazıldı, notta "varsayım" diye geçer.
--
-- terms_verified_at: üyelik Awin feed listesinden `active` olarak ölçüldü ve
-- hesap sahibi bu mağazaların yayına alınmasını açıkça istedi.
--
-- İDEMPOTENT: tekrar çalıştırılırsa aynı satırları günceller, çoğaltmaz.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1) Mağazalar
-- -----------------------------------------------------------------------------
with yeni (slug, ad, anasayfa, ulke, mid) as (
  values
    ('decathlon-ie',             'Decathlon Ireland',         'https://www.decathlon.ie/',        'IE', '37550'),
    ('hairdressing-supplies',    'Hairdressing Supplies',     'https://www.hairdressingsupplies.com/', 'GB', '41960'),
    ('belleek',                  'Belleek',                   'https://belleek.com/',             'GB', '42298'),
    ('red-gorilla-international','Red Gorilla',               'https://www.redgorilla.red/',      'GB', '56439'),
    ('eonon-us',                 'Eonon',                     'https://www.eonon.com/',           'US', '32471'),
    ('kippy-it',                 'Kippy',                     'https://www.kippy.eu/',            'IT', '29093'),
    ('enjox-toys',               'Enjox Toys',                'https://www.enjox.com/',           'US', '111786'),
    ('tsarbomba',                'Tsarbomba',                 'https://tsarbomba.com/',           'US', '109230'),
    ('giftlab',                  'Giftlab',                   'https://www.giftlab.com/',         'US', '95201'),
    ('mooncool',                 'Mooncool',                  'https://mooncool.com/',            'US', '66494'),
    ('pandahall',                'PandaHall',                 'https://www.pandahall.com/',       'US', '88751'),
    ('dyu-bikes',                'DYU Bikes',                 'https://dyubikes.com/',            'PL', '121268'),
    ('dima-eyewear-us',          'Dima Eyewear',              'https://dimaeyewear.com/',         'US', '128033'),
    ('fullscopemd',              'FullScopeMD',               'https://www.fullscopemd.com/',     'US', '130233')
)
insert into public.merchants as m (
  slug, display_name, homepage_url, country_code, countries,
  network, network_advertiser_id, status, deeplink_template,
  default_commission_rate, cookie_window_days,
  application_status, approved_at, terms_verified_at, notes
)
select
  y.slug, y.ad, y.anasayfa,
  y.ulke, array[y.ulke],
  'awin', y.mid, 'active',
  'https://www.awin1.com/cread.php?awinmid=' || y.mid
    || '&awinaffid=3074081&clickref={subid}&ued={url_encoded}',
  0.03, 30,
  'approved', now(), now(),
  'Awin uyeligi feed listesinden olculdu: active (26/09/2026). '
    || 'KOMISYON DOGRULANMADI: 0.03 sema varsayilani. '
    || 'CEREZ 30 GUN VARSAYIM: bilinen Awin programlarinin ortak degeri. '
    || 'Hesap sahibi yayina alinmasini istedi.'
from yeni y
on conflict (slug) do update set
  display_name          = excluded.display_name,
  homepage_url          = excluded.homepage_url,
  country_code          = excluded.country_code,
  countries             = excluded.countries,
  network_advertiser_id = excluded.network_advertiser_id,
  deeplink_template     = excluded.deeplink_template,
  cookie_window_days    = greatest(m.cookie_window_days, excluded.cookie_window_days),
  application_status    = 'approved',
  approved_at           = coalesce(m.approved_at, excluded.approved_at),
  terms_verified_at     = coalesce(m.terms_verified_at, excluded.terms_verified_at),
  status                = 'active',
  notes                 = concat_ws(' | ', m.notes, excluded.notes);

-- -----------------------------------------------------------------------------
-- 2) Kaynaklar
-- -----------------------------------------------------------------------------
-- Adres biçimi, üretimde çalışan grade-mobile-main ile aynı; anahtar yer
-- tutucu olarak durur, gerçek değer alım işinin ortamından gelir.
with yeni (slug, magaza, ad, fid, pazar, ulke, para, yerel) as (
  values
    ('decathlon-ie-main',          'decathlon-ie',              'Decathlon Ireland',   '80635',  'IE', 'IE', 'EUR', 'en-IE'),
    ('hairdressing-supplies-main', 'hairdressing-supplies',     'Hairdressing Supplies','83908', 'UK', 'GB', 'GBP', 'en-GB'),
    ('belleek-uk',                 'belleek',                   'Belleek UK',          '92455',  'UK', 'GB', 'GBP', 'en-GB'),
    ('belleek-eu',                 'belleek',                   'Belleek EU',          '92550',  'IE', 'IE', 'EUR', 'en-IE'),
    ('red-gorilla-main',           'red-gorilla-international', 'Red Gorilla',         '94548',  'UK', 'GB', 'GBP', 'en-GB'),
    ('eonon-us-main',              'eonon-us',                  'Eonon US',            '99237',  'US', 'US', 'USD', 'en-US'),
    ('kippy-it-main',              'kippy-it',                  'Kippy IT',            '100195', 'IT', 'IT', 'EUR', 'it-IT'),
    ('enjox-toys-main',            'enjox-toys',                'Enjox Toys',          '100306', 'US', 'US', 'USD', 'en-US'),
    ('tsarbomba-main',             'tsarbomba',                 'Tsarbomba',           '105368', 'US', 'US', 'USD', 'en-US'),
    ('giftlab-main',               'giftlab',                   'Giftlab',             '105668', 'US', 'US', 'USD', 'en-US'),
    ('mooncool-main',              'mooncool',                  'Mooncool',            '108580', 'US', 'US', 'USD', 'en-US'),
    ('pandahall-main',             'pandahall',                 'PandaHall',           '108790', 'US', 'US', 'USD', 'en-US'),
    ('dyu-bikes-pl',               'dyu-bikes',                 'DYU Bikes PL',        '110843', 'PL', 'PL', 'PLN', 'pl-PL'),
    ('dima-eyewear-us-main',       'dima-eyewear-us',           'Dima Eyewear US',     '116083', 'US', 'US', 'USD', 'en-US'),
    ('fullscopemd-main',           'fullscopemd',               'FullScopeMD',         '117881', 'US', 'US', 'USD', 'en-US')
)
insert into public.sources as s (
  merchant_id, slug, name, kind, endpoint_url, field_mapping, price_locale,
  currency, market_code, country_code, requests_per_minute, request_delay_ms,
  schedule_cron, max_staleness_minutes, auth_type, auth_secret_ref,
  sync_mode, batch_size, is_enabled
)
select
  m.id, y.slug, y.ad, 'feed_csv',
  'https://productdata.awin.com/datafeed/download/apikey/${AWIN_DATAFEED_API_KEY}'
    || '/language/en/fid/' || y.fid
    || '/columns/data_feed_id,merchant_id,merchant_name,aw_product_id,aw_deep_link,'
    || 'merchant_deep_link,aw_image_url,product_name,description,search_price,'
    || 'rrp_price,currency,in_stock,stock_status,ean,brand_name,merchant_image_url,'
    || 'merchant_category,merchant_product_id,delivery_cost,last_updated'
    || '/format/csv/delimiter/%2C/compression/gzip/adultcontent/1/',
  '{"sku":"merchant_product_id","url":"merchant_deep_link","gtin":"ean",
    "brand":"brand_name","image":"merchant_image_url","price":"search_price",
    "stock":"in_stock","title":"product_name","category":"merchant_category",
    "currency":"currency","description":"description","external_id":"aw_product_id",
    "shipping_fee":"delivery_cost","compare_at_price":"rrp_price"}'::jsonb,
  y.yerel, y.para, y.pazar, y.ulke, 20, 2000,
  '0 */6 * * *', 360, 'query', 'AWIN_DATAFEED_API_KEY',
  'full', 500, true
from yeni y
join public.merchants m on m.slug = y.magaza
on conflict (slug) do update set
  merchant_id   = excluded.merchant_id,
  endpoint_url  = excluded.endpoint_url,
  field_mapping = excluded.field_mapping,
  price_locale  = excluded.price_locale,
  currency      = excluded.currency,
  market_code   = excluded.market_code,
  country_code  = excluded.country_code,
  is_enabled    = true;

-- -----------------------------------------------------------------------------
-- 3) Grade Mobile ana kaynağına aynı alan adındaki iki feed eklenir
-- -----------------------------------------------------------------------------
-- 95085 (979 ürün) ve 94188 (11 ürün) grademobile.co.uk'a ait, ölçüldü.
update public.sources
   set endpoint_url = replace(endpoint_url,
                              '/fid/58891,89798,101882,97224/',
                              '/fid/58891,89798,101882,97224,95085,94188/')
 where slug = 'grade-mobile-main'
   and endpoint_url like '%/fid/58891,89798,101882,97224/%';

commit;
