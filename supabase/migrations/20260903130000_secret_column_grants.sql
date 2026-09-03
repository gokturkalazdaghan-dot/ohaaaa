-- ============================================================================
-- SÜTUN BAZLI SIR KAPATMA — postback sırrı herkese açıktı
-- ----------------------------------------------------------------------------
-- BULUNAN AÇIK
-- `merchants` tablosunda RLS politikası şu: USING (status = 'active').
-- Yani AKTİF her mağazanın satırı `anon` rolüne açık. Tablo düzeyinde de
-- SELECT verilmiş durumda — ve tablo düzeyi SELECT BÜTÜN SÜTUNLARI kapsar.
--
-- Ölçüldü (canlı veritabanında):
--   has_column_privilege('anon','public.merchants','postback_secret','select')
--     -> TRUE
--
-- Yani ilk aktif mağaza tanımlandığı an, herkese açık olan anon anahtarıyla
--
--   GET /rest/v1/merchants?select=slug,postback_secret
--
-- çağrısı ortaklık ağının postback SIRRINI verir.
--
-- NEDEN AĞIR
-- /api/postback/[merchant] uç noktası HMAC-SHA256 imza doğruluyor ve bunu
-- sabit zamanlı karşılaştırmayla yapıyor — doğru yazılmış. Ama sır herkesin
-- okuyabildiği bir yerde durursa o doğrulama HİÇBİR ŞEY korumaz: sırrı okuyan
-- geçerli imza üretir ve `conversions` tablosuna istediği kadar sahte satış
-- yazar. Gelir defteri, EPC, ağ mutabakatı — hepsi geçersizleşir.
--
-- Bugün sömürülemiyor çünkü 0 mağaza var. Yani bu açık, tam olarak para
-- kazanmaya başlanan gün canlanacak bir açık.
--
-- `tracking_id` + `deeplink_template` de kapatılıyor: ikisi birlikte, üçüncü
-- bir tarafın BİZİM yayıncı kimliğimizle ortaklık linki basmasına yeter.
-- `default_commission_rate`, `cookie_window_days` ve `notes` ticari/işletme
-- bilgisidir; vitrinin işine yaramaz.
--
-- NEDEN "REVOKE (sutun)" DEĞİL DE ÖNCE TABLO SEVİYESİNDE REVOKE?
-- PostgreSQL'de tablo düzeyinde SELECT varken tek bir sütunu geri almak
-- İŞE YARAMAZ: tablo düzeyi yetki sütun düzeyindekini kapsar. Tek doğru yol,
-- tablo düzeyini geri alıp izin verilen sütunları TEK TEK vermektir.
--
-- service_role'a DOKUNULMUYOR: /git yönlendirmesi ve postback doğrulaması
-- sırrı onunla okuyor ve zaten RLS/yetki katmanını atlıyor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- merchants — vitrinin görmesi gereken alanlar
-- ---------------------------------------------------------------------------
-- İstemcinin gerçekten okuduğu alanlar ölçüldü. Tek yer:
--   catalog.ts getProductGroup -> merchant:merchants (
--     id, slug, display_name, logo_url, homepage_url )
-- `status` de veriliyor çünkü PostgREST süzgeçleri sütun yetkisi ister;
-- `country_code`, `network` ve zaman damgaları zararsız künye bilgisidir.
revoke select on public.merchants from anon, authenticated;

grant select (
  id, slug, display_name, homepage_url, logo_url,
  country_code, network, status, created_at, updated_at
) on public.merchants to anon, authenticated;

-- ---------------------------------------------------------------------------
-- products.commission_rate — hangi mağazanın bize ne ödediği
-- ---------------------------------------------------------------------------
-- Güvenlik açığı değil, TİCARİ SIR. Ama sitenin Kullanım Şartları'nda
-- "komisyon sıralamayı etkilemez" yazıyor; teklif başına komisyon oranını
-- herkese açık bırakmak, o cümleyi tartışmaya açan tek veriyi rakibin eline
-- vermek olur.
--
-- Ölçüldü: istemci kodunda `products.commission_rate` okuyan HİÇBİR sorgu
-- yok (vendors.commission_rate okunuyor, o ayrı ve zaten sıfır).
-- Bu yüzden hem anon hem authenticated'tan alınıyor; satıcı kendi oranını
-- gerekirse sunucu tarafından okur.
--
-- Sütun listesi şemadan birebir çıkarıldı; yalnızca commission_rate dışarıda.
-- Eksik bırakılan bir sütun sayfayı sessizce boşaltacağı için liste elle
-- kısaltılmadı.
revoke select on public.products from anon, authenticated;

grant select (
  id, vendor_id, group_id, external_id, sku, title, description, brand,
  category_id, image_urls, price_cents, compare_at_price_cents, currency,
  stock, condition, shipping_fee_cents, free_shipping_threshold_cents,
  estimated_delivery_days, status, attributes, search_vector,
  created_at, updated_at, fulfillment, merchant_id, source_id, product_url,
  last_seen_at
) on public.products to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Kendi kendini doğrulayan kontrol
-- ---------------------------------------------------------------------------
-- Göç, düzeltmeyi gerçekten yaptığını kendisi kanıtlar. Bir sonraki
-- geliştirici tablo düzeyinde SELECT'i geri verirse bu blok derlemeyi düşürür.
do $$
begin
  if has_column_privilege('anon', 'public.merchants', 'postback_secret', 'select') then
    raise exception 'BAŞARISIZ: anon hâlâ postback_secret okuyabiliyor';
  end if;
  if has_column_privilege('authenticated', 'public.merchants', 'postback_secret', 'select') then
    raise exception 'BAŞARISIZ: authenticated hâlâ postback_secret okuyabiliyor';
  end if;
  if has_column_privilege('anon', 'public.products', 'commission_rate', 'select') then
    raise exception 'BAŞARISIZ: anon hâlâ products.commission_rate okuyabiliyor';
  end if;
  -- Vitrin çalışmaya devam etmeli: kapatırken fazlasını kapatmadığımızın kanıtı.
  if not has_column_privilege('anon', 'public.merchants', 'display_name', 'select') then
    raise exception 'BAŞARISIZ: vitrin mağaza adını okuyamıyor';
  end if;
  if not has_column_privilege('anon', 'public.products', 'price_cents', 'select') then
    raise exception 'BAŞARISIZ: vitrin fiyatı okuyamıyor';
  end if;
end $$;
