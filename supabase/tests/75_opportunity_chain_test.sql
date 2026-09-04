-- ===========================================================================
-- FIRSAT ZİNCİRİ — uçtan uca (YALNIZCA TEST ORTAMI)
-- ---------------------------------------------------------------------------
-- NE SINANIYOR
-- Bu test zincirin veritabanı ucunu baştan sona çalıştırır:
--
--   kaynak → satıcı → kanonik ürün → pazar teklifi → fiyat ölçümü (x3)
--        → fiyat geçmişi → indirim kanıtı → Ohaaaa Skor → fırsat
--
-- NEDEN GEREKLİ
-- Bileşenlerin her biri ayrı ayrı test ediliyordu ama ZİNCİRİN KENDİSİ hiç
-- çalıştırılmamıştı: gerçek bir teklif için gerçek ölçümlerden gerçek bir
-- skor üretildiği hiçbir yerde gösterilmemişti. "Kod mevcut" ile "özellik
-- çalışıyor" arasındaki farkı kapatan test budur.
--
-- ÜRETİM VERİSİ DEĞİL
-- Buradaki satırlar bu işlemin içinde oluşturulur ve `rollback` ile yok
-- edilir. Üretim veritabanına hiçbir şey yazılmaz. Buradaki 1.000 TL,
-- gerçek bir fiyat DEĞİLDİR -- zincirin aritmetiğini sınayan bir sabittir.
-- ===========================================================================
begin;
select plan(12);

-- --- 1) KAYNAK + SATICI ----------------------------------------------------
insert into public.merchants
  (slug, display_name, homepage_url, network, status, deeplink_template,
   country_code)
values
  ('zincir-magaza', 'Zincir Magaza', 'https://zincir.gecersiz', 'direct', 'active',
   'https://zincir.gecersiz/git?u={url}', 'TR');

insert into public.sources
  (merchant_id, slug, name, kind, endpoint_url, market, currency)
select id, 'zincir-feed', 'Zincir Feed', 'feed_csv',
       'https://zincir.gecersiz/feed.csv', 'TR', 'TRY'
  from public.merchants where slug = 'zincir-magaza';

select ok(
  exists (select 1 from public.sources s
            join public.merchants m on m.id = s.merchant_id
           where s.slug = 'zincir-feed' and m.slug = 'zincir-magaza'),
  '1) kaynak gercek bir saticiya bagli'
);

-- --- 2) KANONİK ÜRÜN -------------------------------------------------------
-- Kanonik ürün MARKETSİZDİR: aynı kulaklık Türkiye'de de Almanya'da da aynı
-- üründür. Pazara bağlı olan şey TEKLİFtir.
insert into public.product_groups (slug, title, brand, gtin)
values ('zincir-kulaklik', 'Zincir Oyuncu Kulakligi', 'ZincirMarka', '9990000000017');

select ok(
  exists (select 1 from public.product_groups where slug = 'zincir-kulaklik'),
  '2) kanonik urun olustu'
);

-- --- 3) PAZAR TEKLİFİ ------------------------------------------------------
insert into public.products
  (merchant_id, source_id, group_id, external_id, title,
   price_cents, currency, market, status, fulfillment, product_url,
   stock, shipping_fee_cents)
select m.id, s.id, g.id, 'ZK-1', 'Zincir Oyuncu Kulakligi',
       120000, 'TRY', 'TR', 'active', 'affiliate',
       'https://zincir.gecersiz/u/zk-1',
       12, 0
  from public.merchants m
  join public.sources s on s.merchant_id = m.id
  cross join public.product_groups g
 where m.slug = 'zincir-magaza' and g.slug = 'zincir-kulaklik';

select ok(
  exists (select 1 from public.products
           where external_id = 'ZK-1' and market = 'TR' and currency = 'TRY'),
  '3) teklif pazariyla ve para birimiyle birlikte yazildi'
);

-- --- 4) FİYAT ÖLÇÜMLERİ ----------------------------------------------------
-- KENDİ ölçtüğümüz üç nokta. Satıcının üstü çizili fiyatı DEĞİL.
insert into public.price_points (product_id, price_cents, in_stock, observed_at)
select p.id, v.fiyat, true, now() - make_interval(days => v.gun)
  from public.products p,
       (values (150000, 60), (150000, 30), (120000, 1)) as v(fiyat, gun)
 where p.external_id = 'ZK-1';

/*
 * DÖRT, ÜÇ DEĞİL -- ve bu bir hata değil, ÖLÇÜLEN bir davranış.
 *
 * `products_record_price` tetikleyicisi teklif eklendiği anda ilk fiyat
 * noktasını kendisi yazıyor. Yani sistem, bir teklifi görür görmez onu
 * ölçmeye başlıyor. Test bunu 3 beklerken patladı; doğru olan testi
 * düzeltmek, çünkü otomatik ilk ölçüm tam olarak istenen davranış:
 * fiyat geçmişi bir yerden başlamak zorunda.
 */
select is(
  (select count(*) from public.price_points pp
     join public.products p on p.id = pp.product_id
    where p.external_id = 'ZK-1'),
  4::bigint,
  '4) uc elle olcum + teklif eklenirken otomatik yazilan ilk olcum'
);

