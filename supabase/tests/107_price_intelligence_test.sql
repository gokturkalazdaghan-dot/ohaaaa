-- ===========================================================================
-- 107 — fiyat/değer zekâsı: para birimi karışmıyor, teklif kaybolmuyor
-- ===========================================================================
--
-- Merkezdeki hata: `price_history` bir kanonik ürünün tüm tekliflerinden
-- para birimine bakmadan `min()` alıyordu. 1000 (10 USD) ile 1000 (10 TRY)
-- aynı sayıdır ve min() ikisini eşit sayar -- "en düşük fiyat" grafiği iki
-- farklı şeyi tek çizgide gösterir. Sessiz ve yanlış; üstelik bu sitenin
-- var olma sebebi tam olarak o rakam.
begin;
select plan(14);

-- --- Zemin: aynı üründe İKİ para birimi, AYNI sayısal değer -------------
insert into public.product_groups (slug, title) values ('fz-test', 'Fiyat Zeka Testi');

insert into public.products
  (vendor_id, group_id, external_id, title, price_cents, currency, stock, market_code)
select v.id, g.id, 'FZ-USD', 'FZ USD', 1000, 'USD', 5,
       (select code from public.markets order by code limit 1)
  from public.vendors v, public.product_groups g
 where g.slug = 'fz-test' limit 1;

insert into public.products
  (vendor_id, group_id, external_id, title, price_cents, currency, stock,
   shipping_fee_cents, market_code)
select v.id, g.id, 'FZ-TRY', 'FZ TRY', 1000, 'TRY', 5, 300,
       (select code from public.markets order by code limit 1)
  from public.vendors v, public.product_groups g
 where g.slug = 'fz-test' limit 1;

-- --- 1-3: GEÇMİŞ PARA BİRİMLERİNİ KARIŞTIRMIYOR --------------------------
select is(
  (select count(*)::int from public.price_history(
     (select id from public.product_groups where slug='fz-test'), 7)
    where day = current_date),
  2, '1) gunluk IKI satir -- para birimleri KARISMIYOR');

select is(
  (select count(distinct currency)::int from public.price_history(
     (select id from public.product_groups where slug='fz-test'), 7)),
  2, '2) iki ayri para birimi ayri satirlarda');

select ok(
  (select bool_and(currency is not null) from public.price_history(
     (select id from public.product_groups where slug='fz-test'), 7)),
  '3) her satir kendi para birimini TASIYOR');

-- --- 4-7: MAĞAZA KIRILIMI --------------------------------------------------
-- min() ile tek satira indirmek, kullanicinin asil sorusunu (hangi magaza,
-- ne kadar, ne kadar surede) cevapsiz birakir.
select is(
  (select count(*)::int from public.product_offer_breakdown(
     (select id from public.product_groups where slug='fz-test'))),
  2, '4) kirilim TEKLIF KAYBETMIYOR');

select is(
  (select shipping_fee_cents from public.product_offer_breakdown(
     (select id from public.product_groups where slug='fz-test'))
    where currency = 'TRY'),
  300::bigint, '5) kargo fiyattan AYRI donuyor');

select is(
  (select total_cents from public.product_offer_breakdown(
     (select id from public.product_groups where slug='fz-test'))
    where currency = 'TRY'),
  1300::bigint, '6) toplam veriliyor ama BILESENLER kaybolmuyor');

select ok(
  (select bool_and(in_stock) from public.product_offer_breakdown(
     (select id from public.product_groups where slug='fz-test'))),
  '7) stok durumu fiyattan ayri tasiniyor');

-- --- 8: TAZELİK -------------------------------------------------------------
-- Bayat fiyat, fiyat degildir: kullanici tiklar ve magazada baska bir
-- fiyat gorur.
select ok(
  (select bool_and(price_age_hours is not null or last_seen_at is null)
     from public.product_offer_breakdown(
       (select id from public.product_groups where slug='fz-test'))),
  '8) fiyatin YASI olculuyor');

-- --- 9-11: ANOMALİ ----------------------------------------------------------
select is(
  (select verdict from public.price_anomaly(
     (select id from public.products where external_id='FZ-USD'))),
  'insufficient_history',
  '9) YETERSIZ GOZLEM bir HUKUM degil -- yeni urun supheli ilan edilmez');

-- Yeterli gecmis: 6 gozlem, hepsi 1000 civari.
insert into public.price_points (product_id, price_cents, in_stock, currency, observed_at)
select p.id, 1000, true, 'USD', now() - (i || ' days')::interval
  from public.products p, generate_series(1, 6) i
 where p.external_id = 'FZ-USD';

select is(
  (select verdict from public.price_anomaly(
     (select id from public.products where external_id='FZ-USD'))),
  'normal', '10) gecmisiyle uyumlu fiyat NORMAL');

-- Ondalik kaymasi: 1000 -> 10 (feed'de kurus/lira karismasi)
update public.products set price_cents = 10 where external_id = 'FZ-USD';

select is(
  (select verdict from public.price_anomaly(
     (select id from public.products where external_id='FZ-USD'))),
  'suspicious_drop',
  '11) ondalik kaymasi YAKALANIYOR -- "en ucuz" diye one cikip guveni yikardi');

-- --- 12: ANOMALİ SİLMİYOR, İŞARETLİYOR -------------------------------------
-- Otomatik silme gercek bir kampanyayi da yok ederdi.
select is(
  (select count(*)::int from public.products where external_id = 'FZ-USD'),
  1, '12) supheli fiyat SILINMIYOR, yalnizca isaretleniyor');

-- --- 13: ANOMALİ VİTRİNE KAPALI --------------------------------------------
-- Hangi feed'in bozuk oldugu OPERATOR bilgisidir.
select is(
  (select count(*)::int from (values ('anon'), ('authenticated')) as r(rol)
    where has_function_privilege(r.rol, 'public.price_anomaly(uuid,integer,numeric,numeric)', 'execute')),
  0, '13) anomali fonksiyonu vitrine kapali');

-- --- 14: KIRILIM RLS'İ ATLAMIYOR -------------------------------------------
-- DEFINER olsaydi pasif bir magazanin teklifi karsilastirma tablosunda
-- gorunurdu.
select is(
  (select prosecdef::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='product_offer_breakdown'),
  'false', '14) kirilim SECURITY INVOKER -- vitrin RLS i gecerli kaliyor');

select * from finish();
rollback;
