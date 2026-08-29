-- ============================================================================
-- OHAAAA · Seed — geliştirme ve demo verisi
-- ----------------------------------------------------------------------------
-- Amaç: uygulamayı ilk çalıştırmada DOLU bir pazar yeri olarak görmek.
-- Aynı kanonik ürüne birden çok taşeronun teklif vermesi bilinçlidir —
-- fiyat karşılaştırma motoru ancak böyle anlamlı görünür.
--
-- Idempotent: tekrar çalıştırılabilir (on conflict do nothing / do update).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Kullanıcılar (auth.users → trigger ile public.users profili oluşur)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'admin@ohaaaa.com',        '{"full_name":"Ohaaaa Admin"}'),
  ('22222222-2222-4222-8222-222222222222', 'satici@teknomarkt.com',   '{"full_name":"Teknomarkt Yönetici"}'),
  ('33333333-3333-4333-8333-333333333333', 'satici@modavitrin.com',   '{"full_name":"Moda Vitrin Yönetici"}'),
  ('44444444-4444-4444-8444-444444444444', 'satici@evbahce.com',      '{"full_name":"Ev & Bahçe Yönetici"}'),
  ('55555555-5555-4555-8555-555555555555', 'musteri@ornek.com',       '{"full_name":"Zeynep Yılmaz"}')
on conflict (id) do nothing;

update public.users set role = 'admin'  where id = '11111111-1111-4111-8111-111111111111';
update public.users set role = 'vendor' where id in (
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'
);

-- ---------------------------------------------------------------------------
-- Kategoriler
-- ---------------------------------------------------------------------------
insert into public.categories (id, parent_id, slug, name, icon, sort_order) values
  ('c0000000-0000-4000-8000-000000000001', null, 'elektronik',   'Elektronik',        'cpu',        1),
  ('c0000000-0000-4000-8000-000000000002', null, 'moda',         'Moda',              'shirt',      2),
  ('c0000000-0000-4000-8000-000000000003', null, 'ev-yasam',     'Ev & Yaşam',        'sofa',       3),
  ('c0000000-0000-4000-8000-000000000004', null, 'spor-outdoor', 'Spor & Outdoor',    'dumbbell',   4),
  ('c0000000-0000-4000-8000-000000000005', null, 'kozmetik',     'Kozmetik',          'sparkles',   5),
  ('c0000000-0000-4000-8000-000000000006', null, 'supermarket',  'Süpermarket',       'shopping-basket', 6),
  ('c0000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000001', 'telefon',   'Telefon',   'smartphone', 1),
  ('c0000000-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000001', 'bilgisayar','Bilgisayar','laptop',     2),
  ('c0000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000001', 'kulaklik',  'Kulaklık',  'headphones', 3)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Taşeronlar (vendors)
-- ---------------------------------------------------------------------------
insert into public.vendors
  (id, owner_id, slug, display_name, legal_name, description, support_email,
   status, commission_rate, rating, rating_count, approved_at)
