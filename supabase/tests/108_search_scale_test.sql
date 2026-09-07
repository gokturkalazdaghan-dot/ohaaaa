-- ===========================================================================
-- 108 — arama ölçeği: "en ucuz" mezhebe göre seçilmiyor
-- ===========================================================================
--
-- Merkezdeki hata Aşama 12'dekinden AĞIRDI çünkü bu sütunlar ARAMA
-- SIRALAMASINI ve FİYAT FİLTRESİNİ sürüyor:
--
--   min(p.price_cents)                          -- para birimi YOK
--   order by (price_cents + shipping_fee_cents) -- para birimi YOK
--
-- Farklı para birimlerindeki sayılar büyüklük olarak kıyaslanınca, düşük
-- mezhepli para birimindeki teklif her zaman "pahalı" görünür. Sitenin
-- temel iddiası -- "en ucuzu buluyoruz" -- fiyata değil PARA BİRİMİ
-- MEZHEBİNE göre karar veriyordu.
begin;
select plan(12);

select has_table('public', 'product_group_price_stats',
  '1) istatistik PARA BIRIMI BASINA tutuluyor');

-- --- Zemin: 12.000 HUF (~33 USD) ve 90 USD ---------------------------------
-- Gercekte HUF teklifi UCUZ; eski kod min(1200000, 9000) yapip USD yi
-- "en iyi teklif" secerdi -- yani ucte biri fiyatindaki teklifi elerdi.
insert into public.product_groups (slug, title) values ('ar-test', 'Arama Testi');

insert into public.products
  (vendor_id, group_id, external_id, title, price_cents, currency, stock, market_code)
select v.id, g.id, 'AR-HUF', 'AR HUF', 1200000, 'HUF', 5,
       (select code from public.markets order by code limit 1)
  from public.vendors v, public.product_groups g where g.slug = 'ar-test' limit 1;

insert into public.products
  (vendor_id, group_id, external_id, title, price_cents, currency, stock, market_code)
select v.id, g.id, 'AR-USD', 'AR USD', 9000, 'USD', 5,
       (select code from public.markets order by code limit 1)
  from public.vendors v, public.product_groups g where g.slug = 'ar-test' limit 1;

-- --- 2-4: İSTATİSTİK PARA BİRİMİ BAŞINA -----------------------------------
select is(
  (select count(*)::int from public.product_group_price_stats s
     join public.product_groups g on g.id = s.group_id where g.slug = 'ar-test'),
  2, '2) iki para birimi IKI ayri satir -- tek min() e girmiyor');

select is(
  (select p.external_id from public.product_group_price_stats s
     join public.product_groups g on g.id = s.group_id
     join public.products p on p.id = s.best_offer_id
    where g.slug = 'ar-test' and s.currency = 'HUF'),
  'AR-HUF', '3) HUF in en iyi teklifi HUF tekliflerinden secildi');

select is(
  (select p.external_id from public.product_group_price_stats s
     join public.product_groups g on g.id = s.group_id
     join public.products p on p.id = s.best_offer_id
    where g.slug = 'ar-test' and s.currency = 'USD'),
  'AR-USD', '4) USD nin en iyi teklifi USD tekliflerinden secildi');

-- --- 5: ESKİ SÜTUNLAR ETİKETLİ --------------------------------------------
-- Etiketsiz bir fiyat sayisi, ayni hatanin sessiz halidir.
select ok(
  (select price_currency is not null from public.product_groups where slug = 'ar-test'),
  '5) min/max_price_cents in para birimi YAZILI');

-- --- 6-8: FİYAT FİLTRESİ PARA BİRİMİ İÇİNDE -------------------------------
select is(
  (select count(*)::int from public.search_products_page(
     p_currency => 'USD', p_min_price => 100000, p_limit => 50)
    where group_id = (select id from public.product_groups where slug='ar-test')),
  0, '6) USD filtresi HUF tutarini YAKALAMIYOR');

select is(
  (select min_price_cents from public.search_products_page(
     p_currency => 'USD', p_limit => 50)
    where group_id = (select id from public.product_groups where slug='ar-test')),
  9000::bigint, '7) USD sonucu USD tutarini donduruyor');

select is(
  (select min_price_cents from public.search_products_page(
     p_currency => 'HUF', p_limit => 50)
    where group_id = (select id from public.product_groups where slug='ar-test')),
  1200000::bigint, '8) HUF sonucu HUF tutarini donduruyor');

-- --- 9: PARA BİRİMİ VERİLMEZSE FİYAT FİLTRESİ UYGULANMIYOR ----------------
-- Farkli para birimlerindeki sayilari tek bir aralikla elemek, tam olarak
-- duzeltilen hatanin kendisi olurdu.
select ok(
  (select count(*) >= 2 from public.search_products_page(
     p_min_price => 100000, p_limit => 50)
    where group_id = (select id from public.product_groups where slug='ar-test')),
  '9) para birimi yokken fiyat filtresi UYGULANMIYOR');

-- --- 10: KEYSET SAYFALAMA --------------------------------------------------
-- offset 500000 veritabanina o kadar satiri okutup attirir; keyset sabit
-- maliyetlidir.
select ok(
  (select count(*) = 1 from public.search_products_page(
     p_currency => 'USD', p_limit => 1)),
  '10) keyset sayfalama limit uyguluyor');

-- --- 11: TEKLİF KALMAYINCA SAYAÇLAR SIFIRLANIYOR --------------------------
update public.products set status = 'archived'
 where group_id = (select id from public.product_groups where slug='ar-test');

select is(
  (select offer_count from public.product_groups where slug = 'ar-test'),
  0, '11) teklif kalmadi -> sayac sifir, satilmayan urun satiliyor gorunmuyor');

-- --- 12: İSTATİSTİK VİTRİNE AÇIK, YAZMA KAPALI ----------------------------
select is(
  (select count(*)::int from (values ('anon'), ('authenticated')) as r(rol)
    where has_table_privilege(r.rol, 'public.product_group_price_stats', 'insert')
       or has_table_privilege(r.rol, 'public.product_group_price_stats', 'update')),
  0, '12) istemci roller istatistik YAZAMIYOR');

select * from finish();
rollback;
