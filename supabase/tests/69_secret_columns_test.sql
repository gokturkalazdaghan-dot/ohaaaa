-- ============================================================================
-- SIR SÜTUNLARI — istemci rolleri neyi okuyamamalı?
-- ----------------------------------------------------------------------------
-- Bu dosya, 25_grants_test.sql'in GÖREMEDİĞİ katmanı sınar.
--
-- O dosya `has_table_privilege` ile TABLO düzeyine bakıyor ve "anon products
-- okuyabiliyor mu" sorusunu doğru cevaplıyor. Ama bir tablo okunabilir
-- olabilir ve içindeki TEK BİR SÜTUN yine de sır olabilir. Postback sırrı
-- tam olarak böyle sızmıştı: tablo yetkisi meşruydu, sütun yetkisi
-- kimsenin bakmadığı yerdi.
--
-- Teknik depoda zaten vardı (64_price_alerts_test.sql sütun bazlı UPDATE
-- yetkisini böyle sınıyor); merchants'a uygulanmamıştı.
-- ============================================================================
begin;

\set ON_ERROR_STOP on

do $$
declare
  -- İstemcinin ASLA okumaması gereken sütunlar ve neden.
  sirlar text[][] := array[
    ['merchants', 'postback_secret',
     'donusum bildirimini dogrulayan sir; sizarsa sahte satis yazilabilir'],
    ['merchants', 'tracking_id',
     'ortaklik yayinci kimligimiz; ucuncu taraf bizim adimiza link basar'],
    ['merchants', 'deeplink_template',
     'tracking_id ile birlikte gecerli ortaklik linki uretmeye yeter'],
    ['merchants', 'default_commission_rate',
     'ticari sir: magazanin bize odedigi oran'],
    ['merchants', 'notes',
     'isletme ici not; vitrinin isi degil'],
    ['products', 'commission_rate',
     'teklif basina komisyon; siralama tartismasini acan tek veri']
  ];
begin
  for i in 1 .. array_length(sirlar, 1) loop
    if has_column_privilege('anon', format('public.%I', sirlar[i][1]), sirlar[i][2], 'select') then
      raise exception 'BAŞARISIZ: anon %.% okuyabiliyor — %',
        sirlar[i][1], sirlar[i][2], sirlar[i][3];
    end if;

    if has_column_privilege('authenticated', format('public.%I', sirlar[i][1]), sirlar[i][2], 'select') then
      raise exception 'BAŞARISIZ: authenticated %.% okuyabiliyor — %',
        sirlar[i][1], sirlar[i][2], sirlar[i][3];
    end if;
  end loop;

  raise notice '✓ sir sutunlari istemci rollerine kapali (% sutun)', array_length(sirlar, 1);
end $$;

-- ---------------------------------------------------------------------------
-- KAPATIRKEN FAZLASINI KAPATMADIK — vitrin hâlâ çalışıyor mu?
-- ---------------------------------------------------------------------------
-- Yalnızca "sır kapalı" demek yetmez: bütün sütunları geri alan bir göç de
-- o testi geçerdi ve siteyi boşaltırdı. Bu blok, ürün sayfasının gerçekten
-- okuduğu alanların açık kaldığını kanıtlar.
do $$
declare
  gerekli text[][] := array[
    ['merchants', 'id'], ['merchants', 'slug'], ['merchants', 'display_name'],
    ['merchants', 'logo_url'], ['merchants', 'homepage_url'], ['merchants', 'status'],
    ['products', 'id'], ['products', 'group_id'], ['products', 'title'],
    ['products', 'price_cents'], ['products', 'shipping_fee_cents'],
    ['products', 'stock'], ['products', 'status'], ['products', 'fulfillment'],
    ['products', 'merchant_id'], ['products', 'vendor_id'],
    ['products', 'product_url'], ['products', 'image_urls'],
    ['products', 'compare_at_price_cents'], ['products', 'estimated_delivery_days']
  ];
begin
  for i in 1 .. array_length(gerekli, 1) loop
    if not has_column_privilege('anon', format('public.%I', gerekli[i][1]), gerekli[i][2], 'select') then
      raise exception 'BAŞARISIZ: vitrin %.% okuyamiyor — sayfa sessizce bosalir',
        gerekli[i][1], gerekli[i][2];
    end if;
  end loop;

  raise notice '✓ vitrinin okudugu alanlar acik (% sutun)', array_length(gerekli, 1);
end $$;

-- ---------------------------------------------------------------------------
-- service_role dokunulmadan kaldı mı?
-- ---------------------------------------------------------------------------
-- /git yönlendirmesi ve postback doğrulaması sırrı service_role ile okur.
-- Onu da kapatmak, ortaklık akışının tamamını sessizce bozardı.
do $$
begin
  if not has_column_privilege('service_role', 'public.merchants', 'postback_secret', 'select') then
    raise exception 'BAŞARISIZ: service_role sirri okuyamiyor — postback dogrulamasi coker';
  end if;
  if not has_column_privilege('service_role', 'public.merchants', 'deeplink_template', 'select') then
    raise exception 'BAŞARISIZ: service_role sablonu okuyamiyor — yonlendirme uretilemez';
  end if;
  raise notice '✓ sunucu tarafi sirri okumaya devam ediyor';
end $$;

rollback;