values
  ('a0000000-0000-4000-8000-00000000000a',
   '22222222-2222-4222-8222-222222222222',
   'teknomarkt', 'Teknomarkt', 'Teknomarkt Elektronik A.Ş.',
   'Elektronik ve teknoloji ürünlerinde 18 yıllık tedarik gücü.',
   'destek@teknomarkt.com', 'approved', 0.0700, 4.72, 18432, now() - interval '400 days'),

  ('a0000000-0000-4000-8000-00000000000b',
   '33333333-3333-4333-8333-333333333333',
   'moda-vitrin', 'Moda Vitrin', 'Moda Vitrin Tekstil Ltd. Şti.',
   'Sezonun öne çıkan markaları, hızlı kargo garantisiyle.',
   'destek@modavitrin.com', 'approved', 0.1200, 4.51, 9310, now() - interval '260 days'),

  ('a0000000-0000-4000-8000-00000000000c',
   '44444444-4444-4444-8444-444444444444',
   'ev-bahce-dunyasi', 'Ev & Bahçe Dünyası', 'EBD Ticaret A.Ş.',
   'Ev, mutfak ve bahçe ürünlerinde geniş stok.',
   'destek@evbahce.com', 'approved', 0.0900, 4.38, 4127, now() - interval '120 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Kanonik ürünler (product_groups) — karşılaştırma birimi
-- ---------------------------------------------------------------------------
insert into public.product_groups (id, slug, title, brand, gtin, category_id, description, image_url, attributes) values
  ('40000000-0000-4000-8000-000000000001', 'apple-iphone-15-128gb',
   'Apple iPhone 15 128GB', 'Apple', '0195949038204',
   'c0000000-0000-4000-8000-000000000011',
   '6.1" Super Retina XDR ekran, A16 Bionic işlemci, 48MP ana kamera, USB-C.',
   'https://images.ohaaaa.com/p/iphone-15.jpg',
   '{"renk":"Siyah","depolama":"128GB","ekran":"6.1 inç"}'),

  ('40000000-0000-4000-8000-000000000002', 'sony-wh-1000xm5',
   'Sony WH-1000XM5 Kablosuz Kulaklık', 'Sony', '4548736134546',
   'c0000000-0000-4000-8000-000000000013',
   'Sektör lideri gürültü engelleme, 30 saat pil ömrü, çok noktalı bağlantı.',
   'https://images.ohaaaa.com/p/wh1000xm5.jpg',
   '{"renk":"Siyah","tip":"Kulak üstü","anc":"Var"}'),

  ('40000000-0000-4000-8000-000000000003', 'lenovo-ideapad-slim-3-16gb',
   'Lenovo IdeaPad Slim 3 16GB 512GB SSD', 'Lenovo', '0197529312345',
   'c0000000-0000-4000-8000-000000000012',
   'Ryzen 7 işlemci, 16GB RAM, 512GB NVMe SSD, 15.6" FHD ekran.',
   'https://images.ohaaaa.com/p/ideapad-slim-3.jpg',
   '{"ram":"16GB","depolama":"512GB SSD","ekran":"15.6 inç"}'),

  ('40000000-0000-4000-8000-000000000004', 'dyson-v12-detect-slim',
   'Dyson V12 Detect Slim Kablosuz Süpürge', 'Dyson', '5025155066324',
   'c0000000-0000-4000-8000-000000000003',
   'Lazer toz algılama, 60 dakika çalışma süresi, HEPA filtrasyon.',
   'https://images.ohaaaa.com/p/dyson-v12.jpg',
   '{"tip":"Dikey","pil":"60 dk"}'),

  ('40000000-0000-4000-8000-000000000005', 'nike-air-zoom-pegasus-40',
   'Nike Air Zoom Pegasus 40 Koşu Ayakkabısı', 'Nike', '0196969424242',
   'c0000000-0000-4000-8000-000000000004',
   'React köpük orta taban, Zoom Air yastıklama, nefes alan mesh üst.',
   'https://images.ohaaaa.com/p/pegasus-40.jpg',
   '{"cinsiyet":"Unisex","kullanim":"Koşu"}'),

  ('40000000-0000-4000-8000-000000000006', 'philips-airfryer-xxl',
   'Philips Airfryer XXL 7.3L', 'Philips', '8710103874461',
   'c0000000-0000-4000-8000-000000000003',
   'Rapid Air teknolojisi, 7.3L kapasite, %90 daha az yağ.',
   'https://images.ohaaaa.com/p/airfryer-xxl.jpg',
   '{"kapasite":"7.3L","guc":"2225W"}')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Teklifler (products) — aynı gruba birden çok taşeron teklif veriyor
-- ---------------------------------------------------------------------------
insert into public.products
  (id, vendor_id, group_id, external_id, sku, title, brand, category_id,
   image_urls, price_cents, compare_at_price_cents, stock,
   shipping_fee_cents, free_shipping_threshold_cents, estimated_delivery_days, status)
values
  -- iPhone 15 — 3 taşeron teklifi
  ('50000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a',
   '40000000-0000-4000-8000-000000000001', 'TM-IP15-128-BLK', 'IP15128BLK',
   'Apple iPhone 15 128GB Siyah', 'Apple', 'c0000000-0000-4000-8000-000000000011',
   '{https://images.ohaaaa.com/p/iphone-15.jpg}', 5499900, 6299900, 42, 0, 50000, 1, 'active'),

  ('50000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000b',
   '40000000-0000-4000-8000-000000000001', 'MV-APPLE-IP15', 'MVIP15',
   'iPhone 15 128 GB Siyah (Distribütör Garantili)', 'Apple', 'c0000000-0000-4000-8000-000000000011',
   '{https://images.ohaaaa.com/p/iphone-15.jpg}', 5389900, null, 7, 4999, null, 3, 'active'),

  ('50000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-00000000000c',
   '40000000-0000-4000-8000-000000000001', 'EBD-IPHONE15', 'EBDIP15',
   'Apple iPhone 15 128GB', 'Apple', 'c0000000-0000-4000-8000-000000000011',
   '{https://images.ohaaaa.com/p/iphone-15.jpg}', 5629900, null, 3, 0, 30000, 2, 'active'),

  -- Sony WH-1000XM5 — 2 teklif
  ('50000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-00000000000a',
   '40000000-0000-4000-8000-000000000002', 'TM-SONY-XM5', 'TMXM5',
   'Sony WH-1000XM5 Kablosuz Kulaklık Siyah', 'Sony', 'c0000000-0000-4000-8000-000000000013',
   '{https://images.ohaaaa.com/p/wh1000xm5.jpg}', 1189900, 1449900, 128, 0, 50000, 1, 'active'),

  ('50000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-00000000000b',
   '40000000-0000-4000-8000-000000000002', 'MV-XM5-BLACK', 'MVXM5',
   'Sony WH-1000XM5 ANC Kulaklık', 'Sony', 'c0000000-0000-4000-8000-000000000013',
   '{https://images.ohaaaa.com/p/wh1000xm5.jpg}', 1249000, null, 15, 2999, null, 2, 'active'),

  -- Lenovo IdeaPad — 2 teklif
  ('50000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-00000000000a',
   '40000000-0000-4000-8000-000000000003', 'TM-LEN-IPS3', 'TMIPS3',
   'Lenovo IdeaPad Slim 3 Ryzen 7 16GB 512GB', 'Lenovo', 'c0000000-0000-4000-8000-000000000012',
   '{https://images.ohaaaa.com/p/ideapad-slim-3.jpg}', 2199900, 2599900, 23, 0, 50000, 2, 'active'),

  ('50000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-00000000000c',
   '40000000-0000-4000-8000-000000000003', 'EBD-LENOVO-S3', 'EBDLS3',
   'Lenovo IdeaPad Slim 3 16GB RAM', 'Lenovo', 'c0000000-0000-4000-8000-000000000012',
   '{https://images.ohaaaa.com/p/ideapad-slim-3.jpg}', 2249000, null, 5, 0, 30000, 4, 'active'),

  -- Dyson — 2 teklif
  ('50000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-00000000000c',
   '40000000-0000-4000-8000-000000000004', 'EBD-DYSON-V12', 'EBDV12',
   'Dyson V12 Detect Slim Absolute', 'Dyson', 'c0000000-0000-4000-8000-000000000003',
   '{https://images.ohaaaa.com/p/dyson-v12.jpg}', 2899900, 3299900, 11, 0, 30000, 2, 'active'),

  ('50000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-00000000000a',
   '40000000-0000-4000-8000-000000000004', 'TM-DYSON-V12', 'TMV12',
   'Dyson V12 Detect Slim Kablosuz Süpürge', 'Dyson', 'c0000000-0000-4000-8000-000000000003',
   '{https://images.ohaaaa.com/p/dyson-v12.jpg}', 2949900, null, 4, 0, 50000, 1, 'active'),

  -- Nike Pegasus 40 — 1 teklif
  ('50000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000b',
   '40000000-0000-4000-8000-000000000005', 'MV-NIKE-PEG40', 'MVPEG40',
   'Nike Air Zoom Pegasus 40 Koşu Ayakkabısı', 'Nike', 'c0000000-0000-4000-8000-000000000004',
   '{https://images.ohaaaa.com/p/pegasus-40.jpg}', 449900, 549900, 64, 2999, 100000, 2, 'active'),

  -- Philips Airfryer — 2 teklif
  ('50000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-00000000000c',
   '40000000-0000-4000-8000-000000000006', 'EBD-PHIL-AF-XXL', 'EBDAFXXL',
   'Philips Airfryer XXL 7.3L Siyah', 'Philips', 'c0000000-0000-4000-8000-000000000003',
   '{https://images.ohaaaa.com/p/airfryer-xxl.jpg}', 799900, 999900, 37, 0, 30000, 2, 'active'),

  ('50000000-0000-4000-8000-00000000000c', 'a0000000-0000-4000-8000-00000000000a',
   '40000000-0000-4000-8000-000000000006', 'TM-AIRFRYER-XXL', 'TMAFXXL',
   'Philips Airfryer XXL', 'Philips', 'c0000000-0000-4000-8000-000000000003',
   '{https://images.ohaaaa.com/p/airfryer-xxl.jpg}', 824900, null, 19, 0, 50000, 1, 'active')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Günün En Oha Fiyatı
-- ---------------------------------------------------------------------------
insert into public.flash_deals
  (id, product_id, headline, deal_price_cents, stock_limit, sold_count, priority, starts_at, ends_at)
values
  ('f0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004',
   'Günün En Oha Fiyatı', 999900, 200, 137, 100,
   date_trunc('day', now()), date_trunc('day', now()) + interval '1 day'),

  ('f0000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-00000000000b',
   'Oha Fırsatı', 699900, 120, 64, 90,
   date_trunc('day', now()), date_trunc('day', now()) + interval '1 day'),

  ('f0000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-00000000000a',
   'Oha Fırsatı', 379900, 80, 51, 80,
   date_trunc('day', now()), date_trunc('day', now()) + interval '1 day')
on conflict (id) do nothing;

commit;
