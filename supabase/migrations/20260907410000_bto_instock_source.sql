-- ===========================================================================
-- Back to the Office / In Stock Feed (111663): GERCEK KAYNAK
-- ===========================================================================
--
-- Ilk ticari alim kaynagi. Erisim OLCULDU (07/09/2026): http=200,
-- application/gzip, 35.952 satir, merchant_id 61655, para birimi GBP
-- (feed'in kendi `currency` sutunundan, her satirda ayni), ve alim hatti
-- 35.952/35.952 satiri KABUL ETTI.
--
-- ---------------------------------------------------------------------------
-- YER TUTUCU BICIMI DUZELTILIYOR
-- ---------------------------------------------------------------------------
--
-- 20260907400000 adresleri `{AWIN_DATAFEED_API_KEY}` biciminde yazmisti.
-- Calisma zamaninda genisletmeyi yapan `expandSecretPlaceholders` ise
-- `${DEGISKEN}` bekliyor (/\$\{([A-Z0-9_]+)\}/g). Yani o adresler
-- kopyalandiginda anahtar HIC yerine konmaz, adres oldugu gibi istenir ve
-- Awin "Feed not found" doner -- hata da yanlis yerde aranirdi.
--
-- Adresler tek bicime cekiliyor: `${AWIN_DATAFEED_API_KEY}`. Kisit da ayni
-- bicimi zorunlu kiliyor; boylece "gecerli gorunen ama genisletilemeyen"
-- bir adres yazilamaz.
-- ===========================================================================

alter table public.program_feeds drop constraint if exists program_feeds_url_placeholder;
alter table public.programs      drop constraint if exists programs_feed_url_placeholder;

update public.program_feeds
   set feed_url = replace(feed_url, '/apikey/{AWIN_DATAFEED_API_KEY}',
                                    '/apikey/${AWIN_DATAFEED_API_KEY}')
 where feed_url like '%/apikey/{AWIN_DATAFEED_API_KEY}%';

update public.programs
   set feed_url = replace(feed_url, '/apikey/{AWIN_DATAFEED_API_KEY}',
                                    '/apikey/${AWIN_DATAFEED_API_KEY}')
 where feed_url like '%/apikey/{AWIN_DATAFEED_API_KEY}%';

-- `/apikey/` segmentinden sonra MUTLAKA `${` gelir: calisma zamaninin
-- tanidigi tek bicim. Ham anahtar yasagi (24+ hex) yerinde duruyor.
alter table public.program_feeds add constraint program_feeds_url_placeholder
  check (feed_url is null or feed_url !~ '/apikey/(?!\$\{)');
alter table public.programs add constraint programs_feed_url_placeholder
  check (feed_url is null or feed_url !~ '/apikey/(?!\$\{)');

-- ---------------------------------------------------------------------------
-- KAYNAK
-- ---------------------------------------------------------------------------
--
-- ANAHTAR SUTUNDA DEGIL, SUTUNDA ANAHTARIN ADI DURUYOR. `auth_type='query'`
-- + `auth_secret_ref='AWIN_DATAFEED_API_KEY'`: adres sablonundaki
-- `${AWIN_DATAFEED_API_KEY}` calisma aninda ORTAMDAN cozulur ve ayni anda
-- maskeleme defterine yazilir. Bu, `auth.ts`'in zaten uyguladigi kuralin
-- ta kendisi -- ikinci bir mekanizma kurulmadi.
--
-- market/currency CIKARIM DEGIL: GB/UK dizinden, GBP feed'in `currency`
-- sutunundan OLCULDU.
insert into public.sources (
  merchant_id, slug, name, kind, endpoint_url,
  field_mapping, price_locale, currency, market_code, country_code,
  auth_type, auth_secret_ref,
  requests_per_minute, request_delay_ms, schedule_cron,
  max_staleness_minutes, batch_size,
  is_enabled
)
select m.id, 'bto-instock', 'Back to the Office -- In Stock Feed (Awin 111663)',
       'feed_csv',
       'https://productdata.awin.com/datafeed/download'
       || '/apikey/${AWIN_DATAFEED_API_KEY}'
       || '/language/en/fid/111663'
       || '/columns/data_feed_id,merchant_id,merchant_name,aw_product_id,'
       || 'aw_deep_link,aw_image_url,product_name,description,search_price,'
       || 'rrp_price,currency,in_stock,stock_status,ean,brand_name,'
       || 'merchant_image_url,merchant_category,merchant_product_id,'
       || 'delivery_cost,last_updated'
       || '/format/csv/delimiter/%2C/compression/gzip/adultcontent/1/',
       jsonb_build_object(
         'external_id',      'aw_product_id',
         'title',            'product_name',
         'url',              'aw_deep_link',
         'price',            'search_price',
         'compare_at_price', 'rrp_price',
         'currency',         'currency',
         'stock',            'in_stock',
         'gtin',             'ean',
         'brand',            'brand_name',
         'description',      'description',
         'image',            'merchant_image_url',
         'category',         'merchant_category',
         'sku',              'merchant_product_id',
         'shipping_fee',     'delivery_cost'
       ),
       'en-GB', 'GBP', 'UK', 'GB',
       'query', 'AWIN_DATAFEED_API_KEY',
       20, 2000, '0 */6 * * *',
       360, 500,
       true
  from public.merchants m
 where m.slug = 'back-to-the-office'
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- GOC KENDINI DOGRULUYOR
-- ---------------------------------------------------------------------------
do $$
declare
  s record;
  v_sayi integer;
begin
  select * into s from public.sources where slug = 'bto-instock';
  if s is null then
    raise exception 'DOGRULAMA 1: kaynak yazilmadi (magaza bulunamadi mi?).';
  end if;

  -- 2) ANAHTAR ADRESTE DEGIL, ADI ADRESTE.
  if s.endpoint_url ~ '[0-9a-f]{24,}' then
    raise exception 'DOGRULAMA 2: kaynak adresinde ham anahtar var.';
  end if;
  if position('${AWIN_DATAFEED_API_KEY}' in s.endpoint_url) = 0 then
    raise exception 'DOGRULAMA 2b: adres yer tutucu tasimiyor -- anahtar '
      'calisma aninda konamaz.';
  end if;
  if s.auth_type <> 'query' or s.auth_secret_ref <> 'AWIN_DATAFEED_API_KEY' then
    raise exception 'DOGRULAMA 2c: kimlik referansi eksik (tur=%, ref=%).',
      s.auth_type, s.auth_secret_ref;
  end if;

  -- 3) PARA BIRIMI VE PAZAR OLCULDU, CIKARILMADI.
  if s.currency <> 'GBP' or s.market_code <> 'UK' or s.country_code <> 'GB' then
    raise exception 'DOGRULAMA 3: pazar/para birimi yanlis (%, %, %).',
      s.currency, s.market_code, s.country_code;
  end if;

  -- 4) ESLEME feed'in GERCEK sutun adlarini kullaniyor.
  if s.field_mapping->>'url' <> 'aw_deep_link'
     or s.field_mapping->>'price' <> 'search_price'
     or s.field_mapping->>'gtin' <> 'ean' then
    raise exception 'DOGRULAMA 4: alan eslemesi feed sutunlariyla uyusmuyor.';
  end if;

  -- 5) BU KAYNAGIN FEED'I program_feeds'te KAYITLI VE DOGRULANMIS.
  --    Kayitsiz bir feed'e kaynak acmak, olculmemis bir adresi her alti
  --    saatte bir cekmek olurdu.
  select count(*) into v_sayi
    from public.program_feeds
   where network_feed_id = '111663' and feed_access = 'verified';
  if v_sayi <> 1 then
    raise exception 'DOGRULAMA 5: 111663 dogrulanmis feed olarak kayitli degil.';
  end if;

  -- 6) HENUZ HICBIR URUN GIRMEDI. Kaynak yalnizca YAPILANDIRMA; alim ayri
  --    bir islem ve magaza yayina alinmadan calismaz.
  select count(*) into v_sayi from public.products where source_id = s.id;
  if v_sayi <> 0 then
    raise exception 'DOGRULAMA 6: goc % urun yazmis.', v_sayi;
  end if;

  -- 7) MAGAZA HENUZ YAYINDA DEGIL -- ve bu KASITLI.
  --    `loadSources` yalnizca `merchants.status='active'` olan kaynaklari
  --    alim hattina sokar. BTO'nun komisyon orani Awin dizininde 0-0
  --    ("yayinlanmamis") oldugu icin `terms_verified_at` NULL, ve
  --    `merchants_active_needs_verified_terms` kisiti yayina almayi
  --    engelliyor. Kisit DOGRU calisiyor: eksik olan sey kod degil, GERCEK
  --    KOMISYON ORANI. Uydurmak yerine kaynak hazir bekletiliyor.
  if (select status from public.merchants where slug='back-to-the-office')
     = 'active' then
    raise notice 'BTO yayinda: alim hatti bu kaynagi artik calistirabilir.';
  else
    raise notice 'BTO YAYINDA DEGIL: kaynak hazir ama alim calismaz. Eksik '
      'olan tek sey dogrulanmis komisyon orani (terms_verified_at).';
  end if;

  raise notice
    'bto-instock kaynagi kuruldu: fid 111663, GBP/UK/GB, anahtar adreste '
    'DEGIL (auth_secret_ref ile cozuluyor), 35.952/35.952 satir hattan '
    'gecti. Urun YAZILMADI.';
end $$;