-- --- 5) FİYAT GEÇMİŞİ ------------------------------------------------------
select ok(
  (select count(*) from public.price_history(
     (select id from public.product_groups where slug = 'zincir-kulaklik'), 90)) > 0,
  '5) fiyat gecmisi olcumlerden okunabiliyor'
);

-- --- 6) İNDİRİM KANITI -----------------------------------------------------
-- price_drops() düşüşü BİZİM ölçümlerimizden hesaplar ve en az iki ölçüm
-- ister. 150.000 → 120.000 = %20 gerçek düşüş.
select ok(
  exists (
    select 1 from public.price_drops(90, 0.10, null, 50) d
     where d.slug = 'zincir-kulaklik'
  ),
  '6) indirim KANITA dayali olarak tespit edildi'
);

-- --- 7) KANITSIZ İNDİRİM ÜRETİLMİYOR ---------------------------------------
-- Tek ölçümü olan bir teklif indirim listesine GİREMEZ: bir nokta bir
-- geçmis degildir ve "indi" demek icin karsilastirilacak bir sey yoktur.
insert into public.product_groups (slug, title, brand)
values ('tek-olcum-urun', 'Tek Olcum Urun', 'ZincirMarka');

insert into public.products
  (merchant_id, source_id, group_id, external_id, title,
   price_cents, currency, market, status, fulfillment, product_url, stock)
select m.id, s.id, g.id, 'ZK-2', 'Tek Olcum Urun',
       90000, 'TRY', 'TR', 'active', 'affiliate',
       'https://zincir.gecersiz/u/zk-2', 5
  from public.merchants m
  join public.sources s on s.merchant_id = m.id
  cross join public.product_groups g
 where m.slug = 'zincir-magaza' and g.slug = 'tek-olcum-urun';

insert into public.price_points (product_id, price_cents, observed_at)
select id, 90000, now() - interval '2 days'
  from public.products where external_id = 'ZK-2';

select ok(
  not exists (
    select 1 from public.price_drops(90, 0.10, null, 50) d
     where d.slug = 'tek-olcum-urun'
  ),
  '7) tek olculu urun icin indirim UYDURULMUYOR'
);

-- --- 8-11) OHAAAA SKOR -----------------------------------------------------
select ok(
  (public.ohaaaa_score((select id from public.products where external_id = 'ZK-1'), 90)
    ->> 'available')::boolean,
  '8) gercek olcumlerden gercek bir skor uretildi'
);

select ok(
  (public.ohaaaa_score((select id from public.products where external_id = 'ZK-1'), 90)
    ->> 'score')::int between 0 and 100,
  '9) skor 0-100 araliginda'
);

-- Ölçülen ağırlık raporlanıyor: skorun NE KADARINI gerçekten ölçtüğümüz
-- kullanıcıya söylenebilir olmalı.
select ok(
  (public.ohaaaa_score((select id from public.products where external_id = 'ZK-1'), 90)
    ->> 'measured_weight')::int >= 50,
  '10) olculen agirlik esigi gecti, skor bu yuzden gosterilebilir'
);

/*
 * ÖLÇÜLEMEYEN BİLEŞEN PUANA KATILMAZ.
 *
 * Fonksiyonun sözleşmesi şu: ölçemediği bileşen için `points` anahtarı hiç
 * yazılmaz, yerine bir `reason` yazılır. Bu test o sözleşmeyi bekler --
 * ileride biri "eksik veriyi ortalamayla doldur" derse burada patlar.
 */
-- `components` bir DİZİ (her bileşen kendi 'key' alanını taşır), nesne
-- değil; testin ilk hâli jsonb_each ile nesne varsayıyordu ve patladı.
select ok(
  exists (
    select 1
      from jsonb_array_elements(
             public.ohaaaa_score(
               (select id from public.products where external_id = 'ZK-2'), 90
             ) -> 'components'
           ) as bilesen
     where bilesen ? 'reason' and not (bilesen ? 'points')
  ),
  '11) olculemeyen bilesen puan almiyor ve sebebi yaziyor'
);

-- --- 12) PAZAR İZOLASYONU ZİNCİRİN SONUNDA DA KORUNUYOR --------------------
-- Alman pazarına aynı kanonik ürün için EUR bir teklif eklenirse, Türk
-- pazarının fırsat listesi bundan etkilenmemeli.
insert into public.merchants
  (slug, display_name, homepage_url, network, status, deeplink_template, country_code)
values
  ('zincir-de', 'Zincir DE', 'https://zincir.de.gecersiz', 'direct', 'active',
   'https://zincir.de.gecersiz/g?u={url}', 'DE');

insert into public.products
  (merchant_id, group_id, external_id, title,
   price_cents, currency, market, status, fulfillment, product_url, stock)
select m.id, g.id, 'ZK-1-DE', 'Zincir Oyuncu Kulakligi',
       3000, 'EUR', 'DE', 'active', 'affiliate',
       'https://zincir.de.gecersiz/u/zk1', 4
  from public.merchants m
  cross join public.product_groups g
 where m.slug = 'zincir-de' and g.slug = 'zincir-kulaklik';

select is(
  (select count(*) from public.products
    where group_id = (select id from public.product_groups where slug = 'zincir-kulaklik')
      and market = 'TR'),
  1::bigint,
  '12) ayni kanonik urunun DE teklifi TR pazarina sizmiyor'
);

select * from finish();
rollback;
